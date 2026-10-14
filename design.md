# Font Hive design

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
- Match Needle's user-controlled flow: notify in the title bar, offer Settings
  controls to check, download with progress, view notes, and restart to install.
- Never force a restart or install on ordinary app quit. Keep errors visible
  and allow retries. Allow only stable upgrades, never automatic downgrades.
- Before restarting, block new library actions, verify existing operations have
  completed, and await persistence. Failed preparation retains the downloaded
  update and keeps the app running.
- Keep data anchored to `%APPDATA%/font-hive` across development and packaged
  versions, and allow only one instance to avoid install conflicts.
