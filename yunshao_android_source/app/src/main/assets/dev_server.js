const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ASSETS_DIR = __dirname;
const PORT = 8899;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const MOCK_BRIDGE = `
<!-- 本地开发 Mock：模拟 Android 原生桥接 -->
<script>
window.YunShaoNative = {
  hideSystemUI: function() { console.log('[Mock] hideSystemUI'); },
  showSystemUI: function() { console.log('[Mock] showSystemUI'); },
  enterFullscreen: function(isPortrait) {
    console.log('[Mock] enterFullscreen, isPortrait:', isPortrait);
    // Web 端直接走 CSS 全屏，模拟 Android 端 Native 回调
    if (typeof applyFullscreenCSS === 'function') applyFullscreenCSS();
  },
  exitFullscreen: function() {
    console.log('[Mock] exitFullscreen');
    // Web 端直接走 CSS 退出全屏
    if (typeof removeFullscreenCSS === 'function') removeFullscreenCSS();
  },
  setOrientation: function(o) { console.log('[Mock] setOrientation:', o); },
  isTvDevice: function() { return false; },
  getDeviceInfo: function() { return '{}'; },
  playExternal: function(url) { console.log('[Mock] playExternal:', url); },
  updateStatusBar: function(show) { console.log('[Mock] updateStatusBar:', show); },
};
// 模拟全屏 API
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    if (typeof isCSSFullscreen !== 'undefined' && isCSSFullscreen) {
      if (typeof removeFullscreenCSS === 'function') removeFullscreenCSS();
    }
  }
});
console.log('[Mock] YunShaoNative bridge injected');
</script>
`;

// ========== 真实采集源列表 (来自 YunShaoServer.java) ==========
const BUILTIN_SOURCES = [
  {id: 1, name: "爱奇艺", url: "https://iqiyizyapi.com/api.php/provide/vod/"},
  {id: 2, name: "虎牙",   url: "https://www.huyaapi.com/api.php/provide/vod/"},
  {id: 3, name: "极速",   url: "https://jszyapi.com/api.php/provide/vod/"},
  {id: 4, name: "猫眼",   url: "https://api.maoyanapi.top/api.php/provide/vod/"},
  {id: 5, name: "暴风",   url: "https://bfzyapi.com/api.php/provide/vod/"},
  {id: 6, name: "量子",   url: "https://cj.lziapi.com/api.php/provide/vod/"},
  {id: 7, name: "光速",   url: "https://api.guangsuapi.com/api.php/provide/vod/"},
];

// ========== HTTP 代理工具 ==========
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';

function proxyUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('https') ? https : http;
    const opts = {headers: {'User-Agent': UA, 'Accept': 'application/json'}};
    const req = mod.get(urlStr, opts, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const raw = Buffer.concat(chunks);
        // 尝试 UTF-8，失败则 GBK
        let text = raw.toString('utf8');
        if (text.indexOf('�') >= 0 || !isPrintable(text.slice(0, 50))) {
          try { text = raw.toString('gbk'); } catch(e) {}
        }
        resolve(text);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function isPrintable(s) {
  for (let i = 0; i < Math.min(s.length, 20); i++) {
    const c = s.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return false;
  }
  return true;
}

// ========== API 路由处理 ==========
async function handleApi(parsed, res) {
  const pathname = parsed.pathname;
  const query = parsed.query;

  try {
    // 1. /api/sources → 返回内置采集源
    if (pathname === '/api/sources') {
      const srcs = BUILTIN_SOURCES.map(s => ({name: s.name, url: s.url, disabled: false}));
      return sendJson(res, {sources: srcs});
    }

    // 2. /api/home → 从第一个可用源获取首页数据
    if (pathname === '/api/home') {
      const src = BUILTIN_SOURCES[0]; // 爱奇艺
      const data = await proxyUrl(src.url + '?ac=detail&pg=1');
      const json = JSON.parse(data);
      // 转换为首页格式
      const list = (json.list || []).slice(0, 30);
      const hot = list.filter(it => it.type_name && it.type_name.includes('电影')).slice(0, 10);
      return sendJson(res, {
        hot: list.map(it => ({vod_id: it.vod_id, vod_name: it.vod_name, vod_pic: it.vod_pic, vod_remarks: it.vod_remarks})),
        movie: hot,
        tv: list.filter(it => it.type_name && (it.type_name.includes('电视') || it.type_name.includes('剧'))).slice(0, 10),
        short: []
      });
    }

    // 3. /api/search → 多源并发搜索
    if (pathname === '/api/search') {
      const wd = query.wd || '';
      const results = await Promise.allSettled(
        BUILTIN_SOURCES.slice(0, 3).map(src =>
          proxyUrl(src.url + '?ac=detail&wd=' + encodeURIComponent(wd))
        )
      );
      const allList = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          try {
            const j = JSON.parse(r.value);
            if (j.list) allList.push(...j.list);
          } catch(e) {}
        }
      });
      return sendJson(res, {list: allList.slice(0, 60), total: allList.length});
    }

    // 4. /api/search/source → 按指定源搜索
    if (pathname === '/api/search/source') {
      const targetUrl = query.url;
      const wd = query.wd || '';
      if (!targetUrl) return sendJson(res, {list: [], total: 0});
      const raw = await proxyUrl(targetUrl + '?ac=detail&wd=' + encodeURIComponent(wd));
      const json = JSON.parse(raw);
      return sendJson(res, json);
    }

    // 5. /api/video/detail → 按 source_id 获取详情
    if (pathname === '/api/video/detail') {
      const sourceId = parseInt(query.source_id) || 0;
      const ids = query.ids || '';
      const src = BUILTIN_SOURCES.find(s => s.id === sourceId) || BUILTIN_SOURCES[0];
      const raw = await proxyUrl(src.url + '?ac=detail&ids=' + encodeURIComponent(ids));
      const json = JSON.parse(raw);
      return sendJson(res, {list: json.list || []});
    }

    // 6. /api/video/detail/url → 按指定 URL 获取详情
    if (pathname === '/api/video/detail/url') {
      const targetUrl = query.url;
      const ids = query.ids || '';
      if (!targetUrl) return sendJson(res, {list: []});
      const raw = await proxyUrl(targetUrl + '?ac=detail&ids=' + encodeURIComponent(ids));
      const json = JSON.parse(raw);
      return sendJson(res, {list: json.list || []});
    }

    // 7. /api/category → 分类数据
    if (pathname === '/api/category') {
      const pg = query.pg || 1;
      const src = BUILTIN_SOURCES[0];
      const raw = await proxyUrl(src.url + '?ac=detail&pg=' + pg);
      const json = JSON.parse(raw);
      return sendJson(res, {
        list: (json.list || []).slice(0, 30),
        total: json.total || 0,
        pg: parseInt(pg),
        hasMore: json.list && json.list.length >= 30
      });
    }

    // 8. /api/live/fetch → 直播源代理
    if (pathname === '/api/live/fetch') {
      const targetUrl = query.url;
      if (!targetUrl) return sendJson(res, {error: 'no url'});
      const raw = await proxyUrl(targetUrl);
      const ct = raw.trim().startsWith('#EXTM3U') ? 'application/x-mpegurl; charset=utf-8'
              : raw.trim().startsWith('{') ? 'application/json; charset=utf-8'
              : 'text/plain; charset=utf-8';
      res.writeHead(200, {'Content-Type': ct, 'Access-Control-Allow-Origin': '*'});
      res.end(raw);
      return;
    }

    // 9. /api/hot → 热搜关键词（简单实现）
    if (pathname === '/api/hot') {
      return sendJson(res, {keywords: ["热门推荐", "最新电影", "电视剧", "综艺", "动漫"]});
    }

    // 未匹配的 API
    sendJson(res, {error: 'unknown api: ' + pathname});

  } catch(e) {
    console.error('[API Error]', pathname, e.message);
    sendJson(res, {list: [], total: 0, error: e.message});
  }
}

function sendJson(res, obj) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=60',
  });
  res.end(JSON.stringify(obj));
}

// ========== 静态文件服务 ==========
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    return handleApi(parsed, res);
  }

  let filePath = path.join(ASSETS_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(ASSETS_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    let body = data;
    if (ext === '.html') {
      body = data.toString().replace('</head>', MOCK_BRIDGE + '\n</head>');
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('✅ 云梢本地开发服务器启动 (反向代理模式)');
  console.log('🖥️  电脑浏览器:  http://localhost:' + PORT + '/index.html');
  try {
    const os = require('os');
    Object.values(os.networkInterfaces()).flat()
      .filter(n => n.family === 'IPv4' && !n.internal)
      .forEach(n => console.log('📱  手机访问:   http://' + n.address + ':' + PORT + '/index.html'));
  } catch(e) {}
  console.log('💡  所有 /api/ 请求已代理到真实外部采集源');
  console.log('⏹️  按 Ctrl+C 停止');
});
