// 收款码海报（由 export-donate-qr.js 在隐藏窗口中调用）：180×270 GUI 像素，放大 6 倍输出 1080×1620

import * as assets from '../renderer/js/assets.js';
import { font } from '../renderer/js/font.js';
import { Gfx } from '../renderer/js/gfx.js';
import { DONATE_CODES, qrSpan, drawQr, loadQrTextures } from '../renderer/js/qr-art.js';

const W = 180, H = 270, S = 6;

async function poster(code) {
  await Promise.all([loadQrTextures(code), assets.loadTex('block/dirt'), assets.loadTex('gui/demo_background'), assets.loadTex(code.icon)]);
  const canvas = document.createElement('canvas');
  const g = new Gfx(canvas);
  g.resize(W * S, H * S, S);
  g.begin();
  // 旧版选项界面的泥土背景
  g.tileTexture('block/dirt', 0, 0, W, H, 32, 32);
  g.fill(0, 0, W, H, 0xbf000000);

  const cx = W / 2;
  const lw = 18 + font.width(code.name);
  g.blit(assets.tex(code.icon), cx - lw / 2, 10, 0, 0, 16, 16, 16, 16);
  g.text(code.name, cx - lw / 2 + 18, 14, 0xffffff);
  g.centered('请作者喝杯奶茶', cx, 32, 0xaaaaaa);

  const px = 10, py = 46, pw = W - 20;
  g.panel(px, py, pw, pw);
  const span = qrSpan(code);
  const m = Math.floor(((pw - 12) * S) / span);
  const size = (span * m) / S;
  drawQr(g, code, px + (pw - size) / 2, py + (pw - size) / 2, m);

  g.centered(code.hint, cx, py + pw + 8, 0xffffff);
  g.centered('感谢你的支持！', cx, py + pw + 26, 0xffff55);
  g.centered('Minecraft 桌面', cx, H - 16, 0x808080);
  return canvas.toDataURL('image/png');
}

window.makePosters = async () => {
  await assets.init();
  await font.load();
  const out = [];
  for (const code of DONATE_CODES) out.push({ id: code.id, name: code.name, data: await poster(code) });
  return out;
};
