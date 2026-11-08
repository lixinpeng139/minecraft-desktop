// 配置与状态存储（userData/config.json）。主进程是唯一的数据源，两个窗口通过 IPC 同步。

const fs = require('fs');
const path = require('path');

const DEFAULT_TABS = [
  { id: 'tools', name: '工具', icon: { type: 'item', id: 'diamond_pickaxe' }, items: [] },
  { id: 'games', name: '游戏', icon: { type: 'item', id: 'grass_block' }, items: [] },
  { id: 'office', name: '办公', icon: { type: 'item', id: 'writable_book' }, items: [] },
  { id: 'video', name: '影视', icon: { type: 'item', id: 'painting' }, items: [] },
  { id: 'music', name: '音乐', icon: { type: 'item', id: 'jukebox' }, items: [] },
];

const DEFAULT_KEYS = {
  inventory: 'KeyE',
  chat: 'KeyT',
  command: 'Slash',
  search: null,
  drop: 'KeyQ',
  debug: 'F3',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5',
  hotbar6: 'Digit6', hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

function defaults() {
  return {
    version: 1,
    guiScale: 0, // 0 = 自动
    autoStart: true,
    hideTaskbar: true,
    hideDesktopIcons: true,
    reserveHotbarSpace: true,
    includePublicDesktop: true,
    background: 'panorama', // panorama | wallpaper | custom
    customBackground: null,
    panoramaSpeed: 1,
    menuBlur: 5,
    iconStyle: 'pixel', // pixel | minecraft | system
    masterVolume: 1,
    uiVolume: 1,
    itemVolume: 1,
    keys: { ...DEFAULT_KEYS },
    hotbar: Array(9).fill(null),
    selectedSlot: 0,
    tabs: JSON.parse(JSON.stringify(DEFAULT_TABS)),
    lastTab: 'all',
    stats: {
      playTime: 0, inventoryOpened: 0, searches: 0,
      launchesFromHotbar: 0, launchesFromInventory: 0, itemsPlaced: 0, itemsDropped: 0,
      launches: {},
    },
    advancements: {},
    savedTaskbarState: null,
  };
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.data = defaults();
    this.timer = null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const d = defaults();
      this.data = { ...d, ...saved, keys: { ...d.keys, ...saved.keys }, stats: { ...d.stats, ...saved.stats } };
      // 旧版本的“搜索物品”默认是 T，现在 T 用来打开聊天栏（与原版相同）
      if (saved.keys && !('chat' in saved.keys) && saved.keys.search === 'KeyT') this.data.keys.search = null;
      for (const k of ['statusEnabled', 'statusWindows', 'statusBackground', 'statusOpacity', 'statusScale']) delete this.data[k];
      if (!Array.isArray(this.data.hotbar) || this.data.hotbar.length !== 9) this.data.hotbar = d.hotbar;
      if (!Array.isArray(this.data.tabs)) this.data.tabs = d.tabs;
    } catch {
      // 首次运行或文件损坏：使用默认值
    }
  }

  get() { return this.data; }

  set(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  save(immediate) {
    clearTimeout(this.timer);
    const write = () => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    };
    if (immediate) write();
    else this.timer = setTimeout(write, 300);
  }
}

module.exports = { Store, defaults, DEFAULT_KEYS };
