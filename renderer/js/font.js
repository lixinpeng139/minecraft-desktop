// Minecraft 默认字体：位图字体 (ascii/accented/nonlatin_european) + Unifont（中文等）
// 规则与游戏一致：位图字形宽度 = 最右非透明列 + 1，Unifont 字形以半像素绘制，阴影偏移 1 / 0.5 像素。

import { loadTex, json, binary } from './assets.js';

const R = 2; // 离屏缓存中每个 GUI 像素占 2 个像素，用于表示 Unifont 的半像素
const PAD_TOP = 4; // 缓存画布向上预留的空间（accented 字形会高出基线）

// unifont.json 中的 size_overrides（非日文变体）
const OVERRIDES = [
  [0x3001, 0x30ff, 0, 15], [0x3200, 0x9fff, 0, 15], [0x1100, 0x11ff, 0, 15], [0x3130, 0x318f, 0, 15],
  [0xa960, 0xa97f, 0, 15], [0xd7b0, 0xd7ff, 0, 15], [0xac00, 0xd7af, 1, 15], [0xf900, 0xfaff, 0, 15],
  [0xff01, 0xff5e, 0, 15],
];

function makeCanvas(w, h) {
  const c = new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function argbCss(c, alphaMul = 1) {
  const a = ((c >>> 24) & 0xff) / 255;
  return `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${(c >>> 24 ? a : 1) * alphaMul})`;
}

export class Font {
  constructor() {
    this.lineHeight = 9;
    this.glyphs = new Map();
    this.uniCache = new Map();
    this.textCache = new Map();
  }

  async load() {
    const def = await json('minecraft/font/include/default.json');
    // space 提供器优先级最高
    this.glyphs.set(0x20, { type: 'space', advance: 4 });
    this.glyphs.set(0x200c, { type: 'space', advance: 0 });
    for (const p of def.providers) {
      if (p.type !== 'bitmap') continue;
      const file = p.file.replace(/^minecraft:/, '').replace(/\.png$/, '');
      const img = await loadTex(file);
      if (!img) continue;
      const [c, ctx] = makeCanvas(img.width, img.height);
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const rows = p.chars.length;
      const cols = Array.from(p.chars[0]).length;
      const cw = img.width / cols;
      const ch = img.height / rows;
      const height = p.height ?? 8;
      const scale = height / ch;
      p.chars.forEach((row, r) => {
        Array.from(row).forEach((chr, col) => {
          const cp = chr.codePointAt(0);
          if (cp === 0 || this.glyphs.has(cp)) return;
          let w = 0;
          for (let x = cw - 1; x >= 0 && !w; x--) {
            for (let y = 0; y < ch; y++) {
              if (data[((r * ch + y) * img.width + col * cw + x) * 4 + 3] !== 0) { w = x + 1; break; }
            }
          }
          this.glyphs.set(cp, {
            type: 'bitmap', img: c, sx: col * cw, sy: r * ch, sw: cw, sh: ch, scale,
            advance: Math.floor(0.5 + w * scale) + 1, top: 7 - p.ascent,
          });
        });
      });
    }
    try {
      const buf = await binary('minecraft/font/unifont.bin');
      this.uni = new Uint8Array(buf);
      this.uniIndex = new Uint32Array(buf.slice(4, 4 + 65536 * 4));
      this.uniBase = 4 + 65536 * 4;
    } catch {
      this.uni = null;
    }
  }

  uniGlyph(cp) {
    if (this.uniCache.has(cp)) return this.uniCache.get(cp);
    let g = null;
    if (this.uni && cp < 65536 && this.uniIndex[cp]) {
      const base = this.uniBase + this.uniIndex[cp];
      const cols = this.uni[base];
      const bpr = cols / 8;
      const bit = (row, col) => col < cols && (this.uni[base + 1 + row * bpr + (col >> 3)] >> (7 - (col & 7))) & 1;
      let left = -1, right = -1;
      const ov = OVERRIDES.find(([a, b]) => cp >= a && cp <= b);
      if (ov) { left = ov[2]; right = ov[3]; } else {
        for (let col = 0; col < cols; col++) {
          for (let row = 0; row < 16; row++) {
            if (bit(row, col)) { if (left < 0) left = col; right = col; break; }
          }
        }
      }
      const width = left < 0 ? 0 : right - left + 1;
      let canvas = null;
      if (width > 0) {
        const [c, ctx] = makeCanvas(width, 16);
        ctx.fillStyle = '#fff';
        for (let row = 0; row < 16; row++) {
          for (let col = left; col <= right; col++) if (bit(row, col)) ctx.fillRect(col - left, row, 1, 1);
        }
        canvas = c;
      }
      g = { type: 'uni', canvas, advance: Math.floor(width / 2) + 1 };
    }
    this.uniCache.set(cp, g);
    return g;
  }

  glyph(cp) {
    return this.glyphs.get(cp) || this.uniGlyph(cp) || { type: 'space', advance: 4 };
  }

  width(str) {
    let w = 0;
    for (const ch of str) w += this.glyph(ch.codePointAt(0)).advance;
    return w;
  }

  /** 按宽度截断 */
  substrByWidth(str, maxW) {
    let w = 0, out = '';
    for (const ch of str) {
      const a = this.glyph(ch.codePointAt(0)).advance;
      if (w + a > maxW) break;
      w += a;
      out += ch;
    }
    return out;
  }

  /** 自动换行（优先在空格处断开，中文按字符断开） */
  split(str, maxW) {
    const lines = [];
    for (const para of String(str).split('\n')) {
      let line = '', w = 0, lastSpace = -1;
      for (const ch of para) {
        const a = this.glyph(ch.codePointAt(0)).advance;
        if (w + a > maxW && line) {
          if (lastSpace > 0 && ch !== ' ') {
            lines.push(line.slice(0, lastSpace));
            line = line.slice(lastSpace + 1);
          } else {
            lines.push(line);
            line = '';
          }
          w = this.width(line);
          lastSpace = -1;
          if (ch === ' ') continue;
        }
        if (ch === ' ') lastSpace = line.length;
        line += ch;
        w += a;
      }
      lines.push(line);
    }
    return lines;
  }

  /** 生成（并缓存）一段文字的离屏位图：先画阴影再画正文，与游戏的绘制顺序一致 */
  render(str, color, shadow) {
    const key = str + '\u0000' + color + '\u0000' + (shadow ? 1 : 0);
    let e = this.textCache.get(key);
    if (e) return e;
    if (this.textCache.size > 3000) this.textCache.clear();
    const width = this.width(str);
    const W = (width + 2) * R;
    const H = 16 * R;
    const [mb, mbx] = makeCanvas(W, H);
    const [mu, mux] = makeCanvas(W, H);
    let x = 0, hasB = false, hasU = false;
    for (const ch of str) {
      const g = this.glyph(ch.codePointAt(0));
      if (g.type === 'bitmap') {
        mbx.drawImage(g.img, g.sx, g.sy, g.sw, g.sh, x * R, (g.top + PAD_TOP) * R, g.sw * g.scale * R, g.sh * g.scale * R);
        hasB = true;
      } else if (g.type === 'uni' && g.canvas) {
        mux.drawImage(g.canvas, x * R, PAD_TOP * R);
        hasU = true;
      }
      x += g.advance;
    }
    const [out, octx] = makeCanvas(W, H);
    const tint = (mask, c) => {
      const [t, tctx] = makeCanvas(W, H);
      tctx.drawImage(mask, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = argbCss(c | 0xff000000);
      tctx.fillRect(0, 0, W, H);
      return t;
    };
    if (shadow) {
      const sc = ((color & 0xfcfcfc) >> 2);
      if (hasB) octx.drawImage(tint(mb, sc), R, R);
      if (hasU) octx.drawImage(tint(mu, sc), R / 2, R / 2);
    }
    if (hasB) octx.drawImage(tint(mb, color), 0, 0);
    if (hasU) octx.drawImage(tint(mu, color), 0, 0);
    e = { canvas: out, width };
    this.textCache.set(key, e);
    return e;
  }

  /** 在 GUI 坐标 (x, y) 绘制，ctx 的变换需已缩放到 GUI 坐标系 */
  draw(ctx, str, x, y, color = 0xffffff, shadow = true) {
    if (!str) return x;
    const e = this.render(str, color & 0xffffff, shadow);
    const a = (color >>> 24) & 0xff;
    const prevAlpha = ctx.globalAlpha;
    if (a && a < 255) ctx.globalAlpha = prevAlpha * (a / 255);
    ctx.drawImage(e.canvas, x, y - PAD_TOP, e.canvas.width / R, e.canvas.height / R);
    ctx.globalAlpha = prevAlpha;
    return x + e.width;
  }
}

export const font = new Font();
