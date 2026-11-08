// 原版控件：Button / SpriteIconButton / Slider / EditBox / 文字标签

import * as sound from './sound.js';
import { font } from './font.js';
import { tr } from './assets.js';

export class Widget {
  constructor(x, y, w, h) {
    Object.assign(this, { x, y, w, h });
    this.visible = true;
    this.active = true;
    this.focused = false;
    this.hovered = false;
    this.focusable = true;
    this.tooltip = null;
  }
  isMouseOver(mx, my) {
    return this.visible && mx >= this.x && my >= this.y && mx < this.x + this.w && my < this.y + this.h;
  }
  render(g, mx, my) {
    if (!this.visible) return;
    this.hovered = this.isMouseOver(mx, my);
    this.renderWidget(g, mx, my);
  }
  renderWidget() {}
  mouseClicked(mx, my, button) {
    if (!this.active || !this.visible || button !== 0 || !this.isMouseOver(mx, my)) return false;
    this.onClick(mx, my);
    return true;
  }
  onClick() {}
  mouseReleased() { return false; }
  mouseDragged() { return false; }
  mouseScrolled() { return false; }
  keyPressed() { return false; }
}

export class Button extends Widget {
  /** text 可以是字符串或返回字符串的函数 */
  constructor(x, y, w, h, text, onPress, opts = {}) {
    super(x, y, w, h);
    this.text = text;
    this.onPress = onPress;
    Object.assign(this, opts);
  }
  get label() { return typeof this.text === 'function' ? this.text() : this.text; }
  renderWidget(g) {
    const name = !this.active ? 'widget/button_disabled'
      : (this.hovered || this.focused) ? 'widget/button_highlighted' : 'widget/button';
    g.sprite(name, this.x, this.y, this.w, this.h);
    this.renderLabel(g);
  }
  renderLabel(g) {
    const color = this.active ? 0xffffff : 0xa0a0a0;
    g.scrollingText(this.label, this.x + 2, this.y, this.x + this.w - 2, this.y + this.h, color);
  }
  onClick() {
    sound.click();
    this.onPress && this.onPress(this);
  }
  keyPressed(e) {
    if (this.active && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) {
      this.onClick();
      return true;
    }
    return false;
  }
}

/** 选项按钮：“名称：值” */
export function optionText(name, value) {
  return tr('options.generic_value', name, value);
}

export class CycleButton extends Button {
  constructor(x, y, w, h, name, values, get, set, labels = null) {
    super(x, y, w, h, () => optionText(name, labels ? labels[values.indexOf(get())] ?? String(get()) : String(get())), () => {
      const i = values.indexOf(get());
      set(values[(i + 1) % values.length]);
    });
  }
}

export const onOff = (v) => tr(v ? 'options.on' : 'options.off');

export class ToggleButton extends Button {
  constructor(x, y, w, h, name, get, set) {
    super(x, y, w, h, () => optionText(name, onOff(get())), () => set(!get()));
  }
}

/** 带图标的小按钮（语言、辅助功能） */
export class SpriteIconButton extends Button {
  constructor(x, y, size, icon, onPress, tooltip) {
    super(x, y, size, size, '', onPress);
    this.icon = icon;
    this.tooltip = tooltip;
  }
  renderLabel(g) {
    g.sprite(this.icon, this.x + Math.floor((this.w - 15) / 2), this.y + Math.floor((this.h - 15) / 2), 15, 15);
  }
}

export class Slider extends Widget {
  /** value ∈ [0,1]；getText(value) 生成显示文字；onChange(value) 应用 */
  constructor(x, y, w, h, value, getText, onChange) {
    super(x, y, w, h);
    this.value = value;
    this.getText = getText;
    this.onChange = onChange;
    this.dragging = false;
    this.canChangeValue = false;
  }
  renderWidget(g) {
    const bg = this.focused && !this.canChangeValue ? 'widget/slider_highlighted' : 'widget/slider';
    const handle = (this.hovered || this.canChangeValue) ? 'widget/slider_handle_highlighted' : 'widget/slider_handle';
    g.sprite(bg, this.x, this.y, this.w, this.h);
    g.sprite(handle, this.x + Math.floor(this.value * (this.w - 8)), this.y, 8, this.h);
    g.scrollingText(this.getText(this.value), this.x + 2, this.y, this.x + this.w - 2, this.y + this.h, this.active ? 0xffffff : 0xa0a0a0);
  }
  setFromMouse(mx) {
    const v = Math.max(0, Math.min(1, (mx - (this.x + 4)) / (this.w - 8)));
    this.setValue(v);
  }
  setValue(v) {
    const old = this.value;
    this.value = Math.max(0, Math.min(1, v));
    if (old !== this.value) this.onChange(this.value, this);
  }
  onClick(mx) {
    this.dragging = true;
    this.setFromMouse(mx);
  }
  mouseDragged(mx) {
    if (!this.dragging) return false;
    this.setFromMouse(mx);
    return true;
  }
  mouseReleased() {
    if (!this.dragging) return false;
    this.dragging = false;
    sound.click();
    return true;
  }
  keyPressed(e) {
    if (e.code === 'Enter' || e.code === 'Space') { this.canChangeValue = !this.canChangeValue; return true; }
    if (this.canChangeValue && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      this.setValue(this.value + (e.code === 'ArrowLeft' ? -1 : 1) / (this.w - 8));
      return true;
    }
    return false;
  }
}

/** 离散取值的滑块 */
export class StepSlider extends Slider {
  constructor(x, y, w, h, steps, index, getText, onChange) {
    const n = steps.length - 1;
    super(x, y, w, h, n ? index / n : 0, (v) => getText(steps[Math.round(v * n)]), (v) => {
      const i = Math.round(v * n);
      if (i !== this.index) { this.index = i; onChange(steps[i]); }
    });
    this.steps = steps;
    this.index = index;
  }
  setValue(v) {
    const n = this.steps.length - 1;
    super.setValue(n ? Math.round(Math.max(0, Math.min(1, v)) * n) / n : 0);
  }
}

export class Label extends Widget {
  constructor(x, y, w, text, color = 0xffffff, align = 'center') {
    super(x, y, w, 9);
    Object.assign(this, { text, color, align });
    this.focusable = false;
  }
  renderWidget(g) {
    const t = typeof this.text === 'function' ? this.text() : this.text;
    if (this.align === 'center') g.centered(t, this.x + Math.floor(this.w / 2), this.y, this.color);
    else g.text(t, this.x, this.y, this.color);
  }
  mouseClicked() { return false; }
}

/** 文本框。真实输入由隐藏的 <input> 完成（以支持中文输入法），这里只负责绘制 */
export class EditBox extends Widget {
  constructor(x, y, w, h, opts = {}) {
    super(x, y, w, h);
    this.value = '';
    this.cursor = 0;
    this.maxLength = 32;
    this.hint = '';
    this.bordered = true;
    this.textColor = 0xe0e0e0;
    this.onChange = null;
    this.focusedTime = 0;
    this.input = null; // 由 App 注入
    Object.assign(this, opts);
  }
  setValue(v, cursor) {
    v = String(v).slice(0, this.maxLength);
    const changed = v !== this.value;
    this.value = v;
    this.cursor = cursor ?? v.length;
    if (changed && this.onChange) this.onChange(v);
  }
  setFocused(f) {
    if (f === this.focused) return;
    this.focused = f;
    this.focusedTime = performance.now();
    if (this.input) this.input(this, f);
  }
  innerWidth() { return this.bordered ? this.w - 8 : this.w; }
  renderWidget(g) {
    if (this.bordered) {
      g.sprite(this.focused ? 'widget/text_field_highlighted' : 'widget/text_field', this.x, this.y, this.w, this.h);
    }
    const tx = this.bordered ? this.x + 4 : this.x;
    const ty = this.bordered ? this.y + Math.floor((this.h - 8) / 2) : this.y;
    // 保证光标可见：从光标往前截取能放下的部分
    const chars = Array.from(this.value);
    const cursorChars = Array.from(this.value.slice(0, this.cursor)).length;
    let start = 0;
    while (start < cursorChars && font.width(chars.slice(start, cursorChars).join('')) > this.innerWidth()) start++;
    const visible = font.substrByWidth(chars.slice(start).join(''), this.innerWidth());
    const color = this.active ? this.textColor : 0x707070;
    if (!this.value && this.hint && !this.focused) g.text(this.hint, tx, ty, 0x808080);
    g.scissor(this.x, this.y, this.w, this.h, () => g.text(visible, tx, ty, color));
    if (this.focused && Math.floor((performance.now() - this.focusedTime) / 300) % 2 === 0) {
      const before = chars.slice(start, cursorChars).join('');
      const cx = tx + font.width(before);
      if (cursorChars >= chars.length && chars.length < this.maxLength) g.text('_', cx, ty, color);
      else g.fill(cx, ty - 1, cx + 1, ty + 1 + 9, 0xffd0d0d0);
    }
  }
  onClick() {
    this.setFocused(true);
  }
}
