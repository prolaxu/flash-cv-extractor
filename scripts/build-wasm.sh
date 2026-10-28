#!/usr/bin/env bash
# Build the Rust pdf engine to WebAssembly and copy it next to the js bundle.
#
# Runs from the workspace root so that .cargo/config.toml applies: getrandom
# needs an explicit backend for wasm32, and cargo only reads that config from
# the working directory upwards.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "building pdf engine -> wasm"
cargo build --release --target wasm32-unknown-unknown --lib -p flash-cv-pdf-core

mkdir -p dist
cp target/wasm32-unknown-unknown/release/flash_cv_pdf_core.wasm \
   dist/flash-cv-pdf-core.wasm

echo "wrote dist/flash-cv-pdf-core.wasm ($(du -h dist/flash-cv-pdf-core.wasm | cut -f1))"
