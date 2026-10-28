//! Hand-rolled json output.
//!
//! The payload is a flat list of pages and items, so a serializer dependency
//! would cost more in wasm size than it saves in code.

use crate::items::Page;

pub fn pages_to_json(pages: &[Page]) -> String {
    let mut out = String::from("{\"pages\":[");
    for (page_index, page) in pages.iter().enumerate() {
        if page_index > 0 {
            out.push(',');
        }
        out.push_str("{\"width\":");
        push_number(&mut out, page.width);
        out.push_str(",\"items\":[");
        for (item_index, item) in page.items.iter().enumerate() {
            if item_index > 0 {
                out.push(',');
            }
            out.push_str("{\"text\":");
            push_string(&mut out, &item.text);
            out.push_str(",\"x\":");
            push_number(&mut out, item.x);
            out.push_str(",\"y\":");
            push_number(&mut out, item.y);
            out.push_str(",\"width\":");
            push_number(&mut out, item.width);
            out.push_str(",\"height\":");
            push_number(&mut out, item.height);
            out.push_str(",\"fontName\":");
            push_string(&mut out, &item.font_name);
            out.push_str(",\"hasEOL\":");
            out.push_str(if item.has_eol { "true" } else { "false" });
            out.push('}');
        }
        out.push_str("]}");
    }
    out.push_str("]}");
    out
}

pub fn error_to_json(message: &str) -> String {
    let mut out = String::from("{\"error\":");
    push_string(&mut out, message);
    out.push('}');
    out
}

/// Three decimals: finer than that is below the precision layout cares about.
fn push_number(out: &mut String, value: f64) {
    if value.is_finite() {
        out.push_str(&format!("{:.3}", value));
    } else {
        out.push('0');
    }
}

fn push_string(out: &mut String, value: &str) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::items::TextItem;

    #[test]
    fn serializes_pages_and_items() {
        let pages = vec![Page {
            width: 612.0,
            items: vec![TextItem {
                text: "Jane \"JD\" Doe".to_string(),
                x: 1.5,
                y: 2.0,
                width: 3.0,
                height: 4.0,
                font_name: "Helvetica-Bold".to_string(),
                has_eol: true,
            }],
        }];
        let json = pages_to_json(&pages);
        assert!(json.contains("\"width\":612.000"));
        assert!(json.contains(r#""text":"Jane \"JD\" Doe""#));
        assert!(json.contains("\"hasEOL\":true"));
    }

    #[test]
    fn escapes_control_characters() {
        let mut out = String::new();
        push_string(&mut out, "a\u{1}b");
        assert_eq!(out, "\"a\\u0001b\"");
    }

    #[test]
    fn serializes_errors() {
        assert_eq!(error_to_json("broken"), "{\"error\":\"broken\"}");
    }
}
