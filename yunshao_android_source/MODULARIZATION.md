# 云梢 App - 模块化规划

## 目标
- 每个文件不超过 200 行 ✅
- 按职责拆分 ✅

## 当前拆分状态

| 模块 | 文件 | 行数 | 职责 |
|------|------|------|------|
| 配置 | config.js | 213 | API地址、类型映射、常量定义 |
| 工具 | utils.js | 79 | showToast等工具函数 |
| 存储 | storage.js | 182 | 收藏、历史、直播源存储 |
| 采集源 | sourcemanager.js | 107 | 采集源添加/编辑/管理 |
| API | api.js | 93 | API接口定义 |
| API请求 | apifetch.js | 112 | fetch请求封装 |
| 页面 | pages.js | 108 | showPage等页面切换 |
| 导航 | navigation.js | 188 | goBack等导航控制 |
| 电视直播 | tv.js | 140 | 电视直播功能 |
| 直播源 | tvsource.js | 90 | 直播源解析 |
| 播放器 | player.js | 84 | 播放器核心 |
| HLS播放 | playerhls.js | 31 | HLS流播放 |
| 播放控制 | playcontrol.js | 169 | 播放/暂停/进度控制 |
| 播放源 | playsources.js | 109 | 播放源搜索/切换 |
| 详情页 | detail.js | 164 | 详情页入口 |
| 详情渲染 | detailrender.js | 61 | 详情渲染 |
| 详情描述 | detaildesc.js | 35 | 详情描述 |
| 详情信息 | detailinfo.js | 47 | 详情信息 |
| UI组件 | ui.js | 91 | UI组件 |
| 卡片渲染 | uicards.js | 30 | 卡片渲染 |
| 筛选 | uifilter.js | 67 | 筛选组件 |
| 入口 | app.js | 176 | 入口文件 |
| 初始化 | init.js | 165 | 初始化逻辑 |
| 焦点 | focus.js | 596 | 焦点管理（保持不动） |
| **总计** | **24个文件** | **2541行** | |

## 模块依赖关系

```
config.js (常量)
    ↓
utils.js (工具)
    ↓
storage.js (存储) → sourcemanager.js (采集源)
    ↓
api.js (API) → apifetch.js (请求)
    ↓
pages.js (页面) → navigation.js (导航)
    ↓
tv.js (直播) → tvsource.js (直播源)
    ↓
player.js (播放器) → playerhls.js → playcontrol.js → playsources.js
    ↓
detail.js (详情) → detailrender.js → detaildesc.js → detailinfo.js
    ↓
ui.js (UI) → uicards.js → uifilter.js
    ↓
app.js (入口) → init.js (初始化)
```

## 已完成 ✅

- [x] 将 app.js 中的 3773 行代码拆分到各模块
- [x] 确保模块加载顺序正确
- [x] 保持向后兼容
- [x] 更新 PROJECT_CONTEXT.md
- [x] 更新 API_DOCUMENTATION.md

## 待测试

- [ ] 测试所有功能正常
- [ ] 打包并验证APK
