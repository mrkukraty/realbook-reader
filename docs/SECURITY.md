# Security model

## Data handling

- All data is local. The app does not upload books or telemetry.
- Book files are untrusted input. Format parsers run in the renderer; markup (EPUB, HTML, Markdown, FB2, DOCX, RTF output) is sanitized with DOMPurify before display (no scripts, event handlers or active content), and internal links are rewritten.

## Desktop (Tauri) hardening

- CSP (`src-tauri/tauri.conf.json`): `default-src 'self'; img-src 'self' blob: data: asset:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'`. No remote origins.
- Capabilities (`src-tauri/capabilities/default.json`): `core:default` and `dialog:allow-open` only. The `fs` plugin is not installed and there is no filesystem scope.
- File access is limited to custom Rust commands:
  - Reads/writes only under `%APPDATA%\RealBook Reader\`.
  - Book ids must match `[A-Za-z0-9_-]{1,128}`, which prevents path traversal (unit-tested in Rust).
  - `read_picked_file` only reads paths that the native open dialog returned in this session.
  - `library.json` is written atomically (temp file + rename) and only if it is valid JSON.

## Known limits

- `style-src 'unsafe-inline'` is required by React inline styles and book styles; scripts remain restricted.
- Sanitization is only as strong as DOMPurify; keep dependencies updated (`npm audit`).
- The browser build relies on browser origin isolation; anyone with access to the user profile can read IndexedDB.
