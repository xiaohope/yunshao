# 云梢 (YunShao) — 项目交接文档

> 给下一个智能体或开发者的完整手册

---

## 📋 目录

1. [项目概述](#1-项目概述)
2. [技术架构总览](#2-技术架构总览)
3. [目录结构（完整）](#3-目录结构完整)
4. [Android 层详解](#4-android-层详解)
5. [前端架构详解](#5-前端架构详解)
6. [API 接口清单](#6-api-接口清单)
7. [构建与 CI](#7-构建与-ci)
8. [桌面开发环境](#8-桌面开发环境)
9. [关键设计决策](#9-关键设计决策)
10. [已知问题与坑](#10-已知问题与坑)
11. [当前状态与待办](#11-当前状态与待办)

---

## 1. 项目概述

**云梢** 是一款 Android 影视聚合 App。核心思路是：

- **Android 壳**（Java + WebView）作为容器
- **前端 SPA**（纯 HTML/CSS/JS）负责整个 UI 和交互
- **内嵌代理服务器**（NanoHTTPD）运行在 `localhost:8989`，转发请求到第三方 MacCMS 影视采集 API，解决跨域问题
- 专为 **电视遥控器操作** 优化（D-Pad 焦点管理）

### 核心数据流

```
用户操作 → WebView(index.html) → app.js → fetch → localhost:8989
                                                        ↓
                                                YunShaoServer.java
                                                        ↓
                                        第三方 MacCMS 采集 API / 豆瓣 / TMDB
                                                        ↓
                                                    返回 JSON
                                                        ↓
                                              前端渲染 + 缓存
```

### 目标用户

追剧爱好者，尤其适配电视端遥控器操作。

---

## 2. 技术架构总览

```
┌──────────────────────────────────────────────────┐
│                 Android App                      │
│  ┌──────────────────────────────────────────────┐│
│  │         SplashActivity.java                  ││
│  │  - 启动页 WebView (splash.html)             ││
│  │  - 预热 YunShaoServer                       ││
│  │  - 2500ms 后跳转 MainActivity               ││
│  └──────────────┬───────────────────────────────┘│
│                 │ startActivity                  │
│  ┌──────────────▼───────────────────────────────┐│
│  │         MainActivity.java                    ││
│  │  - WebView 主容器                            ││
│  │  - YunShaoNative (JavascriptInterface)       ││
│  │    · enterFullscreen / exitFullscreen         ││
│  │    · playExternal(url) — 外部播放器           ││
│  │    · setRatio(ratio) — 视频比例               ││
│  │    · updateStatusBar(color) — 状态栏颜色      ││
│  │  - 全屏视频播放 (onShowCustomView)            ││
│  │  - 原生悬浮控制栏 (播放/暂停/进度/全屏)       ││
│  │  - 双击返回退出                              ││
│  └──────────────┬───────────────────────────────┘│
│                 │                                │
│  ┌──────────────▼───────────────────────────────┐│
│  │      YunShaoServer.java (NanoHTTPD)          ││
│  │  - 监听 127.0.0.1:8989                       ││
│  │  - 代理第三方采集 API（解决 CORS）            ││
│  │  - 缓存首页/分类/搜索结果                    ││
│  │  - 内置 7 个默认采集源                       ││
│  │  - 线程池 12                                 ││
│  └──────────────┬───────────────────────────────┘│
├─────────────────┼────────────────────────────────┤
│  ┌──────────────▼───────────────────────────────┐│
│  │      assets/ (Web 前端资源)                   ││
│  │  ┌─────────────────────────────────────────┐ ││
│  │  │  index.html — SPA 壳 (554行)             │ ││
│  │  │  app.js — 单体逻辑 (4014行)              │ ││
│  │  │  focus.js — 焦点管理 (596行)              │ ││
│  │  │  style.css — 样式 (3352行)                │ ││
│  │  │  widescreen.css — 宽屏适配 (1119行)       │ ││
│  │  │  splash.html — 启动页动画 (81行)           │ ││
│  │  │  about.html — 关于页面 (1156行)            │ ││
│  │  └─────────────────────────────────────────┘ ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

---

## 3. 目录结构（完整）

```
yunshao/                                          # Git 仓库根
│
├── README.md                                     # 项目 README（你正在看）
├── HANDBOOK.md                                   # 本交接文档
│
├── .gitignore                                    # 忽略规则
├── .github/workflows/build-apk.yml               # CI: 自动构建 APK
├── .kunsdd/                                      # 设计稿/需求（可忽略）
│
├── index.html / app.js / style.css               # 桌面端开发副本
├── focus.js / widescreen.css                     # 焦点管理 / 宽屏样式
├── splash.html / about.html                      # 启动页 / 关于页
│
├── server.py                                     # 桌面开发 Python 代理服务器
│                                                 # （替代 YunShaoServer.java）
│
└── yunshao_android_source/                       # Android 工程根
    ├── build.gradle                              # 根构建脚本
    ├── settings.gradle                           # 项目设置
    ├── gradle.properties                         # Gradle 属性
    ├── local.properties                          # 本地 SDK 路径（不提交）
    ├── gradlew / gradle/wrapper/                 # Gradle Wrapper (8.4)
    │
    ├── API_DOCUMENTATION.md                      # API 文档（前端可读）
    ├── PROJECT_CONTEXT.md                        # 项目上下文
    ├── MODULARIZATION.md                         # 模块化规划
    │
    └── app/
        ├── build.gradle                          # App 模块构建
        ├── proguard-rules.pro                    # ProGuard 规则
        │
        └── src/main/
            ├── AndroidManifest.xml
            │
            ├── java/com/yxq/yunshao/
            │   ├── MainActivity.java        (800行,  33KB)
            │   ├── SplashActivity.java      (101行, 3.6KB)
            │   └── YunShaoServer.java      (2430行, 118KB)
            │
            ├── res/
            │   ├── drawable/
            │   │   └── splash_background.xml
            │   ├── mipmap-*/                 # 启动图标
            │   └── values/
            │       ├── colors.xml
            │       └── themes.xml
            │
            ├── assets/                          # ← 核心前端资源
            │   ├── index.html              (554行,  37KB)
            │   ├── style.css              (3352行,  72KB)
            │   ├── widescreen.css         (1119行,  27KB)
            │   ├── app.js                 (4014行, 172KB)
            │   ├── focus.js                (596行,  14KB)
            │   ├── splash.html              (81行,  88KB)
            │   ├── about.html             (1156行,  47KB)
            │   └── *.bak / *.v3.18.0      # 备份文件
            │
            └── assets_backup/                 # 旧版本备份
                ├── app.js
                ├── index.html
                └── style.css
```

### 关于根目录和 assets/ 的副本关系

> ⚠️ **重要：同一份文件在两个地方存在**

根目录的 `index.html`、`app.js`、`style.css`、`focus.js`、`widescreen.css`、`splash.html`、`about.html` 是 **Android assets/ 的手动副本**，用于 `server.py` 桌面测试。

**修改时必须两边同步修改**，否则：
- 只改 assets/ → APK 正确，但桌面测试不对
- 只改根目录 → 桌面测试正确，但 APK 不对

---

## 4. Android 层详解

### 4.1 SplashActivity.java (101行)

| 方面 | 详情 |
|------|------|
| 职责 | 启动页，展示 splash.html 动画 2.5s |
| 关键逻辑 | `warmupHomeCache()` — 在后台预请求首页数据，让 MainActivity 打开时已有缓存 |
| 重要细节 | `onBackPressed()` 是空实现（防止返回键跳过启动页） |
| WebView | 独立 WebView，不支持 JS 交互，纯展示 |

### 4.2 MainActivity.java (800行)

**这是 Android 壳的核心。** 职责不仅是承载 WebView，还管理视频全屏播放的原生层。

| 模块 | 说明 |
|------|------|
| **YunShaoNative (JavascriptInterface)** | JS 调用原生能力的桥梁 |
| ├ `enterFullscreen()` | 隐藏 WebView，显示 VideoView 全屏 |
| ├ `exitFullscreen()` | 退出全屏，恢复 WebView |
| ├ `updateStatusBar(color)` | JS 控制状态栏颜色 |
| ├ `playExternal(url)` | 调用系统播放器/第三方播放 |
| └ `setRatio(ratio)` | 设置视频宽高比 |
| **WebChromeClient** | 处理 HTML5 视频全屏 (`onShowCustomView`/`onHideCustomView`) |
| **原生悬浮控制栏** | `addFullscreenControls()` — 覆盖在 VideoView 上的进度条/播放按钮/全屏切换，有 3s 自动隐藏 |
| **视频比例** | `applyVideoRatio()` — 支持 `16:9`、`4:3`、`全屏` 切换 |
| **状态栏** | `setLightStatusBar()` / `setDarkStatusBar()` — 根据主题切换状态栏颜色 |
| **退出** | `doubleBackToExit` — 2s 内双击返回退出 App |

### 4.3 YunShaoServer.java (2430行, 118KB)

**项目中最大的文件。** 一个 NanoHTTPD 子类，完整的 HTTP 代理服务器。

| 属性 | 值 |
|------|-----|
| 监听地址 | `127.0.0.1:8989` |
| 线程池 | 12 个线程 |
| 连接超时 | 5s |
| 读取超时 | 10s |
| TMDB API Key | 内置（硬编码在文件中） |
| User-Agent | 内置 |

#### 缓存策略

| 缓存 | 有效期 | 说明 |
|------|--------|------|
| `homeCache` | 5 min | 首页推荐数据 |
| `categoryCache` | 3 min | 分类页数据，按 type+page 键 |
| `doubanCache` | 1 hr | 豆瓣/TMDB 数据，缓存较久 |

#### 路由一览

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/home?pg=1` | GET | 首页多源聚合推荐 |
| `/api/hot` | GET | 热搜关键词 |
| `/api/category?type=1&pg=1` | GET | 分类数据（1=电影,2=电视剧,3=综艺,4=动漫,5=短剧） |
| `/api/search?wd=关键词&pg=1` | GET | 多源搜索（聚合所有启用源的结果） |
| `/api/search/source?url=...&wd=...` | GET | 指定采集源搜索 |
| `/api/video/list?ids=...&ac=detail` | GET | 获取视频列表详情 |
| `/api/video/detail?ids=...` | GET | 视频详情 |
| `/api/video/detail/url?url=...` | GET | 解析视频播放页面，提取真实播放链接 |
| `/api/douban/home` | GET | 豆瓣首页推荐 |
| `/api/douban/search?q=...` | GET | 豆瓣搜索 |
| `/api/douban/detail?id=...` | GET | 豆瓣详情 |
| `/api/douban/subjects?tag=...` | GET | 豆瓣专题 |
| `/api/douban/tags` | GET | 豆瓣标签 |
| `/api/douban/suggest?q=...` | GET | 豆瓣搜索建议 |
| `/api/tmdb/home` | GET | TMDB 首页 |
| `/api/tmdb/movie/popular` | GET | TMDB 热门电影 |
| `/api/tmdb/tv/popular` | GET | TMDB 热门剧集 |
| `/api/tmdb/search?q=...` | GET | TMDB 搜索 |
| `/api/tmdb/detail?id=...&type=movie\|tv` | GET | TMDB 详情 |
| `/api/tmdb/category?type=...&page=...` | GET | TMDB 分类 |
| `/api/live/fetch?id=...` | GET | 电视直播源 |
| `/api/sources` | GET | 获取已启用的采集源列表 |
| `/api/sources/sync` | GET | 同步采集源配置 |

---

## 5. 前端架构详解

### 5.1 app.js — 单体大文件 (4014行)

> **当前状态：** 这是一个单体文件，包含了所有页面逻辑。
> **MODULARIZATION.md** 中规划了拆分为 24 个模块（每个 <200 行）。
> **但实际 APK assets/ 中仍然是单体 `app.js`。**

#### 全局状态变量

| 变量 | 类型 | 用途 |
|------|------|------|
| `API` | Object | API 端点常量和函数 |
| `currentPage` | String | 当前显示的页面 ID |
| `pageStack` | Array | 页面导航栈（用于返回） |
| `currentVideo` | Object | 当前播放的视频信息 |
| `currentEpisode` | String | 当前播放的集数 |
| `playSources` | Array | 可用播放源列表 |
| `isCSSFullscreen` | Boolean | 是否 CSS 全屏模式 |
| `isPlaying` | Boolean | 是否正在播放 |
| `hotSearchKeywords` | Array | 热搜关键词列表 |

#### 核心功能函数

| 函数 | 行号范围(约) | 说明 |
|------|-------------|------|
| `showToast(msg, duration)` | ~30 | Toast 提示 |
| `showPage(pageId)` | ~50 | 页面切换（隐藏其他页，显示目标页） |
| `goBack()` | ~40 | 返回上一页（管理 pageStack） |
| `switchTab(tab)` | ~30 | 首页 Tab 切换 |
| `goCategory(type, name)` | ~40 | 跳转到分类页 |
| `showDetail(vodId, sourceUrl)` | ~100 | 显示视频详情 |
| `playCurrent(sourceUrl, vodId)` | ~200 | 视频播放核心逻辑 |
| `searchVideo()` | ~100 | 搜索功能 |
| `loadCategoryData(type, page)` | ~100 | 分类数据加载 |
| `toggleFullscreen()` | ~50 | 切换全屏 |
| `toggleTheme()` | ~30 | 切换暗色/亮色主题 |
| `fetchHotKeywords()` | ~50 | 获取热搜词 |
| `apiFetch(url)` | ~60 | 封装的 fetch 请求 |
| `renderVideoCards()` | ~80 | 渲染视频卡片列表 |
| `createSkeletonCards()` | ~40 | 骨架屏加载占位 |

### 5.2 focus.js — 电视遥控器焦点管理 (596行)

一个独立的 IIFE 模块，导出 `FocusManager` 对象。

| 方法 | 说明 |
|------|------|
| `init()` | 初始化焦点管理器 |
| `destroy()` | 销毁 |
| `focus(el)` | 聚焦到指定元素 |
| `moveTo(direction)` | 方向移动（UP/DOWN/LEFT/RIGHT） |
| `getCurrent()` | 获取当前焦点元素 |
| `register(el)` | 注册可聚焦元素 |
| `unregister(el)` | 注销 |
| `restorePosition()` | 恢复上次焦点位置 |
| `setFocusClass(className)` | 设置焦点样式类 |
| `onFocusChange(callback)` | 焦点变化回调 |
| `onKey(callback)` | 键盘事件回调 |

**按键映射：** `UP`/`DOWN`/`LEFT`/`RIGHT`/`ENTER`/`BACK`/`MENU`/`PLAY`/`INFO`

### 5.3 HTML 页面结构 (index.html)

| 页面 ID | 功能 | 说明 |
|---------|------|------|
| `#homePage` | 首页 | 推荐 + 5 个分类 Tab |
| `#categoryPage` | 分类页 | 6 类型 tabs + 筛选 |
| `#searchPage` | 搜索页 | 历史/热词/结果 |
| `#detailPage` | 播放详情页 | 播放器 + 剧集 + 源切换 |
| `#historyPage` | 历史记录 | |
| `#favPage` | 收藏 | |
| `#playerPage` | 播放器 | |
| `#tvPage` | 电视直播 | 频道列表 |
| `#profilePage` | 我的 | 设置/关于 |
| `#sourcePage` | 采集源管理 | |
| `#liveSourcePage` | 直播源管理 | |
| `#bottomNav` | 底部导航栏 | 移动端底部 Tab |
| `#sideNav` | 侧边导航 | 桌面端/电视端侧栏 |
| `#toast` | 通知提示 | 浮动 Toast |

### 5.4 主题系统

- 使用 CSS 变量实现亮色/暗色双主题
- `:root` / `[data-theme="dark"]` 切换
- `app.js` 中 `toggleTheme()` 切换
- 启动时检测 `prefers-color-scheme: dark`
- 暗色主题背景：`#0A0E27`

---

## 6. API 接口清单

### 6.1 采集源接口

| 端点 | 说明 |
|------|------|
| `GET /api/sources` | 获取已启用的采集源列表 |
| `GET /api/sources/sync?urls=...` | 同步采集源（前端配置） |

### 6.2 首页

| 端点 | 说明 |
|------|------|
| `GET /api/home?pg=1` | 首页推荐（多源聚合） |
| `GET /api/hot` | 热搜词 |

### 6.3 分类

| 端点 | 说明 |
|------|------|
| `GET /api/category?type=1&pg=1` | 分类数据（1-5 对应 电影/电视剧/综艺/动漫/短剧） |

### 6.4 搜索

| 端点 | 说明 |
|------|------|
| `GET /api/search?wd=...&pg=1` | 多源搜索 |
| `GET /api/search/source?url=...&wd=...` | 指定源搜索 |

### 6.5 视频详情

| 端点 | 说明 |
|------|------|
| `GET /api/video/detail?ids=...` | 视频详情 |
| `GET /api/video/detail/url?url=...` | 解析真实播放链接 |
| `GET /api/video/list?ids=...&ac=detail` | 视频列表 |

### 6.6 豆瓣/TMDB

| 端点 | 说明 |
|------|------|
| `GET /api/douban/home` | 豆瓣首页 |
| `GET /api/douban/search?q=...` | 豆瓣搜索 |
| `GET /api/douban/detail?id=...` | 豆瓣详情 |
| `GET /api/tmdb/home` | TMDB 首页 |
| `GET /api/tmdb/search?q=...` | TMDB 搜索 |
| `GET /api/tmdb/detail?id=...&type=movie\|tv` | TMDB 详情 |
| `...` | 另有多条豆瓣/TMDB 子路由 |

### 6.7 电视直播

| 端点 | 说明 |
|------|------|
| `GET /api/live/fetch?id=...` | 直播源 |

---

## 7. 构建与 CI

### 7.1 本地构建

```bash
# Debug APK
./yunshao_android_source/gradlew -p yunshao_android_source assembleDebug

# Release APK（需要 keystore）
./yunshao_android_source/gradlew -p yunshao_android_source assembleRelease
```

**依赖：** JDK 17+, Android SDK (compileSdk 33), Gradle 8.4 (wrapper)

**关键依赖库：**
- `org.nanohttpd:nanohttpd:2.3.1` — 嵌入式 HTTP 服务器
- `org.json:json:20231013` — JSON 解析

### 7.2 CI/CD (GitHub Actions)

`.github/workflows/build-apk.yml`

| 触发条件 | push / PR 到 main/master + 手动触发 |
|----------|--------------------------------------|
| 环境 | ubuntu-latest, JDK 17 |
| 产物 | Debug APK + Release APK |
| 存储 | Actions Artifacts（90 天有效） |

Workflow 步骤：
1. Checkout + JDK 17
2. 生成 release keystore（不存在时）
3. `assembleDebug` + `assembleRelease`
4. 上传两个 APK 到 Artifacts

### 7.3 仓库配置

```groovy
// build.gradle — 仓库配置
repositories {
    google()                     // 优先
    mavenCentral()               // 优先
    gradlePluginPortal()         // 优先
    maven { url 'https://maven.aliyun.com/repository/google' }         // 国内备用
    maven { url 'https://maven.aliyun.com/repository/central' }        // 国内备用
    maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }  // 国内备用
}
```

> ⚠️ **历史教训：** 阿里云镜像之前频繁返回 502。Gradle 对 5xx 错误不会 fallthrough。所以必须把官方仓库放前面。

### 7.4 APK 信息

| 属性 | 值 |
|------|-----|
| applicationId | `com.yxq.yunshao3` |
| compileSdk | 33 |
| minSdk | 21 |
| targetSdk | 33 |
| versionCode | 52 |
| versionName | 3.17.0 |

---

## 8. 桌面开发环境

`server.py` 是一个 Python HTTP 服务器，用来在浏览器中直接开发调试前端，无需每次重新编译 APK。

```bash
python server.py
# → 启动在 http://localhost:8989
```

**功能：**
- 静态文件服务（SPA — 所有未匹配路由 fallback 到 index.html）
- 实现与 YunShaoServer.java 相同的 API 路由
- 内置 7 个默认 MacCMS 采集源
- 智能分类逻辑（`_classify_item`）
- **不支持** 豆瓣/TMDB 路由

**使用流程：**
1. 修改根目录的 `app.js` / `style.css` / `index.html`
2. 浏览器访问 `http://localhost:8989`
3. 调试完成后将修改同步到 `yunshao_android_source/app/src/main/assets/`

---

## 9. 关键设计决策

### 9.1 为什么用 NanoHTTPD 而不是直连 API？

**跨域问题。** 第三方 MacCMS API 不支持 CORS，且前端在 `file://` 或 WebView 中无法直接跨域请求。通过本地代理（`localhost:8989`）中转，前端请求同源，由 Java 端转发。

### 9.2 为什么前端是单体文件而不是模块化？

历史原因。原始版本是单一 `app.js`（原 3773 行）。**MODULARIZATION.md** 规划了拆分为 24 个模块，但到目前为止 **assets/ 中仍然是单个 `app.js`**（4014 行）。拆分工作还未正式完成。

> 如果要继续拆分，参考 `MODULARIZATION.md` 中的模块划分和加载顺序。

### 9.3 为什么根目录和 assets/ 有重复文件？

为了方便桌面开发。`server.py` 在根目录提供 HTTP 服务，它读取根目录的 `app.js`。而 APK 编译时只打包 `assets/` 目录。修改一处后必须同步到另一处。

### 9.4 为什么不用 debug keystore？

之前的 `app/build.gradle` 中配置了 `/tmp/debug.keystore`，在 CI 中不存在导致构建失败。修复后移除了显式 debug 签名配置，让 Android SDK 自动使用默认的 `~/.android/debug.keystore`。

### 9.5 缓存策略

| 数据 | 缓存位置 | 策略 |
|------|---------|------|
| 首页推荐 | Java 内存 (YunShaoServer) | 5 分钟过期 |
| 分类数据 | Java 内存 (YunShaoServer) | 3 分钟过期 |
| 豆瓣/TMDB | Java 内存 (YunShaoServer) | 1 小时过期 |
| 收藏/历史 | 前端 localStorage | 永久（用户手动管理） |
| 直播源 | 前端 localStorage | 永久 |

### 9.6 电视适配

- `focus.js` 管理 D-Pad 方向键焦点
- `index.html` `<script>` 中检测 TV: `isTV = /Android\s+TV|Leanback|AFT|SMART-TV|NetCast|WebOS/.test(ua)`
- 桌面/平板/电视设备使用 `widescreen.css`
- 移动端使用 `style.css`（竖屏优先）
- 宽屏检测：`w >= 768px`

---

## 10. 已知问题与坑

### ⚠️ 重要注意事项

1. **文件不同步：** 根目录和 `assets/` 的文件是手动的副本。修改一侧必须同步另一侧，否则桌面/APK 行为不一致。

2. **AJAX 请求超时：** YunShaoServer 的连接超时仅 5s，读取超时 10s。某些慢速采集源可能频繁超时。在 `YunShaoServer.java` 中修改 `CONNECT_TIMEOUT` / `READ_TIMEOUT` 常量。

3. **TMDB API Key 硬编码：** `YunShaoServer.java` 中 TMDB API Key 直接硬编码在源码中。如需更换，搜索 `TMDB_API_KEY` 或 `"TMDB_API_KEY"`。

4. **MacCMS API 格式假设：** Java 代理服务器假设采集源使用 MacCMS JSON 格式（`/api.php/provide/vod/` 路径模式）。如果采集源使用不同格式，需要修改 `YunShaoServer.java` 中的请求构造和响应解析逻辑。

5. **缓存不会失效刷新：** 目前没有下拉刷新机制清空缓存。缓存过期后下次请求自动更新，但用户无法手动强制刷新。

6. **全屏播放横竖屏：** AndroidManifest 中 `screenOrientation="portrait"`，但在视频全屏播放时通过 `onShowCustomView` 切换到横屏。这是 WebView 模式的标准做法。

7. **`app.js` 超过 4000 行：** 虽然是单体文件，但全局变量没有 namespace 隔离，修改时需小心命名冲突。

8. **assets_backup/ 中的旧版本：** 不要删除，它们可能是回退参考。但 `assets/` 中的 `*.bak` / `*.v3.18.0` 是旧备份，可清理。

9. **桌面端 server.py 不支持豆瓣/TMDB：** 桌面开发时豆瓣和 TMDB 数据不可用，只有 APK 运行时才能获取。

10. **release keystore 路径：** CI 在工作流中自动生成 keystore 到 `yunshao_android_source/yunshao-release.keystore`，`app/build.gradle` 中路径为 `file('../yunshao-release.keystore')`。

---

## 11. 当前状态与待办

### ✅ 已完成

- [x] 基础 Android 壳 + WebView 容器
- [x] YunShaoServer 本地代理（完整 API）
- [x] 前端 SPA（所有页面：首页/分类/搜索/详情/播放/直播/我的）
- [x] 电视遥控器焦点管理
- [x] 亮色/暗色主题
- [x] 全屏视频播放（原生 + CSS）
- [x] 收藏/历史/直播源管理 (localStorage)
- [x] 豆瓣 + TMDB 数据补充
- [x] CI 自动构建 APK
- [x] 双端文件同步（根目录 + assets/）
- [x] 桌面 Python 开发服务器

### 🔲 待完成 (来自 MODULARIZATION.md)

- [ ] 将 `app.js` (4014行) 拆分为 24 个独立模块
- [ ] 验证模块化后所有功能正常
- [ ] 打包测试 APK
- [ ] 清理 `assets/` 目录中的 `.bak` 和 `.v3.18.0` 旧备份文件

### 💡 可能的改进方向

- 添加下拉刷新（清除缓存并重新加载）
- 加载动画 / 骨架屏优化
- 搜索防抖（当前每次按键都触发搜索）
- 图片懒加载优化
- 离线缓存策略
- 添加单元测试（至少前端逻辑）
- 统一根目录和 assets/ 的副本（比如构建脚本自动复制）
- TypeScript 迁移（项目中明确禁止，但可以考虑）

---

## 附录 A: 文件大小速查

| 文件 | 行数 | 大小 | 备注 |
|------|------|------|------|
| `Java/YunShaoServer.java` | 2,430 | 118 KB | 最大单体 |
| `assets/app.js` | 4,014 | 172 KB | 前端单体 |
| `assets/style.css` | 3,352 | 72 KB | 样式 |
| `assets/widescreen.css` | 1,119 | 27 KB | 宽屏 |
| `assets/focus.js` | 596 | 14 KB | 焦点 |
| `assets/index.html` | 554 | 37 KB | SPA 壳 |
| `assets/about.html` | 1,156 | 47 KB | 关于 |
| `assets/splash.html` | 81 | 88 KB | 启动页（含 base64 SVG） |
| `Java/MainActivity.java` | 800 | 33 KB | Android 主 Activity |
| `Java/SplashActivity.java` | 101 | 3.6 KB | 启动页 Activity |
| Python/server.py | 452 | 18 KB | 桌面开发服务器 |

---

## 附录 B: 关键文件行号速查 (app.js)

> `app.js` 中主要功能的近似行号范围（以 4014 行版本为准）

| 功能 | 起始行(约) | 结束行(约) |
|------|-----------|-----------|
| Toast 工具函数 | 1 | 30 |
| 页面切换 (showPage) | 100 | 150 |
| 导航 (goBack) | 200 | 240 |
| Tab 切换 | 280 | 310 |
| API 请求函数 | 400 | 500 |
| 首页数据加载 | 550 | 700 |
| 分类数据加载 | 750 | 900 |
| 搜索功能 | 1000 | 1200 |
| 详情页 | 1300 | 1500 |
| 播放器核心 | 1600 | 2000 |
| 播放控制 | 2100 | 2300 |
| 直播功能 | 2400 | 2600 |
| 收藏/历史 | 2700 | 2900 |
| 主题切换 | 3000 | 3050 |
| 全屏控制 | 3100 | 3200 |
| 采集源管理 | 3300 | 3500 |
| 初始化 | 3600 | 4014 |

---

*文档版本: v1.0 — 2026-06-09*
*如有更新，请同步更新本文件*
