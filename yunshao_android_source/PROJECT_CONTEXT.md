# 云梢 App - 项目上下文

## 1. 项目概述

**项目名称**：云梢
**项目类型**：Android 影视聚合类 App
**核心功能**：聚合多个影视采集源，支持在线播放、电视直播、收藏历史等功能
**目标用户**：追剧爱好者，尤其适配电视端遥控器操作

## 2. 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| Android壳 | Java + WebView | 原生Android开发 |
| 前端 | HTML5 + CSS3 + JavaScript | 纯Web，无框架 |
| 本地代理 | NanoHTTPD | 解决跨域访问采集源 |
| 数据存储 | localStorage | 前端持久化 |
| 视频源 | 第三方MacCMS采集API | JSON格式 |

## 3. 项目结构

```
yunshao-app/
├── app/src/main/
│   ├── java/com/yxq/yunshao/
│   │   ├── MainActivity.java       # WebView主容器
│   │   ├── YunShaoServer.java     # 本地HTTP代理（核心）
│   │   └── SplashActivity.java     # 启动页
│   └── assets/                     # Web资源（模块化）
│       ├── index.html              # 主页面结构
│       ├── config.js               # 配置（API地址、常量）
│       ├── utils.js                # 工具函数
│       ├── storage.js              # 存储（收藏、历史）
│       ├── sourcemanager.js        # 采集源管理
│       ├── api.js                  # API接口
│       ├── apifetch.js             # API请求
│       ├── pages.js                # 页面切换
│       ├── navigation.js           # 导航控制
│       ├── tv.js                   # 电视直播
│       ├── tvsource.js             # 直播源管理
│       ├── player.js               # 播放器
│       ├── playerhls.js            # HLS播放
│       ├── playcontrol.js          # 播放控制
│       ├── playsources.js          # 播放源
│       ├── detail.js               # 详情页
│       ├── detailrender.js         # 详情渲染
│       ├── detaildesc.js           # 详情描述
│       ├── detailinfo.js           # 详情信息
│       ├── ui.js                   # UI组件
│       ├── uicards.js              # 卡片渲染
│       ├── uifilter.js             # 筛选组件
│       ├── app.js                  # 入口文件
│       ├── init.js                 # 初始化
│       ├── focus.js                # 焦点管理（TV适配）
│       ├── style.css               # 样式
│       └── widescreen.css          # 横屏适配
```

## 4. 模块说明（模块化架构）

| 模块文件 | 行数 | 职责 |
|---------|------|------|
| config.js | 213 | API地址、类型映射、常量定义 |
| utils.js | 79 | showToast等工具函数 |
| storage.js | 182 | 收藏、历史、直播源存储 |
| sourcemanager.js | 107 | 采集源添加/编辑/管理 |
| api.js | 93 | API接口定义 |
| apifetch.js | 112 | fetch请求封装 |
| pages.js | 108 | showPage等页面切换 |
| navigation.js | 188 | goBack等导航控制 |
| tv.js | 140 | 电视直播功能 |
| tvsource.js | 90 | 直播源解析 |
| player.js | 84 | 播放器核心 |
| playerhls.js | 31 | HLS流播放 |
| playcontrol.js | 169 | 播放控制（播放/暂停/进度） |
| playsources.js | 109 | 播放源搜索/切换 |
| detail.js | 164 | 详情页入口 |
| detailrender.js | 61 | 详情渲染 |
| detaildesc.js | 35 | 详情描述 |
| detailinfo.js | 47 | 详情信息 |
| ui.js | 91 | UI组件 |
| uicards.js | 30 | 卡片渲染 |
| uifilter.js | 67 | 筛选组件 |
| app.js | 176 | 入口文件 |
| init.js | 165 | 初始化逻辑 |
| focus.js | 596 | 焦点管理（保持不动） |

### 模块依赖关系
```
config.js → utils.js → storage.js → sourcemanager.js
                           ↓
                       api.js → apifetch.js
                           ↓
                       pages.js → navigation.js
                           ↓
                       tv.js → tvsource.js
                           ↓
                       player.js → playerhls.js → playcontrol.js → playsources.js
                           ↓
                       detail.js → detailrender.js → detaildesc.js → detailinfo.js
                           ↓
                       ui.js → uicards.js → uifilter.js
                           ↓
                       app.js → init.js
```
- 监听 `127.0.0.1:8989`
- 代理转发采集源请求（解决CORS跨域）
- 缓存首页、分类、搜索结果
- 内置默认采集源配置

### 4.2 前端页面
| 页面 | 文件 | 功能 |
|------|------|------|
| 首页 | index.html | 推荐 + 分类Tab |
| 分类页 | index.html | 多Tab分类浏览 |
| 搜索页 | index.html | 热词 + 搜索结果 |
| 详情页 | index.html | 影视信息 + 播放 |
| 电视直播 | index.html | 频道列表 + 播放 |

### 4.3 数据流
```
用户操作 → WebView加载index.html → app.js处理逻辑
    ↓
需要数据 → fetch请求localhost:8989 → YunShaoServer
    ↓
代理转发 → 第三方采集API → 返回JSON
    ↓
缓存结果 → 展示到页面
```

## 5. 关键文件说明

### app.js (核心业务)
| 函数 | 说明 |
|------|------|
| showPage() | 页面切换 |
| showDetail() | 影视详情（跳转详情信息页） |
| goToPlayFromInfo() | 从详情页进入播放页 |
| playCurrent() | 视频播放 |
| searchVideo() | 搜索功能 |
| loadCategoryData() | 分类加载 |

### YunShaoServer.java (代理服务)
| 路由 | 说明 |
|------|------|
| /api/home | 首页数据 |
| /api/category | 分类数据 |
| /api/search | 搜索 |
| /api/video/detail | 详情 |
| /api/douban/* | 豆瓣数据 |

### index.html (页面结构)
| 页面ID | 功能 |
|--------|------|
| homePage | 首页 |
| categoryPage | 分类页 |
| searchPage | 搜索页 |
| detailInfoPage | 详情信息页（豆瓣数据） |
| detailPage | 播放页 |
| tvPage | 电视直播 |
| profilePage | 我的 |

## 6. 页面流程

```
首页/分类/搜索 → 点击视频 → detailInfoPage（详情信息页）
                                ↓
                         点击播放按钮
                                ↓
                         detailPage（播放页）
```

## 7. API文档

| 版本 | 说明 |
|------|------|
| v3.9.0 | 稳定基础版 |
| v3.9.0_plus | 添加详情页/播放页 |
| v3.15.18 | 新版UI参考 |
| v3.17.x | 功能完善版 |
| v3.18.0 | 融合版 |

## 7. 开发规范

### 文件限制
- 单文件不超过 200 行（前端资源除外）
- app.js 作为核心业务文件，可适当增加

### 命名规范
- Java：驼峰命名法
- JavaScript：驼峰命名法
- CSS： kebab-case

### 禁止事项
- 不使用 TypeScript
- 不使用 any 类型
- 不提交未测试代码
- 打包后禁止修改 start.bat/stop.bat

## 8. 构建与打包

```bash
# 开发调试
./gradlew assembleDebug

# 发布打包
./gradlew assembleRelease
```

输出路径：`app/build/outputs/apk/release/app-release.apk`

## 9. 常见问题

**Q: 采集源没数据？**
A: 检查本地服务是否启动，确认采集源URL可用

**Q: 视频无法播放？**
A: 检查播放源是否有效，可能是直链失效

**Q: 跨域问题？**
A: 通过 YunShaoServer 本地代理解决，前端不直接请求外部API
