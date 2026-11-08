// 首次启动：自动从 Mojang 官方服务器下载资源，并显示进度

const $ = (id) => document.getElementById(id);
const setup = window.mcd.setup;

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

function formatSpeed(bps) {
  if (!bps) return '';
  return bps >= 1048576 ? (bps / 1048576).toFixed(1) + ' MB/s' : Math.round(bps / 1024) + ' KB/s';
}

function formatEta(sec) {
  if (sec == null || !isFinite(sec)) return '';
  sec = Math.ceil(sec);
  if (sec < 60) return `剩余约 ${sec} 秒`;
  return `剩余约 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

setup.onProgress((i) => {
  const pct = Math.floor(i.percent * 100);
  $('percent').textContent = pct + '%';
  $('bar').firstElementChild.style.width = (i.percent * 100).toFixed(1) + '%';
  $('step').textContent = i.message || '';
  $('source').textContent = i.source ? '下载线路：' + i.source : '';
  if (i.stage === 'download') {
    $('size').textContent = `${mb(i.received)} / ${mb(i.total)}`;
    $('speed').textContent = [formatSpeed(i.speed), formatEta(i.eta)].filter(Boolean).join(' · ');
  } else if (i.stage === 'process') {
    $('size').textContent = `${mb(i.total)} / ${mb(i.total)}`;
    $('speed').textContent = '';
  } else if (i.stage === 'done') {
    $('step').textContent = '完成！正在进入桌面…';
    $('speed').textContent = '';
  }
});

async function start() {
  $('error').style.display = 'none';
  $('retry').style.display = 'none';
  $('bar').classList.remove('err');
  $('step').textContent = '正在连接…';
  const r = await setup.start();
  if (!r.ok) {
    $('bar').classList.add('err');
    $('step').textContent = '下载失败';
    $('speed').textContent = '';
    $('error').textContent = r.error;
    $('error').style.display = 'block';
    $('retry').style.display = 'block';
  }
}

$('retry').onclick = start;
start();
