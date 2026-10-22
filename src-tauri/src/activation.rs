use crate::{
    fonts,
    storage::{self, text, Result},
};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[cfg(windows)]
const FONT_KEY: &str = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";

// Registry paths normally contain backslashes; PathBuf::join can retain forward
// slashes from our directory constants. Windows treats both as the same path.
fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

pub fn safe_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn font_dir() -> Result<PathBuf> {
    Ok(
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("Microsoft/Windows/Fonts"),
    )
}

fn registry_name(font: &Value) -> String {
    format!(
        "{} {}",
        text(font, "fullName"),
        if text(font, "format") == "otf" {
            "(OpenType)"
        } else {
            "(TrueType)"
        }
    )
}

pub fn reconcile(map: &mut Value) -> Result<()> {
    let entries = map.as_object_mut().ok_or("Invalid activated.json")?;
    #[cfg(windows)]
    let registered = {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        match RegKey::predef(HKEY_CURRENT_USER).open_subkey(FONT_KEY) {
            Ok(key) => {
                let mut paths = Vec::new();
                for entry in key.enum_values() {
                    let (name, raw) = entry.map_err(|e| e.to_string())?;
                    if !matches!(
                        raw.vtype,
                        winreg::enums::REG_SZ | winreg::enums::REG_EXPAND_SZ
                    ) {
                        continue;
                    }
                    let value: String = key.get_value(&name).map_err(|e| e.to_string())?;
                    paths.push(path_key(Path::new(&value)));
                }
                paths
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(e) => return Err(e.to_string()),
        }
    };
    entries.retain(|_, v| {
        v.as_str().is_some_and(|p| {
            if !Path::new(p).exists() {
                return false;
            }
            #[cfg(windows)]
            {
                registered.contains(&path_key(Path::new(p)))
            }
            #[cfg(not(windows))]
            {
                true
            }
        })
    });
    Ok(())
}

#[cfg(windows)]
fn notify(path: &Path, add: bool) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Graphics::Gdi::{AddFontResourceW, RemoveFontResourceW},
        UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_FONTCHANGE,
        },
    };
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        if add {
            AddFontResourceW(wide.as_ptr());
        } else {
            RemoveFontResourceW(wide.as_ptr());
        }
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_FONTCHANGE,
            0,
            0,
            SMTO_ABORTIFHUNG,
            1000,
            std::ptr::null_mut(),
        );
    }
}
#[cfg(not(windows))]
fn notify(_: &Path, _: bool) {}

pub fn activate(root: &Path, map: &mut Value, font: &Value) -> Result<()> {
    let id = text(font, "id");
    if map[id].is_string() {
        return Ok(());
    }
    let source = Path::new(text(font, "filePath"));
    if !source.is_file() {
        return Err("Font file is not available locally".into());
    }
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    // Local webfonts are decoded to installable sfnt; web formats are never
    // registered directly with Windows.
    let decoded = fonts::decode(&bytes)?;
    if ttf_parser::Face::parse(&decoded, 0).is_err() {
        return Err("Font is not installable TrueType/OpenType".into());
    }
    let is_collection = decoded.starts_with(b"ttcf");
    let extension = if is_collection {
        "ttc"
    } else if decoded.starts_with(b"OTTO") {
        "otf"
    } else {
        "ttf"
    };
    let dir = font_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!(
        "{}.{}",
        safe_name(text(font, "postScriptName")),
        extension
    ));
    let existed = dest.exists();
    if existed {
        return Err("A font file already exists at the installation destination; it was not overwritten or adopted".into());
    }
    {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(|e| e.to_string())?;
        if let Err(error) = output.write_all(&decoded).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = fs::remove_file(&dest);
            return Err(error.to_string());
        }
    }
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let registration = (|| -> Result<()> {
            let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(FONT_KEY)
                .map_err(|e| e.to_string())?;
            let name = registry_name(font);
            match key.get_raw_value(&name) {
                Ok(_) => {
                    return Err(
                        "Another registration already uses this font name; it was not replaced"
                            .into(),
                    )
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
            key.set_value(name, &dest.to_string_lossy().as_ref())
                .map_err(|e| e.to_string())
        })();
        if let Err(error) = registration {
            let _ = fs::remove_file(&dest);
            return Err(error);
        }
    }
    map[id] = json!(dest);
    if let Err(error) = storage::write_json(&root.join("activated.json"), map) {
        map.as_object_mut().unwrap().remove(id);
        #[cfg(windows)]
        {
            use winreg::{
                enums::{HKEY_CURRENT_USER, KEY_WRITE},
                RegKey,
            };
            if let Ok(key) =
                RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(FONT_KEY, KEY_WRITE)
            {
                let _ = key.delete_value(registry_name(font));
            }
        }
        let _ = fs::remove_file(&dest);
        return Err(error);
    }
    notify(&dest, true);
    Ok(())
}

pub fn deactivate(root: &Path, map: &mut Value, font: &Value) -> Result<()> {
    let id = text(font, "id");
    let Some(installed) = map[id].as_str().map(PathBuf::from) else {
        return Ok(());
    };
    // Never trust a persisted path to authorize deleting outside the font store.
    if !storage::under(&installed, &font_dir()?) {
        return Err("Installed font path is outside the per-user font store".into());
    }
    let shared = map.as_object().unwrap().iter().any(|(other, path)| {
        other != id
            && path
                .as_str()
                .is_some_and(|p| path_key(Path::new(p)) == path_key(&installed))
    });
    if shared {
        map.as_object_mut().unwrap().remove(id);
        return storage::write_json(&root.join("activated.json"), map);
    }
    notify(&installed, false);
    #[cfg(windows)]
    {
        use winreg::{
            enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE},
            RegKey,
        };
        match RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(FONT_KEY, KEY_READ | KEY_WRITE)
        {
            Ok(key) => {
                let name = registry_name(font);
                if let Ok(value) = key.get_value::<String, _>(&name) {
                    if path_key(Path::new(&value)) != path_key(&installed) {
                        return Err("Font registration changed externally".into());
                    }
                    key.delete_value(name).map_err(|e| e.to_string())?;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    match fs::remove_file(&installed) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            // Roll back registration if an application still has the file locked.
            #[cfg(windows)]
            {
                use winreg::{enums::HKEY_CURRENT_USER, RegKey};
                if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(FONT_KEY) {
                    let _ =
                        key.set_value(registry_name(font), &installed.to_string_lossy().as_ref());
                }
            }
            notify(&installed, true);
            return Err(e.to_string());
        }
    }
    map.as_object_mut().unwrap().remove(id);
    storage::write_json(&root.join("activated.json"), map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_paths_match_mixed_separator_destinations() {
        let registered = Path::new(
            r"C:\Users\Nitish\AppData\Local\Microsoft\Windows\Fonts\AbhayaLibre-Medium.ttf",
        );
        let destination = Path::new(
            r"c:\users\nitish\AppData\Local\Microsoft/Windows/Fonts\AbhayaLibre-Medium.ttf",
        );
        assert_eq!(path_key(registered), path_key(destination));
        assert_ne!(
            path_key(registered),
            path_key(Path::new(r"C:\Other\AbhayaLibre-Medium.ttf"))
        );
    }
}
