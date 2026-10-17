# GearHub-V5 (qmk.top) protocol notes

Static analysis of `https://qmk.top/js/index.BsaXDJDS.js` (3.5 MB, minified React + MobX)
and of the separate **v4 app at `https://qmk.top/v4/`**, which is what actually drives the
RT75 Pro. Target device: Yunzii RT75 Pro (Hall-effect / magnetic switches). The only
commands sent to the device so far are the read-only `0x8F` ID query and dongle status
polls (`probe.html`). Everything else is from the code, not from captures.

## Yunzii RT75 Pro: confirmed facts (probe runs, 2026-10-15)

| | Wired | 2.4G dongle |
|---|---|---|
| HID product name | `YUNZII RT75 PRO Keyboard` | `2.4G Wireless Keyboard` |
| VID / PID | 0x3151 / **0x5030** | 0x3151 / **0x5038** |
| Config interface | usagePage 0xFFFF, usage 0x02 (the only one with a feature report) | same |
| `0x8F` reply | `8f 31 0b 00 00 00 00 12 05 …` | identical (relayed) |
| Device ID | **2865 (0x0B31)** | 2865 |

Bytes 7–8 of the `0x8F` reply are the **USB firmware version**, read as `resp[8] << 8 | resp[7]`
(the same as v4's `getUSBVersion`). For this keyboard that's **0x0512 (1298)**. The RF firmware
version comes from `0x80` as `resp[2] << 8 | resp[1]`.

### Verified against a real settings dump (wired, 2026-10-15)

Two read-only dumps (`dump.html`, one with layer 0 only and one with all four layers)
returned byte-identical settings. Findings:

- **Replies to simple GETs echo the request with the data filled in.** For example, polling
  rate returned `83 00 03 00 00 00 00 7c`, which is our request with byte 2 = 3 (1000 Hz); the
  checksum byte is still the request's. Profile = 0, debounce = 0.
- **qmk.top screenshot (same session) matches the dump exactly:** W shows 0.800mm
  actuation and 0.3mm RT; LShift, C and Space show 0.800; other keys 1.300; the RT slider range
  is 0.005–2mm. W's "Full Travel Continuous Rapid Trigger" toggle is on, which corresponds to mode
  bit 0x80. "Profile 1" in the UI is profile index 0.
- **Dead zones confirmed in qmk.top's "Dead Zone Settings" dialog:**
  - Bottom dead zone (param 6) shows 0.300mm and top dead zone (param 251) shows 0.000mm,
    matching raw 60 and 0 at 200 units/mm.
  - So param 6 is the bottom dead zone, as the enum names suggested.
  - qmk.top describes it as the distance from the bottom within which the key is not
    re-triggered, which helps against interference.
  - It warns that a top dead zone of 0 may cause accidental presses.
- **Firmware string confirmed:** qmk.top's Upgrade panel shows "ID2865_V512". That's device ID 2865
  from `0x8F` bytes 1–4, and version 0x0512 from bytes 7–8 (RT75 Studio displays "fw 5.12").
- **RT75 Studio live reads verified (2026-10-15):** after the user changed several keys in
  qmk.top, a Refresh in RT75 Studio (wired) matched qmk.top on actuation, rapid trigger and
  Snap Tap.
- **qmk.top v4 UI inventory (feature checklist for our rebuild):**
  - Main tabs: Custom Keys / Magnetic Switch Settings / Advanced Key Settings / Other Settings.
  - Magnetic sub-pages: Travel Settings (per-key actuation slider, dead zones, RT with
    continuous mode and press/release sensitivity), Switch Settings and Simulation Test.
  - Also: Anti-Accidental Trigger mode (RTStab-style), per-key legends showing travel values,
    and a "Key has been modified" highlight.
  - Sidebar: Keyboard Settings, Fn Layer Settings, Key Scheme Library (cloud), Light Settings,
    More.
  - Actions: Read Device Configuration, profile selector, Reset Key, Travel Calibration and
    Restore Factory Settings.
  - Footer links: Gear Lab, Dynamic RGB, Test Tool.
- **There's no feature list:** `0xE6` returned our own packet without the `0xAA` marker. Travel
  precision therefore follows v4's legacy rule: `v = rfVersion || usbVersion`;
  768 ≤ v < 1280 → 100 units/mm, v ≥ 1280 → 200 units/mm, no version → 10.
  For this keyboard it's **200 units/mm (0.005mm steps). Confirmed:** qmk.top shows W at
  0.80mm (raw 160) and other keys at 1.30mm (raw 260). So RT sensitivity 60 = 0.30mm and
  bottom dead zone 60 = 0.30mm.
- **Paged data replies are raw.** Key matrix and magnet pages carry no header, and 64 bytes
  are concatenated per page as the code expects. Slot indexing is confirmed: A (slot 9) and D
  (slot 21) are a Snap Tap pair whose partner fields point at each other.
- **Key mode byte confirmed:** `0x80` = rapid trigger on a normal key; `0x87` = rapid trigger + Snap/SOCD.
- **The user's current config:** W, A, S, D have rapid trigger. A and D are Snap Tap partners.
  W, A, S, D, LShift, C and Space use raw actuation 160; every other key uses 260.
  RT sensitivity is 60 (press and release) and bottom dead zone 60.
  Release point equals actuation.
- Knob slots (91–95) report 400/560 travel values. They aren't magnetic keys; ignore them.
- Slot 27 (F) has stale mod-tap time (21 → 210 ms), top dead zone 60 and switch type 0,
  although its mode is normal. These look like leftovers from an earlier setting.
- Snap partner bytes for slots 0–2 read `00 00 06` instead of `FF`. They're only meaningful
  when the key's mode is Snap, so they're ignored.
- Layers 1–3 (`0x8A` with byte 4 = 1..3) read as all zeros. Either byte 4 isn't the layer for
  this firmware or those layers are simply empty; this is still open.

The dongle didn't recognise `F1` (dongle ID) and returned its status buffer instead.
Status at probe time: keyboard online, battery 100%, no mouse.

### How qmk.top handles it

GearHub-V5's built-in table has no ID 2865. For any device not in that table,
`___isV4Device()` is true and the app redirects to `/v4/`. There, device ID 2865 is:

```
{id:2865, name:"ry5088_zmd_k982d_3m_8k_1k", displayName:"RT75PRO", company:"YUNZII",
 keyLayout:Common81_RT75, layer:4, fnSysLayer:{win:1,mac:1}, magnetism:true,
 other:{isSwitchReplaceable:true,
        supportedSwitchTypes:[高特 Gateron, 磁玉 Jade, 磁玉pro, 磁玉gaming, 天王, 万磁王, 赤霄轴],
        knobKeyCodes:[VolDown, Mute, VolUp], nonModifiableKnobKeyCodes:[Mute],
        sleep24/sleepBT: 0–18 h (BT deep sleep 10 s–18 h)}}
```

(The v4 table also lists a white RT75 Pro, `ry5088_zdm_k982drt75pro_white_3m_8k_8k`, and an
older `ry5088_nopita_mk825_3m_8k` entry with PID 20528 and ID 3100.)

- **Chip:** RY5088; the name suggests 8 kHz polling.
- **Layout:** 81 keys with a knob (`keyboard_81_rt75_keymappings_ui_info`, chunk `729382e9.js`).
- **4 layers**, plus Fn layers for Win and Mac.
- **Code:** device module `v4/js/3e5b99fe.js` (default key/Fn matrices only), base class
  `v4/js/2afbe09a.js` (the whole RY5088 protocol). Loaded via `findRy5088Device`
  (`v4/js/698fd79e.js`).

### RY5088 command set (from `2afbe09a.js`; these numbers apply to the RT75 Pro)

| SET | GET | Name |
|---|---|---|
| 0x01 | | Reset |
| 0x03 | 0x83 | Report (polling) rate |
| 0x04 | 0x84 | Profile |
| | 0x85 | LED on/off |
| 0x06 | 0x86 | Debounce |
| 0x07 | 0x87 | Main LED params |
| 0x08 | 0x88 | Side LED params |
| 0x09 | 0x89 | KB options (Win lock, Alt+Tab, Alt+F4 …) |
| 0x0A | 0x8A | Key matrix |
| 0x0B | 0x8B | Macro |
| 0x10 | 0x90 | Fn matrix |
| 0x11 | 0x91 | Sleep time |
| 0x17 | 0x97 | Auto OS detect |
| 0x1B | | Magnetism live report |
| 0x1C | | Magnetism calibration |
| 0x1E | | Max-travel calibration |
| 0x50 | 0xD0 | SKU |
| 0x65 | 0xE5 | Multi-magnetism (per-key Hall settings) |
| | 0x8F | USB version / device ID |
| | 0xE6 | Feature list (includes travel precision) |
| | 0x80 / 0xAD / 0xAE | RF / OLED / MLED version |

Do not send: `0xAC` (flash chip erase) and the OLED/TFT/bootloader commands.

### Key matrix format

4 bytes per key slot, in column order. A plain key is `[0, 0, hidCode, 0]`; for example Esc
is `00 00 29 00`. Other first bytes encode media keys (`03 00 E2 00` = Mute), Fn and
layer actions (`0A …`), knob events (`0D …`) and macros. Decoding these is the next
mapping task.

### Hall-effect parameters (RY5088 numbering, the `P6` variant)

| Param | Meaning | Per-key encoding |
|---|---|---|
| 0 | Actuation point | uint16 LE × step |
| 1 | Release point | uint16 LE × step |
| 2 | RT press sensitivity | uint16 LE × step |
| 3 | RT release sensitivity | uint16 LE × step |
| 4 | DKS start travel | uint16 LE × step |
| 5 | Mod-tap hold time | uint8, ms ÷ 10 |
| 6 | Bottom dead zone | uint16 LE × step |
| 7 | Key mode (normal / RT / DKS / MT / TGL / snap) | uint8 |
| 8 | DKS optional flags | |
| 9 | SOCD / Snap Tap partner key index | uint8 |
| 10 | All-keys DKS flags | |
| 251 | Top dead zone (if supported) | uint16 LE × step |
| 252 | Switch type (for the switch-swap picker) | uint8; see the table below |
| 254 / 255 | Live key-press travel / value (read only) | |

- **Step:** mm × 100 at 0.01mm precision (the default), × 200 at 0.005mm, × 1000 at 0.001mm.
  Precision comes from the `0xE6` feature list.
- **Bulk write:** header `[0x65, param, 1, page, isLastPage, 0, 0, checksum]` followed by 56
  data bytes per page. The app sends only the parameters that changed since its last read.
- **Single key** (`_sendMagnetismInfoSimpleCMD`, used by `setMagnetismInfoSimple` and by
  RT75 Studio): `[0x65, param, 0, keyIndex, isLast, 0, 0, checksum, value…]`. The value is a
  uint16 LE for travel params and one byte for mode (7). Within one key, qmk.top sends mode
  first, then travels in the order 0, 1, 6, 2, 3, 4, 8, 5, 251. In qmk.top's one-key editor `isLast = 1` goes on
  that key's final packet, followed by vendorSleep (100 ms). For multi-key batches RT75 Studio flags only the batch's final packet (see below). There's no reply; wired sends are a bare
  feature report, and 2.4G sends go through `F6 0A` and wait for the dongle's canSend.
- **Mode byte encoding** (`_magnetismModesOptionToNum`): normal 0, dks 2, mt 3, tgl_hold 4,
  tgl_dots 5, snap 7; `| 0x80` when Rapid Trigger ("fire") is on.
- **qmk.top defaults:** RT sensitivity 0.2mm (used when enabling RT on a key with none set).
  RT sensitivity range is one step to 2mm; actuation and release range is 0.1–3.3mm.
- **Bulk writes** (`setMultiMagnetismInfo`) rewrite a parameter's whole 128-slot table, filling
  keys absent from the batch with defaults (actuation 200, release 280, dead zone 30). RT75
  Studio deliberately doesn't use this path.
- **Dead zone writes:** bottom (6) is a uint16 and top (251) is **one byte**, as in qmk.top's
  simple path `o=[topDeadZone*n]`. Both range 0–1mm (`死区最小值/最大值`,
  `topDeadZoneMin/Max`), and 1mm = 200 units still fits a byte. qmk.top only sends 251 when
  `get支持顶部死区()` is true (USB or RF version ≥ 1024); 0x0512 qualifies.
- **Travel limit from the bottom dead zone** (qmk.top's travel slider, chunk `cd3ec6e4.js`, reported
  by the user 2026-10-18): actuation and release are clamped to `max − bottom dead zone`
  (`f = Math.min(f, i - e.deadzone)`, `i` = 3.3 mm), and raising the bottom dead zone pulls a deeper
  point back up (`travelDistance > i - deadzone → onChange(i - deadzone)`). RT75 Studio does the same
  in its sliders.
- **qmk.top's slider ignores the top dead zone:** it computes its position and throws it away, and
  always draws `top_deadzone` empty; nothing clamps against it. The user saw changing it in qmk.top
  make no visible difference (2026-10-18).
- **The RT75 adds the top dead zone to the actuation point (tested by the user, 2026-10-18):** top
  dead zone 1.00 mm + actuation 1.00 mm triggered at about 2.00 mm, in RT75 Studio's live test,
  qmk.top's, and by feel. So the top dead zone shifts where travel is counted from; it isn't a
  separate zone the actuation point must clear. RT75 Studio's Press slider marks the real trigger
  point (actuation + top dead zone) with a dashed line and says so under the slider. Whether the
  release point and Rapid Trigger are shifted the same way is untested.
- **Snap Tap pairs:** qmk.top builds each pair as two keys with `option:"snap"`, each binding the
  other, keeping each key's `fire` (RT) flag. On the wire that's mode 7 (`| 0x80` with RT) for both
  keys, plus a single-key param 9 write per key holding the partner's slot. These are sent last
  in the batch, followed by a 500 ms wait.
  - **Removing a pair** only changes the mode back to normal; the partner byte is left as is.
    That explains the stale bytes such as `00 00 06` seen in the dump.
  - **RT75 Studio** does the same: pairing a key that already has a partner releases the old
    partner. It only touches keys in Normal or Snap mode.
- **The `isLast` byte (byte 4) behaves like "save now". Set it once per batch.**
  - First real Snap Tap test (W + S, 2026-10-15): RT75 Studio set the flag at the end of each key.
    W's writes stuck, but S's first packet (its mode) was lost; S's partner byte was written.
  - Most likely cause: the keyboard was still saving after W's flagged packet. GearHub-V5 also
    blocks sends while the keyboard reports a flash in progress (input report 5, `AA AA`).
  - qmk.top's batch path (`setMultiMagnetismInfo`) only flags the final packet of the whole
    batch, so RT75 Studio now does the same.
  - It also re-sends any value that reads back wrong once, after an 800 ms pause.
  - With one save flag per batch, completing the W↔S pair on the real keyboard succeeded on the
    first attempt: 2 settings confirmed by read-back, no retry. That's consistent with the timing
    explanation, though one run doesn't prove it.
- **Write path status:** verified against a simulated keyboard (packet order, flags, checksums,
  read-back). It was then run on the real keyboard (2026-10-15, wired): F12 actuation and release
  went from 1.30 to 1.25mm. RT75 Studio's read-back confirmed both values, and qmk.top showed the
  new value. qmk.top never sends RT sensitivity for a key with RT off; RT75 Studio drops those
  edits the same way.
- **Bulk read:** `[0xE5, param, 1, page]`, one 64-byte page at a time.

**Switch type values (param 252)**, from the v4 enum `y5`; English names are qmk.top's own.
The RT75 Pro offers seven:

| Byte | qmk.top name | English (as shown in qmk.top) |
|---|---|---|
| 0 | 高特 | Outemu |
| 1 | 磁玉 | Magnetic Jade |
| 2 | 磁玉pro | Magnetic Jade Pro |
| 3 | 磁玉gaming | Magnetic Jade Gaming |
| 4 | 天王 | Heavenly King |
| 5 | 万磁王 | Magneto |
| 46 | 赤霄轴 | Red Sky Axis |

Any value not in the enum (the RT75 Pro reports 0xFF on unset keys) is shown as Outemu,
type 1 in qmk.top's 1-based picker. The enum has many other entries (up to 46) for other
boards. qmk.top's maximum settable actuation is 3.3mm for every switch type
(`轴体行程最大值` returns 3.3; 4mm only on firmware below 0x0300).

---

The sections below describe the GearHub-V5 app generically, from the first pass.

## Stack

- React + MobX UI, protobuf-ts, pako, jszip, wasm gif2apng, ffmpeg-core.
- UI strings are Chinese keys passed through `e("...")`; translations for en/ru/ko.
- Vendor: Rongyuan (`*.rongyuan.tech`). "GearHub" is their white-label configurator.

## Connection modes

| Mode | How | Notes |
|---|---|---|
| `web` | WebHID (`navigator.hid`) | Default. "Allow Browser Access" button. |
| `proto` | gRPC-web to `http://127.0.0.1:3838` and `:6015` | "Enable IOT Mode"; needs Rongyuan's native driver. |
| BT | HID output report ID 6, 65 bytes, payload prefixed with `0x55` | |
| 2.4G | Through a Rongyuan dongle object (`___getRy24GDongle`) | |

## USB transport (keyboard)

- **Send:** `device.sendFeatureReport(0, buf)` with `buf` zero-padded to 64 bytes.
- **Receive:** wait `READ_TIME` (10 ms), then `device.receiveFeatureReport(0)`, 64 bytes.
- `SEND_TIME` = 10 ms delay before each send. All traffic is serialized
  (`___withExclusiveCommunication`); a status poll loop is paused during each command.
- Responses echo the command byte in `resp[0]`.

### Framing (`___encodeCmd`)

1. Pad the command to at least 9 bytes.
2. Checksum mode `Bit7` (used by almost every keyboard command):
   `buf[7] = 255 - (sum(buf[0..6]) & 0xFF)`
3. Checksum mode `Bit8`: `buf[8] = 255 - (sum(buf[0..7]) & 0xFF)`
4. Checksum mode `None`: no checksum.
5. Over BT, prepend `0x55`.

Longer payloads (key matrices, magnet tables) follow the 8-byte header at `buf[8..]`.

## 2.4G dongle relay (class `YP`)

The RT75 Pro over 2.4G shows up as **"2.4G Wireless Keyboard", VID 0x3151 (12625),
PID 0x5038 (20536)**. Its vendor interface is usagePage 0xFFFF / usage 0x02, which is the
only collection with a feature report. The dongle answers its own commands directly; these
are raw, with no checksum:

| Cmd | Meaning | Reply |
|---|---|---|
| `F7` | Status | `[canRead, kbBattery%, mouseBattery%, kbOffline, mouseOffline, canSend]` (online = 0) |
| `F6 0A` / `F6 05` | Route the following traffic to the keyboard / mouse | none |
| `FC` | "Fetch the reply now" | none; then read the feature report |
| `F1` | Dongle ID | `[F1, id_lo, id_hi]` (uint16 LE) |

Keyboard command over the dongle:
`F6 0A` → poll `F7` until canSend (5 × 100 ms) → send the framed command (same Bit7
checksum as USB) → poll `F7` until canRead → `FC` → read 64 bytes.
The app polls `F7` every 2 s for the battery and online state.

First probe (2026-10-15) sent `0x8F` straight to the dongle and got
`00 64 00 00 01 01 …`. Read as an `F7` status, that means: keyboard online, battery 100%,
mouse offline, ready to send. That fits the dongle replying with its status buffer.
(Inference only; the second probe will confirm it.)

### Timing and load speed (perf/dongle-speed, 2026-10-15)

qmk.top's relay per message (`sendMsg` / `readMsg` / `commonMsg`, `INTERVAL_24G_TIME = 10`):
- **Route:** `F6 0A`, only when the target device changes (`___dongleSend24GDeviceByF6` caches
  `current24GUsedDevice`).
- **Wait to send:** up to 5 × (100 ms, then `F7` status) until `canSend`. Each `F7` is
  send → 10 ms → get, with 10 ms before it.
- **Send:** wait 10 ms, then send the packet.
- **Wait for the reply:** up to 5 × (100 ms, then `F7`) until `canRead`, then `FC`, 10 ms, and get.

So every read costs at least ~0.25 s on 2.4G, and a full RT75 Studio load (60 reads: 28 magnet pages,
16 Fn pages, 8 base pages, 8 single reads) took roughly 15–20 s.

**RT75 Studio now:**
- **Routes once per operation** (a load, a write batch), as qmk.top does. Before, it sent `F6`
  before every read and write.
- **'fast' timing (default):** status is asked right away, then after 5, 10, 20, 40, 80 ms and then
  every 100 ms. The overall timeout is about the same as before (~1 s plus transfers). Only the
  dongle status read (`F7`) is asked more often; packets and writes are unchanged.
- **'classic' timing** (`?dongle=classic`): qmk.top's 100 ms before every status check, for
  comparison.
- **Load stats:** the source chip shows how long the last read took ("Live · 2.4G · 4.8 s"), and its
  tooltip shows the read count and timing.
- **Tests:** `tests/dongle.test.mjs` uses a simulated dongle (routing once, no fixed waits in fast
  mode, slow and dead dongles, writes, classic timing).
- **The key map loads in the background:** startup reads 36 times instead of 60. The base layer
  and Fn layers (24 reads, `readKeymaps`) load right after, and again after a profile switch.
  - Meanwhile the Key map and Macros tabs are disabled with a small spinner, and the Live test waits.
  - Other edits can be made meanwhile; their writes queue behind the read.
  - Until then, the "Remapped" count says "Open Key map to load".
  - If the read fails, the tabs re-enable and opening one retries.
- **Progress labels** name what is being read now. Before, they showed the last finished step, so
  "Debounce" stayed on screen through the 24 key-map reads.
- **One operation at a time:** all device operations (`readSettings`, everything through
  `withDevice`) queue behind each other, so a key-map load can't overlap a write.
- **Measured on the real keyboard (user, 2026-10-15):** a full load over 2.4G took **5.0 s** with
  the fast timing and **24.7 s** with `?dongle=classic` (qmk.top's timing). That's about 5× faster,
  and the settings loaded normally.
  - With the key map moved out of startup, startup over 2.4G took **3.0 s** (user, 2026-10-16), and
    the Key map tab loaded fine.
  - The background load verified on the real keyboard (user, 2026-10-16): Key map and Macros spin
    while the key map loads, then unlock, and Key map opens correctly.

## Device identification

- `0x8F` (GET_USB_VERSION, Bit7) → `resp[1..4]` = device ID, uint32 little-endian.
  `0xFFFFFFFF` means "unknown" (-1).
- The ID is looked up in an embedded device table (`cv`, about 50 models), keyed by `id`.
  Each entry has `{id, vid, pid, layoutName, name, displayName, company}`.
  If the ID isn't in the table, the app falls back to the HID `productName`.
- The `name` field selects the protocol class (for example `ry5088_*` and `ry6602_*` chips).
- The Yunzii RT75 Pro (ID 2865) is not in this table. GearHub-V5 redirects it to the
  `/v4/` app (see the RT75 Pro section at the top).

## Command table

Convention: `GET = SET | 0x80`. Different chip families reuse some numbers for different
things (for example PROFILE is 4 in one family and 5 in another), so the class matters.

| SET | GET | Name |
|---|---|---|
| 0x01/0x02 | | RESET |
| 0x03/0x04 | 0x83/0x84 | REPORT (polling rate) |
| 0x04/0x05 | 0x84/0x85 | PROFILE |
| 0x05 | 0x85 | LED on/off |
| 0x06/0x11 | 0x81/0x86 | DEBOUNCE |
| 0x06/0x09 | 0x86/0x89 | KB option (Win lock, Alt+Tab, Alt+F4 ...) |
| 0x07 | 0x87 | Main LED params |
| 0x08 | 0x88 | Side LED params |
| 0x09/0x0A | 0x89/0x8A | Key matrix (remap) |
| 0x0B/0x16 | 0x8B | Macro |
| 0x0C | 0x8C | User picture |
| 0x10 | 0x90 | Fn layer matrix |
| 0x11/0x12 | 0x91/0x92 | Sleep time (BT / 2.4G / deep sleep) |
| 0x13 | | Key matrix (simple) |
| 0x17 | 0x97 | Auto OS detect |
| 0x1B | | Magnetism report (live travel) |
| 0x1C | 0x9C | Magnetism calibration |
| 0x1D | 0x9D | Key magnetism mode |
| 0x1E | 0x9E | Max-travel calibration |
| 0x22 / 0x25 / 0x28 / 0x29 | ... | OLED/TFT screen options, language, clock, 24-bit image data |
| 0x55 | | Countdown |
| 0x65 | 0xE5 | **Multi-magnetism (per-key Hall settings)** |
| | 0xE6 | Feature / function list |
| | 0x8F | USB version / device ID |
| | 0x80 / 0xAD / 0xF0 | Firmware revision (family-dependent) |

## Hall-effect parameters (`0x65` / `0xE5`)

Packet: `[0x65, param, mode, ...]`, where `mode=1` is a bulk table write and `mode=0` is a
single key `[.., keyIndex, flag]`. Reads use `[0xE5, param, 1, page]` and return 64-byte pages.

Two variants exist with **different numbering**, so the device class must be known first:

| Setting | Variant A (`P6`) | Variant B (`_s`) |
|---|---|---|
| Option | 7 | 0 |
| Actuation point | 0 | 1 |
| Release point | 1 | 2 |
| RT press sensitivity | 2 | 3 |
| RT release sensitivity | 3 | 4 |
| Bottom dead zone | 6 | 5 |
| Top dead zone | 251 | 6 |
| DKS top trigger | 4 | 7 |
| SOCD pair | 9 | 8 |
| DKS trigger flags | 8 | 9 |
| Mod-tap hold time | 5 | 10 |
| Switch type | 252 | 11 |
| Live travel data | 254 | 12 |
| All-keys DKS flags | 16 | |

Advanced key types in the UI: DKS, MT (mod-tap), TGL (toggle), SOCD/Snap Tap, and RT with
"RTStab" smoothing.

## Cloud API (not needed for local features)

`api.rongyuan.tech`, `api2.qmk.top`, `api2/3.rongyuan.tech`: login/register, the shared
library for configs, macros and screen images (`/list_v2`, `/share_bit_image`, `/like`),
and firmware lookup (`/get_fw_version` by `dev_id`).

## Safety rules for our client

- Read before write. Use only GET commands until the device class is confirmed.
- Never send the bootloader or upgrade commands (`0x30–0x31`, `0x40–0x41`, `0x43–0x44`,
  `0xAC` flash erase).
- Keep the 10 ms send/read pacing and serialize all traffic.

## Live key depth

Two paths exist in qmk.top/v4. RT75 Studio uses only the first.

1. **Simulation Test (used): `0x1B` FEA_CMD_SET_MAGNETISM_REPOR.**
   - `[0x1B, 1]` (Bit7 checksum, sent as a feature report) turns depth reporting on, and
     `[0x1B, 0]` turns it off. qmk.top toggles it with `setKeyMagnetismReport` when the
     Simulation Test opens and closes.
   - While it's on, the keyboard pushes input reports on the other vendor collection
     (usagePage 0xFFFF, usage 1, interface 1, report ID 0) with data `[0x1B, lo, hi, …]`.
   - Depth = `(hi << 8 | lo) / step`, where step is 200 units/mm on this keyboard. With step 10 the
     depth is one byte.
   - There's one value per report, for the key currently moving, and no key index. qmk.top shows it
     as a single animated switch.
   - Other vendor pushes on that interface start with different bytes: 1 profile switch, 2 polling
     rate, 4–7 lighting, 0x1D magnet mode, `0F 01 00` / `0F 00 00` start/stop busy.
   - Verified on the real keyboard (2026-10-15, wired). The user ran RT75 Studio's Live test, and
     depth, peak and the "key down" indicator all behaved as expected.

2. **All keys (not used): param 254 via `[0xE5, 254, 1, page]`, 4 pages of uint16 "travel value" per key.**
   - qmk.top polls this only inside travel calibration (`setJiaoZhunKaiGuan`): it starts min-travel
     calibration (`0x1C 1`), waits 2 s, stops it (`0x1C 0`), then starts max-travel calibration
     (`0x1E 1`), and polls 254 until the user finishes.
   - Outside calibration the keyboard answers by echoing the request header, which qmk.top treats as
     zeros.
   - Because entering this mode rewrites switch calibration, RT75 Studio doesn't use it.

## Knob modes and push reports (listen-only test, 2026-10-16)

Question: can the app tell which mode the knob is in (volume, brightness, lighting …)? The user
changes mode by holding the knob down.

- **No command reports the mode.** qmk.top never reads it; the KB option read (`0x89`) returns
  OS, Fn index, anti-mistouch, RT stability and WASD swap only.
- **Test page:** `knob-listen.html` (branch `diag/knob-listen`) opens every interface and only
  listens; it never sends a report or requests one.
- **Run 1, wired (user, 2026-10-16):**
  - Two interfaces opened: `0x0C/0x01 + 0xFFFF/0x01` (one HIDDevice, two collections) and
    `0xFFFF/0x02` (the feature interface, no input reports). Chrome delivered the consumer reports.
  - **Volume mode:** turning sends consumer report ID 3, `E9 00` (Volume Up) or `EA 00`
    (Volume Down), each followed by `00 00`. Pressing sends `E2 00` (Mute).
  - **Holding the knob:** a vendor push, report ID 5, `0F 01` then `0F 00` about 30 ms later.
    qmk.top's push decoder (`U4` in the v4 bundle) calls these "start" and "stop". It's not proven
    that this pair is the mode change rather than any knob event.
  - **After the hold, turning** sends report ID 5 `06 nn` with nn stepping `02 03 04` up, then
    `03 02 01 00` down, each followed by `0F 01` / `0F 00`. No consumer reports. nn looks like the
    backlight brightness (0–4, the same scale as byte 3 of `0x87`); not yet cross-checked by a read.
  - qmk.top's decoder treats any push whose first byte is 4–7 as "lighting changed" (切灯效) and
    doesn't decode the value.
- **Run 2, wired (user, 2026-10-16), one full cycle with marks:**
  - **The knob has two modes, and a hold toggles between them.** Volume → hold → lighting →
    hold → volume again.
  - **Volume mode:** turn = `E9`/`EA`, press = `E2` (consumer report 3), as in run 1.
  - **Lighting mode:** turn = `06 nn`, brightness stepping 3, 2, 1, 0, then 1, 2.
    Press = `04 nn`, the next effect, read as 0x0C, 0x0E, 0x0F, 0x10. These are exactly the
    `0x87` effect IDs Neon, Radiant, Loop and Color Grid, in order, skipping 13 (Custom). So
    `04` = effect and `06` = brightness, matching qmk.top's "4–7 = lighting" range.
  - **Every hold sent a lone `0F 01` / `0F 00` pair** (31.9 s and 54.1 s in run 2, 37.5 s in run 1).
    Every other `0F` pair followed a `04`/`06` push by 5–10 ms. So a `0F` pair with no lighting
    push just before it marks the mode toggle. The pair carries no mode value.
  - **Fn brightness keys send the same `06 nn`** (up: `06 04`; down: `06 03 … 00`). A `06` push
    alone doesn't prove the knob is in lighting mode.
- **What the app can know:**
  - With only two modes, any `E9`/`EA`/`E2` from the knob puts it in volume mode, and each lone
    `0F` pair flips the mode.
  - Until one of those is seen after connecting, the mode is unknown.
  - Media keys elsewhere (an Fn+F-key volume binding) send the same consumer codes, so this is a
    best guess, not a reading.
  - Bonus: `06 nn` and `04 nn` pushes let the Lighting panel follow brightness and effect changes
    made on the keyboard, without a read.
- **Run 3, 2.4G through the dongle (user, 2026-10-16): same reports as wired.**
  - They arrive on the dongle's device (PID 0x5038, collections `0xFFFF/0x01 + 0x0C/0x01`), with
    the same report IDs and bytes, and need no `F6`/`F7`/`FC` relay traffic.
  - Volume mode: `E9`/`EA`/`E2`. Each hold: a lone `0F 01` / `0F 00` (24.7 s and 59.5 s).
  - Lighting mode: turn = `06 nn` (0–4); press = `04 05`, `04 06`, `04 07` (Water Ripple,
    Star Dots, Flow: consecutive effect IDs again). Fn brightness: `06 nn` again.
- **Summary (label → report):**

  | Mode | Action | Report |
  |---|---|---|
  | Volume | turn right / left | ID 3 `E9 00` / `EA 00`, then `00 00` |
  | Volume | press | ID 3 `E2 00`, then `00 00` |
  | Lighting | turn | ID 5 `06 nn` (brightness 0–4), then `0F 01`, `0F 00` |
  | Lighting | press | ID 5 `04 nn` (next effect ID), then `0F 01`, `0F 00` |
  | Either | hold | ID 5 `0F 01`, `0F 00`, with no lighting push before it (switches mode) |
  | — | Fn brightness keys | ID 5 `06 nn`, the same as turning in lighting mode |

- **Untested:** whether anything other than a hold sends a lone `0F` pair.
- **RT75 Studio (feature/config-redesign)** uses this in `watchKeyboardEvents`. It listens only
  on the report interface that was granted at connect: no picker, nothing sent.
  - A lone `0F 01` counts as a hold only when no lighting or other push came in the previous 40 ms
    and no read or write of ours is running or ended in the last 1.5 s. Saves may send busy pairs.
  - A volume report sets volume mode. A brightness or effect push sets lighting mode only while the
    mode is unknown, since in volume mode it's an Fn key. A hold flips a known mode.
  - Brightness and effect pushes also update the lighting read.

## Profile changed on the keyboard (push `01 nn`)

- qmk.top's push decoder (`U4`) names a vendor report starting with **`01`** "切配置" (switch
  profile). Its keyboard handler then waits (`vendorSleep`; its mouse handlers wait 1200–1500 ms on
  wireless), re-reads the active profile with `0x84` and reloads that profile's settings.
- RT75 Studio does the same from its listen-only watcher: on `01 nn` it waits 200 ms (1200 ms via
  the dongle), reads `0x84`, and if the profile differs, reads that profile's settings (as its own
  profile switch does). Unsaved edits are dropped with a notice: magnet writes go to whichever
  profile is active, so they'd land on the new one. Byte 1 is probably the new profile; the app
  trusts the `0x84` read, not the push.
- The push ends with a `0F 01` / `0F 00` pair like other pushes, so it isn't mistaken for a knob hold.
- **Verified on the real keyboard (2026-10-18):** switching profile on the keyboard with the app
  open made RT75 Studio show and load the new profile.

## Win/Mac switch (KB options, 0x89)

- **Read** `[0x89]` (Bit7), as qmk.top's `getKBOption` does on connect (`writeToAppState`). Reply:
  - byte 1: system, 0 Windows, 1 Mac, 2 iOS, 3 Android
  - byte 2: Fn layer index
  - byte 3: anti-mistouch
  - byte 4: RT stability ×25
  - byte 5: WASD swap

  RT75 Studio reads it at startup (one extra read) and uses only bytes 1 and 2.
- **Push:** when the switch moves, the keyboard sends `03 nn 00` or `03 nn 02` (report 5).
  qmk.top's decoder treats `nn & 2` as Mac ("切MAC" / "切WIN") and then re-reads `0x89`.
  RT75 Studio uses the pushed side straight away, then re-reads to confirm. `03 nn 08` (Fn layer
  change) and `03 nn 04/09` (power modes) aren't OS changes.
- **Use:** the UI shows one Fn layer. By default it follows this switch: Mac and iOS use the Mac
  layer; Windows and Android use the Windows layer. Keyboard settings can pin Windows or Mac, saved
  in the browser.
- **Verified on the real keyboard (2026-10-16):** flipping the switch with the page open updated
  Keyboard settings and Key map (Mac shows Cmd/Opt on the base layer).

## Keyboard-wide settings (RY5088 base)

- **Polling rate:** set `[0x03, 0, code]`, read `0x83` → `resp[2]`. Codes: 0 = 8000, 1 = 4000,
  2 = 2000, 3 = 1000, 4 = 500, 5 = 250, 6 = 125 Hz.
  - qmk.top shows the control only when `isSupportReportRate()` is true: the filter entry's
    `reportRate` must be > 1000, and the USB or RF version ≥ 1024.
  - The RT75 Pro qualifies: its USB (0x5030) and dongle (0x5038) filters both declare
    `reportRate: 8000`, and the firmware is 0x0512. So all seven rates are offered.
- **Profiles:** set `[0x04, index]` then wait 200 ms; read `0x84` → `resp[1]`.
  - qmk.top's "Profile 1–4" are the device's key layers (`当前按键层`, `deviceType.layer = 4`).
  - After a switch qmk.top re-reads every key (`___获取所有按键信息`), so magnet settings and the
    key matrix are stored per profile.
  - The key-matrix read `[0x8A, profile, 0xFF, page, sub]` takes the profile in byte 1. Byte 4 is
    a sub-layer, which is why the earlier "all 4 layers" dump (byte 4 = 0..3) read back empty.
- **Debounce:** set `[0x06, value]`, read `0x86` → `resp[1]`.
  - qmk.top only offers it when the device entry has `other.deBounce`
    (`supportDebounce()`). The RT75 Pro's doesn't, so RT75 Studio shows it read-only and never
    writes it. The RT75 Pro reports 0.
- **Sleep timers:** set `[0x11, 0…, checksum, …]` with four uint16 LE values in **seconds** at bytes
  8–15: BT backlight off, 2.4G backlight off, BT deep sleep, 2.4G deep sleep. Read them with
  `0x91` (same layout).
  - qmk.top labels the first two "close backlight" times (`getBluetoothCloseBacklightTime`) and
    shows them in minutes; its help text says 0 = never.
  - qmk.top's own fallback defaults are 120 s and 28 min.
  - The RT75 Pro declares `sleep24.sleep` and `sleepBT.sleep` as 0–18 h and `sleepBT.deep` as
    10 s–18 h. It declares no 2.4G deep sleep, so RT75 Studio always writes that value back
    unchanged.
  - Implemented in RT75 Studio and tested on the simulated keyboard, then verified on the real
    keyboard (2026-10-15): values written from RT75 Studio showed the same in qmk.top for all
    three timers, which confirms the byte order.
- These writes were tested against the demo's simulated keyboard (packets, read-back, refusals),
  then verified on the real keyboard (2026-10-15): the polling-rate change with read-back and
  Undo, and switching profile 1 → 2 → 1 all worked as expected.

## Key map and Fn layers

- **Base layer:** `[0x8A, profile, 0xFF, page 0–7, sub]`, 4 bytes per slot (sub = 0; sub 1 holds
  mod-tap tap actions, see "Mod-tap").
- **Fn layers:** `[0x90, os, fnLayer, 0xFF, page]`, where os is 0 = Windows and 1 = Mac. The page
  is in **byte 4** here, unlike the base read, which has it in byte 3.
  - **Byte 2 is the Fn layer ("Fn profile" in qmk.top), not the profile.** Fn layers are separate
    from profiles 1–4.
    - The RT75 Pro declares `fnSysLayer {win:1, mac:1}`: one Windows and one Mac Fn layer, index 0,
      shared by every profile.
    - qmk.top reads Fn layers `0 … fnSysLayer[os] - 1` only; its "Fn Profile" dropdown lists just
      "Fn Profile 1" (user screenshot, 2026-10-15).
    - The active index comes from the KB option read (`getKBOption` → `fnIndex`).
  - **RT75 Studio bug, fixed 2026-10-15 (fix/fn-layer):** until then it put the profile number in
    byte 2, so on profiles 2–4 it read (and would have written) Fn layers 1–3, which the keyboard
    doesn't use.
    - Those layers do return data.
    - The user confirmed Fn+F works the same on profile 2, so the keyboard uses Fn layer 0 there too.
    - The user doesn't recall editing Fn keys on profiles 2–4 in RT75 Studio.
    - Fn reads and writes now always use layer 0, and `query()` and the key-map validator refuse
      any other.
    - **Verified on the real keyboard (2026-10-15, fix/fn-layer):** RT75 Studio shows the same Fn
      layer on every profile.
  - An all-zero Fn slot means "no Fn action".
- **Key-map writes verified on the real keyboard (2026-10-15):** a base remap, an Fn · Windows remap,
  a captured combo and a restore all wrote, read back and matched qmk.top.
- **Write formats** (RY5088 base, used by RT75 Studio):
  - Base key: `[0x0A, profile, slot, 0, 0, save, sub, cs, a0..a3]` (`setKeyConfigSimple`). qmk.top
    passes sub = 0 and save = true per call.
  - Fn key: `[0x10, os, fnLayer = 0, slot, 0, 0, 0, cs, a0..a3]` (`setFnKeyConfigSimple`, no save byte).
- **Action encodings** are in `src/actions.js`.
- **qmk.top keeps two function-name tables (K0 and h5/uc) whose byte values overlap with different
  meanings.** For the RT75 Pro its UI uses h5.
  - Example: `10,15,0,0` (the RT75's Fn+R-Alt) is "Caps Swap" in K0, but "音量<->键盘亮度"
    ("volume ↔ keyboard brightness") in h5. RT75 Studio uses qmk.top's h5 name.
  - **The effect is unconfirmed.** The user tested it: it does **not** switch the knob. The knob
    changes mode (brightness, lighting presets, volume, mute) by holding it down. Treat the name as
    a label only.
  - The knob's extra slots 94–97 (`13,2,1/2,0` and `13,3,1/2,0`) decode as lighting brightness and
    speed up/down, presumably the actions for the knob's lighting modes; not confirmed.
  - **System sleep has two encodings in qmk.top.** The generic table (K0) has `2,130,0,0`; the RT75's
    table (h5) has `2,0,130,0` (wake `2,0,131,0`, power `2,0,129,0`). qmk.top's RT75 UI doesn't
    offer sleep at all. RT75 Studio used K0's `2,130,0,0`. On Fn+] it works over USB but not over
    2.4G (user, 2026-10-16), even though the dongle exposes a HID system controller in Device
    Manager.
  - **Tested on the real keyboard (2026-10-16):** h5's `2,0,130,0` on Fn+] didn't sleep the PC
    even over USB, so K0's `2,130,0,0` is the encoding the RT75 uses, and the test entry was
    removed. That sleep doesn't work over 2.4G is a firmware or dongle limitation that RT75 Studio
    can't change. Workaround: a macro of Win+X, U, S (Windows' sleep shortcut), which is plain key
    presses and works on every link.
  - **Speed names are swapped from qmk.top's.** On the RT75 the factory Fn+← is `13,3,1,0` and
    Fn+→ is `13,3,2,0`. The user reported (2026-10-16) that ← should read speed − and → speed +.
    That fits the lighting read, which stores speed inverted (`0x87` byte 2 = 4 − speed), so a raw
    "+1" is slower. RT75 Studio names `13,3,1,0` "Speed down" and `13,3,2,0` "Speed up".
- **Unidentified actions:** qmk.top shows anything it can't identify (`ConfigUnknown`) as a red,
  non-selectable "System Key" (系统按键). It also applies that label to keys it locks
  (`needDisableKeys`). The RT75's Fn+Tab `10,4,0,0` is one of these; RT75 Studio labels it
  "System key" and never edits it.
- **Verified on the real keyboard (2026-10-15):** RT75 Studio's Key map (base and Windows Fn layer)
  matched qmk.top's Custom Keys and Fn Layer pages. The user's Fn layer has a qmk.top macro on
  Fn+F (`9,0,0,0` → Macro 1).

## Mod-tap (feature/mod-tap)

qmk.top's "Hold / tap (MT)" advanced key (按住单击). On a magnetic keyboard it's a **key mode**, not
a key-map action. The key-map action `24, tap, hold, time/10` (`ConfigMT`) is only used when the
device declares `noMagneticSwitch`; the RT75 doesn't, so RT75 Studio never writes action 24.

- **Sub-layers.** Each profile's key matrix has 4 "son profiles" (`sonProfile` 0–3 when the device
  has magnet settings). Sub 0 is the ordinary base layer. qmk.top reads all four per profile
  (`getKeyConfig(profile, sub)` → `[0x8A, profile, 0xFF, page 0–7, sub]`) and writes with
  `setKeyConfigSimple(config, profile, sub, save)` → `[0x0A, profile, slot, 0, 0, save, sub, cs, a0..a3]`.
  Factory content of subs 1–3 is all zeros (`matrixToConfigs(matrix, zeros)` on reset).
- **A mod-tap key** (`option: "mt"`):
  - mode param 7 = **3** (`| 0x80` keeps Rapid Trigger)
  - **hold** action in **sub 0** (the base layer), **tap** action in **sub 1**
    (`configs: [按住_改键, 单击_改键]`, written in that order, `save` only on the last)
  - **hold time** in magnet param **5**, one byte, ms ÷ 10 (`mt_time / 10`). UI range 10–1000 ms,
    default 200 ms (`按键时间最小值:10, 按键时间最大值:1e3`, `按键时间=200`).
  - qmk.top reads param 5 (2 pages) only when some key is mod-tap. RT75 Studio always reads it.
- **Action encoding** (`同步到设备_高级键_按住单击`): up to three keys in click order,
  `[0, k1, k2, k3]` (`skey = k1, key = k2, key2 = k3`). An empty side becomes the key itself,
  `[0, original, 0, 0]`. So a lone Ctrl hold is `[0, 0xE0, 0, 0]`, not the `[0, 0, 0xE0, 0]` an
  ordinary remap uses. RT75 Studio lists modifiers first, then the main key.
- **Write order** (single key, `磁轴修改` path): the sub-layer keys first (sub 0, then sub 1 with save),
  then `setMagnetismInfoSimple`: mode, then the changed travels in the order 0, 1, 6, 2, 3, 4, 8, **5**, 251.
- **Leaving mod-tap.** When a mod-tap (or DKS / toggle) key is made part of a Snap pair, qmk.top first
  writes subs 0–3 as `[factory key, 0, 0, 0]` (save on sub 3), then the new mode. RT75 Studio clears
  sub 1 to zeros and writes the base layer back to the **tap** action (so the key keeps doing what a
  tap did), then sets the mode to Normal. It never writes subs 2–3: only DKS and toggle use them.
- **Reads stay in range:** `query()` allows sub 0–1 only on `0x8A`.
- **Verified on the real keyboard (2026-10-18):** mod-tap keys write, read back and work (tap and
  hold), and set back to Normal cleanly. Undo writes the keys, then the mode.

## Toggle (feature/toggle)

qmk.top's "Toggle Switch (TGL)" advanced key (切换开关). Its help text: a tap switches the key's
continuous triggering on or off; holding the key works normally.
- **Two types, two modes** (param 7, `| 0x80` keeps RT): **4** = Long press (长按, `tgl_hold`): after
  a tap the action stays held; **5** = Rapid fire (连点, `tgl_dots`): after a tap it repeats. qmk.top
  sends no speed setting, so the firmware sets the repeat rate.
- **The action** is the base layer (sub 0) only (`configs: [改键]`), up to three keys in the mod-tap
  layout `[0, k1, k2, k3]` (`同步到设备_高级键_长按连点_TGL`: `skey = k1, key = k2, key2 = k3`).
- **Write order:** the key-map entry (save), then the mode, as for mod-tap. Leaving toggle, RT75
  Studio writes the base layer back as a plain key and the mode as Normal (qmk.top also clears
  subs 1–3 there; toggle doesn't use them).
- **Travel and dead zones aren't edited on mod-tap, toggle or DKS keys** (qmk.top's
  `getIsTravelAndDeadZoneDisabled`: true when every selected key's settings type isn't
  行程设置, and its advanced-key objects carry no travel). RT75 Studio shows them read-only for
  such keys and drops travel and dead-zone edits on them from mixed selections. RT stays editable
  (`fire` is kept).
- **Tested on the real keyboard (2026-10-18):** a toggle key triggers very lightly, whatever its
  actuation point was set to before (the user set a deeper one first). The firmware doesn't use
  the key's actuation point in toggle mode, which fits qmk.top not offering it. **It triggers at
  about 0.5 mm, and ignores the top dead zone too** (user, 2026-10-18). Whether mod-tap keys use
  their actuation point is still untested.
- **UI:** Configuration › Key modes tab; the side panel's Key mode switch (Normal · Mod-tap · DKS ·
  Toggle) replaces mod-tap's own on/off switch. DKS is shown but disabled until its editor exists.
- **Verified on the real keyboard (2026-10-18):** Long press and Rapid fire toggle keys write, read
  back and behave as described, and set back to Normal cleanly (the side panel then names the key
  correctly; see the label fix on feature/toggle).

## DKS (feature/dks)

qmk.top's "Dynamic Keystroke (DKS)" advanced key (动态键程). Mode param 7 = **2** (`| 0x80` keeps RT).

- **Two depths.** A trigger point, param **4** (`dynamicTravel`, uint16 × step), and the bottom of the
  travel. qmk.top's editor: trigger point 0.5–2.5 mm, default 0.7 mm (`触发行程最小值:.5,
  触发行程最大值:2.5, _触发行程:.7`); the bottom is drawn at 3.2 mm (`最大行程:3.2`).
- **Four actions**, one per key-matrix sub-layer: action 1 = sub 0 (the base layer), actions 2–4 =
  subs 1–3 (`修改按键` ↔ `o[0..3].configs`). Each is a combo of up to three keys in the mod-tap layout
  `[0, k1, k2, k3]`; an empty action is `[0, 0, 0, 0]` (unlike mod-tap, not the key itself).
- **Trigger table.** For each action, one byte of four 2-bit values, one per moment
  (`动态行程`, `s[l] = c[3]<<6 | c[2]<<4 | c[1]<<2 | c[0]`):
  - written per key as param **8** with four data bytes, action 1 first
    (`_sendMagnetismInfoSimpleCMD(8, key, last, triggerModes)`)
  - **read** for all keys as param **10**, **8 pages**: four 128-byte tables, action by action
    (`_getMulitMagnetismCMD(10, 8)`, `B[g] = l.slice(g*128, (g+1)*128)[pos]`). This is the only
    magnet read past page 3; `query()` allows pages 0–7 for param 10 only.
  - qmk.top reads params 4 and 10 only when some key is DKS. RT75 Studio does the same at startup,
    and reads them on demand (`readDksSettings`, 12 reads) before DKS is first edited.
- **Write order** (single key): sub-layers 0–3 (save on the last), then mode, then 4, then 8, in
  `setMagnetismInfoSimple`'s order (… 2, 3, **4**, **8**, 5, 251).
- **Moments**, in bit order (qmk.top's DKS editor header, `data-cell-index` 0–3): 0 = pressing past
  the trigger point, 1 = reaching the bottom (3.2 mm), 2 = leaving the bottom, 3 = releasing past
  the trigger point.
- **Values** (the editor's row component `Kt`, lazily loaded chunk `c6c48962.js`, fetched with
  `reference/qmk/fetch-lazy.mjs`):
  - 0: nothing (grey "+" circle; click makes it 1)
  - 1: tap: press and release at that moment (a dot)
  - 2: press at that moment, release at the next one (a bar to the next moment)
  - 3: press, and stay held past the next moment; the following moment then holds 2 (or 3) to say
    where it ends. Dragging a bar from moment 0 over two segments gives `[3, 2, …]`, over three
    `[3, 3, 2, …]`; from moment 1 over two, `[…, 3, 2, …]`.
  - Moment 3 can only be 0 or 1 (its bar has no next moment to stretch to).
  - Clicking a bar clears it, and clears the continuation it started.
- Demo-tested only so far.

## Gamepad mode (not supported, 2026-10-17)

The user asked for a Wootility / Keychron style gamepad (key depth as analog controller input).
- qmk.top (v4 and GearHub) has no gamepad UI. The shared tables only decode key action **21**
  (`ConfigGamepad`: X/Y/Z axes, throttle, rudder, hat directions, numbered buttons), a generic
  joystick, not an analog Xbox controller.
- The RY5088 base enables gamepad mode only from feature-list byte 3 (`getSupportsGamepadMode`);
  the RT75 has no feature list, so qmk.top never treats it as supported.
- **Checked by the user (2026-10-17):** with the RT75 on USB, it doesn't appear in `joy.cpl`, and
  Device Manager shows no HID game controller for it. The firmware has no joystick interface, so
  no configurator can add gamepad mode. A host-side virtual controller isn't possible either:
  live depth (`0x1B`) reports only the key being moved.
- RT75 Studio never writes action 21 (the key-map validator refuses it).

## Lighting (main backlight)

Source: RY5088 base `setLightSetting` / `getLightSetting`, and the RT75PRO device entry in the v4
bundle (`lightLayout: v`, **no `sideLightLayout`**, so `0x08`/`0x88` side-light commands don't
apply to this keyboard).

- **Read** `0x87` (Bit7). Reply: `[0x87, effect, 4 - speed, brightness, option << 4 | mode, r, g, b]`.
- **Write** `[0x07, effect, 4 - speed, brightness, option << 4 | mode, r, g, b, cs]` with the
  **Bit8** checksum: `cs = byte 8 = 255 - (sum(bytes 0..7) & 0xFF)`. qmk.top sends it with
  `sendMsg(…, Bit8)` (10 ms before), then `vendorSleep` (100 ms). No reply is read.
- **Speed and brightness are 0–4** (`maxSpeed 4`, `maxValue 4`, `MAXSPEED = 4`); speed goes out
  inverted.
- **Colour mode (low nibble of byte 4):** 7 = `NORMAL` (colour in bytes 5–7), 8 = `DAZZLE` (rainbow).
  Reads can also return 0–6, which qmk.top shows as preset colours (`COMMONCOLOR`: red, orange,
  yellow, green, cyan, blue, magenta). White `FFFFFF` is written as `FAFFFA` and read back as white.
- **Special cases in qmk.top:** Custom (`LightUserPicture`, 13) sends `option << 4` and
  colour `00 C8 C8`; Music Sync (`LightMusicFollow2`, 22) uses mode 0 for rainbow and 4 otherwise;
  Light Shadow (`LightScreenColor`, 21) sends byte 4 = 0. Effects without colour controls (Spectrum
  Cycle) go out as mode 7 with the stored colour.
- **RT75 effect list** (qmk.top order, id, controls):
  Flowing Light 4 (speed, colour, Right/Left/Down/Up) · Water Ripple 5 · Star Dots 6 · Flow 7
  (Zigzag/Spiral) · Shadow 8 · Layers 9 · Sine Wave 10 · Color Spring 11 (Outward/Inward) ·
  Silent Snow 19 · Neon 12 (Right/Left) · Radiant 14 · Loop 15 (Counter-clockwise/Clockwise) ·
  Color Grid 16 · Snowfall 17 · Meteor 18 · Constant Light 1 (no speed) · Breathing 2 ·
  Spectrum Cycle 3 (no colour) · Custom 13 (Pattern 1–5, no speed or colour) · Music Sync 22 ·
  Light Shadow 21. "Off" (0) is **not** in the RT75 list.
- **RT75 Studio** offers all of these except Music Sync and Light Shadow, which depend on qmk.top's
  host-side music/screen sync; it shows them if the keyboard reports one. The validator
  (`assertAllowedLightWrite`) checks the effect, ranges, option count, colour mode, the Custom
  bytes, the Bit8 checksum and that bytes 9–63 are zero. Each write is read back and re-sent once
  if it differs.
- **Brightness 0 turns the backlight fully off** (checked on the keyboard), which is how qmk.top
  turns the RT75's lights off, since its list has no "Off" effect. RT75 Studio labels it "Off".
- **Lighting is keyboard-wide, not per profile.** The user set different lighting in two profiles
  and switching profiles didn't change it.
- **Verified on the real keyboard (2026-10-15):**
  - the read matched qmk.top's lighting page
  - a written change (effect, colour, brightness) took effect and was confirmed by read-back
  - Undo restored the original
- Editing Custom patterns (`0x0C`/`0x8C` user picture) is not implemented.

## Custom lighting (per-key colours) and qmk.top's "IoT" mode (2026-10-18)

- **IoT is qmk.top's desktop helper,** not a keyboard setting: an installed driver ("开始安装IOT",
  "切换至IOT驱动") that qmk.top talks to instead of WebHID (`isUseIotSDK`; its Electron build is
  detected with `"electron" in process.versions`).
- **What qmk.top gates on it** (lighting page chunk `c4a897a9.js`, mouse page `5a0196e0.js`):
  - Music-follow (`LightMusicFollow2`) and screen-colour (`LightScreenColor`) effects: "音乐律动和光影只能
    在IOT模式下运行" (they need the desktop program to capture audio or the screen); clicking them
    without IoT opens the "启用IOT驱动" prompt.
  - "My works" (我的作品) and the Save static / dynamic effect buttons, which store designs in IoT's
    local database (`Y.getAllItems(P.DBPATH.LIGHT, …)`).
  - Wireless connections: "无线模式设备连接驱动需要切换至iot模式" (qmk.top's browser mode doesn't do the
    dongle relay; RT75 Studio does).
- **Not gated on IoT:** the per-key editor tab (灯光编辑), shown when the keyboard's lighting list has
  `LightUserPicture` (the RT75's effect 13, "Custom", options Pattern 1–5), and writing it.
- **Commands** (RY5088 base):
  - write `setLightPic(colors, layer)`: `[0x0C, layer, 0xFF, page 0–6, length, isLast, 0, cs, data…]`,
    7 packets of 56 bytes (the last carries 378 − 6·56 = 42), Bit7 checksum, then `vendorSleep`.
    The data is 3 bytes (R, G, B) per key-matrix slot, 126 slots, at `slot × 3`.
  - read `getLightPic(layer)`: `[0x8C, layer, 0xFF, page 0–5]`, 6 pages of 64 bytes.
  - `layer` is the pattern (Pattern 1–5 = the Custom effect's options).
- **Static vs dynamic** (`xO`): static ("user picture") when the lighting list has `LightUserPicture`;
  dynamic (animated frames) only with `LightUserColor` and not over 2.4G. The RT75 has
  `LightUserPicture` only, so qmk.top offers static custom patterns.
- **For RT75 Studio:** none of this needs a helper program. Per-key patterns are ordinary feature
  reports (wired, and through the dongle relay), and saved designs can live in the browser like the
  macro library. Music and screen effects stay out of scope.
- **RT75 Studio's editor (feature/custom-lighting, design C3):** Lighting › Custom patterns. A pattern is
  read with `0x8C` the first time it's shown (in range: patterns 0–4, pages 0–5; `query()` refuses
  others), painted on the board or filled (solid, gradient, rainbow rows/sweep, WASD highlight), and
  written with `0x0C` through Review changes, then read back and compared (re-sent once). Slots that
  aren't keys keep what was read. As in qmk.top's writeSelectedCustomizationLayer, editing a pattern
  also queues the lighting switch to Custom with that pattern; the pattern is written first, then the
  effect. Undo writes the previous pattern back. Saved designs stay in this browser
  (`rt75-studio-patterns-2865`); Sunset is built in. **From a picture** (RT75 Studio's own, not in
  qmk.top): the image is drawn at the layout's proportions (cropped or whole) and each key takes the
  average colour under it (`colorsFromImage`), optionally made more vivid; it only becomes an edit,
  written through review like any other. The Effect view's preview shows the real pattern for Custom.
- Demo-tested only so far.

## Read ranges (incident, 2026-10-15)

A read-only diagnostic on feature/macros asked for macro slots (`0x8B`) beyond the 50 that qmk.top
uses.
- Index 64 returned unrelated memory.
- Index 254/255 got no reply, and the keyboard then stopped answering HID until it was unplugged
  and replugged.
- Nothing saved was affected.

The firmware doesn't bounds-check reads, so `query()` now refuses reads outside qmk.top's ranges:
- key map: profiles 0–3, pages 0–7
- Fn layers: layer 0, pages 0–7
- magnet tables: pages 0–3
- macros: never read (`0x8B` isn't in `READ_COMMANDS`; see "Macros")

## Macros

Source: RY5088 base `_setMacro`, `setMacro`, `getMacro`, `buffToMacroEvents`; v4 bundle
`macroEventToByte` and `configToMatrix`.

- **Key action:** `[9, mode, slot, 0]`.
  - Modes: 0 = Loop count (repeat 1–65535), 2 = "Press to Play" (it plays while the key is held, so RT75 Studio calls it "Hold to play"; user, 2026-10-15), 1 = "Toggle Playback with
    Assigned Key".
  - qmk.top allows 50 slots (`maxMacro = 50`), shared by all layers and profiles.
- **Buffer (256 bytes):** repeat count u16 LE, then one record per step, ended by `00 00 00 00`:
  - Key (HID 4–239) or mouse button (240 left, 241 right, 242 middle, 243 back, 244 forward):
    - `[code, flag]` when the delay is 1–127 ms (flag = delay, | 0x80 for a press)
    - otherwise `[code, 0x80 or 0, delay u16 LE]`
  - Mouse move: `[0xF9, d, dx, dy]`, with d = delay ≤ 127, or d = 0 followed by a u16 delay.
  - The delay is the wait after the step.
- **qmk.top quirks:**
  - It encodes a short mouse-move delay as `d` but decodes it as `d >> 1`.
  - A delay of 0 encodes as a short record that decodes as a long one.
  - RT75 Studio refuses both: no mouse moves, and every delay ≥ 1 ms.
- **Write:** `[0x0B, slot, page, 56, isLast, 0, 0, cs, 56 data bytes]` (Bit7), one packet per
  56-byte chunk, then `vendorSleep`. qmk.top writes the key's action first (`setKeyConfigSimple` /
  `setFnKeyConfigSimple`), then the macro.
  - RT75 Studio does the same in that order, and sends every chunk up to and including the end
    marker, so a shorter macro can't leave an old tail where the marker should be.
  - Each packet must match one built from a macro that passed `macroProblem` exactly
    (`assertAllowedMacroWrite`).

### Macro read-back is unreliable (investigated on the real keyboard, 2026-10-15)

`[0x8B, slot, page]` (`getMacro`) does **not** reliably return a slot's steps:
- A macro written to slot 2 (and played correctly by its key) read back at slot 1. Slot 2 stayed
  `FF`.
- A test macro written to an unused slot 5 never appeared in slots 0–7. That held whether or not
  a key pointed at it: Fn · Mac + H was used for the test and cleared again.
- An "off by one" theory, a "stored in write order" theory and a "packed list of macros keys use"
  theory each failed a test.
- **qmk.top doesn't really read macros either:**
  - In a fresh browser, it shows Fn+F / Fn+W only as mapped, with no name or steps, and an empty
    Key Scheme Library.
  - Names and steps live in qmk.top's local storage.
- **Reads outside slots 0–49 are dangerous:** index 64 returned unrelated memory, and 254/255
  hung the keyboard until it was power-cycled (see "Read ranges").

So RT75 Studio never reads macro slots (`0x8B` isn't in `READ_COMMANDS`).

The notes below come from a short-lived "Read steps (unreliable)" preview on feature/macro-library:
- **qmk.top-written macros don't read back either (user, 2026-10-15).**
  - The user created macros in qmk.top on Fn+J (slot 4, index 3) and Fn+K (slot 5, index 4).
  - "Read steps" returned all `FF` for both.
  - So it isn't RT75 Studio's write path: newly written macros don't read back at their slot,
    whoever wrote them. Spam F (index 0, written long ago) does.
- **Power-cycle hypothesis disproved:** after unplugging and replugging, slots 4 and 5 still read
  all `FF`.
- **Investigation closed (2026-10-15).** Ruled out:
  - off by one
  - write order (key before or after macro)
  - "stored in write order"
  - "packed list of macros keys use"
  - "kept only if a key uses it"
  - RT75 Studio's write format (qmk.top's own macros fail the same way)
  - "saved to flash at power-down"
  
  The read works for some older macros (Spam F, index 0) but not for newly written ones.
- **Inconsistent results (user, 2026-10-15):** the preview sometimes showed the right steps,
  sometimes steps from a macro removed earlier (the keyboard has no delete, so old data stays), and
  sometimes nothing for a macro just saved. Because it could mislead, the preview was removed
  before merging. RT75 Studio no longer sends `0x8B`.
  `macro-probe.html` and the full investigation log stay on `feature/macros`.

### RT75 Studio's macro library (feature/macro-library)

Like qmk.top's Key Scheme Library:
- **Storage:** named macros live in this browser (`localStorage`, `rt75-studio-macros-2865`),
  with export/import as JSON. Each entry remembers the slot it was last written to and what was
  written.
- **Picking a slot:** putting a macro on a key picks a slot that no key uses on any profile or
  the Fn layers (read with `0x8A`/`0x90`, in range) and that no other library macro holds.
  - The key write is read back as usual.
  - The macro steps are always rewritten on assignment, because the slot may have changed since
    (qmk.top, factory reset).
  - The review lists which keys use each slot written, and says the steps can't be confirmed.
- **Editing** a macro that keys already run queues a rewrite of its slot. Undo rewrites what
  RT75 Studio last wrote there.
- **Deleting:** the keyboard has no delete command, and qmk.top's delete only removes a macro from its
  own list. RT75 Studio's **Remove from keys** sets the keys that run a slot back to their factory
  action, as normal reviewed key-map writes. **Delete** removes a macro from the library only.
- **Made elsewhere:** slots keys use that no library macro holds (for example qmk.top's "Spam F"
  in slot 0) are listed as "made elsewhere". They can be re-created in the library, which writes
  new steps to that slot.
- **Verified on the real keyboard (2026-10-15, feature/macro-library):** the user
  - created a macro in the library
  - put it on a key (the key write was confirmed by read-back)
  - wrote it, and pressed the key: it played
  
  "Remove from keys" also worked. Mode 2 plays while the key is held, so it's now labelled
  "Hold to play".

## Configuration redesign (feature/config-redesign)

- **Verified on the real keyboard (2026-10-16):** the user checked the redesigned app (sidebar,
  header profiles and Review changes count, vertical travel sliders, knob mode from the keyboard's
  own reports, Keyboard settings tiles, styled dropdowns, Sleep PC macro template) and approved it
  for merge. Lighting speed labels (Fn+←/→ swapped from qmk.top's names) were checked on the keyboard.
- **Fn+] System sleep:** works over USB, not over 2.4G (firmware/dongle). The Sleep PC macro
  template (Win+X, U, S) is the workaround.
