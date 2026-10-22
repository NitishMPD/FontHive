# Font Hive project
Author: Nitish

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

## Font installation and selection

- Install downloads missing font files and installs them through the existing OS activation path. Download remains a separate action.
- Install family installs every indexed style with the same provider-scoped family ID, regardless of current filters, skipping installed styles.
- Multi-selection supports individual checkboxes and modifier-clicks. Select all replaces the selection with every filtered, deduplicated result, including off-screen fonts.
- Install selected installs selected faces, skips already installed or stale IDs, and reports partial failures. Installation requests cannot overlap another busy library operation.
- Verification covers renderer selection, install requests, errors, and types; OS installation and provider network behavior require an installed-app check.

## Font list performance

- Keep the font grid virtualized with two extra rows on each side of the viewport.
- Defer new card preview loading until scrolling stops. Cards keep any preview
  already loaded; new cards use the UI font while scrolling.
- Keep card layout props stable so unchanged cards skip rendering during scroll.

