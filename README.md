# RT75 Studio

A cleaner, read-only configurator view for the Yunzii RT75 Pro. It talks to the keyboard
directly over WebHID, with no vendor driver or account. Protocol details are in
[protocol-notes.md](protocol-notes.md).

## Run

WebHID needs `localhost` (or HTTPS), so serve the folder and open it in Chrome or Edge.
`serve.py` disables caching so changes show up on a normal reload:

```bash
python serve.py
```

Then go to http://127.0.0.1:5180, close qmk.top, and click **Connect keyboard**.
A USB cable is faster than the 2.4G dongle.

## Files

| File | Purpose |
|---|---|
| `index.html`, `src/` | The app: `layout.js` (RT75 key positions and slots), `device.js` (read-only protocol), `app.js` (UI) |
| `dump.html` | Diagnostic: reads every setting and exports JSON |
| `probe.html` | Diagnostic: reads the device ID only |
| `fixtures/sample-dump.json` | A real dump used by "load the sample" |

To try the editor without a keyboard, open http://127.0.0.1:5180/?demo. It runs against a
simulated RT75 Pro loaded from `fixtures/sample-dump.json`.

## Editing

Select keys (Ctrl- or Shift-click for several, or **Select all**), then change actuation, release
point, top and bottom dead zones, Rapid Trigger and RT sensitivity in the side panel.

For Snap Tap, select a key and choose **Pair with another key…**, then click its partner.
You can also select exactly two keys and choose **Pair these two keys**. Pairing a key that
already has a partner releases the old partner, and **Remove pair** releases both keys. Rapid
Trigger is kept either way. Keys using DKS, mod-tap or toggle modes aren't changed by this app. Changes stay local, shown with a dashed
outline, until you click **Review changes…**. The review shows every before → after value and
can download a backup first. After writing, the app reads the values back from the keyboard to
confirm them and offers **Undo**. A backup file can be reopened with **Open dump…**.

## Live test

The **Live test** tab shows how deep the key you're pressing goes, live, against that key's
saved actuation and release points and dead zones. It also shows peak depth, a 3-second trace,
and whether your computer registered the key press. Select a key first to see its trigger
points before pressing anything. It needs the USB cable.

The keyboard reports one depth value at a time, for whichever key is moving. The key's name comes
from the browser's key events, so Fn and keys pressed only part-way don't change the focus key.

## Presets

**Presets…** saves the current setup (actuation, release, dead zones, Rapid Trigger and Snap Tap
for every key, including unsaved edits) under a name, in this browser. Applying a preset loads
it as unsaved changes, so it goes through the same review → write → read-back flow. Presets can
be exported to a file and imported again. Demo-mode presets are stored separately.

## Safety

- **Reads** use only `0x80 0x83 0x84 0x86 0x8A 0x8F 0xE5 0xE6`, plus 2.4G dongle status and routing.
- **Writes** use only the single-key magnet command (`0x65`, params 0/1/2/3/6/7/9/251), the
  same form qmk.top uses for one key. Every packet is validated before the first is sent:
  - real key slots only (not the knob or unused slots)
  - actuation and release 0.1–3.3mm; RT sensitivity 0.005–2mm; dead zones 0–1mm
  - a Snap partner must be a different real key
  - known key modes only; valid checksum
- The device ID is re-checked before writing, and writing is disabled if the travel precision
  is unknown.
- **The live test** sends only `0x1B 01` and `0x1B 00`, which turn depth reporting on and off.
  The same toggle is used by qmk.top's Simulation Test. It's turned off when you stop, leave the
  tab, refresh or close the page.
- qmk.top's all-keys depth read only works inside switch calibration mode, which rewrites
  calibration, so it isn't used.
- Bulk table writes, key remapping, lighting, calibration, firmware and reset commands aren't
  implemented.
