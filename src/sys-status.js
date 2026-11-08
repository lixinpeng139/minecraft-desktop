// 右下角状态信息的数据来源（Windows）：
// - 任务栏窗口：与任务栏相同的筛选规则（可见、无所有者、非工具窗口、未被隐藏）
// - 后台程序：在“通知区域图标”注册表里登记过、并且正在当前会话中运行的程序
// - 音量：Core Audio（IAudioEndpointVolume）
// - 亮度、网络：通过常驻 PowerShell 读取 WMI / NetConnectionProfile
// - 电池：GetSystemPowerStatus
// 非 Windows 或加载失败时，所有函数返回空数据。

const path = require('path');
const { PsHost } = require('./ps-host');

let koffi = null;
let api = null;
const ps = new PsHost();

// ---------- Win32 ----------
function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const ole32 = koffi.load('ole32.dll');

    const GUID = koffi.struct('MCD_GUID', { d1: 'uint32', d2: 'uint16', d3: 'uint16', d4: koffi.array('uint8', 8) });
    const POWER = koffi.struct('MCD_SYSTEM_POWER_STATUS', {
      ACLineStatus: 'uint8', BatteryFlag: 'uint8', BatteryLifePercent: 'uint8', SystemStatusFlag: 'uint8',
      BatteryLifeTime: 'uint32', BatteryFullLifeTime: 'uint32',
    });

    api = {
      GUID, POWER,
      FindWindowExW: user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr hwnd)'),
      IsWindow: user32.func('bool __stdcall IsWindow(intptr hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr hwnd)'),
      GetWindowLongPtrW: user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)'),
      GetWindow: user32.func('intptr __stdcall GetWindow(intptr hwnd, uint32 cmd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(intptr hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr hwnd, _Out_ uint16_t *buf, int max)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr hwnd, _Out_ uint16_t *buf, int max)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)'),
      GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr hwnd)'),
      SwitchToThisWindow: user32.func('void __stdcall SwitchToThisWindow(intptr hwnd, bool altTab)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(intptr hwnd, int cmd)'),
      PostMessageW: user32.func('bool __stdcall PostMessageW(intptr hwnd, uint32 msg, uintptr w, intptr l)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)'),
      DwmGetWindowAttribute: dwmapi.func('int __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ uint32 *value, uint32 size)'),
      OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr h)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr h, uint32 flags, _Out_ uint16_t *buf, _Inout_ uint32 *size)'),
      K32EnumProcesses: kernel32.func('bool __stdcall K32EnumProcesses(_Out_ uint32 *pids, uint32 cb, _Out_ uint32 *needed)'),
      ProcessIdToSessionId: kernel32.func('bool __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *session)'),
      GetSystemPowerStatus: kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ MCD_SYSTEM_POWER_STATUS *s)'),
      CoInitializeEx: ole32.func('int __stdcall CoInitializeEx(void *res, uint32 flags)'),
      CoCreateInstance: ole32.func('int __stdcall CoCreateInstance(MCD_GUID *clsid, void *outer, uint32 ctx, MCD_GUID *iid, _Out_ void **ppv)'),
    };
  } catch (e) {
    console.error('[sys-status] 加载失败:', e.message);
    api = false;
  }
  return api;
}

function wstr(fn, hwnd, max = 512) {
  const buf = new Uint16Array(max);
  const n = fn(hwnd, buf, max);
  return n > 0 ? String.fromCharCode(...buf.slice(0, n)) : '';
}

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000, WS_EX_NOACTIVATE = 0x8000000;
const GW_OWNER = 4;
const DWMWA_CLOAKED = 14;
const SW_RESTORE = 9, SW_MINIMIZE = 6;
const WM_CLOSE = 0x10;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);

// ---------- 进程 ----------
const exeCache = new Map(); // pid -> 路径（pid 消失时清除）

function exePath(a, pid) {
  if (exeCache.has(pid)) return exeCache.get(pid);
  let p = '';
  const h = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (h) {
    const buf = new Uint16Array(1024);
    const size = [1024];
    if (a.QueryFullProcessImageNameW(h, 0, buf, size)) p = String.fromCharCode(...buf.slice(0, size[0]));
    a.CloseHandle(h);
  }
  exeCache.set(pid, p);
  return p;
}

function sessionOf(a, pid) {
  const s = [0];
  return a.ProcessIdToSessionId(pid, s) ? s[0] : -1;
}

/** 当前会话中正在运行的进程：小写路径 -> pid */
function runningProcesses() {
  const a = load();
  const out = new Map();
  if (!a) return out;
  const pids = new Uint32Array(4096);
  const needed = [0];
  if (!a.K32EnumProcesses(pids, pids.byteLength, needed)) return out;
  const n = needed[0] / 4;
  const mySession = sessionOf(a, process.pid);
  const alive = new Set();
  for (let i = 0; i < n; i++) {
    const pid = pids[i];
    if (!pid) continue;
    alive.add(pid);
    if (sessionOf(a, pid) !== mySession) continue;
    const p = exePath(a, pid);
    if (p) out.set(p.toLowerCase(), pid);
  }
  for (const pid of exeCache.keys()) if (!alive.has(pid)) exeCache.delete(pid);
  return out;
}

// ---------- 任务栏窗口 ----------
function isTaskbarWindow(a, hwnd) {
  if (!a.IsWindowVisible(hwnd)) return false;
  const ex = Number(a.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  if (ex & WS_EX_TOOLWINDOW) return false;
  if (!(ex & WS_EX_APPWINDOW)) {
    if (a.GetWindow(hwnd, GW_OWNER)) return false;
    if (ex & WS_EX_NOACTIVATE) return false;
  }
  const cloaked = [0];
  if (a.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return false;
  if (!a.GetWindowTextLengthW(hwnd)) return false;
  if (SKIP_CLASSES.has(wstr(a.GetClassNameW, hwnd, 256))) return false;
  return true;
}

/** 返回任务栏上会显示的窗口（按 Z 序） */
function listWindows() {
  const a = load();
  if (!a) return [];
  const fg = a.GetForegroundWindow();
  const out = [];
  let h = 0;
  for (let i = 0; i < 4000; i++) {
    h = a.FindWindowExW(0, h, null, null);
    if (!h) break;
    if (!isTaskbarWindow(a, h)) continue;
    const pid = [0];
    a.GetWindowThreadProcessId(h, pid);
    if (pid[0] === process.pid) continue;
    const exe = exePath(a, pid[0]);
    out.push({
      id: String(h),
      title: wstr(a.GetWindowTextW, h, 512),
      exe: exe ? path.basename(exe) : '',
      exePath: exe,
      pid: pid[0],
      minimized: a.IsIconic(h),
      active: h === fg,
    });
  }
  return out;
}

function toHwnd(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

/** 还原（如果最小化了）并切换到这个窗口 */
function activateWindow(id) {
  const a = load();
  const h = toHwnd(id);
  if (!a || !h || !a.IsWindow(h)) return;
  if (a.IsIconic(h)) a.ShowWindow(h, SW_RESTORE);
  if (!a.SetForegroundWindow(h)) a.SwitchToThisWindow(h, true);
}

function minimizeWindow(id) {
  const a = load();
  const h = toHwnd(id);
  if (a && h && a.IsWindow(h)) a.ShowWindow(h, SW_MINIMIZE);
}

function closeWindow(id) {
  const a = load();
  const h = toHwnd(id);
  if (a && h && a.IsWindow(h)) a.PostMessageW(h, WM_CLOSE, 0, 0);
}

/** 模拟 Win+某键（例如 Win+A 快速设置、Win+N 通知中心） */
function winKey(vk) {
  const a = load();
  if (!a) return;
  const KEYUP = 2;
  a.keybd_event(0x5b, 0, 0, 0);
  a.keybd_event(vk, 0, 0, 0);
  a.keybd_event(vk, 0, KEYUP, 0);
  a.keybd_event(0x5b, 0, KEYUP, 0);
}

// ---------- 电池 ----------
function battery() {
  const a = load();
  if (!a) return null;
  const s = {};
  if (!a.GetSystemPowerStatus(s)) return null;
  if (s.BatteryFlag === 128 || s.BatteryFlag === 255 || s.BatteryLifePercent > 100) return null; // 没有电池
  return {
    percent: s.BatteryLifePercent,
    charging: !!(s.BatteryFlag & 8),
    plugged: s.ACLineStatus === 1,
    saver: !!(s.SystemStatusFlag & 1),
    secondsLeft: s.BatteryLifeTime === 0xffffffff ? null : s.BatteryLifeTime,
  };
}

// ---------- 音量（Core Audio） ----------
function guid(s) {
  const h = s.replace(/[{}-]/g, '');
  const d4 = [];
  for (let i = 16; i < 32; i += 2) d4.push(parseInt(h.slice(i, i + 2), 16));
  return { d1: parseInt(h.slice(0, 8), 16), d2: parseInt(h.slice(8, 12), 16), d3: parseInt(h.slice(12, 16), 16), d4 };
}

let audio = null; // { enumerator, protos }

function audioApi() {
  if (audio !== null) return audio;
  audio = false;
  const a = load();
  if (!a) return audio;
  try {
    a.CoInitializeEx(null, 2 /* COINIT_APARTMENTTHREADED */); // 已初始化时返回 S_FALSE / RPC_E_CHANGED_MODE，都可以继续
    const out = [null];
    const hr = a.CoCreateInstance(guid('BCDE0395-E52F-467C-8E3D-C4579291692E'), null, 0x17,
      guid('A95664D2-9614-4F35-A746-DE8DB63617E6'), out);
    if (hr !== 0 || !out[0]) return audio;
    audio = {
      enumerator: out[0],
      GetDefault: koffi.proto('int __stdcall MCD_GetDefaultAudioEndpoint(void *self, int flow, int role, _Out_ void **dev)'),
      Activate: koffi.proto('int __stdcall MCD_Activate(void *self, MCD_GUID *iid, uint32 ctx, void *params, _Out_ void **out)'),
      Release: koffi.proto('uint32 __stdcall MCD_Release(void *self)'),
      GetLevel: koffi.proto('int __stdcall MCD_GetMasterVolumeLevelScalar(void *self, _Out_ float *level)'),
      SetLevel: koffi.proto('int __stdcall MCD_SetMasterVolumeLevelScalar(void *self, float level, void *ctx)'),
      GetMute: koffi.proto('int __stdcall MCD_GetMute(void *self, _Out_ int *mute)'),
      SetMute: koffi.proto('int __stdcall MCD_SetMute(void *self, int mute, void *ctx)'),
    };
  } catch (e) {
    console.error('[sys-status] 音量接口不可用:', e.message);
    audio = false;
  }
  return audio;
}

function vcall(obj, index, proto, ...args) {
  const vtbl = koffi.decode(obj, 'void *');
  const fn = koffi.decode(vtbl, index * 8, 'void *');
  return koffi.call(fn, proto, obj, ...args);
}

/** 打开默认播放设备的 IAudioEndpointVolume，执行 fn 后释放 */
function withEndpoint(fn) {
  const au = audioApi();
  if (!au) return null;
  const dev = [null];
  if (vcall(au.enumerator, 4, au.GetDefault, 0 /* eRender */, 1 /* eMultimedia */, dev) !== 0 || !dev[0]) return null;
  const vol = [null];
  try {
    if (vcall(dev[0], 3, au.Activate, guid('5CDF2C82-841E-4546-9722-0CF74078229A'), 0x17, null, vol) !== 0 || !vol[0]) return null;
    try { return fn(au, vol[0]); } finally { vcall(vol[0], 2, au.Release); }
  } finally {
    vcall(dev[0], 2, au.Release);
  }
}

// IAudioEndpointVolume 虚函数表：3 RegisterNotify, 4 Unregister, 5 GetChannelCount, 6 SetMasterVolumeLevel,
// 7 SetMasterVolumeLevelScalar, 8 GetMasterVolumeLevel, 9 GetMasterVolumeLevelScalar, ... 14 SetMute, 15 GetMute
function volume() {
  return withEndpoint((au, v) => {
    const level = [0], mute = [0];
    if (vcall(v, 9, au.GetLevel, level) !== 0) return null;
    vcall(v, 15, au.GetMute, mute);
    return { level: Math.round(level[0] * 100), muted: !!mute[0] };
  });
}

function setVolume(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return withEndpoint((au, v) => {
    vcall(v, 7, au.SetLevel, p / 100, null);
    if (p > 0) vcall(v, 14, au.SetMute, 0, null); // 与系统一致：调大音量时取消静音
    return true;
  });
}

function setMute(muted) {
  return withEndpoint((au, v) => vcall(v, 14, au.SetMute, muted ? 1 : 0, null) === 0);
}

// ---------- 亮度、网络（PowerShell） ----------
async function brightness() {
  const out = await ps.run('(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness', 8000);
  const n = parseInt(out, 10);
  return Number.isFinite(n) ? n : null;
}

function setBrightness(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return ps.run(`Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = ${p} } | Out-Null`, 8000);
}

async function network() {
  const r = await ps.json(`
    $adapters = @{}; Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | ForEach-Object { $adapters[[int]$_.ifIndex] = $_ }
    $list = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $adapters.ContainsKey([int]$_.InterfaceIndex) } | ForEach-Object {
      $ad = $adapters[[int]$_.InterfaceIndex]
      [pscustomobject]@{ name = $_.Name; wifi = ($ad.PhysicalMediaType -match '802\\.11' -or $ad.InterfaceDescription -match 'Wi-?Fi|Wireless|WLAN'); internet = ([string]$_.IPv4Connectivity -eq 'Internet' -or [string]$_.IPv6Connectivity -eq 'Internet') }
    })
    # 配置文件名可能带有“ 2”之类的后缀，WLAN 名称从 netsh 读取（netsh 使用 OEM 代码页输出）
    $ssid = ''
    if ($list | Where-Object wifi) {
      $enc = [Console]::OutputEncoding
      try {
        [Console]::OutputEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
        $m = (netsh wlan show interfaces) | Select-String -Pattern '^\\s*SSID\\s*:\\s*(.+?)\\s*$' | Select-Object -First 1
        if ($m) { $ssid = $m.Matches[0].Groups[1].Value }
      } catch { } finally { [Console]::OutputEncoding = $enc }
    }
    ConvertTo-Json -Compress -InputObject @{ list = $list; ssid = $ssid }`, 10000);
  if (!r || typeof r !== 'object') return [];
  const list = Array.isArray(r.list) ? r.list : r.list && typeof r.list === 'object' ? [r.list] : [];
  if (r.ssid) for (const n of list) if (n.wifi) n.name = r.ssid;
  return list;
}

// 通知区域图标注册表中的 ExecutablePath 可能以已知文件夹 GUID 开头
const KNOWN_FOLDERS = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files',
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': process.env.SystemRoot || 'C:\\Windows',
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64'),
};

function expandKnownFolder(p) {
  const m = /^(\{[0-9A-F-]{36}\})(.*)$/i.exec(p);
  if (!m) return p;
  const base = KNOWN_FOLDERS[m[1].toUpperCase()];
  return base ? path.join(base, m[2]) : p;
}

/** 注册过通知区域图标的程序：[{ path, tooltip, promoted }] */
async function trayRegistry() {
  const r = await ps.json(`
    $list = @(Get-ChildItem 'HKCU:\\Control Panel\\NotifyIconSettings' -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($p.ExecutablePath) { [pscustomobject]@{ path = [string]$p.ExecutablePath; tip = [string]$p.InitialTooltip; promoted = [int]$p.IsPromoted } }
    })
    ConvertTo-Json -Compress -InputObject $list`, 15000);
  const list = Array.isArray(r) ? r : r && typeof r === 'object' ? [r] : [];
  return list.map((e) => ({ path: expandKnownFolder(e.path), tooltip: e.tip || '', promoted: !!e.promoted }));
}

/** 读取程序的“文件说明”（用作显示名称） */
async function fileDescriptions(paths) {
  if (!paths.length) return {};
  const arr = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
  const r = await ps.json(`
    $o = @{}; foreach ($f in @(${arr})) { try { $o[$f] = [string](Get-Item -LiteralPath $f -ErrorAction Stop).VersionInfo.FileDescription } catch { $o[$f] = '' } }
    ConvertTo-Json -Compress -InputObject $o`, 15000);
  return r && typeof r === 'object' ? r : {};
}

// ---------- 播放音量峰值（IAudioMeterInformation） ----------
// 缓存默认播放设备的 meter，每 3 秒重新获取一次（用户可能切换了输出设备）
let meter = null, meterDev = null, meterAt = 0, peakProto = null;

function releaseMeter() {
  const au = audioApi();
  if (au && meter) vcall(meter, 2, au.Release);
  if (au && meterDev) vcall(meterDev, 2, au.Release);
  meter = meterDev = null;
}

/** 默认播放设备当前的峰值（0–1，已混音的所有声音）；不可用时返回 null */
function audioPeak() {
  const au = audioApi();
  if (!au) return null;
  const now = Date.now();
  if (!meter || now - meterAt > 3000) {
    releaseMeter();
    meterAt = now;
    const dev = [null];
    if (vcall(au.enumerator, 4, au.GetDefault, 0 /* eRender */, 1 /* eMultimedia */, dev) !== 0 || !dev[0]) return null;
    const m = [null];
    if (vcall(dev[0], 3, au.Activate, guid('C02216F6-8C67-4B5B-9D00-D008E73E0064'), 0x17, null, m) !== 0 || !m[0]) {
      vcall(dev[0], 2, au.Release);
      return null;
    }
    meterDev = dev[0];
    meter = m[0];
  }
  if (!peakProto) peakProto = koffi.proto('int __stdcall MCD_GetPeakValue(void *self, _Out_ float *peak)');
  const p = [0];
  // IAudioMeterInformation 虚函数表：3 GetPeakValue
  if (vcall(meter, 3, peakProto, p) !== 0) { releaseMeter(); return null; }
  return Math.max(0, Math.min(1, p[0]));
}

function dispose() {
  try { releaseMeter(); } catch { /* 退出时忽略 */ }
  ps.dispose();
}

module.exports = {
  available: () => !!load(),
  listWindows, activateWindow, minimizeWindow, closeWindow, winKey,
  runningProcesses,
  battery, volume, setVolume, setMute, audioPeak,
  brightness, setBrightness, network,
  trayRegistry, fileDescriptions,
  dispose,
};
