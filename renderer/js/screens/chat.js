// 聊天栏（ChatScreen）：按 T 打开，按 / 直接输入命令。
// 聊天记录区域里显示桌面状态：时间、网络/电量、音量/亮度、后台程序、任务栏窗口，
// 这些文字都可以点击（与原版聊天消息里可点击的文字一样）。下方输入框支持命令和命令补全。

import { Screen } from './screen.js';
import { EditBox } from '../widgets.js';
import { font } from '../font.js';
import { tr } from '../assets.js';

const WHITE = 0xffffff, GRAY = 0xaaaaaa, DARK = 0x555555, GREEN = 0x55ff55, RED = 0xff5555, YELLOW = 0xffff55;
const ARG_COLORS = [0x55ffff, 0xffff55, 0x55ff55, 0xff55ff, 0xffaa00]; // 命令参数的颜色（CommandSuggestions）
const INPUT_COLOR = 0xe0e0e0;
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const pad2 = (n) => String(n).padStart(2, '0');

const act = (a) => window.mcd.status.action(a);
const hint = (text) => ({ text, color: GRAY });
const btn = (text, click, hover, color = GREEN) => ({ text: '[' + text + ']', color, click, hover, nowrap: true });

// /settings 可以打开的页面
const PAGES = {
  quick: '快速设置（Win+A）',
  notifications: '通知和日历（Win+N）',
  sound: '声音',
  display: '显示（亮度）',
  network: '网络和 Internet',
  bluetooth: '蓝牙和其他设备',
  battery: '电池和节电模式',
  datetime: '日期和时间',
  personalization: '个性化',
  apps: '应用',
  system: '系统设置主页',
};

const WINDOW_ARG = 'windows';
const COMMANDS = [
  { name: 'help', usage: '/help', desc: '显示所有命令' },
  { name: 'volume', usage: '/volume <0-100|+N|-N|mute|unmute>', desc: '设置音量', args: ['mute', 'unmute', '+10', '-10', '0', '50', '100'] },
  { name: 'brightness', usage: '/brightness <0-100|+N|-N>', desc: '设置屏幕亮度', args: ['+10', '-10', '0', '50', '100'] },
  { name: 'tp', usage: '/tp <编号|窗口标题>', desc: '切换到某个窗口', args: WINDOW_ARG },
  { name: 'minimize', usage: '/minimize <编号|窗口标题>', desc: '最小化某个窗口', args: WINDOW_ARG },
  { name: 'kill', usage: '/kill <编号|窗口标题>', desc: '关闭某个窗口', args: WINDOW_ARG },
  { name: 'settings', usage: '/settings [页面]', desc: '打开快速设置或某个系统设置页面', args: Object.keys(PAGES) },
  { name: 'time', usage: '/time', desc: '显示日期和时间' },
  { name: 'clear', usage: '/clear', desc: '清空聊天记录' },
];
const findCommand = (name) => COMMANDS.find((c) => c.name === name.toLowerCase());

function dateText(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}

function ellipsis(str, maxW) {
  if (font.width(str) <= maxW) return str;
  return font.substrByWidth(str, Math.max(0, maxW - font.width('...'))) + '...';
}

/** 输入框：无边框，命令按原版的方式着色，光标后显示补全提示 */
class ChatInput extends EditBox {
  constructor(screen, x, y, w, h) {
    super(x, y, w, h, { bordered: false, maxLength: 256, textColor: INPUT_COLOR, focusKey: 'chat' });
    this.screen = screen;
  }

  /** 每个字符的颜色 */
  colors() {
    const v = this.value;
    const out = new Array(Array.from(v).length).fill(INPUT_COLOR);
    if (!v.startsWith('/')) return out;
    const chars = Array.from(v);
    let i = 1;
    let start = i;
    while (i < chars.length && chars[i] !== ' ') i++;
    const name = chars.slice(start, i).join('');
    const cmd = findCommand(name);
    const partial = !cmd && i === chars.length && COMMANDS.some((c) => c.name.startsWith(name.toLowerCase()));
    if (!cmd && !partial) {
      for (let k = start; k < chars.length; k++) out[k] = RED;
      return out;
    }
    let arg = 0;
    while (i < chars.length) {
      while (i < chars.length && chars[i] === ' ') i++;
      start = i;
      // 窗口标题可以包含空格：剩下的都算一个参数
      if (cmd && cmd.args === WINDOW_ARG) i = chars.length;
      else while (i < chars.length && chars[i] !== ' ') i++;
      const word = chars.slice(start, i).join('');
      const literal = cmd && Array.isArray(cmd.args) && cmd.args.includes(word.toLowerCase()) && !/^[+-]?\d+$/.test(word);
      for (let k = start; k < i; k++) out[k] = literal ? INPUT_COLOR : ARG_COLORS[arg % ARG_COLORS.length];
      arg++;
    }
    return out;
  }

  renderWidget(g) {
    const chars = Array.from(this.value);
    const colors = this.colors();
    const cursorChars = Array.from(this.value.slice(0, this.cursor)).length;
    const maxW = this.innerWidth();
    let start = 0;
    while (start < cursorChars && font.width(chars.slice(start, cursorChars).join('')) > maxW) start++;
    this.viewStart = start;
    const tx = this.x, ty = this.y;
    let x = tx, i = start;
    while (i < chars.length) {
      let j = i;
      let run = '';
      while (j < chars.length && colors[j] === colors[i]) { run += chars[j]; j++; }
      const room = maxW - (x - tx);
      const fit = font.substrByWidth(run, room);
      if (fit) g.text(fit, x, ty, colors[i]);
      x += font.width(fit);
      if (fit.length < run.length) break;
      i = j;
    }
    // 补全提示（灰色）：光标在末尾时显示所选建议剩下的部分
    const suffix = this.screen.suggestionSuffix();
    if (suffix && cursorChars >= chars.length) g.text(suffix, x, ty, 0x808080);
    if (this.focused && Math.floor((performance.now() - this.focusedTime) / 300) % 2 === 0) {
      const cx = tx + font.width(chars.slice(start, cursorChars).join(''));
      if (cursorChars >= chars.length) g.text('_', cx, ty, INPUT_COLOR);
      else g.fill(cx, ty - 1, cx + 1, ty + 1 + 9, 0xffd0d0d0);
    }
  }

  /** 字符串前 n 个字符在屏幕上的 x 坐标 */
  screenX(n) {
    const chars = Array.from(this.value);
    const s = Math.min(this.viewStart || 0, n);
    return this.x + font.width(chars.slice(s, n).join(''));
  }
}

export class ChatScreen extends Screen {
  constructor(initial = '') {
    super(tr('chat_screen.title'));
    this.initial = initial;
    this.historyPos = -1; // 正在查看第几条历史输入（-1 = 当前输入）
    this.draft = '';
    this.sugg = null; // { list: [{ text, tip }], start, sel, offset, tabbed }
    this.suggHidden = false; // 按 Esc 隐藏后，修改文字前不再显示
    this.hits = [];
  }

  get blurBackground() { return false; }
  get showHud() { return true; }

  build() {
    const app = this.app;
    const prev = this.input ? this.input.value : this.initial;
    this.input = this.add(new ChatInput(this, 4, this.height - 12, this.width - 4, 12));
    this.input.onChange = () => { this.suggHidden = false; this.updateSuggestions(); };
    this.setFocus(this.input);
    this.setInput(prev);
    if (!this.watching) {
      this.watching = true;
      window.mcd.status.watch(true).then((d) => { if (d && this.watching) { app.status = d; app.markDirty(); } });
    }
  }

  removed() {
    super.removed();
    if (this.watching) { this.watching = false; window.mcd.status.watch(false); }
  }

  renderBackground() {}

  /** 修改输入框内容（同时更新隐藏的 <input>，否则输入法会把旧内容写回来） */
  setInput(v, cursor) {
    const box = this.input;
    box.setValue(v, cursor);
    const ime = this.app.ime;
    if (this.app.editing === box) {
      ime.value = box.value;
      ime.setSelectionRange(box.cursor, box.cursor);
    }
  }

  // ---------- 状态信息（显示在聊天记录最下面） ----------
  statusMessages(chatW) {
    const st = this.app.status;
    const now = new Date();
    const msgs = [];
    msgs.push([
      { text: `${now.getHours()}:${pad2(now.getMinutes())}`, color: WHITE, click: () => this.leave({ type: 'notifications' }),
        hover: [dateText(now), hint('点击打开通知和日历')] },
      { text: '  ' + dateText(now), color: GRAY },
    ]);
    if (!st) { msgs.push([hint('正在读取系统信息…')]); return msgs; }

    // 网络 + 电量
    const line = [];
    const n = st.network;
    if (n) {
      const quick = () => this.leave({ type: 'quickSettings' });
      const net = () => this.leave({ type: 'settings', page: 'network' });
      if (n.type === 'none') {
        line.push({ text: '未连接网络', color: RED, click: quick, hover: ['未连接到网络', hint('点击打开快速设置')] });
      } else {
        const label = n.type === 'wifi' ? 'WLAN' : '以太网';
        line.push({ text: label + ' ', color: GRAY });
        line.push({ text: n.name || '已连接', color: WHITE, click: quick, hover: [`${label}：${n.name || '已连接'}`, hint('点击打开快速设置')] });
        if (!n.internet) line.push({ text: ' 无 Internet', color: YELLOW });
      }
      line.push({ text: ' ' }, btn('网络设置', net, ['打开“网络和 Internet”设置']));
    }
    const b = st.battery;
    if (b) {
      if (line.length) line.push({ text: '    ' });
      const color = b.charging ? GREEN : b.percent <= 20 ? RED : WHITE;
      let state = b.charging ? '正在充电' : b.plugged ? '已接通电源' : '正在使用电池';
      if (!b.plugged && b.secondsLeft) state += `，剩余约 ${Math.floor(b.secondsLeft / 3600)} 小时 ${Math.floor((b.secondsLeft % 3600) / 60)} 分钟`;
      const tip = [`电量 ${b.percent}%`, hint(state)];
      if (b.saver) tip.push({ text: '节电模式已开启', color: YELLOW });
      tip.push(hint('点击打开电池设置'));
      line.push({ text: '电量 ', color: GRAY });
      line.push({ text: b.percent + '%', color, click: () => this.leave({ type: 'settings', page: 'battery' }), hover: tip });
    }
    if (line.length) msgs.push(line);

    // 音量 + 亮度（在数值上滚动滚轮可以调节）
    const ctl = [];
    const v = st.volume;
    if (v) {
      const wheel = (d) => act({ type: 'volume:step', delta: d * 2 });
      ctl.push({ text: '音量 ', color: GRAY });
      ctl.push(v.muted
        ? { text: '已静音', color: RED, wheel, hover: [`音量 ${v.level}%（已静音）`, hint('滚轮：调节音量')] }
        : { text: v.level + '%', color: WHITE, wheel, hover: [`音量 ${v.level}%`, hint('滚轮：调节音量')] });
      ctl.push({ text: ' ' }, btn('-', () => act({ type: 'volume:step', delta: -10 }), ['音量 -10%']),
        btn('+', () => act({ type: 'volume:step', delta: 10 }), ['音量 +10%']),
        v.muted ? btn('取消静音', () => act({ type: 'volume:mute', value: false }), ['取消静音'])
          : btn('静音', () => act({ type: 'volume:mute', value: true }), ['静音']));
    }
    if (st.brightness != null) {
      if (ctl.length) ctl.push({ text: '    ' });
      const wheel = (d) => act({ type: 'brightness:step', delta: d * 5 });
      ctl.push({ text: '亮度 ', color: GRAY });
      ctl.push({ text: st.brightness + '%', color: WHITE, wheel, hover: [`亮度 ${st.brightness}%`, hint('滚轮：调节亮度')] });
      ctl.push({ text: ' ' }, btn('-', () => act({ type: 'brightness:step', delta: -10 }), ['亮度 -10%']),
        btn('+', () => act({ type: 'brightness:step', delta: 10 }), ['亮度 +10%']));
    }
    if (ctl.length) msgs.push(ctl);

    // 后台程序
    const bg = st.background || [];
    if (bg.length) {
      const l = [{ text: '后台 ', color: GRAY }];
      bg.forEach((a, i) => {
        if (i) l.push({ text: '  ' });
        l.push({ text: a.name, color: WHITE, nowrap: true, click: () => this.leave({ type: 'app:open', path: a.path }),
          hover: [a.name, { text: a.path, color: DARK }, hint('点击打开')] });
      });
      msgs.push(l);
    }

    // 任务栏窗口（编号可用于 /tp、/minimize、/kill）
    const wins = st.windows || [];
    msgs.push([{ text: '窗口 ', color: GRAY }, { text: wins.length ? `${wins.length} 个` : '没有打开的窗口', color: WHITE }]);
    wins.forEach((w, i) => {
      const prefix = `${i + 1}. `;
      const close = btn('×', () => { act({ type: 'window:close', id: w.id }); }, ['关闭窗口', hint(`/kill ${i + 1}`)], RED);
      const mini = btn('_', () => { act({ type: 'window:minimize', id: w.id }); }, ['最小化', hint(`/minimize ${i + 1}`)]);
      const room = chatW - font.width(prefix) - font.width(' ' + mini.text + close.text) - 2;
      const tip = [...font.split(w.title, 240).map((t) => ({ text: t, color: WHITE })),
        { text: w.exe + (w.minimized ? '  ·  已最小化' : ''), color: DARK },
        hint('左键：切换到此窗口'), hint('中键：关闭'), hint(`/tp ${i + 1}`)];
      msgs.push([
        { text: prefix, color: GRAY },
        { text: ellipsis(w.title, room), color: w.minimized ? GRAY : WHITE, click: () => this.leave({ type: 'window:activate', id: w.id }),
          middle: () => act({ type: 'window:close', id: w.id }), hover: tip },
        { text: ' ' }, mini, close,
      ]);
    });
    return msgs;
  }

  /** 关闭聊天栏后再执行（切换窗口、打开程序或系统界面需要把桌面放回最底层） */
  leave(a) {
    this.app.setScreen(null);
    act(a);
  }

  // ---------- 命令补全（CommandSuggestions） ----------
  windows() {
    return (this.app.status && this.app.status.windows) || [];
  }

  updateSuggestions() {
    this.sugg = null;
    const box = this.input;
    const before = box.value.slice(0, box.cursor);
    if (!before.startsWith('/')) return;
    let list = [], start;
    const m = /^\/(\S*)$/.exec(before);
    if (m) {
      start = 1;
      list = COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase())).map((c) => ({ text: c.name, tip: [c.usage, hint(c.desc)] }));
    } else {
      const m2 = /^\/(\S+)\s+(.*)$/.exec(before);
      const cmd = m2 && findCommand(m2[1]);
      if (!cmd || !cmd.args) return;
      const arg = m2[2];
      start = before.length - arg.length;
      if (cmd.args === WINDOW_ARG) {
        const q = arg.toLowerCase();
        list = this.windows().map((w, i) => ({ text: String(i + 1), tip: [w.title], title: w.title.toLowerCase() }))
          .filter((s) => !q || s.text.startsWith(q) || s.title.includes(q));
      } else {
        if (/\s/.test(arg)) return;
        list = cmd.args.filter((a) => a.startsWith(arg.toLowerCase()))
          .map((a) => ({ text: a, tip: cmd.name === 'settings' ? [PAGES[a]] : null }));
      }
    }
    if (list.length) this.sugg = { list, start, sel: 0, offset: 0, tabbed: false };
  }

  suggestionsVisible() {
    return !!this.sugg && !this.suggHidden;
  }

  suggestionSuffix() {
    if (!this.suggestionsVisible()) return '';
    const s = this.sugg;
    const typed = this.input.value.slice(s.start, this.input.cursor);
    const t = s.list[s.sel].text;
    return t.startsWith(typed) && t !== typed ? t.slice(typed.length) : '';
  }

  cycle(dir) {
    const s = this.sugg;
    s.sel = (s.sel + dir + s.list.length) % s.list.length;
    if (s.sel < s.offset) s.offset = s.sel;
    if (s.sel >= s.offset + 10) s.offset = s.sel - 9;
  }

  useSuggestion() {
    const s = this.sugg;
    const box = this.input;
    const t = s.list[s.sel].text;
    const v = box.value.slice(0, s.start) + t + box.value.slice(box.cursor);
    const keep = this.sugg;
    this.setInput(v, s.start + t.length);
    // 用 Tab 补全后保留原来的列表，继续按 Tab 可以循环
    this.sugg = keep;
    this.suggHidden = false;
    s.tabbed = true;
  }

  suggestionBox() {
    const s = this.sugg;
    const n = Math.min(10, s.list.length);
    let w = 0;
    for (const e of s.list) w = Math.max(w, font.width(e.text));
    let x = Math.max(1, Math.min(this.input.screenX(Array.from(this.input.value.slice(0, s.start)).length), this.width - w - 1));
    const y = this.height - 12 - 3 - n * 12;
    return { x, y, w, h: n * 12, n };
  }

  /** 补全列表下方的用法提示 / 错误提示 */
  usage() {
    const v = this.input.value;
    if (!v.startsWith('/') || this.suggestionsVisible()) return null;
    const m = /^\/(\S*)(\s.*)?$/.exec(v);
    if (!m) return null;
    const cmd = findCommand(m[1]);
    if (!cmd) {
      if (!m[1] || COMMANDS.some((c) => c.name.startsWith(m[1].toLowerCase()))) return null;
      return { text: tr('command.unknown.command'), color: RED, x: 4 };
    }
    if (m[2] === undefined) return null;
    return { text: cmd.usage, color: GRAY, x: 4 };
  }

  // ---------- 发送 ----------
  feedback(text, error = false) {
    this.app.chat.add([{ text, color: error ? RED : WHITE }]);
  }

  send() {
    const text = this.input.value.trim();
    if (text) {
      const hist = this.app.chatHistory;
      if (hist[hist.length - 1] !== text) hist.push(text);
      if (hist.length > 100) hist.shift();
      if (text.startsWith('/')) this.runCommand(text);
      else this.app.chat.add([{ text: `<${this.app.userName}> ${text}` }]);
    }
    this.app.setScreen(null);
  }

  findWindow(arg) {
    const wins = this.windows();
    if (/^\d+$/.test(arg)) return wins[parseInt(arg, 10) - 1];
    const q = arg.toLowerCase();
    return wins.find((w) => w.title.toLowerCase() === q) || wins.find((w) => w.title.toLowerCase().includes(q));
  }

  runCommand(text) {
    const m = /^\/(\S+)\s*(.*)$/.exec(text);
    const cmd = m && findCommand(m[1]);
    const arg = m ? m[2].trim() : '';
    if (!cmd) {
      this.feedback(tr('command.unknown.command'), true);
      this.app.chat.add([{ text: text.slice(-10), color: GRAY }, { text: tr('command.context.here'), color: RED }]);
      return;
    }
    const st = this.app.status;
    const usage = () => this.feedback('用法：' + cmd.usage, true);
    const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
    switch (cmd.name) {
      case 'help':
        for (const c of COMMANDS) {
          this.app.chat.add([{ text: c.usage, color: WHITE, click: () => this.app.openChat('/' + c.name + (c.args ? ' ' : '')),
            hover: [c.desc, hint('点击填入输入框')] }, { text: '  ' + c.desc, color: GRAY }]);
        }
        break;
      case 'volume': {
        const v = st && st.volume;
        if (!v) { this.feedback('无法读取音量', true); break; }
        const a = arg.toLowerCase();
        if (a === 'mute') { act({ type: 'volume:mute', value: true }); this.feedback('已静音'); }
        else if (a === 'unmute') { act({ type: 'volume:mute', value: false }); this.feedback('已取消静音'); }
        else if (/^[+-]\d+$/.test(a)) { act({ type: 'volume:step', delta: parseInt(a, 10) }); this.feedback(`音量已设为 ${clamp(v.level + parseInt(a, 10))}%`); }
        else if (/^\d+$/.test(a)) { act({ type: 'volume:set', value: clamp(parseInt(a, 10)) }); this.feedback(`音量已设为 ${clamp(parseInt(a, 10))}%`); }
        else usage();
        break;
      }
      case 'brightness': {
        const b = st && st.brightness;
        if (b == null) { this.feedback('这台显示器不支持调节亮度', true); break; }
        if (/^[+-]\d+$/.test(arg)) { act({ type: 'brightness:step', delta: parseInt(arg, 10) }); this.feedback(`亮度已设为 ${clamp(b + parseInt(arg, 10))}%`); }
        else if (/^\d+$/.test(arg)) { act({ type: 'brightness:set', value: clamp(parseInt(arg, 10)) }); this.feedback(`亮度已设为 ${clamp(parseInt(arg, 10))}%`); }
        else usage();
        break;
      }
      case 'tp':
      case 'minimize':
      case 'kill': {
        if (!arg) { usage(); break; }
        const w = this.findWindow(arg);
        if (!w) { this.feedback('找不到窗口：' + arg, true); break; }
        const type = { tp: 'window:activate', minimize: 'window:minimize', kill: 'window:close' }[cmd.name];
        const verb = { tp: '已切换到', minimize: '已最小化', kill: '已关闭' }[cmd.name];
        this.feedback(`${verb}：${w.title}`);
        // 发送后聊天栏会关闭，等桌面回到底层再切换窗口
        setTimeout(() => act({ type, id: w.id }), 0);
        break;
      }
      case 'settings': {
        const page = (arg || 'quick').toLowerCase();
        if (!PAGES[page]) { this.feedback('未知的页面：' + arg + '，可用：' + Object.keys(PAGES).join(', '), true); break; }
        this.feedback('已打开：' + PAGES[page]);
        const a = page === 'quick' ? { type: 'quickSettings' } : page === 'notifications' ? { type: 'notifications' } : { type: 'settings', page };
        setTimeout(() => act(a), 0);
        break;
      }
      case 'time': {
        const d = new Date();
        this.feedback(`现在是 ${dateText(d)} ${d.getHours()}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`);
        break;
      }
      case 'clear':
        this.app.chat.clear();
        break;
      default: break;
    }
  }

  // ---------- 输入 ----------
  keyPressed(e) {
    const vis = this.suggestionsVisible();
    switch (e.code) {
      case 'Escape':
        if (vis) { this.suggHidden = true; return true; }
        this.app.setScreen(null);
        return true;
      case 'Enter':
      case 'NumpadEnter':
        this.send();
        return true;
      case 'Tab':
        if (!this.sugg) { this.updateSuggestions(); if (!this.sugg) return true; }
        if (this.suggHidden) { this.suggHidden = false; return true; }
        if (this.sugg.tabbed) this.cycle(e.shiftKey ? -1 : 1);
        this.useSuggestion();
        return true;
      case 'ArrowUp':
      case 'ArrowDown': {
        const dir = e.code === 'ArrowUp' ? -1 : 1;
        if (vis) { this.cycle(dir); this.sugg.tabbed = false; return true; }
        this.moveHistory(dir);
        return true;
      }
      case 'PageUp':
      case 'PageDown': {
        const g = this.app.gfx;
        const n = this.app.chat.linesPerPage(g, true) - 1;
        this.app.chat.scrollBy(g, e.code === 'PageUp' ? n : -n, this.lastExtra || []);
        return true;
      }
      default:
        return false;
    }
  }

  moveHistory(dir) {
    const hist = this.app.chatHistory;
    let pos = this.historyPos < 0 ? hist.length : this.historyPos;
    const next = Math.max(0, Math.min(hist.length, pos + dir));
    if (next === pos) return;
    if (pos === hist.length) this.draft = this.input.value;
    this.historyPos = next === hist.length ? -1 : next;
    this.setInput(next === hist.length ? this.draft : hist[next]);
    this.suggHidden = true;
  }

  hitAt(mx, my) {
    return this.hits.find((h) => mx >= h.x && mx < h.x + h.w && my >= h.y && my < h.y + h.h);
  }

  suggestionAt(mx, my) {
    if (!this.suggestionsVisible()) return -1;
    const b = this.suggestionBox();
    if (mx < b.x - 1 || mx > b.x + b.w + 1 || my < b.y || my >= b.y + b.h) return -1;
    return this.sugg.offset + Math.floor((my - b.y) / 12);
  }

  mouseClicked(mx, my, button) {
    const si = this.suggestionAt(mx, my);
    if (si >= 0) {
      if (button === 0) { this.sugg.sel = si; this.useSuggestion(); }
      return true;
    }
    const h = this.hitAt(mx, my);
    if (h) {
      if (button === 0 && h.span.click) h.span.click();
      else if (button === 1 && h.span.middle) h.span.middle();
      return true;
    }
    return true; // 点击其他地方也保持输入框焦点
  }

  mouseScrolled(mx, my, dy) {
    if (this.suggestionAt(mx, my) >= 0) {
      const s = this.sugg;
      s.offset = Math.max(0, Math.min(s.offset + dy, s.list.length - 10));
      return true;
    }
    const h = this.hitAt(mx, my);
    if (h && h.span.wheel) { h.span.wheel(-dy); return true; }
    const g = this.app.gfx;
    this.app.chat.scrollBy(g, -dy * (this.app.shift ? 1 : 7), this.lastExtra || []);
    return true;
  }

  // ---------- 绘制 ----------
  render(g, mx, my) {
    const chat = this.app.chat;
    this.lastExtra = this.statusMessages(chat.width(g));
    this.hits = chat.render(g, true, this.lastExtra);
    // 输入框背景（ChatScreen.render：fill(2, height-14, width-2, height-2, 背景色)）
    g.fill(2, this.height - 14, this.width - 2, this.height - 2, 0x80000000);
    this.input.render(g, mx, my);

    // 补全列表
    let tip = null;
    if (this.suggestionsVisible()) {
      const s = this.sugg;
      const b = this.suggestionBox();
      g.fill(b.x - 1, b.y, b.x + b.w + 1, b.y + b.h, 0xd0000000);
      const hov = this.suggestionAt(mx, my);
      if (hov >= 0 && hov < s.list.length && hov !== s.sel) { s.sel = hov; s.tabbed = false; }
      for (let i = 0; i < b.n; i++) {
        const e = s.list[s.offset + i];
        if (!e) break;
        // 上下还有更多时画虚线
        if (i === 0 && s.offset > 0) for (let k = 0; k < b.w + 2; k += 2) g.fill(b.x - 1 + k, b.y - 1, b.x + k, b.y, 0xffffffff);
        if (i === b.n - 1 && s.offset + b.n < s.list.length) for (let k = 0; k < b.w + 2; k += 2) g.fill(b.x - 1 + k, b.y + b.h, b.x + k, b.y + b.h + 1, 0xffffffff);
        g.text(e.text, b.x, b.y + 2 + 12 * i, s.offset + i === s.sel ? YELLOW : GRAY);
      }
      if (hov >= 0 && s.list[hov] && s.list[hov].tip) tip = s.list[hov].tip;
    } else {
      const u = this.usage();
      if (u) {
        const w = font.width(u.text);
        const y = this.height - 14 - 12;
        g.fill(u.x - 1, y, u.x + w + 1, y + 12, 0xd0000000);
        g.text(u.text, u.x, y + 2, u.color);
      }
    }

    // 悬停提示（文字组件的 hoverEvent）
    if (!tip) {
      const h = this.hitAt(mx, my);
      if (h && h.span.hover) tip = h.span.hover;
    }
    if (tip) g.tooltip(tip, mx, my);
  }
}
