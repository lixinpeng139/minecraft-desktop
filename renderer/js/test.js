// 截图自检（仅在 --capture=<目录> 模式下运行）：依次打开各个界面并保存截图

import { InventoryScreen } from './screens/inventory.js';
import { PauseScreen, TitleScreen } from './screens/pause.js';
import { OptionsScreen, VideoScreen, ControlsScreen, DesktopScreen, SoundScreen } from './screens/options.js';
import { TabsScreen, TabEditScreen } from './screens/tabs.js';
import { StatsScreen } from './screens/stats.js';
import { AdvancementsScreen } from './screens/advancements.js';
import { LanScreen } from './screens/lan.js';
import { ConfirmLinkScreen } from './screens/screen.js';
import { ChatScreen } from './screens/chat.js';
import { DonateScreen } from './screens/donate.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(app) {
  const shot = async (name, ms = 500) => {
    app.markDirty();
    await wait(ms);
    await window.mcd.capture(name);
  };
  const center = (w) => { app.mouseX = w.x + Math.floor(w.w / 2); app.mouseY = w.y + Math.floor(w.h / 2); };
  await wait(1500);
  // 测试数据：把前几个桌面物品放进快捷栏和“工具”标签页
  const paths = app.items.slice(0, 12).map((i) => i.path);
  const hotbar = Array(9).fill(null);
  paths.slice(0, 5).forEach((p, i) => { hotbar[i] = p; });
  const tabs = app.config.tabs.map((t, i) => (i === 0 ? { ...t, items: paths.slice(2, 9) } : t));
  await app.patch({ hotbar, tabs, selectedSlot: 1, hideTaskbar: true, advancements: { open_inventory: 1, hotbar_place: 1 } });
  await wait(800);
  await shot('01-desktop', 1500);

  app.openInventory('all');
  const inv = app.screen;
  app.mouseX = inv.leftPos + 9 + 18 + 8; app.mouseY = inv.topPos + 18 + 8;
  await shot('02-inventory-all', 1200);
  app.mouseX = inv.leftPos + 27 + 12; app.mouseY = inv.topPos - 16;
  await shot('03-tab-hover');
  inv.selectTab('search');
  inv.search.setValue('e');
  app.mouseX = -100; app.mouseY = -100;
  await shot('04-search');
  inv.selectTab('tools');
  inv.carried = { item: app.items[0], from: { type: 'grid', tab: 'all' } };
  app.mouseX = inv.leftPos + 120; app.mouseY = inv.topPos + 60;
  await shot('05-tools-carry');
  inv.carried = null;
  app.setScreen(null);

  app.setScreen(new PauseScreen());
  center(app.screen.widgets[0]);
  await shot('06-pause');
  const pause = app.screen;
  for (const [name, mk] of [
    ['07-options', () => new OptionsScreen()],
    ['08-video', () => new VideoScreen()],
    ['09-sound', () => new SoundScreen()],
    ['10-controls', () => new ControlsScreen()],
    ['11-desktop-settings', () => new DesktopScreen()],
    ['12-tabs', () => new TabsScreen()],
    ['13-tab-edit', () => new TabEditScreen(app.config.tabs[0])],
    ['14-stats', () => new StatsScreen()],
    ['15-advancements', () => new AdvancementsScreen()],
    ['16-lan', () => new LanScreen()],
    ['17-link', () => new ConfirmLinkScreen(pause, 'https://aka.ms/javafeedback?ref=game')],
    ['17b-donate', () => new DonateScreen()],
  ]) {
    app.setScreen(mk(), pause);
    app.mouseX = -100; app.mouseY = -100;
    if (name === '12-tabs') { app.screen.list.selected = 0; app.screen.selected = 0; }
    if (name === '13-tab-edit') { app.mouseX = app.screen.gridX + 18 * 2 + 8; app.mouseY = app.screen.gridY + 8; }
    if (name === '15-advancements') {
      const s = app.screen;
      const [x, y] = s.pos(s.constructor && (await import('./screens/advancements.js')).ADVANCEMENTS[3]);
      app.mouseX = x + 10; app.mouseY = y + 10;
    }
    await shot(name);
  }
  app.setScreen(new TitleScreen());
  center(app.screen.widgets[0]);
  await shot('18-title', 1200);
  app.setScreen(null);
  app.debug = true;
  await shot('19-debug', 1500);
  app.debug = false;
  app.addToast({ type: 'advancement', id: 'launch_hotbar' });
  await shot('20-toast', 1200);

  // 聊天栏（截图模式没有系统状态，使用示例数据）
  const fake = {
    windows: [
      { id: '1', title: 'desk - 文件资源管理器', exe: 'explorer.exe', minimized: false },
      { id: '2', title: 'CC Switch', exe: 'cc-switch.exe', minimized: true },
      { id: '3', title: '声音可视化 (Visible Sound) - MC百科|最大的Minecraft中文MOD百科 - 个人 - Microsoft Edge', exe: 'msedge.exe', minimized: false },
    ],
    background: [{ path: 'C:\\Program Files\\Huorong\\Sysdiag\\bin\\HipsTray.exe', name: '火绒安全软件' }, { path: 'C:\\x\\steam.exe', name: 'Steam' }],
    volume: { level: 45, muted: false }, brightness: 50,
    network: { type: 'wifi', name: 'OnePlus 13T d32m', internet: true },
    battery: { percent: 86, charging: true, plugged: true, saver: false, secondsLeft: null },
  };
  // 生命值 37%（充电中）、CPU 60%、正在播放音乐
  app.vitals.update({ cpu: 0.6, battery: { percent: 37, charging: true } });
  app.vitals.update({ cpu: 0.6, battery: { percent: 37, charging: true } });
  app.vitals.setPeak(0.7);
  app.toasts = [];
  app.markDirty();
  await shot('20b-vitals', 300);
  app.chat.add([{ text: '<' + app.userName + '> 你好' }]);
  app.openChat();
  app.status = fake;
  const chat = app.screen;
  const hitText = (t) => chat.hits.find((h) => h.span.text.includes(t));
  await wait(300);
  let h = hitText('声音可视化');
  if (h) { app.mouseX = h.x + 10; app.mouseY = h.y + 4; }
  await shot('21-chat');
  app.mouseX = -100; app.mouseY = -100;
  chat.setInput('/');
  await shot('22-chat-commands');
  chat.setInput('/tp ');
  await shot('23-chat-tp');
  chat.setInput('/volume ');
  chat.suggHidden = true;
  await shot('24-chat-usage');
  chat.setInput('/foo 1');
  await shot('25-chat-unknown');
  chat.setInput('/help');
  chat.send();
  await shot('26-chat-hud', 800);

  // 关闭“隐藏任务栏”：快捷栏和底部 HUD 应整体上移到任务栏上方
  await app.patch({ hideTaskbar: false });
  await wait(800);
  app.setScreen(null);
  await shot('27-taskbar-desktop', 800);
  app.openInventory('all');
  await shot('28-taskbar-inventory', 800);
  app.setScreen(null);
  app.openChat();
  await shot('29-taskbar-chat', 800);
  app.setScreen(null);
  await app.patch({ hideTaskbar: true });
  await wait(600); // 等主进程把配置写盘，下次截图从“隐藏任务栏”模式开始

  await window.mcd.captureDone();
}
