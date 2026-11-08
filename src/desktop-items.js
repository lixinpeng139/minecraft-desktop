// 扫描桌面（当前用户 + 公共桌面），提取快捷方式目标与图标。

const fs = require('fs');
const path = require('path');
const { app, shell, nativeImage } = require('electron');

const IGNORED = new Set(['desktop.ini', 'thumbs.db']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);

const KIND_LABELS = {
  '.lnk': '快捷方式', '.url': 'Internet 快捷方式', '.exe': '应用程序', '.bat': 'Windows 批处理文件',
  '.cmd': 'Windows 命令脚本', '.txt': '文本文档', '.pdf': 'PDF 文件', '.doc': 'Word 文档', '.docx': 'Word 文档',
  '.xls': 'Excel 工作表', '.xlsx': 'Excel 工作表', '.ppt': 'PowerPoint 演示文稿', '.pptx': 'PowerPoint 演示文稿',
  '.zip': '压缩文件', '.rar': '压缩文件', '.7z': '压缩文件', '.png': 'PNG 图片', '.jpg': 'JPEG 图片',
  '.jpeg': 'JPEG 图片', '.gif': 'GIF 图片', '.mp3': 'MP3 音频', '.flac': 'FLAC 音频', '.wav': 'WAV 音频',
  '.mp4': 'MP4 视频', '.mkv': 'MKV 视频', '.avi': 'AVI 视频', '.mov': 'MOV 视频',
};

function desktopDirs(includePublic) {
  const dirs = [app.getPath('desktop')];
  if (includePublic && process.platform === 'win32') {
    const pub = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');
    if (fs.existsSync(pub)) dirs.push(pub);
  }
  return dirs;
}

function readUrlFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const get = (k) => (text.match(new RegExp('^' + k + '=(.*)$', 'mi')) || [])[1];
    return { url: get('URL'), iconFile: get('IconFile') };
  } catch {
    return {};
  }
}

/** 文件/快捷方式的描述信息（不含图标） */
function describe(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const base = path.basename(file);
  const ext = path.extname(base).toLowerCase();
  const isDir = st.isDirectory();
  const item = {
    path: file,
    name: isDir || !['.lnk', '.url'].includes(ext) ? base : base.slice(0, -ext.length),
    ext: isDir ? '' : ext,
    isDir,
    kind: isDir ? '文件夹' : (KIND_LABELS[ext] || (ext ? ext.slice(1).toUpperCase() + ' 文件' : '文件')),
    mtime: st.mtimeMs,
    target: null,
  };
  if (ext === '.lnk' && process.platform === 'win32') {
    try {
      const link = shell.readShortcutLink(file);
      item.target = link.target || null;
      item.linkIcon = link.icon || null;
      if (item.target) {
        const tExt = path.extname(item.target).toLowerCase();
        item.targetExt = tExt;
        try { item.targetIsDir = fs.statSync(item.target).isDirectory(); } catch { /* 目标不存在 */ }
      }
    } catch { /* 无法解析的快捷方式 */ }
  } else if (ext === '.url') {
    const u = readUrlFile(file);
    item.target = u.url || null;
    item.urlIcon = u.iconFile || null;
  }
  return item;
}

function scan(includePublic) {
  const seen = new Set();
  const items = [];
  for (const dir of desktopDirs(includePublic)) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (IGNORED.has(name.toLowerCase()) || name.startsWith('~$')) continue;
      const item = describe(path.join(dir, name));
      if (!item) continue;
      const key = item.name.toLowerCase();
      if (seen.has(key)) continue; // 用户桌面与公共桌面同名时只保留一个
      seen.add(key);
      items.push(item);
    }
  }
  items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh-CN'));
  return items;
}

function watch(includePublic, onChange) {
  const watchers = [];
  let t = null;
  const fire = () => { clearTimeout(t); t = setTimeout(onChange, 400); };
  for (const dir of desktopDirs(includePublic)) {
    try { watchers.push(fs.watch(dir, fire)); } catch { /* 无权限 */ }
  }
  return () => watchers.forEach((w) => w.close());
}

// ---------- 图标 ----------
const iconCache = new Map();

function existing(p) {
  try { return p && fs.existsSync(p) ? p : null; } catch { return null; }
}

async function fileIcon(p) {
  const img = await app.getFileIcon(p, { size: 'normal' });
  return img.isEmpty() ? null : img;
}

/** 返回 32px 左右的 PNG dataURL；渲染进程再把它像素化成 16×16 物品贴图 */
async function getIcon(file) {
  let st = null;
  try { st = fs.statSync(file); } catch { /* 不存在的文件 */ }
  const key = file + '|' + (st ? st.mtimeMs : 0);
  if (iconCache.has(key)) return iconCache.get(key);
  let img = null;
  try {
    const ext = path.extname(file).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      try { img = await nativeImage.createThumbnailFromPath(file, { width: 64, height: 64 }); } catch { img = null; }
    } else if (ext === '.lnk' && process.platform === 'win32') {
      let link = null;
      try { link = shell.readShortcutLink(file); } catch { /* ignore */ }
      const icon = link && existing(link.icon);
      if (icon && !/\.dll$/i.test(icon)) img = await fileIcon(icon);
      if (!img && link && existing(link.target)) img = await fileIcon(link.target);
    } else if (ext === '.url') {
      const icon = existing(readUrlFile(file).iconFile);
      if (icon) img = await fileIcon(icon);
    }
    if (!img && st) img = await fileIcon(file);
  } catch (e) {
    img = null;
  }
  const url = img && !img.isEmpty() ? img.toDataURL() : null;
  iconCache.set(key, url);
  return url;
}

module.exports = { scan, watch, describe, getIcon, desktopDirs };
