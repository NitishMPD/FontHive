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
