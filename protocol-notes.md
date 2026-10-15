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
