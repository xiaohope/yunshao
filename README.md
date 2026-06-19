# 🌿 云梢

> 跨平台影视聚合应用 — 一站式追剧，适配电视遥控器操作

云梢是一个 Android 影视聚合 App，内嵌 WebView 容器 + 本地 HTTP 代理服务。聚合多个第三方 MacCMS 影视采集源，支持在线播放、电视直播、收藏历史等功能，特别针对电视端遥控器操作进行优化。

---

## ✨ 功能特色

| 功能 | 说明 |
|------|------|
| 🏠 **首页推荐** | 多源聚合推荐，分类 Tab 快速切换 |
| 🎬 **分类浏览** | 电影 / 电视剧 / 综艺 / 动漫 / 短剧 |
| 🔍 **搜索** | 热词推荐 + 多源搜索 + 搜索建议 |
| 📄 **详情页** | 影视信息 + 豆瓣/TMDB 评分 + 播放源切换 |
| ▶️ **视频播放** | 多播放源智能切换，HLS 流支持 |
| 📺 **电视直播** | 频道列表 + 在线直播 |
| ❤️ **收藏/历史** | 本地 localStorage 持久化 |
| 🎮 **遥控器适配** | 焦点管理，电视端友好操作 |
| 🌐 **多数据源** | 豆瓣 + TMDB 影视数据补充 |

---

## 🏗 技术架构

```
┌─────────────────────────────────────────────┐
│           Android 壳 (Java + WebView)         │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ SplashActivity│  │    MainActivity     │   │
│  │  (启动页)    │  │  (WebView 主容器)   │   │
│  └─────────────┘  └──────────┬───────────┘   │
│                              │                │
│  ┌───────────────────────────▼──────────────┐ │
│  │         YunShaoServer (NanoHTTPD)        │ │
│  │    本地代理 · localhost:8989 · 解决跨域    │ │
│  └───────────────────┬──────────────────────┘ │
├──────────────────────┼────────────────────────┤
│              ┌───────▼───────┐                │
│              │  前端 Web 资源  │                │
│              │   app.js 单体  │                │
│              │   4013 行代码   │                │
│              └───────┬───────┘                │
│                      │ fetch                  │
│              ┌───────▼───────┐                │
│              │ 第三方采集 API  │                │
│              │  (MacCMS 等)  │                │
│              └───────────────┘                │
└─────────────────────────────────────────────┘
```

| 层级 | 技术 |
|------|------|
| **Android 壳** | Java 8/11 + WebView |
| **前端** | 纯 HTML5 + CSS3 + JavaScript（单体架构） |
| **本地代理** | [NanoHTTPD](https://github.com/NanoHttpd/nanohttpd) 2.3.1 |
| **数据存储** | localStorage + JSON 缓存 |
| **视频源** | 第三方 MacCMS 采集 API |
| **影视信息** | 豆瓣 + TMDB API |

> **📝 架构说明**：当前版本为单体架构（app.js 约4013行）。模块化重构（拆分为24个JS模块）已规划但未实施，详见 [HANDBOOK.md](HANDBOOK.md)。

---

## 📁 项目结构

```
yunshao/
├── .github/workflows/build-apk.yml    # CI: 自动构建 APK
├── index.html / app.js / style.css    # 根级 Web 资源
├── focus.js                           # TV 遥控器焦点管理
├── widescreen.css                     # 横屏/宽屏适配
├── server.py                          # 开发用本地 Python 服务器
└── yunshao_android_source/            # Android 工程
    ├── app/src/main/
    │   ├── java/com/yxq/yunshao/
    │   │   ├── SplashActivity.java    # 启动页
    │   │   ├── MainActivity.java      # WebView 主界面
    │   │   └── YunShaoServer.java     # 本地代理服务
    │   └── assets/                    # 前端 Web 资源
    │       ├── index.html             # 主页面结构
    │       ├── config.js              # 配置（API 地址、常量）
    │       ├── app.js / init.js       # 入口 + 初始化
    │       ├── api.js / apifetch.js   # API 层
    │       ├── detail*.js             # 详情页模块
    │       ├── player*.js             # 播放器模块
    │       ├── tv.js / tvsource.js    # 电视直播模块
    │       ├── ui*.js                 # UI 组件
    │       ├── pages.js / navigation.js # 页面/导航
    │       └── storage.js / sourcemanager.js # 存储/采集源
    ├── build.gradle                   # 根构建配置
    └── app/build.gradle               # 模块构建配置
```

### 前端模块依赖

```
config.js → utils.js → storage.js → sourcemanager.js
                            ↓
                       api.js → apifetch.js
                            ↓
                       pages.js → navigation.js
                            ↓
                       tv.js → tvsource.js
                            ↓
                       player*.js → playcontrol.js
                            ↓
                       detail*.js
                            ↓
                       ui*.js
                            ↓
                       app.js → init.js
```

---

## 🚀 快速开始

### 环境要求

- **JDK 17+**
- **Android SDK** (compileSdk 33)
- **Gradle 8.4** (项目自带 wrapper)

### 构建 APK

```bash
# 克隆仓库
git clone https://github.com/xiaohope/yunshao.git
cd yunshao

# Debug APK
./yunshao_android_source/gradlew -p yunshao_android_source assembleDebug

# Release APK（需要 keystore）
./yunshao_android_source/gradlew -p yunshao_android_source assembleRelease
```

输出路径：
- Debug: `yunshao_android_source/app/build/outputs/apk/debug/app-debug.apk`
- Release: `yunshao_android_source/app/build/outputs/apk/release/app-release.apk`

---

## 🤖 CI 自动构建

每次 push 到 `main` / `master` 分支，GitHub Actions 自动构建 Debug + Release APK：

1. 前往 [Actions 页面](https://github.com/xiaohope/yunshao/actions)
2. 点击最新的 **Build APK** workflow
3. 底部 **Artifacts** 下载 `yunshao-debug-apk` 或 `yunshao-release-apk`

---

## 🔧 开发指南

### 修改前端

前端资源在 `yunshao_android_source/app/src/main/assets/` 目录下：

1. 直接编辑 HTML / JS / CSS 文件
2. 重新编译 APK 即可生效

### 本地预览

```bash
cd yunshao_android_source/app/src/main/assets
python3 -m http.server 8000
```

然后在浏览器打开 `http://localhost:8000`（部分功能需代理服务配合）。

### 添加采集源

1. 打开 App →「我的」→「采集源管理」
2. 添加支持 MacCMS 标准的采集 API 地址
3. 启用后即可在首页/分类中看到数据

---

## 📜 版本历史

| 版本 | 说明 |
|------|------|
| v3.9.0 | 稳定基础版 |
| v3.9.0_plus | 添加详情页/播放页功能 |
| v3.18.0 | 融合版 |
| v3.17.0 | 当前版本 (versionCode 52) |

---

## ⚠️ 声明

- 本应用本身不提供任何影视内容
- 所有影视数据来源于第三方采集 API
- 请遵守当地法律法规，仅用于学习交流

---

## 📄 License

```
MIT License

Copyright (c) 2024 YunShao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files...
```
