# Font Library

A personal font manager for Windows. Indexes every font on the machine alongside
downloadable catalogues, renders live previews, installs and removes fonts from
the OS, and organises everything with collections and smart filters.

Built with Electron, React and TypeScript, using [fontkit](https://github.com/foliojs/fontkit)
for font parsing.

## Features

**Library**
- Recursive scanning of system font directories plus any folders you add, including network shares
- Watched folders are re-scanned in the background on launch, so newly added fonts appear
  without a manual refresh; removing a folder also removes the faces it contributed
- Catalogue fetches are de-duplicated, so families listed twice under different slugs
  or types cannot produce duplicate library entries
- TrueType collections (`.ttc`/`.otc`) are expanded into their individual faces
- Category classification from the font's PANOSE record, not just its name
- Virtualised grid, so tens of thousands of faces stay smooth
- Live preview text, adjustable size and column count

**Providers** — catalogue sources you can browse and download from

| Provider | Families | Notes |
| --- | --- | --- |
| Google Fonts | 1,950 | Catalogue from the public metadata endpoint |
| Bunny Fonts | 1,971 | Privacy-focused Google Fonts mirror |
| Fontsource | 2,103 | Open-source fonts served via jsDelivr |
| Local & network folders | — | Your own collections |

Catalogue faces preview instantly through the provider's CSS endpoint without
downloading anything. Downloading fetches an installable file into the local
cache.

**Activation**
- Per-user install into the Windows font store, registered under
  `HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`
- Running applications are notified immediately via `AddFontResourceW` and a
  `WM_FONTCHANGE` broadcast, so no reboot or sign-out is needed
- Deactivation removes the registry entry and the installed file
- Activation state is reconciled against the registry on every launch

**Controls**
- Variable font axes driven by sliders, applied live to the preview
- Collections, both manual and rule-based ("smart") with `all`/`any` matching
- Tags, 1–5 star ratings and free-text notes per face
- Filters for category, provider, active state, downloaded state and variability

## Why downloads are always TTF or OTF

Web font formats (`.woff`, `.woff2`) cannot be installed as system fonts by
Windows. Catalogue previews therefore use whatever format the provider serves,
but any download resolves to an installable TrueType/OpenType file. Fontsource
is preferred as a download source because it publishes stable `.ttf` paths; the
Google legacy endpoint is the fallback.

## Getting started

```bash
pnpm install
pnpm dev          # development, with hot reload
pnpm build        # production build into out/
pnpm preview      # run the production build
```

Other scripts:

```bash
pnpm typecheck       # typecheck main/preload and renderer
pnpm check:providers # verify provider catalogues and the native binding
```

> **Running from a terminal launched by another Electron app (such as DSH):**
> the environment may carry `ELECTRON_RUN_AS_NODE=1`, which makes Electron start
> as plain Node and fail with `Cannot read properties of undefined (reading
> 'registerSchemesAsPrivileged')`. Clear it first:
> `Remove-Item Env:ELECTRON_RUN_AS_NODE`

## Layout

```
src/
  shared/types.ts        Contract shared by main, preload and renderer
  main/
    index.ts             App lifecycle, IPC, rea-font:// protocol, downloads
    store.ts             Debounced atomic JSON persistence
    fonts/
      scanner.ts         Directory walking with bounded concurrency
      metadata.ts        fontkit parsing, PANOSE classification, variable axes
      activation.ts      Windows font install/remove and native notification
    providers/           One module per catalogue source
  preload/index.ts       contextBridge API surface
  renderer/src/
    components/          Sidebar, grid, detail panel, management views
    lib/                 Font loading, filtering and smart-rule evaluation
```

Fonts are served to the renderer over a custom `rea-font://` protocol rather
than `file://`, so the renderer keeps `contextIsolation` with no filesystem
access of its own.

## Data locations

State lives under Electron's `userData` directory (`%APPDATA%\fb-rea`):

- `library.json` — the indexed library, collections, folders and settings
- `activated.json` — which faces are installed and where
- `font-cache/` — downloaded installable files

Deleting `library.json` forces a full re-index on next launch.
`schemaVersion` in that file invalidates derived fields when the classification
logic changes, re-indexing local faces automatically.

The reader tolerates a UTF-8 BOM, since editors, PowerShell redirection and
backup tools commonly add one and `JSON.parse` rejects it — without that, a
perfectly recoverable file would be quarantined. A file that is genuinely
unparseable is renamed to `library.json.corrupt-<timestamp>` and the app starts
with an empty library rather than failing to launch.

## Notes and limitations

- Activation is implemented for Windows. macOS and Linux fall back to copying
  into the user font directory; Linux additionally runs `fc-cache`.
- Google and Bunny serve static instances per weight, so a downloaded face has
  no variable axes even when the catalogue entry advertises them. Local variable
  fonts keep full axis control.
- Fonts are analysed and stored locally. Catalogue requests go only to the
  provider endpoints listed above.
