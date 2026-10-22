use crate::storage::{now, Result};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use ttf_parser::{Face, Tag};

const MAX_FONT_BYTES: u64 = 128 * 1024 * 1024;

fn read(path: &Path) -> Result<Vec<u8>> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_FONT_BYTES {
        return Err("Font file exceeds 128 MB".into());
    }
    fs::read(path).map_err(|e| e.to_string())
}

pub fn decode(data: &[u8]) -> Result<Vec<u8>> {
    if data.starts_with(b"wOFF") || data.starts_with(b"wOF2") {
        let declared = u32::from_be_bytes(
            data.get(16..20)
                .ok_or("Truncated web font")?
                .try_into()
                .unwrap(),
        );
        if declared as u64 > MAX_FONT_BYTES {
            return Err("Expanded font exceeds 128 MB".into());
        }
    }
    if data.starts_with(b"wOFF") {
        wuff::decompress_woff1(data).map_err(|e| format!("WOFF: {e:?}"))
    } else if data.starts_with(b"wOF2") {
        wuff::decompress_woff2(data).map_err(|e| format!("WOFF2: {e:?}"))
    } else {
        Ok(data.to_vec())
    }
}

fn name(face: &Face<'_>, id: u16) -> Option<String> {
    let names = face.names();
    names
        .into_iter()
        .filter(|n| n.name_id == id)
        .filter_map(|n| n.to_string())
        .find(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
}

static CATEGORY_PATTERNS: std::sync::LazyLock<[regex::Regex; 5]> = std::sync::LazyLock::new(|| {
    [
    regex::Regex::new(r"\b(mono|code|console|consol|courier|menlo|inconsolata|fira ?code|source ?code)\b").unwrap(),
    regex::Regex::new(r"\b(script|hand|brush|calligraph|signature|cursive|ink ?free)\b").unwrap(),
    regex::Regex::new(r"\b(display|deco|poster|banner|black|fat|inline|shadow)\b").unwrap(),
    regex::Regex::new(r"\b(serif|times|georgia|garamond|baskerv|didot|bodoni|playfair|merriweather|caslon|century|palatino|book antiqua|cambria|constantia|sylfaen)\b").unwrap(),
    regex::Regex::new(r"\b(sans|grotesk|grotesque|helvetica|arial|roboto|inter|open sans|lato|segoe|calibri|tahoma|verdana|franklin|candara|corbel)\b").unwrap(),
]
});

fn category(face: &Face<'_>, family: &str, subfamily: &str) -> &'static str {
    let value = format!("{family} {subfamily}").to_lowercase();
    let matches = |index: usize| CATEGORY_PATTERNS[index].is_match(&value);
    if face.is_monospaced() || matches(0) {
        return "monospace";
    }
    if let Some(table) = face.raw_face().table(Tag::from_bytes(b"OS/2")) {
        if let Some(panose) = table.get(32..42) {
            match panose[0] {
                3 => return "handwriting",
                4 => return "display",
                5 => return "other",
                2 => {
                    if panose[3] == 9 {
                        return "monospace";
                    }
                    if (2..=10).contains(&panose[1]) {
                        return "serif";
                    }
                    if (11..=15).contains(&panose[1]) {
                        return "sans-serif";
                    }
                }
                _ => {}
            }
        }
    }
    if matches(1) {
        "handwriting"
    } else if matches(2) {
        "display"
    } else if matches(3) {
        "serif"
    } else if matches(4) {
        "sans-serif"
    } else {
        "other"
    }
}

pub fn parse(path: &Path) -> Result<Vec<Value>> {
    let bytes = decode(&read(path)?)?;
    let count = ttf_parser::fonts_in_collection(&bytes).unwrap_or(1);
    let mut result = Vec::new();
    for index in 0..count {
        let face = Face::parse(&bytes, index).map_err(|e| format!("Invalid font: {e:?}"))?;
        let fallback = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let family = name(&face, 16)
            .or_else(|| name(&face, 1))
            .unwrap_or(fallback);
        let subfamily = name(&face, 17)
            .or_else(|| name(&face, 2))
            .unwrap_or("Regular".into());
        let full = name(&face, 4).unwrap_or(format!("{family} {subfamily}"));
        let ps = name(&face, 6).unwrap_or_else(|| full.split_whitespace().collect::<String>());
        let axes: Vec<Value> = face.variation_axes().into_iter().map(|a| json!({
            "tag":a.tag.to_string(), "name":name(&face,a.name_id).unwrap_or(a.tag.to_string()),
            "min":a.min_value,"default":a.def_value,"max":a.max_value
        })).collect();
        let em = face.units_per_em() as f64;
        let mut metrics = json!({});
        if let Some(v) = face.x_height().filter(|v| *v > 0) {
            metrics["xHeight"] = json!((v as f64 / em * 10000.0).round() / 10000.0);
        }
        if let Some(v) = face.capital_height().filter(|v| *v > 0) {
            metrics["capHeight"] = json!((v as f64 / em * 10000.0).round() / 10000.0);
        }
        let mut record = json!({
            "id":format!("local:{}",ps.to_lowercase()),"provider":"local",
            "familyId":format!("local:{}",family.to_lowercase()),
            "family":family,"subfamily":subfamily,"fullName":full,"postScriptName":ps,
            "weight":face.weight().to_number(),"style":if face.is_italic() || face.is_oblique() || face.italic_angle() != 0.0 {"italic"} else {"normal"},
            "category":category(&face,&family,&subfamily),"axes":axes,
            "format":format(path),"filePath":path,"faceIndex":index,
            "cached":true,"active":false,"collections":[],"tags":[],"addedAt":now()
        });
        for (key, id) in [
            ("copyright", 0),
            ("version", 5),
            ("designer", 9),
            ("license", 13),
        ] {
            if let Some(v) = name(&face, id) {
                record[key] = json!(v);
            }
        }
        if !metrics.as_object().unwrap().is_empty() {
            record["metrics"] = metrics;
        }
        result.push(record);
    }
    Ok(result)
}

pub fn format(path: &Path) -> &'static str {
    match path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
        .as_str()
    {
        "otf" | "otc" => "otf",
        "woff" => "woff",
        "woff2" => "woff2",
        _ => "ttf",
    }
}

pub fn system_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from(std::env::var_os("WINDIR").unwrap_or("C:\\Windows".into())).join("Fonts"),
    ];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Microsoft/Windows/Fonts"));
    }
    roots.into_iter().filter(|p| p.exists()).collect()
}

pub fn collect(root: &Path) -> (Vec<PathBuf>, Vec<String>) {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .max_depth(9)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || !e.file_type().is_dir()
                || !matches!(
                    e.file_name().to_string_lossy().to_lowercase().as_str(),
                    "node_modules"
                        | "$recycle.bin"
                        | "system volume information"
                        | ".git"
                        | "windowsapps"
                ) && !e.file_name().to_string_lossy().starts_with('.')
        })
    {
        match entry {
            Ok(e) if e.file_type().is_file() => {
                if matches!(
                    e.path()
                        .extension()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase()
                        .as_str(),
                    "ttf" | "otf" | "ttc" | "otc" | "woff" | "woff2"
                ) {
                    files.push(e.into_path());
                }
            }
            Err(e) => errors.push(e.to_string()),
            _ => {}
        }
    }
    (files, errors)
}

fn uint(data: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        data.get(offset..offset + 4)
            .ok_or("Invalid collection offset")?
            .try_into()
            .unwrap(),
    ))
}

// Browsers do not consistently select TTC faces. Rebuild the requested face as
// a standalone sfnt, retaining its tables and repairing offsets/checksums.
pub fn extract_face(data: &[u8], index: u32) -> Result<Vec<u8>> {
    let count = ttf_parser::fonts_in_collection(data).ok_or("Not a collection")?;
    if index >= count {
        return Err("Unknown collection face".into());
    }
    let start = uint(data, 12 + index as usize * 4)? as usize;
    let header = data.get(start..start + 12).ok_or("Truncated face header")?;
    let count = u16::from_be_bytes(header[4..6].try_into().unwrap()) as usize;
    let mut out = header.to_vec();
    out.extend_from_slice(
        data.get(start + 12..start + 12 + count * 16)
            .ok_or("Truncated table directory")?,
    );
    let mut head = None;
    for i in 0..count {
        let entry = 12 + i * 16;
        let offset = uint(&out, entry + 8)? as usize;
        let length = uint(&out, entry + 12)? as usize;
        let table = data
            .get(offset..offset.checked_add(length).ok_or("Invalid table length")?)
            .ok_or("Truncated table")?;
        let next = out.len();
        out[entry + 8..entry + 12].copy_from_slice(&(next as u32).to_be_bytes());
        out.extend_from_slice(table);
        while out.len() % 4 != 0 {
            out.push(0);
        }
        if &out[entry..entry + 4] == b"head" {
            if length < 12 {
                return Err("Invalid head table".into());
            }
            out[next + 8..next + 12].fill(0);
            head = Some(next);
        }
    }
    if let Some(head) = head {
        let checksum = out.chunks_exact(4).fold(0u32, |sum, word| {
            sum.wrapping_add(u32::from_be_bytes(word.try_into().unwrap()))
        });
        out[head + 8..head + 12]
            .copy_from_slice(&0xB1B0AFBAu32.wrapping_sub(checksum).to_be_bytes());
    }
    Ok(out)
}

pub fn preview(path: &Path, index: u32) -> Result<(Vec<u8>, &'static str)> {
    let bytes = read(path)?;
    if bytes.starts_with(b"ttcf") {
        return Ok((extract_face(&bytes, index)?, "font/ttf"));
    }
    let mime = match format(path) {
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "font/ttf",
    };
    Ok((bytes, mime))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_fonts_are_errors() {
        assert!(decode(b"wOF2").is_err());
        assert!(extract_face(b"ttcf", 0).is_err());
    }
    #[test]
    fn windows_fonts_parse_and_collection_faces_extract() {
        let mut checked = 0;
        for root in system_roots() {
            for path in collect(&root).0.into_iter().take(80) {
                let records = parse(&path).unwrap();
                assert!(!records.is_empty());
                for record in records {
                    assert!(!record["postScriptName"].as_str().unwrap().is_empty());
                    let bytes = read(&path).unwrap();
                    if bytes.starts_with(b"ttcf") {
                        let extracted =
                            extract_face(&bytes, record["faceIndex"].as_u64().unwrap() as u32)
                                .unwrap();
                        let face = Face::parse(&extracted, 0).unwrap();
                        assert_eq!(name(&face, 6).unwrap(), record["postScriptName"]);
                    }
                }
                checked += 1;
            }
        }
        #[cfg(windows)]
        assert!(checked > 0, "Expected installed Windows fonts");
        let _ = checked;
    }
}
