use crate::{
    fonts, sources,
    storage::{text, Result},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::{Component, Path},
};

const MAX_FILE: u64 = 32 * 1024 * 1024;
const MAX_TOTAL: u64 = 128 * 1024 * 1024;

fn entries(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("Invalid font package: {e}"))?;
    if zip.len() > 256 {
        return Err("Font package exceeds 256 entries".into());
    }
    let mut total = 0u64;
    let mut output = Vec::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        let path = Path::new(&name);
        if entry.encrypted()
            || entry.enclosed_name().is_none()
            || name.contains(':')
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
            || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Unsafe path, symlink or encrypted entry in font package".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Invalid package size")?;
        if entry.size() > MAX_FILE || total > MAX_TOTAL {
            return Err("Expanded font package exceeds size limits".into());
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !entry.is_file() || !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc" | "txt" | "md")
        {
            continue;
        }
        let mut data = Vec::new();
        (&mut entry)
            .take(MAX_FILE + 1)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        if data.len() as u64 > MAX_FILE {
            return Err("Package entry exceeds size limit".into());
        }
        output.push((name, data));
    }
    Ok(output)
}

pub fn package(root: &Path, package: &Value) -> Result<Vec<Value>> {
    let bytes = sources::fetch(
        text(package, "provider"),
        text(package, "packageUrl"),
        64 * 1024 * 1024,
    )?;
    let files = entries(&bytes)?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let cache = root.join("font-cache").join("packages").join(&digest);
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let mut license = String::new();
    let mut records = Vec::new();
    for (index, (name, data)) in files.iter().enumerate() {
        let ext = Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(ext.as_str(), "txt" | "md") {
            if license.len() < 512 * 1024 {
                license.push_str(&format!(
                    "\n{name}\n{}\n",
                    String::from_utf8_lossy(&data[..data.len().min(64 * 1024)])
                ));
            }
            continue;
        }
        // Flatten validated paths; no archive-supplied directory is ever created.
        let dest = cache.join(format!("{index}.{ext}"));
        if data.starts_with(b"wOFF") || data.starts_with(b"wOF2") {
            return Err("Package contains a web font disguised as an installable font".into());
        }
        fs::write(&dest, data).map_err(|e| e.to_string())?;
        let faces = match fonts::parse(&dest) {
            Ok(faces) => faces,
            Err(error) => {
                let _ = fs::remove_file(&dest);
                return Err(format!("{name}: {error}"));
            }
        };
        for mut font in faces {
            let provider = text(package, "provider");
            font["id"] = json!(format!(
                "{provider}:{}:{}",
                &digest[..16],
                text(&font, "postScriptName").to_lowercase()
            ));
            font["provider"] = package["provider"].clone();
            font["familyId"] = package["familyId"].clone();
            font["packageId"] = package["id"].clone();
            font["sourceUrl"] = package["sourceUrl"].clone();
            font["downloadUrl"] = package["packageUrl"].clone();
            font["packageUrl"] = package["packageUrl"].clone();
            font["sourceQuery"] = package["sourceQuery"].clone();
            font["parsedIdentity"] = json!(true);
            records.push(font);
        }
    }
    if records.is_empty() {
        return Err("The download contains no installable font files".into());
    }
    // Store license text as inert data, never HTML from the site/archive.
    for font in &mut records {
        font["licenseText"] = json!(license);
        if font["license"].as_str().is_none() {
            font["license"] = package["license"].clone();
        }
    }
    fs::write(cache.join("license.txt"), license).map_err(|e| e.to_string())?;
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn archive(name: &str, data: &[u8]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(data).unwrap();
        writer.finish().unwrap().into_inner()
    }
    #[test]
    fn archives_are_bounded_and_never_extract_paths_or_executables() {
        for name in ["../font.ttf", "C:/font.ttf", "/font.ttf", "..\\font.ttf"] {
            assert!(entries(&archive(name, b"bad")).is_err(), "{name}");
        }
        assert!(entries(b"<html>Error</html>").is_err());
        assert!(entries(&archive("setup.exe", b"MZ")).unwrap().is_empty());
        assert_eq!(
            entries(&archive("family/LICENSE.txt", b"Personal use only")).unwrap()[0].1,
            b"Personal use only"
        );
        let oversized = archive("large.ttf", &vec![0; MAX_FILE as usize + 1]);
        assert!(entries(&oversized).is_err());
    }
}
