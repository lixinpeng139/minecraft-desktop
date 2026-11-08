// Electron 主进程：桌面窗口（背景 + 各种界面）与快捷栏窗口（置顶的 Dock）

const { app, BrowserWindow, screen, ipcMain, shell, dialog, protocol, net, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { execFile, spawn } = require('child_process');

const { Store } = require('./src/store');
const desktop = require('./src/desktop-items');
const native = require('./src/native');
const sysStatus = require('./src/sys-status');
const { StatusMonitor } = require('./src/status-monitor');
const { Vitals } = require('./src/vitals');
const { hotbarLayout } = require('./src/hotbar-layout');

const ROOT = __dirname;
const assetsSetup = require('./src/assets-setup');
// 资源目录：开发时可以放在项目里；安装版保存在用户数据目录（首次启动时获取）
let ASSETS = null;
function resolveAssetsDir() {
  const dev = path.join(ROOT, 'assets');
  if (!app.isPackaged && assetsSetup.assetsReady(dev)) return dev;
  return path.join(app.getPath('userData'), 'assets');
}
const args = process.argv.slice(1);
// --no-system: 不改动任务栏/桌面图标/开机启动（开发调试用）
const CAPTURE_DIR = (args.find((a) => a.startsWith('--capture=')) || '').slice('--capture='.length) || null;
const NO_SYSTEM = args.includes('--no-system') || !!CAPTURE_DIR;

protocol.registerSchemesAsPrivileged([
  { scheme: 'mcd', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (CAPTURE_DIR) app.setPath('userData', path.join(app.getPath('temp'), 'minecraft-desktop-capture'));

// --restore：只恢复任务栏和桌面图标（程序异常退出后的补救措施）
const RESTORE_ONLY = args.includes('--restore');

if (!CAPTURE_DIR && !RESTORE_ONLY && !app.requestSingleInstanceLock()) {
  // 已经在运行：把参数（例如 --quit）交给正在运行的实例
  app.quit();
  process.exit(0);
}

app.on('second-instance', (e, argv) => {
  if (argv.includes('--quit')) quit();
});

let store;
let items = [];
let desktopWin = null;
let hotbarWin = null;
let appBarWin = null; // 只用来向系统登记“底部保留区域”的隐藏窗口
let monitor = null; // 聊天栏里显示的系统状态（窗口、后台程序、音量、亮度、网络、电池）
let vitals = null; // 生命值（电量）、饱食度（CPU）、经验条（播放的声音）
let hotbarBounds = null;
let screenOpen = false;
let hotbarHidden = false; // 因全屏程序而隐藏
let hotbarInset = 0; // 任务栏可见时，桌面窗口的 GUI 底部要上移多少（GUI 像素）
let dockCovered = false; // 任务栏可见时，有窗口压在 dock 上（最大化窗口应当盖住它）
let hotbarRect = null; // 快捷栏可交互区域（相对快捷栏窗口的 CSS 像素）
let hotbarInteractive = false;
let lastLayoutKey = '';
let quitting = false;
let unwatch = null;

// ---------- 工具 ----------
function primary() {
  return screen.getPrimaryDisplay();
}

/** 与 Minecraft Window.calculateScale 相同的算法 */
function computeGuiScale(setting, physW, physH) {
  let i = 1;
  while (i !== setting && i < physW && i < physH && Math.floor(physW / (i + 1)) >= 320 && Math.floor(physH / (i + 1)) >= 240) i++;
  return i;
}

function maxGuiScale() {
  const d = primary();
  return computeGuiScale(0, Math.round(d.bounds.width * d.scaleFactor), Math.round(d.bounds.height * d.scaleFactor));
}

function currentGuiScale() {
  const d = primary();
  return computeGuiScale(store.get().guiScale, Math.round(d.bounds.width * d.scaleFactor), Math.round(d.bounds.height * d.scaleFactor));
}

function broadcast(channel, data) {
  for (const w of [desktopWin, hotbarWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  }
}

function displayInfo() {
  const d = primary();
  return {
    scaleFactor: d.scaleFactor,
    guiScale: currentGuiScale(),
    maxGuiScale: maxGuiScale(),
    bounds: d.bounds,
    hudInset: hotbarInset, // 任务栏可见时 > 0：桌面窗口的底部 HUD/界面整体上移
  };
}

// ---------- 系统集成 ----------
function applySystem() {
  if (NO_SYSTEM || !native.available()) return;
  const cfg = store.get();
  if (cfg.hideTaskbar) {
    if (cfg.savedTaskbarState == null) {
      // 先把原始状态写盘，即使之后崩溃也能恢复
      store.set({ savedTaskbarState: 0 });
      const prev = native.hideTaskbar();
      store.set({ savedTaskbarState: prev == null ? 0 : prev });
      store.save(true);
    } else {
      native.hideTaskbar();
    }
  } else if (cfg.savedTaskbarState != null) {
    native.showTaskbar(cfg.savedTaskbarState);
    store.set({ savedTaskbarState: null });
  }
  native.setDesktopIconsVisible(!cfg.hideDesktopIcons);
  applyAppBar();
}

function restoreSystem() {
  if (!store) return;
  if (NO_SYSTEM || !native.available()) return;
  const cfg = store.get();
  native.releaseBottom();
  if (cfg.savedTaskbarState != null) {
    native.showTaskbar(cfg.savedTaskbarState);
    store.set({ savedTaskbarState: null });
  }
  native.setDesktopIconsVisible(true);
  store.save(true);
}

function applyAutoStart() {
  if (NO_SYSTEM) return;
  const open = !!store.get().autoStart;
  const opts = { openAtLogin: open, name: 'MinecraftDesktop' };
  if (!app.isPackaged) {
    opts.path = process.execPath;
    opts.args = [path.resolve(ROOT)];
  }
  try { app.setLoginItemSettings(opts); } catch (e) { console.error('设置开机启动失败', e); }
}

function applyAppBar() {
  if (NO_SYSTEM || !native.available()) return;
  if (!appBarWin) {
    appBarWin = new BrowserWindow({ width: 1, height: 1, show: false, frame: false, skipTaskbar: true, focusable: false });
    appBarWin.on('close', (e) => { if (!quitting) e.preventDefault(); });
  }
  // 任务栏可见时不为快捷栏预留空间：最大化窗口应当一直贴到任务栏，把它盖住
  const cfg = store.get();
  if (!cfg.hideTaskbar || !cfg.reserveHotbarSpace) { native.releaseBottom(); return; }
  const d = primary();
  const s = currentGuiScale();
  const px = {
    x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor),
    width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor),
  };
  native.reserveBottom(appBarWin, px, 23 * s);
  setTimeout(placeHotbar, 300);
}

// ---------- 窗口 ----------
function webPrefs() {
  return {
    preload: path.join(ROOT, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: true,
    spellcheck: false,
  };
}

/** 当前布局的关键参数：工作区/缩放变化时（例如任务栏被调整）重新排版 */
function layoutKey() {
  const d = primary();
  const b = d.bounds;
  const s = currentGuiScale();
  if (store.get().hideTaskbar) return `${s}|${b.x},${b.y},${b.width}x${b.height}`;
  const w = d.workArea;
  return `${s}|${b.x},${b.y},${b.width}x${b.height}|${w.x},${w.y},${w.width}x${w.height}`;
}

function layoutWindows() {
  const d = primary();
  if (desktopWin) desktopWin.setBounds(d.bounds);
  if (hotbarWin) {
    const L = hotbarLayout({
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      guiScale: currentGuiScale(),
      hideTaskbar: !!store.get().hideTaskbar,
    });
    hotbarInset = L.inset;
    hotbarBounds = L.hotbar;
    placeHotbar();
  }
  applyAppBar();
  lastLayoutKey = layoutKey();
  broadcast('display', displayInfo());
}

function createDesktopWindow() {
  const d = primary();
  desktopWin = new BrowserWindow({
    ...d.bounds,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#000000',
    title: 'Minecraft Desktop',
    opacity: CAPTURE_DIR ? 0 : 1,
    focusable: !CAPTURE_DIR,
    webPreferences: webPrefs(),
  });
  desktopWin.setMenu(null);
  if (CAPTURE_DIR) desktopWin.setIgnoreMouseEvents(true);
  desktopWin.loadURL('mcd://app/renderer/desktop.html');
  if (!CAPTURE_DIR) native.pinToBottom(desktopWin, () => !screenOpen && !quitting);
  desktopWin.once('ready-to-show', () => {
    if (CAPTURE_DIR) desktopWin.showInactive();
    else {
      desktopWin.showInactive();
      native.sendToBottom(desktopWin);
    }
  });
  desktopWin.on('blur', () => {
    if (screenOpen) desktopWin.webContents.send('desktop:blur');
  });
  // “显示桌面”(Win+D) 会尝试最小化所有窗口：桌面窗口应当保持可见
  desktopWin.on('minimize', () => {
    setTimeout(() => {
      if (!desktopWin || desktopWin.isDestroyed()) return;
      desktopWin.restore();
      desktopWin.focus();
    }, 50);
  });
  desktopWin.on('close', (e) => { if (!quitting) e.preventDefault(); });
  // 注销/关机：恢复任务栏（下次开机自启时会再隐藏）
  desktopWin.on('session-end', () => restoreSystem());
}

/** 快捷栏必须贴在屏幕最底部（工作区变化时系统可能会把它挪上去） */
function placeHotbar() {
  if (!hotbarWin || hotbarWin.isDestroyed() || !hotbarBounds) return;
  const b = hotbarWin.getBounds();
  if (b.x !== hotbarBounds.x || b.y !== hotbarBounds.y || b.width !== hotbarBounds.width || b.height !== hotbarBounds.height) {
    hotbarWin.setBounds(hotbarBounds);
  }
}

function createHotbarWindow() {
  hotbarWin = new BrowserWindow({
    width: 100,
    height: 100,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'Minecraft Hotbar',
    opacity: CAPTURE_DIR ? 0 : 1,
    webPreferences: webPrefs(),
  });
  hotbarWin.setMenu(null);
  hotbarWin.setAlwaysOnTop(true, 'pop-up-menu');
  hotbarWin.setIgnoreMouseEvents(true);
  hotbarWin.loadURL('mcd://app/renderer/hotbar.html');
  hotbarWin.once('ready-to-show', () => updateHotbarVisibility());
  hotbarWin.on('moved', () => setTimeout(placeHotbar, 0));
  hotbarWin.on('resized', () => setTimeout(placeHotbar, 0));
  hotbarWin.on('close', (e) => { if (!quitting) e.preventDefault(); });
}

function updateHotbarVisibility() {
  if (!hotbarWin || hotbarWin.isDestroyed()) return;
  const shouldShow = CAPTURE_DIR ? true : !screenOpen && !hotbarHidden && !dockCovered;
  if (shouldShow && !hotbarWin.isVisible()) hotbarWin.showInactive();
  else if (!shouldShow && hotbarWin.isVisible()) {
    hotbarWin.hide();
    if (hotbarInteractive) {
      hotbarInteractive = false;
      hotbarWin.setIgnoreMouseEvents(true);
    }
  }
}

function setScreenOpen(open) {
  if (screenOpen === open) return;
  screenOpen = open;
  if (!desktopWin || CAPTURE_DIR) return;
  if (open) {
    desktopWin.moveTop();
    desktopWin.focus();
  } else {
    native.sendToBottom(desktopWin);
  }
  updateHotbarVisibility();
}

// 鼠标位于快捷栏上时才接收鼠标事件，其余区域点击穿透（拖放文件时同样有效）
function pollCursor() {
  pollDockCoverage();
  if (!hotbarWin || hotbarWin.isDestroyed() || !hotbarWin.isVisible() || !hotbarRect) return;
  const p = screen.getCursorScreenPoint();
  const b = hotbarWin.getBounds();
  const inside = p.x >= b.x + hotbarRect.x && p.x < b.x + hotbarRect.x + hotbarRect.w &&
    p.y >= b.y + hotbarRect.y && p.y < b.y + hotbarRect.y + hotbarRect.h;
  if (inside !== hotbarInteractive) {
    hotbarInteractive = inside;
    hotbarWin.setIgnoreMouseEvents(!inside);
    if (!inside) hotbarWin.webContents.send('hotbar:leave');
  }
}

/** 主进程自己的窗口（判断遮挡时不算） */
function ownHwnds() {
  return [desktopWin, hotbarWin, appBarWin]
    .filter((w) => w && !w.isDestroyed())
    .map((w) => native.hwndOf(w));
}

/** 快捷栏的可见区域（物理像素）。hotbarRect 由快捷栏窗口在布局后报告。 */
function dockRectPx() {
  const b = hotbarWin.getBounds();
  const r = hotbarRect;
  const sf = primary().scaleFactor;
  return {
    left: Math.round((b.x + r.x) * sf),
    top: Math.round((b.y + r.y) * sf),
    right: Math.round((b.x + r.x + r.w) * sf),
    bottom: Math.round((b.y + r.y + r.h) * sf),
  };
}

/**
 * 任务栏可见时，dock 只是“桌面上的装饰”：别的窗口压过来（尤其是最大化窗口）就隐藏，
 * 看起来就像被窗口盖住了。隐藏任务栏时 dock 是置顶的，不做这个判断。
 */
function pollDockCoverage() {
  if (!hotbarWin || hotbarWin.isDestroyed()) return;
  if (CAPTURE_DIR || !store || store.get().hideTaskbar || !native.available() || !hotbarRect) {
    if (dockCovered) { dockCovered = false; updateHotbarVisibility(); }
    return;
  }
  // 被界面或全屏程序挡住时不用再判断；已经因为被遮挡而隐藏时要继续判断，才能恢复
  if (!hotbarWin.isVisible() && !dockCovered) return;
  const covered = native.isRectCovered(dockRectPx(), ownHwnds());
  if (covered === dockCovered) return;
  dockCovered = covered;
  updateHotbarVisibility();
}

function pollSystem() {
  if (quitting) return;
  if (!CAPTURE_DIR && native.available() && desktopWin && hotbarWin) {
    // 任务栏高度/位置变化（或我们自己预留的空间变化）后重新排版
    if (layoutKey() !== lastLayoutKey) layoutWindows();
    const d = primary();
    const px = {
      x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor),
      width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor),
    };
    const fs = native.isForegroundFullscreen(px, [native.hwndOf(desktopWin), native.hwndOf(hotbarWin)]);
    if (fs !== hotbarHidden) {
      hotbarHidden = fs;
      updateHotbarVisibility();
    }
    placeHotbar();
    // 资源管理器重启后任务栏会重新出现
    if (!NO_SYSTEM && store.get().hideTaskbar && native.isTaskbarVisible()) native.hideTaskbar();
  }
}

// ---------- 物品 ----------
function rescan() {
  items = desktop.scan(store.get().includePublicDesktop);
  broadcast('items', items);
}

function rewatch() {
  if (unwatch) unwatch();
  unwatch = desktop.watch(store.get().includePublicDesktop, rescan);
}

function grant(id) {
  const adv = store.get().advancements;
  if (adv[id]) return;
  adv[id] = Date.now();
  store.set({ advancements: adv });
  broadcast('config', store.get());
  if (desktopWin) desktopWin.webContents.send('toast', { type: 'advancement', id });
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.handle('vitals:get', () => (vitals ? vitals.get() : null));
  ipcMain.handle('state:get', () => ({
    config: store.get(),
    items,
    display: displayInfo(),
    noSystem: NO_SYSTEM,
    capture: !!CAPTURE_DIR,
    userName: (() => { try { return os.userInfo().username; } catch { return 'Player'; } })(),
  }));

  ipcMain.handle('config:patch', (e, patch) => {
    const before = store.get();
    const changed = (k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(before[k]);
    const flags = {
      scale: changed('guiScale'),
      system: changed('hideTaskbar') || changed('hideDesktopIcons') || changed('reserveHotbarSpace'),
      taskbar: changed('hideTaskbar'),
      auto: changed('autoStart'),
      publicDesk: changed('includePublicDesktop'),
    };
    store.set(patch);
    broadcast('config', store.get());
    if (flags.scale) layoutWindows();
    if (flags.system) applySystem();
    if (flags.taskbar) {
      // 任务栏的显示/隐藏和 AppBar 的撤销都是异步生效的，多排几次版，等系统把工作区还回来
      layoutWindows();
      setTimeout(layoutWindows, 250);
      setTimeout(layoutWindows, 1000);
    }
    if (flags.auto) applyAutoStart();
    if (flags.publicDesk) { rescan(); rewatch(); }
    return store.get();
  });

  ipcMain.handle('items:describe', (e, paths) => paths.map((p) => desktop.describe(p)));
  ipcMain.handle('items:refresh', () => { rescan(); return items; });
  ipcMain.handle('icon:get', (e, p) => desktop.getIcon(p));

  ipcMain.handle('item:open', async (e, p, source) => {
    const err = await shell.openPath(p);
    if (!err) {
      const cfg = store.get();
      const stats = cfg.stats;
      stats.launches[p] = (stats.launches[p] || 0) + 1;
      if (source === 'hotbar') stats.launchesFromHotbar++;
      else stats.launchesFromInventory++;
      store.set({ stats });
      broadcast('config', store.get());
      if (source === 'hotbar') {
        grant('launch_hotbar');
        if (stats.launchesFromHotbar >= 100) grant('launch_100');
      }
    }
    return err;
  });

  ipcMain.handle('stats:inc', (e, key, n = 1) => {
    const stats = store.get().stats;
    stats[key] = (stats[key] || 0) + n;
    store.set({ stats });
    return stats;
  });

  ipcMain.handle('adv:grant', (e, id) => grant(id));

  ipcMain.on('desktop:screen', (e, open) => setScreenOpen(!!open));
  ipcMain.on('hotbar:rect', (e, rect) => { hotbarRect = rect; });
  // 聊天栏打开时才采集系统状态
  ipcMain.handle('status:watch', (e, on) => {
    if (!monitor) return null;
    if (on) monitor.start(); else monitor.stop();
    return on ? monitor.data : null;
  });
  ipcMain.on('status:action', (e, act) => statusAction(act || {}));
  ipcMain.on('hotbar:openInventory', () => {
    if (!desktopWin) return;
    desktopWin.webContents.send('command', 'inventory');
  });

  ipcMain.handle('shell:openExternal', (e, url) => shell.openExternal(url));
  ipcMain.handle('shell:showItem', (e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:openDesktopFolder', () => shell.openPath(app.getPath('desktop')));
  ipcMain.handle('shell:explorer', () => {
    spawn('explorer.exe', ['shell:MyComputerFolder'], { detached: true, stdio: 'ignore' }).unref();
  });
  ipcMain.handle('clipboard:write', (e, text) => clipboard.writeText(text));

  ipcMain.handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(desktopWin, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('image:read', async (e, p) => {
    try {
      const img = nativeImage.createFromPath(p);
      if (img.isEmpty()) return null;
      return img.toDataURL();
    } catch { return null; }
  });

  ipcMain.handle('sys:wallpaper', () => new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }, (err, out) => {
      let p = null;
      const m = !err && out.match(/WallPaper\s+REG_SZ\s+(.+)/i);
      if (m && fs.existsSync(m[1].trim())) p = m[1].trim();
      if (!p) {
        const t = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
        if (fs.existsSync(t)) p = t;
      }
      if (!p) return resolve(null);
      const img = nativeImage.createFromPath(p);
      resolve(img.isEmpty() ? null : img.toDataURL());
    });
  }));

  let lastCpu = os.cpus();
  ipcMain.handle('sys:info', () => {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    cpus.forEach((c, i) => {
      const prev = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
      const t = c.times;
      const dt = (t.user - prev.user) + (t.nice - prev.nice) + (t.sys - prev.sys) + (t.idle - prev.idle) + (t.irq - prev.irq);
      total += dt;
      idle += t.idle - prev.idle;
    });
    lastCpu = cpus;
    return {
      cpuModel: cpus[0] ? cpus[0].model.trim() : '',
      cpuCount: cpus.length,
      cpuUsage: total > 0 ? 1 - idle / total : 0,
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      uptime: os.uptime(),
      host: os.hostname(),
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      processMem: process.memoryUsage().rss,
    };
  });

  ipcMain.handle('net:lan', () => {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
      }
    }
    return out;
  });

  ipcMain.handle('app:quit', () => quit());
  ipcMain.handle('assets:resetup', () => {
    app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== '--setup'), '--setup'] });
    quit();
  });

  ipcMain.handle('debug:capture', async (e, name) => {
    if (!CAPTURE_DIR) return;
    const win = BrowserWindow.fromWebContents(e.sender);
    const img = await win.webContents.capturePage();
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CAPTURE_DIR, name + '.png'), img.toPNG());
  });
  ipcMain.handle('debug:done', () => { if (CAPTURE_DIR) quit(); });
}

// 聊天栏里的系统操作
const SETTINGS_PAGES = {
  sound: 'ms-settings:sound',
  display: 'ms-settings:display',
  network: 'ms-settings:network',
  battery: 'ms-settings:batterysaver',
  datetime: 'ms-settings:dateandtime',
  bluetooth: 'ms-settings:bluetooth',
  personalization: 'ms-settings:personalization',
  apps: 'ms-settings:appsfeatures',
  system: 'ms-settings:',
};

function statusAction(act) {
  if (!monitor) return;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  switch (act.type) {
    case 'window:activate': sysStatus.activateWindow(act.id); setTimeout(() => monitor.fast(), 150); break;
    case 'window:minimize': sysStatus.minimizeWindow(act.id); setTimeout(() => monitor.fast(), 150); break;
    case 'window:close': sysStatus.closeWindow(act.id); setTimeout(() => monitor.fast(), 500); break;
    case 'app:open':
      // 只允许打开列表里的程序
      if (typeof act.path === 'string' && monitor.data.background.some((b) => b.path === act.path)) shell.openPath(act.path);
      break;
    case 'volume:step': monitor.setVolume(null, num(act.delta)); break;
    case 'volume:set': monitor.setVolume(num(act.value)); break;
    case 'volume:mute': monitor.setMute(act.value == null ? null : !!act.value); break;
    case 'brightness:step': monitor.setBrightness(null, num(act.delta)); break;
    case 'brightness:set': monitor.setBrightness(num(act.value)); break;
    case 'quickSettings': sysStatus.winKey(0x41); break; // Win+A
    case 'notifications': sysStatus.winKey(0x4e); break; // Win+N
    case 'settings':
      if (SETTINGS_PAGES[act.page]) shell.openExternal(SETTINGS_PAGES[act.page]);
      break;
    default: break;
  }
}

function quit() {
  if (quitting) return;
  quitting = true;
  restoreSystem();
  if (unwatch) unwatch();
  if (vitals) vitals.stop();
  if (monitor) monitor.dispose();
  for (const w of [desktopWin, hotbarWin, appBarWin]) if (w && !w.isDestroyed()) w.destroy();
  app.quit();
}

// ---------- 启动 ----------
app.whenReady().then(async () => {
  if (RESTORE_ONLY) {
    const st = new Store(app.getPath('userData'));
    native.releaseBottom();
    native.showTaskbar(st.get().savedTaskbarState ?? 0);
    native.setDesktopIconsVisible(true);
    st.set({ savedTaskbarState: null });
    st.save(true);
    app.quit();
    return;
  }
  if (args.includes('--quit')) { app.quit(); return; }
  ASSETS = resolveAssetsDir();
  protocol.handle('mcd', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let base = ROOT, sub = rel;
    if (rel.startsWith('assets/')) { base = ASSETS; sub = rel.slice('assets/'.length); }
    const file = path.normalize(path.join(base, sub));
    if (!file.startsWith(path.normalize(base))) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  if (!assetsSetup.assetsReady(ASSETS) || args.includes('--setup')) {
    const ok = await runSetup();
    if (!ok) { app.quit(); return; }
  }
  startApp();
});

function startApp() {
  store = new Store(app.getPath('userData'));
  items = desktop.scan(store.get().includePublicDesktop);
  rewatch();
  setupIpc();

  createDesktopWindow();
  createHotbarWindow();
  if (!CAPTURE_DIR) {
    monitor = new StatusMonitor((data) => {
      if (desktopWin && !desktopWin.isDestroyed()) desktopWin.webContents.send('status', data);
    });
    // 全屏程序在前台时桌面看不见，暂停采样
    vitals = new Vitals((ch, data) => {
      if (desktopWin && !desktopWin.isDestroyed()) desktopWin.webContents.send(ch, data);
    }, () => hotbarHidden);
    vitals.start();
  }
  layoutWindows();
  applySystem();
  applyAutoStart();

  screen.on('display-metrics-changed', layoutWindows);
  screen.on('display-added', layoutWindows);
  screen.on('display-removed', layoutWindows);

  setInterval(pollCursor, 50);
  setInterval(pollSystem, 700);

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const stats = store.get().stats;
    stats.playTime += (now - last) / 1000;
    last = now;
    store.set({ stats });
    if (stats.playTime >= 100 * 3600) grant('play_100h');
  }, 60000);
}

// ---------- 首次启动：从 Mojang 官方服务器下载 Minecraft 资源 ----------
function runSetup() {
  inSetup = true;
  return new Promise((resolve) => {
    let finished = false;
    let running = false;
    const win = new BrowserWindow({
      width: 600, height: 400, resizable: false, maximizable: false, fullscreenable: false,
      title: 'Minecraft 桌面 - 下载资源', backgroundColor: '#1e1e1e', show: false,
      webPreferences: webPrefs(),
    });
    win.setMenu(null);
    win.loadURL('mcd://app/renderer/setup.html');
    win.once('ready-to-show', () => win.show());
    const send = (info) => {
      if (win.isDestroyed()) return;
      win.webContents.send('setup:progress', info);
      win.setProgressBar(info.stage === 'done' ? -1 : Math.max(0.01, info.percent));
    };

    ipcMain.handle('setup:start', async () => {
      if (running) return { ok: false, error: '正在下载中' };
      running = true;
      try {
        // net.fetch 走 Chromium 网络栈，会使用系统代理
        await assetsSetup.downloadFromMojang(ASSETS, (u) => net.fetch(u, { cache: 'no-store' }), send);
        finished = true;
        setTimeout(() => {
          resolve(true); // 先创建桌面窗口，再关闭这个窗口
          setTimeout(() => { if (!win.isDestroyed()) win.destroy(); inSetup = false; }, 1500);
        }, 800);
        return { ok: true };
      } catch (err) {
        if (!win.isDestroyed()) win.setProgressBar(1, { mode: 'error' });
        return { ok: false, error: err.message };
      } finally {
        running = false;
      }
    });
    win.on('closed', () => {
      ipcMain.removeHandler('setup:start');
      if (!finished) { inSetup = false; resolve(false); }
    });
  });
}

app.on('before-quit', () => { if (!quitting) { quitting = true; restoreSystem(); } });
// 首次启动的资源窗口关闭到桌面窗口创建之间，不能因为“没有窗口”而退出
let inSetup = false;
app.on('window-all-closed', () => { if (!inSetup) app.quit(); });
process.on('SIGINT', () => quit());
process.on('SIGTERM', () => quit());
process.on('uncaughtException', (e) => {
  console.error(e);
  try { restoreSystem(); } catch { /* ignore */ }
  process.exit(1);
});
