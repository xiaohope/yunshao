# 云梢 App - API 文档

## 概述

- **Base URL**: `http://localhost:8989`
- **说明**: YunShaoServer 本地代理服务，Android App 内置运行

---

## 前端模块说明

| 模块文件 | 核心函数 |
|---------|---------|
| config.js | API_BASE、TYPE_MAP |
| utils.js | showToast、cleanDescText、formatDate |
| storage.js | getFavorites、saveHistory、getLiveSources |
| sourcemanager.js | showAddSourceModal、toggleSourceLocal |
| api.js | getHomeData、getCategoryData、searchVideo |
| apifetch.js | apiFetch、getEnabledSources、searchPlaySource |
| pages.js | showPage、goBack、toggleFullscreen |
| navigation.js | initNavigation、handleNavigation |
| tv.js | initTvPage、loadLiveSource、playLiveChannel |
| player.js | playCurrent、parsePlayUrls |
| playcontrol.js | playVideo、pauseVideo、seekTo |
| playsources.js | searchPlaySource、switchPlaySource |
| detail.js | showDetail、showDoubanDetail |
| ui.js | renderVideoCards、loadMore |
| app.js | init、bindEvents |

---

## 1. 采集源接口

### GET /api/sources
获取已启用的采集源列表

**响应示例:**
```json
[
  {"id":"1","name":"爱奇艺","url":"https://iqiyizyapi.com/api.php/provide/vod/","enabled":true},
  {"id":"2","name":"虎牙","url":"https://www.huyaapi.com/api.php/provide/vod/","enabled":true}
]
```

### GET /api/sources/sync
同步采集源（前端配置）

**参数:**
- `urls` - 采集源URL列表（JSON数组）

---

## 2. 首页接口

### GET /api/home
获取首页推荐数据（多源聚合）

**参数:**
- `pg` - 页码（默认1）

**响应示例:**
```json
{
  "list": [
    {
      "vod_id": "123",
      "vod_name": "庆余年",
      "vod_pic": "https://xxx.jpg",
      "vod_year": "2024",
      "vod_area": "大陆",
      "type_name": "国产剧",
      "vod_score": "8.5"
    }
  ]
}
```

### GET /api/hot
获取热搜词

**响应示例:**
```json
{
  "keywords": ["哪吒之魔童闹海","庆余年3","长相思2"]
}
```

---

## 3. 分类接口

### GET /api/category
获取分类数据

**参数:**
- `type` - 分类ID
  - 1: 电影
  - 2: 电视剧
  - 3: 综艺
  - 4: 动漫
  - 5: 短剧
- `pg` - 页码（默认1）
- `smart` - 智能分类（1启用）

---

## 4. 搜索接口

### GET /api/search
搜索影视

**参数:**
- `wd` - 搜索关键词
- `pg` - 页码

### GET /api/search/source
从指定采集源搜索

**参数:**
- `url` - 采集源URL
- `wd` - 搜索关键词

---

## 5. 视频详情接口

### GET /api/video/list
获取视频列表

**参数:**
- `ids` - 视频ID列表
- `ac` - 动作（值为 `detail`）

### GET /api/video/detail
获取视频详情

**参数:**
- `ids` - 视频ID

### GET /api/video/detail/url
获取视频播放URL

**参数:**
- `url` - 播放页面URL

---

## 6. 豆瓣/TMDB 接口

### GET /api/douban/home
豆瓣首页推荐

### GET /api/douban/subjects
豆瓣专题

**参数:**
- `tag` - 标签

### GET /api/douban/tags
豆瓣标签列表

### GET /api/douban/tags/all
获取所有豆瓣标签

### GET /api/douban/suggest
豆瓣搜索建议

**参数:**
- `q` - 搜索关键词

### GET /api/douban/search
豆瓣搜索

**参数:**
- `q` - 搜索关键词

### GET /api/douban/detail
豆瓣详情

**参数:**
- `id` - 豆瓣ID

### GET /api/tmdb/home
TMDB 首页

### GET /api/tmdb/movie/popular
热门电影

### GET /api/tmdb/tv/popular
热门剧集

### GET /api/tmdb/search
TMDB 搜索

**参数:**
- `q` - 搜索关键词

### GET /api/tmdb/detail
TMDB 详情

**参数:**
- `id` - TMDB ID
- `type` - 类型（movie/tv）

### GET /api/tmdb/category
TMDB 分类

**参数:**
- `type` - 类型
- `page` - 页码

---

## 7. 电视直播接口

### GET /api/live/fetch
获取电视直播源

**参数:**
- `id` - 频道ID（可选）

---

## 数据结构

### 视频对象 (Video)
```typescript
interface Video {
  vod_id: string;        // 视频ID
  vod_name: string;       // 视频名称
  vod_pic: string;       // 海报图
  vod_year: string;      // 年份
  vod_area: string;      // 地区
  vod_class: string;     // 分类
  type_name: string;     // 类型名称
  vod_score: string;     // 评分
  vod_content: string;   // 简介
  vod_play_url: string;  // 播放链接
  vod_play_from: string; // 播放源
  source_url: string;    // 采集源URL
  source_name: string;   // 采集源名称
}
```

### 采集源对象 (Source)
```typescript
interface Source {
  id: string;      // 源ID
  name: string;    // 源名称
  url: string;     // 源URL
  enabled: boolean; // 是否启用
}
```

---

## 错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 500 | 服务器错误 |
| -1 | 参数错误 |

---

## 使用示例

### 前端调用示例
```javascript
// 获取首页数据
const res = await fetch('http://localhost:8989/api/home?pg=1');
const data = await res.json();

// 搜索视频
const search = await fetch(`http://localhost:8989/api/search?wd=庆余年`);
const result = await search.json();

// 获取分类
const category = await fetch('http://localhost:8989/api/category?type=1&pg=1');
const list = await category.json();
```

---

## 版本历史

| 版本 | 更新内容 |
|------|----------|
| v3.9.0 | 基础API架构 |
| v3.9.0_plus | 添加详情页/播放页 |
| v3.18.0 | 融合版 |
