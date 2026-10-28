//! Print the extracted text items for a pdf, for debugging the engine.
use std::io::Read;

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: dump <file.pdf>");
        std::process::exit(2);
    };
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .expect("open pdf")
        .read_to_end(&mut bytes)
        .expect("read pdf");
    println!("{}", flash_cv_pdf_core::extract_json(&bytes));
}
