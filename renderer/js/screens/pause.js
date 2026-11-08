// 游戏菜单（PauseScreen）与标题画面（TitleScreen）

import { Screen, ConfirmLinkScreen, MessageScreen } from './screen.js';
import { Button, SpriteIconButton } from '../widgets.js';
import { tr, tex, texUrl } from '../assets.js';
import { OptionsScreen } from './options.js';
import { StatsScreen } from './stats.js';
import { AdvancementsScreen } from './advancements.js';
import { LanScreen } from './lan.js';
import { DonateScreen } from './donate.js';
import { font } from '../font.js';

const RELEASE_FEEDBACK = 'https://aka.ms/javafeedback?ref=game';

export class PauseScreen extends Screen {
  constructor() { super(tr('menu.game')); }

  build() {
    // GridLayout：单元格 padding(4,4,4,0)，“回到游戏”上方额外 50；整体放在 (0.5, 0.25) 处
    const x0 = Math.floor((this.width - 212) * 0.5);
    const y0 = Math.floor((this.height - 166) * 0.25);
    const L = x0 + 4, R = x0 + 110;
    const open = (s) => () => this.app.setScreen(s(), this);
    this.add(new Button(L, y0 + 50, 204, 20, tr('menu.returnToGame'), () => this.app.setScreen(null)));
    this.add(new Button(L, y0 + 74, 98, 20, tr('gui.advancements'), open(() => new AdvancementsScreen())));
    this.add(new Button(R, y0 + 74, 98, 20, tr('gui.stats'), open(() => new StatsScreen())));
    this.add(new Button(L, y0 + 98, 98, 20, tr('menu.sendFeedback'), () => this.app.setScreen(new ConfirmLinkScreen(this, RELEASE_FEEDBACK), this)));
    this.add(new Button(R, y0 + 98, 98, 20, '赞赏作者', open(() => new DonateScreen())));
    this.add(new Button(L, y0 + 122, 98, 20, tr('menu.options'), open(() => new OptionsScreen())));
    this.add(new Button(R, y0 + 122, 98, 20, tr('menu.shareToLan'), open(() => new LanScreen())));
    this.add(new Button(L, y0 + 146, 204, 20, tr('menu.returnToMenu'), () => this.app.setScreen(new TitleScreen())));
  }

  renderContent(g) {
    g.centered(this.title, Math.floor(this.width / 2), 40, 0xffffff);
  }

  onClose() { this.app.setScreen(null); }
}

export class TitleScreen extends Screen {
  constructor() {
    super('');
    const list = TitleScreen.splashes || [];
    this.splash = list.length ? list[Math.floor(Math.random() * list.length)] : '';
    const d = new Date();
    if (d.getMonth() === 11 && d.getDate() === 24) this.splash = 'Merry X-mas!';
    else if (d.getMonth() === 0 && d.getDate() === 1) this.splash = 'Happy new year!';
  }

  get blurBackground() { return false; }
  get forcePanorama() { return true; }
  get showHud() { return false; }

  build() {
    const cx = Math.floor(this.width / 2);
    const l = Math.floor(this.height / 4) + 48;
    const app = this.app;
    this.add(new Button(cx - 100, l, 200, 20, tr('menu.singleplayer'), () => app.setScreen(null)));
    this.add(new Button(cx - 100, l + 24, 200, 20, tr('menu.multiplayer'), () => window.mcd.openExplorer(),
      { tooltip: ['打开“此电脑”'] }));
    this.add(new Button(cx - 100, l + 48, 200, 20, tr('menu.online'), () => window.mcd.openExternal('ms-settings:'),
      { tooltip: ['打开 Windows 设置'] }));
    this.add(new SpriteIconButton(cx - 124, l + 84, 20, 'icon/language', () => app.setScreen(new OptionsScreen(), this), [tr('options.language').replace('…', '')]));
    this.add(new Button(cx - 100, l + 84, 98, 20, tr('menu.options'), () => app.setScreen(new OptionsScreen(), this)));
    this.add(new Button(cx + 2, l + 84, 98, 20, tr('menu.quit'), () => window.mcd.quit()));
    this.add(new SpriteIconButton(cx + 104, l + 84, 20, 'icon/accessibility', () => app.setScreen(new OptionsScreen(), this), [tr('options.accessibility').replace('…', '')]));
    const copyright = tr('title.credits');
    this.copyright = { text: copyright, x: this.width - font.width(copyright) - 2, y: this.height - 10, w: font.width(copyright) };
  }

  renderBackground() {}

  renderContent(g, mx, my) {
    const cx = Math.floor(this.width / 2);
    // 标志（textures/gui/title/minecraft.png 为 4 倍分辨率并开启线性过滤）
    const logo = tex('gui/title/minecraft');
    const edition = tex('gui/title/edition');
    g.ctx.imageSmoothingEnabled = true;
    if (logo) g.blit(logo, cx - 128, 30, 0, 0, 256, 44, 256, 64);
    if (edition) g.blit(edition, cx - 64, 30 + 44 - 7, 0, 0, 128, 14, 128, 16);
    g.ctx.imageSmoothingEnabled = false;
    // 闪烁标语
    if (this.splash) {
      const ctx = g.ctx;
      ctx.save();
      ctx.translate(cx + 123, 69);
      ctx.rotate((-20 * Math.PI) / 180);
      const t = (Date.now() % 1000) / 1000;
      let f = 1.8 - Math.abs(Math.sin(t * Math.PI * 2) * 0.1);
      f = (f * 100) / (font.width(this.splash) + 32);
      ctx.scale(f, f);
      g.centered(this.splash, 0, -8, 0xffff00);
      ctx.restore();
      ctx.imageSmoothingEnabled = false;
    }
    g.text('Minecraft ' + (this.app.version || ''), 2, this.height - 10, 0xffffff);
    const c = this.copyright;
    const hover = mx >= c.x && mx < c.x + c.w && my >= c.y && my < c.y + 10;
    g.text(c.text, c.x, c.y, 0xffffff);
    if (hover) g.fill(c.x, c.y + 9, c.x + c.w, c.y + 10, 0xffffffff);
  }

  mouseClicked(mx, my, button) {
    const c = this.copyright;
    if (button === 0 && mx >= c.x && mx < c.x + c.w && my >= c.y && my < c.y + 10) {
      this.app.setScreen(aboutScreen(), this);
      return true;
    }
    return super.mouseClicked(mx, my, button);
  }

  onClose() { this.app.setScreen(null); }
}

export function aboutScreen() {
  return new MessageScreen(tr('credits_and_attribution.screen.title'), [
    { text: 'Minecraft Desktop', color: 0xffff55 },
    '把 Windows 桌面变成 Minecraft Java 版的界面。',
    '',
    { text: '界面贴图、字体、音效与文本均读取自本机安装的 Minecraft Java 版资源文件，版权归 Mojang Studios 所有。', color: 0xaaaaaa },
    { text: '本程序与 Mojang Studios 及 Microsoft 无关，请勿分发提取出的资源。', color: 0xaaaaaa },
  ]);
}

export async function loadSplashes() {
  try {
    const r = await fetch('mcd://app/assets/minecraft/texts/splashes.txt');
    TitleScreen.splashes = (await r.text()).split('\n').map((s) => s.trim()).filter((s) => s && !s.includes('§'));
  } catch {
    TitleScreen.splashes = [];
  }
}

export { texUrl };
