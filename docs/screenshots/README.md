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

| File | What it shows | In the README |
|---|---|---|
| `treenav_sc1.png` | The tree with its context menu open | Yes, at the top |
| `treenav_sc2.png` | The icon picker, emoji and Lucide side by side | No — the Font & color dialog already stands for appearance |
| `treenav_sc3.png` | Font & color: preview, colours, highlight, typeface | Yes |
| `treenav_sc4.png` | Search with its four filters and the match count | Yes |

Three are used. A README that opens with four full-window screenshots is read as
an advertisement rather than a description.

Still missing, and the most convincing thing here if it is ever taken: a short
recording of a note adopting another one. Drag `Pulsars` onto a note's icon,
then drag it back out and answer the prompt.

## Taking them

- **Crop to the panel plus a little of the editor.** A full-screen shot at 4K
  makes the tree unreadable in a README.
- **Light theme** for the README. It is what most people see on GitHub, and the
  colours in the demo vault were picked to read on both.
- Hide anything personal: no vault name, no other plugins' panels.
- PNG, and keep each under about 500KB.

The demo vault is disposable — `npm run demo` rebuilds it from scratch, so
nothing here depends on remembering how it was set up.
