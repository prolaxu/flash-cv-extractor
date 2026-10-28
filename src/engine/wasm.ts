import type { TextItems } from "../types";
import type { PdfEngine, PdfSource } from "./types";
import { toReadingOrder } from "../layout/columns";

/** Where to load the wasm engine from. */
export type WasmSource =
  | string
  | URL
  | ArrayBuffer
  | Uint8Array
  | WebAssembly.Module;

/** The C ABI the Rust core exports. No wasm-bindgen, no javascript glue. */
interface CoreExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  extract(ptr: number, len: number): number;
  result_len(): number;
}

interface CorePage {
  width: number;
  items: TextItems;
}

type CoreResult = { pages: CorePage[] } | { error: string };

const isNode =
  typeof process !== "undefined" &&
  Boolean((process as { versions?: { node?: string } }).versions?.node);

const isAbsoluteUrl = (value: string) => /^[a-z]+:\/\//i.test(value);

/** Read any supported source into bytes. */
const readBytes = async (
  source: string | URL | ArrayBuffer | Uint8Array
): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);

  const url = source instanceof URL ? source.href : source;
  // In the browser every path is fetched, including a relative one. Under Node
  // only an absolute url can be fetched; a bare path is read from disk.
  if (typeof fetch === "function" && (!isNode || isAbsoluteUrl(url))) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`failed to fetch ${url}: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  // Assembled at runtime so browser bundlers do not try to resolve node:fs,
  // which they cannot.
  const specifier = "node:" + "fs/promises";
  const { readFile } = (await import(/* @vite-ignore */ specifier)) as {
    readFile: (path: string) => Promise<Uint8Array>;
  };
  return new Uint8Array(await readFile(url));
};

const instantiate = async (source: WasmSource): Promise<CoreExports> => {
  const wasmModule =
    source instanceof WebAssembly.Module
      ? source
      : await WebAssembly.compile(
          (await readBytes(source)) as unknown as BufferSource
        );
  // The module declares no imports, so an empty import object is enough
  const instance = await WebAssembly.instantiate(wasmModule, {});
  return instance.exports as unknown as CoreExports;
};

/**
 * Build a pdf engine backed by the Rust core compiled to wasm.
 *
 * The engine is a single wasm file: no worker to configure and no companion
 * javascript, so it can be served straight from a CDN. The module is compiled
 * once and reused for every document.
 *
 * @example
 * const engine = createWasmEngine("/flash-cv-pdf-core.wasm");
 * const cv = await extractCv(bytes, { engine });
 */
export const createWasmEngine = (source: WasmSource): PdfEngine => {
  let corePromise: Promise<CoreExports> | undefined;

  return async (pdfSource: PdfSource): Promise<TextItems> => {
    const bytes = await readBytes(pdfSource);
    corePromise ??= instantiate(source);
    const core = await corePromise;

    const ptr = core.alloc(bytes.length);
    let json: string;
    try {
      // The buffer is re-read after each call: a growing heap detaches the old
      // one, so a view held across a call can go stale.
      new Uint8Array(core.memory.buffer, ptr, bytes.length).set(bytes);
      const resultPtr = core.extract(ptr, bytes.length);
      const resultLen = core.result_len();
      json = new TextDecoder().decode(
        new Uint8Array(core.memory.buffer, resultPtr, resultLen)
      );
    } finally {
      core.dealloc(ptr, bytes.length);
    }

    const result = JSON.parse(json) as CoreResult;
    if ("error" in result) {
      throw new Error(`flash-cv-extractor: ${result.error}`);
    }

    // Column handling needs the page width, so it happens per page here
    return result.pages.flatMap((page) =>
      toReadingOrder(page.items, page.width)
    );
  };
};
