#!/usr/bin/env python3
"""
云梢桌面测试服务器 - 替代 YunShaoServer.java 的 Python 实现
监听 8989 端口，提供 API 代理 + 静态文件服务，绕过浏览器 CORS 限制
"""
import json
import urllib.request
import urllib.error
import http.server
import os
import sys
import io
import time
import re

PORT = 8989

# 默认采集源（与 YunShaoServer.java 一致）
DEFAULT_SOURCES = [
    {"id": 1, "name": "爱奇艺", "api_url": "https://iqiyizyapi.com/api.php/provide/vod/", "enabled": True},
    {"id": 2, "name": "虎牙", "api_url": "https://www.huyaapi.com/api.php/provide/vod/", "enabled": True},
    {"id": 3, "name": "极速", "api_url": "https://jszyapi.com/api.php/provide/vod/", "enabled": True},
    {"id": 4, "name": "猫眼", "api_url": "https://api.maoyanapi.top/api.php/provide/vod/", "enabled": True},
    {"id": 5, "name": "暴风", "api_url": "https://bfzyapi.com/api.php/provide/vod/", "enabled": True},
    {"id": 6, "name": "量子", "api_url": "https://cj.lziapi.com/api.php/provide/vod/", "enabled": True},
    {"id": 7, "name": "光速", "api_url": "https://api.guangsuapi.com/api.php/provide/vod/", "enabled": True},
]

custom_sources = []
home_cache = None
home_cache_time = 0
HOME_CACHE_TTL = 300  # 5分钟

class YunShaoHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/'):
            self.handle_api()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/sources/sync':
            content_length = int(self.headers['Content-Length'])
            body = self.rfile.read(content_length).decode('utf-8')
            self.handle_sources_sync(body)
        else:
            self.send_error(404)

    def handle_api(self):
        path = self.path
        try:
            if path == '/api/sources':
                # 去重合并：按 api_url 去重，custom_sources 优先
                seen_urls = set()
                merged = []
                for src in custom_sources + DEFAULT_SOURCES:
                    url = src.get('api_url', src.get('url', ''))
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        merged.append(src)
                self._json_response({"sources": merged})
            elif path == '/api/home':
                self.handle_home()
            elif path.startswith('/api/category'):
                self.handle_category()
            elif path.startswith('/api/search/source'):
                self.handle_search_source()
            elif path.startswith('/api/live/fetch'):
                self.handle_live_fetch()
            elif path.startswith('/api/hot'):
                self._json_response({"keywords": ["哪吒之魔童闹海", "封神第二部", "庆余年3", "长相思2", "与凤行"]})
            else:
                self._json_response({"error": "not found"}, 404)
        except Exception as e:
            self._json_response({"error": str(e)}, 500)

    def handle_home(self):
        global home_cache, home_cache_time
        now = time.time()
        if home_cache and (now - home_cache_time) < HOME_CACHE_TTL:
            self._json_response(json.loads(home_cache))
            return

        all_sources = DEFAULT_SOURCES + custom_sources
        all_items = []
        seen = set()

        # 只取前 3 个启用的源，各取 1 页
        count = 0
        for src in all_sources:
            if not src.get('enabled', True):
                continue
            if count >= 3:
                break
            api_url = src.get('api_url', '')
            if not api_url:
                continue
            count += 1
            try:
                data = self._fetch_url(api_url + '?ac=detail&pg=1')
                if data and 'list' in data:
                    for item in data['list']:
                        key = f"{item.get('vod_name','')}_{item.get('vod_id','')}"
                        if key not in seen:
                            seen.add(key)
                            item['source_url'] = api_url
                            item['source_name'] = src.get('name', '')
                            all_items.append(item)
            except Exception:
                pass

        # 智能分类
        result = self._classify_items(all_items)
        home_cache = json.dumps(result)
        home_cache_time = time.time()
        self._json_response(result)

    def handle_category(self):
        from urllib.parse import urlparse, parse_qs
        import concurrent.futures
        import threading

        qs = parse_qs(urlparse(self.path).query)
        pg = int(qs.get('pg', ['1'])[0])
        type_id = int(qs.get('type', ['0'])[0])
        smart = qs.get('smart', ['0'])[0]

        all_sources = DEFAULT_SOURCES + custom_sources
        all_items = []
        seen = set()
        lock = threading.Lock()

        def fetch_source(url, src_name):
            local_items = []
            try:
                data = self._fetch_url(url, timeout=6)
                if data and 'list' in data:
                    for item in data['list']:
                        key = f"{item.get('vod_name','')}_{item.get('vod_id','')}"
                        item['source_url'] = api_url
                        item['source_name'] = src_name
                        local_items.append((key, item))
            except Exception:
                pass
            return local_items

        # 并行请求前 5 个源，每源 2 页，8 秒超时收集
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = []
            for src in all_sources[:3]:
                api_url = src.get('api_url', '')
                if not api_url:
                    continue
                for p in range(1, 3):
                    futures.append(executor.submit(fetch_source, f"{api_url}?ac=detail&pg={p}", src.get('name', '')))

            for future in concurrent.futures.as_completed(futures, timeout=8):
                try:
                    result = future.result()
                    for key, item in result:
                        if key not in seen:
                            seen.add(key)
                            all_items.append(item)
                except Exception:
                    pass

        # 用智能分类过滤
        target_map = {1: 'movie', 2: 'tv', 3: 'variety', 4: 'anime', 5: 'short'}
        target = target_map.get(type_id, '')
        filtered = []
        for item in all_items:
            cat = self._classify_item(item)
            if type_id == 0:
                filtered.append(item)
            elif cat == target or (smart == '1' and cat == target):
                filtered.append(item)
            elif smart == '1' and type_id == 0 and cat is not None:
                # smart=1 & type=0: 全量返回
                filtered.append(item)

        # 如果过滤结果太少，从未分类中补充（轮询分配，避免空分类）
        if len(filtered) < 5 and len(all_items) > 0:
            # 把未进入分类的补充进来
            classified_set = set(id(item) for item in filtered)
            for item in all_items:
                if id(item) not in classified_set and len(filtered) < 30:
                    filtered.append(item)

        page_size = 30
        start = (pg - 1) * page_size
        paged = filtered[start:start + page_size]
        self._json_response({"list": paged, "total": len(filtered), "page": pg})

    def handle_search_source(self):
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(self.path).query)
        url = qs.get('url', [''])[0]
        wd = qs.get('wd', [''])[0]
        if not url or not wd:
            self._json_response({"list": []})
            return
        try:
            # 用 wd 参数搜索
            search_url = url.rstrip('/') + f'/?ac=videolist&wd={urllib.parse.quote(wd)}'
            data = self._fetch_url(search_url)
            if data and 'list' in data:
                self._json_response({"list": data['list']})
            else:
                self._json_response({"list": []})
        except Exception:
            self._json_response({"list": []})

    def handle_live_fetch(self):
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(self.path).query)
        url = qs.get('url', [''])[0]
        if not url:
            self._json_response({"error": "no url"})
            return
        try:
            data = self._fetch_text(url)
            self._json_response({"data": data, "urls": []})
        except Exception:
            self._json_response({"data": "", "urls": []})

    def handle_sources_sync(self, body):
        global custom_sources
        try:
            new_sources = json.loads(body)
            default_urls = {s.get('api_url', s.get('url','')) for s in DEFAULT_SOURCES}
            # 只保留非默认源（避免与 DEFAULT_SOURCES 重复）
            filtered = []
            for src in new_sources:
                url = src.get('api_url', src.get('url', ''))
                if url not in default_urls:
                    src['id'] = src.get('id', 100 + len(filtered))
                    if 'api_url' not in src and 'url' in src:
                        src['api_url'] = src['url']
                    filtered.append(src)
            custom_sources = filtered
            self._json_response({"ok": True, "count": len(custom_sources)})
        except Exception as e:
            self._json_response({"error": str(e)}, 400)

    def _classify_item(self, item):
        """智能分类：判断一条视频属于哪个分类"""
        tn = (item.get('type_name', '') or '').lower()
        cls = (item.get('vod_class', '') or '').lower()
        vn = (item.get('vod_name', '') or '').lower()
        type_id = item.get('type_id', 0)
        type_id_1 = item.get('type_id_1', 0)

        # 1. 短剧：优先判断（关键词明确）
        short_kw = ['短剧', '爽剧', '霸总', '战神', '甜宠', '赘婿',
                    '微短剧', '竖屏', '小程序剧', '网络短剧']
        for kw in short_kw:
            if kw in cls or kw in tn or kw in vn:
                return 'short'

        # 2. 动漫/动画
        anime_kw_tn = ['动漫', '动画']
        anime_kw_cls = ['动漫', '动画']
        for kw in anime_kw_tn:
            if kw in tn:
                return 'anime'
        for kw in anime_kw_cls:
            if kw in cls:
                return 'anime'

        # 3. 综艺
        variety_kw = ['综艺', '演唱', '真人秀', '脱口秀', '访谈', '晚会',
                      '娱乐', '音乐', '选秀', '相亲', '纪实']
        for kw in variety_kw:
            if kw in tn or kw in cls:
                return 'variety'

        # 4. 纪录片单独判断（不归入电影）
        doc_kw = ['纪录片', '记录片']
        for kw in doc_kw:
            if kw in tn or kw in cls:
                return 'doc'

        # 5. 电影：包含"电影"或明确的"XX片"类型（仅检查type_name）
        movie_kw_tn = ['电影', '动作片', '喜剧片', '爱情片', '科幻片', '恐怖片',
                       '剧情片', '犯罪片', '悬疑片', '战争片', '奇幻片', '冒险片',
                       '历史片', '传记片', '歌舞片', '情色片', '伦理片',
                       '武侠片', '古装片', '惊悚片', '灾难片']
        for kw in movie_kw_tn:
            if kw in tn:
                return 'movie'
        if '4k' in tn or '蓝光' in tn:
            return 'movie'

        # 5. 电视剧：包含"剧"且不是特殊类型
        tv_exclude = ['动画片', '纪录片', '记录片', '喜剧片', '动作片', '爱情片',
                      '科幻片', '恐怖片', '奇幻片', '剧情片']
        has_ju = '剧' in tn or '剧' in cls
        if has_ju:
            is_excluded = any(kw in tn or kw in cls for kw in tv_exclude)
            if not is_excluded:
                return 'tv'

        # 6. 按 type_id 判断（苹果CMS标准）
        tid = type_id or type_id_1 or 0
        if tid == 1:
            return 'movie'
        elif tid == 2:
            return 'tv'
        elif tid == 3:
            return 'variety'
        elif tid == 4:
            return 'anime'
        elif tid == 5:
            return 'short'

        # 7. 按 type_name 中的动作/喜剧等传统分类判断（仅检查tn，不检查cls）
        #    因为 vod_class 是"剧情/动作"等通用标签，电影电视剧都可能用
        movie_tn = ['动作', '喜剧', '爱情', '科幻', '恐怖', '剧情', '犯罪',
                    '悬疑', '战争', '奇幻', '冒险', '惊悚', '灾难', '武侠',
                    '古装', '传记', '历史']
        if any(kw in tn for kw in movie_tn) and '剧' not in tn:
            return 'movie'

        # 8. 仍无法判断 → None（后续由调用方处理）
        return None

    def _classify_items(self, items):
        """首页分类：将数据分入 hot / movie / tv / variety / anime / short"""
        hot, movie, tv, variety, anime, shorts, docs = [], [], [], [], [], [], []
        unassigned = []
        for item in items:
            cat = self._classify_item(item)
            if cat == 'short' and len(shorts) < 50:
                shorts.append(item)
            elif cat == 'anime' and len(anime) < 50:
                anime.append(item)
            elif cat == 'variety' and len(variety) < 50:
                variety.append(item)
            elif cat == 'movie' and len(movie) < 50:
                movie.append(item)
            elif cat == 'tv' and len(tv) < 50:
                tv.append(item)
            elif cat == 'doc' and len(docs) < 30:
                docs.append(item)
            else:
                unassigned.append(item)
        # 未分类的按轮询分配到各分类（避免某些分类为空）
        for i, item in enumerate(unassigned):
            idx = i % 5
            if idx == 0 and len(movie) < 50:
                movie.append(item)
            elif idx == 1 and len(tv) < 50:
                tv.append(item)
            elif idx == 2 and len(variety) < 50:
                variety.append(item)
            elif idx == 3 and len(anime) < 50:
                anime.append(item)
            elif len(shorts) < 50:
                shorts.append(item)



        # hot 取各分类前几条混合
        hot = []
        seen = set()
        for src_list in [movie, tv, variety, anime, shorts, docs]:
            for item in src_list:
                key = f"{item.get('vod_name','')}_{item.get('vod_id','')}"
                if key not in seen and len(hot) < 30:
                    seen.add(key)
                    hot.append(item)

        def sort_by_year(arr):
            arr.sort(key=lambda x: int(x.get('vod_year', 0) or 0), reverse=True)

        sort_by_year(hot)
        sort_by_year(movie)
        sort_by_year(tv)
        sort_by_year(variety)
        sort_by_year(anime)

        return {
            "hot": hot[:30],
            "movie": movie[:50],
            "tv": tv[:50],
            "variety": variety[:50],
            "anime": anime[:50],
            "short": shorts[:50]
        }

    def _fetch_url(self, url, timeout=8):
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def _fetch_text(self, url, timeout=10):
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8')

    def _json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path):
            # fallback to index.html (SPA)
            path = os.path.join(os.getcwd(), 'index.html')
        return super().send_head()

    def end_headers(self):
        # 给所有静态文件添加 CORS 头
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        if len(args) >= 3:
            print(f"[{time.strftime('%H:%M:%S')}] {args[0]} {args[1]} {args[2]}")
        elif len(args) >= 2:
            print(f"[{time.strftime('%H:%M:%S')}] {args[0]} {args[1]}")
        elif len(args) >= 1:
            print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")
        else:
            print(f"[{time.strftime('%H:%M:%S')}] {format}")


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('0.0.0.0', PORT), YunShaoHandler)
    print(f"\n[*] YunShao test server started on http://localhost:{PORT}")
    print(f"    Static files dir: {os.getcwd()}")
    print(f"    API proxy enabled (CORS bypass)")
    print(f"    Press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        server.server_close()
