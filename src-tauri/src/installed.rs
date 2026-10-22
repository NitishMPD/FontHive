use crate::{
    fonts,
    storage::{text, Result},
};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::SystemTime,
};

pub fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

#[cfg(windows)]
fn paths() -> Result<Vec<PathBuf>> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
        RegKey,
    };
    let mut paths = Vec::new();
    let system =
        PathBuf::from(std::env::var_os("WINDIR").ok_or("WINDIR is unavailable")?).join("Fonts");
    let user =
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("Microsoft/Windows/Fonts");
    for (hive, base) in [(HKEY_CURRENT_USER, user), (HKEY_LOCAL_MACHINE, system)] {
        let key = match RegKey::predef(hive)
            .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")
        {
            Ok(key) => key,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("Cannot read installed fonts: {e}")),
        };
        for entry in key.enum_values() {
            let (name, raw) = entry.map_err(|e| e.to_string())?;
            let value = if raw.vtype == winreg::enums::REG_EXPAND_SZ {
                key.get_value::<String, _>(&name)
            } else if raw.vtype == winreg::enums::REG_SZ {
                key.get_value::<String, _>(&name)
            } else {
                continue;
            }
            .map_err(|e| e.to_string())?;
            let expanded = regex::Regex::new(r"%([^%]+)%")
                .unwrap()
                .replace_all(&value, |captures: &regex::Captures| {
                    std::env::var(&captures[1]).unwrap_or(captures[0].into())
                })
                .into_owned();
            let path = PathBuf::from(expanded);
            paths.push(if path.is_absolute() {
                path
            } else {
                base.join(path)
            });
        }
    }
    let mut seen = HashSet::new();
    paths.retain(|p| seen.insert(path_key(p)));
    Ok(paths)
}
#[cfg(not(windows))]
fn paths() -> Result<Vec<PathBuf>> {
    Err("Installed-font detection currently supports Windows only".into())
}

#[derive(Default)]
pub struct Inventory {
    pub faces: Vec<Value>,
    pub error: Option<String>,
    cache: HashMap<String, (u64, SystemTime, Vec<Value>)>,
}

impl Inventory {
    pub fn refresh(&mut self) -> Result<()> {
        let result: Result<Vec<Value>> = (|| {
            let mut faces = Vec::new();
            let mut retained = HashSet::new();
            for path in paths()? {
                if !path.exists() {
                    continue;
                }
                if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                    matches!(
                        e.to_ascii_lowercase().as_str(),
                        "ttf" | "otf" | "ttc" | "otc"
                    )
                }) {
                    continue;
                }
                let key = path_key(&path);
                retained.insert(key.clone());
                let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
                let modified = metadata.modified().map_err(|e| e.to_string())?;
                if let Some((size, stamp, parsed)) = self.cache.get(&key) {
                    if *size == metadata.len() && *stamp == modified {
                        faces.extend(parsed.clone());
                        continue;
                    }
                }
                // Re-parse changed files only; every refresh still re-reads registration
                // and metadata, so family installs don't hash the OS library per face.
                let parsed = fonts::parse(&path).map_err(|e| {
                    format!("Cannot inspect installed font {}: {e}", path.display())
                })?;
                self.cache
                    .insert(key, (metadata.len(), modified, parsed.clone()));
                faces.extend(parsed);
            }
            self.cache.retain(|key, _| retained.contains(key));
            Ok(faces)
        })();
        match result {
            Ok(faces) => {
                self.faces = faces;
                self.error = None;
                Ok(())
            }
            Err(error) => {
                self.error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub fn matching(&self, font: &Value) -> Option<&Value> {
        self.faces
            .iter()
            .find(|installed| same_face(font, installed))
    }
    pub fn conflict(&self, font: &Value) -> bool {
        font["parsedIdentity"] == true
            && self.faces.iter().any(|f| {
                text(f, "postScriptName").eq_ignore_ascii_case(text(font, "postScriptName"))
                    && !same_face(font, f)
            })
    }
}

fn same_face(a: &Value, b: &Value) -> bool {
    if a["parsedIdentity"] != true || b["parsedIdentity"] != true {
        return false;
    }
    a["binaryHash"].is_string()
        && a["binaryHash"] == b["binaryHash"]
        && text(a, "postScriptName").eq_ignore_ascii_case(text(b, "postScriptName"))
        && a["faceIndex"] == b["faceIndex"]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_verified_identical_faces_match() {
        let a = json!({"parsedIdentity":true,"binaryHash":"abc","postScriptName":"Example-Regular","faceIndex":0});
        let mut b = a.clone();
        assert!(same_face(&a, &b));
        b["binaryHash"] = json!("different");
        assert!(!same_face(&a, &b));
        b = a.clone();
        b["faceIndex"] = json!(1);
        assert!(!same_face(&a, &b));
        b = a.clone();
        b["parsedIdentity"] = json!(false);
        assert!(!same_face(&a, &b));
        let inventory = Inventory {
            faces: vec![a.clone()],
            ..Inventory::default()
        };
        assert!(inventory.matching(&a).is_some());
        let mut other = a.clone();
        other["binaryHash"] = json!("new-version");
        assert!(inventory.conflict(&other));
        assert_eq!(
            path_key(Path::new("C:/Fonts/Example.ttf")),
            path_key(Path::new("c:\\fonts\\example.ttf"))
        );
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Reads this machine's Windows font registry and files; never installs or removes"]
    fn live_windows_inventory_is_read_only() {
        let mut inventory = Inventory::default();
        inventory.refresh().unwrap();
        assert!(!inventory.faces.is_empty());
        assert!(inventory
            .faces
            .iter()
            .all(|f| inventory.matching(f).is_some()));
        let count = inventory.faces.len();
        assert!(!inventory.cache.is_empty());
        inventory.refresh().unwrap();
        assert_eq!(inventory.faces.len(), count);
        println!(
            "Verified {} installed Windows faces without changing files or registrations",
            inventory.faces.len()
        );
    }
}
