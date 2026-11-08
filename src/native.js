// Win32 原生调用：隐藏任务栏/桌面图标、窗口置底、全屏检测、AppBar 占位。
// 非 Windows 或 koffi 加载失败时，所有函数都安全地变成空操作。

let koffi = null;
let api = null;

const SW_HIDE = 0;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOW = 5;
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_LAYERED = 0x80000;
const GW_HWNDNEXT = 2;
const DWMWA_CLOAKED = 14;

const ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3, ABM_GETSTATE = 4, ABM_SETSTATE = 10;
const ABS_AUTOHIDE = 1, ABS_ALWAYSONTOP = 2;
const ABE_BOTTOM = 3;

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    const dwmapi = koffi.load('dwmapi.dll');

    const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const APPBARDATA = koffi.struct('APPBARDATA', {
      cbSize: 'uint32', hWnd: 'intptr', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr',
    });
    koffi.struct('MCD_POINT', { x: 'int32', y: 'int32' });
    const MONITORINFO = koffi.struct('MCD_MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });

    api = {
      RECT, APPBARDATA,
      FindWindowW: user32.func('intptr __stdcall FindWindowW(str16 cls, str16 name)'),
      FindWindowExW: user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(intptr hwnd, int cmd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr hwnd)'),
      IsWindow: user32.func('bool __stdcall IsWindow(intptr hwnd)'),
      SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint32 flags)'),
      GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ RECT *rect)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr hwnd, _Out_ uint16_t *buf, int max)'),
      GetAncestor: user32.func('intptr __stdcall GetAncestor(intptr hwnd, uint32 flags)'),
      GetWindow: user32.func('intptr __stdcall GetWindow(intptr hwnd, uint32 cmd)'),
      GetTopWindow: user32.func('intptr __stdcall GetTopWindow(intptr hwnd)'),
      GetWindowLongPtrW: user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr hwnd)'),
      DwmGetWindowAttribute: dwmapi.func('int __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ uint32 *value, uint32 size)'),
      MONITORINFO,
      MonitorFromWindow: user32.func('intptr __stdcall MonitorFromWindow(intptr hwnd, uint32 flags)'),
      MonitorFromPoint: user32.func('intptr __stdcall MonitorFromPoint(MCD_POINT pt, uint32 flags)'),
      GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(intptr mon, _Inout_ MCD_MONITORINFO *mi)'),
      SHAppBarMessage: shell32.func('uintptr __stdcall SHAppBarMessage(uint32 msg, _Inout_ APPBARDATA *data)'),
      RegisterWindowMessageW: user32.func('uint32 __stdcall RegisterWindowMessageW(str16 name)'),
    };
  } catch (e) {
    console.error('[native] koffi 加载失败，系统集成功能不可用:', e.message);
    api = false;
  }
  return api;
}

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function className(a, hwnd) {
  const buf = new Uint16Array(256);
  const n = a.GetClassNameW(hwnd, buf, 256);
  return String.fromCharCode(...buf.slice(0, n));
}

// ---------- 任务栏 ----------
function trayWindows(a) {
  const list = [];
  const main = a.FindWindowW('Shell_TrayWnd', null);
  if (main) list.push(main);
  let w = 0;
  for (let i = 0; i < 16; i++) {
    w = a.FindWindowExW(0, w, 'Shell_SecondaryTrayWnd', null);
    if (!w) break;
    list.push(w);
  }
  return list;
}

function getTaskbarState() {
  const a = load();
  if (!a) return null;
  const data = { cbSize: koffi.sizeof(a.APPBARDATA), hWnd: 0, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 };
  return Number(a.SHAppBarMessage(ABM_GETSTATE, data));
}

function setTaskbarState(state) {
  const a = load();
  if (!a) return;
  const tray = a.FindWindowW('Shell_TrayWnd', null);
  const data = { cbSize: koffi.sizeof(a.APPBARDATA), hWnd: tray, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: state };
  a.SHAppBarMessage(ABM_SETSTATE, data);
}

/** 隐藏任务栏。返回原来的 AppBar 状态，用于之后恢复。 */
function hideTaskbar() {
  const a = load();
  if (!a) return null;
  const prev = getTaskbarState();
  // 自动隐藏让工作区覆盖整个屏幕，再把窗口本身隐藏，鼠标移到底部也不会弹出
  setTaskbarState(ABS_AUTOHIDE);
  for (const w of trayWindows(a)) a.ShowWindow(w, SW_HIDE);
  return prev;
}

function isTaskbarVisible() {
  const a = load();
  if (!a) return false;
  return trayWindows(a).some((w) => a.IsWindowVisible(w));
}

function showTaskbar(prevState) {
  const a = load();
  if (!a) return;
  if (prevState != null) setTaskbarState(prevState & (ABS_AUTOHIDE | ABS_ALWAYSONTOP));
  for (const w of trayWindows(a)) a.ShowWindow(w, SW_SHOW);
}

// ---------- 桌面图标 ----------
function desktopListView(a) {
  let defView = 0;
  const progman = a.FindWindowW('Progman', null);
  if (progman) defView = a.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  if (!defView) {
    let w = 0;
    for (let i = 0; i < 64 && !defView; i++) {
      w = a.FindWindowExW(0, w, 'WorkerW', null);
      if (!w) break;
      defView = a.FindWindowExW(w, 0, 'SHELLDLL_DefView', null);
    }
  }
  if (!defView) return 0;
  return a.FindWindowExW(defView, 0, 'SysListView32', null);
}

function setDesktopIconsVisible(visible) {
  const a = load();
  if (!a) return;
  const lv = desktopListView(a);
  if (lv) a.ShowWindow(lv, visible ? SW_SHOW : SW_HIDE);
}

function areDesktopIconsVisible() {
  const a = load();
  if (!a) return true;
  const lv = desktopListView(a);
  return lv ? a.IsWindowVisible(lv) : true;
}

// ---------- 让桌面窗口始终待在“壁纸之上、其他窗口之下” ----------
const WM_WINDOWPOSCHANGED = 0x0047;
const GW_HWNDPREV = 3;

/**
 * 找到桌面（Progman 及其上方紧挨着的 WorkerW）上面的第一个窗口。
 * 把我们的窗口插到它下面，就正好位于壁纸之上。
 * 返回 0 表示我们已经在正确的位置。
 */
function slotAboveDesktop(a, own) {
  const progman = a.FindWindowW('Progman', null);
  if (!progman) return HWND_BOTTOM;
  let prev = a.GetWindow(progman, GW_HWNDPREV);
  while (prev && prev !== own && className(a, prev) === 'WorkerW') prev = a.GetWindow(prev, GW_HWNDPREV);
  if (prev === own) return 0;
  return prev || 0 /* HWND_TOP */;
}

/**
 * 窗口 Z 序改变后（例如被点击激活而跑到最前面），把它放回壁纸之上、其他窗口之下。
 * 注意：Electron 的 hookWindowMessage 回调是异步的，不能修改消息参数指向的内存。
 * isPinned() 返回 false 时（例如打开了物品栏）不做干预。
 */
function pinToBottom(win, isPinned) {
  const a = load();
  if (!a) return;
  let pending = false;
  win.hookWindowMessage(WM_WINDOWPOSCHANGED, () => {
    if (pending || !isPinned()) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      if (!win.isDestroyed() && isPinned()) sendToBottom(win);
    });
  });
}

function sendToBottom(win) {
  const a = load();
  if (!a) return;
  const own = hwndOf(win);
  const after = slotAboveDesktop(a, own);
  if (after === 0) return;
  a.SetWindowPos(own, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

function showNoActivate(win) {
  const a = load();
  if (!a) { win.showInactive(); return; }
  a.ShowWindow(hwndOf(win), SW_SHOWNOACTIVATE);
}

// ---------- 全屏程序检测（用于自动隐藏快捷栏） ----------
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

/** 窗口矩形是否盖住整个显示器（m 为 RECT，物理像素） */
function coversMonitor(r, m) {
  return r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
}

/** 主显示器的真实像素范围。不能用 Electron 的 DIP 尺寸 × 缩放比例换算：四舍五入会多出 1 像素（1707 × 1.5 = 2561） */
function primaryMonitorRect(a) {
  const mon = a.MonitorFromPoint({ x: 0, y: 0 }, 1 /* MONITOR_DEFAULTTOPRIMARY */);
  const mi = { cbSize: koffi.sizeof(a.MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
  if (!mon || !a.GetMonitorInfoW(mon, mi)) return null;
  return { mon, rect: mi.rcMonitor };
}

/** 主显示器上的前台窗口是否全屏（bounds 只在读取显示器信息失败时备用） */
function isForegroundFullscreen(bounds, ownHwnds) {
  const a = load();
  if (!a) return false;
  const fg = a.GetForegroundWindow();
  if (!fg || ownHwnds.includes(fg)) return false;
  const root = a.GetAncestor(fg, 2 /* GA_ROOT */);
  if (ownHwnds.includes(root)) return false;
  if (SHELL_CLASSES.has(className(a, fg))) return false;
  const r = {};
  if (!a.GetWindowRect(fg, r)) return false;
  const p = primaryMonitorRect(a);
  if (!p) {
    return coversMonitor(r, { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height });
  }
  // 快捷栏只在主显示器上，其他显示器上的全屏程序不影响
  if (a.MonitorFromWindow(fg, 0 /* MONITOR_DEFAULTTONULL */) !== p.mon) return false;
  return coversMonitor(r, p.rect);
}

/** 窗口矩形是否与 rect 相交（都是物理像素） */
function overlaps(r, rect) {
  return r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom;
}

/**
 * rect（物理像素）是否被别的窗口明显压住。ownHwnds 里的窗口（桌面层、快捷栏本身）不算。
 * 用来判断“任务栏可见”时 dock 是否该让位给最大化窗口：最大化窗口会把 dock 整个盖住，
 * 而只是蹭到 dock 边缘的窗口不算（那样 dock 还是画在它上面）。
 * 工具窗口、分层透明窗口和系统外壳（桌面、任务栏）都不算遮挡。
 */
function isRectCovered(rect, ownHwnds, threshold = 0.5) {
  const a = load();
  if (!a) return false;
  const area = Math.max(1, (rect.right - rect.left) * (rect.bottom - rect.top));
  let h = a.GetTopWindow(0);
  for (let i = 0; h && i < 4000; i++) {
    if (!ownHwnds.includes(h) && a.IsWindowVisible(h) && !a.IsIconic(h)) {
      const ex = Number(a.GetWindowLongPtrW(h, GWL_EXSTYLE));
      if (!(ex & WS_EX_TOOLWINDOW) && !(ex & WS_EX_LAYERED) && !SHELL_CLASSES.has(className(a, h))) {
        const cloaked = [0];
        const hidden = a.DwmGetWindowAttribute(h, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0];
        if (!hidden) {
          const r = {};
          if (a.GetWindowRect(h, r) && r.right > r.left && r.bottom > r.top && overlaps(r, rect)) {
            const ow = Math.min(r.right, rect.right) - Math.max(r.left, rect.left);
            const oh = Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top);
            if ((ow * oh) / area >= threshold) return true;
          }
        }
      }
    }
    h = a.GetWindow(h, GW_HWNDNEXT);
  }
  return false;
}

// ---------- AppBar：为快捷栏在屏幕底部预留空间 ----------
let appBarHwnd = 0;

function appBarData(a, hwnd, rect) {
  return {
    cbSize: koffi.sizeof(a.APPBARDATA), hWnd: hwnd, uCallbackMessage: 0, uEdge: ABE_BOTTOM,
    rc: rect || { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0,
  };
}

/** 在屏幕底部登记一条高 heightPx（物理像素）的保留区域。bounds 为物理像素的显示器范围。 */
function reserveBottom(win, boundsPx, heightPx) {
  const a = load();
  if (!a) return;
  const hwnd = hwndOf(win);
  if (appBarHwnd !== hwnd) {
    if (appBarHwnd) releaseBottom();
    const msg = a.RegisterWindowMessageW('MinecraftDesktopAppBar');
    const d = appBarData(a, hwnd);
    d.uCallbackMessage = msg;
    a.SHAppBarMessage(ABM_NEW, d);
    appBarHwnd = hwnd;
  }
  const rect = {
    left: boundsPx.x, right: boundsPx.x + boundsPx.width,
    top: boundsPx.y + boundsPx.height - heightPx, bottom: boundsPx.y + boundsPx.height,
  };
  const d = appBarData(a, hwnd, rect);
  a.SHAppBarMessage(ABM_QUERYPOS, d);
  d.rc.top = d.rc.bottom - heightPx;
  a.SHAppBarMessage(ABM_SETPOS, d);
}

function releaseBottom() {
  const a = load();
  if (!a || !appBarHwnd) return;
  a.SHAppBarMessage(ABM_REMOVE, appBarData(a, appBarHwnd));
  appBarHwnd = 0;
}

module.exports = {
  available: () => !!load(),
  hwndOf,
  hideTaskbar, showTaskbar, isTaskbarVisible,
  setDesktopIconsVisible, areDesktopIconsVisible,
  pinToBottom, sendToBottom, showNoActivate,
  isForegroundFullscreen, isRectCovered, coversMonitor,
  reserveBottom, releaseBottom,
};
