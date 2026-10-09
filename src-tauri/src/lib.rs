//! RealBook Reader desktop backend.
//!
//! Security model: the webview gets NO generic filesystem access. All disk access goes through
//! the commands below, which only touch `<data_dir>/RealBook Reader/` (books/<id>.bin and
//! library.json), plus files the user explicitly picked via the native dialog (allow-listed here).

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const APP_DIR: &str = "RealBook Reader";
const LIBRARY_FILE: &str = "library.json";
const BOOKS_DIR: &str = "books";

#[derive(Default)]
struct PickedFiles(Mutex<HashSet<PathBuf>>);

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .data_dir()
        .map_err(|e| format!("Cannot locate the application data directory: {e}"))?;
    let root = base.join(APP_DIR);
    fs::create_dir_all(root.join(BOOKS_DIR))
        .map_err(|e| format!("Cannot create the data folder {}: {e}", root.display()))?;
    Ok(root)
}

/// IDs must be non-empty, <= 128 chars, and only [A-Za-z0-9-_] (uuid / hex). No separators, no dots.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn book_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid book id".into());
    }
    Ok(data_root(app)?.join(BOOKS_DIR).join(format!("{id}.bin")))
}

/// Atomic write: temp file in the same directory, fsync, then rename over the target.
fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = target.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
        f.write_all(bytes).map_err(|e| format!("Write failed (disk full?): {e}"))?;
        f.sync_all().map_err(|e| format!("Flush failed: {e}"))?;
    }
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot finalize {}: {e}", target.display())
    })
}

#[tauri::command]
fn storage_read_json(app: AppHandle) -> Result<Option<String>, String> {
    let p = data_root(&app)?.join(LIBRARY_FILE);
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read the library file: {e}")),
    }
}

#[tauri::command]
fn storage_write_json(app: AppHandle, data: String) -> Result<(), String> {
    // Reject anything that is not valid JSON so a bug can never corrupt the library file.
    serde_json::from_str::<serde_json::Value>(&data).map_err(|e| format!("Refusing to write invalid JSON: {e}"))?;
    atomic_write(&data_root(&app)?.join(LIBRARY_FILE), data.as_bytes())
}

/// Raw binary body = file bytes; the book id is passed in the `x-id` header.
#[tauri::command]
fn book_file_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing book id")?
        .to_string();
    let path = book_path(&app, &id)?;
    match request.body() {
        InvokeBody::Raw(bytes) => atomic_write(&path, bytes),
        _ => Err("Expected a binary body".into()),
    }
}

#[tauri::command]
fn book_file_read(app: AppHandle, id: String) -> Result<Response, String> {
    let path = book_path(&app, &id)?;
    match fs::read(&path) {
        Ok(b) => Ok(Response::new(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err("NOT_FOUND".into()),
        Err(e) => Err(format!("Cannot read the book file: {e}")),
    }
}

#[tauri::command]
fn book_file_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = book_path(&app, &id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Cannot delete the book file: {e}")),
    }
}

#[derive(Serialize)]
struct Usage {
    used: u64,
    free: Option<u64>,
    path: String,
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = fs::read_dir(p) {
        for e in rd.flatten() {
            if let Ok(m) = e.metadata() {
                total += if m.is_dir() { dir_size(&e.path()) } else { m.len() };
            }
        }
    }
    total
}

#[cfg(windows)]
fn free_space(p: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut avail: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    // SAFETY: `wide` is NUL-terminated and the out-pointers are valid for the call.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, &mut total, &mut free) };
    if ok != 0 { Some(avail) } else { None }
}

#[cfg(not(windows))]
fn free_space(_p: &Path) -> Option<u64> {
    None
}

#[tauri::command]
fn storage_usage(app: AppHandle) -> Result<Usage, String> {
    let root = data_root(&app)?;
    Ok(Usage { used: dir_size(&root), free: free_space(&root), path: root.display().to_string() })
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let root = data_root(&app)?;
    #[cfg(windows)]
    let prog = "explorer";
    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let prog = "xdg-open";
    // explorer.exe returns a non-zero exit code even on success, so only spawn errors are reported.
    std::process::Command::new(prog)
        .arg(&root)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Cannot open the data folder: {e}"))
}

#[derive(Serialize)]
struct PickedInfo {
    path: String,
    name: String,
    size: u64,
}

const BOOK_EXTS: &[&str] = &[
    "epub", "pdf", "txt", "html", "htm", "xhtml", "md", "markdown", "fb2", "docx", "rtf", "cbz", "cbr", "mobi", "azw",
    "azw3", "djvu", "djv",
];

/// Native multi-select file dialog. Selected paths are remembered so `read_picked_file` can only
/// ever read files the user chose here.
#[tauri::command]
async fn pick_book_files(app: AppHandle, picked: State<'_, PickedFiles>) -> Result<Vec<PickedInfo>, String> {
    let files = app
        .dialog()
        .file()
        .add_filter("Books", BOOK_EXTS)
        .add_filter("All files", &["*"])
        .blocking_pick_files();
    let mut out = Vec::new();
    if let Some(files) = files {
        let mut set = picked.0.lock().map_err(|_| "Internal lock error".to_string())?;
        for f in files {
            let Ok(path) = f.into_path() else { continue };
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.push(PickedInfo { path: path.display().to_string(), name, size });
            set.insert(path);
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_picked_file(path: String, picked: State<'_, PickedFiles>) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    let allowed = picked.0.lock().map_err(|_| "Internal lock error".to_string())?.contains(&p);
    if !allowed {
        return Err("This file was not selected through the open dialog.".into());
    }
    fs::read(&p).map(Response::new).map_err(|e| format!("Cannot read {}: {e}", p.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PickedFiles::default())
        .invoke_handler(tauri::generate_handler![
            storage_read_json,
            storage_write_json,
            book_file_write,
            book_file_read,
            book_file_delete,
            storage_usage,
            open_data_dir,
            pick_book_files,
            read_picked_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running RealBook Reader");
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn ids_are_validated() {
        assert!(valid_id("3f2a-bc_09"));
        assert!(!valid_id(""));
        assert!(!valid_id("../x"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("a\\b"));
        assert!(!valid_id("a.b"));
    }
}
