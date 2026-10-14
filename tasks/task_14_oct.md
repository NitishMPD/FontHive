# Tasks - 14 October 2026

## Completed: Windows GitHub releases

- Added Electron Builder and `pnpm dist:win` to package an unsigned Windows
  x64 NSIS installer, including the icon and unpacked Koffi native runtime.
- Added `.github/workflows/release.yml`: matching version tags run checks,
  build the installer, and create a GitHub Release with generated notes.
- Documented release steps in README and distribution decisions in `design.md`
  with author Nitish. No branch, commit, push, or deployment was performed.
- Verified Electron Builder configuration against its schema, parsed workflow
  YAML, tested matching and mismatched tags, and checked icons and preservation
  of app data. Fuzzy-search checks and focused diff whitespace checks passed.
- Typechecking failed in existing concurrent `PairsView.tsx` changes at lines
  145 and 159; these must be fixed before the release workflow can succeed.
- No application build or installer execution was run. To verify locally on
  Windows after typechecking passes, run `pnpm dist:win` and test the installer
  from `dist/`. Windows may warn because the installer is unsigned.

## Completed: Automatic main releases and in-app updates

- Changed the release trigger to pushes on `main`; CI assigns a stable version
  from the base version and workflow run number, and generates the matching tag
  at the pushed commit. No manual version bump or tag is needed.
- Added Electron Updater and publication of the installer, blockmap, and
  `latest.yml` through a draft before the release becomes public.
- Matched Needle's check/download/restart flow with launch and six-hour checks,
  a title-bar notice, and Settings controls for progress, retry, and release notes.
- Disabled updates in development, automatic installation on quit, prereleases,
  downgrades, and web installers. Restart requires finished library operations
  and successful persistence; a failed save leaves the app running.
- Added single-instance protection, anchored user data, and main-window checks
  on IPC. Existing library operations are tracked to protect update restarts.
- Updated README and design. Verified the GitHub repository is public.
- `pnpm typecheck` now passes after the concurrent pairing changes were fixed.
  `pnpm check:updates` passes, covering automatic versions, lifecycle states,
  concurrent requests, failures/retries, save/restart ordering, and development.
- Workflow YAML, publication PowerShell syntax, Electron Builder schema,
  lockfile consistency, focused whitespace checks, and the UI detector passed.
- No build, app launch, push, or publication was performed. Run `pnpm dist:win`
  to test packaging, then install one published version and publish a second to
  test the actual download and restart path. Installers remain unsigned.
