// 生成程序图标（原创像素画：快捷栏格子里的一台小显示器），输出 build/icon.png (256×256)
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const P = {
  '.': null, K: [0, 0, 0], L: [255, 255, 255], l: [198, 198, 198], g: [139, 139, 139], d: [85, 85, 85],
  F: [40, 40, 44], S: [94, 167, 232], s: [148, 205, 245], G: [92, 168, 52], H: [62, 120, 36], B: [120, 84, 52], W: [70, 70, 76],
};
const ART = [
  '................',
  '.KKKKKKKKKKKKKK.',
  '.KLLLLLLLLLLLlK.',
  '.KLggggggggggdK.',
  '.KLgFFFFFFFFgdK.',
  '.KLgFssSSSSFgdK.',
  '.KLgFsSSSSSFgdK.',
  '.KLgFSSSGGSFgdK.',
  '.KLgFGGGGHGFgdK.',
  '.KLgFHGBBGHFgdK.',
  '.KLgFFFFFFFFgdK.',
  '.KLggggWWggggdK.',
  '.KLgggWWWWgggdK.',
  '.KldddddddddddK.',
  '.KKKKKKKKKKKKKK.',
  '................',
].map((r) => r.padEnd(16, '.').slice(0, 16));

app.whenReady().then(() => {
  const S = 16, N = 256, k = N / S;
  const buf = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = P[ART[Math.floor(y / k)][Math.floor(x / k)]];
    const i = (y * N + x) * 4;
    if (!c) continue;
    buf[i] = c[2]; buf[i + 1] = c[1]; buf[i + 2] = c[0]; buf[i + 3] = 255; // BGRA
  }
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.writeFileSync(out, nativeImage.createFromBitmap(buf, { width: N, height: N }).toPNG());
  console.log('wrote', out);
  app.quit();
});
