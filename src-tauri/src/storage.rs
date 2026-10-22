use fs2::FileExt;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn data_dir() -> Result<PathBuf> {
    let root = std::env::var_os("APPDATA")
        .ok_or("Font Hive currently supports Windows; APPDATA is unavailable")?;
    Ok(PathBuf::from(root).join("font-hive"))
}

pub fn lock_data(root: &Path) -> Result<File> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    // Electron does not honor this lock. Refuse a running legacy installation.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq Font Hive.exe", "/FO", "CSV", "/NH"])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;
        if String::from_utf8_lossy(&output.stdout)
            .to_lowercase()
            .contains("font hive.exe")
        {
            return Err(
                "Close the Electron version of Font Hive before opening the Tauri version".into(),
            );
        }
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(".tauri.lock"))
        .map_err(|e| e.to_string())?;
    file.try_lock_exclusive()
        .map_err(|_| "Another Font Hive instance is using this library".to_string())?;
    Ok(file)
}

pub fn read_json(path: &Path, fallback: Value) -> Result<Value> {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
            Ok(value) => Ok(value),
            Err(_) => {
                fs::rename(path, path.with_extension(format!("json.corrupt-{}", now())))
                    .map_err(|e| e.to_string())?;
                Ok(fallback)
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(fallback),
        Err(e) => Err(e.to_string()),
    }
}

pub fn write_json(path: &Path, value: &Value) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    #[cfg(not(windows))]
    fs::rename(tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn open_library(root: &Path) -> Result<Value> {
    // Fixed names make this a once-only backup, never an overwrite of the original.
    for name in ["library.json", "activated.json"] {
        let source = root.join(name);
        let backup = root.join(format!("{name}.pre-tauri"));
        if source.exists() && !backup.exists() {
            let mut out = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&backup)
                .map_err(|e| e.to_string())?;
            let copied = (|| -> std::io::Result<()> {
                std::io::copy(&mut File::open(source)?, &mut out)?;
                out.sync_all()
            })();
            drop(out);
            if let Err(error) = copied {
                let _ = fs::remove_file(&backup);
                return Err(error.to_string());
            }
        }
    }
    let mut state = read_json(&root.join("library.json"), json!({}))?;
    if !state.is_object() {
        return Err("Library must be a JSON object".into());
    }
    for key in ["fonts", "collections", "pairs", "folders"] {
        if state[key].is_null() {
            state[key] = json!([]);
        }
        if !state[key].is_array() {
            return Err(format!("Invalid library field: {key}"));
        }
    }
    if !state["settings"].is_object() {
        state["settings"] = json!({});
    }
    let defaults =
        json!({"previewText":"", "previewSize":34, "gridColumns":3, "autoDownloadOnPreview":false});
    for (key, value) in defaults.as_object().unwrap() {
        if state["settings"][key].is_null() {
            state["settings"][key] = value.clone();
        }
    }
    state["settings"]["cacheDir"] = json!(root.join("font-cache"));
    state["settings"]["fontStoreDir"] = json!(root.join("font-store"));
    if !state["providerMeta"].is_object() {
        state["providerMeta"] = json!({});
    }
    // Keep v4 IDs and user metadata; rescan derived fields without deleting records.
    Ok(state)
}

pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
pub fn under(path: &Path, root: &Path) -> bool {
    let norm = |p: &Path| {
        p.to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    let p = norm(path);
    let r = norm(root);
    p == r || p.starts_with(&(r + "\\"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn root_boundaries() {
        assert!(under(Path::new("C:/Fonts/A.ttf"), Path::new("c:/fonts")));
        assert!(!under(
            Path::new("C:/Fonts-other/A.ttf"),
            Path::new("c:/fonts")
        ));
    }
    #[test]
    fn legacy_data_survives() {
        let root =
            std::env::temp_dir().join(format!("fonthive-test-{}-{}", std::process::id(), now()));
        fs::create_dir_all(&root).unwrap();
        let original = "\u{feff}{\"schemaVersion\":4,\"fonts\":[{\"id\":\"local:example\",\"favorite\":true}],\"collections\":[{\"id\":\"saved\"}]}";
        fs::write(root.join("library.json"), original).unwrap();
        let state = open_library(&root).unwrap();
        assert_eq!(state["fonts"][0]["favorite"], true);
        assert_eq!(state["collections"][0]["id"], "saved");
        write_json(&root.join("library.json"), &state).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("library.json.pre-tauri")).unwrap(),
            original
        );
        fs::remove_dir_all(root).unwrap();
    }
}
