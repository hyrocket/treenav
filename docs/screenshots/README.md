# Screenshots

Drop the images in this folder under the names below and they will appear in the
project README. Anything not taken yet simply does not show up there.

Take them in the demo vault, which exists for this:

```bash
npm run demo          # writes demo-vault/ and installs the plugin into it
```

Open `demo-vault` as a vault in Obsidian. TreeNav is already set up in it — the
tree is open on the left, with icons, colours, a highlight, a hand-set order and
the classic style all in place.

| File | What it shows | How to get there |
|---|---|---|
| `tree.png` | The tree itself | The vault as it opens. Widen the sidebar to about 320px so no name is clipped. |
| `font-and-color.png` | The appearance dialog | Right-click `Astrophysics` → **Font & color**. The preview at the top should be visible. |
| `find.png` | Search and filters | The 🔍 button in the header, then type `mars`. |
| `nesting.gif` | A note adopting another | Drag `Pulsars` onto the icon of a note; drag it back out and answer the prompt. Optional, and the most convincing one. |

## Taking them

- **Crop to the panel plus a little of the editor.** A full-screen shot at 4K
  makes the tree unreadable in a README.
- **Light theme** for the README. It is what most people see on GitHub, and the
  colours in the demo vault were picked to read on both.
- Hide anything personal: no vault name, no other plugins' panels.
- PNG, and keep each under about 500KB.

The demo vault is disposable — `npm run demo` rebuilds it from scratch, so
nothing here depends on remembering how it was set up.
