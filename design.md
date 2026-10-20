# Font Hive design
Author: Nitish

## Visual language and interaction

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
