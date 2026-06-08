# 云梢 App

跨平台视频聚合应用，支持电视遥控器操作优化。

## 技术栈

| 层级 | 技术 |
|------|------|
| **Android客户端** | 原生Java + WebView |
| **前端** | HTML5 + CSS3 + JavaScript |
| **本地服务** | NanoHTTPD (嵌入式HTTP服务器) |
| **数据存储** | localStorage + JSON缓存 |
| **视频源** | 第三方影视采集API |

## 项目结构

```
yunshao-app/
├── app/src/main/
│   ├── java/com/yxq/yunshao/
│   │   ├── MainActivity.java      # 主界面（WebView容器）
│   │   ├── YunShaoServer.java    # 本地HTTP代理服务
│   │   └── SplashActivity.java    # 启动页
│   └── assets/                    # Web资源目录
│       ├── index.html             # 主页面
│       ├── app.js                # 核心业务逻辑
│       ├── style.css             # 样式文件
│       ├── focus.js              # 焦点管理（TV适配）
│       ├── widescreen.css        # 宽屏适配
│       └── splash.html           # 启动页资源
```

## 功能模块

- 首页（推荐 + 分类Tab）
- 分类页（电影/电视剧/综艺/动漫/短剧）
- 搜索（热词 + 搜索建议）
- 详情页（影视信息 + 播放）
- 电视直播
- 我的（收藏/历史/设置）

## 开发说明

### 修改前端资源
1. 直接编辑 `app/src/main/assets/` 目录下的文件
2. 修改后执行 `./gradlew assembleRelease` 重新打包

### APK签名
使用项目内置签名，打包后直接安装使用。

## 版本说明

- v3.9.0 - 稳定版基础
- v3.9.0_plus - 添加详情页/播放页功能
- v3.18.0 - 融合版
