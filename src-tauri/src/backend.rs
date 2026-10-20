use crate::{
    activation, fonts, providers,
    storage::{self, now, text, Result},
    PreviewIndex,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub struct Backend {
    pub root: PathBuf,
    pub library: Value,
    activated: Value,
    client: reqwest::blocking::Client,
    provider_errors: HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rescan_keeps_user_metadata_and_refreshes_derived_fields() {
        let previous = json!({"id":"local:example","favorite":true,"rating":5,"note":"Keep this","tags":["brand"],"collections":["saved"],"addedAt":42,"weight":400});
        let mut incoming = json!({"id":"local:example","weight":700,"axes":[{"tag":"wght"}]});
        preserve(&mut incoming, &previous);
        for key in [
            "favorite",
            "rating",
            "note",
            "tags",
            "collections",
            "addedAt",
        ] {
            assert_eq!(incoming[key], previous[key]);
        }
        assert_eq!(incoming["weight"], 700);
        assert_eq!(incoming["axes"][0]["tag"], "wght");
    }
}

fn array(value: &Value, key: &str) -> Vec<Value> {
    value[key].as_array().cloned().unwrap_or_default()
}
fn argument<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or(format!("Missing {key}"))
}
fn ids(args: &Value) -> Result<Vec<String>> {
    args["ids"]
        .as_array()
        .ok_or("Missing font IDs")?
        .iter()
        .map(|v| v.as_str().map(String::from).ok_or("Invalid font ID".into()))
        .collect()
}
fn patch(target: &mut Value, changes: &Value, allowed: &[&str]) -> Result<()> {
    let changes = changes.as_object().ok_or("Invalid patch")?;
    for (key, value) in changes {
        if !allowed.contains(&key.as_str()) {
            return Err(format!("Unsupported field: {key}"));
        }
        target[key] = value.clone();
    }
    Ok(())
}
fn preserve(incoming: &mut Value, previous: &Value) {
    for key in [
        "collections",
        "tags",
        "rating",
        "favorite",
        "note",
        "addedAt",
    ] {
        if let Some(v) = previous.get(key) {
            incoming[key] = v.clone();
        }
    }
}

impl Backend {
    pub fn open(root: PathBuf) -> Result<Self> {
        let library = storage::open_library(&root)?;
        let mut activated = storage::read_json(&root.join("activated.json"), json!({}))?;
        activation::reconcile(&mut activated)?;
        storage::write_json(&root.join("activated.json"), &activated)?;
        let mut backend = Self {
            root,
            library,
            activated,
            client: providers::client()?,
            provider_errors: HashMap::new(),
        };
        backend.reconcile();
        Ok(backend)
    }

    pub fn flush(&self) -> Result<()> {
        storage::write_json(&self.root.join("library.json"), &self.library)
    }

    pub fn index_previews(&self, index: &PreviewIndex) {
        let mut result = HashMap::new();
        for font in self.library["fonts"].as_array().unwrap() {
            if let Some(path) = font["filePath"].as_str() {
                result.insert(
                    text(font, "id").into(),
                    (
                        PathBuf::from(path),
                        font["faceIndex"].as_u64().unwrap_or(0) as u32,
                    ),
                );
            }
        }
        *index.write().unwrap() = result;
    }

    fn reconcile(&mut self) {
        for font in self.library["fonts"].as_array_mut().unwrap() {
            font["active"] = json!(self.activated[text(font, "id")].is_string());
        }
    }

    fn emit(&self, app: &tauri::AppHandle, previews: &PreviewIndex) {
        self.index_previews(previews);
        let _ = app.emit("library-changed", &self.library["fonts"]);
    }

    fn progress(
        app: &tauri::AppHandle,
        phase: &str,
        completed: usize,
        total: usize,
        message: String,
    ) {
        let _ = app.emit(
            "progress",
            json!({"phase":phase,"completed":completed,"total":total,"message":message}),
        );
    }

    fn provider_infos(&self) -> Value {
        json!([
            ("google","Google Fonts","Fonts served by Google Fonts (fonts.google.com)","https://fonts.google.com"),
            ("bunny","Bunny Fonts","Bunny Fonts is a privacy-focused mirror of the Google Fonts library","https://fonts.bunny.net"),
            ("fontsource","Fontsource","Open-source fonts packaged by Fontsource and served via jsDelivr","https://fontsource.org"),
            ("local","Local & network folders","Your own folders and system fonts","")
        ].into_iter().map(|(id,name,attribution,homepage)| {
            let count = self.library["fonts"].as_array().unwrap().iter().filter(|f| f["provider"] == id).count();
            json!({"id":id,"name":name,"count":count,"remote":id!="local",
                "status":if self.provider_errors.contains_key(id) {"error"} else if count>0 || id=="local" {"ready"} else {"idle"},
                "error":self.provider_errors.get(id),"attribution":attribution,"homepage":homepage})
        }).collect::<Vec<_>>())
    }

    fn scan(&mut self, app: &tauri::AppHandle, include_system: bool) -> Result<Value> {
        let start = now();
        let mut errors = Vec::new();
        let mut roots = Vec::new();
        for folder in array(&self.library, "folders") {
            if folder["enabled"] == true {
                roots.push(PathBuf::from(text(&folder, "path")));
            }
        }
        if include_system {
            roots.extend(fonts::system_roots());
        }
        let mut seen_roots = HashSet::new();
        roots.retain(|p| seen_roots.insert(p.to_string_lossy().to_lowercase()));
        let mut collected = HashMap::new();
        let mut successful_roots = Vec::new();
        for root in &roots {
            Self::progress(app, "scan", 0, 0, format!("Scanning {}", root.display()));
            let (files, walk_errors) = fonts::collect(root);
            if walk_errors.is_empty() {
                successful_roots.push(root.clone());
            }
            errors.extend(walk_errors);
            let total = files.len();
            for (index, file) in files.iter().enumerate() {
                match fonts::parse(file) {
                    Ok(records) => {
                        for font in records {
                            collected
                                .entry(text(&font, "id").to_string())
                                .or_insert(font);
                        }
                    }
                    Err(e) => {
                        errors.push(format!("{}: {e}", file.display()));
                    }
                }
                if index % (total / 100).max(1) == 0 || index + 1 == total {
                    Self::progress(
                        app,
                        "scan",
                        index + 1,
                        total,
                        format!("Reading {} / {total} font files", index + 1),
                    );
                }
            }
        }
        let old = array(&self.library, "fonts");
        let mut next = Vec::new();
        let mut added = 0;
        let mut updated = 0;
        let mut removed = 0;
        for previous in old {
            let id = text(&previous, "id");
            if let Some(mut font) = collected.remove(id) {
                preserve(&mut font, &previous);
                next.push(font);
                updated += 1;
            } else if previous["provider"] == "local"
                && previous["filePath"].as_str().is_some_and(|p| {
                    successful_roots
                        .iter()
                        .any(|r| storage::under(Path::new(p), r))
                })
            {
                // A parse error is not proof that a font disappeared.
                if Path::new(text(&previous, "filePath")).exists() {
                    next.push(previous);
                } else {
                    removed += 1;
                }
            } else {
                next.push(previous);
            }
        }
        for (_, font) in collected {
            next.push(font);
            added += 1;
        }
        self.library["fonts"] = json!(next);
        self.reconcile();
        self.library["schemaVersion"] = json!(4);
        let scanned = added + updated;
        for folder in self.library["folders"].as_array_mut().unwrap() {
            if folder["enabled"] != true {
                continue;
            }
            let root = Path::new(text(folder, "path"));
            let count = next
                .iter()
                .filter(|f| {
                    f["provider"] == "local"
                        && f["filePath"]
                            .as_str()
                            .is_some_and(|p| storage::under(Path::new(p), root))
                })
                .count();
            folder["fontCount"] = json!(count);
            folder["lastScan"] = json!(now());
        }
        Ok(
            json!({"scanned":scanned,"added":added,"updated":updated,"removed":removed,"errors":errors.into_iter().take(50).collect::<Vec<_>>(),"durationMs":now()-start}),
        )
    }

    fn refresh(&mut self, app: &tauri::AppHandle, id: &str) -> Result<Value> {
        if id == "local" {
            return Ok(self.provider_infos());
        }
        Self::progress(app, "catalog", 0, 1, format!("Fetching {id} catalogue"));
        match providers::catalog(&self.client, id) {
            Ok(mut incoming) => {
                let previous: HashMap<String, Value> = array(&self.library, "fonts")
                    .into_iter()
                    .filter(|f| f["provider"] == id)
                    .map(|f| (text(&f, "id").into(), f))
                    .collect();
                let mut seen = HashSet::new();
                for font in &mut incoming {
                    let key = text(font, "id").to_string();
                    seen.insert(key.clone());
                    if let Some(old) = previous.get(&key) {
                        if old["filePath"].is_string() {
                            *font = old.clone();
                        } else {
                            preserve(font, old);
                        }
                    }
                }
                let mut next = array(&self.library, "fonts")
                    .into_iter()
                    .filter(|f| f["provider"] != id)
                    .collect::<Vec<_>>();
                // Retired catalogue faces with user data/downloads remain available.
                next.extend(
                    previous
                        .into_iter()
                        .filter(|(key, f)| {
                            !seen.contains(key)
                                && (f["filePath"].is_string()
                                    || f["favorite"] == true
                                    || !array(f, "collections").is_empty()
                                    || !array(f, "tags").is_empty()
                                    || f["rating"].is_number()
                                    || f["note"].is_string())
                        })
                        .map(|(_, f)| f),
                );
                next.extend(incoming);
                self.library["fonts"] = json!(next);
                self.library["providerMeta"][id] = json!({"lastRefresh":now()});
                self.provider_errors.remove(id);
            }
            Err(e) => {
                self.provider_errors.insert(id.into(), e);
            }
        }
        Self::progress(app, "catalog", 1, 1, format!("Finished {id} catalogue"));
        Ok(self.provider_infos())
    }

    fn download(&mut self, id: &str) -> Result<Value> {
        let index = self.library["fonts"]
            .as_array()
            .unwrap()
            .iter()
            .position(|f| f["id"] == id)
            .ok_or("Font not found")?;
        let mut font = self.library["fonts"][index].clone();
        if font["provider"] == "local"
            || font["filePath"]
                .as_str()
                .is_some_and(|p| Path::new(p).exists())
        {
            return Ok(font);
        }
        let url = providers::resolve(&self.client, &font)?;
        let bytes = providers::download(&self.client, &url)?;
        if !bytes.starts_with(b"OTTO")
            && !bytes.starts_with(&[0, 1, 0, 0])
            && !bytes.starts_with(b"ttcf")
        {
            return Err("Provider did not return an installable TTF/OTF file".into());
        }
        let ext = if bytes.starts_with(b"OTTO") {
            "otf"
        } else if bytes.starts_with(b"ttcf") {
            "ttc"
        } else {
            "ttf"
        };
        let cache = self.root.join("font-cache");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let dest = cache.join(format!(
            "{}_{}.{}",
            text(&font, "provider"),
            activation::safe_name(text(&font, "postScriptName")),
            ext
        ));
        let temp = dest.with_extension("download");
        fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
        let faces = match fonts::parse(&temp) {
            Ok(v) if !v.is_empty() => v,
            Ok(_) => return Err("No faces in downloaded font".into()),
            Err(e) => {
                let _ = fs::remove_file(temp);
                return Err(e);
            }
        };
        let parsed = faces
            .iter()
            .find(|f| text(f, "postScriptName").eq_ignore_ascii_case(text(&font, "postScriptName")))
            .or_else(|| {
                faces
                    .iter()
                    .find(|f| f["weight"] == font["weight"] && f["style"] == font["style"])
            })
            .unwrap_or(&faces[0]);
        if dest.exists() {
            fs::remove_file(&dest).map_err(|e| e.to_string())?;
        }
        fs::rename(temp, &dest).map_err(|e| e.to_string())?;
        for key in [
            "axes",
            "weight",
            "style",
            "family",
            "subfamily",
            "fullName",
            "postScriptName",
            "category",
            "metrics",
            "faceIndex",
            "version",
            "license",
            "designer",
            "copyright",
        ] {
            if let Some(v) = parsed.get(key) {
                font[key] = v.clone();
            }
        }
        font["familyId"] = json!(format!(
            "{}:{}",
            text(&font, "provider"),
            text(&font, "family").to_lowercase()
        ));
        font["format"] = json!(if ext == "otf" { "otf" } else { "ttf" });
        font["filePath"] = json!(dest);
        font["cached"] = json!(true);
        font["downloadUrl"] = json!(url);
        self.library["fonts"][index] = font.clone();
        Ok(font)
    }

    fn activation(&mut self, app: &tauri::AppHandle, selected: &[String], active: bool) -> Value {
        let mut changed = Vec::new();
        let mut failed = Vec::new();
        for (done, id) in selected.iter().enumerate() {
            let result = (|| -> Result<()> {
                let font = if active {
                    self.download(id)?
                } else {
                    self.library["fonts"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|f| f["id"] == *id)
                        .cloned()
                        .ok_or("Font not found")?
                };
                if active {
                    activation::activate(&self.root, &mut self.activated, &font)
                } else {
                    activation::deactivate(&self.root, &mut self.activated, &font)
                }
            })();
            match result {
                Ok(()) => changed.push(id.clone()),
                Err(error) => failed.push(json!({"id":id,"error":error})),
            }
            Self::progress(
                app,
                if active { "activate" } else { "deactivate" },
                done + 1,
                selected.len(),
                format!(
                    "{} {} / {}",
                    if active { "Activating" } else { "Deactivating" },
                    done + 1,
                    selected.len()
                ),
            );
        }
        self.reconcile();
        json!({"changed":changed,"failed":failed})
    }

    pub fn dispatch(
        &mut self,
        app: &tauri::AppHandle,
        previews: &PreviewIndex,
        action: &str,
        args: Value,
    ) -> Result<Value> {
        let result = self.perform(app, action, args);
        // Persist mutations even if a later item of a bulk operation failed.
        let persisted = if matches!(action, "bootstrap" | "open-external" | "reveal-font") {
            Ok(())
        } else {
            self.flush()
        };
        if matches!(
            action,
            "startup"
                | "rescan"
                | "refresh-provider"
                | "download-font"
                | "download-many"
                | "activate"
                | "deactivate"
                | "update-font"
                | "update-many"
                | "add-folder"
                | "remove-folder"
                | "uninstall-font-file"
        ) {
            self.emit(app, previews);
        }
        let _ = app.emit("progress", Value::Null);
        persisted?;
        result
    }

    fn perform(&mut self, app: &tauri::AppHandle, action: &str, args: Value) -> Result<Value> {
        match action {
            "bootstrap" => {
                self.reconcile();
                Ok(
                    json!({"fonts":self.library["fonts"],"collections":self.library["collections"],"pairs":self.library["pairs"],"folders":self.library["folders"],"settings":self.library["settings"],"providers":self.provider_infos(),"platform":"win32"}),
                )
            }
            "startup" => {
                let empty = self.library["fonts"].as_array().unwrap().is_empty();
                let stale = self.library["schemaVersion"] != 4
                    || self.library["fonts"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|f| f["provider"] == "local" && f["faceIndex"].is_null());
                if empty
                    || stale
                    || array(&self.library, "folders")
                        .iter()
                        .any(|f| f["enabled"] == true)
                {
                    self.scan(app, empty || stale)
                } else {
                    Ok(Value::Null)
                }
            }
            "rescan" => self.scan(app, true),
            "refresh-provider" => self.refresh(app, argument(&args, "id")?),
            "download-font" => self.download(argument(&args, "id")?),
            "download-many" => {
                let selected = ids(&args)?;
                let mut ok = 0;
                for (done, id) in selected.iter().enumerate() {
                    if self.download(id).is_ok() {
                        ok += 1;
                    }
                    Self::progress(
                        app,
                        "download",
                        done + 1,
                        selected.len(),
                        format!("Downloaded {} / {}", done + 1, selected.len()),
                    );
                }
                Ok(json!({"ok":ok,"failed":selected.len()-ok}))
            }
            "activate" | "deactivate" => {
                Ok(self.activation(app, &ids(&args)?, action == "activate"))
            }
            "save-collection" | "save-pair" => {
                let (key, field) = if action == "save-pair" {
                    ("pairs", "pair")
                } else {
                    ("collections", "collection")
                };
                let mut item = args[field].clone();
                argument(&item, "id")?;
                let list = self.library[key].as_array_mut().unwrap();
                if let Some(index) = list.iter().position(|v| {
                    v["id"] == item["id"]
                        || key == "pairs"
                            && v["headingId"] == item["headingId"]
                            && v["bodyId"] == item["bodyId"]
                }) {
                    item["id"] = list[index]["id"].clone();
                    list[index] = item;
                } else {
                    list.push(item);
                }
                Ok(json!(list))
            }
            "delete-collection" | "delete-pair" => {
                let key = if action == "delete-pair" {
                    "pairs"
                } else {
                    "collections"
                };
                let id = argument(&args, "id")?;
                self.library[key]
                    .as_array_mut()
                    .unwrap()
                    .retain(|v| v["id"] != id);
                Ok(self.library[key].clone())
            }
            "update-font" | "update-many" => {
                let selected = if action == "update-font" {
                    vec![argument(&args, "id")?.into()]
                } else {
                    ids(&args)?
                };
                let mut touched = Vec::new();
                for font in self.library["fonts"].as_array_mut().unwrap() {
                    if selected.iter().any(|id| font["id"] == *id) {
                        patch(
                            font,
                            &args["patch"],
                            &["collections", "tags", "rating", "favorite", "note"],
                        )?;
                        touched.push(font.clone());
                    }
                }
                if action == "update-font" {
                    touched.into_iter().next().ok_or("Font not found".into())
                } else {
                    Ok(json!(touched))
                }
            }
            "add-folder" => {
                if let Some(selected) = app
                    .dialog()
                    .file()
                    .set_title("Choose a folder containing fonts")
                    .blocking_pick_folder()
                {
                    let selected = selected.into_path().map_err(|e| e.to_string())?;
                    if !array(&self.library, "folders")
                        .iter()
                        .any(|f| Path::new(text(f, "path")) == selected)
                    {
                        self.library["folders"].as_array_mut().unwrap().push(json!({"path":selected,"provider":"local","enabled":true,"fontCount":0}));
                        self.scan(app, true)?;
                    }
                }
                Ok(self.library["folders"].clone())
            }
            "remove-folder" => {
                let target = argument(&args, "path")?;
                self.library["folders"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|f| !text(f, "path").eq_ignore_ascii_case(target));
                let remaining: Vec<PathBuf> = array(&self.library, "folders")
                    .iter()
                    .map(|f| PathBuf::from(text(f, "path")))
                    .chain(fonts::system_roots())
                    .collect();
                self.library["fonts"].as_array_mut().unwrap().retain(|f| {
                    let path = Path::new(text(f, "filePath"));
                    f["provider"] != "local"
                        || !storage::under(path, Path::new(target))
                        || remaining.iter().any(|r| storage::under(path, r))
                });
                Ok(self.library["folders"].clone())
            }
            "toggle-folder" => {
                let target = argument(&args, "path")?;
                let enabled = args["enabled"].as_bool().ok_or("Missing enabled state")?;
                for folder in self.library["folders"].as_array_mut().unwrap() {
                    if text(folder, "path").eq_ignore_ascii_case(target) {
                        folder["enabled"] = json!(enabled);
                    }
                }
                Ok(self.library["folders"].clone())
            }
            "save-settings" => {
                patch(
                    &mut self.library["settings"],
                    &args["patch"],
                    &[
                        "previewText",
                        "previewSize",
                        "gridColumns",
                        "autoDownloadOnPreview",
                        "cacheDir",
                        "fontStoreDir",
                    ],
                )?;
                // Cache/store locations stay anchored to the existing data directory.
                self.library["settings"]["cacheDir"] = json!(self.root.join("font-cache"));
                self.library["settings"]["fontStoreDir"] = json!(self.root.join("font-store"));
                Ok(self.library["settings"].clone())
            }
            "open-external" => {
                let url = url::Url::parse(argument(&args, "url")?).map_err(|e| e.to_string())?;
                if !matches!(url.scheme(), "https" | "http") {
                    return Err("Only web links can be opened".into());
                }
                app.opener()
                    .open_url(url.as_str(), None::<&str>)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "reveal-font" => {
                let font = self.library["fonts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|f| f["id"] == args["id"])
                    .ok_or("Font not found")?;
                app.opener()
                    .reveal_item_in_dir(argument(font, "filePath")?)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "uninstall-font-file" => {
                let index = self.library["fonts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .position(|f| f["id"] == args["id"])
                    .ok_or("Font not found")?;
                let mut font = self.library["fonts"][index].clone();
                activation::deactivate(&self.root, &mut self.activated, &font)?;
                if let Some(path) = font["filePath"].as_str() {
                    // Every face in a collection references the same physical file.
                    let affected: Vec<Value> = array(&self.library, "fonts")
                        .into_iter()
                        .filter(|f| f["filePath"] == path)
                        .collect();
                    for other in affected {
                        activation::deactivate(&self.root, &mut self.activated, &other)?;
                    }
                    match fs::remove_file(path) {
                        Ok(()) => {}
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                        Err(e) => return Err(e.to_string()),
                    }
                    for other in self.library["fonts"]
                        .as_array_mut()
                        .unwrap()
                        .iter_mut()
                        .filter(|f| f["filePath"] == path)
                    {
                        other.as_object_mut().unwrap().remove("filePath");
                        other["cached"] = json!(false);
                        other["active"] = json!(false);
                    }
                }
                font.as_object_mut().unwrap().remove("filePath");
                font["cached"] = json!(false);
                font["active"] = json!(false);
                self.library["fonts"][index] = font.clone();
                Ok(font)
            }
            _ => Err(format!("Unknown action: {action}")),
        }
    }
}
