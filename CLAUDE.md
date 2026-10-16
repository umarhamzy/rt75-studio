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
| `src/demo.js` | Simulated keyboard (per-profile settings, polling rate, sleep timers, lighting, live reports) |
| `src/styles.css` | Theme tokens with light and dark modes |

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

## Status (2026-10-16)

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

**Configuration redesign (feature/config-redesign, demo-tested, not yet verified on the keyboard):**
- Dark-only theme (amber accent, Archivo + JetBrains Mono from Google Fonts with system fallbacks).
- Sidebar navigation and a device card; Profile 1–4 and **Review changes** (with a live count) in
  the header. The pending bar is gone; Discard all is in the review dialog.
- Keychron-style vertical actuation and release sliders.
- The knob is drawn as a rocker on a dial and shows the mode it last saw. `watchKeyboardEvents`
  (device.js) only listens on the report interface, already granted at connect; it never sends.
- Design mockups: the "RT75 Studio UI styles" canvas artifact (Rounds 1–7).

**Next, in the user's order:** mod-tap, then custom lighting patterns (`0x0C`/`0x8C`).

**Branches:** `feature/macros` holds the abandoned read-back approach and the full investigation
log (probe pages). Don't merge it.
