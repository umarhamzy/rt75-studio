# RT75 Studio: handoff notes

A browser configurator (WebHID, no build step) for the **Yunzii RT75 Pro** magnetic keyboard
(device ID 2865, module `ry5088_zmd_k982d_3m_8k_1k`). It was reverse engineered from qmk.top,
whose **v4 app** (`https://qmk.top/v4/`) drives this keyboard. The full protocol, with evidence
and what has been verified, is in **protocol-notes.md**. Read the relevant section before
touching device code.

## Run, test, reference

- **App:** `python serve.py` (no-cache static server), then open http://127.0.0.1:5180 in Chrome
  or Edge. Close qmk.top first; only one page can hold the keyboard.
- **Live site:** https://umarhamzy.github.io/rt75-studio/ (GitHub Pages, served from `main` of the
  public repo github.com/umarhamzy/rt75-studio; `.nojekyll` serves files as-is). Pushing `main`
  redeploys it, so only push verified merges.
- **Demo:** `?demo` runs everything against a simulated keyboard (`src/demo.js`), including the
  live test, profiles and sleep timers. `?dongle=classic` uses qmk.top's slower 2.4G timing (for
  comparing load times; the source chip shows the last load time). `?demo&ignore=15:7` makes it drop writes to slot 15 /
  param 7, which reproduces a failed write.
- **Tests:** `node tests/run.mjs` runs all suites. They drive `src/device.js` against simulated
  keyboards and check exact packets, read-back and the blocked cases. `tests/packets.test.mjs` is a
  golden test: every device operation's packets, the validators' accept/block patterns and the
  model's constants must match `fixtures/packets-golden.json`. Refresh it with `--update` only when a
  packet change is intended, and say why in the commit.
- **Reference code:** `node tools/fetch-qmk.mjs` downloads qmk.top's GearHub and v4 bundles plus
  the RY5088 base class (the whole protocol), the RT75 device module and the layout chunk, into
  `reference/qmk/` (git-ignored).
- **Diagnostics:** `probe.html` (device ID), `dump.html` (full read-only settings dump to JSON) and
  `knob-listen.html` (sends nothing; logs the keyboard's own reports, e.g. knob and lighting pushes).

## Code map

| File | Role |
|---|---|
| `src/device.js` | Everything that touches HID: transport (wired and 2.4G dongle relay), reads, validated writes, live depth, keyboard-wide settings |
| `src/app.js` | UI state and rendering: sidebar and header, board, knob mode, inspector/editor (travel sliders), pending edits, review dialog, Undo, live test, presets, keyboard settings, switch types |
| `src/models/rt75pro.js` | Everything specific to the RT75 Pro: ID, USB IDs, key positions (from qmk.top), factory key matrix and Fn layers, profiles, setting limits, switch types, polling rates, sleep limits, lighting effects, custom-pattern count; `slot` = key-matrix index (table sizes are the RY5088 protocol's, `MATRIX_SLOTS` in device.js) |
| `src/model.js` | The model the app drives (only the RT75 Pro for now) and the layout exports (`KEYS`, `DEFAULT_MATRIX`, …) the rest of the code imports |
| `src/macros.js` | Macro buffer encoding (mirrors qmk.top), checks, modes, step labels |
| `src/library.js` | Macro library in this browser: storage, export/import, out-of-date check |
| `src/lighting.js` | Lighting packet encode/decode and diffs (the effects table is the model's) |
| `src/patterns.js` | Custom lighting patterns: per-key colour helpers, quick fills, saved-design storage |
| `src/dks.js` | DKS trigger patterns: the editor's clicks, descriptions and the scrubbed press |
| `src/demo.js` | Simulated keyboard (per-profile settings, polling rate, sleep timers, lighting, live reports) |
| `src/dropdown.js` | Styled dropdowns (M1 design) layered over every native `<select>`; the select stays the source of truth |
| `src/history.js` | History of writes in this browser per keyboard (`rt75-studio-history-<id>`, last 200): storage, summaries, titles |
| `src/themes.js` | Themes: the list (5 dark, 4 light), the saved choice (`rt75-studio-theme`), applying it |
| `src/themes.css` | One `[data-theme]` block of colour tokens per theme except Amber (generated with a contrast check, see Status) |
| `src/styles.css` | Amber's tokens (the default), tokens worked out from a theme's colours, and all styles |

## Rules that must not be broken

1. **Find qmk.top's code path first and mirror it exactly** (packet layout, order, flags, delays).
   Record the evidence in protocol-notes.md.
2. **Every outgoing packet passes an allowlist validator before anything is sent**:
   `assertAllowedWrite` (per-key magnet), `assertAllowedKeyboardWrite`, the sleep validator,
   `assertAllowedKeymapWrite`, `assertAllowedLightWrite`, `assertAllowedMacroWrite`, and the
   read allowlist `READ_COMMANDS`. New commands get their own validator.
3. **Writes go through review → write → read back → report mismatches → Undo.** No silent writes.
   The one exception is **Instant save**, which the user turns on: it skips the review dialog but still
   validates, reads back, reports mismatches and logs every write in History with Undo. Macros and ⚠
   functions always wait for Review.
4. **Never send:**
   - calibration (`0x1C`, `0x1E`; qmk.top's all-keys depth read only works inside calibration,
     which rewrites it)
   - flash erase, bootloader or firmware commands; reset (`0x01`)
   - bulk magnet table writes (`[0x65, param, 1, …]`, which overwrite keys absent from the batch)
   - debounce (`0x06`; qmk.top doesn't offer it for this keyboard)
   - **reads with indexes outside qmk.top's ranges**, even "read-only" probes. A macro read at index
     254/255 hung the keyboard until it was power-cycled (2026-10-15). `query()` enforces the
     ranges (protocol-notes.md, "Read ranges").
   - **any Fn layer other than 0.** The RT75 has one Fn layer shared by all profiles; byte 2 of
     `0x90`/`0x10` is the Fn layer, not the profile.
5. **Set the per-key magnet "save" flag (byte 4) only on a batch's final packet.** Setting it per
   key made the keyboard drop the next key's first packet.
6. Sensitivity edits on keys with RT off, and Snap partners on keys that aren't Snap, are never
   sent; qmk.top doesn't send them either.

## Working agreement with the user

- **One branch per feature.** Test with `node tests/run.mjs` and in `?demo`, then **the user
  verifies on the real keyboard** (often cross-checking in qmk.top) before a fast-forward merge
  into `main`. Record each real-keyboard verification in protocol-notes.md.
- **Don't install tools or write under AppData from a session** (the global CLAUDE.md explains
  the sandbox). Project-local work is fine.
- The user values a polished UI: no layout shifts, clipping or stuck controls. Check geometry
  in the browser pane with JS measurements; screenshots often time out while the pane is in the
  background, and `requestAnimationFrame` doesn't fire there.

## Gotchas

- **`node --check` treats these ES modules as scripts and misses some errors.** Parse them with
  `node -e "import('file:///…/src/app.js')"`. A `ReferenceError` about `document` means it parsed.
- **Git Bash sees a sandboxed view of `%TEMP%`;** Windows `python`/`node` may not see files
  created there by Git Bash.
- **Long inline `node -e` or heredoc scripts containing backticks break in the shell tool.** Write
  a script file, or use the Edit tool.
- **Git Bash rewrites arguments that start with `//`** (MSYS path conversion: `// Foo` becomes `/ Foo`).
  Prefix the command with `MSYS_NO_PATHCONV=1` when passing comment markers to a script.
- **The browser pane sometimes switches to a static file preview after an edit.** Navigate back to
  http://127.0.0.1:5180/?demo.
- Demo presets use their own storage key (`rt75-studio-presets-demo-2865`).

## Status (2026-10-22)

**Verified on the real keyboard:**
- reads and decoding
- actuation/release writes
- Snap Tap pairing (after the save-flag fix)
- live depth test
- profile switching
- polling rate
- sleep timers

Dead-zone writes and presets have been tested in the simulation and demo only.

**Key map editing (feature/key-remap):** base and Fn layers, read and written, with the Fn key and
system keys locked. Verified on the real keyboard: reads, a base remap, an Fn-layer remap, a combo and a restore.

**Lighting (feature/lighting):** main backlight read (`0x87`) and write (`0x07`, Bit8 checksum),
with effect, brightness, speed, colour/rainbow and direction. Format decoded from qmk.top
(protocol-notes.md, "Lighting"); the RT75 has no side light. Verified on the real keyboard: read,
write, read-back and Undo. Brightness 0 = fully off; lighting is shared by all profiles.

**Macro library (feature/macro-library):**
- Named macros are kept in this browser, written to free slots, and assigned to keys.
- Export and import as JSON.
- **Macro slots are never read:** `0x8B` is unreliable on this keyboard (protocol-notes.md, "Macros"),
  so it isn't in `READ_COMMANDS`.
- Key writes are read back; macro steps can't be.
- Verified on the real keyboard: create, assign, write, play, and Remove from keys.

**2.4G speed (perf/dongle-speed):** the dongle is routed once per operation and its status is polled
without fixed 100 ms waits; the key map loads in the background after startup (Key map / Macros
tabs spin until it's in). Startup over 2.4G: 24.7 s → 3.0 s, verified on the real keyboard.

**Configuration redesign (feature/config-redesign, merged; verified on the real keyboard 2026-10-16):**
- Dark-only theme (amber accent, Archivo + JetBrains Mono from Google Fonts with system fallbacks).
- Sidebar navigation and a device card; Profile 1–4 and **Review changes** (with a live count) in
  the header. The pending bar is gone; Discard all is in the review dialog.
- Keychron-style vertical actuation and release sliders.
- The knob is drawn as a rocker on a dial and shows the mode it last saw. `watchKeyboardEvents`
  (device.js) only listens on the report interface, already granted at connect; it never sends.
- Design mockups: the "RT75 Studio UI styles" canvas artifact (Rounds 1–7).

**Mod-tap (merged; verified on the real keyboard 2026-10-18):** Configuration › Key modes.
Mode 3 + hold key on the base layer + tap key on key-matrix sub-layer 1 + hold time
(param 5), mirroring qmk.top (protocol-notes.md, "Mod-tap"). The tap layer loads with the key map.

**Toggle (merged; verified on the real keyboard 2026-10-18):** modes 4 (Long press) and 5 (Rapid fire) + the action on the base layer
(protocol-notes.md, "Toggle"). The side panel's Key mode switch (Normal · Mod-tap · DKS · Toggle)
replaces mod-tap's on/off switch; the Configuration tab is now "Key modes". Travel and dead zones are
read-only on mod-tap and toggle keys, as in qmk.top. Toggle keys trigger at ~0.5 mm whatever their
travel (tested); the RT75 adds the top dead zone to the actuation point (tested), and the Press slider
marks that real trigger point. Travel stops at 3.3 mm minus the bottom dead zone, as in qmk.top.

**Also merged with toggle:** side panel sections with coloured heading marks (design P1, canvas
Round 16), a 380 px side panel that narrows to 320 px before the board shrinks, the app following
profile changes made on the keyboard (`01` push; verified), and a qmk.top link in Keyboard settings.

**Custom lighting patterns (merged 2026-10-18 at the user's request; demo-tested, no keyboard verification recorded yet):**
Lighting › Custom patterns (design C3, canvas Round 17): per-key colours for the Custom effect's
Pattern 1–5, read with `0x8C` on demand and written with `0x0C` (7 packets, validator
`assertAllowedUserPicWrite`) with read-back; all five read ahead once Custom is the effect; quick
fills, paint/pick, colours from a picture (choose/drop/paste), designs saved in this browser with a
built-in Sunset (`src/patterns.js`). Writing also queues the effect switch to Custom · that pattern.
qmk.top's "IoT" desktop helper isn't needed (protocol-notes.md, "Custom lighting").

**DKS (merged; verified on the real keyboard 2026-10-18, wired and 2.4G):** trigger point (param 4), trigger
table (param 8, read back as param 10 over 8 pages), four key-matrix sub-layers, validators and tests;
decoded from qmk.top's editor chunk (protocol-notes.md, "DKS"). Editor: design **X1** (canvas Round 14):
with one DKS key selected, its four actions replace the summary tiles under the keyboard (key picker
or Press, four moment dots per action, a scrubbed "Try a press"); the trigger point is in the side
panel's Key mode section. Pattern logic in `src/dks.js`. The DKS settings are read on demand the
first time a key is switched to DKS.

**Display preferences (merged 2026-10-20; UI only, checked by the user in the app):** Appearance ›
Display (was Keyboard settings › Display until feature/themes): Help texts (hides elements tagged `help`) and Travel bars on keys, kept in this browser
(`rt75-studio-display`) and applied as `no-help` / `no-lanes` classes on `<body>`. New explanatory
text should get the `help` class; warnings and status messages shouldn't. Also: the grey "remapped"
dot compares a key-mode key's tap action (mod-tap's tap key, not its hold key) with the factory key.

**Themes (merged 2026-10-20; UI only, checked by the user in the app):** a Studio › **Appearance** page with the theme gallery
(design TP1, canvas Round 19; themes from Round 18): dark Amber (default), Frost, High contrast,
Ember, Moss; light Paper, Porcelain, Mint, Retro. Each card's preview is drawn in its own theme
(`data-theme` on the preview scopes the tokens). The sidebar's moon/sun button (design TP4) flips
between the last dark and the last light theme picked. index.html applies the saved theme before
the page paints. Help texts and Travel bars moved from Keyboard settings to Appearance › Display.
The device card shows Yunzii's wordmark before "RT75 Pro": `assets/yunzii-logo.png` (the header logo
from yunzii.com, downloaded with the user's OK), white on transparent, used as a CSS mask so it takes
the theme's text colour.
- **Colours only come from tokens.** New styles use `var(--…)`, never hex. Key text uses `--cap-ink`,
  `--cap-muted`, `--cap-accent` (Retro has dark keycaps on a light page); accent, Rapid Trigger and
  toggle colours used as *text* use `--accent-text`, `--rt-text`, `--tg-text`; mode tints use
  `--key-mix`; dimmed keys `--key-dim`. Light themes override the knob, overlay and live-test tokens.
- themes.css was generated from token tables with a contrast check (text and key labels ≥ 4.5:1);
  edit it by hand now, keeping that bar. The lighting view's LED preview is approximate on every theme.

**Switch type (merged 2026-10-20; verified on the real keyboard, both ways with qmk.top):** Keys › **Switches** (design SW1,
canvas Round 20): each key shows qmk.top's switch number (1–7) in qmk.top's colour (`--sw-1…7`,
the same in every theme); select keys and pick one of the RT75 Pro's seven types in the side panel.
Written per key as param 252 after the key's other settings (validator: one of 0, 1, 2, 3, 4, 5, 46),
read back, Undo restores unset keys as Outemu (protocol-notes.md, "Switch type"). Presets don't hold
switch types (the Presets button is hidden there). **Switch types are shared by all profiles**
(tested), unlike the other magnet settings; the legend and review dialog say so, and the demo shares them.

**Mouse actions (merged 2026-10-21; verified on the real keyboard):** Key map editor › **Mouse** (design MK2,
canvas Round 21): qmk.top's seven mouse actions (left, right, middle click, back, forward, scroll up,
scroll down; `MOUSE_ACTIONS` in actions.js) on base and Fn layers, never on mod-tap/DKS sub-layers
(protocol-notes.md, "Mouse actions").

**History and Instant save (merged 2026-10-21; verified on the real keyboard):** design HS1 drawer + HS3 switch
(canvas Round 22).
- **History** (clock button in the header) lists every write (Review, Instant or Undo), newest first by day,
  with filters (Key settings, Key map, Lighting, Keyboard), the rows as the review dialog words them,
  read-back status and **Undo** per entry. Kept in this browser per keyboard and survives a reload.
- **Entries are restore points:** Undo is offered whenever the keyboard still has what that entry left
  it with (`historyStale`, compared with the read-back stored as `applied`), whether or not it was undone
  before; otherwise it's greyed out with how many values differ. Undo entries can be reversed too
  (button reads **Redo**). Titles name the keys ("W, A, S, D · Rapid Trigger"); Undo/Redo entries link
  to the change they reversed ("Undid the 09:07 change") and the reversed entry links back.
- **Undo from History** writes the Before values back without the dialog and adds its own entry. It is
  blocked while unsaved changes exist and from another profile for profile-specific entries, and it
  skips values the keyboard already has.
- `writeKeySettings` now runs in the device queue (`exclusive`) like every other operation; before, a
  write could interleave with the key map loading after startup ("A different keyboard is connected").
- **Instant save** (header switch, off by default, `rt75-studio-save`): pending changes are written
  about 1 s after the last edit (not while a slider is held or a dialog is open), via
  `applyEdits(..., { quiet: true })`, which keeps the page editable and only clears pending values that
  match what was written. While it writes, the page takes the values being written as the keyboard's
  (`showAsWritten`), so edits made meanwhile (a key switched to DKS and straight back) are compared with
  those and saved next; a failed write rolls them back and re-queues them. A failed write waits for the
  next edit or Retry (`instantSig` ignores order). The header chip shows
  Saving… / Saved · Undo / didn't stick. The Read-only badge now shows only when nothing can be written.

**Slider snapping (merged 2026-10-21; UI only, checked by the user in the app):** dragging the travel
sliders (and the small mm sliders: RT sensitivity, dead zones, DKS trigger point) moves in 0.05 mm
steps; Shift+drag moves in their fine steps. Arrow keys and typed values are unchanged; no help text.

**Keyboard shortcuts (merged 2026-10-22; checked by the user on the keyboard):** Ctrl+Z undoes the newest History
entry the keyboard still matches (repeat to step back), Ctrl+Y / Ctrl+Shift+Z redoes the latest Undo,
Ctrl+Enter opens Review, Ctrl+A selects every key (`onShortcut`). Ignored while typing in a field, in a
dialog, during the live test, key capture or macro recording; waits for a running write. Named in the
History and Review button tooltips.

**Copy and paste between keys (merged 2026-10-22; verified on the real keyboard):** design KC1
(canvas Round 23). Side panel Copy / Paste (Ctrl+C / Ctrl+V on the Configuration tabs) with ticks for
Travel, Rapid Trigger, Dead zones and Key mode (off by default); pasted as unsaved edits. Key mode
copies mod-tap's hold and hold time, toggle's type, DKS's moments, trigger point and actions 2–4; each key
keeps its own key as tap/toggle/DKS action 1. Snap pairs aren't copied; travel and dead zones skip
DKS/mod-tap/toggle keys. **Select similar…** next to Select… (same actuation, RT, key mode, everything).

**Set by pressing (merged 2026-10-22; verified on the real keyboard):** design LD2 (canvas
Round 23). Under the travel sliders: Start runs the live test's depth reports (USB only); press a selected
key and hold it still (±0.04 mm for 0.45 s) and "Use X mm" sets the actuation (and release when linked)
as an unsaved edit, in 0.05 mm steps (Shift-click 0.01). The pressed depth is the trigger point, so each
key's top dead zone is taken off. Stops on another selection, page, Review, live test or Esc; Instant save
waits while it runs. The demo's light press now holds still for 0.7 s.

**Restore a backup (merged 2026-10-22; verified on the real keyboard):** design RB1 (canvas
Round 23). Backups made before Review writes are also kept in this browser (last 10 per keyboard,
`rt75-studio-backups-<id>`, labelled "Before writing …"); Keyboard settings › Backups lists them with
Back up now and From a file…. Restore… compares area by area (key settings and key map for the current
profile; Fn layer, switch types, lighting, polling/sleep shared) and loads the ticked areas as unsaved
changes. Each value must pass the write validators (`buildWritePackets`, `isWritableAction`, rate/sleep
limits) or it's skipped and counted. Custom patterns and macro steps aren't in backups.

**Copy a profile (merged 2026-10-22; verified on the real keyboard):** design CP1 (canvas
Round 23). A ⋯ button in the profiles group › Copy Profile N to…: tick targets and Key settings / Key map.
For each target: switch there and read it (`switchAndLoad`, shared with changeProfile), compare with a
snapshot of the source (`backupChanges`, so every value is validated), keep a backup of the target, write
the differences quietly with read-back (History source "Copy", "Copied from Profile N"), then switch
back. No new commands. A large copy is one long per-key batch (save flag on its last packet only),
which worked on the real keyboard. The header chip is 220 px wide now so the header keeps one row.

**Model file (merged 2026-10-23; no behaviour change, checked by the user on the keyboard):** step 1 of
preparing for other RY5088 keyboards. The RT75's constants moved from layout.js, device.js,
lighting.js, app.js, demo.js and the macro/pattern storage keys into `src/models/rt75pro.js`, read through
`src/model.js`. The golden packet test, recorded on main beforehand, matches byte for byte, and every
suite's output is unchanged. Still RT75-only: the model is fixed at import (a registry picking it at
connect is step 3), and UI text about tested RT75 behaviour (top dead zone adds, toggle at 0.5 mm,
shared switch types) isn't flagged per model yet.

**Protocol sizes (merged 2026-10-23; no behaviour change, checked by the user on the keyboard):** step 2.
qmk.top's RY5088 base class fixes the table sizes for every board on the chip, whatever its key count,
so they are named once in device.js: `MATRIX_SLOTS = 128`, read 64 bytes a page (`NARROW_PAGES` 2,
`WIDE_PAGES` 4, `MATRIX_PAGES` 8), and custom patterns of 378 bytes written in 7 packets and read in 6
pages. Reads, `query()`'s ranges, the DKS table, presets, patterns and the demo use them. The pattern
size moved back from the model; the model keeps only the pattern count. Golden test identical. Not
yet checked: whether any other board's qmk.top module overrides these sizes (needs downloading a few
modules, with the user's OK).

**Favicon (merged 2026-10-26):** `assets/favicon.svg`, the sidebar's RT mark as a solid amber tile with
dark letters (readable on light and dark tab bars), linked from index.html and the diagnostic pages.

**Next:** the user's choice.
Knob remapping isn't wanted.

**Branches:** `feature/macros` holds the abandoned read-back approach and the full investigation
log (probe pages). Don't merge it.
