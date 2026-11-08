// 生命值、饱食度、经验条（Gui.renderPlayerHealth / renderFood / renderExperienceBar）
// - 生命值 = 电量：1–5% 半颗心，6–10% 一颗心……96–100% 十颗心；没有电池时一直满血；充电时有生命恢复的波浪动画
// - 饱食度 = CPU 占用：空闲时满，占用越高越少；占用 ≥ 50% 时饱和度为 0，图标会抖动（越饿抖得越频繁）
// - 经验条 = 正在播放的声音：随音量峰值跳动

import { sprite } from './assets.js';

export const VITALS_SPRITES = [
  'hud/heart/container', 'hud/heart/container_blinking', 'hud/heart/full', 'hud/heart/half',
  'hud/heart/full_blinking', 'hud/heart/half_blinking', 'hud/food_empty', 'hud/food_half', 'hud/food_full',
  'hud/experience_bar_background', 'hud/experience_bar_progress',
];

// java.util.Random（原版用它决定心和鸡腿的抖动）
const MASK = (1n << 48n) - 1n;
class JavaRandom {
  setSeed(seed) { this.seed = (BigInt(seed) ^ 0x5deece66dn) & MASK; }
  next(bits) {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & MASK;
    return Number(this.seed >> BigInt(48 - bits)) | 0;
  }
  nextInt(bound) {
    if ((bound & (bound - 1)) === 0) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let i, j;
    do { i = this.next(31); j = i % bound; } while (((i - j + (bound - 1)) | 0) < 0);
    return j;
  }
}

const XP_DECAY = 1.5; // 声音变小时经验条每秒最多回落 1.5 个长度

export class VitalsHud {
  constructor() {
    this.health = 20; // 单位：半颗心
    this.charging = false;
    this.cpu = null; // 平滑后的 CPU 占用
    this.food = 20;
    this.peak = 0;
    this.xp = 0;
    this.lastHealth = null;
    this.displayHealth = 20;
    this.lastHealthTime = 0;
    this.healthBlinkTime = 0;
    this.tick = 0;
    this.last = performance.now();
    this.key = '';
    this.random = new JavaRandom();
  }

  /** 主进程每秒推送一次：{ cpu, battery } */
  update(v) {
    if (!v) return;
    const b = v.battery;
    this.health = b ? Math.max(0, Math.min(20, Math.ceil(b.percent / 5))) : 20;
    this.charging = !!(b && b.charging);
    this.cpu = this.cpu == null ? v.cpu : this.cpu * 0.5 + v.cpu * 0.5;
    this.food = Math.max(0, Math.min(20, Math.round((1 - this.cpu) * 20)));
    if (this.lastHealth == null) this.lastHealth = this.displayHealth = this.health; // 第一次收到数据时不闪烁
  }

  setPeak(p) {
    this.peak = Math.max(0, Math.min(1, p || 0));
  }

  get hungry() { return this.cpu != null && this.cpu >= 0.5; } // 饱和度为 0

  blinking() {
    return this.healthBlinkTime > this.tick && Math.floor((this.healthBlinkTime - this.tick) / 3) % 2 === 1;
  }

  /** 每帧调用，更新动画状态；返回 true 表示画面有变化需要重画 */
  step(now = performance.now()) {
    this.tick = Math.floor(now / 50);
    const t = this.tick;
    // 掉血（电量下降）时闪烁 1 秒，被扣掉的心先闪烁再消失
    const h = this.health;
    if (this.lastHealth != null && h < this.lastHealth) { this.lastHealthTime = now; this.healthBlinkTime = t + 20; }
    if (now - this.lastHealthTime > 1000) { this.displayHealth = h; this.lastHealthTime = now; }
    if (this.lastHealth != null) this.lastHealth = h;
    // 经验条：声音变大立即跟上，变小时逐渐回落
    const dt = Math.min(0.2, (now - this.last) / 1000);
    this.last = now;
    this.xp = this.peak >= this.xp ? this.peak : Math.max(this.peak, this.xp - dt * XP_DECAY);

    const regen = this.charging ? t % 25 : -1;
    const shake = this.hungry && t % (this.food * 3 + 1) === 0;
    const key = [h, this.displayHealth, this.blinking(), this.food, Math.min(182, Math.floor(this.xp * 183)),
      regen >= 0 && regen < 10 ? regen : -1, h <= 4 ? t : 0, shake ? t : 0].join();
    const changed = key !== this.key;
    this.key = key;
    return changed;
  }

  render(g) {
    const t = this.tick;
    const left = Math.floor(g.width / 2) - 91;
    const right = Math.floor(g.width / 2) + 91;

    // 经验条（在快捷栏上方 1 像素）
    const ey = g.height - 32 + 3;
    g.sprite('hud/experience_bar_background', left, ey, 182, 5);
    const k = Math.min(182, Math.floor(this.xp * 183));
    const prog = sprite('hud/experience_bar_progress');
    if (k > 0 && prog) g.ctx.drawImage(prog, 0, 0, k, 5, left, ey, k, 5);

    // 生命值（左）
    const y = g.height - 39;
    const h = this.health, disp = this.displayHealth;
    const blink = this.blinking();
    this.random.setSeed(Math.imul(t, 312871));
    const regen = this.charging ? t % Math.ceil(Math.max(20, disp, h) + 5) : -1;
    for (let i = 9; i >= 0; i--) {
      const hx = left + i * 8;
      let hy = y;
      if (h <= 4) hy += this.random.nextInt(2); // 只剩两颗心以下时抖动
      if (i === regen) hy -= 2;
      g.sprite(blink ? 'hud/heart/container_blinking' : 'hud/heart/container', hx, hy, 9, 9);
      const j = i * 2;
      if (blink && j < disp) g.sprite(j + 1 === disp ? 'hud/heart/half_blinking' : 'hud/heart/full_blinking', hx, hy, 9, 9);
      if (j < h) g.sprite(j + 1 === h ? 'hud/heart/half' : 'hud/heart/full', hx, hy, 9, 9);
    }

    // 饱食度（右，从右往左）
    const f = this.food;
    for (let j = 0; j < 10; j++) {
      let fy = y;
      if (this.hungry && t % (f * 3 + 1) === 0) fy = y + (this.random.nextInt(3) - 1);
      const fx = right - j * 8 - 9;
      g.sprite('hud/food_empty', fx, fy, 9, 9);
      if (j * 2 + 1 < f) g.sprite('hud/food_full', fx, fy, 9, 9);
      if (j * 2 + 1 === f) g.sprite('hud/food_half', fx, fy, 9, 9);
    }
  }
}
