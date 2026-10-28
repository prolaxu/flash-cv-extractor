//! Font information needed to turn glyph codes into text and advances.
//!
//! Three things are read per font:
//!   * the real base font name, e.g. "BCDEEE+Calibri-Bold" or "CMBX12", which
//!     is what bold detection keys off,
//!   * glyph advance widths, needed to know how wide a text run is,
//!   * a code -> string mapping, from the ToUnicode CMap where present and from
//!     the font's encoding otherwise.

use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object};

pub struct Font {
    /// The /BaseFont name, kept verbatim including any subset prefix.
    pub base_name: String,
    /// True when glyph codes are two bytes wide (Type0 / CID fonts).
    pub two_byte: bool,
    /// code -> advance width, already converted to text space (em).
    widths: HashMap<u32, f64>,
    /// Glyph space to text space scale. 1/1000 for every font type except
    /// Type3, which declares its own /FontMatrix.
    glyph_scale: f64,
    /// Width ranges (first, last, width) from a CID font's /W array. Kept as
    /// ranges rather than expanded per code: a single range can span the whole
    /// 16-bit CID space, and expanding those dominated parsing time.
    width_ranges: Vec<(u32, u32, f64)>,
    default_width: f64,
    /// code -> replacement text, from ToUnicode or /Differences.
    to_unicode: HashMap<u32, String>,
    /// True when a ToUnicode CMap supplied the mapping, which we trust fully.
    has_to_unicode: bool,
}

fn num(object: &Object) -> Option<f64> {
    match object {
        Object::Integer(value) => Some(*value as f64),
        Object::Real(value) => Some(*value as f64),
        _ => None,
    }
}

/// Follow a reference until a concrete object is reached.
fn resolve<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Object> {
    match object {
        Object::Reference(id) => doc.get_object(*id).ok(),
        other => Some(other),
    }
}

fn dict_get<'a>(doc: &'a Document, dict: &'a Dictionary, key: &str) -> Option<&'a Object> {
    dict.get(key.as_bytes()).ok().and_then(|o| resolve(doc, o))
}

impl Font {
    pub fn load(doc: &Document, dict: &Dictionary, resource_name: &str) -> Font {
        let subtype = dict_get(doc, dict, "Subtype")
            .and_then(|o| o.as_name().ok())
            .map(|n| String::from_utf8_lossy(n).to_string())
            .unwrap_or_default();

        // A Type0 font wraps a descendant CIDFont that carries the metrics
        let is_type0 = subtype == "Type0";
        let descendant = if is_type0 {
            dict_get(doc, dict, "DescendantFonts")
                .and_then(|o| o.as_array().ok())
                .and_then(|a| a.first())
                .and_then(|o| resolve(doc, o))
                .and_then(|o| o.as_dict().ok())
        } else {
            None
        };
        let metrics_dict = descendant.unwrap_or(dict);

        let base_name = dict_get(doc, metrics_dict, "BaseFont")
            .or_else(|| dict_get(doc, dict, "BaseFont"))
            .and_then(|o| o.as_name().ok())
            .map(|n| String::from_utf8_lossy(n).to_string())
            .unwrap_or_else(|| resource_name.to_string());

        // A Type3 font defines its own glyph space through /FontMatrix, so its
        // /Widths are NOT in thousandths. Assuming 1/1000 for one of these made
        // every advance roughly twice too wide, which drove the computed gap
        // between letters negative and so lost every word boundary on the page.
        let glyph_scale = if subtype == "Type3" {
            dict_get(doc, dict, "FontMatrix")
                .and_then(|o| o.as_array().ok())
                .and_then(|matrix| matrix.first())
                .and_then(num)
                .map(f64::abs)
                .filter(|scale| *scale > 0.0)
                .unwrap_or(0.001)
        } else {
            0.001
        };

        let mut font = Font {
            base_name,
            glyph_scale,
            two_byte: is_type0,
            widths: HashMap::new(),
            width_ranges: Vec::new(),
            default_width: if is_type0 { 1.0 } else { 0.5 },
            to_unicode: HashMap::new(),
            has_to_unicode: false,
        };

        if is_type0 {
            font.load_cid_widths(doc, metrics_dict);
        } else {
            font.load_simple_widths(doc, dict);
            font.load_encoding_differences(doc, dict);
        }
        font.load_to_unicode(doc, dict);
        font
    }

    /// Simple fonts: /FirstChar plus a /Widths array, in 1/1000 em.
    fn load_simple_widths(&mut self, doc: &Document, dict: &Dictionary) {
        let first = dict_get(doc, dict, "FirstChar")
            .and_then(num)
            .unwrap_or(0.0) as u32;
        if let Some(widths) = dict_get(doc, dict, "Widths").and_then(|o| o.as_array().ok()) {
            for (i, width) in widths.iter().enumerate() {
                if let Some(width) = resolve(doc, width).and_then(num) {
                    self.widths.insert(first + i as u32, width * self.glyph_scale);
                }
            }
        }
        if let Some(descriptor) = dict_get(doc, dict, "FontDescriptor")
            .and_then(|o| o.as_dict().ok())
        {
            if let Some(missing) = dict_get(doc, descriptor, "MissingWidth").and_then(num) {
                self.default_width = missing * self.glyph_scale;
            }
        }
    }

    /// CID fonts: /DW default plus a /W array in either
    /// `[c [w1 w2 ...]]` or `[cFirst cLast w]` form.
    fn load_cid_widths(&mut self, doc: &Document, dict: &Dictionary) {
        if let Some(dw) = dict_get(doc, dict, "DW").and_then(num) {
            self.default_width = dw * self.glyph_scale;
        }
        let Some(w) = dict_get(doc, dict, "W").and_then(|o| o.as_array().ok()) else {
            return;
        };
        let items: Vec<&Object> = w.iter().filter_map(|o| resolve(doc, o)).collect();
        let mut i = 0;
        while i < items.len() {
            let Some(first) = num(items[i]) else {
                i += 1;
                continue;
            };
            if i + 1 >= items.len() {
                break;
            }
            if let Ok(list) = items[i + 1].as_array() {
                for (offset, width) in list.iter().enumerate() {
                    if let Some(width) = resolve(doc, width).and_then(num) {
                        self.widths.insert(
                            first as u32 + offset as u32,
                            width * self.glyph_scale,
                        );
                    }
                }
                i += 2;
            } else if i + 2 < items.len() {
                let last = num(items[i + 1]).unwrap_or(first);
                let width = num(items[i + 2]).unwrap_or(0.0) * self.glyph_scale;
                if last >= first {
                    self.width_ranges.push((first as u32, last as u32, width));
                }
                i += 3;
            } else {
                break;
            }
        }
    }

    /// /Encoding may remap individual codes via a /Differences array.
    fn load_encoding_differences(&mut self, doc: &Document, dict: &Dictionary) {
        let Some(encoding) = dict_get(doc, dict, "Encoding") else {
            return;
        };
        let Ok(encoding) = encoding.as_dict() else {
            return;
        };
        let Some(differences) = dict_get(doc, encoding, "Differences")
            .and_then(|o| o.as_array().ok())
        else {
            return;
        };
        let mut code = 0u32;
        for entry in differences {
            match resolve(doc, entry) {
                Some(Object::Integer(value)) => code = *value as u32,
                Some(Object::Real(value)) => code = *value as u32,
                Some(Object::Name(name)) => {
                    if let Some(text) = glyph_name_to_text(&String::from_utf8_lossy(name)) {
                        self.to_unicode.insert(code, text);
                    }
                    code += 1;
                }
                _ => {}
            }
        }
    }

    fn load_to_unicode(&mut self, doc: &Document, dict: &Dictionary) {
        let Some(object) = dict_get(doc, dict, "ToUnicode") else {
            return;
        };
        let Ok(stream) = object.as_stream() else {
            return;
        };
        let Some(content) = crate::stream::stream_bytes(stream) else {
            return;
        };
        let map = parse_cmap(&content);
        if !map.is_empty() {
            // A ToUnicode CMap is authoritative, so it replaces /Differences
            for (code, text) in map {
                self.to_unicode.insert(code, text);
            }
            self.has_to_unicode = true;
        }
        if let Some(bytes) = cmap_code_byte_len(&content) {
            self.two_byte = bytes == 2;
        }
    }

    pub fn width(&self, code: u32) -> f64 {
        if let Some(width) = self.widths.get(&code) {
            return *width;
        }
        for (first, last, width) in &self.width_ranges {
            if code >= *first && code <= *last {
                return *width;
            }
        }
        self.default_width
    }

    /// Turn a glyph code into text. Falls back to treating the code as a
    /// Latin-1 byte, which is right for the many fonts that use a standard
    /// encoding and carry no ToUnicode CMap.
    pub fn decode(&self, code: u32) -> String {
        if let Some(text) = self.to_unicode.get(&code) {
            return expand_ligatures(text);
        }
        if self.has_to_unicode || self.two_byte {
            // Mapped font with an unmapped code: emitting a guess would be worse
            // than emitting nothing.
            return String::new();
        }
        match char::from_u32(code) {
            Some(ch) if code >= 32 => ch.to_string(),
            _ => String::new(),
        }
    }
}

/// Read a hex string such as `<00480065>` into bytes.
fn parse_hex(token: &str) -> Vec<u8> {
    let digits: Vec<u8> = token
        .bytes()
        .filter(|b| b.is_ascii_hexdigit())
        .map(|b| match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => b - b'a' + 10,
            _ => b - b'A' + 10,
        })
        .collect();
    digits.chunks(2).map(|c| (c[0] << 4) | c.get(1).copied().unwrap_or(0)).collect()
}

fn bytes_to_code(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0u32, |acc, b| (acc << 8) | *b as u32)
}

/// UTF-16BE, which is how ToUnicode stores its destinations.
fn utf16be_to_string(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks(2)
        .map(|c| ((c[0] as u16) << 8) | c.get(1).copied().unwrap_or(0) as u16)
        .collect();
    String::from_utf16_lossy(&units)
}

/// Split a CMap into the tokens we care about: hex strings, array brackets,
/// numbers and bare keywords.
fn tokenize(content: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(content);
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '<' => {
                let mut token = String::from("<");
                for next in chars.by_ref() {
                    if next == '>' {
                        break;
                    }
                    token.push(next);
                }
                tokens.push(token);
            }
            '[' | ']' => tokens.push(ch.to_string()),
            c if c.is_whitespace() => {}
            _ => {
                let mut token = String::from(ch);
                while let Some(&next) = chars.peek() {
                    if next.is_whitespace() || next == '<' || next == '[' || next == ']' {
                        break;
                    }
                    token.push(next);
                    chars.next();
                }
                tokens.push(token);
            }
        }
    }
    tokens
}

/// Infer the code width from the CMap's codespace range.
fn cmap_code_byte_len(content: &[u8]) -> Option<usize> {
    let tokens = tokenize(content);
    let start = tokens.iter().position(|t| t == "begincodespacerange")?;
    let end = tokens.iter().position(|t| t == "endcodespacerange")?;
    tokens
        .get(start + 1..end)?
        .iter()
        .filter(|t| t.starts_with('<'))
        .map(|t| parse_hex(t).len())
        .max()
}

/// Parse `beginbfchar`/`beginbfrange` sections into a code -> text map.
fn parse_cmap(content: &[u8]) -> HashMap<u32, String> {
    let tokens = tokenize(content);
    let mut map = HashMap::new();
    let mut i = 0;
    while i < tokens.len() {
        match tokens[i].as_str() {
            "beginbfchar" => {
                i += 1;
                while i + 1 < tokens.len() && tokens[i] != "endbfchar" {
                    if tokens[i].starts_with('<') && tokens[i + 1].starts_with('<') {
                        let code = bytes_to_code(&parse_hex(&tokens[i]));
                        let text = utf16be_to_string(&parse_hex(&tokens[i + 1]));
                        if !text.is_empty() {
                            map.insert(code, text);
                        }
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
            }
            "beginbfrange" => {
                i += 1;
                while i < tokens.len() && tokens[i] != "endbfrange" {
                    // <lo> <hi> <dst>  or  <lo> <hi> [ <d1> <d2> ... ]
                    if i + 2 < tokens.len()
                        && tokens[i].starts_with('<')
                        && tokens[i + 1].starts_with('<')
                    {
                        let lo = bytes_to_code(&parse_hex(&tokens[i]));
                        let hi = bytes_to_code(&parse_hex(&tokens[i + 1])).min(lo + 65535);
                        if tokens[i + 2] == "[" {
                            let mut code = lo;
                            let mut j = i + 3;
                            while j < tokens.len() && tokens[j] != "]" {
                                if tokens[j].starts_with('<') {
                                    let text = utf16be_to_string(&parse_hex(&tokens[j]));
                                    if !text.is_empty() {
                                        map.insert(code, text);
                                    }
                                    code += 1;
                                }
                                j += 1;
                            }
                            i = j + 1;
                        } else if tokens[i + 2].starts_with('<') {
                            let dst = parse_hex(&tokens[i + 2]);
                            let base = bytes_to_code(&dst);
                            // Only the last unit increments across the range
                            for offset in 0..=(hi - lo) {
                                let mut units = dst.clone();
                                let value = base + offset;
                                let len = units.len();
                                if len >= 2 {
                                    units[len - 2] = ((value >> 8) & 0xff) as u8;
                                    units[len - 1] = (value & 0xff) as u8;
                                } else if len == 1 {
                                    units[0] = (value & 0xff) as u8;
                                }
                                let text = utf16be_to_string(&units);
                                if !text.is_empty() {
                                    map.insert(lo + offset, text);
                                }
                            }
                            i += 3;
                        } else {
                            i += 3;
                        }
                    } else {
                        i += 1;
                    }
                }
            }
            _ => i += 1,
        }
    }
    map
}

/// Expand typographic ligatures to the letters they stand for.
///
/// A pdf set in a serif face maps "fi" to a single U+FB01 glyph, so the text
/// comes out as "Certi\u{fb01}cations". Readers see the right thing, but any
/// code matching on letters does not: a keyword test for "certification" fails
/// and a letters-only heading test rejects the line outright.
fn expand_ligatures(text: &str) -> String {
    if !text.chars().any(|c| ('\u{fb00}'..='\u{fb06}').contains(&c)) {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len() + 4);
    for ch in text.chars() {
        match ch {
            '\u{fb00}' => out.push_str("ff"),
            '\u{fb01}' => out.push_str("fi"),
            '\u{fb02}' => out.push_str("fl"),
            '\u{fb03}' => out.push_str("ffi"),
            '\u{fb04}' => out.push_str("ffl"),
            '\u{fb05}' | '\u{fb06}' => out.push_str("st"),
            other => out.push(other),
        }
    }
    out
}

/// Map a PostScript glyph name to text, covering the forms that actually show
/// up in resume pdfs: uniXXXX, single letters, and the common punctuation names.
fn glyph_name_to_text(name: &str) -> Option<String> {
    if let Some(hex) = name.strip_prefix("uni") {
        if let Ok(value) = u32::from_str_radix(hex, 16) {
            return char::from_u32(value).map(|c| c.to_string());
        }
    }
    let mapped = match name {
        "space" => " ",
        "period" => ".",
        "comma" => ",",
        "colon" => ":",
        "semicolon" => ";",
        "hyphen" | "endash" => "-",
        "emdash" => "\u{2014}",
        "slash" => "/",
        "at" => "@",
        "plus" => "+",
        "parenleft" => "(",
        "parenright" => ")",
        "ampersand" => "&",
        "percent" => "%",
        "bullet" => "\u{2022}",
        "quotesingle" | "quoteright" => "'",
        "quotedblleft" => "\u{201c}",
        "quotedblright" => "\u{201d}",
        "fi" => "fi",
        "fl" => "fl",
        _ => {
            let mut chars = name.chars();
            let first = chars.next()?;
            if name.len() == 1 && first.is_ascii_graphic() {
                return Some(first.to_string());
            }
            return None;
        }
    };
    Some(mapped.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bfchar_mappings() {
        let cmap = br"
/CIDInit /ProcSet findresource begin
begincmap
2 beginbfchar
<0024> <0041>
<0025> <0042>
endbfchar
endcmap
";
        let map = parse_cmap(cmap);
        assert_eq!(map.get(&0x24).map(String::as_str), Some("A"));
        assert_eq!(map.get(&0x25).map(String::as_str), Some("B"));
    }

    #[test]
    fn parses_bfrange_with_a_contiguous_destination() {
        let cmap = br"
1 beginbfrange
<0030> <0032> <0041>
endbfrange
";
        let map = parse_cmap(cmap);
        // 0x30..0x32 map onto A, B, C
        assert_eq!(map.get(&0x30).map(String::as_str), Some("A"));
        assert_eq!(map.get(&0x31).map(String::as_str), Some("B"));
        assert_eq!(map.get(&0x32).map(String::as_str), Some("C"));
    }

    #[test]
    fn parses_bfrange_with_an_explicit_array() {
        let cmap = br"
1 beginbfrange
<0010> <0012> [<0058> <0059> <005A>]
endbfrange
";
        let map = parse_cmap(cmap);
        assert_eq!(map.get(&0x10).map(String::as_str), Some("X"));
        assert_eq!(map.get(&0x11).map(String::as_str), Some("Y"));
        assert_eq!(map.get(&0x12).map(String::as_str), Some("Z"));
    }

    #[test]
    fn decodes_multi_unit_destinations() {
        // A ligature mapping to two characters
        let cmap = br"
1 beginbfchar
<0001> <00660069>
endbfchar
";
        let map = parse_cmap(cmap);
        assert_eq!(map.get(&1).map(String::as_str), Some("fi"));
    }

    #[test]
    fn reads_the_code_width_from_the_codespace_range() {
        let two_byte = br"
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
";
        assert_eq!(cmap_code_byte_len(two_byte), Some(2));

        let one_byte = br"
1 begincodespacerange
<00> <FF>
endcodespacerange
";
        assert_eq!(cmap_code_byte_len(one_byte), Some(1));
    }

    #[test]
    fn ignores_a_cmap_with_no_mappings() {
        assert!(parse_cmap(b"begincmap endcmap").is_empty());
    }

    #[test]
    fn maps_glyph_names_used_by_differences_arrays() {
        assert_eq!(glyph_name_to_text("uni0041").as_deref(), Some("A"));
        assert_eq!(glyph_name_to_text("space").as_deref(), Some(" "));
        assert_eq!(glyph_name_to_text("hyphen").as_deref(), Some("-"));
        assert_eq!(glyph_name_to_text("A").as_deref(), Some("A"));
        assert_eq!(glyph_name_to_text("nonexistentglyph"), None);
    }

    #[test]
    fn hex_parsing_handles_whitespace_and_case() {
        assert_eq!(parse_hex("<00 4a>"), vec![0x00, 0x4a]);
        assert_eq!(parse_hex("<004A>"), vec![0x00, 0x4a]);
    }
}

#[cfg(test)]
mod ligature_tests {
    use super::expand_ligatures;

    #[test]
    fn expands_the_common_ligatures() {
        // A serif pdf maps "fi" to one glyph, so "Certifications" arrives with
        // U+FB01 in it and no keyword test for "certification" can match.
        assert_eq!(expand_ligatures("Certi\u{fb01}cations"), "Certifications");
        assert_eq!(expand_ligatures("Bu\u{fb00}alo"), "Buffalo");
        assert_eq!(expand_ligatures("\u{fb02}ow"), "flow");
        assert_eq!(expand_ligatures("o\u{fb03}ce"), "office");
        assert_eq!(expand_ligatures("sha\u{fb04}e"), "shaffle");
    }

    #[test]
    fn leaves_ordinary_text_untouched() {
        assert_eq!(expand_ligatures("Certifications"), "Certifications");
        assert_eq!(expand_ligatures(""), "");
    }
}
