use crate::storage::{now, Result};
use scraper::{Html, Selector};
use serde_json::{json, Value};
use std::{collections::HashSet, io::Read, time::Duration};

pub fn is_site(id: &str) -> bool {
    matches!(id, "dafont" | "1001fonts")
}

fn allowed(id: &str, url: &url::Url) -> bool {
    let hosts: &[&str] = match id {
        "dafont" => &["www.dafont.com", "dafont.com", "dl.dafont.com"],
        "1001fonts" => &[
            "www.1001fonts.com",
            "1001fonts.com",
            "dl.1001fonts.com",
            "st.1001fonts.net",
        ],
        _ => &[],
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.host_str().is_some_and(|h| hosts.contains(&h))
}

pub fn fetch(id: &str, address: &str, limit: u64) -> Result<Vec<u8>> {
    let url = url::Url::parse(address).map_err(|e| e.to_string())?;
    if !allowed(id, &url) {
        return Err("Untrusted source URL".into());
    }
    let provider = id.to_string();
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() < 5 && allowed(&provider, attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Untrusted or excessive source redirects")
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("{id}: {e:#}"))?;
    if response.content_length().is_some_and(|n| n > limit) {
        return Err("Source response exceeds size limit".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Source response exceeds size limit".into());
    }
    Ok(bytes)
}

fn select(value: &str) -> Selector {
    Selector::parse(value).unwrap()
}
fn clean(value: String) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn absolute(id: &str, base: &url::Url, address: &str) -> Option<String> {
    base.join(address)
        .ok()
        .filter(|u| allowed(id, u))
        .map(|u| u.to_string())
}

pub fn catalog(id: &str, query: &str, page: u32) -> Result<(Vec<Value>, bool)> {
    if query.chars().count() > 120 || page == 0 || page > 10000 {
        return Err("Invalid source search or page".into());
    }
    let mut address: url::Url = match id {
        "dafont" => {
            if query.is_empty() {
                "https://www.dafont.com/new.php"
            } else {
                "https://www.dafont.com/search.php"
            }
        }
        "1001fonts" => {
            if query.is_empty() {
                "https://www.1001fonts.com/"
            } else {
                "https://www.1001fonts.com/search.html"
            }
        }
        _ => return Err("Unknown source".into()),
    }
    .parse()
    .unwrap();
    address
        .query_pairs_mut()
        .append_pair("page", &page.to_string());
    if !query.is_empty() {
        address
            .query_pairs_mut()
            .append_pair(if id == "dafont" { "q" } else { "search" }, query);
    }
    let bytes = fetch(id, address.as_str(), 4 * 1024 * 1024)?;
    // DaFont declares Windows-1252; ASCII markup/links remain valid and names are
    // replaced by parsed Unicode font metadata when the package is downloaded.
    let body = if id == "dafont" {
        bytes.iter().map(|b| char::from(*b)).collect()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    parse_catalog(id, &address, &body, page)
}

pub fn parse_catalog(
    id: &str,
    base: &url::Url,
    body: &str,
    page: u32,
) -> Result<(Vec<Value>, bool)> {
    let html = Html::parse_document(body);
    let mut records = Vec::new();
    let mut seen = HashSet::new();
    let mut add = |slug: &str,
                   family: String,
                   page_url: String,
                   download: String,
                   image: Option<String>,
                   license: String,
                   designer: String| {
        if slug.is_empty() || family.is_empty() || !seen.insert(slug.to_string()) {
            return;
        }
        records.push(json!({"id":format!("{id}:package:{slug}"),"provider":id,"family":family,
            "familyId":format!("{id}:package:{slug}"),"subfamily":"Font package","fullName":family,
            "postScriptName":"","format":"ttf","weight":400,"style":"normal","category":"other","axes":[],
            "cached":false,"active":false,"collections":[],"tags":[],"addedAt":now(),
            "packageUrl":download,"sourceUrl":page_url,"previewImageUrl":image,"packageOnly":true,
            "license":license,"designer":designer}));
    };
    if id == "dafont" {
        for header in html.select(&select(".lv1left")) {
            let link = header.select(&select("a[href$='.font']")).next();
            let family = link.map(|a| clean(a.text().collect())).unwrap_or_else(|| {
                let title = clean(
                    header
                        .children()
                        .filter_map(|c| c.value().as_text())
                        .map(|t| &**t)
                        .collect(),
                );
                title
                    .strip_suffix(" by")
                    .unwrap_or(&title)
                    .trim()
                    .to_string()
            });
            let mut page_url = link
                .and_then(|a| a.value().attr("href"))
                .and_then(|s| absolute(id, base, s));
            let mut download = None;
            let mut image = None;
            let mut license = "Check the bundled license; permissions vary by font".to_string();
            for sibling in header.next_siblings().filter_map(scraper::ElementRef::wrap) {
                if sibling.value().classes().any(|c| c == "lv1left") {
                    break;
                }
                if let Some(a) = sibling.select(&select("a.dl")).next() {
                    download = a.value().attr("href").and_then(|s| absolute(id, base, s));
                }
                if let Some(a) = sibling.select(&select("a.help")).next() {
                    license = clean(a.text().collect());
                }
                if sibling.value().classes().any(|c| c == "preview") {
                    if page_url.is_none() {
                        page_url = sibling
                            .select(&select("a[href$='.font']"))
                            .next()
                            .and_then(|a| a.value().attr("href"))
                            .and_then(|s| absolute(id, base, s));
                    }
                    if let Some(style) = sibling.value().attr("style") {
                        if let Some(start) = style.find("url(") {
                            image = style[start + 4..]
                                .split(')')
                                .next()
                                .and_then(|s| absolute(id, base, s.trim_matches(['\'', '"'])));
                        }
                    }
                }
            }
            let Some(download) = download else {
                continue;
            };
            let Some(slug) = url::Url::parse(&download).ok().and_then(|u| {
                u.query_pairs()
                    .find(|(k, _)| k == "f")
                    .map(|(_, v)| v.into_owned())
            }) else {
                continue;
            };
            let designer = header
                .select(&select("a[href*='.d']"))
                .next()
                .map(|a| clean(a.text().collect()))
                .unwrap_or_default();
            add(
                &slug,
                family,
                page_url.unwrap_or(base.to_string()),
                download,
                image,
                license,
                designer,
            );
        }
    } else if id == "1001fonts" {
        for item in html.select(&select("li.font-list-item")) {
            let Some(link) = item.select(&select("a.btn-download")).next() else {
                continue;
            };
            let Some(download) = link
                .value()
                .attr("href")
                .and_then(|s| absolute(id, base, s))
            else {
                continue;
            };
            let Some(slug) = download
                .rsplit('/')
                .next()
                .and_then(|s| s.strip_suffix(".zip"))
            else {
                continue;
            };
            let family = item
                .select(&select(".font-title"))
                .next()
                .map(|title| {
                    clean(
                        title
                            .children()
                            .filter_map(|c| c.value().as_text())
                            .map(|t| &**t)
                            .collect::<String>(),
                    )
                })
                .unwrap_or_default();
            let page_url = item
                .select(&select("a.preview-link"))
                .next()
                .and_then(|a| a.value().attr("href"))
                .and_then(|s| absolute(id, base, s))
                .unwrap_or(base.to_string());
            let image = item
                .select(&select("picture.txt-preview img"))
                .next()
                .and_then(|i| i.value().attr("src"))
                .and_then(|s| absolute(id, base, s));
            let license = item
                .select(&select("a[href$='#license']"))
                .next()
                .and_then(|a| a.value().attr("title"))
                .map(|s| clean(s.replace("<br>", " ")))
                .unwrap_or("Check the bundled license; permissions vary by font".into());
            let designer = item
                .select(&select("a[rel='author']"))
                .next()
                .map(|a| clean(a.text().collect()))
                .unwrap_or_default();
            add(
                slug,
                family,
                page_url,
                download.clone(),
                image,
                license,
                designer,
            );
        }
    }
    let next = html.select(&select("a[href]")).any(|a| {
        a.value()
            .attr("href")
            .and_then(|s| base.join(s).ok())
            .is_some_and(|u| {
                allowed(id, &u)
                    && u.path() == base.path()
                    && u.query_pairs()
                        .any(|(k, v)| k == "page" && v.parse::<u32>().ok() == Some(page + 1))
            })
    });
    let page_text = clean(html.root_element().text().collect());
    if records.is_empty()
        && !page_text.contains("0 font on DaFont")
        && !body.contains("No fonts found")
        && !body.contains("No results")
        && !body.contains("No font found")
    {
        return Err(format!("{id} returned no recognizable fonts. The site may have blocked access or changed its catalogue; existing fonts were kept."));
    }
    Ok((records, next))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_source_urls() {
        for address in [
            "https://dafont.com.evil.test/a",
            "http://www.dafont.com/a",
            "file:///C:/a",
            "https://user@www.dafont.com",
            "https://127.0.0.1",
            "https://www.dafont.com:8443",
        ] {
            assert!(!allowed("dafont", &address.parse().unwrap()));
        }
    }
    #[test]
    fn parses_both_site_layouts_without_fabricating_faces() {
        let base = "https://www.dafont.com/new.php".parse().unwrap();
        let (fonts, more) = parse_catalog("dafont", &base, r#"<div class="lv1left"><a href="example.font"><strong>Example &amp; Co</strong></a></div><div><a class="help">Personal use only</a></div><div><a class="dl" href="//dl.dafont.com/dl/?f=example">Download</a></div><div class="preview" style="background-image:url(/img/preview/e.png)"></div><a href="new.php?page=2">Next</a>"#, 1).unwrap();
        assert_eq!(fonts[0]["family"], "Example & Co");
        assert_eq!(fonts[0]["packageOnly"], true);
        assert!(more);
        let base = "https://www.1001fonts.com/".parse().unwrap();
        let (fonts, _) = parse_catalog("1001fonts", &base, r#"<li class="font-list-item"><span class="font-title">Example<small>by Designer</small></span><a class="btn-download" href="/download/example.zip">Download</a><a class="preview-link" href="/example-font.html"><picture class="txt-preview"><img src="//st.1001fonts.net/img/example.png"></picture></a></li>"#, 1).unwrap();
        assert_eq!(fonts[0]["family"], "Example");
        assert_eq!(
            fonts[0]["packageUrl"],
            "https://www.1001fonts.com/download/example.zip"
        );
        assert!(parse_catalog("1001fonts", &base, "<h1>Access denied</h1>", 1).is_err());
        assert!(
            parse_catalog("1001fonts", &base, "<li>No fonts found!</li>", 1)
                .unwrap()
                .0
                .is_empty()
        );
        let base = "https://www.dafont.com/search.php?q=sans".parse().unwrap();
        let (fonts, _) = parse_catalog("dafont", &base, r#"<div class="lv1left">Sand by <a href="designer.d1">Designer</a></div><div><a class="dl" href="//dl.dafont.com/dl/?f=sand">Download</a></div><div class="preview" style="background-image:url(/img/preview/sand.png)"><a href="sand.font"></a></div>"#,1).unwrap();
        assert_eq!(fonts[0]["family"], "Sand");
        assert_eq!(fonts[0]["sourceUrl"], "https://www.dafont.com/sand.font");
        assert!(parse_catalog(
            "dafont",
            &base,
            "<div>0 font on DaFont for <b>missing</b></div>",
            1
        )
        .unwrap()
        .0
        .is_empty());
    }

    #[test]
    #[ignore = "Live source downloads; no OS installation"]
    fn live_native_sources_and_packages() {
        let root = std::env::temp_dir().join(format!(
            "font-hive-source-check-{}-{}",
            std::process::id(),
            now()
        ));
        std::fs::create_dir(&root).unwrap();
        let result = std::panic::catch_unwind(|| {
            for id in ["dafont", "1001fonts"] {
                let (catalog, more) = catalog(id, "", 1).unwrap();
                assert!(!catalog.is_empty());
                assert!(more);
                let (second, _) = super::catalog(id, "", 2).unwrap();
                assert!(!second.is_empty());
                let (search, _) = super::catalog(id, "sans", 1).unwrap();
                assert!(!search.is_empty());
                let faces = crate::imports::package(&root, &catalog[0]).unwrap();
                assert!(!faces.is_empty());
                assert!(faces
                    .iter()
                    .all(|f| f["parsedIdentity"] == true && f["filePath"].is_string()));
                println!(
                    "{id}: {} packages on first page, {} parsed faces in sample package",
                    catalog.len(),
                    faces.len()
                );
            }
        });
        let absolute = root.canonicalize().unwrap();
        assert!(absolute.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        std::fs::remove_dir_all(absolute).unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
}
