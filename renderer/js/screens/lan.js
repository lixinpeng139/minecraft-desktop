// 对局域网开放：显示本机局域网地址

import { HeaderFooterScreen } from './screen.js';
import { Button } from '../widgets.js';
import { tr } from '../assets.js';

export class LanScreen extends HeaderFooterScreen {
  constructor() {
    super(tr('lanServer.title'));
    this.addresses = null;
    window.mcd.lanAddresses().then((a) => { this.addresses = a; });
  }

  build() {
    const cx = Math.floor(this.width / 2);
    this.add(new Button(cx - 155, this.height - 28, 150, 20, '复制地址', () => {
      const a = (this.addresses || [])[0];
      if (a) window.mcd.copyText(a.address);
    }));
    this.add(new Button(cx + 5, this.height - 28, 150, 20, tr('gui.cancel'), () => this.onClose()));
  }

  renderContent(g) {
    const cx = Math.floor(this.width / 2);
    g.centered(this.title, cx, 50, 0xffffff);
    g.centered('本机在局域网中的地址', cx, 82, 0xa0a0a0);
    const list = this.addresses;
    if (!list) g.centered('正在获取…', cx, 100, 0xffffff);
    else if (!list.length) g.centered('没有连接到局域网', cx, 100, 0xff5555);
    else list.slice(0, 6).forEach((a, i) => g.centered(`${a.address}  (${a.name})`, cx, 100 + i * 12, 0xffffff));
  }
}
