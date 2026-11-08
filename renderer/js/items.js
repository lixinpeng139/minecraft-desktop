// 物品图标：平面物品贴图、3D 方块（与游戏 GUI 中相同的 [30°, 225°] 等轴视角）、箱子、以及像素化的文件图标

import { tex, texUrl, loadImage, image, hasTexture } from './assets.js';

const FACE_LIGHT = { top: 1.0, left: 0.8, right: 0.6 };

// ---------- 等轴投影 ----------
// 方块坐标 (x,y,z) ∈ [0,16]，GUI 显示变换 rotation [30, 225, 0]、scale 0.625，投影到 16×16 的格子里。
// 可见面：顶面、东面（屏幕左侧）、北面（屏幕右侧，即“正面”）。
function project(x, y, z) {
  const X = x / 16 - 0.5, Y = y / 16 - 0.5, Z = z / 16 - 0.5;
  const c = Math.SQRT1_2 * 10;
  return [8 - c * (X + Z), 8 - 8.660254 * Y + (c / 2) * (X - Z)];
}

/** 把纹理区域仿射映射到由 TL/TR/BL 三个 3D 点确定的平行四边形上 */
function drawFace(ctx, s, img, region, tl, tr, bl, light) {
  if (!img) return;
  const r = region || { x: 0, y: 0, w: img.width, h: Math.min(img.width, img.height) };
  let [p0, p1, p2] = [project(...tl), project(...tr), project(...bl)];
  if (r.flipV) {
    // 垂直翻转：原点移到左下角
    const p3 = [p1[0] + p2[0] - p0[0], p1[1] + p2[1] - p0[1]];
    [p0, p1, p2] = [p2, p3, p0];
  }
  // 稍微外扩，消除相邻面之间的缝隙
  const e = 0.02;
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], vx = p2[0] - p0[0], vy = p2[1] - p0[1];
  ctx.save();
  ctx.setTransform(
    s * ux * (1 + 2 * e) / r.w, s * uy * (1 + 2 * e) / r.w,
    s * vx * (1 + 2 * e) / r.h, s * vy * (1 + 2 * e) / r.h,
    s * (p0[0] - e * (ux + vx)), s * (p0[1] - e * (uy + vy)),
  );
  ctx.filter = light < 1 ? `brightness(${light})` : 'none';
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  ctx.restore();
}

/** 长方体：from/to 为方块坐标，faces = { top, east, north }，每个为 {img, region} */
function drawBox(ctx, s, from, to, faces) {
  const [x0, y0, z0] = from, [x1, y1, z1] = to;
  if (faces.east) drawFace(ctx, s, faces.east.img, faces.east.region, [x1, y1, z1], [x1, y1, z0], [x1, y0, z1], FACE_LIGHT.left);
  if (faces.north) drawFace(ctx, s, faces.north.img, faces.north.region, [x1, y1, z0], [x0, y1, z0], [x1, y0, z0], FACE_LIGHT.right);
  if (faces.top) drawFace(ctx, s, faces.top.img, faces.top.region, [x0, y1, z0], [x1, y1, z0], [x0, y1, z1], FACE_LIGHT.top);
}

// ---------- 着色（草方块的群系颜色） ----------
let grassColor = null;
function getGrassColor() {
  if (grassColor) return grassColor;
  const img = tex('colormap/grass');
  if (!img) return '#91bd59';
  const c = new OffscreenCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  // GrassColor.get(0.5, 1.0) → 色图坐标 (127, 127)
  const d = cx.getImageData(127, 127, 1, 1).data;
  grassColor = `rgb(${d[0]},${d[1]},${d[2]})`;
  return grassColor;
}

const tintCache = new Map();
function tinted(path, color) {
  const key = path + '|' + color;
  if (tintCache.has(key)) return tintCache.get(key);
  const img = tex(path);
  if (!img) return null;
  const c = new OffscreenCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  cx.globalCompositeOperation = 'multiply';
  cx.fillStyle = color;
  cx.fillRect(0, 0, c.width, c.height);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(img, 0, 0);
  tintCache.set(key, c);
  return c;
}

/** 方块面贴图：字符串路径，或 [路径, 'grass'] 表示需要群系着色，或数组的数组表示多层叠加 */
function faceImage(spec) {
  if (!spec) return null;
  if (typeof spec === 'string') return tex(spec);
  if (spec.length === 2 && typeof spec[0] === 'string' && spec[1] === 'grass') return tinted(spec[0], getGrassColor());
  // 多层
  const layers = spec.map(faceImage);
  if (layers.some((l) => !l)) return null;
  const c = new OffscreenCanvas(layers[0].width, layers[0].width);
  const cx = c.getContext('2d');
  for (const l of layers) cx.drawImage(l, 0, 0, l.width, l.width, 0, 0, c.width, c.height);
  return c;
}

function facePaths(spec) {
  if (!spec) return [];
  if (typeof spec === 'string') return [spec];
  if (spec.length === 2 && spec[1] === 'grass') return [spec[0], 'colormap/grass'];
  return spec.flatMap(facePaths);
}

// ---------- 图标类型 ----------
class FlatIcon {
  constructor(path) { this.path = path; }
  ready() { return !!tex(this.path); }
  draw(g, x, y) {
    const img = tex(this.path);
    if (!img) return;
    // 动画贴图（竖条）只取第一帧
    g.ctx.drawImage(img, 0, 0, img.width, img.width, x, y, 16, 16);
  }
}

/** 3D 图标统一按当前 guiScale 渲染到离屏画布并缓存 */
class RenderedIcon {
  constructor() { this.cache = new Map(); }
  draw(g, x, y) {
    const s = g.scale;
    let c = this.cache.get(s);
    if (!c) {
      if (!this.ready()) return;
      c = new OffscreenCanvas(16 * s, 16 * s);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      this.render(ctx, s);
      this.cache.set(s, c);
    }
    g.ctx.drawImage(c, x, y, 16, 16);
  }
}

class BlockIcon extends RenderedIcon {
  constructor(faces) {
    super();
    this.faces = faces; // { top, left, right } 或 { top, side } 或 { all }
  }
  spec(k) {
    const f = this.faces;
    return f[k] || f.side || f.all;
  }
  ready() {
    return ['top', 'left', 'right'].every((k) => facePaths(k === 'top' ? (this.faces.top || this.faces.all) : this.spec(k)).every((p) => tex(p)));
  }
  render(ctx, s) {
    const img = (k) => {
      const i = faceImage(k === 'top' ? (this.faces.top || this.faces.all) : this.spec(k));
      return i && { img: i, region: { x: 0, y: 0, w: i.width, h: i.width } };
    };
    drawBox(ctx, s, [0, 0, 0], [16, 16, 16], { top: img('top'), east: img('left'), north: img('right') });
  }
}

/** 箱子（方块实体模型，贴图为 1.15+ 的竖直翻转布局）。正面（锁扣）朝右，与游戏中一致 */
class ChestIcon extends RenderedIcon {
  constructor(path) { super(); this.path = path; }
  ready() { return !!tex(this.path); }
  render(ctx, s) {
    const img = tex(this.path);
    const R = (x, y, w, h, flipV = true) => ({ img, region: { x, y, w, h, flipV } });
    // 底座 14×10×14
    drawBox(ctx, s, [1, 0, 1], [15, 10, 15], { east: R(28, 33, 14, 10), north: R(42, 33, 14, 10) });
    // 盖子 14×5×14
    drawBox(ctx, s, [1, 9, 1], [15, 14, 15], { top: R(28, 0, 14, 14, false), east: R(28, 14, 14, 5), north: R(42, 14, 14, 5) });
    // 锁扣 2×4×1
    drawBox(ctx, s, [7, 7, 0], [9, 11, 1], { top: R(3, 0, 2, 1, false), east: R(3, 1, 1, 4), north: R(4, 1, 2, 4) });
  }
}

/** 文件图标：像素化到 16×16（pixel）或保持原始清晰度（system） */
class FileIcon {
  constructor(dataUrl, mode) {
    this.mode = mode;
    this.url = dataUrl;
    this.pixel = null;
    loadImage(dataUrl).then((img) => {
      if (!img) return;
      const c = new OffscreenCanvas(16, 16);
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      const k = Math.min(16 / img.width, 16 / img.height);
      const w = img.width * k, h = img.height * k;
      cx.drawImage(img, (16 - w) / 2, (16 - h) / 2, w, h);
      // 二值化透明度，得到干净的像素边缘（与物品贴图一致）
      const d = cx.getImageData(0, 0, 16, 16);
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] < 100 ? 0 : 255;
      cx.putImageData(d, 0, 0);
      this.pixel = c;
    });
  }
  ready() { return !!this.pixel; }
  draw(g, x, y) {
    if (this.mode === 'system') {
      const img = image(this.url);
      if (!img) return;
      g.ctx.imageSmoothingEnabled = true;
      g.ctx.imageSmoothingQuality = 'high';
      g.ctx.drawImage(img, x, y, 16, 16);
      g.ctx.imageSmoothingEnabled = false;
    } else if (this.pixel) {
      g.ctx.drawImage(this.pixel, x, y, 16, 16);
    }
  }
}

// ---------- 图标目录 ----------
// 方块
const B = {
  grass_block: { top: ['block/grass_block_top', 'grass'], side: [['block/grass_block_side'], ['block/grass_block_side_overlay', 'grass']] },
  crafting_table: { top: 'block/crafting_table_top', left: 'block/crafting_table_side', right: 'block/crafting_table_front' },
  furnace: { top: 'block/furnace_top', left: 'block/furnace_side', right: 'block/furnace_front' },
  bookshelf: { top: 'block/oak_planks', side: 'block/bookshelf' },
  jukebox: { top: 'block/jukebox_top', side: 'block/jukebox_side' },
  note_block: { all: 'block/note_block' },
  tnt: { top: 'block/tnt_top', side: 'block/tnt_side' },
  command_block: { top: 'block/command_block_side', left: 'block/command_block_side', right: 'block/command_block_front' },
  oak_log: { top: 'block/oak_log_top', side: 'block/oak_log' },
  oak_planks: { all: 'block/oak_planks' },
  stone: { all: 'block/stone' },
  cobblestone: { all: 'block/cobblestone' },
  dirt: { all: 'block/dirt' },
  bricks: { all: 'block/bricks' },
  diamond_block: { all: 'block/diamond_block' },
  gold_block: { all: 'block/gold_block' },
  emerald_block: { all: 'block/emerald_block' },
  redstone_block: { all: 'block/redstone_block' },
  lapis_block: { all: 'block/lapis_block' },
  obsidian: { all: 'block/obsidian' },
  glowstone: { all: 'block/glowstone' },
  redstone_lamp: { all: 'block/redstone_lamp_on' },
  pumpkin: { top: 'block/pumpkin_top', side: 'block/pumpkin_side' },
  jack_o_lantern: { top: 'block/pumpkin_top', left: 'block/pumpkin_side', right: 'block/jack_o_lantern' },
  melon: { top: 'block/melon_top', side: 'block/melon_side' },
  hay_block: { top: 'block/hay_block_top', side: 'block/hay_block_side' },
  barrel: { top: 'block/barrel_top', side: 'block/barrel_side' },
  sponge: { all: 'block/sponge' },
  beehive: { top: 'block/beehive_end', left: 'block/beehive_side', right: 'block/beehive_front' },
  dispenser: { top: 'block/furnace_top', left: 'block/furnace_side', right: 'block/dispenser_front' },
  smithing_table: { top: 'block/smithing_table_top', left: 'block/smithing_table_side', right: 'block/smithing_table_front' },
  cartography_table: { top: 'block/cartography_table_top', left: 'block/cartography_table_side3', right: 'block/cartography_table_side1' },
  loom: { top: 'block/loom_top', left: 'block/loom_side', right: 'block/loom_front' },
  target: { top: 'block/target_top', side: 'block/target_side' },
  sculk: { all: 'block/sculk' },
  amethyst_block: { all: 'block/amethyst_block' },
  ice: { all: 'block/ice' },
  snow_block: { all: 'block/snow' },
};

// 平面物品（标签页图标的候选）
const ITEMS = [
  'compass_16', 'clock_00', 'diamond_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'netherite_pickaxe', 'diamond_axe',
  'diamond_shovel', 'diamond_hoe', 'diamond_sword', 'netherite_sword', 'bow', 'crossbow_standby', 'trident', 'fishing_rod',
  'shears', 'flint_and_steel', 'brush', 'spyglass', 'writable_book', 'written_book', 'book', 'enchanted_book',
  'knowledge_book', 'paper', 'map', 'painting', 'item_frame', 'glow_item_frame', 'armor_stand', 'oak_sign',
  'music_disc_cat', 'music_disc_13', 'music_disc_pigstep', 'music_disc_otherside', 'music_disc_relic', 'goat_horn', 'bell',
  'redstone', 'repeater', 'comparator', 'hopper', 'lantern', 'campfire', 'emerald', 'diamond', 'gold_ingot', 'iron_ingot',
  'netherite_ingot', 'lapis_lazuli', 'amethyst_shard', 'apple', 'golden_apple', 'bread', 'cookie', 'cake', 'sweet_berries',
  'ender_pearl', 'ender_eye', 'nether_star', 'totem_of_undying', 'heart_of_the_sea', 'name_tag', 'firework_rocket',
  'experience_bottle', 'minecart', 'oak_boat', 'saddle', 'elytra', 'bucket', 'water_bucket', 'lava_bucket', 'feather',
  'bone', 'slime_ball', 'egg', 'snowball', 'recovery_compass_00', 'echo_shard', 'filled_map', 'flower_pot', 'barrier',
];

const CHESTS = { chest: 'entity/chest/normal', ender_chest: 'entity/chest/ender', trapped_chest: 'entity/chest/trapped' };

const iconCache = new Map();

/** 根据 id 取图标：方块、箱子或 item/ 下的平面贴图 */
export function itemIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  let icon = null;
  if (B[id]) icon = new BlockIcon(B[id]);
  else if (CHESTS[id]) icon = new ChestIcon(CHESTS[id]);
  else if (id === 'compass') icon = new FlatIcon('item/compass_16');
  else if (id === 'clock') icon = new FlatIcon('item/clock_00');
  else if (hasTexture('item/' + id)) icon = new FlatIcon('item/' + id);
  else if (hasTexture('block/' + id)) icon = new BlockIcon({ all: 'block/' + id });
  else icon = new FlatIcon('item/barrier');
  iconCache.set(id, icon);
  return icon;
}

/** 可供标签页选择的图标列表 */
export function iconCatalog() {
  const blocks = ['grass_block', 'crafting_table', 'furnace', 'bookshelf', 'jukebox', 'note_block', 'tnt', 'command_block',
    'chest', 'ender_chest', 'barrel', 'oak_log', 'oak_planks', 'stone', 'cobblestone', 'bricks', 'diamond_block', 'gold_block',
    'emerald_block', 'redstone_block', 'redstone_lamp', 'obsidian', 'glowstone', 'pumpkin', 'jack_o_lantern', 'melon',
    'hay_block', 'beehive', 'smithing_table', 'loom', 'target', 'amethyst_block', 'sculk', 'ice'];
  const items = ITEMS.map((i) => i.replace(/_16$|_00$/, (m) => (i.startsWith('compass') || i.startsWith('clock') ? '' : m)));
  return [...items, ...blocks].filter((id, i, a) => a.indexOf(id) === i && (B[id] || CHESTS[id] || id === 'compass' || id === 'clock' || hasTexture('item/' + id)));
}

/** 标签页图标描述 → 图标对象 */
export function tabIcon(spec) {
  if (!spec) return itemIcon('chest');
  if (spec.type === 'image' && spec.data) {
    const key = 'img:' + spec.data.slice(-64);
    if (!iconCache.has(key)) iconCache.set(key, new FileIcon(spec.data, 'pixel'));
    return iconCache.get(key);
  }
  return itemIcon(spec.id || 'chest');
}

// ---------- 文件 → 物品 ----------
const TYPE_ICONS = [
  [/^(png|jpe?g|gif|bmp|webp|ico|svg|psd)$/, 'painting'],
  [/^(mp3|flac|wav|ogg|m4a|aac|wma|ape)$/, 'music_disc_cat'],
  [/^(mp4|mkv|avi|mov|wmv|flv|webm|m4v|rmvb)$/, 'item_frame'],
  [/^(txt|md|log|rtf|doc|docx|odt|wps)$/, 'writable_book'],
  [/^(pdf|epub|mobi)$/, 'book'],
  [/^(xls|xlsx|csv|et)$/, 'map'],
  [/^(ppt|pptx|key|dps)$/, 'oak_sign'],
  [/^(zip|rar|7z|tar|gz|bz2|xz)$/, 'barrel'],
  [/^(iso|img|vhd|vhdx)$/, 'ender_chest'],
  [/^(exe|msi|appx|msix)$/, 'command_block'],
  [/^(bat|cmd|ps1|sh|vbs)$/, 'redstone'],
  [/^(js|ts|py|java|c|cpp|h|cs|go|rs|html|css|json|xml|yml|yaml)$/, 'comparator'],
  [/^(url|website)$/, 'ender_eye'],
  [/^(jar|mcworld|mcpack|mrpack)$/, 'grass_block'],
];

function minecraftIconFor(item) {
  if (!item) return 'barrier';
  if (item.isDir || item.targetIsDir) return 'chest';
  const ext = ((item.ext === '.lnk' ? item.targetExt : item.ext) || item.ext || '').replace('.', '');
  for (const [re, id] of TYPE_ICONS) if (re.test(ext)) return id;
  return 'paper';
}

const fileIconCache = new Map();
const fileIconPending = new Set();
let redraw = () => {};
export function setIconListener(fn) { redraw = fn; }

/** 桌面物品的图标（异步获取系统图标，期间先显示 Minecraft 风格的占位物品） */
export function fileItemIcon(item, style) {
  if (!item || item.missing) return itemIcon('barrier');
  if (style === 'minecraft') return itemIcon(minecraftIconFor(item));
  // 文件夹用箱子表示（系统的小号文件夹图标像素化后难以辨认）
  if (style === 'pixel' && (item.isDir || item.targetIsDir)) return itemIcon('chest');
  const key = item.path + '|' + (item.mtime || 0) + '|' + style;
  const hit = fileIconCache.get(key);
  if (hit) return hit.ready() ? hit : itemIcon(minecraftIconFor(item));
  if (!fileIconPending.has(key)) {
    fileIconPending.add(key);
    window.mcd.getIcon(item.path).then((url) => {
      fileIconPending.delete(key);
      if (!url) { fileIconCache.set(key, itemIcon(minecraftIconFor(item))); redraw(); return; }
      const icon = new FileIcon(url, style);
      fileIconCache.set(key, icon);
      loadImage(url).then(() => setTimeout(redraw, 0));
    });
  }
  return itemIcon(minecraftIconFor(item));
}

/** 预加载一批贴图，避免首帧缺图 */
export function preloadIcons(ids) {
  const paths = new Set(['colormap/grass', 'item/barrier']);
  for (const id of ids) {
    if (B[id]) {
      for (const v of Object.values(B[id])) facePaths(v).forEach((p) => paths.add(p));
    } else if (CHESTS[id]) paths.add(CHESTS[id]);
    else if (id === 'compass') paths.add('item/compass_16');
    else if (id === 'clock') paths.add('item/clock_00');
    else paths.add('item/' + id);
  }
  return Promise.all([...paths].map((p) => loadImage(texUrl(p))));
}
