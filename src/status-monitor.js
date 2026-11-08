// 定时收集右下角状态信息，只在数据变化时通知界面。

const path = require('path');
const sys = require('./sys-status');

// 不显示在“后台程序”里的进程（系统外壳本身，或者没有意义的托盘宿主）
const SKIP_BACKGROUND = new Set(['explorer.exe', 'minecraftdesktop.exe', 'electron.exe']);
// 一些系统托盘程序的友好名称
const FRIENDLY = {
  'securityhealthsystray.exe': 'Windows 安全中心',
  'onedrive.exe': 'OneDrive',
};

function displayName(entry, desc) {
  const base = path.basename(entry.path);
  if (FRIENDLY[base.toLowerCase()]) return FRIENDLY[base.toLowerCase()];
  // 托盘提示文字通常就是程序名，只取第一行，并去掉“ - 状态”之类的后缀
  const tip = (entry.tooltip || '').split(/\r?\n/)[0].split(' - ')[0].trim();
  if (tip) return tip;
  if (desc && desc.length <= 20) return desc;
  return base.replace(/\.exe$/i, '');
}

class StatusMonitor {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.data = { windows: [], background: [], volume: null, brightness: null, network: null, battery: null };
    this.lastJson = '';
    this.order = new Map(); // 窗口首次出现的顺序：保持列表稳定
    this.seq = 0;
    this.tray = [];
    this.descs = {};
    this.brightnessSupported = true;
    this.brightnessTarget = null;
    this.brightnessTimer = null;
    this.timers = [];
    this.running = false;
    this.slowBusy = false;
    this.windowPids = new Set();
    this.windowExes = new Set();
  }

  start() {
    if (this.running || !sys.available()) return;
    this.running = true;
    this.fast();
    this.slow();
    this.trayScan();
    this.timers.push(setInterval(() => this.fast(), 700));
    this.timers.push(setInterval(() => this.slow(), 5000));
    this.timers.push(setInterval(() => this.trayScan(), 30000));
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  dispose() {
    this.stop();
    sys.dispose();
  }

  push() {
    const json = JSON.stringify(this.data);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.onUpdate(this.data);
  }

  // ---------- 采集 ----------
  fast() {
    try {
      const wins = sys.listWindows();
      const alive = new Set(wins.map((w) => w.id));
      for (const id of this.order.keys()) if (!alive.has(id)) this.order.delete(id);
      for (const w of wins) if (!this.order.has(w.id)) this.order.set(w.id, ++this.seq);
      wins.sort((a, b) => this.order.get(a.id) - this.order.get(b.id));
      this.windowPids = new Set(wins.map((w) => w.pid));
      this.windowExes = new Set(wins.map((w) => (w.exePath || '').toLowerCase()).filter(Boolean));
      this.data.windows = wins.map(({ id, title, exe, minimized, active }) => ({ id, title, exe, minimized, active }));
      this.data.volume = sys.volume();
      this.data.battery = sys.battery();
      this.data.background = this.backgroundApps();
    } catch (e) {
      console.error('[status] 采集失败', e);
    }
    this.push();
  }

  async slow() {
    if (this.slowBusy) return;
    this.slowBusy = true;
    try {
      const list = await sys.network();
      const pick = list.find((n) => n.wifi) || list[0];
      this.data.network = pick
        ? { type: pick.wifi ? 'wifi' : 'ethernet', name: pick.name, internet: !!pick.internet }
        : { type: 'none', name: '', internet: false };
      if (this.brightnessSupported && this.brightnessTarget == null) {
        const b = await sys.brightness();
        if (b == null) this.brightnessSupported = false; // 台式机外接显示器通常不支持
        else if (this.brightnessTarget == null) this.data.brightness = b;
      }
    } finally {
      this.slowBusy = false;
    }
    this.push();
  }

  async trayScan() {
    const tray = await sys.trayRegistry();
    if (!tray.length) return;
    // 同一个程序可能登记了多个图标
    const byPath = new Map();
    for (const e of tray) {
      const k = e.path.toLowerCase();
      const prev = byPath.get(k);
      if (!prev || (!prev.tooltip && e.tooltip) || (e.promoted && !prev.promoted)) byPath.set(k, { ...e, promoted: e.promoted || (prev && prev.promoted) });
    }
    this.tray = [...byPath.values()];
    const missing = this.tray.map((e) => e.path).filter((p) => !(p in this.descs));
    if (missing.length) Object.assign(this.descs, await sys.fileDescriptions(missing));
    this.data.background = this.backgroundApps();
    this.push();
  }

  backgroundApps() {
    if (!this.tray.length) return [];
    const running = sys.runningProcesses();
    const out = [];
    for (const e of this.tray) {
      const k = e.path.toLowerCase();
      if (SKIP_BACKGROUND.has(path.basename(k))) continue;
      const pid = running.get(k);
      if (!pid) continue;
      // 已经有任务栏窗口的程序显示在窗口列表里
      if (this.windowPids.has(pid) || this.windowExes.has(k)) continue;
      out.push({ path: e.path, name: displayName(e, this.descs[e.path]), promoted: e.promoted });
    }
    // 固定显示在任务栏上的图标排在前面
    out.sort((a, b) => (b.promoted - a.promoted) || a.name.localeCompare(b.name, 'zh-CN'));
    return out.map(({ path: p, name }) => ({ path: p, name }));
  }

  // ---------- 操作 ----------
  /** 设置音量：value 为绝对值；value 为 null 时按 delta 增减 */
  setVolume(value, delta = 0) {
    const v = this.data.volume || sys.volume();
    if (!v) return;
    const target = value != null ? value : (v.muted && delta > 0 ? 0 : v.level) + delta;
    sys.setVolume(target);
    this.data.volume = sys.volume();
    this.push();
  }

  /** muted 为 null 时切换 */
  setMute(muted) {
    const v = this.data.volume || sys.volume();
    if (!v) return;
    sys.setMute(muted == null ? !v.muted : muted);
    this.data.volume = sys.volume();
    this.push();
  }

  setBrightness(value, delta = 0) {
    if (this.data.brightness == null) return;
    const cur = this.brightnessTarget ?? this.data.brightness;
    this.brightnessTarget = Math.max(0, Math.min(100, Math.round(value != null ? value : cur + delta)));
    this.data.brightness = this.brightnessTarget;
    this.push();
    // 滚动时只更新显示，停下来再真正设置（WMI 调用比较慢）
    clearTimeout(this.brightnessTimer);
    this.brightnessTimer = setTimeout(async () => {
      const target = this.brightnessTarget;
      await sys.setBrightness(target);
      if (this.brightnessTarget === target) this.brightnessTarget = null;
    }, 250);
  }
}

module.exports = { StatusMonitor };
