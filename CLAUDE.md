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
  live test, profiles and sleep timers. `?demo&ignore=15:7` makes it drop writes to slot 15 /
  param 7, which reproduces a failed write.
- **Tests:** `node tests/run.mjs` runs all suites. They drive `src/device.js` against simulated
  keyboards and check exact packets, read-back and the blocked cases.
- **Reference code:** `node tools/fetch-qmk.mjs` downloads qmk.top's GearHub and v4 bundles plus
  the RY5088 base class (the whole protocol), the RT75 device module and the layout chunk, into
  `reference/qmk/` (git-ignored).
- **Diagnostics:** `probe.html` (device ID) and `dump.html` (full read-only settings dump to JSON).

## Code map

| File | Role |
|---|---|
| `src/device.js` | Everything that touches HID: transport (wired and 2.4G dongle relay), reads, validated writes, live depth, keyboard-wide settings |
| `src/app.js` | UI state and rendering: board, inspector/editor, pending edits, review dialog, Undo, live test, presets, keyboard section |
| `src/layout.js` | RT75 key positions (from qmk.top) and the factory key matrix; `slot` = key-matrix index |
| `src/demo.js` | Simulated keyboard (per-profile settings, polling rate, sleep timers, live reports) |
| `src/styles.css` | Theme tokens with light and dark modes |

## Rules that must not be broken

1. **Find qmk.top's code path first and mirror it exactly** (packet layout, order, flags, delays).
   Record the evidence in protocol-notes.md.
2. **Every outgoing packet passes an allowlist validator before anything is sent**:
   `assertAllowedWrite` (per-key magnet), `assertAllowedKeyboardWrite`, the sleep validator, and the
   read allowlist `READ_COMMANDS`. New commands get their own validator.
3. **Writes go through review → write → read back → report mismatches → Undo.** No silent writes.
4. **Never send:**
   - calibration (`0x1C`, `0x1E`; qmk.top's all-keys depth read only works inside calibration,
     which rewrites it)
   - flash erase, bootloader or firmware commands; reset (`0x01`)
   - bulk magnet table writes (`[0x65, param, 1, …]`, which overwrite keys absent from the batch)
   - debounce (`0x06`; qmk.top doesn't offer it for this keyboard)
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
- **The browser pane sometimes switches to a static file preview after an edit.** Navigate back to
  http://127.0.0.1:5180/?demo.
- Demo presets use their own storage key (`rt75-studio-presets-demo-2865`).

## Status (2026-10-15)

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
system keys locked. Tested on the simulated keyboard and in the demo; the base and Fn reads are
verified on the real keyboard, and the writes are awaiting a real-keyboard check.

**Was next: key remapping and Fn layers.** What's known so far (details in protocol-notes.md):
- Key matrix read: `[0x8A, profile, 0xFF, page 0–7, sub]`, 4 bytes per slot. Plain key
  `[0, 0, HID, 0]`; media `[3, 0, usage lo, hi]`; Fn `[10, 1, 0, 0]`; knob `[13, …]`.
- Byte 4 (`sub`) is a sub-layer, not the profile.
- Fn matrix read is `0x90`, with the OS (win 0 / mac 1) in byte 1. Single-key matrix write is
  `setKeyConfigSimple` (`0x0A`) in the RY5088 base.

**After that: lighting** (`0x07`/`0x08`, format not decoded).
