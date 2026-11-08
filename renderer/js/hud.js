// 快捷栏 HUD（Gui.renderItemHotbar）：两个窗口共用

export class HotbarHud {
  constructor() {
    this.hover = -1;
    this.labelText = '';
    this.labelStart = 0;
  }

  origin(g) {
    return { x: Math.floor(g.width / 2) - 91, y: g.height - 22 };
  }

  /** 鼠标所在的格子（每格 20×20），没有则返回 -1 */
  slotAt(g, mx, my) {
    const { x, y } = this.origin(g);
    if (my < y || my >= y + 22 || mx < x + 1 || mx >= x + 181) return -1;
    return Math.min(8, Math.floor((mx - x - 1) / 20));
  }

  /** 选中物品改变时，在快捷栏上方显示名称 2 秒（toolHighlightTimer = 40 tick） */
  showLabel(text) {
    this.labelText = text || '';
    this.labelStart = performance.now();
  }

  labelAlpha() {
    if (this.hover >= 0) return 255;
    const ticks = 40 - (performance.now() - this.labelStart) / 50;
    if (ticks <= 0) return 0;
    return Math.min(255, Math.floor((ticks * 256) / 10));
  }

  animating() {
    return this.hover < 0 && this.labelAlpha() > 0;
  }

  /**
   * icons: 9 个图标（或 null）；names: 9 个名称；selected: 当前选中格
   */
  render(g, icons, names, selected, { hoverHighlight = true } = {}) {
    const { x, y } = this.origin(g);
    g.sprite('hud/hotbar', x, y, 182, 22);
    g.sprite('hud/hotbar_selection', x - 1 + selected * 20, y - 1, 24, 23);
    for (let i = 0; i < 9; i++) {
      const ix = x + 3 + i * 20, iy = g.height - 19;
      if (icons[i]) g.item(icons[i], ix, iy);
      if (hoverHighlight && i === this.hover) g.slotHighlight(ix, iy);
    }
    // 物品名称（有生命值和饱食度，与生存模式相同位于 height - 59）
    const text = this.hover >= 0 ? names[this.hover] : this.labelText;
    const a = this.labelAlpha();
    if (text && a > 0) {
      const w = g.textWidth(text);
      g.text(text, Math.floor((g.width - w) / 2), g.height - 59, ((a & 0xff) << 24) | 0xffffff);
    }
  }
}
