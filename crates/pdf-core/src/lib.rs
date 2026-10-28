//! PDF text extraction: turns a pdf into positioned text items carrying their
//! real font name, which is what the javascript side needs to recognise
//! headings, columns and emphasis.
//!
//! The wasm build exposes a plain C ABI with **no imports**, so the module
//! loads with a bare `WebAssembly.instantiate(module, {})`. There is no
//! wasm-bindgen and no javascript glue to ship alongside it.
//!
//! ```text
//! alloc(len) -> ptr          reserve a buffer for the pdf bytes
//! extract(ptr, len) -> ptr   parse, returns a pointer to a json blob
//! result_len() -> len        byte length of the last result
//! dealloc(ptr, len)          release a buffer
//! ```

pub mod content;
pub mod font;
pub mod geometry;
pub mod items;
pub mod json;
pub mod lexer;
pub mod stream;

use lopdf::Document;

/// Parse a pdf and return its pages of text items as json.
///
/// Returns `{"error": "..."}` rather than panicking when a document cannot be
/// read, so a malformed upload surfaces as a message instead of a wasm trap.
pub fn extract_json(bytes: &[u8]) -> String {
    match Document::load_mem(bytes) {
        Ok(document) => json::pages_to_json(&content::extract_pages(&document)),
        Err(error) => json::error_to_json(&format!("failed to load pdf: {error}")),
    }
}

// ---------------------------------------------------------------------------
// C ABI
// ---------------------------------------------------------------------------

/// Randomness backend for the wasm build.
///
/// lopdf only draws random bytes when *writing* an encrypted pdf, which this
/// crate never does; reading an encrypted pdf needs no randomness. Refusing
/// here is what keeps the wasm module free of javascript imports, and would
/// surface loudly rather than silently weaken a key if that ever changed.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
unsafe extern "Rust" fn __getrandom_v03_custom(
    _dest: *mut u8,
    _len: usize,
) -> Result<(), getrandom::Error> {
    Err(getrandom::Error::UNSUPPORTED)
}

/// The json produced by the most recent `extract` call, kept alive so the
/// caller can copy it out of wasm memory.
static mut RESULT: Option<String> = None;

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

#[no_mangle]
pub unsafe extern "C" fn extract(ptr: *const u8, len: usize) -> *const u8 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let json = extract_json(bytes);
    let result_ptr = json.as_ptr();
    RESULT = Some(json);
    result_ptr
}

#[no_mangle]
pub unsafe extern "C" fn result_len() -> usize {
    // SAFETY: single-threaded wasm; RESULT is only written by `extract`
    (*std::ptr::addr_of!(RESULT)).as_ref().map_or(0, String::len)
}
