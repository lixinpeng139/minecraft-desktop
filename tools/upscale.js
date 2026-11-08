// 开发辅助：用 Electron 把小 PNG 最近邻放大，便于查看。用法: electron tools/upscale.js in.png out.png 8
const { app, nativeImage } = require('electron');
const fs = require('fs');
app.whenReady().then(() => {
  const [inp, out, k] = process.argv.slice(-3);
  const img = nativeImage.createFromPath(inp);
  const { width, height } = img.getSize();
  const src = img.toBitmap();
  const s = +k, W = width * s, H = height * s;
  const dst = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = ((Math.floor(y / s) * width) + Math.floor(x / s)) * 4, di = (y * W + x) * 4;
    const a = src[si + 3] / 255; // 透明处显示洋红格以便分辨
    const bg = ((x >> 3) + (y >> 3)) % 2 ? 255 : 200;
    dst[di] = src[si] * a + bg * (1 - a); dst[di + 1] = src[si + 1] * a + 0 * (1 - a); dst[di + 2] = src[si + 2] * a + bg * (1 - a); dst[di + 3] = 255;
  }
  fs.writeFileSync(out, nativeImage.createFromBitmap(dst, { width: W, height: H }).toPNG());
  app.quit();
});
