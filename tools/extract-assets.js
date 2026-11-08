#!/usr/bin/env node
// 命令行：从 Mojang 官方服务器下载界面资源到 assets/（开发时使用；安装版会在首次启动时自动完成）
// 用法: node tools/extract-assets.js

const path = require('path');
const { downloadFromMojang } = require('../src/assets-setup');

const out = path.join(__dirname, '..', 'assets');
let last = 0;
downloadFromMojang(out, fetch, (i) => {
  const now = Date.now();
  if (now - last < 1000 && i.stage === 'download') return;
  last = now;
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`${Math.round(i.percent * 100)}%`, i.message, i.total ? `${mb(i.received)}/${mb(i.total)} MB` : '');
})
  .then((v) => console.log('完成：', v.name, '（' + v.source + '）→', out))
  .catch((e) => { console.error(e.message); process.exit(1); });
