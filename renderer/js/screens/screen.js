// 界面基类与通用界面：确认框、打开链接确认、选项列表

import { Widget, Button, EditBox } from '../widgets.js';
import { tr } from '../assets.js';
import { font } from '../font.js';

export class Screen {
  constructor(title = '') {
    this.title = title;
    this.widgets = [];
    this.parent = null;
    this.focusedWidget = null;
  }

  /** 是否模糊背后的世界（桌面背景与快捷栏） */
  get blurBackground() { return true; }
  /** 是否强制显示全景图（标题画面） */
  get forcePanorama() { return false; }
  get showHud() { return true; }
  get closeOnEsc() { return true; }

  init(app, width, height) {
    this.app = app;
    this.width = width;
    this.height = height;
    this.widgets = [];
    const prevFocus = this.focusedWidget;
    this.focusedWidget = null;
    this.build();
    if (prevFocus instanceof EditBox) {
      const same = this.widgets.find((w) => w.focusKey && w.focusKey === prevFocus.focusKey);
      if (same) this.setFocus(same);
    }
  }

  build() {}

  add(w) {
    if (w instanceof EditBox) w.input = (box, focused) => this.app.textInput(box, focused);
    this.widgets.push(w);
    return w;
  }

  setFocus(w) {
    if (this.focusedWidget === w) return;
    if (this.focusedWidget) {
      if (this.focusedWidget.setFocused) this.focusedWidget.setFocused(false);
      else this.focusedWidget.focused = false;
    }
    this.focusedWidget = w;
    if (w) {
      if (w.setFocused) w.setFocused(true);
      else w.focused = true;
    }
  }

  removed() {
    this.setFocus(null);
  }

  renderBackground(g) {
    this.app.renderMenuBackground(g, 0, 0, this.width, this.height);
  }

  render(g, mx, my, dt) {
    this.renderBackground(g, mx, my, dt);
    this.renderContent(g, mx, my, dt);
    for (const w of this.widgets) w.render(g, mx, my, dt);
    this.renderOverlay(g, mx, my, dt);
    const hov = this.widgets.find((w) => w.visible && w.hovered && w.tooltip);
    if (hov) g.tooltip(typeof hov.tooltip === 'function' ? hov.tooltip() : hov.tooltip, mx, my);
  }

  renderContent() {}
  renderOverlay() {}

  mouseClicked(mx, my, button) {
    for (const w of [...this.widgets].reverse()) {
      if (w.mouseClicked(mx, my, button)) {
        if (w.focusable) this.setFocus(w);
        return true;
      }
    }
    this.setFocus(null);
    return false;
  }

  mouseReleased(mx, my, button) {
    let r = false;
    for (const w of this.widgets) r = w.mouseReleased(mx, my, button) || r;
    return r;
  }

  mouseDragged(mx, my, button) {
    for (const w of this.widgets) if (w.mouseDragged(mx, my, button)) return true;
    return false;
  }

  mouseScrolled(mx, my, dy) {
    for (const w of this.widgets) if (w.mouseScrolled(mx, my, dy)) return true;
    return false;
  }

  keyPressed(e) {
    if (e.code === 'Escape' && this.closeOnEsc) {
      this.onClose();
      return true;
    }
    if (this.focusedWidget && this.focusedWidget.keyPressed(e)) return true;
    if (e.code === 'Tab') {
      this.cycleFocus(e.shiftKey ? -1 : 1);
      return true;
    }
    return false;
  }

  cycleFocus(dir) {
    const list = this.focusables();
    if (!list.length) return;
    let i = list.indexOf(this.focusedWidget);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    this.setFocus(list[i]);
  }

  focusables() {
    return this.widgets.filter((w) => w.visible && w.active && w.focusable);
  }

  tick() {}

  onClose() {
    this.app.setScreen(this.parent);
  }
}

/** 标题 + 内容 + 底部“完成”按钮的布局（HeaderAndFooterLayout，页眉/页脚高 33） */
export class HeaderFooterScreen extends Screen {
  constructor(title, header = 33, footer = 33) {
    super(title);
    this.headerHeight = header;
    this.footerHeight = footer;
  }
  renderContent(g) {
    g.centered(this.title, Math.floor(this.width / 2), Math.floor((this.headerHeight - 9) / 2), 0xffffff);
  }
  addDone(text = tr('gui.done'), onPress = () => this.onClose()) {
    return this.add(new Button(Math.floor(this.width / 2) - 100, this.height - this.footerHeight + Math.floor((this.footerHeight - 20) / 2), 200, 20, text, onPress));
  }
}

/** 可滚动的选项列表（OptionsList）：每行 25 像素，最多两个 150 宽的控件或一个 310 宽的控件 */
export class OptionsList extends Widget {
  constructor(app, x, top, w, bottom, rows, itemHeight = 25) {
    super(x, top, w, bottom - top);
    this.app = app;
    this.rows = rows; // [[widget, widget?] | {render(g, x, y, w, h, mx, my)}]
    this.itemHeight = itemHeight;
    this.scroll = 0;
    this.focusable = false;
    this.draggingBar = false;
    this.layout();
  }
  get contentHeight() { return this.rows.length * this.itemHeight + 4; }
  get maxScroll() { return Math.max(0, this.contentHeight - this.h + 4); }
  rowLeft() { return Math.floor(this.x + this.w / 2) - 155; }
  layout() {
    const left = this.rowLeft();
    this.rows.forEach((row, i) => {
      const y = this.y + 4 + i * this.itemHeight - Math.round(this.scroll);
      if (Array.isArray(row)) {
        let x = left;
        for (const w of row) {
          if (!w) { x += 160; continue; }
          w.x = x;
          w.y = y;
          x += w.w + 10;
        }
      } else row.y = y;
    });
  }
  widgets() { return this.rows.flatMap((r) => (Array.isArray(r) ? r.filter(Boolean) : r.widgets || [])); }
  scrollbarX() { return Math.floor(this.x + this.w / 2) + 164; }
  renderWidget(g, mx, my) {
    this.app.renderListBackground(g, this.x, this.y, this.w, this.h, this.scroll);
    this.layout();
    const inside = my >= this.y && my < this.y + this.h;
    g.scissor(this.x, this.y, this.w, this.h, () => {
      this.rows.forEach((row) => {
        if (Array.isArray(row)) for (const w of row) w && w.render(g, inside ? mx : -1, inside ? my : -1);
        else row.render(g, this.rowLeft(), row.y, 310, this.itemHeight, inside ? mx : -1, inside ? my : -1);
      });
    });
    this.app.renderListSeparators(g, this.x, this.y, this.w, this.h);
    if (this.maxScroll > 0) {
      const sx = this.scrollbarX();
      const barH = Math.max(32, Math.floor((this.h * this.h) / this.contentHeight));
      const by = this.y + Math.floor(((this.h - barH) * this.scroll) / this.maxScroll);
      g.sprite('widget/scroller_background', sx, this.y, 6, this.h);
      g.sprite('widget/scroller', sx, by, 6, barH);
    }
  }
  inList(my) { return my >= this.y && my < this.y + this.h; }
  mouseClicked(mx, my, button) {
    if (!this.inList(my)) return false;
    if (this.maxScroll > 0 && mx >= this.scrollbarX() && mx < this.scrollbarX() + 6) {
      this.draggingBar = true;
      return true;
    }
    for (const w of this.widgets()) {
      if (w.mouseClicked(mx, my, button)) {
        this.clicked = w;
        return true;
      }
    }
    return false;
  }
  mouseReleased(mx, my, button) {
    this.draggingBar = false;
    let r = false;
    for (const w of this.widgets()) r = w.mouseReleased(mx, my, button) || r;
    return r;
  }
  mouseDragged(mx, my, button) {
    if (this.draggingBar) {
      const barH = Math.max(32, Math.floor((this.h * this.h) / this.contentHeight));
      this.scroll = Math.max(0, Math.min(this.maxScroll, ((my - this.y - barH / 2) / (this.h - barH)) * this.maxScroll));
      return true;
    }
    for (const w of this.widgets()) if (w.mouseDragged(mx, my, button)) return true;
    return false;
  }
  mouseScrolled(mx, my, dy) {
    if (!this.inList(my) || this.maxScroll <= 0) return false;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + dy * this.itemHeight / 2));
    return true;
  }
}

/** 通用列表界面：页眉 33，列表，页脚 33 */
export class OptionsSubScreen extends HeaderFooterScreen {
  constructor(title) { super(title); this.listScroll = 0; }
  rows() { return []; }
  build() {
    const top = this.headerHeight, bottom = this.height - this.footerHeight;
    if (this.list) this.listScroll = this.list.scroll;
    this.list = new OptionsList(this.app, 0, top, this.width, bottom, this.rows());
    this.list.scroll = Math.min(this.listScroll, this.list.maxScroll);
    this.add(this.list);
    for (const w of this.list.widgets()) if (w instanceof EditBox) w.input = (box, f) => this.app.textInput(box, f);
    this.addDone();
  }
  mouseClicked(mx, my, button) {
    if (this.list.mouseClicked(mx, my, button)) {
      if (this.list.clicked && this.list.clicked.focusable) this.setFocus(this.list.clicked);
      this.list.clicked = null;
      return true;
    }
    return super.mouseClicked(mx, my, button);
  }
  focusables() {
    return [...this.list.widgets(), ...this.widgets.filter((w) => w !== this.list)].filter((w) => w.visible && w.active && w.focusable);
  }
}

/** ConfirmScreen：标题 + 多行说明 + 两个按钮 */
export class ConfirmScreen extends Screen {
  constructor(callback, title, message, yes = tr('gui.yes'), no = tr('gui.no')) {
    super(title);
    Object.assign(this, { callback, message, yes, no });
  }
  get messageTop() { return 90; }
  build() {
    this.lines = font.split(this.message || '', this.width - 50);
    const y = Math.max(Math.min(this.messageTop + this.lines.length * 9 + 20, this.height - 24), Math.floor(this.height / 6) + 96 - 24);
    this.addButtons(y);
  }
  addButtons(y) {
    this.add(new Button(Math.floor(this.width / 2) - 155, y, 150, 20, this.yes, () => this.callback(true)));
    this.add(new Button(Math.floor(this.width / 2) + 5, y, 150, 20, this.no, () => this.callback(false)));
  }
  renderContent(g) {
    g.centered(this.title, Math.floor(this.width / 2), 70, 0xffffff);
    this.lines.forEach((l, i) => g.centered(l, Math.floor(this.width / 2), this.messageTop + i * 9, 0xffffff));
  }
  onClose() { this.callback(false); }
}

/** ConfirmLinkScreen：是 / 复制到剪贴板 / 否 */
export class ConfirmLinkScreen extends ConfirmScreen {
  constructor(parentScreen, url) {
    super((ok) => {
      if (ok) window.mcd.openExternal(url);
      this.app.setScreen(parentScreen);
    }, tr('chat.link.confirm'), url);
    this.url = url;
    this.warning = tr('chat.link.warning');
  }
  get messageTop() { return 90; }
  addButtons(y) {
    const cx = Math.floor(this.width / 2);
    this.add(new Button(cx - 50 - 105, y, 100, 20, this.yes, () => this.callback(true)));
    this.add(new Button(cx - 50, y, 100, 20, tr('chat.copy'), () => { window.mcd.copyText(this.url); this.callback(false); }));
    this.add(new Button(cx - 50 + 105, y, 100, 20, this.no, () => this.callback(false)));
  }
  renderContent(g) {
    super.renderContent(g);
    g.centered(this.warning, Math.floor(this.width / 2), 110, 0xffcccc);
  }
}

/** 简单的信息界面 */
export class MessageScreen extends HeaderFooterScreen {
  constructor(title, lines) {
    super(title);
    this.lines = lines;
  }
  build() {
    this.wrapped = this.lines.flatMap((l) => (typeof l === 'string' ? font.split(l, Math.min(this.width - 40, 360)).map((t) => ({ text: t, color: 0xffffff })) : [l]));
    this.addDone();
  }
  renderContent(g) {
    super.renderContent(g);
    const top = Math.max(this.headerHeight + 10, Math.floor((this.height - this.wrapped.length * 11) / 2) - 10);
    this.wrapped.forEach((l, i) => g.centered(l.text, Math.floor(this.width / 2), top + i * 11, l.color ?? 0xffffff));
  }
}
