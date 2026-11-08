// 统计信息（StatsScreen）

import { Screen } from './screen.js';
import { Button } from '../widgets.js';
import { tr } from '../assets.js';

function formatTime(sec) {
  // StatFormatter.TIME
  const d = sec / 86400, h = sec / 3600, m = sec / 60;
  const f = (v) => (Math.round(v * 100) / 100).toString();
  if (d > 0.5) return f(d) + ' d';
  if (h > 0.5) return f(h) + ' h';
  if (m > 0.5) return f(m) + ' min';
  return f(sec) + ' s';
}

export class StatsScreen extends Screen {
  constructor() { super(tr('gui.stats')); this.page = 'general'; this.scroll = 0; }

  build() {
    const cx = Math.floor(this.width / 2);
    this.top = 32;
    this.bottom = this.height - 64;
    this.general = this.add(new Button(cx - 120 - 4 - 60 + 2, this.height - 52, 120, 20, tr('stat.generalButton'), () => { this.page = 'general'; this.scroll = 0; }));
    this.items = this.add(new Button(cx - 60, this.height - 52, 120, 20, tr('stat.itemsButton'), () => { this.page = 'items'; this.scroll = 0; }));
    this.mobs = this.add(new Button(cx + 60 + 4 - 2, this.height - 52, 120, 20, tr('stat.mobsButton'), () => {}, { active: false }));
    this.add(new Button(cx - 100, this.height - 28, 200, 20, tr('gui.done'), () => this.onClose()));
  }

  rows() {
    const c = this.app.config;
    const s = c.stats;
    if (this.page === 'general') {
      const launches = Object.values(s.launches || {}).reduce((a, b) => a + b, 0);
      return [
        [tr('stat.minecraft.play_time'), formatTime(s.playTime || 0)],
        ['打开物品栏次数', s.inventoryOpened || 0],
        ['搜索物品次数', s.searches || 0],
        ['启动程序次数', launches],
        ['从快捷栏启动', s.launchesFromHotbar || 0],
        ['从物品栏启动', s.launchesFromInventory || 0],
        ['放入快捷栏的物品', s.itemsPlaced || 0],
        ['扔出的物品', s.itemsDropped || 0],
        ['桌面物品数量', this.app.items.length],
        ['自定义标签页', c.tabs.length],
        ['已获得的进度', Object.keys(c.advancements || {}).length],
      ];
    }
    return Object.entries(s.launches || {}).sort((a, b) => b[1] - a[1]);
  }

  renderBackground(g) {
    super.renderBackground(g);
  }

  renderContent(g, mx, my) {
    this.general.active = this.page !== 'general';
    this.items.active = this.page !== 'items';
    const cx = Math.floor(this.width / 2);
    g.centered(this.title, cx, 20 - 8, 0xffffff);
    const h = this.bottom - this.top;
    this.app.renderListBackground(g, 0, this.top, this.width, h, this.scroll);
    const rows = this.rows();
    const left = cx - 110;
    g.scissor(0, this.top, this.width, h, () => {
      if (this.page === 'general') {
        rows.forEach(([name, value], i) => {
          const y = this.top + 4 + i * 10 - this.scroll;
          const color = i % 2 === 0 ? 0xffffff : 0x909090;
          g.text(name, left + 2, y + 1, color);
          const v = String(value);
          g.text(v, left + 2 + 213 - g.textWidth(v), y + 1, color);
        });
      } else {
        if (!rows.length) g.centered('还没有启动过任何物品', cx, this.top + 20, 0x808080);
        // 表头
        rows.forEach(([path, count], i) => {
          const y = this.top + 4 + i * 20 - this.scroll;
          const item = this.app.itemInfo(path);
          g.sprite('container/slot', left, y, 18, 18);
          g.item(this.app.itemIcon(item), left + 1, y + 1);
          const name = g.font.substrByWidth(item.name, 150);
          g.text(name, left + 22, y + 5, i % 2 === 0 ? 0xffffff : 0x909090);
          const v = String(count);
          g.text(v, left + 2 + 213 - g.textWidth(v), y + 5, i % 2 === 0 ? 0xffffff : 0x909090);
        });
      }
    });
    this.app.renderListSeparators(g, 0, this.top, this.width, h);
    this.contentH = this.page === 'general' ? rows.length * 10 + 8 : rows.length * 20 + 8;
  }

  mouseScrolled(mx, my, dy) {
    const max = Math.max(0, (this.contentH || 0) - (this.bottom - this.top));
    this.scroll = Math.max(0, Math.min(max, this.scroll + dy * 10));
    return true;
  }
}
