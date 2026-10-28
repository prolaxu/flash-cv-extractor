//! A streaming content stream lexer.
//!
//! lopdf can parse a content stream into `Vec<Operation>`, but it materializes
//! every operator with an owned `String` and a `Vec<Object>` of operands. A
//! design-heavy pdf page is mostly vector graphics, so the overwhelming
//! majority of that work is thrown away by a text extractor. This lexer walks
//! the bytes once, keeps operands on a reusable stack, and only ever allocates
//! for the text operators the interpreter actually uses.

/// An operand waiting for its operator.
#[derive(Debug, Clone)]
pub enum Operand {
    Number(f64),
    /// A string, already unescaped.
    Text(Vec<u8>),
    Name(Vec<u8>),
    /// Only produced for the TJ array.
    Array(Vec<Operand>),
}

impl Operand {
    pub fn as_number(&self) -> f64 {
        match self {
            Operand::Number(value) => *value,
            _ => 0.0,
        }
    }
}

fn is_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | b'\x0c' | b'\0')
}

fn is_delimiter(byte: u8) -> bool {
    matches!(
        byte,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub struct Lexer<'a> {
    data: &'a [u8],
    pos: usize,
}

/// One lexed token.
enum Token {
    Operand(Operand),
    Operator(usize, usize),
    ArrayStart,
    ArrayEnd,
    /// A dictionary or inline-image body that carries nothing we need.
    Skipped,
}

impl<'a> Lexer<'a> {
    pub fn new(data: &'a [u8]) -> Lexer<'a> {
        Lexer { data, pos: 0 }
    }

    fn peek(&self) -> Option<u8> {
        self.data.get(self.pos).copied()
    }

    fn skip_whitespace_and_comments(&mut self) {
        loop {
            while self.peek().map(is_whitespace).unwrap_or(false) {
                self.pos += 1;
            }
            if self.peek() == Some(b'%') {
                while let Some(byte) = self.peek() {
                    self.pos += 1;
                    if byte == b'\n' || byte == b'\r' {
                        break;
                    }
                }
                continue;
            }
            return;
        }
    }

    /// A literal string: (text), with escapes and balanced inner parentheses.
    fn read_literal_string(&mut self) -> Vec<u8> {
        self.pos += 1; // opening paren
        let mut out = Vec::new();
        let mut depth = 1;
        while let Some(byte) = self.peek() {
            self.pos += 1;
            match byte {
                b'\\' => {
                    let Some(escaped) = self.peek() else { break };
                    self.pos += 1;
                    match escaped {
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'(' => out.push(b'('),
                        b')' => out.push(b')'),
                        b'\\' => out.push(b'\\'),
                        // A backslash before a newline is a line continuation
                        b'\n' => {}
                        b'\r' => {
                            if self.peek() == Some(b'\n') {
                                self.pos += 1;
                            }
                        }
                        b'0'..=b'7' => {
                            let mut value = (escaped - b'0') as u32;
                            for _ in 0..2 {
                                match self.peek() {
                                    Some(digit @ b'0'..=b'7') => {
                                        value = value * 8 + (digit - b'0') as u32;
                                        self.pos += 1;
                                    }
                                    _ => break,
                                }
                            }
                            out.push((value & 0xff) as u8);
                        }
                        other => out.push(other),
                    }
                }
                b'(' => {
                    depth += 1;
                    out.push(byte);
                }
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                    out.push(byte);
                }
                other => out.push(other),
            }
        }
        out
    }

    /// A hex string: <48656c6c6f>
    fn read_hex_string(&mut self) -> Vec<u8> {
        self.pos += 1; // opening angle
        let mut digits: Vec<u8> = Vec::new();
        while let Some(byte) = self.peek() {
            self.pos += 1;
            if byte == b'>' {
                break;
            }
            if let Some(value) = hex_value(byte) {
                digits.push(value);
            }
        }
        if digits.len() % 2 == 1 {
            // An odd trailing digit is padded with zero per the spec
            digits.push(0);
        }
        digits.chunks(2).map(|c| (c[0] << 4) | c[1]).collect()
    }

    fn read_regular_run(&mut self) -> (usize, usize) {
        let start = self.pos;
        while let Some(byte) = self.peek() {
            if is_whitespace(byte) || is_delimiter(byte) {
                break;
            }
            self.pos += 1;
        }
        (start, self.pos)
    }

    /// Skip a dictionary body, tracking nesting.
    fn skip_dictionary(&mut self) {
        self.pos += 2; // <<
        let mut depth = 1;
        while self.pos < self.data.len() {
            if self.data[self.pos..].starts_with(b"<<") {
                depth += 1;
                self.pos += 2;
            } else if self.data[self.pos..].starts_with(b">>") {
                depth -= 1;
                self.pos += 2;
                if depth == 0 {
                    return;
                }
            } else if self.data[self.pos] == b'(' {
                self.read_literal_string();
            } else {
                self.pos += 1;
            }
        }
    }

    fn next_token(&mut self) -> Option<Token> {
        self.skip_whitespace_and_comments();
        let byte = self.peek()?;
        match byte {
            b'(' => Some(Token::Operand(Operand::Text(self.read_literal_string()))),
            b'<' => {
                if self.data[self.pos..].starts_with(b"<<") {
                    self.skip_dictionary();
                    Some(Token::Skipped)
                } else {
                    Some(Token::Operand(Operand::Text(self.read_hex_string())))
                }
            }
            b'/' => {
                self.pos += 1;
                let (start, end) = self.read_regular_run();
                Some(Token::Operand(Operand::Name(
                    self.data[start..end].to_vec(),
                )))
            }
            b'[' => {
                self.pos += 1;
                Some(Token::ArrayStart)
            }
            b']' => {
                self.pos += 1;
                Some(Token::ArrayEnd)
            }
            b')' | b'>' | b'{' | b'}' => {
                self.pos += 1;
                Some(Token::Skipped)
            }
            b'+' | b'-' | b'.' | b'0'..=b'9' => {
                let (start, end) = self.read_regular_run();
                let text = &self.data[start..end];
                // A malformed number is treated as zero rather than aborting
                let value = std::str::from_utf8(text)
                    .ok()
                    .and_then(|t| t.parse::<f64>().ok())
                    .unwrap_or(0.0);
                Some(Token::Operand(Operand::Number(value)))
            }
            _ => {
                let (start, end) = self.read_regular_run();
                if start == end {
                    // Not a token we recognize; do not stall
                    self.pos += 1;
                    return Some(Token::Skipped);
                }
                Some(Token::Operator(start, end))
            }
        }
    }

    /// Walk the stream, invoking `on_operator` for each operator with its
    /// operands. The operand slice is only valid for the duration of the call.
    pub fn run<F>(&mut self, mut on_operator: F)
    where
        F: FnMut(&[u8], &[Operand]),
    {
        let mut operands: Vec<Operand> = Vec::with_capacity(8);
        // Depth of array nesting; arrays are collected into one operand
        let mut array: Option<Vec<Operand>> = None;

        while let Some(token) = self.next_token() {
            match token {
                Token::Operand(operand) => match &mut array {
                    Some(items) => items.push(operand),
                    None => {
                        // Guard against a runaway operand stack in broken content
                        if operands.len() < 64 {
                            operands.push(operand);
                        }
                    }
                },
                Token::ArrayStart => array = Some(Vec::new()),
                Token::ArrayEnd => {
                    if let Some(items) = array.take() {
                        operands.push(Operand::Array(items));
                    }
                }
                Token::Operator(start, end) => {
                    let operator = &self.data[start..end];
                    // An inline image's binary data must be skipped wholesale
                    if operator == b"BI" {
                        self.skip_inline_image();
                    } else {
                        on_operator(operator, &operands);
                    }
                    operands.clear();
                    array = None;
                }
                Token::Skipped => {}
            }
        }
    }

    /// Inline images run from ID to EI and contain arbitrary bytes.
    fn skip_inline_image(&mut self) {
        while self.pos < self.data.len() {
            if self.data[self.pos..].starts_with(b"ID") {
                self.pos += 2;
                break;
            }
            self.pos += 1;
        }
        while self.pos + 1 < self.data.len() {
            let before_is_ws = self.pos == 0 || is_whitespace(self.data[self.pos - 1]);
            if before_is_ws && self.data[self.pos..].starts_with(b"EI") {
                let after = self.data.get(self.pos + 2).copied();
                if after.map(is_whitespace).unwrap_or(true) {
                    self.pos += 2;
                    return;
                }
            }
            self.pos += 1;
        }
        self.pos = self.data.len();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Collect (operator, operands) pairs for assertions.
    fn run(content: &[u8]) -> Vec<(String, Vec<Operand>)> {
        let mut seen = Vec::new();
        Lexer::new(content).run(|operator, operands| {
            seen.push((
                String::from_utf8_lossy(operator).to_string(),
                operands.to_vec(),
            ));
        });
        seen
    }

    #[test]
    fn reads_numbers_and_operators() {
        let seen = run(b"1 0 0 1 72 720 cm");
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, "cm");
        assert_eq!(seen[0].1.len(), 6);
        assert_eq!(seen[0].1[4].as_number(), 72.0);
        assert_eq!(seen[0].1[5].as_number(), 720.0);
    }

    #[test]
    fn reads_negative_and_real_numbers() {
        let seen = run(b"-12.5 .25 +3 TL");
        assert_eq!(seen[0].1[0].as_number(), -12.5);
        assert_eq!(seen[0].1[1].as_number(), 0.25);
        assert_eq!(seen[0].1[2].as_number(), 3.0);
    }

    #[test]
    fn unescapes_literal_strings() {
        let seen = run(br"(a\(b\)c\\d\n\101) Tj");
        let Operand::Text(bytes) = &seen[0].1[0] else {
            panic!("expected a string operand");
        };
        // \101 is octal for 'A'
        assert_eq!(bytes.as_slice(), b"a(b)c\\d\nA");
    }

    #[test]
    fn handles_balanced_parens_in_strings() {
        let seen = run(b"(outer (inner) tail) Tj");
        let Operand::Text(bytes) = &seen[0].1[0] else {
            panic!("expected a string operand");
        };
        assert_eq!(bytes.as_slice(), b"outer (inner) tail");
    }

    #[test]
    fn reads_hex_strings_and_pads_odd_digits() {
        let seen = run(b"<48656C6C6F> Tj");
        let Operand::Text(bytes) = &seen[0].1[0] else {
            panic!("expected a string operand");
        };
        assert_eq!(bytes.as_slice(), b"Hello");

        let seen = run(b"<4A5> Tj");
        let Operand::Text(bytes) = &seen[0].1[0] else {
            panic!("expected a string operand");
        };
        assert_eq!(bytes.as_slice(), &[0x4a, 0x50]);
    }

    #[test]
    fn collects_tj_arrays() {
        let seen = run(b"[(Hel) -250 (lo)] TJ");
        assert_eq!(seen[0].0, "TJ");
        let Operand::Array(items) = &seen[0].1[0] else {
            panic!("expected an array operand");
        };
        assert_eq!(items.len(), 3);
        assert_eq!(items[1].as_number(), -250.0);
    }

    #[test]
    fn distinguishes_a_dictionary_from_a_hex_string() {
        // The dict must be skipped, not read as a string
        let seen = run(b"<</Type/Foo>> BDC (text) Tj");
        let operators: Vec<&str> = seen.iter().map(|(op, _)| op.as_str()).collect();
        assert_eq!(operators, vec!["BDC", "Tj"]);
    }

    #[test]
    fn skips_comments() {
        let seen = run(b"% a comment\n1 0 0 1 0 0 cm");
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, "cm");
    }

    #[test]
    fn skips_inline_image_data() {
        // The binary payload contains "Tj", which must not be lexed
        let seen = run(b"BI /W 1 ID \x00Tj(\x01 EI (after) Tj");
        let operators: Vec<&str> = seen.iter().map(|(op, _)| op.as_str()).collect();
        assert_eq!(operators, vec!["Tj"]);
        let Operand::Text(bytes) = &seen[0].1[0] else {
            panic!("expected a string operand");
        };
        assert_eq!(bytes.as_slice(), b"after");
    }

    #[test]
    fn reads_names() {
        let seen = run(b"/F1 12 Tf");
        let Operand::Name(name) = &seen[0].1[0] else {
            panic!("expected a name operand");
        };
        assert_eq!(name.as_slice(), b"F1");
        assert_eq!(seen[0].1[1].as_number(), 12.0);
    }

    #[test]
    fn terminates_on_unterminated_string() {
        // Must not loop forever on malformed content
        let seen = run(b"(never closed");
        assert!(seen.is_empty());
    }
}
