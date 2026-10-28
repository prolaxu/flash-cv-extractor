# flash-cv-pdf-core

A PDF text extraction engine in Rust, compiled to WebAssembly. It is a drop-in
replacement for the pdfjs reader in the javascript side: it produces the same
positioned text items, so the extraction heuristics are unchanged.

It exists because the heuristics need two things from the engine that most text
extractors do not give you, and that pdfjs makes expensive:

- the **real font name** (`CMBX12`, `Calibri-Bold`), which is how bold is
  detected. pdfjs only exposes a loaded alias such as `g_d1_f1`, and resolving
  it to the real name requires `getOperatorList()`, a full operator pass that
  measured at 25-50% of total parse time. This engine reads `/BaseFont`
  straight out of the font dictionary.
- per-item **geometry** (x, y, width, height), used for line grouping, column
  detection and for finding the name as the largest text on the page.

## Building

```bash
# wasm (what the javascript side loads)
cargo build --release --target wasm32-unknown-unknown --lib

# native, for debugging
cargo build --release --bin dump
./target/release/dump resume.pdf | jq
```

The wasm artifact lands at
`target/wasm32-unknown-unknown/release/resume_pdf_core.wasm`, around 570 KB.

Tests run in the dev profile only: the release profile sets `panic = "abort"`,
which the test harness cannot use.

```bash
cargo test
```

## Interface

No wasm-bindgen and no javascript glue: the module exports a plain C ABI and
has **no imports at all**, so it loads with a bare
`WebAssembly.instantiate(module, {})` and can be served from a CDN.

```
alloc(len) -> ptr          reserve a buffer for the pdf bytes
extract(ptr, len) -> ptr   parse, returns a pointer to a json blob
result_len() -> len        byte length of the last result
dealloc(ptr, len)          release a buffer
```

The json is `{ "pages": [ { "width": f64, "items": [ ... ] } ] }`, or
`{ "error": "..." }` if the document could not be read.

## Layout

| file | role |
| --- | --- |
| `src/lib.rs` | C ABI, entry point |
| `src/json.rs` | json serialization |
| `src/geometry.rs` | the affine matrix pdf uses |
| `src/items.rs` | emitted items, run merging, line flags |
| `src/lexer.rs` | streaming content stream lexer |
| `src/content.rs` | text matrix interpreter, form XObject recursion |
| `src/font.rs` | font names, glyph widths, ToUnicode/encoding decoding |

`lopdf` supplies the object, xref and stream-filter layer. The content stream
is **not** parsed with lopdf's `Content` API: that allocates an owned `String`
and a `Vec<Object>` per operator, and a design-heavy resume page is mostly
vector graphics. Lexing the bytes directly and keeping operands on a reusable
stack cut one test document from 28.8 ms to 11.4 ms.

## What it handles

- xref tables and xref streams, object streams, stream filters (via `lopdf`)
- simple fonts (`/FirstChar` + `/Widths`) and CID fonts (`/W`, `/DW`)
- ToUnicode CMaps (`bfchar`, `bfrange`, both the contiguous and array forms),
  and `/Encoding` `/Differences`
- the text operators: `BT ET Tf Td TD Tm T* TL Tc Tw Tz Ts Tj TJ ' "`, plus
  `q Q cm` for the graphics state
- **form XObjects**, recursed through `Do`. Design tools routinely put whole
  resume sections inside one; skipping them loses that text silently.
- inline images, skipped wholesale so their binary payload is never lexed

## Stream reading

`lopdf`'s `decompressed_content` treats a missing `/Filter` key as an error
rather than as "there is nothing to decode". Some generators store ToUnicode
CMaps and content streams uncompressed, and swallowing that error loses *all*
of their text: a 2484-pdf corpus extracted nothing at all until
`stream::stream_bytes` started falling back to the raw bytes. Page content is
read through `stream::page_content` for the same reason, instead of
`Document::get_page_content`.

## Known gaps

Measured against pdfjs on real resumes, the two engines agree on every field
extracted from the sample set. These are the places where this engine is
knowingly thinner than pdfjs:

- **Encrypted pdfs** are not decrypted.
- **Type3 fonts** (glyphs drawn as content streams) have no width data.
- **Vertical writing mode** is not implemented.
- A font with **no ToUnicode CMap and a non-standard built-in encoding** falls
  back to treating codes as Latin-1. The embedded font program is not parsed,
  so a font that relies on its internal encoding can decode wrongly. pdfjs
  carries far more accumulated handling here.
- Randomness is stubbed out and returns an error. `lopdf` only draws random
  bytes when *writing* an encrypted pdf, which this crate never does; the stub
  is what keeps the wasm module free of javascript imports.
