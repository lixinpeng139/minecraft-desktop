// 赞赏作者：一段感谢的话 + 支付宝 / 微信两张方块风收款码

import { HeaderFooterScreen } from './screen.js';
import { tex } from '../assets.js';
import { font } from '../font.js';
import { DONATE_CODES, qrSpan, drawQr } from '../qr-art.js';

const MESSAGE = [
  { text: '感谢你使用 Minecraft 桌面！', color: 0xffff55 },
  '这个小工具是我在业余时间一个方块一个方块搭起来的。如果它让你的桌面变得更有趣，欢迎请我喝杯奶茶，或者送我几颗钻石。',
  { text: '赞赏完全自愿，不会影响任何功能。你的每一份支持都会变成下一次更新的动力。', color: 0xaaaaaa },
];

const LABEL = 22; // 卡片顶部：图标 + 名称
const HINT = 18; // 卡片底部：提示文字
const PAD = 6;
const GAP = 16;
const MAX_QR = 160; // 二维码最大边长（GUI 像素）

export class DonateScreen extends HeaderFooterScreen {
  constructor() { super('赞赏作者'); }

  build() {
    const w = Math.min(this.width - 40, 360);
    this.lines = MESSAGE.flatMap((l) => {
      const { text, color } = typeof l === 'string' ? { text: l, color: 0xffffff } : l;
      return font.split(text, w).map((t) => ({ text: t, color }));
    });
    this.addDone();
  }

  renderContent(g) {
    super.renderContent(g);
    const cx = Math.floor(this.width / 2);
    let y = this.headerHeight + 4;
    for (const l of this.lines) { g.centered(l.text, cx, y, l.color); y += 11; }

    const top = y + 6, bottom = this.height - this.footerHeight - 4;
    const textW = Math.max(...DONATE_CODES.map((c) => Math.max(font.width(c.hint), 18 + font.width(c.name))));
    const box = Math.max(32, Math.min(MAX_QR, bottom - top - LABEL - HINT, Math.floor((this.width - 20 - GAP) / 2) - PAD * 2));
    const cw = Math.max(box, textW) + PAD * 2, ch = LABEL + box + HINT;
    const left = cx - cw - Math.floor(GAP / 2);
    DONATE_CODES.forEach((code, i) => this.renderCard(g, code, left + i * (cw + GAP), top, cw, ch, box));
  }

  renderCard(g, code, x, y, w, h, box) {
    g.panel(x, y, w, h);
    const lw = 18 + font.width(code.name);
    const lx = x + Math.floor((w - lw) / 2);
    g.blit(tex(code.icon), lx, y + 4, 0, 0, 16, 16, 16, 16);
    g.text(code.name, lx + 18, y + 8, 0x404040, false);
    // 每个模块取整数个设备像素，二维码在 box×box 区域内居中
    const span = qrSpan(code);
    const m = Math.max(1, Math.floor((box * g.scale) / span));
    const size = (span * m) / g.scale;
    drawQr(g, code, x + (w - size) / 2, y + LABEL + (box - size) / 2, m);
    g.centered(code.hint, x + Math.floor(w / 2), y + LABEL + box + 4, 0x404040, false);
  }
}
