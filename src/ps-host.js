// 常驻的隐藏 PowerShell 进程：用于读取/设置亮度、网络状态、托盘图标注册表等。
// 每次启动 PowerShell 要几百毫秒，所以只启动一次，之后通过 stdin 逐条发送脚本。

const { spawn } = require('child_process');

const MARK = '__MCD_END__';

class PsHost {
  constructor() {
    this.proc = null;
    this.queue = [];
    this.current = null;
    this.buf = '';
  }

  ensure() {
    if (this.proc) return true;
    try {
      this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      this.proc = null;
      return false;
    }
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => this.onData(d));
    this.proc.on('exit', () => this.onExit());
    this.proc.on('error', () => this.onExit());
    this.proc.stdin.on('error', () => {});
    this.proc.stdin.write('[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = "SilentlyContinue"\n');
    return true;
  }

  onData(d) {
    this.buf += d;
    for (;;) {
      const i = this.buf.indexOf(MARK);
      if (i < 0) break;
      const out = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + MARK.length).replace(/^\r?\n/, '');
      const job = this.current;
      this.current = null;
      if (job) { clearTimeout(job.timer); job.resolve(out.trim()); }
      this.next();
    }
  }

  onExit() {
    this.proc = null;
    this.buf = '';
    const jobs = [this.current, ...this.queue].filter(Boolean);
    this.current = null;
    this.queue = [];
    for (const j of jobs) { clearTimeout(j.timer); j.resolve(null); }
  }

  next() {
    if (this.current || !this.queue.length) return;
    if (!this.ensure()) { this.onExit(); return; }
    const job = this.queue.shift();
    this.current = job;
    // 脚本用 base64 传入，避免多行脚本和引号的问题
    const b64 = Buffer.from(job.script, 'utf16le').toString('base64');
    const line = `try { & ([ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))) } catch { }; [Console]::Out.WriteLine('${MARK}'); [Console]::Out.Flush()\n`;
    job.timer = setTimeout(() => {
      // 卡住了：结束进程，下次重新启动
      if (this.current === job) { try { this.proc.kill(); } catch { /* ignore */ } }
    }, job.timeout);
    this.proc.stdin.write(line);
  }

  /** 运行脚本，返回标准输出文本（失败或超时返回 null） */
  run(script, timeout = 15000) {
    return new Promise((resolve) => {
      this.queue.push({ script, resolve, timeout });
      this.next();
    });
  }

  async json(script, timeout) {
    const out = await this.run(script, timeout);
    if (!out) return null;
    try { return JSON.parse(out); } catch { return null; }
  }

  dispose() {
    if (this.proc) { try { this.proc.kill(); } catch { /* ignore */ } }
    this.proc = null;
  }
}

module.exports = { PsHost };
