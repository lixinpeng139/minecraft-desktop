// 快捷栏窗口：置顶的 Dock，显示 9 个格子；点击启动，滚轮切换，支持从资源管理器拖入文件

import * as assets from './assets.js';
import { font } from './font.js';
import { Gfx } from './gfx.js';
import { HotbarHud } from './hud.js';
import { fileItemIcon, setIconListener } from './items.js';
import * as sound from './sound.js';

class HotbarApp {
  constructor() {
    this.hud = new HotbarHud();
    this.extra = new Map();
    this.describing = new Set();
    this.dirty = true;
  }

  async start() {
    await assets.init();
    await font.load();
    const st = await window.mcd.getState();
    this.config = st.config;
    this.display = st.display;
    this.captureMode = st.capture;
    this.setItems(st.items);
    sound.setVolumes(this.config);
    await assets.preload(['hud/hotbar', 'hud/hotbar_selection'].map(assets.spriteUrl));
    assets.setLoadListener(() => { this.dirty = true; });
    setIconListener(() => { this.dirty = true; });

    this.g = new Gfx(document.getElementById('gui'));
    this.bind();
    this.resize();

    window.mcd.onConfig((c) => {
      const prev = this.config;
      this.config = c;
      sound.setVolumes(c);
      if (prev.selectedSlot !== c.selectedSlot) this.hud.showLabel(this.nameAt(c.selectedSlot));
      this.dirty = true;
    });
    window.mcd.onItems((items) => { this.setItems(items); this.dirty = true; });
    window.mcd.onDisplay((d) => { this.display = d; this.resize(); });
    window.mcd.onHotbarLeave(() => { this.hud.hover = -1; this.dirty = true; });
    requestAnimationFrame(() => this.frame());
    if (this.captureMode) {
      this.hud.hover = 2;
      setTimeout(() => window.mcd.capture('hotbar'), 1500);
    }
  }

  setItems(items) {
    this.itemsByPath = new Map(items.map((i) => [i.path, i]));
  }

  itemInfo(path) {
    const it = this.itemsByPath.get(path) || this.extra.get(path);
    if (it) return it;
    if (!this.describing.has(path)) {
      this.describing.add(path);
      window.mcd.describe([path]).then(([d]) => {
        this.extra.set(path, d || { path, name: path.split(/[\\/]/).pop(), missing: true });
        this.dirty = true;
      });
    }
    return { path, name: path.split(/[\\/]/).pop(), pending: true };
  }

  nameAt(i) {
    const p = this.config.hotbar[i];
    return p ? this.itemInfo(p).name : '';
  }

  resize() {
    const dpr = devicePixelRatio;
    this.g.resize(Math.round(innerWidth * dpr), Math.round(innerHeight * dpr), this.display.guiScale);
    const g = this.g, k = g.scale / dpr;
    const { x, y } = this.hud.origin(g);
    window.mcd.setHotbarRect({ x: Math.floor(x * k), y: Math.floor((y - 1) * k), w: Math.ceil(182 * k), h: Math.ceil(23 * k) });
    this.dirty = true;
  }

  toGui(e) {
    const k = devicePixelRatio / this.g.scale;
    return [Math.floor(e.clientX * k), Math.floor(e.clientY * k)];
  }

  setHover(e) {
    const [mx, my] = this.toGui(e);
    const h = this.hud.slotAt(this.g, mx, my);
    if (h !== this.hud.hover) { this.hud.hover = h; this.dirty = true; }
    return h;
  }

  bind() {
    window.addEventListener('mousemove', (e) => this.setHover(e));
    window.addEventListener('mouseleave', () => { this.hud.hover = -1; this.dirty = true; });
    window.addEventListener('mousedown', (e) => {
      const i = this.setHover(e);
      if (i < 0) return;
      const p = this.config.hotbar[i];
      if (i !== this.config.selectedSlot) window.mcd.patchConfig({ selectedSlot: i });
      if (e.button === 1) return;
      if (!p) {
        // 空格子：打开物品栏，方便放东西进来
        if (e.button === 0) window.mcd.openInventoryFromHotbar();
        return;
      }
      window.mcd.openItem(p, 'hotbar');
    });
    window.addEventListener('wheel', (e) => {
      const dy = Math.sign(e.deltaY);
      if (!dy) return;
      window.mcd.patchConfig({ selectedSlot: (this.config.selectedSlot + dy + 9) % 9 });
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('dragover', (e) => { e.preventDefault(); this.setHover(e); });
    window.addEventListener('dragleave', () => { this.hud.hover = -1; this.dirty = true; });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const i = this.setHover(e);
      const file = e.dataTransfer.files[0];
      if (i < 0 || !file) return;
      const path = window.mcd.pathForFile(file);
      if (!path) return;
      const hotbar = [...this.config.hotbar];
      hotbar[i] = path;
      window.mcd.patchConfig({ hotbar, selectedSlot: i });
      window.mcd.grant('hotbar_place');
      sound.pop();
    });
    window.addEventListener('resize', () => this.resize());
  }

  frame() {
    requestAnimationFrame(() => this.frame());
    if (!this.dirty && !this.hud.animating()) return;
    this.dirty = false;
    const g = this.g;
    g.begin();
    const hb = this.config.hotbar;
    const icons = hb.map((p) => (p ? fileItemIcon(this.itemInfo(p), this.config.iconStyle) : null));
    const names = hb.map((p) => (p ? this.itemInfo(p).name : ''));
    this.hud.render(g, icons, names, this.config.selectedSlot);
  }
}

new HotbarApp().start().catch((e) => console.error(e));
