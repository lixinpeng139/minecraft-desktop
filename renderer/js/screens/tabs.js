// 标签页设置：列表（增删、排序）与编辑界面（名称、图标）

import { Screen, ConfirmScreen } from './screen.js';
import { Widget, Button, EditBox } from '../widgets.js';
import { tr } from '../assets.js';
import { iconCatalog, itemIcon, tabIcon } from '../items.js';
import * as sound from '../sound.js';

const MAX_TABS = 12;

/** 物品的中文名（来自游戏语言文件） */
export function itemName(id) {
  const base = id.replace(/_\d\d$/, '').replace(/_16$/, '').replace(/_standby$/, '');
  for (const k of ['item.minecraft.' + base, 'block.minecraft.' + base]) {
    const t = tr(k);
    if (t !== k) return t;
  }
  return base;
}

/** 选择列表（AbstractSelectionList）：列表背景、分隔线、选中框、滚动条 */
export class SelectionList extends Widget {
  constructor(app, x, top, w, bottom, itemHeight, rowWidth) {
    super(x, top, w, bottom - top);
    Object.assign(this, { app, itemHeight, rowWidth });
    this.entries = [];
    this.selected = -1;
    this.scroll = 0;
    this.focusable = true;
    this.onSelect = null;
    this.onDouble = null;
    this.last = 0;
  }
  get contentHeight() { return this.entries.length * this.itemHeight + 4; }
  get maxScroll() { return Math.max(0, this.contentHeight - this.h + 4); }
  rowLeft() { return this.x + Math.floor(this.w / 2) - Math.floor(this.rowWidth / 2) + 2; }
  rowTop(i) { return this.y + 4 - Math.round(this.scroll) + i * this.itemHeight; }
  indexAt(mx, my) {
    if (my < this.y || my >= this.y + this.h) return -1;
    const l = this.x + Math.floor(this.w / 2) - Math.floor(this.rowWidth / 2);
    if (mx < l || mx >= l + this.rowWidth) return -1;
    const i = Math.floor((my - this.y - 4 + Math.round(this.scroll)) / this.itemHeight);
    return i >= 0 && i < this.entries.length ? i : -1;
  }
  renderWidget(g, mx, my) {
    this.app.renderListBackground(g, this.x, this.y, this.w, this.h, this.scroll);
    g.scissor(this.x, this.y, this.w, this.h, () => {
      this.entries.forEach((e, i) => {
        const top = this.rowTop(i);
        if (top + this.itemHeight < this.y || top > this.y + this.h) return;
        const h = this.itemHeight - 4;
        if (i === this.selected) {
          const l = this.x + Math.floor((this.w - this.rowWidth) / 2), r = l + this.rowWidth;
          g.fill(l, top - 2, r, top + h + 2, this.focused ? 0xffffffff : 0xff808080);
          g.fill(l + 1, top - 1, r - 1, top + h + 1, 0xff000000);
        }
        e.render(g, this.rowLeft(), top, this.rowWidth - 4, h, mx, my, this.indexAt(mx, my) === i);
      });
    });
    this.app.renderListSeparators(g, this.x, this.y, this.w, this.h);
    if (this.maxScroll > 0) {
      const sx = this.x + Math.floor(this.w / 2) + Math.floor(this.rowWidth / 2) + 4;
      const barH = Math.max(32, Math.floor((this.h * this.h) / this.contentHeight));
      g.sprite('widget/scroller_background', sx, this.y, 6, this.h);
      g.sprite('widget/scroller', sx, this.y + Math.floor(((this.h - barH) * this.scroll) / this.maxScroll), 6, barH);
    }
  }
  mouseClicked(mx, my, button) {
    const i = this.indexAt(mx, my);
    if (i < 0) return false;
    const now = performance.now();
    const dbl = i === this.selected && now - this.last < 300;
    this.last = now;
    this.selected = i;
    if (this.onSelect) this.onSelect(i);
    if (dbl && this.onDouble) this.onDouble(i);
    return true;
  }
  mouseScrolled(mx, my, dy) {
    if (my < this.y || my >= this.y + this.h || this.maxScroll <= 0) return false;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + dy * this.itemHeight / 2));
    return true;
  }
  keyPressed(e) {
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      const n = this.entries.length;
      if (!n) return true;
      this.selected = Math.max(0, Math.min(n - 1, this.selected + (e.code === 'ArrowUp' ? -1 : 1)));
      if (this.onSelect) this.onSelect(this.selected);
      return true;
    }
    if ((e.code === 'Enter' || e.code === 'Space') && this.selected >= 0 && this.onDouble) {
      this.onDouble(this.selected);
      return true;
    }
    return false;
  }
}

export class TabsScreen extends Screen {
  constructor() { super('标签页设置'); this.selected = -1; }

  build() {
    const app = this.app;
    const cx = Math.floor(this.width / 2);
    const prev = this.list;
    this.list = this.add(new SelectionList(app, 0, 33, this.width, this.height - 64, 36, 270));
    if (prev) this.list.scroll = prev.scroll;
    this.list.onSelect = (i) => { this.selected = i; this.updateButtons(); };
    this.list.onDouble = (i) => this.edit(i);
    this.refresh();
    this.editBtn = this.add(new Button(cx - 154, this.height - 52, 150, 20, '编辑标签页', () => this.edit(this.selected)));
    this.addBtn = this.add(new Button(cx + 4, this.height - 52, 150, 20, '添加标签页', () => app.setScreen(new TabEditScreen(null), this)));
    this.delBtn = this.add(new Button(cx - 154, this.height - 28, 72, 20, tr('selectWorld.delete'), () => this.remove()));
    this.upBtn = this.add(new Button(cx - 76, this.height - 28, 72, 20, '上移', () => this.move(-1)));
    this.downBtn = this.add(new Button(cx + 4, this.height - 28, 72, 20, '下移', () => this.move(1)));
    this.add(new Button(cx + 82, this.height - 28, 72, 20, tr('gui.done'), () => this.onClose()));
    this.updateButtons();
  }

  refresh() {
    const tabs = this.app.config.tabs;
    this.list.entries = tabs.map((t, i) => ({
      render: (g, x, y, w, h, mx, my) => {
        g.push();
        g.translate(x, y);
        g.ctx.scale(2, 2);
        g.item(tabIcon(t.icon), 0, 0);
        g.pop();
        g.text(t.name, x + 35, y + 1, 0xffffff);
        g.text(`${t.items.length} 个物品`, x + 35, y + 12, 0x808080);
        g.text(i < 6 ? `上排第 ${i + 1} 个` : `下排第 ${i - 5} 个`, x + 35, y + 21, 0x808080);
      },
    }));
    if (this.selected >= tabs.length) this.selected = tabs.length - 1;
    this.list.selected = this.selected;
  }

  updateButtons() {
    const n = this.app.config.tabs.length;
    const has = this.selected >= 0 && this.selected < n;
    this.editBtn.active = has;
    this.delBtn.active = has;
    this.upBtn.active = has && this.selected > 0;
    this.downBtn.active = has && this.selected < n - 1;
    this.addBtn.active = n < MAX_TABS;
    this.addBtn.tooltip = n >= MAX_TABS ? ['最多只能有 ' + MAX_TABS + ' 个自定义标签页'] : null;
  }

  edit(i) {
    const t = this.app.config.tabs[i];
    if (t) this.app.setScreen(new TabEditScreen(t), this);
  }

  move(d) {
    const tabs = [...this.app.config.tabs];
    const i = this.selected, j = i + d;
    if (i < 0 || j < 0 || j >= tabs.length) return;
    [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
    this.selected = j;
    this.app.patch({ tabs });
    this.refresh();
    this.updateButtons();
  }

  remove() {
    const t = this.app.config.tabs[this.selected];
    if (!t) return;
    this.app.setScreen(new ConfirmScreen((ok) => {
      if (ok) this.app.patch({ tabs: this.app.config.tabs.filter((x) => x.id !== t.id) });
      this.app.setScreen(this);
    }, '你确定要删除这个标签页吗？', `“${t.name}”将会永久消失！（真的很久！）\n标签页里的文件不会被删除。`, tr('selectWorld.delete'), tr('gui.cancel')), this.parent);
  }

  render(g, mx, my, dt) {
    this.refresh();
    this.updateButtons();
    super.render(g, mx, my, dt);
  }

  renderContent(g) {
    g.centered(this.title, Math.floor(this.width / 2), 12, 0xffffff);
  }
}

/** 编辑标签页：名称 + 图标 */
export class TabEditScreen extends Screen {
  constructor(tab) {
    super(tab ? '编辑标签页' : '新建标签页');
    this.tab = tab;
    this.icon = tab ? { ...tab.icon } : { type: 'item', id: 'chest' };
    this.name = tab ? tab.name : '';
    this.scroll = 0;
    this.icons = null;
  }

  build() {
    const app = this.app;
    const cx = Math.floor(this.width / 2);
    this.icons = iconCatalog();
    this.nameBox = this.add(new EditBox(cx - 100, 46, 200, 20, { maxLength: 24, focusKey: 'name', hint: '标签页名称' }));
    this.nameBox.setValue(this.name);
    this.nameBox.onChange = (v) => { this.name = v; this.updateButtons(); };
    // 图标网格
    this.cols = 9;
    this.gridX = cx - Math.floor((this.cols * 18) / 2);
    this.gridY = 100;
    this.visibleRows = Math.max(2, Math.min(6, Math.floor((this.height - 60 - this.gridY - 7) / 18)));
    this.add(new Button(cx - 100, this.height - 52, 200, 20, '从图片文件选择…', async () => {
      const p = await app.withDialog(() => window.mcd.pickImage());
      if (!p) return;
      const data = await window.mcd.readImage(p);
      if (data) {
        this.icon = { type: 'image', data: await shrink(data) };
        sound.pop();
      }
    }));
    this.done = this.add(new Button(cx - 100, this.height - 28, 98, 20, tr('gui.done'), () => this.save()));
    this.add(new Button(cx + 2, this.height - 28, 98, 20, tr('gui.cancel'), () => this.onClose()));
    this.setFocus(this.nameBox);
    this.updateButtons();
  }

  updateButtons() {
    if (this.done) this.done.active = this.name.trim().length > 0;
  }

  save() {
    const name = this.name.trim();
    if (!name) return;
    let tabs = this.app.config.tabs;
    if (this.tab) {
      tabs = tabs.map((t) => (t.id === this.tab.id ? { ...t, name, icon: this.icon } : t));
    } else {
      tabs = [...tabs, { id: 'tab_' + Date.now().toString(36), name, icon: this.icon, items: [] }];
      this.app.grant('new_tab');
    }
    this.app.patch({ tabs });
    this.onClose();
  }

  get rows() { return Math.ceil(this.icons.length / this.cols); }
  get maxScroll() { return Math.max(0, this.rows - this.visibleRows); }

  iconAt(mx, my) {
    const c = Math.floor((mx - this.gridX) / 18), r = Math.floor((my - this.gridY) / 18);
    if (mx < this.gridX || my < this.gridY || c >= this.cols || r >= this.visibleRows) return -1;
    const i = (r + this.scroll) * this.cols + c;
    return i < this.icons.length ? i : -1;
  }

  renderContent(g, mx, my) {
    const cx = Math.floor(this.width / 2);
    g.centered(this.title, cx, 15, 0xffffff);
    g.text('名称', cx - 100, 35, 0xa0a0a0);
    g.text('图标', this.gridX - 7, this.gridY - 19, 0xa0a0a0);
    // 预览：创造模式标签页的样子
    g.sprite('container/creative_inventory/tab_top_selected_2', cx + 106, 40, 26, 32);
    g.item(tabIcon(this.icon), cx + 111, 49);
    // 图标网格（物品栏面板 + 槽位）
    const pw = this.cols * 18 + 14, ph = this.visibleRows * 18 + 14;
    g.panel(this.gridX - 7, this.gridY - 7, pw, ph);
    const hovered = this.iconAt(mx, my);
    for (let r = 0; r < this.visibleRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.gridX + c * 18, y = this.gridY + r * 18;
        g.sprite('container/slot', x, y, 18, 18);
        const i = (r + this.scroll) * this.cols + c;
        const id = this.icons[i];
        if (!id) continue;
        if (this.icon.type === 'item' && this.icon.id === id) {
          g.fill(x, y, x + 18, y + 18, 0xff55ff55);
          g.fill(x + 1, y + 1, x + 17, y + 17, 0xff8b8b8b);
        }
        g.item(itemIcon(id), x + 1, y + 1);
        if (i === hovered) g.slotHighlight(x + 1, y + 1);
      }
    }
    if (this.maxScroll > 0) {
      const sx = this.gridX + this.cols * 18 + 2;
      const h = this.visibleRows * 18;
      const bar = Math.max(15, Math.floor((h * this.visibleRows) / this.rows));
      g.sprite('widget/scroller_background', sx, this.gridY, 6, h);
      g.sprite('widget/scroller', sx, this.gridY + Math.floor(((h - bar) * this.scroll) / this.maxScroll), 6, bar);
    }
    this.hoverName = hovered >= 0 ? itemName(this.icons[hovered]) : null;
  }

  renderOverlay(g, mx, my) {
    if (this.hoverName) g.tooltip([this.hoverName], mx, my);
  }

  mouseClicked(mx, my, button) {
    const i = this.iconAt(mx, my);
    if (i >= 0) {
      this.icon = { type: 'item', id: this.icons[i] };
      sound.click();
      return true;
    }
    return super.mouseClicked(mx, my, button);
  }

  mouseScrolled(mx, my, dy) {
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + Math.sign(dy)));
    return true;
  }

  keyPressed(e) {
    if (e.code === 'Enter' && this.focusedWidget === this.nameBox) { this.save(); return true; }
    return super.keyPressed(e);
  }
}

/** 把任意图片缩成 16×16 的像素图标 */
async function shrink(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const cx = c.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  const k = Math.min(16 / img.width, 16 / img.height);
  cx.drawImage(img, (16 - img.width * k) / 2, (16 - img.height * k) / 2, img.width * k, img.height * k);
  return c.toDataURL('image/png');
}
