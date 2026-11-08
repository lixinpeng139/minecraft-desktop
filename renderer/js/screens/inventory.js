// 创造模式物品栏（CreativeModeInventoryScreen）：标签页 + 9×5 物品网格 + 快捷栏
// 桌面上的文件和快捷方式就是这里的“物品”。

import { Screen } from './screen.js';
import { EditBox } from '../widgets.js';
import { tex, tr } from '../assets.js';
import { itemIcon, tabIcon } from '../items.js';
import * as sound from '../sound.js';

const IW = 195, IH = 136;
const ROWS = 5, COLS = 9;
const ALL_TAB_NAME = '所有物品';

export class InventoryScreen extends Screen {
  constructor(startTab) {
    super('');
    this.tabId = startTab || 'all';
    this.scrollOffs = 0;
    this.carried = null;
    this.search = new EditBox(0, 0, 80, 9, { bordered: false, textColor: 0xffffff, maxLength: 50, focusKey: 'search' });
    this.search.onChange = () => { this.scrollOffs = 0; this.searched = true; };
    this.lastClick = null;
  }

  get blurBackground() { return false; }

  build() {
    this.leftPos = Math.floor((this.width - IW) / 2);
    this.topPos = Math.floor((this.height - IH) / 2);
    this.search.x = this.leftPos + 82;
    this.search.y = this.topPos + 6;
    this.search.input = (box, f) => this.app.textInput(box, f);
    if (!this.tabs().some((t) => t.id === this.tabId)) this.tabId = 'all';
    if (this.tabId === 'search') this.setFocus(this.search);
  }

  // ---------- 标签页 ----------
  tabs() {
    const custom = this.app.config.tabs.slice(0, 12).map((t, i) => ({
      id: t.id, custom: t, name: t.name, icon: tabIcon(t.icon),
      top: i < 6, col: i % 6, right: i % 6 === 5,
    }));
    return [
      ...custom,
      { id: 'search', type: 'search', name: tr('itemGroup.search'), icon: itemIcon('compass'), top: true, col: 6, right: true },
      { id: 'all', type: 'all', name: ALL_TAB_NAME, icon: itemIcon('chest'), top: false, col: 6, right: true },
    ];
  }

  get tab() {
    const tabs = this.tabs();
    return tabs.find((t) => t.id === this.tabId) || tabs[tabs.length - 1];
  }

  tabX(t) { return t.right ? IW - 27 * (7 - t.col) + 1 : 27 * t.col; }
  tabY(t) { return t.top ? -32 : IH; }

  tabAt(mx, my) {
    const rx = mx - this.leftPos, ry = my - this.topPos;
    return this.tabs().find((t) => {
      const x = this.tabX(t) + 3, y = this.tabY(t) + 3;
      return rx >= x && rx < x + 21 && ry >= y && ry < y + 27;
    }) || null;
  }

  renderTab(g, t, selected) {
    const x = this.leftPos + this.tabX(t);
    const y = this.topPos - (t.top ? 28 : -(IH - 4));
    const name = `container/creative_inventory/tab_${t.top ? 'top' : 'bottom'}_${selected ? 'selected' : 'unselected'}_${Math.min(Math.max(t.col, 0), 6) + 1}`;
    g.sprite(name, x, y, 26, 32);
    g.item(t.icon, x + 5, y + 8 + (t.top ? 1 : -1));
  }

  selectTab(id) {
    if (id === this.tabId) return;
    this.tabId = id;
    this.scrollOffs = 0;
    if (id === 'search') {
      this.setFocus(this.search);
    } else {
      this.setFocus(null);
    }
    this.app.patch({ lastTab: id });
  }

  // ---------- 物品 ----------
  allItems() {
    const list = [...this.app.items];
    const seen = new Set(list.map((i) => i.path));
    for (const t of this.app.config.tabs) {
      for (const p of t.items) {
        if (seen.has(p)) continue;
        seen.add(p);
        list.push(this.app.itemInfo(p));
      }
    }
    return list;
  }

  currentItems() {
    const t = this.tab;
    if (t.type === 'all') return this.app.items;
    if (t.type === 'search') {
      const q = this.search.value.trim().toLowerCase();
      const all = this.allItems();
      if (!q) return all;
      return all.filter((i) => i.name.toLowerCase().includes(q) || (i.path || '').toLowerCase().includes(q));
    }
    return t.custom.items.map((p) => this.app.itemInfo(p));
  }

  extraRows(items) {
    return Math.max(0, Math.ceil(items.length / COLS) - ROWS);
  }

  rowOffset(items) {
    const extra = this.extraRows(items);
    return extra > 0 ? Math.floor(this.scrollOffs * extra + 0.5) : 0;
  }

  /** 鼠标下的槽位：{type:'grid'|'hotbar', index, x, y, item} */
  slotAt(mx, my, items = this.currentItems()) {
    const off = this.rowOffset(items);
    const hit = (x, y) => mx >= x - 1 && mx < x + 17 && my >= y - 1 && my < y + 17;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = this.leftPos + 9 + c * 18, y = this.topPos + 18 + r * 18;
        if (hit(x, y)) {
          const index = (off + r) * COLS + c;
          return { type: 'grid', index, x, y, item: items[index] || null, key: 'g' + index };
        }
      }
    }
    for (let c = 0; c < 9; c++) {
      const x = this.leftPos + 9 + c * 18, y = this.topPos + 112;
      if (hit(x, y)) {
        const p = this.app.config.hotbar[c];
        return { type: 'hotbar', index: c, x, y, item: p ? this.app.itemInfo(p) : null, key: 'h' + c };
      }
    }
    return null;
  }

  insideScrollbar(mx, my) {
    const x = this.leftPos + 175, y = this.topPos + 18;
    return mx >= x && my >= y && mx < x + 14 && my < y + 112;
  }

  insidePanel(mx, my) {
    return mx >= this.leftPos && my >= this.topPos && mx < this.leftPos + IW && my < this.topPos + IH;
  }

  // ---------- 绘制 ----------
  render(g, mx, my) {
    g.fillGradient(0, 0, this.width, this.height, 0xc0101010, 0xd0101010);
    const tabs = this.tabs();
    const sel = this.tab;
    for (const t of tabs) if (t !== sel) this.renderTab(g, t, false);
    const bg = sel.type === 'search' ? 'gui/container/creative_inventory/tab_item_search' : 'gui/container/creative_inventory/tab_items';
    g.blit(tex(bg), this.leftPos, this.topPos, 0, 0, IW, IH, 256, 256);
    if (sel.type === 'search') this.search.render(g, mx, my);

    const items = this.currentItems();
    const canScroll = this.extraRows(items) > 0;
    g.sprite(canScroll ? 'container/creative_inventory/scroller' : 'container/creative_inventory/scroller_disabled',
      this.leftPos + 175, this.topPos + 18 + Math.floor((112 - 17) * this.scrollOffs), 12, 15);
    this.renderTab(g, sel, true);

    const off = this.rowOffset(items);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const it = items[(off + r) * COLS + c];
        if (it) g.item(this.app.itemIcon(it), this.leftPos + 9 + c * 18, this.topPos + 18 + r * 18);
      }
    }
    const hotbar = this.app.config.hotbar;
    for (let c = 0; c < 9; c++) {
      if (hotbar[c]) g.item(this.app.itemIcon(this.app.itemInfo(hotbar[c])), this.leftPos + 9 + c * 18, this.topPos + 112);
    }
    const hovered = this.slotAt(mx, my, items);
    if (hovered) g.slotHighlight(hovered.x, hovered.y);

    g.text(sel.name, this.leftPos + 8, this.topPos + 6, 0x404040, false);

    if (this.carried) g.item(this.app.itemIcon(this.carried.item), mx - 8, my - 8);

    if (!this.carried && hovered && hovered.item) {
      g.tooltip(this.app.itemTooltip(hovered.item), mx, my);
    } else {
      const t = this.tabAt(mx, my);
      if (t) g.tooltip([t.name], mx, my);
    }
  }

  // ---------- 交互 ----------
  setHotbar(index, path) {
    const hotbar = [...this.app.config.hotbar];
    hotbar[index] = path;
    this.app.patch({ hotbar });
  }

  addToTab(tab, path) {
    if (!tab || !path) return;
    const tabs = this.app.config.tabs.map((t) => (t.id === tab.id && !t.items.includes(path) ? { ...t, items: [...t.items, path] } : t));
    this.app.patch({ tabs });
    sound.pop();
  }

  removeFromTab(tabId, path) {
    const tabs = this.app.config.tabs.map((t) => (t.id === tabId ? { ...t, items: t.items.filter((p) => p !== path) } : t));
    this.app.patch({ tabs });
  }

  open(item) {
    if (item && !item.missing) this.app.openItem(item, 'inventory');
  }

  /** 把手上的物品扔出物品栏：从对应的标签页移除 */
  dropCarried() {
    const c = this.carried;
    if (!c) return;
    if (c.from.type === 'grid' && c.from.custom) this.removeFromTab(c.from.tab, c.item.path);
    this.carried = null;
    window.mcd.incStat('itemsDropped');
  }

  slotClick(slot, button, shift) {
    const now = performance.now();
    const dbl = button === 0 && this.lastClick && this.lastClick.key === slot.key && now - this.lastClick.time < 300;
    this.lastClick = { key: slot.key, time: now };

    if (button === 2) { // 右键：使用（打开）
      if (slot.item) this.open(slot.item);
      return;
    }
    if (button !== 0) return;

    if (dbl) { // 双击：打开
      const it = this.carried ? this.carried.item : slot.item;
      if (this.carried && this.carried.from.type === 'hotbar') this.setHotbar(this.carried.from.index, it.path);
      this.carried = null;
      this.lastClick = null;
      this.open(it);
      return;
    }

    const hotbar = this.app.config.hotbar;
    if (slot.type === 'grid') {
      if (this.carried) {
        if (this.tab.custom) this.addToTab(this.tab, this.carried.item.path);
        this.carried = null;
      } else if (slot.item) {
        if (shift) {
          let i = hotbar.findIndex((p) => !p);
          if (i < 0) i = this.app.config.selectedSlot;
          this.setHotbar(i, slot.item.path);
          this.app.grant('hotbar_place');
        } else {
          this.carried = { item: slot.item, from: { type: 'grid', tab: this.tab.id, custom: !!this.tab.custom } };
        }
      }
    } else {
      const cur = hotbar[slot.index];
      if (this.carried) {
        this.setHotbar(slot.index, this.carried.item.path);
        this.carried = cur ? { item: this.app.itemInfo(cur), from: { type: 'hotbar', index: slot.index } } : null;
        window.mcd.incStat('itemsPlaced');
        this.app.grant('hotbar_place');
      } else if (cur) {
        this.setHotbar(slot.index, null);
        if (!shift) this.carried = { item: this.app.itemInfo(cur), from: { type: 'hotbar', index: slot.index } };
      }
    }
  }

  mouseClicked(mx, my, button) {
    this.pressed = null;
    if (button === 0 && this.insideScrollbar(mx, my)) {
      this.scrolling = this.extraRows(this.currentItems()) > 0;
      if (this.scrolling) this.mouseDragged(mx, my);
      return true;
    }
    const slot = this.slotAt(mx, my);
    if (slot) {
      const hadCarried = !!this.carried;
      this.slotClick(slot, button, this.app.shift);
      // 刚拿起物品：允许按住拖到另一个格子松开
      if (!hadCarried && this.carried) this.pressed = { slot };
      return true;
    }
    const tab = this.tabAt(mx, my);
    if (tab) {
      this.pressed = { tab };
      return true;
    }
    if (this.tab.type === 'search' && this.search.isMouseOver(mx, my)) {
      this.setFocus(this.search);
      return true;
    }
    if (this.insidePanel(mx, my)) return true;
    if (this.carried && button === 0) this.dropCarried();
    return true;
  }

  mouseReleased(mx, my, button) {
    this.scrolling = false;
    const p = this.pressed;
    this.pressed = null;
    if (!p || button !== 0) return false;
    if (p.tab) {
      const t = this.tabAt(mx, my);
      if (t !== p.tab && (!t || t.id !== p.tab.id)) return true;
      if (this.carried && p.tab.custom) {
        // 把手上的物品放进这个标签页
        this.addToTab(p.tab, this.carried.item.path);
        if (this.carried.from.type === 'hotbar') { /* 已从快捷栏移出 */ }
        this.carried = null;
      } else {
        this.selectTab(p.tab.id);
      }
      return true;
    }
    if (p.slot && this.carried) {
      const target = this.slotAt(mx, my);
      if (target && target.key !== p.slot.key) {
        this.lastClick = null;
        this.slotClick(target, 0, false);
      } else if (!target && !this.insidePanel(mx, my)) {
        const tab = this.tabAt(mx, my);
        if (tab && tab.custom) {
          this.addToTab(tab, this.carried.item.path);
          this.carried = null;
        } else if (!tab) {
          this.dropCarried();
        }
      }
    }
    return true;
  }

  mouseDragged(mx, my) {
    if (!this.scrolling) return false;
    const y0 = this.topPos + 18, y1 = y0 + 112;
    this.scrollOffs = Math.max(0, Math.min(1, (my - y0 - 7.5) / (y1 - y0 - 15)));
    return true;
  }

  mouseScrolled(mx, my, dy) {
    const extra = this.extraRows(this.currentItems());
    if (extra <= 0) return false;
    this.scrollOffs = Math.max(0, Math.min(1, this.scrollOffs + Math.sign(dy) / extra));
    return true;
  }

  keyPressed(e) {
    const keys = this.app.config.keys;
    if (e.code === 'Escape') { this.onClose(); return true; }
    if (this.focusedWidget === this.search) {
      if (e.code === 'Enter') return true;
      return false; // 其余按键交给输入框
    }
    if (e.code === keys.inventory) { this.onClose(); return true; }
    if (e.code === keys.search && this.tab.type !== 'search') { this.selectTab('search'); return true; }
    const mx = this.app.mouseX, my = this.app.mouseY;
    const slot = this.slotAt(mx, my);
    for (let i = 0; i < 9; i++) {
      if (e.code === keys['hotbar' + (i + 1)]) {
        if (slot && slot.type === 'grid' && slot.item) {
          this.setHotbar(i, slot.item.path);
          this.app.grant('hotbar_place');
        } else if (slot && slot.type === 'hotbar') {
          const hb = [...this.app.config.hotbar];
          [hb[i], hb[slot.index]] = [hb[slot.index], hb[i]];
          this.app.patch({ hotbar: hb });
        }
        return true;
      }
    }
    if (e.code === keys.drop || e.code === 'Delete') {
      if (slot && slot.type === 'hotbar' && slot.item) this.setHotbar(slot.index, null);
      else if (slot && slot.type === 'grid' && slot.item && this.tab.custom) this.removeFromTab(this.tab.id, slot.item.path);
      return true;
    }
    return false;
  }

  removed() {
    super.removed();
    // 关闭时手上还拿着快捷栏里的物品：放回原处
    const c = this.carried;
    if (c && c.from.type === 'hotbar') {
      const hb = [...this.app.config.hotbar];
      let i = hb[c.from.index] ? hb.findIndex((p) => !p) : c.from.index;
      if (i >= 0) { hb[i] = c.item.path; this.app.patch({ hotbar: hb }); }
    }
    this.carried = null;
    if (this.searched) { window.mcd.incStat('searches'); this.app.grant('search'); }
  }

  onClose() {
    this.app.setScreen(null);
  }
}
