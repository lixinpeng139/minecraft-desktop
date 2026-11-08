// 选项界面（OptionsScreen）及各个子界面

import { Screen, HeaderFooterScreen, OptionsSubScreen, ConfirmScreen } from './screen.js';
import { Button, StepSlider, Slider, ToggleButton, CycleButton, optionText, onOff } from '../widgets.js';
import { tr } from '../assets.js';
import { TabsScreen } from './tabs.js';
import { aboutScreen } from './pause.js';
import { DEFAULT_KEYS, keyName } from '../keys.js';

function guiScaleSlider(app, w = 150) {
  const max = app.display.maxGuiScale;
  const steps = [0];
  for (let i = 1; i <= max; i++) steps.push(i);
  const cur = Math.min(app.config.guiScale, max);
  return new StepSlider(0, 0, w, 20, steps, steps.indexOf(cur) < 0 ? 0 : steps.indexOf(cur),
    (v) => optionText(tr('options.guiScale'), v === 0 ? tr('options.guiScale.auto') : String(v)),
    (v) => app.patch({ guiScale: v }));
}

function percentSlider(app, name, key, w = 150) {
  return new Slider(0, 0, w, 20, app.config[key],
    (v) => optionText(name, v <= 0 ? tr('options.off') : Math.round(v * 100) + '%'),
    (v) => app.patch({ [key]: Math.round(v * 100) / 100 }));
}

export class OptionsScreen extends HeaderFooterScreen {
  constructor() { super(tr('options.title'), 61, 33); }

  build() {
    const app = this.app;
    const cx = Math.floor(this.width / 2);
    // 页眉：标题 (y=12) + 一行两个控件 (y=29)
    const scale = this.add(guiScaleSlider(app));
    scale.x = cx - 154; scale.y = 29;
    this.add(new ToggleButton(cx + 4, 29, 150, 20, '开机自动启动', () => app.config.autoStart, (v) => app.patch({ autoStart: v })));

    const open = (s) => () => app.setScreen(s(), this);
    const buttons = [
      ['标签页设置…', open(() => new TabsScreen())],
      [tr('options.video'), open(() => new VideoScreen())],
      [tr('options.sounds'), open(() => new SoundScreen())],
      [tr('controls.keybinds'), open(() => new ControlsScreen())],
      ['桌面设置…', open(() => new DesktopScreen())],
      [tr('options.credits_and_attribution'), () => app.setScreen(aboutScreen(), this)],
    ];
    const rows = Math.ceil(buttons.length / 2);
    const top = Math.min(this.headerHeight + 30, this.height - this.footerHeight - rows * 24);
    const x0 = Math.floor((this.width - 316) / 2);
    buttons.forEach(([t, fn], i) => {
      this.add(new Button(x0 + 4 + (i % 2) * 158, top + Math.floor(i / 2) * 24, 150, 20, t, fn));
    });
    this.addDone();
  }

  renderContent(g) {
    g.centered(this.title, Math.floor(this.width / 2), 12, 0xffffff);
  }
}

export class VideoScreen extends OptionsSubScreen {
  constructor() { super(tr('options.videoTitle')); }
  rows() {
    const app = this.app;
    const bgNames = { panorama: '全景图', wallpaper: '系统壁纸', custom: '自定义图片' };
    const bg = new CycleButton(0, 0, 150, 20, '桌面背景', ['panorama', 'wallpaper', 'custom'], () => app.config.background,
      (v) => {
        if (v === 'custom' && !app.config.customBackground) return pick();
        app.patch({ background: v });
        app.grant('decorate');
      }, ['全景图', '系统壁纸', '自定义图片']);
    const pick = async () => {
      const p = await app.withDialog(() => window.mcd.pickImage());
      if (p) { app.patch({ background: 'custom', customBackground: p }); app.grant('decorate'); }
    };
    const choose = new Button(0, 0, 150, 20, '选择背景图片…', pick, {
      tooltip: () => [app.config.customBackground ? '当前：' + app.config.customBackground : '尚未选择图片'],
    });
    const speed = new Slider(0, 0, 150, 20, Math.min(1, app.config.panoramaSpeed),
      (v) => optionText(tr('options.accessibility.panorama_speed'), v <= 0 ? tr('options.off') : Math.round(v * 100) + '%'),
      (v) => app.patch({ panoramaSpeed: Math.round(v * 100) / 100 }));
    const blurSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const blur = new StepSlider(0, 0, 150, 20, blurSteps, app.config.menuBlur,
      (v) => optionText(tr('options.accessibility.menu_background_blurriness'), v === 0 ? tr('options.off') : String(v)),
      (v) => app.patch({ menuBlur: v }));
    const icons = new CycleButton(0, 0, 150, 20, '物品图标', ['pixel', 'minecraft', 'system'], () => app.config.iconStyle,
      (v) => app.patch({ iconStyle: v }), ['像素化图标', 'Minecraft 物品', '系统图标']);
    icons.tooltip = () => [{ text: '桌面文件在物品栏中的显示方式', color: 0xffffff },
      { text: '像素化图标：把程序图标缩成 16×16 像素', color: 0xaaaaaa },
      { text: 'Minecraft 物品：按文件类型显示原版物品', color: 0xaaaaaa },
      { text: '系统图标：保持原始清晰度', color: 0xaaaaaa }];
    void bgNames;
    return [
      [guiScaleSlider(app), bg],
      [choose, speed],
      [blur, icons],
    ];
  }
}

export class SoundScreen extends OptionsSubScreen {
  constructor() { super(tr('options.sounds.title')); }
  rows() {
    const app = this.app;
    return [
      [percentSlider(app, tr('soundCategory.master'), 'masterVolume', 310)],
      [percentSlider(app, tr('soundCategory.ui'), 'uiVolume'), percentSlider(app, '物品', 'itemVolume')],
    ];
  }
}

export class DesktopScreen extends OptionsSubScreen {
  constructor() { super('桌面设置'); }
  rows() {
    const app = this.app;
    const t = (name, key, tip) => {
      const b = new ToggleButton(0, 0, 150, 20, name, () => app.config[key], (v) => app.patch({ [key]: v }));
      if (tip) b.tooltip = [tip];
      return b;
    };
    // 任务栏可见时快捷栏贴在任务栏上方，最大化窗口会把它盖住，预留空间没有意义
    const reserve = t('为快捷栏预留空间', 'reserveHotbarSpace',
      '仅在“隐藏任务栏”开启时有效；任务栏可见时快捷栏贴在任务栏上方，最大化的窗口会一直贴到任务栏并盖住它');
    Object.defineProperty(reserve, 'active', { get: () => app.config.hideTaskbar });
    const rows = [
      [t('隐藏任务栏', 'hideTaskbar', '退出时会自动恢复'), t('隐藏桌面图标', 'hideDesktopIcons', '退出时会自动恢复')],
      [reserve, t('显示公共桌面', 'includePublicDesktop', '同时显示“公用”桌面上的快捷方式')],
      [t('开机自动启动', 'autoStart'), new Button(0, 0, 150, 20, '刷新物品栏', () => window.mcd.refreshItems())],
      [new Button(0, 0, 150, 20, '打开桌面文件夹', () => window.mcd.openDesktopFolder()),
        new Button(0, 0, 150, 20, '清空快捷栏', () => app.setScreen(new ConfirmScreen((ok) => {
          if (ok) app.patch({ hotbar: Array(9).fill(null) });
          app.setScreen(this);
        }, '清空快捷栏', '快捷栏中的 9 个物品都会被移除（文件本身不会被删除）。'), this))],
    ];
    rows.push([new Button(0, 0, 310, 20, '重新获取游戏资源…', () => app.setScreen(new ConfirmScreen((ok) => {
      if (ok) window.mcd.resetupAssets();
      else app.setScreen(this);
    }, '重新获取游戏资源', '程序会重新启动，并从 Mojang 官方服务器重新下载界面资源（约 30 MB）。'), this))]);
    if (app.noSystem) rows.push([new Button(0, 0, 310, 20, '（调试模式：系统集成已停用）', () => {}, { active: false })]);
    return rows;
  }
}

// ---------- 按键绑定 ----------
const bindings = () => [
  { category: tr('key.categories.inventory') },
  { id: 'inventory', name: tr('key.inventory') },
  { id: 'search', name: '搜索物品' },
  { id: 'drop', name: tr('key.drop') },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ id: 'hotbar' + i, name: tr('key.hotbar.' + i) })),
  { category: tr('key.categories.multiplayer') },
  { id: 'chat', name: tr('key.chat') },
  { id: 'command', name: tr('key.command') },
  { category: tr('key.categories.misc') },
  { id: 'debug', name: '调试屏幕' },
];

class KeyEntry {
  constructor(screen, b) {
    this.screen = screen;
    this.b = b;
    this.widgets = [];
    if (b.id) {
      this.change = new Button(0, 0, 75, 20, () => this.label(), () => { screen.listening = this.b.id; });
      this.reset = new Button(0, 0, 50, 20, tr('controls.reset'), () => screen.setKey(this.b.id, DEFAULT_KEYS[this.b.id]));
      this.widgets = [this.change, this.reset];
    }
  }
  label() {
    const keys = this.screen.app.config.keys;
    const name = keyName(keys[this.b.id]);
    if (this.screen.listening === this.b.id) return '> ' + name + ' <';
    return name;
  }
  render(g, x, y, w, h, mx, my) {
    if (!this.b.id) {
      g.centered(this.b.category, x + Math.floor(w / 2), y + h - 9 - 1, 0xffffff);
      return;
    }
    const keys = this.screen.app.config.keys;
    const conflict = keys[this.b.id] && Object.entries(keys).some(([k, v]) => k !== this.b.id && v === keys[this.b.id]);
    g.text(this.b.name, x, y + Math.floor(h / 2) - 4, 0xffffff);
    this.reset.x = x + w - 50; this.reset.y = y - 2;
    this.change.x = this.reset.x - 5 - 75; this.change.y = y - 2;
    this.reset.active = keys[this.b.id] !== DEFAULT_KEYS[this.b.id];
    this.change.render(g, mx, my);
    this.reset.render(g, mx, my);
    if (this.screen.listening === this.b.id || conflict) {
      // 重新覆盖按钮文字的颜色：正在设置为黄色，冲突为红色
      const color = this.screen.listening === this.b.id ? 0xffff55 : 0xff5555;
      g.sprite(this.change.hovered ? 'widget/button_highlighted' : 'widget/button', this.change.x, this.change.y, 75, 20);
      g.scrollingText(this.label(), this.change.x + 2, this.change.y, this.change.x + 73, this.change.y + 20, color);
    }
  }
}

export class ControlsScreen extends OptionsSubScreen {
  constructor() { super(tr('controls.keybinds.title')); this.listening = null; }
  rows() {
    return bindings().map((b) => new KeyEntry(this, b));
  }
  build() {
    super.build();
    this.list.itemHeight = 20;
    // 页脚：重置按键 + 完成
    this.widgets = this.widgets.filter((w) => w === this.list);
    const cx = Math.floor(this.width / 2);
    this.add(new Button(cx - 154, this.height - 27, 150, 20, tr('controls.resetAll'), () => this.app.patch({ keys: { ...DEFAULT_KEYS } })));
    this.add(new Button(cx + 4, this.height - 27, 150, 20, tr('gui.done'), () => this.onClose()));
  }
  setKey(id, code) {
    this.app.patch({ keys: { ...this.app.config.keys, [id]: code } });
  }
  keyPressed(e) {
    if (this.listening) {
      this.setKey(this.listening, e.code === 'Escape' ? null : e.code);
      this.listening = null;
      return true;
    }
    return super.keyPressed(e);
  }
  mouseClicked(mx, my, b) {
    if (this.listening) { this.listening = null; }
    return super.mouseClicked(mx, my, b);
  }
}

export { Screen, onOff };
