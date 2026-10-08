# Picrew Maker 🎀

A Picrew-style anime character maker that runs entirely in your browser. You can:

1. trace and prepare your own parts in the built-in trace studio,
2. mix and recolor parts freely,
3. export finished characters.

There's no server and no account. Your parts and characters are saved in the browser (IndexedDB), so they survive refreshes.

Everything happens in the UI. You never have to edit code or folders to add parts, change categories or export.

---

## Setup

You need **Node.js 20.19+ or 22.12+**.

```bash
npm install
npm run dev
```

Open the address it prints (usually <http://localhost:5173>).

The first start creates a **Starter project** with generated `placeholder-*` parts, so every feature can be tried right away. A short tour starts too; you can skip it, or replay it from **Help (?) → Replay the quick tour**.

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and build a static site into `dist/` |
| `npm run preview` | Serve the built site locally |
| `npm test` | Run the unit tests (color math, layering, undo, stabilizer, fill, randomize, share codes, import) |

To use it on a tablet on the same Wi-Fi, run `npm run dev` and open the "Network" address it prints.

### Where is my data?

Everything lives in **this browser's** storage, per browser and per profile.

- To back up a project or move it to another computer, use **project menu (📁) → Export project as .zip**.
- On the other computer, use **Import project .zip…**, or just drop the .zip onto the app.

---

## Feature overview

### Mixer (main screen)

**Library (left)**
- Category tabs with thumbnails. Thumbnails are cropped to the visible part and only load when they scroll into view.
- Click a part to choose it. Single-choice categories swap the part; multiple-choice categories add or remove it.
- You can also drag a thumbnail onto the canvas to place it at a spot.
- 🔒 on a category tab locks it, so Randomize leaves it alone.
- Search by name or tag, filter by ⭐ favorites or by tag.
- **Select multiple** lets you edit or delete many parts at once.
- The **Trash** keeps deleted parts and characters until you empty it.
- The library menu (⋯) has **Delete all placeholders** and **Add placeholder parts again**.

**Canvas (center)**
- Click a part to select it, then drag to move it.
  - Corner handles scale, and the top handle rotates (hold Shift to snap to 15°).
  - Alt+click selects the part underneath; Shift+click selects several.
  - Parts snap to their default position and to the symmetry line. Hold Alt while dragging to move freely.
- To zoom, scroll or pinch.
- To pan, drag an empty area, hold Space, or use two fingers.
- Toggle the template guides (T), symmetry line (M) and grid (G).

**Right panel**
- **Part** tab:
  - Move, scale, rotate, flip, mirror to the other side, opacity, reset to default alignment.
  - Color for the selected part.
- **Layers** tab: drag any single part up or down. This doesn't change the category's order, so you can, for example, put one hair strand behind an earring. **Re-sort** puts everything back in category order.
- **Character** tab: name, pose, linked color groups, preset palettes, expressions, text/bubbles/stickers, background and drop shadow.

**Top bar**
- Project menu, character name, gallery and new character.
- Undo/redo.
- Pose switcher.
- **Randomize**, with an options menu: parts, colors or both, plus **Surprise me** (favorites only).
- Overlays and zoom.
- **Trace**, **Export** and **Help**.

### Parts, categories and poses

- **Import**: drag PNG/WebP images of any size anywhere onto the app, or onto a specific category tab.
  1. You'll be asked for the category; it's guessed from the file name, e.g. `eyes_round.png` → eyes.
  2. Then poses and tags.
  3. Finally an **Align** step: drag and scale the part over a ghost of your character and the template, and that position becomes the part's default.
  - Images exactly the canvas size, or proportional to it, are already aligned.
  - Pairs named `name_line.png` + `name_fill.png` become one part with smart tint. You can also pair or split images by hand.
- **Categories** are fully editable via **Edit** at the bottom of the category tabs. You can add, rename, reorder (drag), delete, and pick an icon, and set for each one:
  - single or multiple choice
  - whether "none" is allowed
  - whether it counts as background (hidden in transparent exports)
  - a default color group
- **Poses** (head angles such as `bust-front` and `bust-34`) are set in **Project settings → Poses**.
  - Each pose has its own template guide: generated, or your own image.
  - A part can belong to several poses and can have a different default alignment in each one.
  - Switching pose shows only compatible parts. Parts from other poses stay on the character, dimmed in the Layers tab, and come back when you switch back.
  - Required categories (face, eyes) are filled automatically with a part made for the new pose.
- **Canvas size** is per project (default 1000×1600), set in **Project settings → General**. When resizing, you choose how existing parts are anchored.

### Color

- Every part can be **Original**, **Shift** (hue/saturation/brightness) or **Tint**.
- **Smart tint**: white in a grayscale fill becomes your color, and gray stays as shading.
  - It has an optional **two-color gradient** (for example hair tips).
  - Line art can be recolored separately, for example dark brown lines for warm palettes.
- **Linked color groups**: hair-back, hair-front and brows share **Hair** by default. There are also **Skin**, **Eyes** and **Outfit**.
  - To unlink a part, set its "Color link" to **Own color**.
  - To make your own group (e.g. "eye + earring gem"), go to **Project settings → Color groups**.
- **Saved swatches** (+ in any color picker; right-click a swatch to remove it), 10 **preset palettes**, and an **eyedropper** that picks from the canvas (press I, or use the pipette in a color picker).

### Gallery and export

- Characters save automatically. The **Gallery** (Ctrl+G) shows thumbnails and lets you open, rename, duplicate or delete characters.
- **Export → PNG** at ½×, 1× or 2×, with or without the background.
  - Crop presets are **Full**, **Bust** and **Face icon**. You can drag the crop box on the preview; Shift gives a free ratio.
  - **Copy** puts the image on the clipboard.
- **Export → Expression sheet**: the same character with every saved expression in a grid, with optional name labels.
- **Export → Share code**: a short code (or readable JSON) describing the character. Paste it into this app on another computer that has the same parts, for example after importing the same project .zip.
  - Missing parts are reported, and parts are matched by name when their ids differ.
- **Project menu → Export project as .zip** backs up everything: parts, images, characters, categories, poses and settings.

### Trace studio (no other app needed)

Open it with **Trace** in the top bar, **+ → Trace a new part** in the library, or **⋯ → Trace over this part** on any part.

- **Reference**:
  - Load any image (button, drop, or Ctrl+V).
  - It appears as a dimmed underlay that you can move, scale and rotate with the Reference tool (V).
  - Template guides and an optional ghost of your current character can be shown on top.
- **Pen** (B):
  - Tablet/stylus **pressure** support, plus adjustable size.
  - A **stabilizer** that turns shaky lines into clean ones. It works in screen space, so it behaves the same at any zoom.
  - **Tapered ends** and a line color.
  - "Draw with finger" can be turned off for palm rejection, so fingers only pan and zoom.
- **Eraser** (E) works on the line, fill or shading layer.
- **Make fill** (F):
  - Click inside closed line art and it floods a fill layer behind the lines.
  - **Gap close** makes small gaps in your lines count as closed so the fill doesn't leak.
  - If an area is open to the edge, it tells you instead of flooding the canvas.
- **Fill brush** (W) touches up the fill by hand.
- **Shade** (S) paints gray on a shading layer clipped to the fill, so smart tint still works.
- **Mirror drawing** (X) mirrors everything you draw across an adjustable line, which is great for glasses and collars.
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z), and brush size with `[` / `]`.
- **Save as part** (Ctrl+S) sends the drawing straight into the library.
  - Line and fill are already split, with shading merged into the gray fill. There's no export step.
  - The drawing layers are kept, so **⋯ → Edit in trace studio** reopens them later.
- Unsaved drawings are kept as a **draft** and offered the next time you open the studio, even after a refresh.

### Extras

- **Expressions** (Character tab): save the current eyes + brows + mouth + blush as named expressions (happy, angry, flustered…) and apply them in one click. Which categories count is set in **Project settings → Expressions**.
- **Text, bubbles and stickers**: speech, shout and thought bubbles, text, sparkles, sweat drop, anger mark, heart, star, music note and surprise lines. They're drawn as shapes, so they stay sharp at any size. Edit text, colors, size and tail direction in the Part tab.
- **Background**: solid, gradient, uploaded image or a generated pattern (dots, stripes, gingham, grid, hearts, stars, sunburst), plus a **drop shadow** behind the character.

### Always on

- **Undo/redo for every action** (Ctrl+Z / Ctrl+Shift+Z). A whole drag or slider move is one step, and the toast after each undo shows what was undone.
- **Nothing is destructive**:
  - Deleting asks first and moves things to the **Trash**.
  - Deleted projects go to **Recently deleted**.
  - Unsaved trace drawings are kept as drafts.
- **Tooltips** on every control (hover, or long-press on touch). Press **?** for the full keyboard shortcut sheet.
- **Touch friendly**: large controls, pinch-zoom, and a bottom-sheet layout on tablets and phones.
- **Fast with 300+ parts**:
  - Lazy thumbnails.
  - Images are decoded once and cached.
  - Recolored versions are cached per color.
  - Only changed records are written to storage.

---

## How to make a new part (checklist)

1. **Load a reference.** Click **Trace**, then drop, paste (Ctrl+V) or choose an image.
   - With the Reference tool (V), move/scale/rotate it so it sits on the template guides. The head oval, eye line and shoulders are shown.
   - Turn on the ghost of your current character if the part should fit it.
   - Lower **Dim** so your lines stand out.
2. **Trace with the stabilizer.** Pick the **Pen** (B).
   - Raise **Stabilizer** until shaky lines come out clean; around 40–60% works well for most people.
   - Use a medium size (4–8 px) and keep **Taper** on for nice line ends.
   - Close every shape you want to fill. Small gaps are fine.
   - Use **Mirror drawing** (X) for symmetric parts.
3. **Make fill.** Pick **Make fill** (F) and click inside each closed area. If the fill leaks, raise **Gap close** or close the gap with the pen.
   - Use the **Fill brush** (W) to touch up corners.
   - The fill shows in a preview tint, but it's stored white.
4. **Shade in gray.** Pick **Shade** (S) and paint shadows. They only appear inside the fill and are stored as gray, so smart tint keeps the shading in any color.
5. **Save as part.** Press **Save as part** (Ctrl+S), pick the category and poses, and save. The part lands in the library with line and fill already split, exactly where you drew it.
6. **Tag it.** Add tags in the save dialog, or later via **⋯ → Edit name, tags & poses** on the part. Tags help search and filtering. ⭐ it if it's a favorite for "Surprise me".

### Tips for parts made in other apps

- Export each part as a transparent PNG/WebP. Using the **same canvas size as your project** (e.g. 1000×1600) skips the Align step.
- For smart tint, save two files: `name_line.png` (dark line art) and `name_fill.png` (fill painted **white**, shading painted **gray**).
- Parts that are already colored work too: use **Shift** to change their colors.

---

## Keyboard shortcuts (most used)

| Keys | Action |
|---|---|
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Arrows (Shift = ×10) | Nudge the selected part |
| H / V | Flip horizontally / vertically |
| R | Reset to default alignment |
| [ / ] | Layer down / up (brush size in the trace studio) |
| Ctrl+D / Delete | Duplicate / remove from character |
| T / M / G | Template guides / symmetry / grid |
| I | Eyedropper for the selected part |
| Shift+R / Shift+F | Randomize / Surprise me |
| 0 / 1 / + / − | Fit / 100% / zoom |
| Ctrl+E / Ctrl+G | Export / gallery |
| ? | All shortcuts |

---

## Project structure

```
src/
  model/       data types, defaults, geometry, layer stacking
  state/       store with undo/redo, UI state, actions, autosave, projects
  db/          IndexedDB wrapper, image asset cache
  render/      compositor, recoloring, guides, shapes, backgrounds, hit testing
  io/          import pipeline, part factory, PNG/sheet export, project .zip, share codes
  starter/     generated placeholder parts
  features/    UI: canvas, library, import/align, inspector, layers, character,
               categories, projects, gallery, export, help/tour, randomize, trace studio
  ui/          buttons, sliders, dialogs, menus, color picker, icons
tests/         unit tests (vitest)
```

Dependencies: React, fflate (zip). Dev: Vite, TypeScript, Vitest.
