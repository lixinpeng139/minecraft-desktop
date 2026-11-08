// 快捷栏（dock）窗口的几何计算。不依赖 Electron，方便单独验证。
//
// 隐藏任务栏时：dock 贴在屏幕底部，由 AppBar 为它预留空间，最大化窗口停在它上方。
// 任务栏可见时：dock 贴在“工作区”底部（也就是任务栏上方），不再预留空间——
//   最大化窗口会一直延伸到任务栏，把 dock 盖住（这种情况下由主进程在窗口压住时隐藏 dock）。
//
// 返回值里的 inset 是给桌面窗口用的：GUI 像素的底部偏移。桌面窗口把 GUI 高度减去它，
// 于是 HUD、快捷栏代画和各界面都会整体上移同样的距离，与 dock 窗口对齐。

const DOCK_WIDTH = 480; // GUI 像素：快捷栏窗口的宽度上限
const DOCK_HEIGHT = 64; // GUI 像素：22 像素的快捷栏 + 上方放物品名称的空间

function hotbarLayout({ bounds, workArea, scaleFactor, guiScale, hideTaskbar }) {
  const sf = scaleFactor;
  const screen = {
    x: Math.round(bounds.x * sf),
    y: Math.round(bounds.y * sf),
    w: Math.round(bounds.width * sf),
    h: Math.round(bounds.height * sf),
  };
  const work = {
    x: Math.round(workArea.x * sf),
    y: Math.round(workArea.y * sf),
    w: Math.round(workArea.width * sf),
    h: Math.round(workArea.height * sf),
  };

  // 屏幕底部到工作区底部的距离：任务栏在底部时就是任务栏高度
  const gap = hideTaskbar ? 0 : Math.max(0, screen.y + screen.h - (work.y + work.h));
  // 对齐到 GUI 像素，桌面窗口里的 HUD 才能和 dock 窗口落在同一位置
  const inset = hideTaskbar ? 0 : Math.ceil(gap / guiScale);
  const bottom = screen.y + screen.h - inset * guiScale;

  const availW = hideTaskbar ? screen.w : work.w;
  const w = Math.max(1, Math.min(availW, DOCK_WIDTH * guiScale, screen.w));
  const h = DOCK_HEIGHT * guiScale;

  let x = screen.x + Math.round((screen.w - w) / 2);
  // 任务栏在屏幕左右两侧时，把 dock 夹在工作区里，别被它盖住
  if (!hideTaskbar) x = Math.min(Math.max(x, work.x), work.x + work.w - w);

  return {
    inset,
    hotbar: {
      x: Math.round(x / sf),
      y: Math.round((bottom - h) / sf),
      width: Math.round(w / sf),
      height: Math.round(h / sf),
    },
  };
}

module.exports = { hotbarLayout, DOCK_WIDTH, DOCK_HEIGHT };
