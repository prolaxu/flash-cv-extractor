//! Reading a stream's bytes, whether or not it is compressed.

use lopdf::{Document, Object, Stream};

/// Decode a stream's bytes, tolerating a stream that has no filter.
///
/// lopdf's `decompressed_content` reports a missing `/Filter` key as an error
/// rather than as "there is nothing to decode". Plenty of real pdfs store
/// ToUnicode CMaps and short content streams uncompressed, so treating that
/// error as fatal silently loses all of their text.
pub fn stream_bytes(stream: &Stream) -> Option<Vec<u8>> {
    if stream.dict.get(b"Filter").is_ok() {
        stream.decompressed_content().ok()
    } else {
        Some(stream.content.clone())
    }
}

/// Concatenate a page's content streams.
///
/// `/Contents` may be a single stream or an array of them, and the parts have
/// to be joined with whitespace: a token may end at one boundary and the next
/// operator begin in the following stream.
pub fn page_content(doc: &Document, page_id: lopdf::ObjectId) -> Vec<u8> {
    let Ok(dict) = doc.get_dictionary(page_id) else {
        return Vec::new();
    };
    let Ok(contents) = dict.get(b"Contents") else {
        return Vec::new();
    };

    let mut parts: Vec<Vec<u8>> = Vec::new();
    collect(doc, contents, &mut parts, 0);
    parts.join(&b'\n')
}

fn collect(doc: &Document, object: &Object, parts: &mut Vec<Vec<u8>>, depth: usize) {
    if depth > 8 {
        return;
    }
    match object {
        Object::Reference(id) => {
            if let Ok(resolved) = doc.get_object(*id) {
                collect(doc, resolved, parts, depth + 1);
            }
        }
        Object::Array(items) => {
            for item in items {
                collect(doc, item, parts, depth + 1);
            }
        }
        Object::Stream(stream) => {
            if let Some(bytes) = stream_bytes(stream) {
                parts.push(bytes);
            }
        }
        _ => {}
    }
}
