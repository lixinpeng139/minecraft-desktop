// 生命值 / 饱食度 / 经验条的数据来源（主进程）：
// - 电量 → 生命值（没有电池时为 null，界面上显示满血）
// - CPU 占用 → 饱食度
// - 播放声音的峰值 → 经验条
// 电量和 CPU 每秒推送一次，声音峰值约每秒 30 次（只在数值变化时发送）。

const os = require('os');
const status = require('./sys-status');

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

class Vitals {
  /** send(channel, data)：发给桌面窗口；paused()：返回 true 时暂停采样（例如全屏程序在前台） */
  constructor(send, paused = () => false) {
    this.send = send;
    this.paused = paused;
    this.timers = [];
    this.lastCpu = cpuTimes();
    this.lastPeak = -1;
    this.state = null;
  }

  start() {
    if (this.timers.length) return;
    this.sample();
    this.timers.push(setInterval(() => this.sample(), 1000));
    this.timers.push(setInterval(() => this.samplePeak(), 33));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  sample() {
    const now = cpuTimes();
    const dt = now.total - this.lastCpu.total;
    const cpu = dt > 0 ? Math.max(0, Math.min(1, 1 - (now.idle - this.lastCpu.idle) / dt)) : 0;
    this.lastCpu = now;
    let battery = null;
    try { battery = status.battery(); } catch { /* 忽略 */ }
    this.state = { cpu, battery };
    if (!this.paused()) this.send('vitals', this.state);
  }

  samplePeak() {
    if (this.paused()) return;
    let p = null;
    try { p = status.audioPeak(); } catch { /* 忽略 */ }
    if (p == null) p = 0;
    // 安静时不重复发送 0
    if (Math.abs(p - this.lastPeak) < 0.005) return;
    this.lastPeak = p;
    this.send('vitals:peak', p);
  }

  get() {
    return this.state;
  }
}

module.exports = { Vitals };
