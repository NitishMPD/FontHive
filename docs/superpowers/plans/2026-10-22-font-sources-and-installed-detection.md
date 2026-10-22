# Font sources and installed detection implementation plan
Author: Nitish

**Goal:** Add sources and reliable installed status while keeping discovery, previews, downloads, selection and installation inside Font Hive's existing native UX.

**Architecture:** Tauri 2/Rust owns catalogue HTTP requests, HTML parsing, ZIP imports, font metadata, installed inventory and serialized mutations. React/Zustand retain the existing toolbar, virtualized cards, detail panel and selection flow. Provider IDs remain stable. No embedded website or external discovery flow.

**Execution constraints:** No subagents, new branches, commits, pushes, deployment, application builds, app launches or dev servers. Type checks, focused unit tests and read-only/live network checks are allowed. The user authorized resolving the Electron-to-Tauri merge conflicts while preserving existing installation/selection changes; no merge commit is made.

## 1. Resolve the migration and retain native UX

- [x] Resolve `package.json`, `project.md` and `design.md` conflicts, keeping Tauri and existing installation/selection work.
- [x] Keep the existing frontend components and desktop API adapter; no alternate website UI.
- [x] Keep privileged command checks tied to the local main webview. Remote source markup is parsed as data and receives no app capabilities.

## 2. Native DaFont and 1001 Fonts adapters

**Owners:** `src-tauri/src/sources.rs`, `src-tauri/src/backend.rs`, `src/shared/types.ts`, `src/renderer/src/lib/desktop.ts`, `src/renderer/src/store.ts`.

- [x] Fetch public catalogue pages with bounded HTTPS requests and exact source/redirect host restrictions. Parse names, attribution, license labels, specimen images and actual ZIP links with an HTML parser.
- [x] Support newest fonts, remote search, pagination, genuine empty results and visible blocked/schema errors. Preserve previously indexed records, downloads and user metadata on refresh/search.
- [x] Preserve site search matches that expand a query, such as DaFont returning Sand for sans, instead of discarding them in local filtering.
- [x] Represent undownloaded entries as packages with unknown styles. Do not fabricate a verified regular face or use package display defaults for installation identity.

## 3. Font package download and import

**Owners:** `src-tauri/src/imports.rs`, `src-tauri/src/fonts.rs`, `src-tauri/src/backend.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.

- [x] Use the existing Download action to fetch and parse ZIP packages; Download never activates fonts. Import real TTF/OTF/TTC/OTC faces and preserve the selected record ID so its detail panel, selection and metadata survive.
- [x] Import every included face. Install on an undownloaded package and Install family include styles discovered during download. Allow a removed/missing cached face to be downloaded again from its package.
- [x] Preserve license/readme text and source attribution as inert data. Validate all package paths and bounds before exposing records; ignore executable and unsupported content.
- [x] Enforce 64 MiB downloads, 256 archive entries, 32 MiB per entry and 128 MiB expanded output. Reject traversal, absolute paths, symlinks, encrypted archives, malformed payloads and invalid fonts. Flatten validated files into the app's content-addressed package cache.
- [x] Add direct Rust dependencies on `scraper`, `zip` and `sha2`: HTML and ZIP are external formats needing maintained parsers; SHA-256 supplies stable binary identity. No new JavaScript dependency or provider framework.

## 4. Installed inventory, duplicate prevention and ownership

**Owners:** `src-tauri/src/installed.rs`, `src-tauri/src/activation.rs`, `src-tauri/src/backend.rs`, `src-tauri/src/fonts.rs`.

- [x] Read HKCU/HKLM registrations, normalize relative/expanded paths, parse supported registered files outside standard directories, and distinguish installed fonts from watched-folder or cached files.
- [x] Track exact decoded-binary hash and collection face identity independently of provider IDs. Undownloaded remote names alone are not proof of an installed match.
- [x] Keep `active` as installed availability; project a separate `managedInstall` flag only onto the installation owner. Verified aliases show Installed without gaining removal rights.
- [x] Reconcile app ownership on startup/rescan and before installation. Refresh the inventory after mutations; cache unchanged file metadata/hashes so family installation does not repeatedly hash the whole OS font library.
- [x] Recheck installation in the serialized backend, skip exact duplicates, report changed/skipped/failed separately, reject different binaries sharing a PostScript name, and create destination files exclusively.
- [x] Do not adopt or overwrite existing destinations/registrations. Roll back newly created installation artifacts if registration or ownership persistence fails.
- [x] Restrict remove-file commands to canonical app-cache paths. Protect external/system/watched-folder source files and reject deactivation of non-owning records. Keep inventory errors visible and block blind installation.

## 5. Consistent renderer behavior

**Owners:** `FontCard.tsx`, `DetailPanel.tsx`, `Toolbar.tsx`, `ProvidersView.tsx`, `Sidebar.tsx`, `SettingsView.tsx` under `src/renderer/src/components/`; `src/renderer/src/lib/filter.ts`; `src/renderer/src/styles.css`.

- [x] Reuse native cards/details and accessible selection/install controls for every source. Automatically load further pages near the grid end, with compact Search source / Load more controls for keyboard access and retry; Enter searches the selected source. Show loaded counts and blend specimen images into the active theme.
- [x] Use the site's specimen in the usual preview area before download. After download, use Font Hive's existing custom text, metadata, real styles and variable-axis previews.
- [x] Show Installed badges and ownership-specific detail status. Disable deactivation on external installations and aliases; enforce the same rule in the store and backend.
- [x] Count identical installed aliases once. Keep downloaded filtering separate from installed filtering; rename the existing Active label to Installed. Preserve static/variable/width distinctions during visual grouping and never collapse unverified packages by guessed face metadata.
- [x] Show bundled licenses/readmes in an expandable text section. Retain the existing toasts, busy states, keyboard selection, layout and virtualization.

## Verification

Focused deterministic checks:

```text
pnpm run typecheck
pnpm run check:install
pnpm run check:fuzzy
pnpm run check:scroll
node tools/desktop.cjs cargo check --manifest-path src-tauri/Cargo.toml
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml sources::tests
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml imports::tests
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml installed::tests
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml backend::tests
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml activation::tests
```

Explicit live/read-only checks:

```text
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml sources::tests::live_native_sources_and_packages -- --ignored --nocapture
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml installed::tests::live_windows_inventory_is_read_only -- --ignored --nocapture
node tools/desktop.cjs cargo test --manifest-path src-tauri/Cargo.toml backend::tests::live_package_download_preserves_ids_metadata_and_redownloads -- --ignored --nocapture
```

The live source check verified 25 DaFont packages and 12 1001 Fonts packages on their first pages, second pages, remote searches and actual sample font ZIP imports. The backend check verified stable IDs, metadata preservation and missing-file redownloads. The Windows check verified 535 installed faces and cached refreshes without modifying fonts or registrations. These are observations on this machine, not guaranteed source counts.

`tools/install-check.cjs` covers family/selection behavior, skipped duplicates, ownership-limited deactivation, unique installed totals, static/variable separation, package grouping, remote search forwarding and expanded remote query matches. Rust checks cover catalogue layouts and unsafe hosts, archive paths/limits/executables, identity/conflicts and metadata preservation. No app/installer/UI launch is performed.

## Remaining user-run verification and boundaries

Run the installed app to check real previews/layout, first catalogue fetch, remote search, pagination, download, family/selected install, font visibility in another Windows app, and rescan after external removal. Verify that duplicate installs are skipped and external fonts remain untouched. If packaging is needed, run `pnpm run dist:win` with the project's signing environment.

FontSpace, Fontshare, Font Squirrel, curated foundries, paid/authenticated sources, archive formats other than ZIP, automatic duplicate deletion and font version replacement remain outside this first implementation. FontSpace returned HTTP 403 during investigation and Fontshare served a JavaScript shell, so neither is advertised as a working native source.

Site HTML/download behavior may change; show a source error and retain the library. Catalogue-only records need a verified download before exact installed identity is known. Source specimen images are static until download; custom text/axes then use the parsed fonts. Installed matching deliberately rejects different binaries with the same PostScript name instead of replacing them.
