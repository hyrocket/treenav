# TreeNav

A unified navigation tree for Obsidian: folder notes, drag & drop, inline rename
and (from Phase 2) per-item icons and colors, in one sidebar view that follows
the look and density of the built-in file explorer.

## What it does

**Navigation**

- Sidebar view with a ribbon icon and an **Open TreeNav** command
- Expand & collapse, remembered across restarts; active note highlighted. One
  header button collapses everything, or expands it when nothing is open
- Keyboard navigation: arrows, `Enter`, `F2`, `Delete`, `Ctrl/⌘+N`, `Ctrl/⌘+Shift+N`
- Multi-select with `Ctrl/⌘`+click and `Shift`+click, `Ctrl/⌘+A` for everything
  on screen, `Escape` to narrow back to one. Middle click opens in a new tab
- `Shift` + arrows moves the item itself: up, down, and in or out one level
- Every tree action is also a command, so any key can be bound to it in
  Obsidian's hotkey settings; the commands only fire while the tree has focus
- Live sync with changes made outside TreeNav

**Structure**

- Folder notes (`Projects/Projects.md`), hidden from the listing by default,
  kept in sync in both directions when either half is renamed
- Drag a note onto another note's icon to nest it underneath: the target
  becomes a folder note and keeps opening the same note
- Pull the last child back out and the folder collapses back into a plain note
- Drag onto a name to place an item above or below it; that folder then keeps
  its manual order. Indenting under a note nests it the same way a drag does,
  so there is one set of rules however the move was started
- Inline rename, new note / new folder, **Move to…**, delete via trash
- Drag, move, style or delete a whole selection at once; a target that suits
  only some of them takes those and leaves the rest where they are
- Works the same on a phone: press and hold a row, then move to drag it or let
  go to open its menu

**Appearance**

- One **Font & color** dialog per item — color, typeface, emphasis, size and
  the icon, previewed on a live copy of the row and applied together
- Stored in plugin data, never written into your notes
- Typefaces are the theme's own (interface / text / monospace), so a styled item
  looks right on any machine
- Icons come from anything Obsidian has registered (Lucide and whatever other
  plugins added) or from an emoji, typed straight into the search box
- A folder you made looks like a folder; a folder that came from nesting keeps
  the note icon, because it is still that note
- Two tree styles: modern indentation, or the boxed connector lines of a
  classic tree view

## Design notes

Path-keyed state (expanded folders, styles, manual order, folders created by
nesting) is migrated on every vault rename, because Obsidian exposes no stable
file id. Nesting and flattening hand the row's position and appearance over to
whichever path now represents it.

## Development

```bash
npm install
npm run dev            # watch build, deployed into ./test-vault
npm run build          # typecheck + bundle + smoke test
npm run smoke          # render the built plugin against a stubbed Obsidian API
npm run reset          # rebuild ./test-vault to a known fixture
npm run deploy -- "D:/path/to/vault"
```

`npm run smoke` loads the real `main.js` under jsdom with a fake vault, so
rendering, folder notes, nesting and flattening are checked without opening
Obsidian. It also guards against shadowing undocumented members of Obsidian's
runtime classes, which type-check cleanly and break the plugin silently.

## Install for testing

```bash
npm install
npm run build          # or: npm run dev   (watch mode)
```

Then copy `manifest.json`, `main.js` and `styles.css` into
`<vault>/.obsidian/plugins/treenav/` and enable the plugin in
**Settings → Community plugins**. During development it is easier to build
directly into that folder — clone the repo there and run `npm run dev`.

## Folder notes

TreeNav uses the "note of the same name inside the folder" convention:

```
Projects/
  Projects.md      <- the folder note for "Projects"
  Planning.md
```

Nothing extra is stored: the relationship is derivable from the path, survives
moving the folder, and is repaired automatically when the folder is renamed.

## License

TreeNav is free software under the **GNU General Public License v3.0 or later**
(see [LICENSE](LICENSE)). A fork you distribute must stay under the GPL and
ship its complete source; it may not be relicensed or released closed-source.

The name "TreeNav" is not covered by that grant — please rename a published
fork so users can tell the two apart.

    Copyright (C) 2026 HY

    This program is free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by the Free
    Software Foundation, either version 3 of the License, or (at your option)
    any later version. It is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
    Public License for more details.
