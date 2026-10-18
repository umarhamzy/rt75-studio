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

## Layout

The app is dark only. A sidebar holds the sections: **Configuration** (with Actuation, Rapid
Trigger and Snap Tap tabs above the board), **Key map**, **Macros**, **Lighting**, **Live test** and
**Keyboard settings**, plus a card with the keyboard's firmware, link, polling rate, battery and
knob mode. The header has **Profile 1–4** and **Review changes**, which shows how many changes
are waiting.

## Editing

Select keys (Ctrl- or Shift-click for several, or a group from **Select…**: all keys, WASD,
letters, numbers, function keys, modifiers or arrows), then change actuation, release point, top
and bottom dead zones, Rapid Trigger and RT sensitivity in the side panel.

Actuation and release use vertical sliders: 0 mm (key up) at the top, the deepest setting at the
bottom, so moving the handle down is like pressing the key further. Drag the handle, use the arrow
keys (Shift for 0.1 mm), or type a value in the bubble next to it. Untick **Release at the same
point** to get a second slider for the release point. Dead zones are hatched at the ends. On the
board, each key has two thin bars on its right edge, filled from the top down: amber to the press
(actuation) point and cyan to the release point. They're equal when the key releases where it fires.

For Snap Tap, select a key and choose **Pair with another key…**, then click its partner.
You can also select exactly two keys and choose **Pair these two keys**. Pairing a key that
already has a partner releases the old partner, and **Remove pair** releases both keys. Rapid
Trigger is kept either way. Keys using another key mode (mod-tap, DKS, toggle) can't be paired until
they're set back to Normal.

Each key has a **Key mode** in the side panel: Normal, Mod-tap, DKS or Toggle.
The **Key modes** tab shows mod-tap (green), toggle (orange) and DKS (pink) keys on the board. Travel
and dead zones stay as they are on keys in these modes, as in qmk.top.

For **DKS** (dynamic keystroke), one press can send up to four keys or combos, each at the moments you
choose: pressing past the trigger point, reaching the bottom, leaving the bottom, and releasing past
the trigger point. With one DKS key selected, its four actions appear under the keyboard: pick a key
for each, then click a moment's dot to cycle nothing → tap → hold → hold further, or click a hold where
it should end. **Try a press** scrubs through one press and shows which keys would be down. The trigger
point (0.50–2.50 mm) is in the side panel. A key switched to DKS starts by holding its own key from
press to release, so it behaves as before until you change it.

For **toggle**, a tap on the key switches its action on or off, and holding the key works normally.
**Long press** keeps the action held after a tap; **Rapid fire** repeats it (at the keyboard's own
speed). The action is any key or combo; **Try it** previews what the computer would see.

For **mod-tap**, set Key mode to Mod-tap: a quick tap sends the tap
key, and holding past the hold time (10–1000 ms, 200 ms by default) sends the hold key. Tap starts
as what the key sends now, and Hold as Left Ctrl. Pick either from the list, or use **Press keys**
to record a combo such as Ctrl + C. Turning it off makes the key send its tap key again. A Snap Tap
key has to leave its pair first. In Key map, a mod-tap key's base layer shows tap/hold and is edited
here instead.

Changes stay local, shown with an amber dashed
outline, until you click **Review changes** in the header. The review shows every before → after
value, can download a backup first, and has **Discard all**. After writing, the app reads the values
back from the keyboard to confirm them and offers **Undo**. A backup file can be reopened with
**Open dump…**.

## Volume knob

The knob has two modes; holding it down switches between them. In volume mode, turning it
changes the volume and pressing it mutes. In lighting mode, turning it changes brightness and
pressing it picks the next effect. The keyboard doesn't report which mode it's in, so RT75 Studio
listens (it sends nothing) to what the knob reports while the page is open and shows the mode it
last saw: on the knob's icons, in the device card, and in the knob's panel. Until you use the knob
the mode shows as unknown. Brightness and effect changes made on the keyboard also update the
Lighting view.

## Keyboard settings

- **Profile 1–4** (in the header) switches the active profile straight away, then re-reads
  everything, because each profile stores its own key settings.

The **Keyboard settings** section replaces the board with these cards:
- **Fn layer shown** picks which Fn layer Key map and Macros show. By default it follows the
  keyboard's own Win/Mac switch (read at connect, and updated when you move the switch); you can
  pin Windows or Mac instead. That choice is saved in this browser and doesn't change the
  keyboard, which keeps both layers.
- **Win/Mac switch** shows which side the keyboard's switch is on.
- **Polling rate** (125Hz–8kHz) is queued like any other edit and written through the review.
- **Wireless power saving** sets, in minutes: Bluetooth backlight off (0 = never), Bluetooth deep
  sleep (at least 10 seconds) and 2.4G backlight off (0 = never). Each goes up to 18 hours,
  and changes go through the review.
- **Debounce** is shown read-only: qmk.top doesn't offer it for this keyboard, and magnetic
  switches don't bounce like mechanical contacts.
- **Display** (saved in this browser): **Help texts** hides the explanations in the side panel,
  below the tabs and under these settings (warnings and status messages still show), and **Travel
  bars on keys** hides the press and release bars on the Actuation tab.

## Key map

The **Key map** tab shows what every key sends on the active profile, for the base layer and the
Fn layer (Windows or Mac, as chosen in Keyboard settings). Keys that differ from the factory setting are outlined.

To change a key:
1. Select it and click the layer row you want to edit.
2. Choose one of:
   - **press a key to assign** (held modifiers are included), or pick from the key list (which
     includes keys the RT75 lacks, such as F13–F24)
   - up to two **modifiers**
   - a **function** (media, apps, connection, profile, lighting…)
   - **Disable** (base) or **No Fn action** (Fn layers)
   - **Restore factory**
3. With several keys selected, Disable and Restore factory apply to all of them.

Edits go through the same review → write → read-back → Undo flow. Locked, as in qmk.top:
- the **Fn key** (so the Fn layers can't be lost)
- **system keys** (functions qmk.top can't name, such as Fn+Tab)

Keys holding a mouse or mod-tap action from qmk.top can be overwritten, with a warning, but Undo
can't restore those actions.

## Lighting

**Custom patterns** (Lighting › Custom patterns): the keyboard stores five per-key colour patterns,
shown by the Custom effect. Pick a pattern (it's read from the keyboard), start from a fill (Solid,
Gradient, Rainbow rows, Rainbow sweep, Highlight WASD) using the two colours in the toolbar, then
click keys to paint them (right-click picks a key's colour up). **From a picture**: choose, drop or
paste an image and each key takes the colour of the part under it (fill the keyboard or fit the
whole picture; Vivid strengthens colours for LEDs). Designs can be saved in this browser and loaded
into any pattern; **Sunset** comes built in. Writing a pattern also switches the lighting to Custom with that
pattern, and goes through Review changes with read-back and Undo. No helper program is needed
(qmk.top asks for its "IoT" driver only for music/screen effects, its design library and wireless).


The **Lighting** tab sets the backlight for the whole keyboard:
- **effect:** the 19 effects qmk.top offers for the RT75 Pro, by the same names
- **brightness** and **speed** (0–4; brightness 0 turns the lights off)

Lighting is shared by all four profiles.
- **colour:** rainbow, a preset or any custom colour
- **direction** or pattern, for effects that have one

The board shows an approximate animated preview. Changes go through the same review → write →
read-back → Undo flow. Music Sync and Light Shadow run from qmk.top's own sync, so RT75 Studio
shows them when they're active but doesn't set them.

## Macros

The **Macros** tab is a library of named macros, kept in this browser, like qmk.top's Key Scheme
Library.
- **Create and edit** macros in the step editor:
  - **Record** captures key presses and releases with their timing (Esc stops).
  - Keys, modifiers and mouse buttons can be added from lists.
  - Each step's wait can be changed, or set for all steps at once.
  - Steps can be moved, flipped between press and release, or deleted.
  - Set the repeat count for Loop count mode here.
- **Put a macro on a key** in the Key map tab: select the key, then under **Macro** pick it, or
  **New macro…**, and a play mode:
  - Loop count
  - Hold to play (plays while the key is held; qmk.top calls it "Press to Play")
  - Toggle playback
  
  RT75 Studio writes the macro to a slot no key uses on any profile.
- **Edit a macro that keys use,** and the change is queued for review and written again.
- **Remove from keys** puts the keys that run a macro back to their factory action (reviewed like any
  change). The keyboard has no command to delete a macro, so its slot is simply left unused.
  **Delete** removes a macro from the library.
- **Export** the library to a file for a backup or another browser, and **Import** it back.

The keyboard can't give macro steps back, so this library is the only copy of names and steps.
Macros made in qmk.top show as "made elsewhere" and can be re-created here by recording them
again. Key assignments are confirmed by reading them back; macro steps can't be (the keyboard's
macro read isn't reliable), so press the key to check.

Limits:
- up to 256 bytes per macro (about 125 short steps)
- delays from 1 ms to 65.5 s
- no mouse movements

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

- **Reads** use only `0x80 0x83 0x84 0x86 0x87 0x8A 0x8F 0x90 0x91 0xE5 0xE6`, plus 2.4G dongle status and routing.
- **Writes** use only the single-key magnet command (`0x65`, params 0/1/2/3/6/7/9/251), the
  same form qmk.top uses for one key. Every packet is validated before the first is sent:
  - real key slots only (not the knob or unused slots)
  - actuation and release 0.1–3.3mm; RT sensitivity 0.005–2mm; dead zones 0–1mm
  - a Snap partner must be a different real key
  - known key modes only; valid checksum
- The device ID is re-checked before writing, and writing is disabled if the travel precision
  is unknown.
- **Keyboard-wide writes** are only polling rate `[03, 00, code]` (codes 0–6), profile
  `[04, index]` (0–3) and sleep timers (`0x11`, four 16-bit values in seconds, range-checked as
  above, with 2.4G deep sleep always written back unchanged). Each has its own validator and is
  read back afterwards.
- **Key-map writes** are only `[0A, profile, key, 0, 0, save, 0, …, action]` (base) and
  `[10, os, profile, key, …, action]` (Fn layers). Their validator allows only:
  - disabled
  - one key with up to two modifiers
  - functions from the list
  - the slot's exact factory value

  It refuses the Fn key, the knob, macros, mouse, key-map mod-tap (action 24) and unknown actions.
- **Mod-tap** is a key mode (3) plus two key-map entries: the hold key on the base layer and the tap
  key on sub-layer 1 (`[0A, profile, key, 0, 0, save, 1, …]`), keys only, in qmk.top's mod-tap layout.
  The hold time is magnet param 5 (one byte, ms ÷ 10, 10–1000 ms).
- **Lighting writes** are only `[07, effect, speed, brightness, option/colour mode, r, g, b]`
  with qmk.top's byte-8 checksum. The validator allows only the offered effects, values 0–4,
  each effect's own options, and colour mode single colour or rainbow.
- **Macro writes** are only `[0B, slot 0–49, page, 56, last, …, data]`, and each packet must match one
  built from a macro that passed the checks: known keys and mouse buttons, delays 1–65535 ms,
  repeat 1–65535, at most 256 bytes, no mouse moves. Macro slots are never read.
- **The live test** sends only `0x1B 01` and `0x1B 00`, which turn depth reporting on and off.
  The same toggle is used by qmk.top's Simulation Test. It's turned off when you stop, leave the
  tab, refresh or close the page.
- qmk.top's all-keys depth read only works inside switch calibration mode, which rewrites
  calibration, so it isn't used.
- Bulk table writes, side lights, custom lighting patterns, calibration, firmware and reset
  commands aren't implemented.
