# Font Hive design
Author: Nitish

## Font installation and selection

- Use the existing compact buttons, icons, spacing, and card layout. The library toolbar exposes Select all and a labeled Install selected action with the selection count and Clear selection.
- Each card has a visible native checkbox with an accessible font-and-provider label. Tab and Space select independently of the card click and double-click actions. Modifier-click selection remains available.
- The detail panel offers Install for a face and Install family with the remaining style count; completed families show Family installed. The action tooltip identifies the source and total styles.
- Disable installation controls while busy, retain selection after installation for retry, and show success or failure feedback through existing toasts. Toolbar actions wrap when space is limited.

## In-app updates

- Match Needle's user-controlled flow: notify in the title bar, offer Settings
  controls to check, download with progress, view notes, and restart to install.
## Visual language and interaction

Use the existing Font Hive icon (`resources/icon.ico`) for the Windows setup
executable so downloaded installers match the app's branding.

Preserve the existing restrained desktop interface: dark and light neutral
palettes, compact controls, sidebar navigation, library grid, detail panel and
monochrome branding. Keep the current React components, typography, spacing,
keyboard shortcuts, filters, variable-axis sliders and motion.

## Font list performance

- Keep the font grid virtualized with two extra rows on each side of the viewport.
- Defer new card preview loading until scrolling stops. Cards keep any preview
  already loaded; new cards use the UI font while scrolling.
- Keep card layout props stable so unchanged cards skip rendering during scroll.

## Window and updates

- Keep the 40px title bar and a draggable blank area. Provide accessible keyboard
  focus and labels for minimize, maximize/restore and close. Use the existing
  theme tokens for controls, with a conventional red close hover.
- Match Needle's user-controlled flow: notify in the title bar, offer Settings
  controls to check, download with progress, view notes, and restart to install.
- Keep errors visible and allow retries. Closing during a library operation
  explains that the operation must finish first.
- Preserve keyboard support and existing accessibility. WebView2 must retain
  preview fidelity and variable-axis behavior; test native window interactions
  and font rendering in the packaged application.

## Consistent source UX

- Every source uses Font Hive's existing toolbar, virtualized font cards, detail panel, selection, Download, Install and Install family actions. Do not embed a website or open discovery links in an external browser.
- For paged sources, automatically fetch the next page near the end of the grid. Keep compact Search source and Load more controls for keyboard access and retry. Enter searches the selected source. Show the loaded count and whether more results remain, without treating a page count as the source total.
- Keep package previews in the usual card/detail preview area. Until downloaded, label the entry Font package and explain that Download enables custom preview text and reveals styles. Blend monochrome source specimens into the preview surface: light lettering in dark mode and dark lettering in light mode, without a white image strip.
- Cards visibly mark Installed. Details distinguish Installed by Font Hive, Already installed on this PC and Installation status unavailable. Disable removal for external fonts and non-owning aliases while preserving keyboard selection.
- Render source URLs as attribution text and bundled license/readme text in an expandable, scrollable Details section. Keep all errors and partial install feedback in the existing provider/toast patterns.
