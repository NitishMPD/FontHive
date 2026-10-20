# Font Hive project
Author: Nitish

Font Hive is a local-first font manager for Windows 10/11 x64. The React,
TypeScript, Zustand and virtualized-grid frontend runs in Tauri 2 using the
shared Evergreen WebView2 runtime. Rust owns persistence, font parsing,
scanning, catalogue requests, downloads, activation and update installation.
No Electron, Node runtime, Chromium bundle, Fontkit or Koffi ships with the app.

## Behavior and architecture

- Preserve the existing FontManagerApi through a TypeScript Tauri adapter.
  Commands are restricted to the local main window; remote pages receive no
  native capabilities. The CSP allows only the existing preview providers.
- Keep stable provider/PostScript-name IDs, collections, pairs, tags, favorites,
  ratings, notes, settings and activation records from the Electron library.
- Keep data in %APPDATA%/font-hive in development and production. Before the
  first Tauri read, copy library.json and activated.json to their respective
  .pre-tauri files without overwriting an existing backup.
- Retain JSON BOM handling, corruption quarantine and atomic replacement with
  write-through on Windows. Genuine read/permission errors must remain errors.
- A single background command queue serializes library mutations. Font parsing
  and filesystem/network operations run outside the UI thread. Local preview
  reads use an independent ID-to-file index and never expose arbitrary paths.
- Parse TTF, OTF, TTC, OTC, WOFF and WOFF2 with ttf-parser and wuff. Collections
  retain faceIndex; previews extract the selected face into a standalone sfnt.
  Preserve PANOSE classification, variable axes, names and pairing metrics.
- Scan system directories and enabled local/network folders. Do not follow
  junctions/symlinks. Inaccessible directories and parse errors must not erase
  existing records. Startup refreshes watched folders; initial/legacy libraries
  receive a system scan as well.
- Google, Bunny and Fontsource catalogues retain their original IDs and preview
  endpoints. Network requests are HTTPS, limited to provider hosts, time-bounded
  and size-bounded. Downloads must validate as installable sfnt files.
- Activation is per-user under LOCALAPPDATA/Microsoft/Windows/Fonts and HKCU's
  Windows font key. Use native AddFontResourceW/RemoveFontResourceW and
  WM_FONTCHANGE notification, preserving activated.json reconciliation.
- Compare Windows activation/registry paths case-insensitively with slash and
  backslash separators normalized; equivalent paths must not trigger a conflict.
- A data-directory file lock prevents concurrent Tauri writers. Refuse startup
  while the legacy Font Hive.exe process is running. Close the Electron app
  before installing/running Tauri; do not run both versions against one library.
- Close requests during library operations are rejected with a visible message;
  writes finish before a normal close. No restart occurs on ordinary app quit.

## Distribution and updates

- Windows x64 NSIS, current-user installation with directory selection; preserve
  application data on uninstall. Keep com.nitishmpd.fonthive as the identifier.
- Use Nitish as the installer publisher metadata. Keep NitishMPD as the GitHub
  repository owner. Verified Windows signer identity requires an Authenticode
  certificate and cannot be changed by updater signatures or publisher metadata.
- Use downloadBootstrapper for Evergreen WebView2. The app installer excludes
  the runtime; a machine missing it needs an internet connection during setup.
- Continue release checks and run-number versioning on master/main. Upload the
  installer, .sig and tauri-latest.json to a draft before publishing it. Never
  overwrite a published version. Failed checks/builds/signing prevent release.
- Release signing requires TAURI_SIGNING_PRIVATE_KEY and, when encrypted,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD. The initial private key is ignored under
  .keys/tauri-updater.key; its public key is committed in tauri.conf.json. Back
  up the private key securely and preserve it for future releases.
- Tauri updater signatures verify update authenticity. They do not provide
  Windows Authenticode publisher identity or remove SmartScreen warnings.
  Windows code signing and other platform installers remain separate work.
- Check for stable upgrades after ten seconds and every six hours; never in
  development. Keep user-controlled download, progress, release notes and
  explicit Restart and install. Block new operations during installation;
  refuse an install while library work is active and flush before launching it.
  Failed preparation retains the package and allows retry.
- Electron latest.yml/blockmaps and Tauri update manifests are incompatible.
  Existing Electron users must migrate manually for this release: close and
  uninstall the old app (which retains data), then install the Tauri release.
  Do not point Electron's updater feed at a Tauri installer.

## Verification boundaries

- Project Tauri and Cargo scripts resolve Rust from the existing PATH, CARGO_HOME,
  and the standard user .cargo/bin directory without modifying system settings.
  Normal Windows compilation still requires the Microsoft C++ toolchain/SDK.
- Project commands default the updater-key password to an empty string, matching
  the initial local key, and honor an explicit TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  for encrypted keys. No interactive password prompt is required for that key.

- Allowed local checks: pnpm typecheck, pnpm check:scroll, pnpm check:fuzzy,
  pnpm check:updates, pnpm check:providers, cargo check, and focused Rust unit tests. Rust 1.90+ and
  the Windows C++ Build Tools/SDK are prerequisites for normal native checks.
- Builds, app launches, installer migration and update end-to-end checks are
  user-run. Packaging command: pnpm dist:win. Load the ignored local signing
  key through TAURI_SIGNING_PRIVATE_KEY before packaging updater artifacts.
- The user-built Windows x64 0.1.0 NSIS installer measured 2.43 MiB (2,547,187
  bytes), excluding WebView2. Its updater signature was generated successfully.
  This is one measured build, not a guaranteed size. Check installed footprint, startup, large libraries, previews,
  activation visibility, first-run WebView2 setup and two-version updates.

## Historical Electron requirements (superseded where specified above)

These requirements are retained verbatim from the former mixed design.md.
The Tauri sections above describe the replacement implementation.

Font Hive is a local-first desktop font manager. Users browse and preview fonts,
download installable files, activate fonts, and organise their library. The
existing Electron, React and TypeScript application owns these interactions;
font data stays in Electron's existing user data directory.

## Windows distribution

- Ship an unsigned Windows x64 NSIS installer through GitHub Releases.
- Let users choose the installation directory and install for the current user.
- Preserve library data when uninstalling; keep the app's existing data paths.
- Package the production output, application icon, and runtime dependencies.
  Unpack Koffi from the archive so native Windows font notifications can load.
- Every push to `master` (the current default branch) or `main` triggers checks,
  packaging, and a release with generated
  notes. CI adds its workflow run number to the base version's patch number,
  without committing generated versions back to the repository.
- Publish the installer, blockmap, and `latest.yml` together through a draft so
  the public update feed never advertises an incomplete release.
- Build or check failures must stop release creation. Never overwrite a
  published version when a workflow is rerun.
- Code signing and other platform installers are outside this workflow.

## In-app updates

- The installed Windows x64 app checks public GitHub Releases on launch and
  every six hours, using Electron Updater's existing GitHub provider and hash
  verification. Development mode does not check for updates.
- Never force a restart or install on ordinary app quit. Keep errors visible
  and allow retries. Allow only stable upgrades, never automatic downgrades.
- Before restarting, block new library actions, verify existing operations have
  completed, and await persistence. Failed preparation retains the downloaded
  update and keeps the app running.
- Keep data anchored to `%APPDATA%/font-hive` across development and packaged
  versions, and allow only one instance to avoid install conflicts.
