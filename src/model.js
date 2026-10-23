// The keyboard model RT75 Studio drives. What is specific to a model (layout, factory key maps,
// limits, options, lighting effects) lives in src/models/; the RY5088 protocol is in device.js.
// Only the RT75 Pro so far.
import RT75_PRO from './models/rt75pro.js';

export const MODEL = RT75_PRO;

export const DEVICE_ID = MODEL.id;
export const KEYS = MODEL.layout.keys;
export const LAYOUT_WIDTH = MODEL.layout.width;
export const LAYOUT_HEIGHT = MODEL.layout.height;
// Factory key matrix and Fn layers (Windows, Mac), 4 bytes per slot.
export const DEFAULT_MATRIX = MODEL.factory.base;
export const DEFAULT_FN_MATRIX = MODEL.factory.fnWin;
export const DEFAULT_FN_MAC_MATRIX = MODEL.factory.fnMac;
