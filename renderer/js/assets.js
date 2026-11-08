// 资源加载：纹理、JSON、语言文件、精灵图元数据

const BASE = 'mcd://app/assets/';
const images = new Map();
const pending = new Set();
let onLoad = () => {};

export const meta = { sprites: {}, textures: new Set() };
export let lang = {};

export function setLoadListener(fn) { onLoad = fn; }

export function loadImage(url) {
  let entry = images.get(url);
  if (entry) return entry.promise;
  entry = { img: null, failed: false };
  entry.promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { entry.img = img; pending.delete(url); resolve(img); onLoad(); };
    img.onerror = () => { entry.failed = true; pending.delete(url); resolve(null); };
    img.src = url;
  });
  pending.add(url);
  images.set(url, entry);
  return entry.promise;
}

/** 同步获取已加载的图片；尚未加载时开始加载并返回 null（加载完成后会触发重绘） */
export function image(url) {
  const e = images.get(url);
  if (e) return e.img;
  loadImage(url);
  return null;
}

export const texUrl = (p) => BASE + 'minecraft/textures/' + p + '.png';
export const spriteUrl = (name) => texUrl('gui/sprites/' + name);

export const tex = (p) => image(texUrl(p));
export const sprite = (name) => image(spriteUrl(name));
export const loadTex = (p) => loadImage(texUrl(p));
export const loadSprite = (name) => loadImage(spriteUrl(name));

export async function json(p) {
  const r = await fetch(BASE + p);
  return r.json();
}

export async function text(p) {
  const r = await fetch(BASE + p);
  return r.text();
}

export async function binary(p) {
  const r = await fetch(BASE + p);
  return r.arrayBuffer();
}

export function hasTexture(p) { return meta.textures.has(p); }

export async function init() {
  const [m, zh, en] = await Promise.all([
    json('gui-meta.json'),
    json('minecraft/lang/zh_cn.json').catch(() => ({})),
    json('minecraft/lang/en_us.json').catch(() => ({})),
  ]);
  meta.sprites = m.sprites;
  meta.textures = new Set(m.textures);
  lang = { ...en, ...zh };
}

/** 翻译：使用游戏自带的简体中文语言文件 */
export function tr(key, ...args) {
  let s = lang[key] ?? key;
  let i = 0;
  s = s.replace(/%(?:(\d+)\$)?s/g, (_, n) => String(n ? args[+n - 1] : args[i++]));
  return s;
}

export function preload(list) {
  return Promise.all(list.map((u) => loadImage(u)));
}

export function allLoaded() { return pending.size === 0; }
