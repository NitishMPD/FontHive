# Font sources and installed detection implementation plan
Author: Nitish

**Goal:** Add genuinely useful font sources, identify fonts already installed on Windows, prevent duplicate installation, and show accurate installation status throughout Font Hive.

**Execution:** Implement inline, task by task. Do not use subagents, create branches, commit, push, deploy, build, launch the app, or start a dev server unless the user explicitly changes those constraints.

**Architecture:** Keep provider records and their stable IDs. Add an OS installation inventory in the main process, separate installation ownership from availability, and perform the final duplicate check inside the existing serialized activation path. Extend the existing `Provider` contract for new sources rather than introducing another provider framework.

**Tech stack:** Electron, TypeScript, React, Zustand, fontkit, Node filesystem/crypto, existing Windows registry and Koffi integration. Use pnpm; no new dependency is needed for the detection work.

## Findings from the current code

- Existing remote sources: Google Fonts, Bunny Fonts, Fontsource. Bunny is explicitly a Google mirror and resolves installable downloads through Google; another mirror alone will not substantially expand the library.
- `src/main/providers/types.ts` already separates preview URLs from installable TTF/OTF downloads.
- `makeId()` and `makeFamilyId()` in `src/main/fonts/scanner.ts` include the provider. Preserve these IDs because selections, collections, pairs, metadata, and activation bookkeeping depend on them.
- `Activator` in `src/main/fonts/activation.ts` tracks provider IDs in `activated.json`. Its registry query reads HKCU only. It does not discover all fonts installed outside Font Hive.
- `scanFolder()` parses system directories and watched folders identically and initializes every face with `active: false`. Finding a font in a watched folder does not establish OS installation.
- `reconcileActive()` in `src/main/index.ts` derives status exclusively from app-owned activation IDs. A remote record and a local scan of the installed copy do not share status.
- `dedupeFaces()` in `src/renderer/src/lib/filter.ts` groups by family, weight, and style. This is a browsing heuristic, not proof that two files are interchangeable. It also conflates some static/variable or width variants.
- `onlyInstalled` currently checks `filePath`, which includes downloaded but uninstalled files. `onlyActive` checks `active`.
- `Activator.activate()` can overwrite a destination with `copyFile`, and Windows registration uses `/f`. Different provider IDs do not prevent destination or registry-name collisions.
- `uninstall-font-file` can unlink `font.filePath` even for local records. Expanding installed status must include ownership protection here, not merely disable a renderer button.
- The working tree already contains installation/selection work. Preserve it and extend its checks; do not replace or revert it.

## Required behavior and invariants

1. A downloaded file, a file in a watched folder, and an OS-installed face are distinct states.
2. Mark every verified provider alias of an installed face as **Installed**, including installations made outside Font Hive.
3. Track ownership separately. Only the Font Hive record that owns an installation can deactivate it. An external installation or another provider's alias must never acquire deletion rights through matching.
4. Keep provider-scoped family installation: install only missing faces in that source's family, independent of the current filters.
5. One install request or concurrent requests for the same physical face must produce at most one OS installation. Already installed faces are skipped, not reported as newly installed.
6. Never overwrite a different installed file or registry entry automatically. Return a visible conflict with the affected face; replacement/version upgrades are outside this change.
7. Family/weight/style matches are hints, not installation proof. Preserve distinctions between width, static/variable forms, axis ranges, versions, and collection faces.
8. Registry/inventory failure is an error or unknown state, not an authoritative empty inventory. Do not clear ownership or install blindly after a failed inventory refresh.
9. Keep existing IDs, user metadata, cached downloads, and source attribution. Do not merge or delete records as a deduplication strategy.

## Task 1: Inventory installed Windows fonts and separate ownership

**Files:** `src/main/fonts/activation.ts`, `src/main/fonts/scanner.ts`, `src/main/fonts/metadata.ts`, `src/main/index.ts`, `src/shared/types.ts`, `src/main/store.ts`; create `src/main/fonts/installed.ts` and `tools/installed-check.cjs`.

- [ ] Add a main-process installation inventory using HKCU and HKLM font registrations. Resolve bare filenames against the correct Windows fonts directory, expand environment variables, normalize path case, deduplicate physical paths, and parse every face in TTC/OTC collections with existing `parseFontFile()`.
- [ ] Reuse the existing registry access, extending its result so a missing key is distinguishable from permission/query failure. Preserve reconciliation behavior for app-owned entries without erasing them on query failure. Use `%WINDIR%` and `%LOCALAPPDATA%` instead of assuming `C:\\Windows` or the default profile location.
- [ ] Parse registered files even when they live outside standard font directories. A folder scan remains discovery of files, not the source of truth for installed status.
- [ ] Give inventory entries parsed identity, absolute path, version/axis information, file SHA-256 computed once per physical file, and an optional app owner ID from `activated.json`. Keep multiple physical entries for duplicate installations; do not collapse them before matching.
- [ ] Keep `FontRecord.active` meaning available through OS installation, as its current shared comment promises. Add a separate `managedInstall: boolean` projection that is true only for the exact owner ID. Add `installationStatus: 'known' | 'unknown'` so failures cannot render a false Not installed state.
- [ ] Derive these fields in the main process after bootstrap inventory, rescans, provider refreshes, downloads, installs, and removals. Overwrite legacy persisted flags after inventory succeeds; do not infer ownership from `active`, `cached`, or path location. Do not change provider IDs or require a destructive local-record schema reset.
- [ ] Refresh inventory once on startup, on explicit Rescan, and before an installation batch. Update it after each successful mutation. Start with these boundaries; no filesystem watcher is needed.
- [ ] Add fixture checks for HKCU/HKLM paths, relative paths, environment expansion, inaccessible keys, absent keys, collections, external paths, and a watched-folder font that is not installed. Mock Electron and registry commands; never mutate the real font store.

**Proof:** `node tools/installed-check.cjs` passes and performs no OS writes.

## Task 2: Match aliases and prevent duplicate installation at the owner

**Files:** `src/main/fonts/installed.ts`, `src/main/fonts/activation.ts`, `src/main/index.ts`, `src/shared/types.ts`, `src/renderer/src/store.ts`, `tools/installed-check.cjs`, `tools/install-check.cjs`.

- [ ] Match exact binary hashes as exact file duplicates; distinguish individual faces in collections. For non-identical files, compare parsed PostScript identity plus style/weight, relevant axes/width, and version where available. Ambiguous or materially different versions remain conflicts rather than silent skips.
- [ ] Do not treat provider-generated PostScript names as parsed evidence. The existing providers synthesize names such as `Family-400`, while installed files may declare `Family-Regular`.
- [ ] Before downloading, mark a catalogue alias Installed only when there is a verified mapping to the same parsed face (for example, a previous validated download or an authoritative provider manifest). Otherwise expose a possible match in details without claiming certainty. On an install request, download to the cache, parse and match before writing to the OS store. Preserve that validated alias mapping for later launches and catalogue refreshes, invalidating it when its source identity changes.
- [ ] Perform duplicate resolution and destination/registry collision checks within `Activator`'s existing serial queue. Refresh/recheck the inventory there when needed; a renderer `busy` flag cannot prevent IPC races. Use exclusive destination creation and clean up only artifacts created by the failing attempt. Do not use `/f` to replace an unrelated registration.
- [ ] Extend the activation result so callers can distinguish changed and skipped IDs:

```ts
export interface ActivationResult {
  changed: string[]
  skipped: string[]
  failed: { id: string; error: string }[]
}
```

- [ ] Update all activation/deactivation result producers, renderer consumers, and test mocks. Report newly installed, already installed, and failed counts accurately; retain partial success and selection for retry.
- [ ] When a managed installation is removed, recompute every alias. Any surviving external installation keeps matching aliases Installed. An alias is never itself an owner.
- [ ] Protect deactivation and `uninstall-font-file` in main-process code. Reject removal of externally owned installations; limit cache deletion to files actually owned by the app cache, with resolved path containment checks. Do not delete a watched-folder source file as part of removing its managed OS installation.
- [ ] Add assertions for the same binary across two providers, repeated IDs, concurrent requests, external installation, aliases sharing one owner, static versus variable, different axis ranges/widths, different versions, filename collision, registry collision, failed registration cleanup, and inventory-query failure.

**Proof:** `node tools/installed-check.cjs` and `pnpm run check:install` pass, including a mocked concurrent activation test that observes exactly one physical install.

## Task 3: Show status consistently and retain accessible controls

**Files:** `src/renderer/src/components/FontCard.tsx`, `DetailPanel.tsx`, `Toolbar.tsx`, `Sidebar.tsx`, `SettingsView.tsx`, `ProvidersView.tsx` (all under `src/renderer/src/components/`), `src/renderer/src/store.ts`, `src/renderer/src/lib/filter.ts`, `src/renderer/src/styles.css`, `tools/install-check.cjs`.

- [ ] Add a visible Installed badge on cards. Details distinguish Installed by Font Hive, Already installed on this PC, Downloaded, Catalogue only, and Installation status unavailable. If the font is an alias of a managed record, identify that owner/source rather than offering deactivation on the alias.
- [ ] For an externally installed font or non-owning alias, replace the install/deactivate switch with a labeled installed state. Keep deactivation available on the managed owner. Guard double-click and keyboard handlers with the same ownership rule in the store; preserve visible checkboxes, focus indicators, accessible labels, and Space/Tab selection.
- [ ] Make the Installed filter check verified OS installation rather than `filePath`. Inspect existing toolbar labels and saved-filter semantics so Downloaded remains a distinct concept. Count installed faces distinctly from catalogue aliases in global totals; provider totals may count matching faces within that provider.
- [ ] Skip installed faces for family and selection actions and update remaining counts immediately after a library event. Unknown status must trigger a backend check rather than be counted as confirmed uninstalled.
- [ ] Reuse duplicate grouping only for presentation. Include static/variable and axis distinctions in its grouping key; preserve provider filtering and metadata. Never use this heuristic to authorize installation skipping or deletion.
- [ ] Add renderer/store assertions for external and alias status, forbidden deactivation, corrected filters, counts, family remaining styles, skipped-result feedback, and partial failure.

**Proof:** `pnpm run check:install`, `pnpm run check:fuzzy`, `pnpm run check:scroll`, and `pnpm run typecheck` pass. During implementation, allow at most one browser automation pass only if a UI detail cannot be verified from code and a running surface already exists. Do not launch the app.

## Task 4: Add sources that expand the catalogue

**Recommended order:** a curated official open-source foundry catalogue first; Fontshare second if its integration requirements can be verified. Font Squirrel is a later candidate. These are candidates, not claims of supported public APIs.

- [ ] Start with an explicit catalogue of official open-source releases, such as verified releases from the League of Moveable Type or individual foundries. Use only verified direct TTF/OTF assets with license and attribution. Pin release URLs instead of inventing download paths or relying on mutable `latest` URLs. Select entries absent from the current catalogue so this source actually adds fonts.
- [ ] Evaluate Fontshare for a supported catalogue, preview mechanism, installable download access, redistribution/use terms, and whether downloads require interactive consent, session cookies, or archives. Integrate only if those requirements fit the existing direct-download provider flow. If not, record the concrete blocker and keep it a candidate; do not scrape around it.
- [ ] Evaluate Font Squirrel afterward on the same criteria. Do not promise a provider based on a public website alone. ZIP-only or authenticated sources need separately scoped archive/auth work, not an unsafe shortcut in `resolveDownload()`.

**Files for each approved adapter:** create its module in `src/main/providers/`; modify `src/main/providers/index.ts`, `src/shared/types.ts` (`ProviderId`), `src/main/index.ts` (`providerStatus`), `src/renderer/src/components/Sidebar.tsx` (`PROVIDER_ORDER`), `src/renderer/src/lib/filter.ts` (provider ranking if needed), and source dot styling in `src/renderer/src/styles.css`. Extend `tools/provider-check.ts` and add deterministic adapter fixtures to `tools/installed-check.cjs` or a dedicated source check.

- [ ] Implement the existing `Provider` interface with stable face identities, verified preview URLs, separate installable URLs, attribution, and license metadata. For the curated catalogue, keep its small explicit manifest beside the adapter; no plugin loader or user-defined source configuration.
- [ ] Validate external catalogue fields and download schemes before creating records. Require successful HTTP status, bounded requests, and a valid parsed installable face before recording a successful download. Reject HTML/error payloads and preview-only WOFF/WOFF2 as installable files. Existing `downloadFont()` permits an empty parse result; close that gap for all providers.
- [ ] Preserve cached/installed records and user metadata during catalogue refresh, including records no longer advertised. The current refresh merge only retains downloaded records still present in the returned catalogue; fix that before adding adapters that change over time.
- [ ] Use fixture tests for stable IDs, normal/italic faces, missing fields, rejected URLs, invalid downloads, source disappearance, and preservation of favorites/tags/collections/notes. Make provider checks fail the process on failed assertions; the existing check catches and logs provider errors without necessarily failing.

**Proof:** deterministic adapter checks and `pnpm run typecheck` pass. Run `pnpm run check:providers` only for the live network smoke check; this bundles a check script, not the application. Inspect that the selected new source contributes previously unavailable families and resolves actual parseable TTF/OTF assets.

## Documentation and completion

- [ ] During implementation, update `project.md` with installed-state meaning, ownership, matching limits, source behavior, Windows scope, and verification boundaries. Update `design.md` with badges, control behavior, filters, and accessible unknown/error states. Preserve `Author: Nitish` under both titles.
- [ ] Append completed implementation units to the existing daily `tasks/task_<day>_<mon>.md` only after completion. Do not record planned work as finished.
- [ ] Give the user an installed-Windows-app checklist: detect a preinstalled face; install the same face through two sources; install a family with partial existing coverage; remove the managed owner; rescan after external removal; confirm an external file and registration survive all app removal actions.
- [ ] If packaging verification is needed, hand over the exact command `pnpm run dist:win`. Do not run it under current project instructions.

## Boundaries

Planning only in this change. No automatic duplicate cleanup, replacement/version upgrade, paid font marketplace, login/token flow, archive extractor, new provider framework, or background watcher. Full system inventory support for macOS/Linux is separate; preserve current behavior without claiming equivalent detection coverage.

The main limitation is evidence: names alone cannot prove that a remote catalogue entry equals an installed binary. The UI should disclose uncertain matches; installation must resolve them before touching the OS. Source APIs and licenses need live verification during source selection, and real Windows installation behavior needs the user-run installed-app check.
