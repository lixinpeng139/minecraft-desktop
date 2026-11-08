// 按键名称（与游戏的 key.keyboard.* 翻译对应）

import { tr } from './assets.js';

export const DEFAULT_KEYS = {
  inventory: 'KeyE',
  chat: 'KeyT',
  command: 'Slash',
  search: null,
  drop: 'KeyQ',
  debug: 'F3',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5',
  hotbar6: 'Digit6', hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

const MAP = {
  Space: 'space', Enter: 'enter', Tab: 'tab', Backspace: 'backspace', Escape: 'escape', CapsLock: 'caps.lock',
  ShiftLeft: 'left.shift', ShiftRight: 'right.shift', ControlLeft: 'left.control', ControlRight: 'right.control',
  AltLeft: 'left.alt', AltRight: 'right.alt', MetaLeft: 'left.win', MetaRight: 'right.win',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Insert: 'insert', Delete: 'delete',
  Home: 'home', End: 'end', PageUp: 'page.up', PageDown: 'page.down', Backquote: 'grave.accent', Minus: 'minus',
  Equal: 'equal', BracketLeft: 'left.bracket', BracketRight: 'right.bracket', Backslash: 'backslash',
  Semicolon: 'semicolon', Quote: 'apostrophe', Comma: 'comma', Period: 'period', Slash: 'slash',
};

export function keyName(code) {
  if (!code) return tr('key.keyboard.unknown');
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit(\d)$/))) return m[1];
  if ((m = code.match(/^F(\d+)$/))) return 'F' + m[1];
  if ((m = code.match(/^Numpad(\d)$/))) return tr('key.keyboard.keypad.' + m[1]);
  if (MAP[code]) {
    const k = 'key.keyboard.' + MAP[code];
    const t = tr(k);
    return t === k ? code : t;
  }
  return code;
}
