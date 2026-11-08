// 获取界面所需的 Minecraft 资源：从 Mojang 官方服务器（或国内镜像）下载。
// 资源只写到本机（用户数据目录），程序本身不包含、也不分发任何 Mojang 的文件。

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const inflateRaw = promisify(zlib.inflateRaw);

/** 界面按 1.21.1 的布局编写，优先使用这个版本 */
const TARGET_VERSION = '1.21.1';

const JAR_PREFIXES = [
  'assets/minecraft/textures/gui/',
  'assets/minecraft/textures/item/',
  'assets/minecraft/textures/block/',
  'assets/minecraft/textures/entity/chest/',
  'assets/minecraft/textures/colormap/',
  'assets/minecraft/textures/font/',
  'assets/minecraft/font/',
  'assets/minecraft/texts/splashes.txt',
  'assets/minecraft/lang/en_us.json',
];

const OBJECTS = [
  'minecraft/lang/zh_cn.json',
  'minecraft/sounds/random/click_stereo.ogg',
  'minecraft/sounds/random/pop.ogg',
  'minecraft/sounds/random/orb.ogg',
  'minecraft/sounds/ui/toast/challenge_complete.ogg',
  'minecraft/sounds/ui/toast/in.ogg',
  'minecraft/sounds/ui/toast/out.ogg',
  'minecraft/textures/gui/title/background/panorama_overlay.png',
  ...[0, 1, 2, 3, 4, 5].map((i) => `minecraft/textures/gui/title/background/panorama_${i}.png`),
  'minecraft/font/unifont.zip',
];

// ---------- 极简 zip 读取 ----------
function openZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/jar 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const headerOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, csize, headerOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: () => entries.keys(),
    has: (n) => entries.has(n),
    async read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.headerOffset + 30 + buf.readUInt16LE(e.headerOffset + 26) + buf.readUInt16LE(e.headerOffset + 28);
      const data = buf.subarray(start, start + e.csize);
      return e.method === 0 ? Buffer.from(data) : inflateRaw(data);
    },
  };
}

// ---------- unifont: hex → 紧凑二进制 ----------
// 格式: "UFNT" + Uint32[65536] 偏移表(0=缺失) + 数据区(每字形: 1 字节列数 + 16 行位图)
function convertUnifont(hexText) {
  const offsets = new Uint32Array(65536);
  const chunks = [];
  let size = 1;
  for (const line of hexText.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const cp = parseInt(line.slice(0, i), 16);
    if (!(cp >= 0 && cp <= 0xffff)) continue;
    const hex = line.slice(i + 1).trim();
    const cols = hex.length / 4;
    if (![8, 16, 24, 32].includes(cols)) continue;
    const b = Buffer.alloc(1 + hex.length / 2);
    b[0] = cols;
    Buffer.from(hex, 'hex').copy(b, 1);
    offsets[cp] = size;
    size += b.length;
    chunks.push(b);
  }
  const header = Buffer.alloc(4 + 65536 * 4);
  header.write('UFNT', 0, 'ascii');
  Buffer.from(offsets.buffer).copy(header, 4);
  return Buffer.concat([header, Buffer.alloc(1), ...chunks]);
}

// ---------- 写出 ----------
async function writeAll(jarBuf, getObject, outDir, meta, progress) {
  const tmp = outDir + '.tmp';
  await fsp.rm(tmp, { recursive: true, force: true });
  const write = async (rel, data) => {
    const f = path.join(tmp, rel);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, data);
  };

  const zip = openZip(jarBuf);
  const names = [...zip.names()].filter((n) => !n.endsWith('/') && JAR_PREFIXES.some((p) => n.startsWith(p)));
  const spriteMeta = {};
  const textures = [];
  const SPRITES = 'assets/minecraft/textures/gui/sprites/';
  let done = 0;
  for (const name of names) {
    const data = await zip.read(name);
    await write(name.slice('assets/'.length), data);
    if (name.startsWith(SPRITES) && name.endsWith('.png.mcmeta')) {
      try {
        const m = JSON.parse(data.toString('utf8'));
        if (m.gui && m.gui.scaling) spriteMeta[name.slice(SPRITES.length, -'.png.mcmeta'.length)] = m.gui.scaling;
      } catch { /* ignore */ }
    }
    const t = name.match(/^assets\/minecraft\/textures\/((?:item|block)\/[^/]+)\.png$/);
    if (t) textures.push(t[1]);
    if (++done % 100 === 0) progress(0.85 * (done / names.length), '正在解压贴图…');
  }
  const versionJson = await zip.read('version.json');
  if (versionJson) await write('version.json', versionJson);
  await write('gui-meta.json', JSON.stringify({ sprites: spriteMeta, textures }));

  let i = 0;
  for (const key of OBJECTS) {
    progress(0.85 + 0.15 * (i++ / OBJECTS.length), '正在整理字体、语言文件和音效…');
    const data = await getObject(key);
    if (!data) continue;
    if (key === 'minecraft/font/unifont.zip') {
      const uzip = openZip(data);
      const hexName = [...uzip.names()].find((x) => x.endsWith('.hex'));
      await write('minecraft/font/unifont.bin', convertUnifont((await uzip.read(hexName)).toString('ascii')));
    } else {
      await write(key, data);
    }
  }
  await write('source.json', JSON.stringify({ ...meta, extractedAt: new Date().toISOString() }, null, 2));
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.rename(tmp, outDir);
}

// ---------- Mojang 官方服务器 ----------
const SOURCES = [
  { name: 'Mojang 官方服务器', map: (u) => u },
  {
    name: 'BMCLAPI 镜像',
    map: (u) => u
      .replace('https://piston-meta.mojang.com', 'https://bmclapi2.bangbang93.com')
      .replace('https://launchermeta.mojang.com', 'https://bmclapi2.bangbang93.com')
      .replace('https://piston-data.mojang.com', 'https://bmclapi2.bangbang93.com')
      .replace('https://launcher.mojang.com', 'https://bmclapi2.bangbang93.com')
      .replace('https://resources.download.minecraft.net', 'https://bmclapi2.bangbang93.com/assets'),
  },
];

async function download(fetchFn, url, onChunk) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}：${url}`);
  if (!res.body) {
    const b = Buffer.from(await res.arrayBuffer());
    if (onChunk) onChunk(b.length);
    return b;
  }
  const reader = res.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
    if (onChunk) onChunk(value.length);
  }
  return Buffer.concat(parts);
}

/**
 * 从官方服务器下载并整理资源。
 * progress(info)：{ stage, percent, received, total, speed, eta, source, message }
 *   stage: 'connect' | 'download' | 'process' | 'done'
 */
async function downloadFromMojang(outDir, fetchFn, progress = () => {}) {
  let lastErr = null;
  for (const src of SOURCES) {
    try {
      const get = (u, onChunk) => download(fetchFn, src.map(u), onChunk);
      progress({ stage: 'connect', percent: 0, source: src.name, message: `正在连接${src.name}…` });
      const manifest = JSON.parse(await get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
      const entry = manifest.versions.find((v) => v.id === TARGET_VERSION);
      if (!entry) throw new Error('版本清单中没有 ' + TARGET_VERSION);
      const vjson = JSON.parse(await get(entry.url));
      progress({ stage: 'connect', percent: 0, source: src.name, message: '正在获取资源清单…' });
      const index = JSON.parse(await get(vjson.assetIndex.url)).objects;

      // 总大小 = 游戏本体 + 需要的资源文件
      const objects = OBJECTS.filter((k) => index[k]);
      const total = vjson.downloads.client.size + objects.reduce((n, k) => n + index[k].size, 0);
      let received = 0;
      const samples = [[Date.now(), 0]];
      let lastReport = 0;
      const report = (message, force) => {
        const now = Date.now();
        if (!force && now - lastReport < 100) return;
        lastReport = now;
        samples.push([now, received]);
        while (samples.length > 2 && now - samples[0][0] > 3000) samples.shift();
        const [t0, b0] = samples[0];
        const speed = now > t0 ? ((received - b0) * 1000) / (now - t0) : 0;
        progress({
          stage: 'download', percent: 0.9 * (received / total), received, total, speed,
          eta: speed > 0 ? (total - received) / speed : null, source: src.name, message,
        });
      };
      const onChunk = (message) => (n) => { received += n; report(message); };

      const jar = await get(vjson.downloads.client.url, onChunk('正在下载游戏贴图和字体'));
      const files = new Map();
      for (const key of objects) {
        const o = index[key];
        const label = key.includes('/sounds/') ? '正在下载音效' : key.includes('panorama') ? '正在下载全景图' : key.includes('font') ? '正在下载中文字体' : '正在下载语言文件';
        files.set(key, await get(`https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`, onChunk(label)));
      }
      report('下载完成', true);

      await writeAll(jar, async (k) => files.get(k) || null, outDir, { source: src.name, version: TARGET_VERSION }, (p, message) =>
        progress({ stage: 'process', percent: 0.9 + 0.1 * p, received: total, total, source: src.name, message }));
      progress({ stage: 'done', percent: 1, received: total, total, source: src.name, message: '完成' });
      return { name: TARGET_VERSION, source: src.name };
    } catch (e) {
      lastErr = e;
      progress({ stage: 'connect', percent: 0, source: src.name, message: `${src.name}连接失败，正在尝试其他线路…` });
    }
  }
  throw new Error('下载失败：' + (lastErr ? lastErr.message : '未知错误') + '。请检查网络后重试。');
}

function assetsReady(dir) {
  return fs.existsSync(path.join(dir, 'minecraft', 'textures', 'gui', 'sprites', 'hud', 'hotbar.png')) &&
    fs.existsSync(path.join(dir, 'gui-meta.json'));
}

module.exports = {
  TARGET_VERSION, downloadFromMojang, assetsReady,
};
