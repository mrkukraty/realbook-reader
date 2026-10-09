# Architecture

## Layers

```
UI (React pages/features) -> stores (zustand) -> StorageAdapter -> BrowserStorage (IndexedDB) | DesktopStorage (Tauri)
                          -> format adapters (src/formats) -> BookDocument (reflow | fixed)
                          -> reader engine -> PageFlipEngine
```

## Storage

`StorageAdapter` defines books, progress, bookmarks, highlights, collections, `usage()` and `subscribe()`.

- `BrowserStorage`: IndexedDB through Dexie; book bytes stored as Blobs.
- `DesktopStorage` (`src/storage/DesktopStorage.ts`): library metadata, progress, bookmarks, highlights, collections and small cover thumbnails (base64) live in one `library.json`, cached in memory after the first load. Mutations that are not user-critical (progress, annotations) are debounced (400 ms) and flushed on `beforeunload`/`pagehide`/hidden. Adding or removing a book writes immediately. Book bytes are separate files `books/<id>.bin`. Writes are serialized and atomic (Rust writes a temp file, fsyncs, renames).

## Rust commands (src-tauri/src/lib.rs)

| Command | Purpose |
| --- | --- |
| `storage_read_json` / `storage_write_json` | library document (JSON validated before write) |
| `book_file_write` / `book_file_read` / `book_file_delete` | book bytes; id validated to `[A-Za-z0-9_-]{1,128}` |
| `storage_usage` | app-data size and free disk space |
| `open_data_dir` | reveal data folder |
| `pick_book_files` / `read_picked_file` | native multi-select dialog; only dialog-selected paths can be read |

JS helpers: `src/storage/desktop/native.ts` (`isTauri`, `pickBooksNative`, `openDataDir`).

## Format adapters

Each adapter produces a `ReflowDocument` (sanitized HTML sections + TOC) or a `FixedDocument` (`renderPage` into a host element, abortable). See `src/formats/types.ts`.

## PageFlipEngine and why a custom CSS 3D engine

The reader talks to a `PageFlipEngine` interface so the animation implementation can be swapped. The shipped engine is custom CSS 3D transforms instead of StPageFlip because: pages are produced lazily and asynchronously (PDF canvas, reflowed DOM columns) and need cancellation; content height varies; the engine must integrate with our own gesture, keyboard and reduced-motion handling; and we avoid adding a dependency whose rendering model (pre-sized static pages) does not match the reader.

## PWA

`vite-plugin-pwa` (generateSW, autoUpdate) precaches built assets including the pdf.js worker and wasm, with `index.html` as navigation fallback. `registerPWA()` (`src/app/pwa.ts`) registers it and does nothing in Tauri.
