# RT75 Studio: handoff notes

A browser configurator (WebHID, no build step) for the **Yunzii RT75 Pro** magnetic keyboard
(device ID 2865, module `ry5088_zmd_k982d_3m_8k_1k`). It was reverse engineered from qmk.top,
whose **v4 app** (`https://qmk.top/v4/`) drives this keyboard. The full protocol, with evidence
and what has been verified, is in **protocol-notes.md**. Read the relevant section before
touching device code.

## Run, test, reference

- **App:** `python serve.py` (no-cache static server), then open http://127.0.0.1:5180 in Chrome
  or Edge. Close qmk.top first; only one page can hold the keyboard.
- **Demo:** `?demo` runs everything against a simulated keyboard (`src/demo.js`), including the
  live test, profiles and sleep timers. `?dongle=classic` uses qmk.top's slower 2.4G timing (for
  comparing load times; the source chip shows the last load time). `?demo&ignore=15:7` makes it drop writes to slot 15 /
  param 7, which reproduces a failed write.
- **Tests:** `node tests/run.mjs` runs all suites. They drive `src/device.js` against simulated
  keyboards and check exact packets, read-back and the blocked cases.
- **Reference code:** `node tools/fetch-qmk.mjs` downloads qmk.top's GearHub and v4 bundles plus
  the RY5088 base class (the whole protocol), the RT75 device module and the layout chunk, into
  `reference/qmk/` (git-ignored).
- **Diagnostics:** `probe.html` (device ID), `dump.html` (full read-only settings dump to JSON) and
  `knob-listen.html` (sends nothing; logs the keyboard's own reports, e.g. knob and lighting pushes).

## Code map

| File | Role |
|---|---|
| `src/device.js` | Everything that touches HID: transport (wired and 2.4G dongle relay), reads, validated writes, live depth, keyboard-wide settings |
| `src/app.js` | UI state and rendering: sidebar and header, board, knob mode, inspector/editor (travel sliders), pending edits, review dialog, Undo, live test, presets, keyboard settings |
| `src/layout.js` | RT75 key positions (from qmk.top) and the factory key matrix; `slot` = key-matrix index |
| `src/macros.js` | Macro buffer encoding (mirrors qmk.top), checks, modes, step labels |
| `src/library.js` | Macro library in this browser: storage, export/import, out-of-date check |
| `src/lighting.js` | Lighting effects table (from qmk.top's RT75 entry), packet encode/decode, diffs |
| `src/patterns.js` | Custom lighting patterns: per-key colour helpers, quick fills, saved-design storage |
| `src/demo.js` | Simulated keyboard (per-profile settings, polling rate, sleep timers, lighting, live reports) |
| `src/dropdown.js` | Styled dropdowns (M1 design) layered over every native `<select>`; the select stays the source of truth |
| `src/styles.css` | Theme tokens (dark only) and all styles |

## Rules that must not be broken

1. **Find qmk.top's code path first and mirror it exactly** (packet layout, order, flags, delays).
   Record the evidence in protocol-notes.md.
2. **Every outgoing packet passes an allowlist validator before anything is sent**:
   `assertAllowedWrite` (per-key magnet), `assertAllowedKeyboardWrite`, the sleep validator,
   `assertAllowedKeymapWrite`, `assertAllowedLightWrite`, `assertAllowedMacroWrite`, and the
   read allowlist `READ_COMMANDS`. New commands get their own validator.
3. **Writes go through review → write → read back → report mismatches → Undo.** No silent writes.
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

## Status (2026-10-18)

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

**Custom lighting patterns (feature/custom-lighting, demo-tested, not yet verified on the keyboard):**
Lighting › Custom patterns (design C3, canvas Round 17): per-key colours for the Custom effect's
Pattern 1–5, read with `0x8C` on demand and written with `0x0C` (7 packets, validator
`assertAllowedUserPicWrite`) with read-back; all five read ahead once Custom is the effect; quick
fills, paint/pick, colours from a picture (choose/drop/paste), designs saved in this browser with a
built-in Sunset (`src/patterns.js`). Writing also queues the effect switch to Custom · that pattern.
qmk.top's "IoT" desktop helper isn't needed (protocol-notes.md, "Custom lighting").

**Next:** the user's choice; options offered: knob remapping, switch type, DKS editor (pinned, X1).

**Branches:** `feature/macros` holds the abandoned read-back approach and the full investigation
log (probe pages). Don't merge it.
