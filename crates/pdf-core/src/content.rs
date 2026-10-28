//! Content stream interpreter: walks the text operators of a page and emits
//! one positioned item per show-text operation.

use std::collections::HashMap;

use lopdf::{Dictionary, Document, Object};

use crate::font::Font;
use crate::geometry::Matrix;
use crate::items::{merge_runs, set_end_of_line_flags, Page, TextItem};
use crate::lexer::{Lexer, Operand};

fn num(object: &Object) -> f64 {
    match object {
        Object::Integer(value) => *value as f64,
        Object::Real(value) => *value as f64,
        _ => 0.0,
    }
}

/// Text state carried across operators inside BT/ET.
struct TextState {
    text_matrix: Matrix,
    line_matrix: Matrix,
    font_size: f64,
    char_spacing: f64,
    word_spacing: f64,
    horizontal_scale: f64,
    leading: f64,
    rise: f64,
    font: Option<String>,
}

impl TextState {
    fn new() -> TextState {
        TextState {
            text_matrix: Matrix::IDENTITY,
            line_matrix: Matrix::IDENTITY,
            font_size: 0.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            horizontal_scale: 1.0,
            leading: 0.0,
            rise: 0.0,
            font: None,
        }
    }
}

/// Read the page's /MediaBox, walking up /Parent since it is inheritable.
fn page_width(doc: &Document, page_id: lopdf::ObjectId) -> f64 {
    let mut current = Some(page_id);
    let mut hops = 0;
    while let Some(id) = current {
        if hops > 32 {
            break;
        }
        hops += 1;
        let Ok(dict) = doc.get_dictionary(id) else {
            break;
        };
        if let Some(media_box) = dict
            .get(b"MediaBox")
            .ok()
            .and_then(|o| match o {
                Object::Reference(r) => doc.get_object(*r).ok(),
                other => Some(other),
            })
            .and_then(|o| o.as_array().ok())
        {
            if media_box.len() >= 4 {
                let x0 = num(&media_box[0]);
                let x1 = num(&media_box[2]);
                return (x1 - x0).abs();
            }
        }
        current = dict.get(b"Parent").ok().and_then(|o| o.as_reference().ok());
    }
    612.0
}

/// Pre-merge items per page, for inspecting the interpreter's raw output.
pub fn extract_pages_raw(doc: &Document) -> Vec<Vec<TextItem>> {
    let mut out = Vec::new();
    for (_, page_id) in doc.get_pages() {
        let mut fonts: HashMap<String, Font> = HashMap::new();
        if let Ok(font_dicts) = doc.get_page_fonts(page_id) {
            for (name, dict) in font_dicts {
                let name = String::from_utf8_lossy(&name).to_string();
                fonts.insert(name.clone(), Font::load(doc, dict, &name));
            }
        }
        let resources = doc.get_page_resources(page_id).ok().and_then(|(d, _)| d);
        let content = crate::stream::page_content(doc, page_id);
        let mut items = Vec::new();
        run_content(doc, &content, resources, &fonts, Matrix::IDENTITY, 0, &mut items);
        out.push(items);
    }
    out
}

pub fn extract_pages(doc: &Document) -> Vec<Page> {
    let mut pages = Vec::new();

    for (_, page_id) in doc.get_pages() {
        let width = page_width(doc, page_id);

        // Font resources are keyed by the name used in Tf operators
        let mut fonts: HashMap<String, Font> = HashMap::new();
        if let Ok(font_dicts) = doc.get_page_fonts(page_id) {
            for (name, dict) in font_dicts {
                let name = String::from_utf8_lossy(&name).to_string();
                let font = Font::load(doc, dict, &name);
                fonts.insert(name, font);
            }
        }

        let resources = doc
            .get_page_resources(page_id)
            .ok()
            .and_then(|(dict, _)| dict);

        // Raw, filter-decoded bytes; the lexer walks them directly. Read via
        // our own helper rather than lopdf's get_page_content, so that an
        // uncompressed content stream is handled too.
        let content = crate::stream::page_content(doc, page_id);
        if content.is_empty() {
            pages.push(Page { width, items: Vec::new() });
            continue;
        }

        let mut items: Vec<TextItem> = Vec::new();
        run_content(doc, &content, resources, &fonts, Matrix::IDENTITY, 0, &mut items);

        let mut items = merge_runs(items);
        set_end_of_line_flags(&mut items);
        pages.push(Page { width, items });
    }

    pages
}

/// Follow a reference until a concrete object is reached.
fn resolve<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Object> {
    match object {
        Object::Reference(id) => doc.get_object(*id).ok(),
        other => Some(other),
    }
}

/// Build the font map for a resources dictionary.
fn load_fonts(doc: &Document, resources: Option<&Dictionary>) -> HashMap<String, Font> {
    let mut fonts = HashMap::new();
    let Some(resources) = resources else {
        return fonts;
    };
    let Some(font_dict) = resources
        .get(b"Font")
        .ok()
        .and_then(|o| resolve(doc, o))
        .and_then(|o| o.as_dict().ok())
    else {
        return fonts;
    };
    for (name, value) in font_dict.iter() {
        if let Some(dict) = resolve(doc, value).and_then(|o| o.as_dict().ok()) {
            let name = String::from_utf8_lossy(name).to_string();
            let font = Font::load(doc, dict, &name);
            fonts.insert(name, font);
        }
    }
    fonts
}

/// Nesting limit, so a form that references itself cannot loop forever.
const MAX_FORM_DEPTH: usize = 8;

/// Execute a form XObject's content stream in the current coordinate system.
fn run_form(
    doc: &Document,
    resources: Option<&Dictionary>,
    parent_fonts: &HashMap<String, Font>,
    name: &[u8],
    ctm: Matrix,
    depth: usize,
    items: &mut Vec<TextItem>,
) {
    if depth >= MAX_FORM_DEPTH {
        return;
    }
    let Some(resources) = resources else {
        return;
    };
    let Some(stream) = resources
        .get(b"XObject")
        .ok()
        .and_then(|o| resolve(doc, o))
        .and_then(|o| o.as_dict().ok())
        .and_then(|xobjects| xobjects.get(name).ok())
        .and_then(|o| resolve(doc, o))
        .and_then(|o| o.as_stream().ok())
    else {
        return;
    };

    let is_form = stream
        .dict
        .get(b"Subtype")
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|subtype| subtype == b"Form")
        .unwrap_or(false);
    if !is_form {
        // An image XObject carries no text
        return;
    }

    let Some(content) = crate::stream::stream_bytes(stream) else {
        return;
    };

    // The form's /Matrix maps form space into the space of the caller
    let mut form_ctm = ctm;
    if let Some(matrix) = stream
        .dict
        .get(b"Matrix")
        .ok()
        .and_then(|o| resolve(doc, o))
        .and_then(|o| o.as_array().ok())
    {
        if matrix.len() >= 6 {
            let m = Matrix {
                a: num(&matrix[0]),
                b: num(&matrix[1]),
                c: num(&matrix[2]),
                d: num(&matrix[3]),
                e: num(&matrix[4]),
                f: num(&matrix[5]),
            };
            form_ctm = m.mul(ctm);
        }
    }

    // A form may bring its own resources; otherwise it inherits the caller's
    let own_resources = stream
        .dict
        .get(b"Resources")
        .ok()
        .and_then(|o| resolve(doc, o))
        .and_then(|o| o.as_dict().ok());

    match own_resources {
        Some(own) => {
            let own_fonts = load_fonts(doc, Some(own));
            // Fall back to the caller's fonts when the form declares none
            let fonts: &HashMap<String, Font> = if own_fonts.is_empty() {
                parent_fonts
            } else {
                &own_fonts
            };
            run_content(doc, &content, Some(own), fonts, form_ctm, depth + 1, items);
        }
        None => run_content(
            doc,
            &content,
            Some(resources),
            parent_fonts,
            form_ctm,
            depth + 1,
            items,
        ),
    }
}

/// Interpret one content stream, emitting a text item per show-text operator.
fn run_content(
    doc: &Document,
    content: &[u8],
    resources: Option<&Dictionary>,
    fonts: &HashMap<String, Font>,
    initial_ctm: Matrix,
    depth: usize,
    items: &mut Vec<TextItem>,
) {
    let mut ctm = initial_ctm;
    let mut ctm_stack: Vec<Matrix> = Vec::new();
    let mut state = TextState::new();

    Lexer::new(content).run(|operator, operands| {
        match operator {
            b"q" => ctm_stack.push(ctm),
            b"Q" => ctm = ctm_stack.pop().unwrap_or(Matrix::IDENTITY),
            b"cm" if operands.len() >= 6 => {
                let m = Matrix {
                    a: operands[0].as_number(),
                    b: operands[1].as_number(),
                    c: operands[2].as_number(),
                    d: operands[3].as_number(),
                    e: operands[4].as_number(),
                    f: operands[5].as_number(),
                };
                ctm = m.mul(ctm);
            }
            b"BT" => {
                state.text_matrix = Matrix::IDENTITY;
                state.line_matrix = Matrix::IDENTITY;
            }
            b"Tf" if operands.len() >= 2 => {
                if let Operand::Name(name) = &operands[0] {
                    state.font = Some(String::from_utf8_lossy(name).to_string());
                }
                state.font_size = operands[1].as_number();
            }
            b"Td" if operands.len() >= 2 => {
                state.line_matrix =
                    Matrix::translate(operands[0].as_number(), operands[1].as_number())
                        .mul(state.line_matrix);
                state.text_matrix = state.line_matrix;
            }
            b"TD" if operands.len() >= 2 => {
                state.leading = -operands[1].as_number();
                state.line_matrix =
                    Matrix::translate(operands[0].as_number(), operands[1].as_number())
                        .mul(state.line_matrix);
                state.text_matrix = state.line_matrix;
            }
            b"Tm" if operands.len() >= 6 => {
                state.line_matrix = Matrix {
                    a: operands[0].as_number(),
                    b: operands[1].as_number(),
                    c: operands[2].as_number(),
                    d: operands[3].as_number(),
                    e: operands[4].as_number(),
                    f: operands[5].as_number(),
                };
                state.text_matrix = state.line_matrix;
            }
            b"T*" => {
                state.line_matrix =
                    Matrix::translate(0.0, -state.leading).mul(state.line_matrix);
                state.text_matrix = state.line_matrix;
            }
            b"TL" if !operands.is_empty() => state.leading = operands[0].as_number(),
            b"Tc" if !operands.is_empty() => state.char_spacing = operands[0].as_number(),
            b"Tw" if !operands.is_empty() => state.word_spacing = operands[0].as_number(),
            b"Tz" if !operands.is_empty() => {
                state.horizontal_scale = operands[0].as_number() / 100.0
            }
            b"Ts" if !operands.is_empty() => state.rise = operands[0].as_number(),
            b"Tj" | b"'" | b"\"" => {
                // ' and " advance to the next line before showing text
                if operator != b"Tj" {
                    if operator == b"\"" && operands.len() >= 2 {
                        state.word_spacing = operands[0].as_number();
                        state.char_spacing = operands[1].as_number();
                    }
                    state.line_matrix =
                        Matrix::translate(0.0, -state.leading).mul(state.line_matrix);
                    state.text_matrix = state.line_matrix;
                }
                if let Some(Operand::Text(bytes)) = operands.last() {
                    show_text(bytes, &mut state, fonts, ctm, items);
                }
            }
            b"TJ" if !operands.is_empty() => {
                if let Operand::Array(elements) = &operands[0] {
                    for element in elements {
                        match element {
                            Operand::Text(bytes) => {
                                show_text(bytes, &mut state, fonts, ctm, items)
                            }
                            other => {
                                // A number is a position adjustment in
                                // thousandths of text space
                                let adjust = -other.as_number() / 1000.0
                                    * state.font_size
                                    * state.horizontal_scale;
                                state.text_matrix = Matrix::translate(adjust, 0.0)
                                    .mul(state.text_matrix);
                            }
                        }
                    }
                }
            }
            // A form XObject holds its own content stream. Resume templates
            // built in design tools routinely put whole sections inside one, so
            // skipping them silently loses that text.
            b"Do" if !operands.is_empty() => {
                if let Operand::Name(name) = &operands[0] {
                    run_form(doc, resources, fonts, name, ctm, depth, items);
                }
            }
            _ => {}
        }
    });
}

fn show_text(
    bytes: &[u8],
    state: &mut TextState,
    fonts: &HashMap<String, Font>,
    ctm: Matrix,
    items: &mut Vec<TextItem>,
) {
    let font = state.font.as_ref().and_then(|name| fonts.get(name));

    // The rendering matrix places the glyphs on the page
    let scale = Matrix {
        a: state.font_size * state.horizontal_scale,
        b: 0.0,
        c: 0.0,
        d: state.font_size,
        e: 0.0,
        f: state.rise,
    };
    let render = scale.mul(state.text_matrix).mul(ctm);
    let combined = state.text_matrix.mul(ctm);

    let codes: Vec<u32> = match font {
        Some(font) if font.two_byte => bytes
            .chunks(2)
            .map(|c| ((c[0] as u32) << 8) | c.get(1).copied().unwrap_or(0) as u32)
            .collect(),
        _ => bytes.iter().map(|b| *b as u32).collect(),
    };

    let mut text = String::new();
    let mut advance = 0.0;
    for code in &codes {
        let (glyph, width) = match font {
            Some(font) => (font.decode(*code), font.width(*code)),
            None => (
                char::from_u32(*code).filter(|_| *code >= 32).map(|c| c.to_string()).unwrap_or_default(),
                0.5,
            ),
        };
        text.push_str(&glyph);

        let is_single_byte_space = *code == 32 && font.map(|f| !f.two_byte).unwrap_or(true);
        let word = if is_single_byte_space { state.word_spacing } else { 0.0 };
        advance += (width * state.font_size + state.char_spacing + word)
            * state.horizontal_scale;
    }

    if !text.trim().is_empty() {
        items.push(TextItem {
            text,
            x: render.e,
            y: render.f,
            width: advance * combined.x_scale(),
            height: render.d.abs(),
            font_name: font.map(|f| f.base_name.clone()).unwrap_or_default(),
            has_eol: false,
        });
    }

    state.text_matrix = Matrix::translate(advance, 0.0).mul(state.text_matrix);
}
