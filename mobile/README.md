# RealBook Reader — mobile (Android + iOS)

Expo (SDK 57, React Native 0.86, New Architecture) version of RealBook Reader: a local library plus a reader that
feels like a physical book: cream paper, a shaded spine/gutter, page-thickness edges, a 3D page turn in both
directions, six themes and typography controls. Bookmarks, contents, in-book search, highlights and notes. One page on
phones, a two-page spread on tablets and in landscape.

This folder is self-contained (its own `package.json` / `node_modules`). It does not import anything from the web app in
`../src`. Logic and types were copied from there and adapted for React Native, which has no DOM.

## Install

```bash
cd mobile
npm install
```

Node 20+ is required. The repo was developed with Node 24 and npm 11 on Windows.

## Run in development

```bash
npx expo start            # Metro dev server; scan the QR code
```

* **Expo Go** (quickest): install Expo Go for SDK 57 from the Play Store or App Store, then scan the QR code.
  All native modules used here are in Expo Go: expo-sqlite, expo-file-system, expo-document-picker, expo-crypto,
  react-native-webview, reanimated, gesture-handler, expo-linear-gradient, expo-clipboard. The PDF engine is pdf.js
  running inside a WebView, so PDFs also work in Expo Go.
* **Development build** (recommended for performance testing, and required if you add custom native code):
  `npx eas-cli@latest build --profile development --platform android`. Install the APK, then run `npx expo start`.
  `expo-dev-client` is already installed.
* Android emulator / iOS simulator: `npx expo start` and press `a` / `i`. A simulator needs Android Studio, or Xcode
  on a Mac.

## Build installable apps with EAS (cloud)

First, log in and link the project yourself. These steps are interactive and were **not** run here:

```bash
npx eas-cli@latest login
npx eas-cli@latest init            # writes extra.eas.projectId into app.json
```

Then:

| Goal | Command | Output |
|---|---|---|
| Android test APK (sideload / share) | `npx eas-cli@latest build --profile preview --platform android` | `.apk` |
| Android store bundle | `npx eas-cli@latest build --profile production --platform android` | `.aab` |
| iOS (TestFlight / App Store) | `npx eas-cli@latest build --profile production --platform ios` | `.ipa` |
| Dev client | `npx eas-cli@latest build --profile development --platform android\|ios` | dev build |

Profiles live in `eas.json`:
* `development`: dev client, internal distribution, Android APK.
* `preview`: internal distribution, Android **APK**.
* `production`: Android **AAB**, iOS store build. Build numbers auto-increment, and versions are stored remotely.

App identifiers: `com.realbook.reader` (Android `package`, iOS `bundleIdentifier`).

### Windows notes
* You cannot build or sign for iOS locally on Windows. Use EAS cloud builds (`--platform ios`); this needs a paid
  Apple Developer account. Alternatively, build on a Mac.
* Android builds work in EAS cloud from Windows. A local `npx expo run:android` build needs Android Studio and the
  Android SDK.
* This machine has little RAM. Do not run Jest and Metro at the same time, and stop Metro (`Ctrl+C`) when you are done.

## Scripts

| Script | What it does |
|---|---|
| `npm start` | `expo start` |
| `npm test` | Jest (jest-expo preset) unit tests in `__tests__/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run doctor` | `npx expo-doctor` |
| `npm run export:android` | bundles the JS for Android into `dist-check/` (a CI-style bundling check) |
| `npm run vendor:pdfjs` | regenerates `src/vendor/pdfjs.generated.ts` from the `pdfjs-dist@3.11.174` devDependency |
| `node scripts/gen-icons.mjs` | regenerates the icon, adaptive icon, splash and favicon PNGs (no dependencies) |

## Supported formats

| Format | Status | How it is rendered | Notes |
|---|---|---|---|
| EPUB 2/3 | Supported | Sanitized HTML in a WebView, CSS-column pagination | TOC (nav/NCX), images, internal links, cover. **DRM-protected EPUBs are refused**; nothing is bypassed. |
| PDF | Supported | pdf.js (bundled, offline) in a hidden WebView renders pages to JPEG; shown as native images | Outline becomes the TOC. Text search works when the PDF has a text layer. No text selection or highlights. Password-protected PDFs are refused with an explanation. |
| TXT | Supported | WebView | Encoding detection (UTF-8/16, BOM, Latin-1 fallback), chapter detection, Gutenberg header parsing. |
| Markdown | Supported | WebView | `marked` (GFM). Front matter title and author are read. Remote images are dropped. |
| HTML / XHTML | Supported | WebView | Sanitized. Scripts, styles, iframes and remote images are removed. |
| FB2 / FB2.ZIP | Supported | WebView | Embedded images, notes, nested sections. |
| DOCX | Partial | WebView | Text, headings, bold/italic and lists only. No tables, images or footnotes. |
| RTF | Supported | WebView | Text, bold/italic, heading heuristics. |
| CBZ | Supported | ZIP of images; pages are extracted lazily to the cache and shown as native images | Natural page order and ComicInfo.xml. |
| CBR | **Not supported** | — | Needs a RAR engine. Convert to CBZ with 7-Zip or Calibre. |
| MOBI / AZW / AZW3 / KFX | **Not supported** | — | Convert DRM-free files to EPUB with Calibre. DRM is never bypassed. |
| DjVu | **Not supported** | — | Convert with DjVuLibre (`ddjvu -format=pdf`) or Calibre. |

Each import is checked by its content (magic bytes) first and its extension second. A damaged or misnamed file gets a
friendly error. Duplicates are detected by SHA-256 hash (expo-crypto). When several files are imported together, one
failure never stops the others, and the summary lists each result. Everything stays on the device: books are copied
into the app's documents directory, and nothing is uploaded. The only network-capable action is opening an external
link from a book, and the app asks before doing that.

## Architecture

```
src/app/            expo-router screens: index (Library), book/[id] (details + metadata edit), reader/[id], settings
src/formats/        DOM-free format parsers (htmlparser2 + allow-list sanitizer, jszip, marked) -> sections + TOC
src/import/         import orchestration (validation, hash duplicate check, per-file error isolation); injectable deps
src/storage/        types compatible with the web StorageAdapter, SQLite repo (expo-sqlite), in-memory repo, pure library logic
src/platform/       expo-file-system storage layout, SHA-256
src/state/          zustand stores (library, settings)
src/reader/         FlipBook (Reanimated page turn), PageSurface (WebView page), ImageSurface, PdfRenderer (pdf.js),
                    page-html (CSS columns + bridge), spread / navigation / progress / flip-math (pure, unit-tested)
src/settings/       settings types (same shape as the web app), themes, performance profiles
```

**Reflowable books.** At import, the book is parsed once into sanitized HTML sections stored as files. Each visible page
is a `react-native-webview` that loads one section with a nonce-based CSP: only our bridge script may run, and only
`data:` images load. CSS columns paginate the section, and the WebView shows one column. Moving within a section is an
injected `RB.go(...)` call, with no reload. The bridge reports page counts and positions, link taps, text selection
(as character offsets for highlights), taps and horizontal drags. Text stays real text, so it is selectable and
links work.

**Page turn.** `FlipBook` keeps two sets of page surfaces: the current view and its neighbour, which is preloaded in
the direction of travel. A turn rotates the surface containers themselves around the spine (`rotateY` with
`perspective`; on two-page spreads, two half-turns of 90°). It adds leaf shading, an optional specular strip and a
cast shadow on the page underneath. Turns follow your finger and finish with a flick or snap-back. Tapping the
left or right 30% of the page turns it, and tapping the middle shows or hides the controls. At the end of a turn, the
two sets swap roles inside one UI-thread worklet, so nothing reloads. **Lightweight** mode keeps only one page view
in memory and uses a quick crossfade. Turning off "Page-turn animation" or enabling the system's **Reduce Motion**
setting changes pages instantly. Animation speed and shadow strength are adjustable.

**Persistence.** SQLite (`realbook.db`) stores books, progress, bookmarks, highlights with notes, collections and
settings. Progress is saved as a section plus a fraction within it, and overall progress is weighted by text length,
so it survives font or layout changes. Fixed-layout books store a page index.

## Limitations (honest list)

* **Nothing has been run on a real device or simulator.** The page-turn feel, WebView pagination accuracy, gesture
  conflicts between WebView text selection and swipes, and memory use on low-end phones are untested. See
  "Verification status".
* With balanced and high-quality modes, a two-page spread keeps 4 WebViews alive (2 on phones). Use **Lightweight**
  on old devices.
* Swipes on reflowable pages are forwarded from the WebView over the JS bridge, so drag-follow may lag slightly
  compared with PDF and comic pages, which use native gestures.
* Highlights are stored as character offsets within a section. If a book is re-imported, its offsets may not match.
* PDF pages are raster images: no text selection or highlights, and zoom is not implemented. Large PDFs (over
  120 MB) and comics (over 150 MB) are refused because files are processed in JS memory.
* DOCX support is basic. Fonts are system fonts; no web fonts are downloaded.
* MOBI, AZW, CBR and DjVu are not supported (see above). DRM is never bypassed.

## Verification status

See the final section of the task report or run the checks yourself:

```bash
npx tsc --noEmit
npx jest --runInBand
npx expo-doctor
npx expo export --platform android --output-dir dist-check
npx expo export --platform ios --output-dir dist-check
```

Verified on Windows, without a device: TypeScript compiles, unit tests pass (format parsing with fixtures, storage and
import logic, spread, navigation and progress math, page HTML/CSP), `expo-doctor` runs, and both platform JS bundles
build. **Not verified:** any behaviour at runtime on Android or iOS (rendering, animation, gestures, WebView
pagination, PDF rendering, file picking and SQLite on a device).
