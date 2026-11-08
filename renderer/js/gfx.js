// GuiGraphics 的 Canvas 实现：所有坐标都使用 GUI 像素（与游戏相同），由 guiScale 统一放大。

import { sprite, tex, meta, image } from './assets.js';
import { font } from './font.js';

export function rgba(c) {
  return `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${((c >>> 24) & 0xff) / 255})`;
}

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.width = 0;
    this.height = 0;
    this.font = font;
    this.patterns = new Map();
  }

  /**
   * 与 Minecraft 一致：GUI 宽高 = ceil(帧缓冲尺寸 / guiScale)
   * inset：底部要留出的 GUI 像素（任务栏可见时，界面整体上移到任务栏上方）
   */
  resize(devW, devH, scale, inset = 0) {
    if (this.canvas.width !== devW) this.canvas.width = devW;
    if (this.canvas.height !== devH) this.canvas.height = devH;
    this.scale = scale;
    this.width = Math.ceil(devW / scale);
    this.height = Math.max(1, Math.ceil(devH / scale) - inset);
  }

  begin(clear = true) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    if (clear) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  push() { this.ctx.save(); }
  pop() { this.ctx.restore(); this.ctx.imageSmoothingEnabled = false; }
  translate(x, y) { this.ctx.translate(x, y); }

  fill(x1, y1, x2, y2, color) {
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    this.ctx.fillStyle = rgba(color);
    this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  fillGradient(x1, y1, x2, y2, top, bottom) {
    const g = this.ctx.createLinearGradient(0, y1, 0, y2);
    g.addColorStop(0, rgba(top));
    g.addColorStop(1, rgba(bottom));
    this.ctx.fillStyle = g;
    this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  hLine(x1, x2, y, color) { this.fill(Math.min(x1, x2), y, Math.max(x1, x2) + 1, y + 1, color); }
  vLine(x, y1, y2, color) { this.fill(x, Math.min(y1, y2) + 1, x + 1, Math.max(y1, y2), color); }

  outline(x, y, w, h, color) {
    this.fill(x, y, x + w, y + 1, color);
    this.fill(x, y + h - 1, x + w, y + h, color);
    this.fill(x, y + 1, x + 1, y + h - 1, color);
    this.fill(x + w - 1, y + 1, x + w, y + h - 1, color);
  }

  /** blit(纹理, x, y, u, v, w, h, 纹理宽, 纹理高) —— 纹理尺寸按“逻辑尺寸”计，实际图片可能是高清版本 */
  blit(img, x, y, u, v, w, h, texW = 256, texH = 256, dw = w, dh = h) {
    if (!img) return;
    const kx = img.width / texW, ky = img.height / texH;
    this.ctx.drawImage(img, u * kx, v * ky, w * kx, h * ky, x, y, dw, dh);
  }

  /** 平铺 img 的 (sx,sy,sw,sh) 区域填满目标矩形 */
  tiled(img, sx, sy, sw, sh, x, y, w, h) {
    if (!img || w <= 0 || h <= 0) return;
    for (let ty = 0; ty < h; ty += sh) {
      const th = Math.min(sh, h - ty);
      for (let tx = 0; tx < w; tx += sw) {
        const tw = Math.min(sw, w - tx);
        this.ctx.drawImage(img, sx, sy, tw, th, x + tx, y + ty, tw, th);
      }
    }
  }

  /** 绘制 GUI 精灵图，支持 mcmeta 中的 nine_slice / tile 缩放 */
  sprite(name, x, y, w, h) {
    const img = sprite(name);
    if (!img) return;
    const sc = meta.sprites[name];
    if (sc && sc.type === 'nine_slice') this.nineSlice(img, sc, x, y, w, h);
    else if (sc && sc.type === 'tile') this.tiled(img, 0, 0, sc.width, sc.height, x, y, w, h);
    else this.ctx.drawImage(img, x, y, w, h);
  }

  nineSlice(img, sc, x, y, w, h, src = null) {
    const b = typeof sc.border === 'number'
      ? { left: sc.border, top: sc.border, right: sc.border, bottom: sc.border }
      : sc.border;
    const sx = src ? src.x : 0, sy = src ? src.y : 0;
    const tw = src ? src.w : img.width, th = src ? src.h : img.height;
    const ctx = this.ctx;
    if (w === tw && h === th) { ctx.drawImage(img, sx, sy, tw, th, x, y, w, h); return; }
    const l = Math.min(b.left, Math.floor(w / 2)), r = Math.min(b.right, Math.floor(w / 2));
    const t = Math.min(b.top, Math.floor(h / 2)), bt = Math.min(b.bottom, Math.floor(h / 2));
    const cw = tw - b.left - b.right, ch = th - b.top - b.bottom; // 源图中间区域
    // 四角
    ctx.drawImage(img, sx, sy, l, t, x, y, l, t);
    ctx.drawImage(img, sx + tw - r, sy, r, t, x + w - r, y, r, t);
    ctx.drawImage(img, sx, sy + th - bt, l, bt, x, y + h - bt, l, bt);
    ctx.drawImage(img, sx + tw - r, sy + th - bt, r, bt, x + w - r, y + h - bt, r, bt);
    // 四边（平铺）
    this.tiled(img, sx + b.left, sy, cw, t, x + l, y, w - l - r, t);
    this.tiled(img, sx + b.left, sy + th - bt, cw, bt, x + l, y + h - bt, w - l - r, bt);
    this.tiled(img, sx, sy + b.top, l, ch, x, y + t, l, h - t - bt);
    this.tiled(img, sx + tw - r, sy + b.top, r, ch, x + w - r, y + t, r, h - t - bt);
    // 中心
    this.tiled(img, sx + b.left, sy + b.top, cw, ch, x + l, y + t, w - l - r, h - t - bt);
  }

  /** 以 tileW×tileH（GUI 像素）为周期平铺一张纹理 */
  tileTexture(path, x, y, w, h, tileW, tileH, alpha = 1) {
    const img = tex(path);
    if (!img) return;
    const key = path + '|' + tileW + 'x' + tileH + '|' + this.scale;
    let pat = this.patterns.get(key);
    if (!pat) {
      const c = new OffscreenCanvas(tileW * this.scale, tileH * this.scale);
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.drawImage(img, 0, 0, c.width, c.height);
      pat = this.ctx.createPattern(c, 'repeat');
      this.patterns.set(key, pat);
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha *= alpha;
    // 图案以设备像素对齐，避免缩放时的采样模糊
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pat;
    ctx.fillRect(x * this.scale, y * this.scale, w * this.scale, h * this.scale);
    ctx.restore();
  }

  // ---------- 文字 ----------
  text(str, x, y, color = 0xffffff, shadow = true) {
    return font.draw(this.ctx, str, x, y, color, shadow);
  }

  centered(str, cx, y, color = 0xffffff, shadow = true) {
    return font.draw(this.ctx, str, cx - Math.floor(font.width(str) / 2), y, color, shadow);
  }

  textWidth(str) { return font.width(str); }

  /** AbstractWidget.renderScrollingString：放得下就居中，放不下就来回滚动 */
  scrollingText(str, minX, minY, maxX, maxY, color) {
    const w = font.width(str);
    const y = Math.floor((minY + maxY - 9) / 2) + 1;
    const avail = maxX - minX;
    if (w > avail) {
      const over = w - avail;
      const t = performance.now() / 1000;
      const period = Math.max(over * 0.5, 3);
      const k = Math.sin((Math.PI / 2) * Math.cos((Math.PI * 2 * t) / period)) / 2 + 0.5;
      const off = k * over;
      this.scissor(minX, minY, maxX - minX, maxY - minY, () => this.text(str, minX - off, y, color));
    } else {
      const cx = Math.floor((minX + maxX) / 2);
      const x = Math.min(Math.max(cx, minX + Math.floor(w / 2)), maxX - Math.floor(w / 2));
      this.centered(str, x, y, color);
    }
  }

  scissor(x, y, w, h, fn) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    try { fn(); } finally { ctx.restore(); ctx.imageSmoothingEnabled = false; }
  }

  // ---------- 物品 ----------
  item(icon, x, y) {
    if (icon) icon.draw(this, x, y);
  }

  /** 槽位高亮：0x80FFFFFF 覆盖 16×16 区域 */
  slotHighlight(x, y) {
    this.fill(x, y, x + 16, y + 16, 0x80ffffff);
  }

  // ---------- 提示框（TooltipRenderUtil + DefaultTooltipPositioner） ----------
  tooltip(lines, mx, my) {
    if (!lines || !lines.length) return;
    const norm = lines.map((l) => (typeof l === 'string' ? { text: l, color: 0xffffff } : l));
    let w = 0;
    for (const l of norm) w = Math.max(w, font.width(l.text));
    const h = norm.length === 1 ? 8 : norm.length * 10;
    let x = mx + 12, y = my - 12;
    if (x + w > this.width) x = Math.max(mx - 24 - w, 4);
    if (y + h + 3 > this.height) y = this.height - h - 3;
    this.tooltipBackground(x, y, w, h);
    let ty = y;
    norm.forEach((l, i) => {
      this.text(l.text, x, ty, l.color ?? 0xffffff, true);
      ty += 10 + (i === 0 ? 2 : 0);
    });
  }

  tooltipBackground(x, y, w, h) {
    const BG = 0xf0100010, TOP = 0x505000ff, BOTTOM = 0x5028007f;
    const i = x - 3, j = y - 3, k = w + 6, l = h + 6;
    this.fill(i, j - 1, i + k, j, BG);
    this.fill(i, j + l, i + k, j + l + 1, BG);
    this.fill(i, j, i + k, j + l, BG);
    this.fill(i - 1, j, i, j + l, BG);
    this.fill(i + k, j, i + k + 1, j + l, BG);
    // 渐变边框
    this.fillGradient(i, j + 1, i + 1, j + l - 1, TOP, BOTTOM);
    this.fillGradient(i + k - 1, j + 1, i + k, j + l - 1, TOP, BOTTOM);
    this.fill(i, j, i + k, j + 1, TOP);
    this.fill(i, j + l - 1, i + k, j + l, BOTTOM);
  }

  /** 像素风面板（demo_background.png 九宫格） */
  panel(x, y, w, h) {
    const img = tex('gui/demo_background');
    if (!img) return;
    this.nineSlice(img, { border: 4 }, x, y, w, h, { x: 0, y: 0, w: 248, h: 166 });
  }

  image(url, x, y, w, h, smooth = false) {
    const img = image(url);
    if (!img) return;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = smooth;
    ctx.drawImage(img, x, y, w, h);
    ctx.imageSmoothingEnabled = false;
  }
}
