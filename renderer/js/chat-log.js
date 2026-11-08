// 聊天记录（ChatComponent）：消息存储、自动换行、按原版的位置和样式绘制。
// 一条消息由若干片段组成：{ text, color, click, hover, wheel, middle }，
// click/hover 对应原版文字组件的 clickEvent / hoverEvent。

import { font } from './font.js';

export const CHAT_WIDTH = 320; // chatWidth = 1.0 → 320 像素
const LINE_H = 9; // chatLineSpacing = 0 → 9 像素
const MAX_MESSAGES = 100;
const UNFOCUSED_LINES = 10; // 未打开聊天栏时最多显示 10 行（chatHeightUnfocused = 90）
const FOCUSED_LINES = 20; // 打开聊天栏时最多 20 行（chatHeightFocused = 180）

/** 消息在 HUD 上停留 200 tick（10 秒），最后 1 秒淡出 */
function fade(ageMs) {
  let d = 1 - ageMs / 50 / 200;
  d = Math.max(0, Math.min(1, d * 10));
  return d * d;
}

/** 把片段按宽度换行。换行后的行以一个空格开头（与原版相同） */
export function wrap(spans, maxW) {
  const lines = [];
  let line = [], w = 0;
  const newLine = () => {
    lines.push(line);
    line = [{ text: ' ' }];
    w = font.width(' ');
  };
  for (const s of spans) {
    let text = s.text;
    while (text) {
      const tw = font.width(text);
      if (w + tw <= maxW) { line.push({ ...s, text }); w += tw; break; }
      if (s.nowrap && w > font.width(' ')) { newLine(); continue; }
      let part = font.substrByWidth(text, maxW - w);
      if (!part) { if (w > font.width(' ')) { newLine(); continue; } part = Array.from(text)[0]; }
      line.push({ ...s, text: part });
      text = text.slice(part.length);
      newLine();
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

export class ChatLog {
  constructor() {
    this.messages = []; // 新的在后面：{ spans, time }
    this.scroll = 0; // chatScrollbarPos
    this.newMessageSinceScroll = false;
  }

  add(spans) {
    if (typeof spans === 'string') spans = [{ text: spans }];
    this.messages.push({ spans, time: performance.now() });
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    if (this.scroll > 0) { this.scroll += 1; this.newMessageSinceScroll = true; }
  }

  clear() {
    this.messages = [];
    this.scroll = 0;
  }

  /** HUD 上是否还有没淡出的消息 */
  visible() {
    const now = performance.now();
    return this.messages.some((m) => fade(now - m.time) > 0);
  }

  width(g) {
    return Math.min(CHAT_WIDTH, g.width - 8);
  }

  linesPerPage(g, focused) {
    // 聊天区底部在 height - 40，顶部不能超出屏幕
    const fit = Math.floor((g.height - 40 - 4) / LINE_H);
    return Math.max(1, Math.min(focused ? FOCUSED_LINES : UNFOCUSED_LINES, fit));
  }

  scrollBy(g, n, extra = []) {
    const total = this.allLines(g, extra).length;
    this.scroll = Math.max(0, Math.min(this.scroll + n, total - this.linesPerPage(g, true)));
    if (this.scroll === 0) this.newMessageSinceScroll = false;
  }

  /** 所有行，最新的在前。extra 是追加在最后的消息（不进入历史） */
  allLines(g, extra = []) {
    const w = this.width(g);
    const out = [];
    const msgs = [...this.messages.map((m) => ({ ...m, history: true })), ...extra.map((spans) => ({ spans, time: performance.now() }))];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const lines = wrap(msgs[i].spans, w);
      for (let j = lines.length - 1; j >= 0; j--) out.push({ spans: lines[j], time: msgs[i].time, history: msgs[i].history });
    }
    return out;
  }

  /**
   * 绘制（ChatComponent.render）。focused = 聊天栏已打开。
   * 返回可交互片段的位置，用于悬停提示和点击。
   */
  render(g, focused, extra = []) {
    const hits = [];
    const now = performance.now();
    let lines = focused ? this.allLines(g, extra) : this.allLines(g).filter((l) => l.history);
    const per = this.linesPerPage(g, focused);
    if (!focused) this.scroll = 0;
    const total = lines.length;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, total - per)));
    lines = lines.slice(this.scroll, this.scroll + per);
    const w = this.width(g);
    const bottom = g.height - 40;
    const textOpacity = 1, bgOpacity = 0.5;
    let drawn = 0;
    lines.forEach((line, i) => {
      const alpha = focused ? 1 : fade(now - line.time);
      const ta = Math.floor(255 * alpha * textOpacity);
      const ba = Math.floor(255 * alpha * bgOpacity);
      if (ta <= 3) return;
      drawn++;
      const y = bottom - i * LINE_H;
      g.fill(0, y - LINE_H, 4 + w + 4 + 4, y, (ba << 24) >>> 0);
      let x = 4;
      const ty = y - LINE_H + 1;
      for (const s of line.spans) {
        const sw = font.width(s.text);
        const color = ((ta << 24) | ((s.color ?? 0xffffff) & 0xffffff)) >>> 0;
        g.text(s.text, x, ty, color, true);
        if (focused && (s.click || s.hover || s.wheel || s.middle)) hits.push({ x, y: y - LINE_H, w: sw, h: LINE_H, span: s });
        x += sw;
      }
    });
    // 滚动条（只在打开聊天栏、内容超过一页时显示）
    if (focused && total > per && drawn) {
      const pageH = per * LINE_H;
      const totalH = total * LINE_H;
      const barH = Math.floor((pageH * pageH) / totalH);
      const offset = Math.floor((this.scroll * pageH) / total);
      const top = bottom - offset;
      const color = this.newMessageSinceScroll ? 0xcc3333 : 0x3333aa;
      g.fill(2, top - barH, 4, top, (0x60000000 | color) >>> 0);
      g.fill(2, top - barH, 3, top, (0x60000000 | 0xcccccc) >>> 0);
    }
    return hits;
  }
}
