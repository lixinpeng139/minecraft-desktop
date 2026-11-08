// 音效：使用游戏自带的 ogg（按钮 click_stereo、拾取 pop 等）

const BASE = 'mcd://app/assets/minecraft/sounds/';
let volumes = { master: 1, ui: 1, item: 1 };

export function setVolumes(cfg) {
  volumes = { master: cfg.masterVolume ?? 1, ui: cfg.uiVolume ?? 1, item: cfg.itemVolume ?? 1 };
}

const pool = new Map();
function audio(name) {
  let list = pool.get(name);
  if (!list) { list = []; pool.set(name, list); }
  let a = list.find((x) => x.paused || x.ended);
  if (!a) {
    a = new Audio(BASE + name + '.ogg');
    a.preservesPitch = false;
    list.push(a);
  }
  return a;
}

export function play(name, volume = 1, pitch = 1, category = 'ui') {
  const v = Math.max(0, Math.min(1, volume * volumes.master * (volumes[category] ?? 1)));
  if (v <= 0) return;
  const a = audio(name);
  a.volume = v;
  a.playbackRate = Math.max(0.5, Math.min(2, pitch));
  a.currentTime = 0;
  a.play().catch(() => {});
}

/** ui.button.click：音量 0.25，音调 1.0 */
export const click = () => play('random/click_stereo', 0.25, 1, 'ui');
/** entity.item.pickup */
export const pop = () => play('random/pop', 0.2, ((Math.random() - Math.random()) * 0.7 + 1) * 2, 'item');
export const orb = () => play('random/orb', 0.25, 0.9 + Math.random() * 0.2, 'item');
export const toastIn = () => play('ui/toast/in', 1, 1, 'ui');
export const challenge = () => play('ui/toast/challenge_complete', 1, 1, 'ui');
