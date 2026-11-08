// 把“赞赏作者”里的两张方块风收款码导出为海报 PNG，保存到桌面
// 用法：npm run export-qr（需要项目目录下已有 assets/，即 npm run extract 或运行过一次程序）
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  { scheme: 'mcd', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

app.whenReady().then(async () => {
  protocol.handle('mcd', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL('mcd://app/tools/qr-poster.html');
    const posters = await win.webContents.executeJavaScript('makePosters()');
    for (const p of posters) {
      const out = path.join(app.getPath('desktop'), `${p.name}收款码-方块风.png`);
      fs.writeFileSync(out, Buffer.from(p.data.split(',')[1], 'base64'));
      console.log('wrote', out);
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
