// 进度（AdvancementsScreen）：窗口 252×140，内部 234×113，石头背景，节点之间用线连接

import { Screen } from './screen.js';
import { tr, tex, sprite } from '../assets.js';
import { itemIcon } from '../items.js';
import { font } from '../font.js';

export const ADVANCEMENTS = [
  { id: 'root', parent: null, x: 0, y: 2, icon: 'grass_block', frame: 'task', title: 'Minecraft 桌面', desc: '欢迎来到方块桌面' },
  { id: 'open_inventory', parent: 'root', x: 1.5, y: 0.6, icon: 'chest', frame: 'task', title: '拿起你的物品栏', desc: '按下 E 打开物品栏' },
  { id: 'search', parent: 'open_inventory', x: 3, y: 0.6, icon: 'compass', frame: 'task', title: '大海捞针', desc: '使用“搜索物品”' },
  { id: 'hotbar_place', parent: 'root', x: 1.5, y: 2, icon: 'iron_pickaxe', frame: 'task', title: '整装待发', desc: '把一个物品放进快捷栏' },
  { id: 'launch_hotbar', parent: 'hotbar_place', x: 3, y: 2, icon: 'crafting_table', frame: 'task', title: '开工！', desc: '从快捷栏启动一个程序' },
  { id: 'launch_100', parent: 'launch_hotbar', x: 4.5, y: 2, icon: 'diamond_pickaxe', frame: 'goal', title: '勤劳的矿工', desc: '从快捷栏启动程序 100 次' },
  { id: 'new_tab', parent: 'root', x: 1.5, y: 3.4, icon: 'writable_book', frame: 'task', title: '分门别类', desc: '新建一个标签页' },
  { id: 'decorate', parent: 'new_tab', x: 3, y: 3.4, icon: 'painting', frame: 'task', title: '室内装潢', desc: '更换桌面背景' },
  { id: 'play_100h', parent: 'launch_100', x: 6, y: 2, icon: 'clock', frame: 'challenge', title: '时间管理大师', desc: '累计使用 Minecraft 桌面 100 小时' },
];

const WIDTH = 252, HEIGHT = 140;

export class AdvancementsScreen extends Screen {
  constructor() {
    super(tr('gui.advancements'));
    this.scrollX = 0;
    this.scrollY = 0;
    this.fade = 0;
    this.dragging = false;
  }

  get done() { return this.app.config.advancements || {}; }
  obtained(a) { return a.id === 'root' || !!this.done[a.id]; }

  build() {
    this.wx = Math.floor((this.width - WIDTH) / 2);
    this.wy = Math.floor((this.height - HEIGHT) / 2);
    // 让整棵树居中
    const xs = ADVANCEMENTS.map((a) => a.x * 28), ys = ADVANCEMENTS.map((a) => a.y * 27);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + 26, minY = Math.min(...ys), maxY = Math.max(...ys) + 26;
    this.scrollX = Math.floor(117 - (maxX + minX) / 2);
    this.scrollY = Math.floor(56 - (maxY + minY) / 2);
  }

  pos(a) {
    return [this.wx + 9 + this.scrollX + Math.floor(a.x * 28), this.wy + 18 + this.scrollY + Math.floor(a.y * 27)];
  }

  render(g, mx, my, dt) {
    this.renderBackground(g);
    const { wx, wy } = this;
    // 内部背景（石头纹理平铺）
    g.scissor(wx + 9, wy + 18, 234, 113, () => {
      const stone = tex('gui/advancements/backgrounds/stone');
      if (stone) {
        const ox = ((this.scrollX % 16) + 16) % 16, oy = ((this.scrollY % 16) + 16) % 16;
        for (let y = -16; y < 113 + 16; y += 16) for (let x = -16; x < 234 + 16; x += 16) g.ctx.drawImage(stone, wx + 9 + x + ox, wy + 18 + y + oy, 16, 16);
      }
      this.renderConnections(g, true);
      this.renderConnections(g, false);
      for (const a of ADVANCEMENTS) {
        const [x, y] = this.pos(a);
        g.sprite(`advancements/${a.frame}_frame_${this.obtained(a) ? 'obtained' : 'unobtained'}`, x, y, 26, 26);
        g.item(itemIcon(a.icon), x + 5, y + 5);
      }
    });
    // 悬停：变暗 + 标题框
    const hovered = this.hoveredAdvancement(mx, my);
    this.fade = hovered ? Math.min(0.3, this.fade + 0.02 * dt * 3) : Math.max(0, this.fade - 0.04 * dt * 3);
    if (this.fade > 0) g.fill(wx + 9, wy + 18, wx + 9 + 234, wy + 18 + 113, Math.floor(this.fade * 255) << 24);
    if (hovered) this.renderHover(g, hovered);
    g.blit(tex('gui/advancements/window'), wx, wy, 0, 0, WIDTH, HEIGHT, 256, 256);
    g.text('Minecraft 桌面', wx + 8, wy + 6, 0x404040, false);
    for (const w of this.widgets) w.render(g, mx, my);
  }

  renderConnections(g, outline) {
    for (const a of ADVANCEMENTS) {
      if (!a.parent) continue;
      const p = ADVANCEMENTS.find((x) => x.id === a.parent);
      const [px, py] = this.pos(p), [cx, cy] = this.pos(a);
      const x1 = px + 26, y1 = py + 13, x2 = cx - 1, y2 = cy + 13;
      const mid = x1 + Math.floor((x2 - x1) / 2);
      const color = outline ? 0xff000000 : 0xffffffff;
      if (outline) {
        g.hLine(mid, x1, y1 - 1, color); g.hLine(mid + 1, x1, y1, color); g.hLine(mid, x1, y1 + 1, color);
        g.hLine(x2, mid - 1, y2 - 1, color); g.hLine(x2, mid - 1, y2, color); g.hLine(x2, mid - 1, y2 + 1, color);
        g.vLine(mid - 1, y2, y1, color); g.vLine(mid + 1, y2, y1, color);
      } else {
        g.hLine(mid, x1, y1, color);
        g.hLine(x2, mid, y2, color);
        g.vLine(mid, y2, y1, color);
      }
    }
  }

  hoveredAdvancement(mx, my) {
    if (mx < this.wx + 9 || my < this.wy + 18 || mx >= this.wx + 243 || my >= this.wy + 131) return null;
    return ADVANCEMENTS.find((a) => {
      const [x, y] = this.pos(a);
      return mx >= x && mx < x + 22 && my >= y && my < y + 26;
    }) || null;
  }

  renderHover(g, a) {
    const [x, y] = this.pos(a);
    const obtained = this.obtained(a);
    const titleW = font.width(a.title);
    const desc = font.split(a.desc, Math.max(titleW + 8, 140));
    let w = 29 + titleW + 8;
    for (const l of desc) w = Math.max(w, font.width(l) + 8 + 3);
    const right = x + w > this.wx + 9 + 234; // 太靠右时向左展开
    const bx = right ? x + 26 - w : x;
    const below = y + 26 + desc.length * 9 + 10 < this.wy + 18 + 113;
    const descH = desc.length * 9 + 10;
    if (below) g.sprite('advancements/title_box', bx, y + 16, w, descH + 10);
    else g.sprite('advancements/title_box', bx, y - descH, w, descH + 10);
    // 标题条：取贴图左半与右端拼接（与 AdvancementWidget 相同的做法）
    const box = sprite(obtained ? 'advancements/box_obtained' : 'advancements/box_unobtained');
    if (box) {
      const left = Math.floor(w / 2), rightW = w - left;
      g.ctx.drawImage(box, 0, 0, left, 26, bx, y, left, 26);
      g.ctx.drawImage(box, 200 - rightW, 0, rightW, 26, bx + left, y, rightW, 26);
    }
    g.sprite(`advancements/${a.frame}_frame_${obtained ? 'obtained' : 'unobtained'}`, x, y, 26, 26);
    g.item(itemIcon(a.icon), x + 5, y + 5);
    g.text(a.title, right ? bx + 5 : x + 32, y + 9, 0xffffff);
    const color = a.frame === 'challenge' ? 0xaa00aa : 0x55ff55;
    desc.forEach((l, i) => g.text(l, bx + 5, below ? y + 26 + 5 + i * 9 : y - descH + 5 + i * 9, color, false));
  }

  onClose() { this.app.setScreen(this.parent); }
}
