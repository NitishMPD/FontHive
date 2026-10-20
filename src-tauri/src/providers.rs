use crate::storage::{now, text, Result};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{collections::HashSet, io::Read, time::Duration};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const LEGACY_UA: &str = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)";

pub fn client() -> Result<Client> {
    Client::builder()
        .user_agent(UA)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("Too many redirects")
            } else if allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Untrusted font redirect")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

fn allowed(url: &url::Url) -> bool {
    url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some(
                "fonts.google.com"
                    | "fonts.googleapis.com"
                    | "fonts.gstatic.com"
                    | "fonts.bunny.net"
                    | "api.fontsource.org"
                    | "cdn.jsdelivr.net"
            )
        )
}

fn response(client: &Client, url: &str, legacy: bool) -> Result<reqwest::blocking::Response> {
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    if !allowed(&parsed) {
        return Err("Untrusted font URL".into());
    }
    client
        .get(parsed)
        .header("user-agent", if legacy { LEGACY_UA } else { UA })
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())
}

pub fn download(client: &Client, url: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    response(client, url, false)?
        .take(128 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 128 * 1024 * 1024 || bytes.len() < 512 {
        return Err("Font download has an invalid size".into());
    }
    Ok(bytes)
}

fn category(raw: &str) -> &'static str {
    let s = raw.to_lowercase();
    if s.contains("sans") {
        "sans-serif"
    } else if s.contains("serif") {
        "serif"
    } else if s.contains("mono") {
        "monospace"
    } else if s.contains("hand") || s.contains("script") || s.contains("cursive") {
        "handwriting"
    } else if s.contains("display") || s.contains("decorative") {
        "display"
    } else {
        "other"
    }
}

pub fn slug(value: &str) -> String {
    regex::Regex::new("[^a-z0-9]+")
        .unwrap()
        .replace_all(&value.to_lowercase(), "-")
        .trim_matches('-')
        .into()
}

fn encoded(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn record(provider: &str, family: &str, weight: u64, italic: bool, cat: &str) -> Value {
    let sub = if weight == 400 {
        if italic {
            if provider == "google" {
                "Italic"
            } else {
                "Italic 400"
            }
            .to_string()
        } else {
            "Regular".to_string()
        }
    } else {
        format!("{}{weight}", if italic { "Italic " } else { "" })
    };
    let ps = format!(
        "{}-{weight}{}",
        family.split_whitespace().collect::<String>(),
        if italic { "italic" } else { "" }
    );
    json!({"id":format!("{provider}:{}",ps.to_lowercase()),"provider":provider,
        "family":family,"familyId":format!("{provider}:{}",family.to_lowercase()),
        "subfamily":sub,"fullName":format!("{family} {sub}"),"postScriptName":ps,
        "format":"ttf","weight":weight,"style":if italic {"italic"} else {"normal"},"category":cat,
        "axes":[],"cached":false,"active":false,"collections":[],"tags":[],"addedAt":now()})
}

pub fn catalog(client: &Client, provider: &str) -> Result<Vec<Value>> {
    let endpoint = match provider {
        "google" => "https://fonts.google.com/metadata/fonts",
        "bunny" => "https://fonts.bunny.net/list",
        "fontsource" => "https://api.fontsource.org/v1/fonts",
        _ => return Err("Unknown provider".into()),
    };
    let mut body = String::new();
    response(client, endpoint, false)?
        .take(32 * 1024 * 1024 + 1)
        .read_to_string(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() > 32 * 1024 * 1024 {
        return Err("Catalogue exceeds size limit".into());
    }
    let body = body.strip_prefix(")]}'").unwrap_or(&body).trim();
    let parsed: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let mut records = Vec::new();
    if provider == "google" {
        let families = parsed["familyMetadataList"]
            .as_array()
            .ok_or("Invalid Google catalogue")?;
        for entry in families {
            let family = text(entry, "family");
            if family.is_empty() {
                continue;
            }
            let axes: Vec<Value> = entry["axes"].as_array().into_iter().flatten().map(|a| json!({
                "tag":a["tag"],"name":a["tag"],"min":a["min"],"max":a["max"],"default":a.get("defaultValue").unwrap_or(&a["min"])
            })).collect();
            let variants: Vec<String> = entry["fonts"]
                .as_object()
                .map(|v| v.keys().cloned().collect())
                .filter(|v: &Vec<String>| !v.is_empty())
                .unwrap_or(vec!["400".into()]);
            for variant in variants {
                let italic = variant.ends_with('i');
                let Ok(weight) = variant.trim_end_matches('i').parse::<u64>() else {
                    continue;
                };
                let mut font = record(
                    provider,
                    family,
                    weight,
                    italic,
                    category(text(entry, "category")),
                );
                let wght = axes.iter().find(|a| a["tag"] == "wght");
                let range = wght
                    .map(|a| format!("{}..{}", a["min"], a["max"]))
                    .unwrap_or(weight.to_string());
                let spec = if italic {
                    format!("ital,wght@1,{range}")
                } else {
                    format!("wght@{range}")
                };
                font["previewUrl"] = json!(format!(
                    "https://fonts.googleapis.com/css2?family={}:{}&display=swap",
                    encoded(family),
                    spec
                ));
                font["axes"] = json!(axes);
                if let Some(v) = entry.get("lastModified") {
                    font["version"] = v.clone();
                }
                if entry["isOpenSource"] == true {
                    font["license"] = json!("Open source");
                }
                if let Some(v) = entry["designers"].as_array() {
                    font["designer"] = json!(v
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", "));
                }
                records.push(font);
            }
        }
    } else {
        let entries: Vec<(String, Value)> = if provider == "bunny" {
            parsed
                .as_object()
                .ok_or("Invalid Bunny catalogue")?
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        } else {
            parsed
                .as_array()
                .ok_or("Invalid Fontsource catalogue")?
                .iter()
                .map(|v| (text(v, "id").into(), v.clone()))
                .collect()
        };
        for (slug, entry) in entries {
            let family = if provider == "bunny" {
                entry["familyName"].as_str().unwrap_or(&slug)
            } else {
                text(&entry, "family")
            };
            let weights = entry["weights"]
                .as_array()
                .filter(|v| !v.is_empty())
                .cloned()
                .unwrap_or(vec![json!(400)]);
            let styles = entry["styles"]
                .as_array()
                .filter(|v| !v.is_empty())
                .cloned()
                .unwrap_or(vec![json!("normal")]);
            for weight in &weights {
                for style in &styles {
                    let weight = weight.as_u64().unwrap_or(400);
                    let italic = style == "italic";
                    let mut font = record(
                        provider,
                        family,
                        weight,
                        italic,
                        category(text(&entry, "category")),
                    );
                    let style = if italic { "italic" } else { "normal" };
                    if provider == "bunny" {
                        font["previewUrl"] = json!(format!(
                            "https://fonts.bunny.net/css?family={}:{}{}",
                            encoded(&slug),
                            weight,
                            if italic { "i" } else { "" }
                        ));
                        font["license"] = json!("Open source");
                    } else {
                        let subset = entry["defSubset"]
                            .as_str()
                            .or_else(|| entry["subsets"][0].as_str())
                            .unwrap_or("latin");
                        let static_url = format!("https://cdn.jsdelivr.net/fontsource/fonts/{slug}@latest/{subset}-{weight}-{style}.woff2");
                        if entry["variable"] == true {
                            let min = weights
                                .iter()
                                .filter_map(Value::as_u64)
                                .min()
                                .unwrap_or(100);
                            let max = weights
                                .iter()
                                .filter_map(Value::as_u64)
                                .max()
                                .unwrap_or(900);
                            font["axes"] = json!([{"tag":"wght","name":"Weight","min":min,"default":400u64.clamp(min,max),"max":max}]);
                            font["previewFileUrl"] = json!(format!("https://cdn.jsdelivr.net/npm/@fontsource-variable/{slug}@latest/files/{slug}-{subset}-wght-{style}.woff2"));
                            font["previewFallbackUrl"] = json!(static_url);
                        } else {
                            font["previewFileUrl"] = json!(static_url);
                        }
                        for key in ["license", "version"] {
                            if let Some(v) = entry.get(key) {
                                font[key] = v.clone();
                            }
                        }
                        if let Some(v) = entry["type"].as_str() {
                            font["version"] = json!(v);
                            font["designer"] = json!(format!("Source: {v}"));
                        }
                    }
                    records.push(font);
                }
            }
        }
    }
    let mut seen = HashSet::new();
    records.retain(|v| seen.insert(text(v, "id").to_string()));
    Ok(records)
}

pub fn resolve(client: &Client, font: &Value) -> Result<String> {
    let slug = slug(text(font, "family"));
    let weight = font["weight"].as_u64().unwrap_or(400);
    let style = text(font, "style");
    let static_url = font["previewFallbackUrl"]
        .as_str()
        .or_else(|| font["previewFileUrl"].as_str())
        .unwrap_or("");
    let candidate = if static_url.starts_with("https://cdn.jsdelivr.net/fontsource/fonts/")
        && static_url.ends_with(".woff2")
    {
        format!("{}.ttf", static_url.trim_end_matches(".woff2"))
    } else {
        format!(
            "https://cdn.jsdelivr.net/fontsource/fonts/{slug}@latest/latin-{weight}-{style}.ttf"
        )
    };
    if client
        .head(&candidate)
        .send()
        .is_ok_and(|r| r.status().is_success())
    {
        return Ok(candidate);
    }
    let url = format!(
        "https://fonts.googleapis.com/css?family={}:{}{}",
        encoded(text(font, "family")),
        weight,
        if style == "italic" { "italic" } else { "" }
    );
    let css = response(client, &url, true)?
        .text()
        .map_err(|e| e.to_string())?;
    let regex = regex::Regex::new(r"url\((https://[^)]+)\)").unwrap();
    let target = regex
        .captures(&css)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or("No installable TrueType file found")?;
    if !allowed(&url::Url::parse(&target).map_err(|e| e.to_string())?) {
        return Err("Untrusted font download".into());
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_ids_match_electron() {
        assert_eq!(
            record("google", "Open Sans", 400, false, "sans-serif")["id"],
            "google:opensans-400"
        );
        assert_eq!(
            record("bunny", "Open Sans", 700, true, "sans-serif")["id"],
            "bunny:opensans-700italic"
        );
        assert_eq!(slug("Open Sans"), "open-sans");
    }
    #[test]
    fn urls_are_restricted() {
        assert!(!allowed(
            &url::Url::parse("http://fonts.gstatic.com/a.ttf").unwrap()
        ));
        assert!(!allowed(
            &url::Url::parse("https://fonts.gstatic.com.attacker.test/a.ttf").unwrap()
        ));
        assert!(allowed(
            &url::Url::parse("https://fonts.gstatic.com/a.ttf").unwrap()
        ));
    }

    #[test]
    #[ignore = "Uses live provider services; run with pnpm check:providers"]
    fn live_catalogues_and_installable_downloads() {
        let client = client().unwrap();
        for provider in ["google", "bunny", "fontsource"] {
            let records = catalog(&client, provider).unwrap();
            assert!(
                records.len() > 100,
                "Unexpectedly empty {provider} catalogue"
            );
            let unique: HashSet<_> = records.iter().map(|font| text(font, "id")).collect();
            assert_eq!(unique.len(), records.len());
            let sample = records
                .iter()
                .find(|font| {
                    text(font, "family").eq_ignore_ascii_case("Inter")
                        && font["weight"] == 400
                        && font["style"] == "normal"
                })
                .unwrap();
            let target = resolve(&client, sample).unwrap();
            let bytes = download(&client, &target).unwrap();
            let face = ttf_parser::Face::parse(&bytes, 0).unwrap();
            assert_eq!(face.weight().to_number(), 400);
            assert!(bytes.starts_with(&[0, 1, 0, 0]) || bytes.starts_with(b"OTTO"));
            if provider == "fontsource" {
                let preview = download(&client, text(sample, "previewFileUrl")).unwrap();
                let decoded = crate::fonts::decode(&preview).unwrap();
                let variable = ttf_parser::Face::parse(&decoded, 0).unwrap();
                assert!(variable.is_variable());
            }
            println!(
                "{provider}: {} records; installable Inter 400 verified",
                records.len()
            );
        }
    }
}
