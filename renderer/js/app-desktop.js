// 桌面窗口：背景（全景图/壁纸）+ HUD + 各种界面

import * as assets from './assets.js';
import { font } from './font.js';
import { Gfx } from './gfx.js';
import { Panorama } from './panorama.js';
import { HotbarHud } from './hud.js';
import { itemIcon, fileItemIcon, setIconListener, preloadIcons, iconCatalog } from './items.js';
import * as sound from './sound.js';
import { InventoryScreen } from './screens/inventory.js';
import { PauseScreen, loadSplashes } from './screens/pause.js';
import { ADVANCEMENTS } from './screens/advancements.js';
import { ChatScreen } from './screens/chat.js';
import { ChatLog } from './chat-log.js';
import { VitalsHud, VITALS_SPRITES } from './vitals-hud.js';

const $ = (id) => document.getElementById(id);

const PRELOAD_SPRITES = [
  ...VITALS_SPRITES,
  'hud/hotbar', 'hud/hotbar_selection', 'widget/button', 'widget/button_highlighted', 'widget/button_disabled',
  'widget/slider', 'widget/slider_highlighted', 'widget/slider_handle', 'widget/slider_handle_highlighted',
  'widget/text_field', 'widget/text_field_highlighted', 'widget/scroller', 'widget/scroller_background',
  'container/creative_inventory/scroller', 'container/creative_inventory/scroller_disabled', 'container/slot',
  'icon/language', 'icon/accessibility', 'toast/advancement',
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((i) => ['top', 'bottom'].flatMap((r) => ['selected', 'unselected'].map((s) => `container/creative_inventory/tab_${r}_${s}_${i}`))),
];
const PRELOAD_TEXTURES = [
  'gui/container/creative_inventory/tab_items', 'gui/container/creative_inventory/tab_item_search',
  'gui/inworld_menu_background', 'gui/inworld_menu_list_background', 'gui/inworld_header_separator',
  'gui/inworld_footer_separator', 'gui/title/minecraft', 'gui/title/edition', 'gui/demo_background',
  'gui/advancements/window', 'gui/advancements/backgrounds/stone',
];

class App {
  constructor() {
    this.screen = null;
    this.mouseX = -1;
    this.mouseY = -1;
    this.shift = false;
    this.buttons = 0;
    this.extra = new Map();
    this.describing = new Set();
    this.toasts = [];
    this.debug = false;
    this.dirty = true;
    this.dialogOpen = false;
    this.hud = new HotbarHud();
    this.last = performance.now();
    this.chat = new ChatLog();
    this.chatHistory = []; // 发送过的内容（上下方向键翻看）
    this.status = null; // 系统状态（聊天栏打开时由主进程推送）
    this.vitals = new VitalsHud(); // 生命值 = 电量，饱食度 = CPU，经验条 = 播放的声音
  }

  async start() {
    await assets.init();
    await font.load();
    const st = await window.mcd.getState();
    this.config = st.config;
    this.display = st.display;
    this.hudInset = st.display.hudInset || 0; // 任务栏可见时，底部 HUD 整体上移的距离（GUI 像素）
    this.noSystem = st.noSystem;
    this.captureMode = st.capture;
    this.userName = st.userName || 'Player';
    this.setItems(st.items);
    try { this.version = (await assets.json('version.json')).name; } catch { this.version = ''; }
    sound.setVolumes(this.config);

    await Promise.all([
      assets.preload(PRELOAD_SPRITES.map(assets.spriteUrl)),
      assets.preload(PRELOAD_TEXTURES.map(assets.texUrl)),
      preloadIcons(['chest', 'compass', ...iconCatalog().slice(0, 0), ...this.config.tabs.map((t) => t.icon.id).filter(Boolean)]),
      loadSplashes(),
    ]);
    assets.setLoadListener(() => this.markDirty());
    setIconListener(() => this.markDirty());

    this.gfx = new Gfx($('gui'));
    this.hudGfx = new Gfx($('hud'));
    this.panorama = new Panorama($('bg-pano'));
    this.ime = $('ime');
    this.bindEvents();
    this.resize();
    this.updateBackground();

    window.mcd.onConfig((c) => this.onConfig(c));
    window.mcd.onItems((items) => { this.setItems(items); this.markDirty(); });
    window.mcd.onDisplay((d) => { this.display = d; this.hudInset = d.hudInset || 0; this.resize(); });
    window.mcd.onCommand((cmd) => this.command(cmd));
    window.mcd.onBlur(() => { if (!this.dialogOpen && !this.captureMode) this.setScreen(null); });
    window.mcd.onToast((t) => this.addToast(t));
    window.mcd.status.on((d) => { this.status = d; this.markDirty(); });
    window.mcd.vitals.on((v) => this.vitals.update(v));
    window.mcd.vitals.onPeak((p) => this.vitals.setPeak(p));
    window.mcd.vitals.get().then((v) => this.vitals.update(v));

    requestAnimationFrame((t) => this.frame(t));
    if (this.captureMode) import('./test.js').then((m) => m.run(this));
  }

  // ---------- 数据 ----------
  setItems(items) {
    this.items = items;
    this.itemsByPath = new Map(items.map((i) => [i.path, i]));
  }

  onConfig(c) {
    const prev = this.config;
    this.config = c;
    sound.setVolumes(c);
    if (prev.background !== c.background || prev.customBackground !== c.customBackground) this.updateBackground();
    if (prev.menuBlur !== c.menuBlur) this.updateLayers();
    this.markDirty();
  }

  patch(p) {
    this.config = { ...this.config, ...p };
    this.markDirty();
    return window.mcd.patchConfig(p);
  }

  /** 路径 → 物品信息（不在桌面上的文件会异步查询） */
  itemInfo(path) {
    const it = this.itemsByPath.get(path) || this.extra.get(path);
    if (it) return it;
    if (!this.describing.has(path)) {
      this.describing.add(path);
      window.mcd.describe([path]).then(([d]) => {
        this.extra.set(path, d || { path, name: path.split(/[\\/]/).pop(), kind: '', missing: true });
        this.markDirty();
      });
    }
    return { path, name: path.split(/[\\/]/).pop(), kind: '', pending: true };
  }

  itemIcon(item) {
    return fileItemIcon(item, this.config.iconStyle);
  }

  itemTooltip(item) {
    const lines = [{ text: item.name, color: 0xffffff }];
    if (item.missing) lines.push({ text: '文件不存在', color: 0xff5555 });
    else if (item.kind) lines.push({ text: item.kind, color: 0xaaaaaa });
    if (item.target && /^https?:/i.test(item.target)) lines.push({ text: font.substrByWidth(item.target, 220), color: 0x5555ff });
    let p = item.path || '';
    if (font.width(p) > 220) {
      while (p.length > 4 && font.width('…' + p) > 220) p = p.slice(1);
      p = '…' + p;
    }
    lines.push({ text: p, color: 0x555555 });
    return lines;
  }

  async openItem(item, source) {
    const err = await window.mcd.openItem(item.path, source);
    if (err) this.addToast({ type: 'system', title: '无法打开', text: item.name });
  }

  grant(id) { window.mcd.grant(id); }

  async withDialog(fn) {
    this.dialogOpen = true;
    try { return await fn(); } finally { setTimeout(() => { this.dialogOpen = false; }, 300); }
  }

  // ---------- 界面 ----------
  setScreen(s, parent) {
    if (this.screen) this.screen.removed();
    if (s && parent !== undefined) s.parent = parent;
    const wasOpen = !!this.screen;
    this.screen = s;
    if (s) s.init(this, this.gfx.width, this.gfx.height);
    if (wasOpen !== !!s) window.mcd.setScreenOpen(!!s);
    this.updateLayers();
    this.markDirty();
  }

  openInventory(tab) {
    if (this.screen instanceof InventoryScreen) return;
    this.setScreen(new InventoryScreen(tab || this.config.lastTab));
    window.mcd.incStat('inventoryOpened');
    this.grant('open_inventory');
  }

  command(cmd) {
    if (cmd === 'inventory') this.openInventory();
  }

  /** 打开聊天栏（text = 输入框里预先填好的内容，例如 "/"） */
  openChat(text = '') {
    if (this.screen instanceof ChatScreen) {
      this.screen.setInput(text);
      return;
    }
    this.setScreen(new ChatScreen(text));
  }

  renderMenuBackground(g, x, y, w, h) {
    g.tileTexture('gui/inworld_menu_background', x, y, w, h, 32, 32);
  }

  renderListBackground(g, x, y, w, h) {
    g.tileTexture('gui/inworld_menu_list_background', x, y, w, h, 32, 32);
  }

  renderListSeparators(g, x, y, w, h) {
    g.tileTexture('gui/inworld_header_separator', x, y - 2, w, 2, 32, 2);
    g.tileTexture('gui/inworld_footer_separator', x, y + h, w, 2, 32, 2);
  }

  // ---------- 输入 ----------
  textInput(box, focused) {
    const ime = this.ime;
    if (focused) {
      this.editing = box;
      ime.maxLength = box.maxLength;
      ime.value = box.value;
      ime.focus({ preventScroll: true });
      ime.setSelectionRange(box.cursor, box.cursor);
      const k = this.gfx.scale / devicePixelRatio;
      ime.style.left = Math.round(box.x * k) + 'px';
      ime.style.top = Math.round((box.y + box.h) * k) + 'px';
    } else if (this.editing === box) {
      this.editing = null;
      ime.blur();
    }
  }

  syncInput() {
    if (!this.editing) return;
    this.editing.setValue(this.ime.value, this.ime.selectionStart);
    this.markDirty();
  }

  toGui(e) {
    const k = devicePixelRatio / this.gfx.scale;
    return [Math.floor(e.clientX * k), Math.floor(e.clientY * k)];
  }

  bindEvents() {
    const gui = $('gui');
    gui.addEventListener('mousedown', (e) => {
      [this.mouseX, this.mouseY] = this.toGui(e);
      this.shift = e.shiftKey;
      this.buttons |= 1 << e.button;
      if (this.screen) this.screen.mouseClicked(this.mouseX, this.mouseY, e.button);
      // 点击空白处不应让隐藏输入框失焦
      if (this.editing) setTimeout(() => this.editing && this.ime.focus({ preventScroll: true }), 0);
      this.markDirty();
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      [this.mouseX, this.mouseY] = this.toGui(e);
      this.buttons &= ~(1 << e.button);
      if (this.screen) this.screen.mouseReleased(this.mouseX, this.mouseY, e.button);
      this.markDirty();
    });
    window.addEventListener('mousemove', (e) => {
      [this.mouseX, this.mouseY] = this.toGui(e);
      if (this.screen && this.buttons) {
        const b = this.buttons & 1 ? 0 : this.buttons & 4 ? 2 : 1;
        this.screen.mouseDragged(this.mouseX, this.mouseY, b);
      }
      if (this.screen) this.markDirty();
    });
    window.addEventListener('wheel', (e) => {
      const dy = Math.sign(e.deltaY);
      if (!dy) return;
      if (this.screen) this.screen.mouseScrolled(this.mouseX, this.mouseY, dy);
      else this.patch({ selectedSlot: (this.config.selectedSlot + dy + 9) % 9 });
      this.markDirty();
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    const ime = this.ime;
    ime.addEventListener('input', () => this.syncInput());
    ime.addEventListener('compositionend', () => this.syncInput());
    ime.addEventListener('keyup', () => this.syncInput());
    ime.addEventListener('blur', () => {
      // 保持焦点在文本框上（除非界面主动取消）
      if (this.editing && document.hasFocus()) setTimeout(() => this.editing && ime.focus({ preventScroll: true }), 0);
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('keyup', (e) => { this.shift = e.shiftKey; });
    window.addEventListener('resize', () => this.resize());
  }

  onKeyDown(e) {
    this.shift = e.shiftKey;
    if (e.isComposing || e.keyCode === 229) return;
    const passthrough = ['Escape', 'Enter', 'NumpadEnter', 'Tab', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
    if (this.editing && !passthrough.includes(e.code)) {
      requestAnimationFrame(() => this.syncInput());
      return; // 交给输入框
    }
    let handled = false;
    if (this.screen) handled = this.screen.keyPressed(e);
    else handled = this.hudKey(e);
    if (handled || e.code === 'Tab' || /^F\d+$/.test(e.code)) e.preventDefault();
    this.markDirty();
  }

  hudKey(e) {
    const k = this.config.keys;
    if (e.code === 'Escape') { this.setScreen(new PauseScreen()); return true; }
    if (e.code === k.inventory) { this.openInventory(); return true; }
    if (k.chat && e.code === k.chat) { this.openChat(); return true; }
    if (k.command && e.code === k.command) { this.openChat('/'); return true; }
    if (k.search && e.code === k.search) { this.openInventory('search'); return true; }
    if (e.code === k.debug) { this.debug = !this.debug; return true; }
    for (let i = 0; i < 9; i++) {
      if (e.code === k['hotbar' + (i + 1)]) { this.patch({ selectedSlot: i }); return true; }
    }
    if (e.code === 'Enter') {
      const p = this.config.hotbar[this.config.selectedSlot];
      if (p) this.openItem(this.itemInfo(p), 'hotbar');
      return true;
    }
    return false;
  }

  // ---------- 渲染 ----------
  resize() {
    const dpr = devicePixelRatio;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    const s = this.display.guiScale;
    // 任务栏可见时把 GUI 高度减掉任务栏占的高度：HUD、界面和快捷栏会一起上移
    this.gfx.resize(w, h, s, this.hudInset);
    this.hudGfx.resize(w, h, s, this.hudInset);
    const pano = $('bg-pano');
    pano.width = w; pano.height = h;
    const img = $('bg-img');
    img.width = w; img.height = h;
    this.drawBackgroundImage();
    if (this.screen) this.screen.init(this, this.gfx.width, this.gfx.height);
    this.markDirty();
  }

  async updateBackground() {
    const mode = this.config.background;
    this.bgImage = null;
    if (mode === 'wallpaper') this.bgImageUrl = await window.mcd.getWallpaper();
    else if (mode === 'custom' && this.config.customBackground) this.bgImageUrl = await window.mcd.readImage(this.config.customBackground);
    else this.bgImageUrl = null;
    if (this.bgImageUrl) this.bgImage = await assets.loadImage(this.bgImageUrl);
    this.drawBackgroundImage();
    this.updateLayers();
  }

  drawBackgroundImage() {
    const c = $('bg-img');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = this.bgImage;
    if (!img) return;
    const k = Math.max(c.width / img.width, c.height / img.height);
    const w = img.width * k, h = img.height * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }

  usePanorama() {
    return (this.screen && this.screen.forcePanorama) || this.config.background === 'panorama' || !this.bgImage;
  }

  updateLayers() {
    const blur = this.screen && this.screen.blurBackground ? this.config.menuBlur : 0;
    const sigma = (blur * 0.68) / devicePixelRatio;
    const filter = sigma > 0 ? `blur(${sigma.toFixed(2)}px)` : 'none';
    const pano = this.usePanorama();
    $('bg-pano').style.display = pano ? 'block' : 'none';
    $('bg-img').style.display = pano ? 'none' : 'block';
    for (const id of ['bg-pano', 'bg-img']) {
      $(id).style.filter = filter;
      $(id).style.transform = sigma > 0 ? 'scale(1.015)' : 'none';
    }
    $('hud').style.filter = filter;
  }

  markDirty() { this.dirty = true; }

  addToast(t) {
    if (t.type === 'advancement') {
      const a = ADVANCEMENTS.find((x) => x.id === t.id);
      if (!a) return;
      t = { ...t, adv: a };
      if (a.frame === 'challenge') sound.challenge();
    }
    this.toasts.push({ ...t, start: performance.now() });
    sound.toastIn();
    this.markDirty();
  }

  renderToasts(g) {
    const now = performance.now();
    this.toasts = this.toasts.filter((t) => now - t.start < 5000 + 600);
    this.toasts.slice(0, 5).forEach((t, i) => {
      const age = now - t.start;
      const vis = age < 600 ? age / 600 : age > 5000 ? 1 - (age - 5000) / 600 : 1;
      const x = g.width - Math.round(160 * Math.max(0, Math.min(1, vis)));
      const y = i * 32;
      if (t.adv) {
        g.sprite('toast/advancement', x, y, 160, 32);
        const color = t.adv.frame === 'challenge' ? 0xff88ff : 0xffff00;
        g.text(assets.tr('advancements.toast.' + t.adv.frame), x + 30, y + 7, color, false);
        g.text(t.adv.title, x + 30, y + 18, 0xffffff, false);
        g.item(itemIcon(t.adv.icon), x + 8, y + 8);
      } else {
        g.sprite('toast/system', x, y, 160, 32);
        g.text(t.title || '', x + 18, y + 7, 0xffff00, false);
        g.text(t.text || '', x + 18, y + 18, 0xffffff, false);
      }
    });
    return this.toasts.length > 0;
  }

  async renderDebug(g) {
    const now = Date.now();
    if (!this.sys || now - this.sysAt > 1000) {
      this.sysAt = now;
      window.mcd.sysInfo().then((s) => { this.sys = s; });
      if (navigator.getBattery && !this.battery) navigator.getBattery().then((b) => { this.battery = b; });
    }
    const s = this.sys || {};
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const week = '日一二三四五六'[d.getDay()];
    const up = Math.floor(s.uptime || 0);
    const bat = this.battery;
    const left = [
      `Minecraft ${this.version} (Minecraft Desktop)`,
      `${this.fps || 0} fps`,
      '',
      `时间: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} 星期${week}`,
      `桌面物品: ${this.items.length}`,
      `快捷栏: ${this.config.selectedSlot + 1}/9`,
      `标签页: ${this.config.tabs.length}`,
      '',
      `系统运行时间: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`,
      bat && bat.level !== undefined ? `电池: ${Math.round(bat.level * 100)}%${bat.charging ? ' (充电中)' : ''}` : '',
    ];
    const mb = (n) => Math.round((n || 0) / 1048576);
    const used = (s.totalMem || 0) - (s.freeMem || 0);
    const right = [
      `Electron ${s.electron || ''} / Chrome ${(s.chrome || '').split('.')[0]}`,
      `Mem: ${s.totalMem ? Math.round((used / s.totalMem) * 100) : 0}% ${mb(used)}/${mb(s.totalMem)}MB`,
      `Allocated: ${mb(s.processMem)}MB`,
      '',
      `CPU: ${Math.round((s.cpuUsage || 0) * 100)}% ${s.cpuCount || ''}x ${s.cpuModel || ''}`,
      '',
      `Display: ${this.gfx.canvas.width}x${this.gfx.canvas.height} (GUI ${this.gfx.scale}x)`,
      s.platform || '',
      s.host || '',
    ];
    const line = (t, i, alignRight) => {
      if (!t) return;
      const w = g.textWidth(t);
      const x = alignRight ? g.width - 2 - w : 2;
      const y = 2 + 9 * i;
      g.fill(x - 1, y - 1, x + w + 1, y + 8, 0x90505050);
      g.text(t, x, y, 0xe0e0e0, false);
    };
    left.forEach((t, i) => line(t, i, false));
    right.forEach((t, i) => line(t, i, true));
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(5, (now - this.last) / 50);
    this.last = now;
    this.frames = (this.frames || 0) + 1;
    if (!this.fpsAt || now - this.fpsAt >= 1000) { this.fps = this.frames; this.frames = 0; this.fpsAt = now; }

    const pano = this.usePanorama();
    if (pano) {
      this.panorama.update(dt, this.config.panoramaSpeed);
      this.panorama.render();
    }
    const chatFading = !(this.screen instanceof ChatScreen) && this.chat.visible();
    const animating = !!this.screen || chatFading || this.toasts.length > 0 || this.debug || (pano && this.config.panoramaSpeed > 0);
    const vitalsChanged = this.vitals.step(now);
    if (!this.dirty && !animating) {
      if (vitalsChanged) this.renderHud(false);
      return;
    }
    this.dirty = false;
    this.renderHud(chatFading);

    const g = this.gfx;
    g.begin();
    if (this.screen) this.screen.render(g, this.mouseX, this.mouseY, dt);
    this.renderToasts(g);
  }

  /** HUD 层：生命值/饱食度/经验条一直在桌面上（会被其他窗口挡住）；打开界面时快捷栏窗口会隐藏，快捷栏也由这里绘制 */
  renderHud(chatFading) {
    const h = this.hudGfx;
    h.begin();
    if (!this.screen || this.screen.showHud) this.vitals.render(h);
    if (this.screen && this.screen.showHud) {
      const hb = this.config.hotbar;
      const icons = hb.map((p) => (p ? this.itemIcon(this.itemInfo(p)) : null));
      this.hud.render(h, icons, hb.map(() => ''), this.config.selectedSlot, { hoverHighlight: false });
    }
    // 聊天栏关闭后，最近的消息还会显示 10 秒（与原版 HUD 相同）
    if (chatFading) this.chat.render(h, false);
    if (this.debug) this.renderDebug(h);
  }
}

window.app = new App();
window.app.start().catch((e) => {
  console.error(e);
  document.body.style.color = '#fff';
  document.body.textContent = '启动失败：' + e.message;
});
