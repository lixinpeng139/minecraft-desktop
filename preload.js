const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const fn = (e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('mcd', {
  getState: () => ipcRenderer.invoke('state:get'),
  patchConfig: (patch) => ipcRenderer.invoke('config:patch', patch),
  describe: (paths) => ipcRenderer.invoke('items:describe', paths),
  refreshItems: () => ipcRenderer.invoke('items:refresh'),
  getIcon: (p) => ipcRenderer.invoke('icon:get', p),
  openItem: (p, source) => ipcRenderer.invoke('item:open', p, source),
  incStat: (key, n) => ipcRenderer.invoke('stats:inc', key, n),
  grant: (id) => ipcRenderer.invoke('adv:grant', id),
  setScreenOpen: (open) => ipcRenderer.send('desktop:screen', open),
  setHotbarRect: (rect) => ipcRenderer.send('hotbar:rect', rect),
  openInventoryFromHotbar: () => ipcRenderer.send('hotbar:openInventory'),
  status: {
    watch: (on) => ipcRenderer.invoke('status:watch', on),
    action: (act) => ipcRenderer.send('status:action', act),
    on: on('status'),
  },
  vitals: {
    get: () => ipcRenderer.invoke('vitals:get'),
    on: on('vitals'),
    onPeak: on('vitals:peak'),
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  openDesktopFolder: () => ipcRenderer.invoke('shell:openDesktopFolder'),
  openExplorer: () => ipcRenderer.invoke('shell:explorer'),
  copyText: (t) => ipcRenderer.invoke('clipboard:write', t),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  readImage: (p) => ipcRenderer.invoke('image:read', p),
  getWallpaper: () => ipcRenderer.invoke('sys:wallpaper'),
  sysInfo: () => ipcRenderer.invoke('sys:info'),
  lanAddresses: () => ipcRenderer.invoke('net:lan'),
  quit: () => ipcRenderer.invoke('app:quit'),
  resetupAssets: () => ipcRenderer.invoke('assets:resetup'),
  setup: {
    start: () => ipcRenderer.invoke('setup:start'),
    onProgress: on('setup:progress'),
  },
  capture: (name) => ipcRenderer.invoke('debug:capture', name),
  captureDone: () => ipcRenderer.invoke('debug:done'),
  pathForFile: (file) => webUtils.getPathForFile(file),

  onConfig: on('config'),
  onItems: on('items'),
  onDisplay: on('display'),
  onCommand: on('command'),
  onBlur: on('desktop:blur'),
  onToast: on('toast'),
  onHotbarLeave: on('hotbar:leave'),
});
