// ==================== 云梢 v3.20.0 (Plyr集成) ====================
const API = 'http://localhost:8989';
// 后端是否存活的标记（undefined 表示尚未检测，false 表示后端不可达）
let _backendAlive = undefined;
let currentPage = 'homePage', pageStack = ['homePage'];
let currentVideo = null, currentEpisode = null, currentPlayUrl = null, playSources = [];
let currentHomeTab = 'recommend';
let homeCatState = { typeId: 1, page: 1, loading: false, hasMore: true };
let categoryState = { typeId: 0, page: 1, loading: false, hasMore: true, viewMode: 'list', quickFilter: 'all', filter: { area: 'all', year: 'all', sort: 'hot' }, allData: [] };
// 分类页每个Tab独立状态（独立容器，各自维护滚动位置）
let currentCatPageTab = 0;
const catPageTabStates = {
  0:{page:1,loading:false,hasMore:true,loaded:false,allData:[]},
  1:{page:1,loading:false,hasMore:true,loaded:false,allData:[]},
  2:{page:1,loading:false,hasMore:true,loaded:false,allData:[]},
  3:{page:1,loading:false,hasMore:true,loaded:false,allData:[]},
  4:{page:1,loading:false,hasMore:true,loaded:false,allData:[]},
  5:{page:1,loading:false,hasMore:true,loaded:false,allData:[]}
};
const catPagePanelMap = {0:'catPageTab_0',1:'catPageTab_1',2:'catPageTab_2',3:'catPageTab_3',4:'catPageTab_4',5:'catPageTab_5'};
let isCSSFullscreen = false;
let customViewCallback = null; // 保存原生全屏回调
let hotSearchKeywords = ['哪吒之魔童闹海','封神第二部','庆余年3','长相思2','与凤行','玫瑰的故事','墨雨云间','度华年','繁花','我是刑警'];

// 从后端获取热搜词，缓存到localStorage，每周一更新
async function fetchHotKeywords() {
  const cacheKey = 'ys_hot_keywords';
  const cacheTimeKey = 'ys_hot_keywords_time';
  const cached = localStorage.getItem(cacheKey);
  const cacheTime = parseInt(localStorage.getItem(cacheTimeKey) || '0');
  const now = Date.now();
  // 判断是否需要刷新：没缓存，或已过本周一0点
  const lastMonday = getLastMonday();
  if (cached && cacheTime >= lastMonday) {
    try { hotSearchKeywords = JSON.parse(cached); return; } catch(e) {}
  }
  // 从后端获取
  try {
    const data = await apiFetch(`${API}/api/hot`, 8000);
    if (data && data.keywords && data.keywords.length) {
      hotSearchKeywords = data.keywords;
      localStorage.setItem(cacheKey, JSON.stringify(hotSearchKeywords));
      localStorage.setItem(cacheTimeKey, String(now));
    }
  } catch(e) {}
}

// 获取本周一0点的时间戳
function getLastMonday() {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
// 新增：跟踪当前选中的源索引和集数索引
let currentSourceIndex = 0;
let currentEpisodeIndex = 0;
let isPlaying = false;

function showToast(m) { const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); }

// 占位图生成函数，支持不同比例
function getNoImgSvg(width = 120, height = 180) {
  const bg = '#2a2a3e';
  const icon = '#555';
  const text = '#666';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <rect fill="${bg}" width="${width}" height="${height}" rx="8"/>
    <rect x="${width*0.3}" y="${height*0.35}" width="${width*0.4}" height="${height*0.06}" rx="2" fill="${icon}"/>
    <rect x="${width*0.25}" y="${height*0.45}" width="${width*0.5}" height="${height*0.04}" rx="2" fill="${icon}"/>
    <polygon points="${width*0.38},${height*0.6} ${width*0.55},${height*0.7} ${width*0.38},${height*0.8}" fill="${icon}"/>
    <text x="${width*0.5}" y="${height*0.92}" text-anchor="middle" fill="${text}" font-size="${Math.max(10, width*0.1)}" font-family="sans-serif">暂无封面</text>
  </svg>`)}`;
}
const noImg = getNoImgSvg(120, 180);

// ==================== 骨架屏生成 ====================
function createSkeletonCards(count, isScroll) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    const delay = (i * 0.15).toFixed(2);
    if (isScroll) {
      cards.push(`<div class="skeleton-card"><div class="skeleton-poster skeleton-pulse" style="animation-delay:${delay}s"></div><div class="skeleton-title skeleton-pulse" style="animation-delay:${delay}s"></div><div class="skeleton-meta skeleton-pulse-deep" style="animation-delay:${delay}s"></div></div>`);
    } else {
      cards.push(`<div class="cat-card skeleton-cat-card"><div class="cat-card-poster skeleton-pulse" style="animation-delay:${delay}s"></div><div class="skeleton-title skeleton-pulse" style="animation-delay:${delay}s"></div><div class="skeleton-meta skeleton-pulse-deep" style="animation-delay:${delay}s"></div></div>`);
    }
  }
  return cards.join('');
}
async function apiFetch(u, timeout=15000) { try{const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);const r=await fetch(u,{signal:c.signal});clearTimeout(t);return await r.json();}catch(e){return null;} }

// ==================== 全屏入口统一 ====================
// 无论双击还是点全屏按钮，都走enterFullscreenMode
// JS层不再拦截requestFullscreen——由Java层onShowCustomView统一处理

// ==================== 页面切换 ====================
function showPage(pid) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const p=document.getElementById(pid); if(p)p.classList.add('active');
  if(pid!==currentPage) pageStack.push(pid);
  currentPage=pid;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===pid));
  // 同步侧边栏高亮
  document.querySelectorAll('.side-nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===pid));
  const nav=document.getElementById('bottomNav');
  if(nav) nav.style.display=(pid==='detailPage'||pid==='searchPage')?'none':'';
  
  // 返回首页时清除搜索输入框
  if(pid==='homePage'){
    const si=document.getElementById('searchInput');if(si)si.value='';
    const sf=document.getElementById('searchInputFull');if(sf)sf.value='';
  }
  
  // 进入历史/收藏/个人页时刷新数据
  if(pid==='historyPage'||pid==='favPage'||pid==='profilePage') loadProfileData();
  
  // 页面进入动画
  if(p) {
    p.classList.remove('page-enter');
    void p.offsetWidth; // 触发重绘
    p.classList.add('page-enter');
  }
}

function goBack() {
  // 优先检查CSS全屏模式
  if(isCSSFullscreen){exitFullscreenMode();return;}
  if(document.fullscreenElement||document.webkitFullscreenElement){exitFullscreenMode();return;}
  cleanupPlayer();
  // 隐藏底部播放条并重置状态
  isPlaying = false;
  var mpb = document.getElementById('miniPlayerBar'); if(mpb) mpb.style.display = 'none';
  // 从详情页（播放页）返回：优先回到详情信息页
  if(currentPage==='detailPage'){
    var infoIdx = pageStack.lastIndexOf('detailInfoPage');
    if(infoIdx > 0){
      pageStack = pageStack.slice(0, infoIdx + 1);
      showPage('detailInfoPage');
      return;
    }
    // 回到搜索页（如果在栈中）
    var searchIdx = pageStack.lastIndexOf('searchPage');
    if(searchIdx > 0){
      pageStack = pageStack.slice(0, searchIdx + 1);
      showPage('searchPage');
      return;
    }
    // 没有搜索页，回主页面
    var mainPgs=['homePage','categoryPage','tvPage','profilePage'];
    var tgt='homePage';
    for(var i=pageStack.length-2;i>=0;i--){
      if(mainPgs.includes(pageStack[i])){tgt=pageStack[i];break;}
    }
    pageStack=[tgt];
    showPage(tgt);
    return;
  }
  // 搜索页返回：回到上一个主页面
  if(currentPage==='searchPage'){
    var mainPgs2=['homePage','categoryPage','tvPage','profilePage'];
    var tgt2='homePage';
    for(var j=pageStack.length-2;j>=0;j--){
      if(mainPgs2.includes(pageStack[j])){tgt2=pageStack[j];break;}
    }
    pageStack=[tgt2];
    showPage(tgt2);
    return;
  }
  if(pageStack.length>1) pageStack.pop();
  var t=pageStack[pageStack.length-1]||'homePage';
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  var el=document.getElementById(t); if(el) el.classList.add('active');
  currentPage=t;
  var nav3=document.getElementById('bottomNav');
  if(nav3) nav3.style.display=(t==='detailPage'||t==='searchPage')?'none':'';
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.page===t);});
  document.querySelectorAll('.side-nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.page===t);});
}

function switchTab(pid) { pageStack=[pid]; showPage(pid); }

// ==================== 全屏（CSS全屏方案） ====================
function enterFullscreenMode() {
  const pa = currentPage === 'tvPage' ? document.getElementById('tvPlayerArea') : document.getElementById('playerArea');
  const v = pa ? pa.querySelector('video') : null;
  if (!v) return;
  const isPortrait = v.videoHeight > v.videoWidth;
  if(window.YunShaoNative){
    YunShaoNative.enterFullscreen(isPortrait);
  } else {
    applyFullscreenCSS();
  }
}
function exitFullscreenMode() {
  if(window.YunShaoNative){
    YunShaoNative.exitFullscreen();
  } else {
    removeFullscreenCSS();
  }
}

// ==================== CSS全屏控制 ====================
// v3.4.0: 窗口从一开始就edge-to-edge，全屏只需：
// 1. 让playerArea铺满整个页面
// 2. 隐藏非播放器内容
// 3. Java层会把--status-bar-h设为0并隐藏系统栏
function applyFullscreenCSS() {
  isCSSFullscreen=true;
  document.body.classList.add('fs-mode');
  const isTvPage = currentPage === 'tvPage';
  const pa = isTvPage ? document.getElementById('tvPlayerArea') : document.getElementById('playerArea');
  if(pa){
    pa._originalParent = pa.parentNode;
    pa._originalNextSibling = pa.nextSibling;
    document.body.appendChild(pa);
    pa.classList.add('player-fullscreen');
    const v=pa.querySelector('video');
    if(v) v.classList.add('fullscreen-video');
    // 全屏退出按钮
    var exitBtn = document.createElement('button');
    exitBtn.className = 'fs-exit-btn';
    exitBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="#fff"/></svg>';
    exitBtn.onclick = function() { exitFullscreenMode(); };
    pa.appendChild(exitBtn);
  }
  // 隐藏非播放器内容
  if (isTvPage) {
    const tp = document.getElementById('tvPage');
    if (tp) tp.querySelectorAll('.tv-group-tabs,.tv-channel-area,.tv-source-bar').forEach(e=>e.style.display='none');
  } else {
    const dp=document.getElementById('detailPage');
    if(dp) dp.querySelectorAll('.top-bar,.detail-info,.episodes-section,.detail-actions,.source-tabs').forEach(e=>e.style.display='none');
  }
  document.querySelectorAll('.bottom-nav').forEach(e=>e.style.display='none');
  const sideNav=document.getElementById('sideNav');
  if(sideNav) sideNav.style.display='none';
  const miniBar = document.getElementById('miniPlayerBar');
  if(miniBar) miniBar.style.display = 'none';
  // 恢复播放
  const v2=pa?pa.querySelector('video'):null;
  if(v2&&v2.paused)v2.play().catch(()=>{});
}
function removeFullscreenCSS() {
  isCSSFullscreen=false;
  document.body.classList.remove('fs-mode');
  const isTvPage = currentPage === 'tvPage';
  const pa = isTvPage ? document.getElementById('tvPlayerArea') : document.getElementById('playerArea');
  if(pa){
    pa.classList.remove('player-fullscreen');
    const v=pa.querySelector('video');
    if(v) v.classList.remove('fullscreen-video');
    // 移除全屏退出按钮
    var exitBtn = pa.querySelector('.fs-exit-btn');
    if(exitBtn) exitBtn.remove();
    // 把播放器移回原位
    if(pa._originalParent){
      if(pa._originalNextSibling){
        pa._originalParent.insertBefore(pa, pa._originalNextSibling);
      } else {pa._originalParent.appendChild(pa);}
      delete pa._originalParent;
      delete pa._originalNextSibling;
    }
  }
  if (isTvPage) {
    const tp = document.getElementById('tvPage');
    if (tp) tp.querySelectorAll('.tv-group-tabs,.tv-channel-area,.tv-source-bar').forEach(e=>e.style.display='');
  } else {
    const dp=document.getElementById('detailPage');
    if(dp) dp.querySelectorAll('.top-bar,.detail-info,.episodes-section,.detail-actions,.source-tabs').forEach(e=>e.style.display='');
  }
  document.querySelectorAll('.bottom-nav').forEach(e=>e.style.display='');
  const sideNav=document.getElementById('sideNav');
  if(sideNav) sideNav.style.display='';
  if(isPlaying) {
    const miniBar = document.getElementById('miniPlayerBar');
    if(miniBar) miniBar.style.display = '';
  }
}

// ==================== 视频比例切换 ====================
let currentVideoRatio = 'contain';
function setVideoRatio(ratio) {
  currentVideoRatio = ratio;
  const pa = currentPage === 'tvPage' ? document.getElementById('tvPlayerArea') : document.getElementById('playerArea');
  const v = pa ? pa.querySelector('video') : null;
  if (!v) return;
  
  // 更新按钮状态
  document.querySelectorAll('.fs-ratio-btn').forEach(b => b.classList.toggle('active', b.dataset.ratio === ratio));
  
  switch(ratio) {
    case 'contain':
      v.style.objectFit = 'contain';
      v.style.aspectRatio = '';
      v.style.width = '100%';
      v.style.height = '100%';
      break;
    case 'cover':
      v.style.objectFit = 'cover';
      v.style.aspectRatio = '';
      v.style.width = '100%';
      v.style.height = '100%';
      break;
    case '16/9':
      v.style.objectFit = 'contain';
      v.style.aspectRatio = '16/9';
      v.style.width = '100%';
      v.style.height = 'auto';
      break;
    case '4/3':
      v.style.objectFit = 'contain';
      v.style.aspectRatio = '4/3';
      v.style.width = '100%';
      v.style.height = 'auto';
      break;
  }
  showToast(ratio === 'contain' ? '默认比例' : ratio === 'cover' ? '填充画面' : ratio.replace('/', ':'));
}

// ==================== 首页数据 ====================
let homeDataCache=null;

async function loadHomeData() {
  // 有内存缓存则直接用，后台静默刷新
  if(homeDataCache){
    renderHomeData(homeDataCache);
    return;
  }
  // 尝试从localStorage读缓存，先显示再刷新
  try{
    const saved=localStorage.getItem('ys_home_cache');
    if(saved){
      const parsed=JSON.parse(saved);
      if(parsed&&(parsed.hot||parsed.movie||parsed.tv)){
        homeDataCache=parsed;
        renderHomeData(parsed);
        // 后台静默刷新
        refreshHomeData();
        return;
      }
    }
  }catch(e){}
  
  // 没有任何缓存，加载骨架屏并请求
  await fetchAndRenderHome();
}

// 后台静默刷新首页数据
async function refreshHomeData(){
  try{
    const data=await apiFetch(`${API}/api/home`,15000);
    if(data&&!data.error&&(data.hot||data.movie||data.tv)){
      homeDataCache=data;
      try{localStorage.setItem('ys_home_cache',JSON.stringify(data));}catch(e){}
      renderHomeData(data);
    }
  }catch(e){}
}

// 请求并渲染首页数据
async function fetchAndRenderHome(){
  // 热门推荐：banner+双列 / 其他：3列网格
  const bannerEl=document.getElementById('hotBanner');
  const hotGridEl=document.getElementById('hotGrid');
  const sections={short:'shortGrid',movie:'movieGrid',tv:'tvGrid',variety:'varietyGrid',anime:'animeGrid'};
  
  if(bannerEl) bannerEl.innerHTML='<div style="aspect-ratio:16/9;background:var(--bg-tag);border-radius:var(--radius-lg)"></div>';
  for(const id of Object.values(sections)){const el=document.getElementById(id);if(el)el.innerHTML=createSkeletonCards(6,true);}

  // 先尝试后端API（如果已知后端挂了则直接跳过）
  let data = null;
  if (_backendAlive !== false) {
    data = await apiFetch(`${API}/api/home`);
    // 后端失败时重试一次（可能是服务器刚启动还没就绪）
    if (!data || data.error) {
      await new Promise(r => setTimeout(r, 500));
      data = await apiFetch(`${API}/api/home`, 20000);
    }
    
    // 改进：如果 movie 或 tv 为空，尝试从分类API获取数据
    if (data && !data.error) {
      const fallbackFetches = [];
      
      // 如果 movie 为空，从分类API获取
      if (!data.movie || data.movie.length === 0) {
        console.log('movie 为空，从分类API获取');
        fallbackFetches.push(
          apiFetch(`${API}/api/category?type=1&pg=1`).then(result => {
            if (result && result.list && result.list.length > 0) {
              data.movie = result.list.slice(0, 12);
              console.log('从分类API获取到 ' + data.movie.length + ' 条电影数据');
            }
          }).catch(e => console.error('获取电影数据失败:', e))
        );
      }
      
      // 如果 tv 为空，从分类API获取
      if (!data.tv || data.tv.length === 0) {
        console.log('tv 为空，从分类API获取');
        fallbackFetches.push(
          apiFetch(`${API}/api/category?type=2&pg=1`).then(result => {
            if (result && result.list && result.list.length > 0) {
              data.tv = result.list.slice(0, 12);
              console.log('从分类API获取到 ' + data.tv.length + ' 条电视剧数据');
            }
          }).catch(e => console.error('获取电视剧数据失败:', e))
        );
      }
      
      // 等待所有fallback请求完成
      if (fallbackFetches.length > 0) {
        await Promise.all(fallbackFetches);
      }
    }
  }
  if(data && !data.error && (data.hot || data.movie || data.tv)){
    homeDataCache=data;
    try{localStorage.setItem('ys_home_cache',JSON.stringify(data));}catch(e){}
    renderHomeData(data);
    return;
  }
  
  // 后端返回了但分类为空，也要渲染（清除骨架屏）
  if(data && !data.error){
    homeDataCache=data;
    try{localStorage.setItem('ys_home_cache',JSON.stringify(data));}catch(e){}
    renderHomeData(data);
  }
  
  // 后端失败，从采集源加载
  const sources = await getEnabledSources();
  if(!sources.length){
    // 无可用源时清除骨架屏，显示空状态文案
    var emptyHtml = '<div class="loading-placeholder error" style="padding:40px;text-align:center;color:var(--text-tertiary);font-size:14px">暂无数据，请先添加采集源</div>';
    for(var _i=0;_i<Object.keys(sections).length;_i++){var _k=Object.keys(sections)[_i];var _el=document.getElementById(sections[_k]);if(_el)_el.innerHTML=emptyHtml;}
    showToast('请先添加采集源');
    return;
  }
  
  // 从第一个启用的采集源获取首页数据
  const src = sources[0];
  try {
    // 获取各分类数据
    const types = {movie:1, tv:2, variety:3, anime:4, short:5};
    const fetches = {};
    for(const [key, typeId] of Object.entries(types)){
      fetches[key] = fetch(`${src.url}?ac=detail&t=${typeId}&pg=1`).then(r=>r.json()).catch(()=>null);
    }
    fetches.hot = fetch(`${src.url}?ac=detail&pg=1`).then(r=>r.json()).catch(()=>null);
    
    const results = {};
    for(const key of ['hot',...Object.keys(types)]){
      const d = await fetches[key];
      if(d && d.list) results[key] = d.list.map(v=>({...v, source_url:src.url, source_name:src.name}));
    }
    
    if(Object.keys(results).length){
      homeDataCache = results;
      try{localStorage.setItem('ys_home_cache',JSON.stringify(results));}catch(e){}
      renderHomeData(results);
    } else {
      showToast('加载失败');
    }
  } catch(e){
    showToast('加载失败');
  }
}

function renderHomeData(data) {
  const bannerEl=document.getElementById('hotBanner');
  const hotGridEl=document.getElementById('hotGrid');
  const sections={short:'shortGrid',movie:'movieGrid',tv:'tvGrid',variety:'varietyGrid',anime:'animeGrid'};
  // 热门推荐：第1条做banner，剩余双列
  if(data.hot&&data.hot.length&&bannerEl&&hotGridEl){
    const first=data.hot[0];
    bannerEl.innerHTML=`<img src="${first.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'" >
      ${first.vod_score?`<span class="rec-banner-score">${first.vod_score}</span>`:''}
      <div class="rec-banner-overlay"><div class="rec-banner-title">${first.vod_name||''}</div><div class="rec-banner-meta">${first.vod_year||''} ${first.vod_area||''}</div></div>`;
    bannerEl.onclick=()=>searchAndPlay(first.vod_name);
    // 横版/宽屏：隐藏banner，5张卡片；竖屏：显示banner+4卡片
    var isWide=window.innerWidth>=768;
    if(isWide){
      bannerEl.style.display='none';
      hotGridEl.innerHTML=data.hot.slice(0,5).map(v=>createCard(v)).join('');
    } else {
      bannerEl.style.display='';
      hotGridEl.innerHTML=data.hot.slice(1,5).map(v=>createCard(v)).join('');
    }
  }

  // 其他分类：3列网格
  for(const[k,id]of Object.entries(sections)){
    const el=document.getElementById(id);
    if(el&&data[k]&&data[k].length) el.innerHTML=data[k].slice(0,6).map(v=>createCard(v)).join('');
    else if(el) el.innerHTML='<div class="loading-placeholder error">暂无</div>';
  }
  if(!data.short||!data.short.length) loadShortDramas();
  bindCardClicks();
}

async function loadShortDramas() {
  const el=document.getElementById('shortGrid'); if(!el)return;
  el.innerHTML=createSkeletonCards(6,true);
  // 用搜索接口搜"短剧"，跨所有源，有图片有数据
  let allItems = [];
  const sources = await getEnabledSources();
  for (const src of sources) {
    try {
      const data = await apiFetch(`${API}/api/search/source?url=${encodeURIComponent(src.url)}&wd=${encodeURIComponent('短剧')}`, 8000);
      if (data && data.list && data.list.length) {
        allItems = allItems.concat(data.list.map(v=>({...v, source_url:src.url, source_name:src.name})));
      }
      if (allItems.length >= 6) break; // 够6条就不搜了
    } catch(e) {}
  }
  if(allItems.length){el.innerHTML=allItems.slice(0,6).map(v=>createCard(v)).join('');bindCardClicks();}
  else el.innerHTML='<div class="loading-placeholder error">暂无</div>';
}

// 全局视频数据缓存（避免JSON嵌入HTML的编码问题）
window._vodData = window._vodData || {};

function createCard(v) {
  const idx = '_c'+Math.random().toString(36).slice(2,8);
  window._vodData[idx] = v;
  return `<div class="video-card" data-vid="${idx}">
    <div class="video-card-poster"><img src="${v.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'">${v.vod_score?`<span class="video-card-rating">${v.vod_score}</span>`:''}</div>
    <div class="video-card-title">${v.vod_name||''}</div><div class="video-card-meta">${v.vod_year||''} ${v.vod_area||''}</div></div>`;
}

function createCatCard(v) {
  const idx = '_c'+Math.random().toString(36).slice(2,8);
  window._vodData[idx] = v;
  return `<div class="cat-card" data-vid="${idx}">
    <div class="cat-card-poster"><img src="${v.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'">${v.vod_score?`<span class="cat-card-rating">${v.vod_score}</span>`:''}</div>
    <div class="cat-card-title">${v.vod_name||''}</div><div class="cat-card-meta">${v.vod_year||''} ${v.vod_area||''}</div></div>`;
}

function bindCardClicks() {
  document.querySelectorAll('.video-card,.cat-card').forEach(c=>{c.onclick=()=>{try{const v=window._vodData[c.dataset.vid];if(v)showDetail(v);}catch(e){}};});
}

// ==================== Tab切换 ====================
const tabOrder=['recommend','movie','tv','variety','anime','short'];
const tabTypeMap={recommend:0,movie:1,tv:2,variety:3,anime:4,short:5};
const tabPanelMap={movie:'homeTab_movie',tv:'homeTab_tv',variety:'homeTab_variety',anime:'homeTab_anime',short:'homeTab_short'};

// 首页Tab面板滚动加载
function setupHomeScrollLoad(tabName) {
  const panelId = tabPanelMap[tabName];
  const panel = document.getElementById(panelId);
  if (!panel || panel._scrollBound) return;
  panel._scrollBound = true;
  const typeId = tabTypeMap[tabName];
  panel.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = panel;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadMoreHomeCat(typeId);
    }
  });
}

// 分类页Tab面板滚动加载
function setupCatPageScrollLoad(typeId) {
  const panelId = catPagePanelMap[typeId];
  const panel = document.getElementById(panelId);
  if (!panel || panel._scrollBound) return;
  panel._scrollBound = true;
  panel.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = panel;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      loadMoreCatPageTab(typeId);
    }
  });
}

document.querySelectorAll('#tabNav .tab-item').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('#tabNav .tab-item').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    switchHomeTab(tab.dataset.tab);
  });
});

// 每个Tab独立状态
const catTabStates={
  1:{page:1,loading:false,hasMore:true,loaded:false},
  2:{page:1,loading:false,hasMore:true,loaded:false},
  3:{page:1,loading:false,hasMore:true,loaded:false},
  4:{page:1,loading:false,hasMore:true,loaded:false},
  5:{page:1,loading:false,hasMore:true,loaded:false}
};

// 智能分类函数 - 保留用于可能的前端过滤
function classifyVideo(v) {
  const tn = (v.type_name || v.vod_class || '').toLowerCase();
  const tid = v.type_id || 0;
  if (tn.includes('电影') || tid === 1) return '电影';
  if (tn.includes('剧') || tn.includes('国产') || tn.includes('韩') || tn.includes('美') || tn.includes('日') || tn.includes('港') || tn.includes('台') || tid === 2) return '电视剧';
  if (tn.includes('综艺') || tn.includes('脱口秀') || tid === 3) return '综艺';
  if (tn.includes('动漫') || tn.includes('动画') || tid === 4) return '动漫';
  // 默认按 type_id
  if (tid === 1) return '电影';
  if (tid === 2) return '电视剧';
  if (tid === 3) return '综艺';
  if (tid === 4) return '动漫';
  return '其他';
}

function switchHomeTab(tabName) {
  currentHomeTab=tabName;

  // 隐藏所有Tab面板
  document.getElementById('homeTab_recommend').style.display='none';
  Object.values(tabPanelMap).forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display='none';
  });

  if(tabName==='recommend') {
    document.getElementById('homeTab_recommend').style.display='';
    return;
  }

  // 显示目标Tab面板
  const panelId=tabPanelMap[tabName];
  if(panelId) document.getElementById(panelId).style.display='';

  // 从后端请求smart=1数据（后端全量取+智能分类）
  const typeId=tabTypeMap[tabName];
  const state=catTabStates[typeId];
  
  // 首次切到该Tab则加载数据
  if(!state.loaded) loadHomeCatData(typeId, true);
  
  // 绑定滚动加载事件
  setupHomeScrollLoad(tabName);
}

// 渲染Tab分类数据
function renderHomeTabData(items, state) {
  if (!items || items.length === 0) {
    state.hasMore = false;
    state.loaded = true;
    return;
  }
  
  // 去重
  const seen = new Set();
  const uniqueItems = items.filter(v => {
    const key = v.vod_name + '_' + (v.vod_year || 0);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  state.allData = state.allData.concat(uniqueItems);
  state.hasMore = false;
  state.loaded = true;
}

async function loadHomeCatData(typeId, useSmart = false) {
  const state=catTabStates[typeId];
  if(state.loading||!state.hasMore) return;
  state.loading=true;
  const grid=document.getElementById('catGrid_'+typeId);
  const moreBtn=document.getElementById('catMore_'+typeId);
  if(state.page===1) grid.innerHTML=createSkeletonCards(9,false);
  if(moreBtn) moreBtn.textContent='加载中...';
  
  let data = null;
  // 先尝试后端API，使用smart=1参数（后端全量取+智能分类）
  if(API){
    const smartParam = useSmart ? '&smart=1' : '';
    data = await apiFetch(`${API}/api/category?type=${typeId}&pg=${state.page}${smartParam}`);
  }
  
  // 后端失败，从采集源获取
  if(!data || !data.list || !data.list.length){
    const sources = await getEnabledSources();
    if(sources.length){
      const src = sources[0];
      try {
        const resp = await fetch(`${src.url}?ac=detail&t=${typeId}&pg=${state.page}`);
        const d = await resp.json();
        if(d && d.list && d.list.length){
          data = {list: d.list.map(v=>({...v, source_url:src.url, source_name:src.name}))};
        }
      } catch(e){}
    }
  }
  
  if(data&&data.list&&data.list.length){
    if(state.page===1) grid.innerHTML='';
    grid.innerHTML+=data.list.map(v=>createCatCard(v)).join('');
    bindCardClicks();
    state.hasMore=data.hasMore || data.list.length>=18;
    state.loaded=true;
    if(moreBtn) moreBtn.textContent=state.hasMore?'加载更多':'没有更多了';
  } else {
    if(state.page===1) grid.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-tertiary)">暂无数据</div>';
    state.hasMore=false;
    state.loaded=true;
    if(moreBtn) moreBtn.textContent='没有更多了';
  }
  state.loading=false;
}

// 骨架屏
function createSkeletonList(count){let h='';for(let i=0;i<count;i++){const d=(i*0.1).toFixed(2);h+=`<div class="skeleton-list-item"><div class="skeleton-list-cover skeleton-pulse" style="animation-delay:${d}s"></div><div class="skeleton-list-info"><div class="skeleton-list-title skeleton-pulse" style="animation-delay:${d}s"></div><div class="skeleton-list-meta skeleton-pulse-deep" style="animation-delay:${d}s"></div></div></div>`;}return h;}
function createSkeletonGrid(count){let h='';for(let i=0;i<count;i++){const d=(i*0.1).toFixed(2);h+=`<div class="skeleton-cat-card"><div class="cat-card-poster skeleton-pulse" style="animation-delay:${d}s"></div><div class="skeleton-title skeleton-pulse" style="animation-delay:${d}s"></div><div class="skeleton-meta skeleton-pulse-deep" style="animation-delay:${d}s"></div></div>`;}return h;}

function loadMoreHomeCat(typeId) {
  const state=catTabStates[typeId];
  if(state.hasMore&&!state.loading){state.page++;loadHomeCatData(typeId, true);}
}

// ==================== 分类页 ====================
function goCategory(typeId) {
  showPage('categoryPage');
  document.querySelectorAll('#catTypeTabs .ctt-item').forEach(t=>t.classList.toggle('active',parseInt(t.dataset.type)===typeId));
  document.querySelectorAll('#catQuickFilterScroll .qf-item').forEach(item=>item.classList.toggle('active',item.dataset.filter==='all'));
  switchCatPageTab(typeId);
}

function switchCatPageTab(typeId) {
  currentCatPageTab = typeId;
  categoryState.typeId = typeId;
  categoryState.quickFilter = 'all'; // 切换Tab时重置筛选
  updateCatQuickFilterUI();

  // 隐藏所有Tab面板，显示目标面板
  Object.values(catPagePanelMap).forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  const panel = document.getElementById(catPagePanelMap[typeId]);
  if(panel) panel.style.display = '';

  // 首次切到该Tab则加载数据
  const state = catPageTabStates[typeId];
  if(!state.loaded) loadCatPageTabData(typeId);
  
  // 绑定滚动加载事件
  setupCatPageScrollLoad(typeId);
}

async function loadCatPageTabData(typeId) {
  const state = catPageTabStates[typeId];
  if(state.loading || !state.hasMore) return;
  state.loading = true;
  const listView = document.getElementById('catPageList_'+typeId);
  const moreBtn = document.getElementById('catPageMore_'+typeId);
  const isFirstPage = state.page === 1;
  if(isFirstPage) listView.innerHTML = createSkeletonList(6);
  if(moreBtn) moreBtn.innerHTML='<span class="loading-spinner"></span>加载中';
  
  let data = null;
  // 先尝试后端API，使用smart=1参数（后端全量取+智能分类）
  if(API){
    data = await apiFetch(`${API}/api/category?type=${typeId}&pg=${state.page}&smart=1`);
  }
  
  // 后端失败，从采集源获取
  if(!data || !data.list || !data.list.length){
    const sources = await getEnabledSources();
    if(sources.length){
      const src = sources[0];
      try {
        const resp = await fetch(`${src.url}?ac=detail&t=${typeId}&pg=${state.page}`);
        const d = await resp.json();
        if(d && d.list && d.list.length){
          data = {list: d.list.map(v=>({...v, source_url:src.url, source_name:src.name}))};
        }
      } catch(e){}
    }
  }
  
  if(data && data.list && data.list.length){
    const newItems = data.list;
    if(isFirstPage){
      state.allData = newItems;
      listView.innerHTML = '';
    } else {
      state.allData = [...state.allData, ...newItems];
    }
    // 追加渲染
    const frag = document.createDocumentFragment();
    newItems.forEach((v,i)=>{
      const rank = state.allData.indexOf(v)+1;
      const tags = (v.vod_class||v.type_name||'').split(',').filter(Boolean).slice(0,3);
      const metaItems = [v.vod_score?`<span class="cat-list-meta-item rating">⭐ ${v.vod_score}</span>`:'',v.vod_year?`<span class="cat-list-meta-item">${v.vod_year}</span>`:'',v.vod_area?`<span class="cat-list-meta-item">${v.vod_area}</span>`:''].filter(Boolean);
      const div = document.createElement('div');
      div.className = 'cat-list-item';
      div.dataset.vod = JSON.stringify(v).replace(/'/g,"&#39;");
      div.innerHTML = `<div class="cat-list-cover"><img src="${v.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'"><span class="cat-list-rank ${rank<=3?'top':''}">${rank}</span></div><div class="cat-list-info"><div class="cat-list-title">${v.vod_name||''}</div><div class="cat-list-meta">${metaItems.join('')}</div>${tags.length?`<div class="cat-list-tags">${tags.map(t=>`<span class="cat-list-tag-item">${t}</span>`).join('')}</div>`:''}</div>`;
      div.onclick = ()=>{try{const v=JSON.parse(div.dataset.vod);showDetail(v);}catch(e){}};
      frag.appendChild(div);
    });
    listView.appendChild(frag);
    state.hasMore = newItems.length >= 18;
    state.loaded = true;
    if(moreBtn) moreBtn.textContent = state.hasMore?'加载更多':'没有更多了';
  } else {
    if(isFirstPage) listView.innerHTML = '<div class="cat-empty"><div class="cat-empty-icon">📭</div><div class="cat-empty-text">暂无数据</div></div>';
    state.hasMore = false;
    state.loaded = true;
    if(moreBtn) moreBtn.textContent = '没有更多了';
  }
  state.loading = false;
}

function loadMoreCatPageTab(typeId) {
  const state = catPageTabStates[typeId];
  if(state.hasMore && !state.loading){state.page++;loadCatPageTabData(typeId);}
}

async function loadCatPageData() {
  if(categoryState.loading||!categoryState.hasMore) return;
  categoryState.loading=true;
  const listView=document.getElementById('catPageListView');
  const isFirstPage=categoryState.page===1;
  if(isFirstPage) listView.innerHTML=createSkeletonList(6);
  const data=await apiFetch(`${API}/api/category?type=${categoryState.typeId}&pg=${categoryState.page}&smart=1`);
  if(data&&data.list&&data.list.length){
    const newItems=data.list;
    if(isFirstPage){
      categoryState.allData=newItems;
      listView.innerHTML='';
    } else {
      categoryState.allData=[...categoryState.allData,...newItems];
    }
    // 追加渲染：只渲染新增的条目，避免整列表刷新
    const sortedNew=sortCatData(newItems);
    const frag=document.createDocumentFragment();
    sortedNew.forEach((v,i)=>{
      const rank=categoryState.allData.indexOf(v)+1;
      const tags=(v.vod_class||v.type_name||'').split(',').filter(Boolean).slice(0,3);
      const metaItems=[v.vod_score?`<span class="cat-list-meta-item rating">⭐ ${v.vod_score}</span>`:'',v.vod_year?`<span class="cat-list-meta-item">${v.vod_year}</span>`:'',v.vod_area?`<span class="cat-list-meta-item">${v.vod_area}</span>`:''].filter(Boolean);
      const div=document.createElement('div');
      div.className='cat-list-item';
      div.dataset.vod=JSON.stringify(v).replace(/'/g,"&#39;");
      div.innerHTML=`<div class="cat-list-cover"><img src="${v.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'"><span class="cat-list-rank ${rank<=3?'top':''}">${rank}</span></div><div class="cat-list-info"><div class="cat-list-title">${v.vod_name||''}</div><div class="cat-list-meta">${metaItems.join('')}</div>${tags.length?`<div class="cat-list-tags">${tags.map(t=>`<span class="cat-list-tag-item">${t}</span>`).join('')}</div>`:''}</div>`;
      div.onclick=()=>{try{showDetail(JSON.parse(div.dataset.vod));}catch(e){}};
      frag.appendChild(div);
    });
    listView.appendChild(frag);
    categoryState.hasMore=newItems.length>=18;
  } else {
    if(isFirstPage) listView.innerHTML='<div class="cat-empty"><div class="cat-empty-icon">📭</div><div class="cat-empty-text">暂无数据</div></div>';
    categoryState.hasMore=false;
  }
  categoryState.loading=false;
}

function loadMoreCatPage(){if(categoryState.hasMore&&!categoryState.loading){categoryState.page++;loadCatPageData();}}

// 分类页排序
function sortCatData(list){
  const f=categoryState.filter.sort;
  if(f==='score') return [...list].sort((a,b)=>(parseFloat(b.vod_score)||0)-(parseFloat(a.vod_score)||0));
  if(f==='new') return [...list].sort((a,b)=>(b.vod_year||0)-(a.vod_year||0));
  return list;
}

// 分类页筛选
function filterCatData(list){
  const type=categoryState.quickFilter==='all'?'all':categoryState.quickFilter;
  const {area,year}=categoryState.filter;
  return list.filter(v=>{
    if(type!=='all'){
      const classes=(v.vod_class||v.type_name||'').toLowerCase();
      if(!classes.includes(type.toLowerCase())) return false;
    }
    if(area!=='all'){
      const areas=(v.vod_area||'').toLowerCase();
      if(!areas.includes(area.toLowerCase())) return false;
    }
    if(year!=='all'){
      const vy=v.vod_year?''+v.vod_year:'';
      if(year==='00'){if(vy&&vy.length===4&&parseInt(vy)<2018)return true;return false;}
      if(vy!==year) return false;
    }
    return true;
  });
}

// 渲染分类页列表视图
function renderCatList(list,container){
  const filtered=filterCatData(list);
  if(filtered.length===0){container.innerHTML='<div class="cat-empty"><div class="cat-empty-icon">🔍</div><div class="cat-empty-text">没有符合筛选条件的内容</div></div>';return;}
  container.innerHTML=filtered.map((v,i)=>{
    const rank=i+1;
    const tags=(v.vod_class||v.type_name||'').split(',').filter(Boolean).slice(0,3);
    const metaItems=[v.vod_score?`<span class="cat-list-meta-item rating">⭐ ${v.vod_score}</span>`:'',v.vod_year?`<span class="cat-list-meta-item">${v.vod_year}</span>`:'',v.vod_area?`<span class="cat-list-meta-item">${v.vod_area}</span>`:''].filter(Boolean);
    const idx = '_l'+Math.random().toString(36).slice(2,8);
    window._vodData[idx] = v;
    return `<div class="cat-list-item" data-vid="${idx}">
      <div class="cat-list-cover"><img src="${v.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'"><span class="cat-list-rank ${rank<=3?'top':''}">${rank}</span></div>
      <div class="cat-list-info">
        <div class="cat-list-title">${v.vod_name||''}</div>
        <div class="cat-list-meta">${metaItems.join('')}</div>
        ${tags.length?`<div class="cat-list-tags">${tags.map(t=>`<span class="cat-list-tag-item">${t}</span>`).join('')}</div>`:''}
      </div>
    </div>`;
  }).join('');
  container.querySelectorAll('.cat-list-item').forEach(item=>{item.onclick=()=>{try{const v=window._vodData[item.dataset.vid];if(v)showDetail(v);}catch(e){}};});
}

// 渲染分类页网格视图
function renderCatGrid(list,container){
  const filtered=filterCatData(list);
  if(filtered.length===0) return;
  container.innerHTML=filtered.map(v=>{
    const badge=v.vod_score&&parseFloat(v.vod_score)>=8?'热播':(v.vod_class||v.type_name||'').split(',')[0];
    const idx = '_g'+Math.random().toString(36).slice(2,8);
    window._vodData[idx] = v;
    return `<div class="cat-grid-card" data-vid="${idx}">
      <div class="cat-grid-cover"><img src="${v.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'">${badge?`<span class="cat-grid-badge">${badge}</span>`:''}</div>
      <div class="cat-grid-info"><div class="cat-grid-title">${v.vod_name||''}</div><div class="cat-grid-meta"><span class="rating">${v.vod_score?'⭐ '+v.vod_score:''}</span><span>${v.vod_year||''}</span></div></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.cat-grid-card').forEach(card=>{card.onclick=()=>{try{const v=window._vodData[card.dataset.vid];if(v)showDetail(v);}catch(e){}};});
}

// ==================== 旧版分类页（保留向后兼容） ====================
async function loadCategoryData() {
  if(categoryState.loading||!categoryState.hasMore) return;
  categoryState.loading=true;
  const grid=document.getElementById('categoryGrid');
  if(categoryState.page===1) grid.innerHTML=createSkeletonCards(9,false);
  const moreBtn=document.getElementById('loadMoreBtn');
  if(moreBtn) moreBtn.innerHTML='<span class="loading-spinner"></span>加载中';
  const data=await apiFetch(`${API}/api/category?type=${categoryState.typeId}&pg=${categoryState.page}&smart=1`);
  if(data&&data.list&&data.list.length){
    if(categoryState.page===1) grid.innerHTML='';
    grid.innerHTML+=data.list.map(v=>createCatCard(v)).join('');
    bindCardClicks();
    categoryState.hasMore=data.list.length>=18;
    if(moreBtn) moreBtn.textContent=categoryState.hasMore?'加载更多':'没有更多了';
  } else {
    if(categoryState.page===1) grid.innerHTML='<div style="text-align:center;padding:40px;color:var(--text-tertiary)">暂无数据</div>';
    categoryState.hasMore=false;
    if(moreBtn) moreBtn.textContent='没有更多了';
  }
  categoryState.loading=false;
}
function loadMoreCategory(){if(categoryState.hasMore&&!categoryState.loading){categoryState.page++;loadCategoryData();}}

// 加载中提示HTML
function getLoadingHtml(text = '加载中') {
  return `<div class="loading-text" style="text-align:center;padding:40px"><span class="loading-spinner loading-spinner-large"></span>${text}</div>`;
}

// 滚动加载：监听每个首页Tab面板的滚动
Object.entries(tabPanelMap).forEach(([tabName,panelId])=>{
  const panel=document.getElementById(panelId);
  if(!panel) return;
  panel.addEventListener('scroll',function(){
    const typeId=tabTypeMap[tabName];
    if(this.scrollTop+this.clientHeight>=this.scrollHeight-200){
      if(typeId&&catTabStates[typeId]&&catTabStates[typeId].hasMore&&!catTabStates[typeId].loading) loadMoreHomeCat(typeId);
    }
  });
});
document.getElementById('categoryContent')?.addEventListener('scroll',function(){
  if(this.scrollTop+this.clientHeight>=this.scrollHeight-200){
    if(categoryState.hasMore&&!categoryState.loading) loadMoreCategory();
  }
});

// ==================== 首页左右滑动切换Tab ====================
let homeTouchStartX=0,homeTouchStartY=0,homeTouchStartTime=0;
// 在首页整个区域监听触摸事件
document.getElementById('homePage')?.addEventListener('touchstart',e=>{
  homeTouchStartX=e.touches[0].clientX;homeTouchStartY=e.touches[0].clientY;homeTouchStartTime=Date.now();
},{passive:true});
document.getElementById('homePage')?.addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-homeTouchStartX;
  const dy=Math.abs(e.changedTouches[0].clientY-homeTouchStartY);
  const dt=Date.now()-homeTouchStartTime;
  if(Math.abs(dx)<60||dy>60||dt>500) return;
  if(e.target.closest('.video-scroll')) return;
  const idx=tabOrder.indexOf(currentHomeTab);
  let ni;
  if(dx<0&&idx<tabOrder.length-1) ni=idx+1;
  else if(dx>0&&idx>0) ni=idx-1;
  else return;
  document.querySelectorAll('#tabNav .tab-item').forEach(t=>t.classList.remove('active'));
  const nt=document.querySelector(`#tabNav .tab-item[data-tab="${tabOrder[ni]}"]`);
  if(nt){nt.classList.add('active');nt.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});}
  switchHomeTab(tabOrder[ni]);
},{passive:true});

// ==================== 详情 ====================
async function showDetail(v) {
  currentVideo=v;cleanupPlayer();
  currentSourceIndex = 0;
  currentEpisodeIndex = -1;
  isPlaying = false;
  playSources = [];
  window._pendingPlayVideo = v;
  
  document.getElementById('miniPlayerBar').style.display = 'none';
  
  const userClickName = v.vod_name;
  
  // 跳转到详情信息页
  showPage('detailInfoPage');
  
  // 显示基本信息
  const infoTitleEl = document.getElementById('infoTitle2') || document.getElementById('infoTitle');
  if(infoTitleEl) infoTitleEl.textContent = userClickName;
  
  const infoMetaEl = document.getElementById('infoMeta2');
  if(infoMetaEl) {
    const meta = [v.vod_year, v.vod_area, v.type_name||v.vod_class].filter(Boolean).join(' · ');
    infoMetaEl.innerHTML = meta + (v.vod_score ? ` <span style="color:#FF9800">★ ${v.vod_score}</span>` : '');
  }
  
  const poster = document.getElementById('infoPoster');
  if(poster) poster.src = v.vod_pic || '';
  
  // 隐藏详情卡片，等待数据
  ['infoRatingCard', 'infoDescCard', 'infoDirectorCard', 'infoActorCard'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  
  // 更新收藏按钮
  if(typeof updateInfoFavBtn === 'function') updateInfoFavBtn();
  
  // 用采集源数据填充详情卡片
  if(typeof renderInfoPageCardsFromSource === 'function') {
    renderInfoPageCardsFromSource(v);
  }
  
  // 异步获取豆瓣详情
  if(typeof showDoubanDetail === 'function') {
    showDoubanDetail(null, userClickName);
  }
}
function checkDescExpand() {
  const infoDesc = document.getElementById('infoDesc');
  const descToggle = document.getElementById('descToggle');
  const infoDescWrapper = document.getElementById('infoDescWrapper');
  if(!infoDesc || !descToggle) return;
  
  // 超过3行需要展开按钮
  if(infoDesc.scrollHeight > infoDesc.clientHeight + 5) {
    descToggle.style.display = '';
    infoDescWrapper.classList.add('expandable');
  } else {
    descToggle.style.display = 'none';
    infoDescWrapper.classList.remove('expandable');
  }
}

// 切换描述展开/收起
function toggleDesc() {
  const infoDesc = document.getElementById('infoDesc');
  const descToggle = document.getElementById('descToggle');
  if(!infoDesc || !descToggle) return;
  
  infoDesc.classList.toggle('expanded');
  descToggle.textContent = infoDesc.classList.contains('expanded') ? '收起' : '展开';
}

function parsePlayUrls(vod) {
  if(!vod.vod_play_url)return[];
  const r=[],from=(vod.vod_play_from||'').split('$$$'),urls=(vod.vod_play_url||'').split('$$$');
  for(let i=0;i<urls.length;i++){
    const eps=urls[i].split('#').filter(Boolean).map(e=>{const p=e.split('$');return{name:p[0]||`第${i+1}集`,url:p[1]||p[0]};}).filter(e=>e.url);
    if(eps.length)r.push({name:from[i]||`源${i+1}`,sourceId:vod.source_id,sourceName:vod.source_name,episodes:eps});
  }
  return r;
}

// 渲染源切换Tab
function renderSourceTabs() {
  const container = document.getElementById('sourceTabsScroll');
  const card=document.getElementById('sourceCard');
  if(!container || !playSources.length) return;
  if(playSources.length>1){
    if(card) card.style.display='block';
    var oldTab=document.getElementById('sourceTabs');
    if(oldTab) oldTab.style.display='none';
  }
  
  container.innerHTML = playSources.map((source, idx) => `
    <button class="source-tab ${idx === currentSourceIndex ? 'active' : ''}" onclick="switchSource(${idx})">
      线路${idx + 1}
    </button>
  `).join('');
}

// 切换源
function switchSource(idx) {
  if(idx === currentSourceIndex) return;
  
  // 保存当前集数索引（用于尝试在新源中找到对应位置）
  const prevEpisodeIndex = currentEpisodeIndex;
  currentSourceIndex = idx;
  
  // 渲染该源的集数
  if(playSources[idx]) {
    const eps = playSources[idx].episodes;
    // 如果新源的集数足够多，尝试保持之前的集数索引
    if(eps && eps.length > prevEpisodeIndex) {
      currentEpisodeIndex = prevEpisodeIndex;
    } else if(eps && eps.length > 0) {
      // 否则选择最后一集
      currentEpisodeIndex = eps.length - 1;
    }
    renderEpisodes(playSources[idx], idx);
  }
  
  // 更新Tab高亮状态
  document.querySelectorAll('.source-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === idx);
  });
}

// 渲染单个源的集数
function renderEpisodes(source, sourceIndex) {
  const grid=document.getElementById('episodesGrid');
  var sec=document.getElementById('episodesSection');
  var card=document.getElementById('episodesCard');
  if(!source || !source.episodes || !source.episodes.length){
    // 没有集数时显示加载提示，不隐藏（等待fetchOtherSources补充数据）
    if(sec) sec.style.display='block';
    if(card) card.style.display='block';
    if(grid) grid.innerHTML='<div style="color:#888;padding:20px;text-align:center;font-size:13px;">正在加载集数...</div>';
    return;
  }
  if(sec) sec.style.display='block';
  if(card) card.style.display='block';
  const eps = source.episodes;
  
  grid.innerHTML=eps.slice(0,60).map((ep,i)=>{
    const isActive = (sourceIndex === currentSourceIndex && i === currentEpisodeIndex && currentEpisodeIndex >= 0);
    const isPlayingState = isActive && isPlaying;
    return `<button class="ep-btn ${isActive ? 'active' : ''} ${isPlayingState ? 'playing' : ''}" 
            data-source="${sourceIndex}" data-episode="${i}"
            onclick="selectEpisode(${sourceIndex}, ${i})">${ep.name}</button>`;
  }).join('');
  
  // 如果是当前播放的集数（已选），更新当前集数和URL
  if(currentEpisodeIndex >= 0 && sourceIndex === currentSourceIndex && eps[currentEpisodeIndex]) {
    currentEpisode = eps[currentEpisodeIndex];
    currentPlayUrl = eps[currentEpisodeIndex].url;
  }
}

// 选集 - 选集即播放
// 点击播放按钮直接播放第一集
function startPlayFirst(){
  if(!playSources.length||!playSources[0].episodes.length){showToast('暂无可播放的集数');return;}
  selectEpisode(0,0);
}

function selectEpisode(sourceIdx, epIdx) {
  if(!playSources[sourceIdx] || !playSources[sourceIdx].episodes[epIdx]) return;
  
  currentSourceIndex = sourceIdx;
  currentEpisodeIndex = epIdx;
  currentEpisode = playSources[sourceIdx].episodes[epIdx];
  currentPlayUrl = playSources[sourceIdx].episodes[epIdx].url;
  
  // 更新集数按钮状态
  document.querySelectorAll('.ep-btn').forEach(btn => {
    const s = parseInt(btn.dataset.source);
    const e = parseInt(btn.dataset.episode);
    const isActive = (s === sourceIdx && e === epIdx);
    btn.classList.toggle('active', isActive);
    btn.classList.toggle('playing', isActive && isPlaying);
  });
  
  // 立即播放
  playCurrent();
}

// 兼容旧函数（如果外部有调用）
function selectSourceEpisode(si, ei) {
  selectEpisode(si, ei);
}

// 兼容旧函数
function renderEpisodesOld(sources) {
  if(!sources||!sources.length||!sources[0].episodes.length){
    document.getElementById('episodesSection').style.display='none';
    return;
  }
  document.getElementById('sourceTabs').style.display='none';
  renderEpisodes(sources[0], 0);
}

async function fetchOtherSources(name) {
  if(!name)return;
  const enabledSources = await getEnabledSources();
  if(!enabledSources.length) return;
  let needRefreshEpisodes = false;
  for(const src of enabledSources) {
    try {
      const data = await apiFetch(`${API}/api/search/source?url=${encodeURIComponent(src.url)}&wd=${encodeURIComponent(name)}`, 10000);
      if(!data||!data.list) continue;
      let hasNewSource = false;
      for(const v of data.list){
        if(v.vod_name===name){
          const ns=parsePlayUrls(v);
          for(const s of ns){
            // 去重：同名+同集数数量视为重复
            const existIdx = playSources.findIndex(p=>p.name===s.name);
            if(existIdx===-1){
              playSources.push(s);
              hasNewSource=true;
            } else {
              // 已有同名源，但如果新数据集数更多，替换之
              if(s.episodes.length > playSources[existIdx].episodes.length){
                playSources[existIdx] = s;
                needRefreshEpisodes = true;
              }
            }
          }
        }
      }
      if(hasNewSource&&playSources.length>1){
        document.getElementById('sourceTabs').style.display='';
        renderSourceTabs();
      }
    } catch(e) {}
  }
  // 如果有同名源数据被更新（集数更多），刷新当前线路的集数
  if(needRefreshEpisodes && playSources[currentSourceIndex]){
    renderEpisodes(playSources[currentSourceIndex], currentSourceIndex);
    renderSourceTabs();
  }
}

// renderAllSources兼容函数
function renderAllSources() {
  if(playSources.length > 1) {
    document.getElementById('sourceTabs').style.display='';
    renderSourceTabs();
  }
}

// ==================== 播放 ====================
function cleanupPlayer(){
  const pa=document.getElementById('playerArea');
  if(pa){
    if(pa._progressTimer)clearInterval(pa._progressTimer);
    if(pa._hls){pa._hls.destroy();pa._hls=null;}
    if(pa._plyr){try{pa._plyr.destroy();}catch(e){}pa._plyr=null;}
  }
  const tpa=document.getElementById('tvPlayerArea');
  if(tpa){
    if(tpa._progressTimer)clearInterval(tpa._progressTimer);
    if(tpa._hls){tpa._hls.destroy();tpa._hls=null;}
  }
  if(tvHls){tvHls.destroy();tvHls=null;}
}

// ==================== Plyr 播放器初始化 ====================
function _initPlyrPlayer(pa, video) {
  // 销毁之前的 Plyr 实例
  if (pa._plyr) { try { pa._plyr.destroy(); } catch(e) {} }
  
  const player = new Plyr(video, {
    controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'settings'],
    speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
    clickToPlay: true,
    hideControls: true,
    keyboard: { focused: true, global: false },
    tooltips: { controls: true, seek: true },
    fullscreen: { enabled: false }  // 禁用 Plyr 内置全屏，使用 CSS 全屏方案
  });
  
  pa._plyr = player;
  
  // Plyr ready 后注入自定义按钮
  player.on('ready', function() { _addPlyrCustomButtons(pa, player, video); });
  
  // 双击 Plyr 容器进入全屏
  player.on('ready', function() {
    var plyrContainer = pa.querySelector('.plyr');
    if (plyrContainer) {
      plyrContainer.addEventListener('dblclick', function() {
        if (!isCSSFullscreen) enterFullscreenMode();
      });
    }
  });
}

function _addPlyrCustomButtons(pa, player, video) {
  var controls = pa.querySelector('.plyr__controls');
  if (!controls) return;
  
  var progress = controls.querySelector('.plyr__progress');
  
  // -- 快退 10s 按钮 --
  var rewindBtn = document.createElement('button');
  rewindBtn.type = 'button';
  rewindBtn.className = 'plyr__controls__item plyr__control';
  rewindBtn.innerHTML = '<span style="font-size:14px;line-height:1">\u00AB10s</span>';
  rewindBtn.setAttribute('aria-label', '后退10秒');
  var rewindTimer = null;
  function startRewind(e) {
    e.preventDefault();
    video.currentTime = Math.max(0, video.currentTime - 10);
    rewindTimer = setInterval(function() {
      video.currentTime = Math.max(0, video.currentTime - 10);
    }, 400);
  }
  function stopRewind() { clearInterval(rewindTimer); }
  rewindBtn.addEventListener('mousedown', startRewind);
  rewindBtn.addEventListener('touchstart', startRewind, {passive: false});
  rewindBtn.addEventListener('mouseup', stopRewind);
  rewindBtn.addEventListener('mouseleave', stopRewind);
  rewindBtn.addEventListener('touchend', stopRewind);
  rewindBtn.addEventListener('touchcancel', stopRewind);
  
  // -- 快进 10s 按钮 --
  var forwardBtn = document.createElement('button');
  forwardBtn.type = 'button';
  forwardBtn.className = 'plyr__controls__item plyr__control';
  forwardBtn.innerHTML = '<span style="font-size:14px;line-height:1">10s\u00BB</span>';
  forwardBtn.setAttribute('aria-label', '前进10秒');
  var forwardTimer = null;
  function startForward(e) {
    e.preventDefault();
    if (video.duration) video.currentTime = Math.min(video.duration, video.currentTime + 10);
    forwardTimer = setInterval(function() {
      if (video.duration) video.currentTime = Math.min(video.duration, video.currentTime + 10);
    }, 400);
  }
  function stopForward() { clearInterval(forwardTimer); }
  forwardBtn.addEventListener('mousedown', startForward);
  forwardBtn.addEventListener('touchstart', startForward, {passive: false});
  forwardBtn.addEventListener('mouseup', stopForward);
  forwardBtn.addEventListener('mouseleave', stopForward);
  forwardBtn.addEventListener('touchend', stopForward);
  forwardBtn.addEventListener('touchcancel', stopForward);
  
  // -- 全屏按钮 --
  var fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'plyr__controls__item plyr__control';
  fsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
  fsBtn.setAttribute('aria-label', '全屏');
  fsBtn.setAttribute('data-plyr', 'fullscreen');
  fsBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); enterFullscreenMode(); });
  
  // 插入自定义按钮到 Plyr 控制栏
  if (progress) {
    controls.insertBefore(rewindBtn, progress);
    // forwardBtn 插入到 progress 之后
    if (progress.nextSibling) {
      controls.insertBefore(forwardBtn, progress.nextSibling);
    } else {
      controls.appendChild(forwardBtn);
    }
  } else {
    controls.appendChild(rewindBtn);
    controls.appendChild(forwardBtn);
  }
  // 全屏按钮放到控制栏末尾
  controls.appendChild(fsBtn);
}

function playCurrent() {
  if(!currentPlayUrl){showToast('请先选择集数');return;}
  isPlaying = true;
  
  const pa=document.getElementById('playerArea');cleanupPlayer();
  const poster=document.getElementById('detailPoster');if(poster)poster.style.display='none';
  
  // 隐藏播放启动覆盖层
  const startOverlay = document.getElementById('playerStartOverlay');
  if(startOverlay) startOverlay.style.display = 'none';
  
  const video=document.createElement('video');
  video.autoplay=true;video.playsInline=true;
  video.style.cssText='width:100%;height:100%;background:#000;object-fit:contain;';
  video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');
  video.setAttribute('x5-playsinline','');video.setAttribute('x5-video-player-type','h5');video.setAttribute('x5-video-player-fullscreen','true');
  pa.innerHTML='';pa.appendChild(video);
  
  // 初始化 Plyr 播放器
  _initPlyrPlayer(pa, video);
  
  // HLS / 直接播放
  if(currentPlayUrl.includes('.m3u8')&&typeof Hls!=='undefined'&&Hls.isSupported()){
    const hls=new Hls({maxBufferLength:30,maxMaxBufferLength:60});hls.loadSource(currentPlayUrl);hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play());
    hls.on(Hls.Events.ERROR,(ev,d)=>{if(d.fatal){showToast('播放失败');hls.destroy();}});
    pa._hls=hls;
  } else {video.src=currentPlayUrl;video.play().catch(()=>{});}
  
  video.onerror=()=>showToast('播放失败');
  
  // 定期保存播放进度（每10秒）
  const progressTimer=setInterval(()=>{
    if(isPlaying&&currentVideo&&currentEpisode)saveHistory(currentVideo,currentEpisode.name);
  },10000);
  pa._progressTimer=progressTimer;
  
  // 退出/暂停时保存进度
  video.addEventListener('pause',()=>{
    if(currentVideo&&currentEpisode)saveHistory(currentVideo,currentEpisode.name);
  });
  video.addEventListener('ended',()=>{clearInterval(progressTimer);});
  
  // 如果有历史进度，跳转到上次位置
  const hist=getHistory();
  const histItem=hist.find(x=>x.vod_id===currentVideo.vod_id&&x.source_id===currentVideo.source_id);
  if(histItem&&histItem.currentTime>5&&histItem.epIdx===currentEpisodeIndex){
    video.addEventListener('loadedmetadata',()=>{
      video.currentTime=histItem.currentTime;
      showToast('已跳转到上次播放位置');
    },{once:true});
  }
  
  // 更新集数按钮播放状态
  document.querySelectorAll('.ep-btn').forEach(btn => {
    const s = parseInt(btn.dataset.source);
    const e = parseInt(btn.dataset.episode);
    btn.classList.toggle('playing', s === currentSourceIndex && e === currentEpisodeIndex);
  });
  
  // 显示底部播放条
  updateMiniPlayerBar(true);
  
  // 保存历史
  if(currentVideo&&currentEpisode)saveHistory(currentVideo,currentEpisode.name);
}

// 更新底部播放条
function updateMiniPlayerBar(show) {
  const bar = document.getElementById('miniPlayerBar');
  if(!bar) return;
  
  if(show) {
    const title = currentVideo ? currentVideo.vod_name : '';
    const ep = currentEpisode ? currentEpisode.name : '';
    document.getElementById('miniPlayerTitle').textContent = title;
    document.getElementById('miniPlayerEp').textContent = ep;
    bar.style.display = '';
    
    // 更新播放/暂停图标
    const video = document.querySelector('#playerArea video');
    updateMiniPlayIcon(video && !video.paused);
  } else {
    bar.style.display = 'none';
  }
}

// 更新迷你播放图标
function updateMiniPlayIcon(isPlayingVideo) {
  const icon = document.getElementById('miniPlayIcon');
  if(!icon) return;
  
  if(isPlayingVideo) {
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="#fff"/><rect x="14" y="4" width="4" height="16" fill="#fff"/>';
  } else {
    icon.innerHTML = '<polygon points="5,3 19,12 5,21" fill="#fff"/>';
  }
}

// 切换迷你播放
function toggleMiniPlay() {
  const video = document.querySelector('#playerArea video');
  if(!video) return;
  
  if(video.paused) {
    video.play().catch(()=>{});
  } else {
    video.pause();
  }
  updateMiniPlayIcon(!video.paused);
}

function playExternal() {
  if(!currentPlayUrl){showToast('请先选择集数');return;}
  // 优先通过原生接口调用外部播放器Intent
  if(window.YunShaoNative&&YunShaoNative.playExternal){YunShaoNative.playExternal(currentPlayUrl);return;}
  // 降级：复制链接到剪贴板
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(currentPlayUrl).then(()=>showToast('链接已复制')).catch(()=>showToast('复制失败'));
  else showToast('不支持');
}

// ==================== 搜索骨架屏 ====================
function createSearchSkeleton(count) {
  let html='';
  for(let i=0;i<count;i++){
    const delay=(i*0.15).toFixed(2);
    html+=`<div class="search-result-item" style="animation-delay:${Math.min(i*50,300)}ms"><div class="sri-poster skeleton-pulse" style="animation-delay:${delay}s"></div><div class="sri-info" style="gap:8px"><div style="height:16px;width:70%;border-radius:6px" class="skeleton-pulse" style="animation-delay:${delay}s"></div><div style="height:12px;width:50%;border-radius:6px" class="skeleton-pulse-deep" style="animation-delay:${delay}s"></div><div style="display:flex;gap:6px"><div style="height:20px;width:40px;border-radius:10px" class="skeleton-pulse-light" style="animation-delay:${delay}s"></div><div style="height:20px;width:50px;border-radius:10px" class="skeleton-pulse-light" style="animation-delay:${delay}s"></div></div></div></div>`;
  }
  return html;
}

// ==================== 搜索 ====================
function openSearchPage() {
  showPage('searchPage');
  document.getElementById('hotSearchSection').style.display='';
  document.getElementById('searchHistorySection').style.display='';
  document.getElementById('searchResultSection').style.display='none';
  renderSearchHistory();
  renderHotSearch();
  // 延迟聚焦并尝试调起键盘
  setTimeout(()=>{
    const input = document.getElementById('searchInputFull');
    if(input){ input.focus(); }
  }, 200);
}

// 点击视频卡 → 跳搜索页搜索视频名，跨所有源查找
function searchAndPlay(name) {
  if(!name) return;
  showPage('searchPage');
  document.getElementById('searchInputFull').value = name;
  document.getElementById('hotSearchSection').style.display='none';
  document.getElementById('searchHistorySection').style.display='none';
  doSearch();
}

function renderHotSearch() {
  // 先用当前缓存渲染，异步更新
  document.getElementById('hotSearchList').innerHTML=hotSearchKeywords.map((kw,i)=>{
    let badge=i<3?`<span class="hot-badge trend-up"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 4l-8 8h5v8h6v-8h5z" fill="currentColor"/></svg></span>`:'';let rc=i===0?'top1':i===1?'top2':i===2?'top3':'normal';let rankCls=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-normal';return `<div class="hot-item ${rankCls}" onclick="searchFromHot('${kw.replace(/'/g,"\\'")}')"><div class="hot-rank ${rc}">${i<3?'🔥':i+1}</div><div class="hot-name">${kw}</div>${badge}</div>`;
  }).join('');
  // 异步获取最新热搜词
  fetchHotKeywords().then(() => {
    document.getElementById('hotSearchList').innerHTML=hotSearchKeywords.map((kw,i)=>{
      let badge=i<3?`<span class="hot-badge trend-up"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 4l-8 8h5v8h6v-8h5z" fill="currentColor"/></svg></span>`:'';let rc=i===0?'top1':i===1?'top2':i===2?'top3':'normal';let rankCls=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-normal';return `<div class="hot-item ${rankCls}" onclick="searchFromHot('${kw.replace(/'/g,"\\'")}')"><div class="hot-rank ${rc}">${i<3?'🔥':i+1}</div><div class="hot-name">${kw}</div>${badge}</div>`;
    }).join('');
  });
}
function searchFromHot(kw){document.getElementById('searchInputFull').value=kw;doSearch();}

// ==================== 搜索历史 ====================
const SEARCH_HIST_KEY='ys_search_history';
const MAX_HISTORY=20;
function getSearchHistory(){try{return JSON.parse(localStorage.getItem(SEARCH_HIST_KEY)||'[]');}catch{return[];}}
function saveSearchHistory(wd){if(!wd)return;let hist=getSearchHistory();hist=hist.filter(h=>h!==wd);hist.unshift(wd);hist=hist.slice(0,MAX_HISTORY);localStorage.setItem(SEARCH_HIST_KEY,JSON.stringify(hist));}
function deleteSearchHistory(wd){let hist=getSearchHistory();hist=hist.filter(h=>h!==wd);localStorage.setItem(SEARCH_HIST_KEY,JSON.stringify(hist));renderSearchHistory();}
function clearAllHistory(){localStorage.setItem(SEARCH_HIST_KEY,'[]');renderSearchHistory();showToast('已清空历史');}
function renderSearchHistory(){const hist=getSearchHistory();const section=document.getElementById('searchHistorySection');const list=document.getElementById('searchHistoryList');if(!hist.length){section.style.display='none';return;}section.style.display='';list.innerHTML=hist.map(wd=>`<div class="hist-item" onclick="searchFromHistory('${wd.replace(/'/g,"\\'")}')"><div class="hist-icon"><svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div><span class="hist-text">${wd}</span><span class="hist-del" onclick="event.stopPropagation();deleteSearchHistory('${wd.replace(/'/g,"\\'")}')">×</span></div>`).join('');}
function searchFromHistory(wd){document.getElementById('searchInputFull').value=wd;doSearch();}

// ==================== 获取已启用的采集源列表 ====================
async function getEnabledSources() {
  let customSources = JSON.parse(localStorage.getItem('ys_custom_sources') || '[]');
  let enabledMap = JSON.parse(localStorage.getItem('ys_source_enabled') || '{}');
  let hiddenSources = JSON.parse(localStorage.getItem('ys_source_hidden') || '[]');
  
  let sources = [];
  // 服务端源
  let serverSources = JSON.parse(localStorage.getItem('ys_server_sources_cache') || '[]');
  
  // 如果缓存为空，主动从后端获取（短超时，快速探测后端是否存活）
  if (!serverSources.length) {
    try {
      const d = await apiFetch(`${API}/api/sources`, 5000);
      if (d && d.sources) {
        serverSources = d.sources;
        localStorage.setItem('ys_server_sources_cache', JSON.stringify(serverSources));
        _backendAlive = true;
      }
    } catch(e) {}
    // 无论成功还是失败，都写入缓存（失败写空数组），避免反复重试
    if (_backendAlive !== true) {
      _backendAlive = false;
      localStorage.setItem('ys_server_sources_cache', JSON.stringify(serverSources));
    }
  }
  
  serverSources.forEach(s => {
    const url = s.url || s.api_url || '';
    const eid = 's_' + s.id;
    if (hiddenSources.includes(eid)) return;
    const enabled = enabledMap.hasOwnProperty(eid) ? enabledMap[eid] : s.enabled;
    if (enabled && url) sources.push({ name: s.name, url: url });
  });
  
  // 前端自定义源
  customSources.forEach((s, i) => {
    const eid = 'c_' + i;
    const enabled = enabledMap.hasOwnProperty(eid) ? enabledMap[eid] : true;
    if (enabled && s.url) sources.push({ name: s.name, url: s.url });
  });
  
  return sources;
}

// 将前端配置的自定义采集源同步到后端，使搜索/首页/分类都能用到
async function syncSourcesToBackend() {
  const enabledSources = await getEnabledSources();
  // 补上后端需要的字段格式
  const formatted = enabledSources.map((s, i) => ({
    id: 100 + i,
    name: s.name,
    url: s.url,
    api_url: s.url,
    enabled: true
  }));
  try {
    // 加 5 秒超时，防止后端未启动时卡死启动流程
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    await fetch(`${API}/api/sources/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formatted),
      signal: ctrl.signal
    });
    clearTimeout(timer);
  } catch(e) { console.error('syncSourcesToBackend failed:', e); }
}

async function doSearch() {
  const wd=document.getElementById('searchInputFull').value.trim();if(!wd)return;
  document.getElementById('hotSearchSection').style.display='none';
  document.getElementById('searchHistorySection').style.display='none';
  document.getElementById('searchResultSection').style.display='';
  // 滚动回顶部
  const sc=document.getElementById('searchContent');if(sc)sc.scrollTop=0;
  saveSearchHistory(wd);

  const sources = await getEnabledSources();
  const totalSources = sources.length;
  let completedSources = 0, failedSources = 0, allResults = [];

  document.getElementById('searchResultHeader').innerHTML=`正在搜索"${wd}"...<div class="search-progress">已完成 <span id="searchDone">0</span>/${totalSources}个源，找到 <span id="searchFound">0</span>个结果</div>`;
  document.getElementById('searchResultList').innerHTML=createSearchSkeleton(5);

  // 搜索优化：最多取前8个源，每源8秒超时，收集到30条即提前返回
  const maxSources = Math.min(sources.length, 8);
  const searchPromises = sources.slice(0, maxSources).map(async (src) => {
    try {
      const data = await apiFetch(`${API}/api/search/source?url=${encodeURIComponent(src.url)}&wd=${encodeURIComponent(wd)}`, 8000);
      let list = [];
      if (data && data.list && data.list.length) {
        list = data.list.map(v=>({...v, source_url:src.url, source_name:src.name}));
      }
      completedSources++;
      const doneEl=document.getElementById('searchDone'), foundEl=document.getElementById('searchFound');
      if(doneEl) doneEl.textContent=completedSources;
      allResults = allResults.concat(list);
      if(foundEl) foundEl.textContent=allResults.length;
      return { ok: true, list };
    } catch(e) {
      failedSources++; completedSources++;
      const doneEl=document.getElementById('searchDone'); if(doneEl) doneEl.textContent=completedSources;
      return { ok: false, list: [] };
    }
  });

  // 等所有源完成（Promise.allSettled 确保不卡死），收集结果
  // 改用全量等待但显示进度，更稳定
  const allSettled = await Promise.allSettled(searchPromises);
  const merged = new Map();
  const seen = new Set();

  for (const result of allSettled) {
    if (result.status === 'fulfilled' && result.value.ok && result.value.list.length) {
      for (const v of result.value.list) {
        const key = (v.vod_name||'').trim() + '_' + (v.source_url||'');
        if (!seen.has(key) && (v.vod_name||'').trim()) {
          seen.add(key);
          merged.set(key, v);
        }
      }
    }
  }

  // 排序：精确匹配优先
  var sortedArr = Array.from(merged.values());
  var exact=sortedArr.filter(function(v){return v.vod_name===wd;});
  var partial=sortedArr.filter(function(v){return v.vod_name!==wd&&v.vod_name.includes(wd);});
  var rest=sortedArr.filter(function(v){return !v.vod_name.includes(wd);});
  var finalResults=[...exact,...partial,...rest].slice(0,30);

  if (!finalResults.length) {
    document.getElementById('searchResultHeader').innerHTML=`未找到"${wd}"`;
    document.getElementById('searchResultList').innerHTML='<div style="text-align:center;padding:50px 20px;color:var(--text-tertiary)">暂无结果</div>';
    return;
  }

  // 计算同名视频的源数量
  var nameCount={};
  finalResults.forEach(function(v){ var n=v.vod_name||''; nameCount[n]=(nameCount[n]||0)+1; });

  document.getElementById('searchResultHeader').innerHTML=`搜索"${wd}"完成<div class="search-progress">找到 ${finalResults.length} 个结果</div>`;
  document.getElementById('searchResultList').innerHTML=finalResults.map(function(v,i){
    const rank = i + 1;
    // 解析集数
    let maxEp = 0;
    if(v.vod_play_url) {
      const sources = v.vod_play_url.split('$$$');
      sources.forEach(s => { const eps = s.split('#').filter(Boolean); if(eps.length > maxEp) maxEp = eps.length; });
    }
    // 同名气源数量
    const sourceCount = nameCount[v.vod_name]||1;
    // 彩色标签
    const tagYear = v.vod_year ? `<span class="sri-tag sri-tag-year">${v.vod_year}</span>` : '';
    const tagArea = v.vod_area ? `<span class="sri-tag sri-tag-area">${v.vod_area}</span>` : '';
    const tagSrc = sourceCount > 0 ? `<span class="sri-tag sri-tag-source">📂 ${sourceCount}个源</span>` : '';
    const tagEp = maxEp > 0 ? `<span class="sri-tag sri-tag-ep">🎬 最多${maxEp}集</span>` : '';
    const tagType = (v.type_name || v.vod_class) ? `<span class="sri-tag sri-tag-type">${v.type_name||v.vod_class}</span>` : '';
    return `<div class="search-result-item" data-vod-idx="${i}" style="animation-delay:${Math.min(i*50,300)}ms"><div class="sri-poster"><img src="${v.vod_pic||''}" loading="lazy" onerror="this.src='${noImg}'"><span class="sri-rank ${rank<=3?'top':''}">${rank}</span></div><div class="sri-info"><div class="sri-title">${v.vod_name||''}</div><div class="sri-tags">${tagYear}${tagArea}${tagSrc}${tagEp}${tagType}</div></div></div>`;
  }).join('');
  // 保存搜索结果到全局变量，避免JSON嵌入HTML的编码问题
  window._searchResultData = finalResults;
  document.querySelectorAll('.search-result-item').forEach(function(it){it.onclick=function(){try{var idx=parseInt(this.dataset.vodIdx);var v=window._searchResultData[idx];if(v)showDetail(v);}catch(e){}};});
}

// ==================== 收藏 & 历史 ====================
function getFavorites(){try{return JSON.parse(localStorage.getItem('ys_fav')||'[]');}catch{return[];}}
function saveFavorites(f){localStorage.setItem('ys_fav',JSON.stringify(f));}
function getHistory(){try{return JSON.parse(localStorage.getItem('ys_hist')||'[]');}catch{return[];}}
function saveHistory(v,ep){
  const h=getHistory();
  const idx=h.findIndex(x=>x.vod_id===v.vod_id&&x.source_id===v.source_id);
  // 获取当前播放进度
  const video=document.querySelector('#playerArea video');
  const currentTime=video?Math.floor(video.currentTime):0;
  const duration=video?Math.floor(video.duration):0;
  const progress=duration>0?Math.round(currentTime/duration*100):0;
  const r={vod_id:v.vod_id,vod_name:v.vod_name,vod_pic:v.vod_pic,source_id:v.source_id,source_name:v.source_name,episode:ep,time:Date.now(),
    sourceIdx:currentSourceIndex,epIdx:currentEpisodeIndex,currentTime,duration,progress,
    vod_play_from:v.vod_play_from||'',vod_play_url:v.vod_play_url||'',vod_content:v.vod_content||'',vod_area:v.vod_area||'',vod_year:v.vod_year||'',type_name:v.type_name||'',vod_class:v.vod_class||'',vod_score:v.vod_score||'',source_url:v.source_url||''};
  if(idx>=0)h[idx]=r;else h.unshift(r);
  saveHistoryList(h.slice(0,100));
}
function saveHistoryList(h){localStorage.setItem('ys_hist',JSON.stringify(h));}
function toggleFavorite(){
  if(!currentVideo)return;
  const f=getFavorites();
  const i=f.findIndex(x=>x.vod_id===currentVideo.vod_id&&x.source_id===currentVideo.source_id);
  const detailBtn=document.getElementById('detailFavBtn');
  if(i>=0){f.splice(i,1);showToast('已取消收藏');}else{f.unshift({vod_id:currentVideo.vod_id,vod_name:currentVideo.vod_name,vod_pic:currentVideo.vod_pic,source_id:currentVideo.source_id,source_name:currentVideo.source_name});showToast('已收藏 ★');}
  saveFavorites(f);
  // 触发动画
  if(detailBtn){detailBtn.classList.remove('fav-animate');void detailBtn.offsetWidth;detailBtn.classList.add('fav-animate');}
  if(typeof updateDetailFavBtn==='function') updateDetailFavBtn();
  if(typeof updateInfoFavBtn==='function') updateInfoFavBtn();
}

function isFavorited(v){
  return getFavorites().some(x=>x.vod_id===v.vod_id&&x.source_id===v.source_id);
}
function loadProfileData(){
  // 加载统计
  const hist=getHistory();
  const fav=getFavorites();
  const sh=document.getElementById('statHistory');if(sh)sh.textContent=hist.length;
  const sf=document.getElementById('statFav');if(sf)sf.textContent=fav.length;
  const sfl=document.getElementById('statFollow');if(sfl)sfl.textContent=fav.filter(v=>v.following).length;
  const mh=document.getElementById('menuHistory');if(mh)mh.textContent=hist.length?hist.length+'部':'';
  const mf=document.getElementById('menuFav');if(mf)mf.textContent=fav.length?fav.length+'部':'';
  const mt=document.getElementById('menuTheme');if(mt)mt.textContent=document.body.classList.contains('theme-dark')?'深色':'浅色';

  // 加载历史列表 - 横向卡片
  const hlist=document.getElementById('historyList');
  if(hlist){
    if(!hist.length){hlist.innerHTML='<div class="mgmt-empty">暂无观看历史</div>';}
    hlist.innerHTML=hist.map((v,i)=>{
      const timeStr=v.time?formatTime(v.time):'';
      const prog=v.progress||0;
      const progBar=prog>0?`<div class="mgmt-progress"><div class="mgmt-progress-bar" style="width:${prog}%"></div></div>`:'';
      const progText=prog>0?`<span class="mgmt-prog-text">已看${prog}%</span>`:'';
      return `<div class="mgmt-item" data-idx="${i}" onclick="mgmtItemClick('hist',${i})">
        <span class="mgmt-checkbox mgmt-ch" id="hist_ch_${i}" style="display:none">☐</span>
        <div class="mgmt-cover"><img src="${v.vod_pic||''}" loading="lazy" onerror="this.src='${noImg}'">${progBar}</div>
        <div class="mgmt-info"><div class="mgmt-title">${v.vod_name||''}</div><div class="mgmt-meta">${v.episode||''}</div><div class="mgmt-time">${timeStr} ${progText}</div></div>
        <button class="mgmt-del-btn" ontouchend="event.stopPropagation();event.preventDefault();deleteHistItem(${i})" onclick="event.stopPropagation();deleteHistItem(${i})">删除</button>
      </div>`;
    }).join('');
  }

  // 加载收藏列表 - 横向卡片
  const flist=document.getElementById('favList');
  if(flist){
    if(!fav.length){flist.innerHTML='<div class="mgmt-empty">暂无收藏</div>';return;}
    flist.innerHTML=fav.map((v,i)=>{
      return `<div class="mgmt-item" data-idx="${i}" onclick="mgmtItemClick('fav',${i})">
        <span class="mgmt-checkbox mgmt-ch" id="fav_ch_${i}" style="display:none">☐</span>
        <div class="mgmt-cover"><img src="${v.vod_pic||''}" loading="lazy" onerror="this.src='${noImg}'"></div>
        <div class="mgmt-info"><div class="mgmt-title">${v.vod_name||''}</div></div>
        <button class="mgmt-del-btn" ontouchend="event.stopPropagation();event.preventDefault();deleteFavItem(${i})" onclick="event.stopPropagation();deleteFavItem(${i})">取消收藏</button>
      </div>`;
    }).join('');
  }
}

// 时间格式化
function formatTime(ts){
  const d=new Date(ts),now=new Date();
  const diff=now-d;
  if(diff<60000)return '刚刚';
  if(diff<3600000)return Math.floor(diff/60000)+'分钟前';
  if(diff<86400000)return Math.floor(diff/3600000)+'小时前';
  if(diff<604800000)return Math.floor(diff/86400000)+'天前';
  return (d.getMonth()+1)+'/'+d.getDate();
}

// 管理模式状态
let histMgmtMode=false, favMgmtMode=false;
let histSelected=new Set(), favSelected=new Set();

function toggleHistMgmt(){
  histMgmtMode=!histMgmtMode;
  histSelected.clear();
  document.getElementById('histMgmtBtn').textContent=histMgmtMode?'完成':'管理';
  document.getElementById('histSelectAllBtn').style.display=histMgmtMode?'':'none';
  document.getElementById('histDeleteBtn').style.display='none';
  document.querySelectorAll('#historyList .mgmt-ch').forEach(ch=>ch.style.display=histMgmtMode?'':'none');
  document.querySelectorAll('#historyList .mgmt-del-btn').forEach(b=>b.style.display=histMgmtMode?'none':'');
}

function toggleFavMgmt(){
  favMgmtMode=!favMgmtMode;
  favSelected.clear();
  document.getElementById('favMgmtBtn').textContent=favMgmtMode?'完成':'管理';
  document.getElementById('favSelectAllBtn').style.display=favMgmtMode?'':'none';
  document.getElementById('favDeleteBtn').style.display='none';
  document.querySelectorAll('#favList .mgmt-ch').forEach(ch=>ch.style.display=favMgmtMode?'':'none');
  document.querySelectorAll('#favList .mgmt-del-btn').forEach(b=>b.style.display=favMgmtMode?'none':'');
}

function mgmtItemClick(type,idx){
  if(type==='hist'&&histMgmtMode){toggleHistItem(idx);return;}
  if(type==='fav'&&favMgmtMode){toggleFavItem(idx);return;}
  // 非管理模式：跳转详情
  const list=type==='hist'?getHistory():getFavorites();
  const v=list[idx];
  if(!v)return;
  // 历史记录：标记要恢复的进度信息
  if(type==='hist'&&v.currentTime>0){
    window._resumeHistory={sourceIdx:v.sourceIdx||0,epIdx:v.epIdx||0,currentTime:v.currentTime};
  } else {
    window._resumeHistory=null;
  }
  showDetail(v);
}

function toggleHistItem(idx){
  if(histSelected.has(idx))histSelected.delete(idx);else histSelected.add(idx);
  const ch=document.getElementById('hist_ch_'+idx);
  if(ch)ch.textContent=histSelected.has(idx)?'☑':'☐';
  document.getElementById('histDeleteBtn').style.display=histSelected.size>0?'':'none';
}

function toggleFavItem(idx){
  if(favSelected.has(idx))favSelected.delete(idx);else favSelected.add(idx);
  const ch=document.getElementById('fav_ch_'+idx);
  if(ch)ch.textContent=favSelected.has(idx)?'☑':'☐';
  document.getElementById('favDeleteBtn').style.display=favSelected.size>0?'':'none';
}

function histSelectAll(){
  const hist=getHistory();
  if(histSelected.size===hist.length){histSelected.clear();}else{hist.forEach((_,i)=>histSelected.add(i));}
  hist.forEach((_,i)=>{const ch=document.getElementById('hist_ch_'+i);if(ch)ch.textContent=histSelected.has(i)?'☑':'☐';});
  document.getElementById('histDeleteBtn').style.display=histSelected.size>0?'':'none';
}

function favSelectAll(){
  const fav=getFavorites();
  if(favSelected.size===fav.length){favSelected.clear();}else{fav.forEach((_,i)=>favSelected.add(i));}
  fav.forEach((_,i)=>{const ch=document.getElementById('fav_ch_'+i);if(ch)ch.textContent=favSelected.has(i)?'☑':'☐';});
  document.getElementById('favDeleteBtn').style.display=favSelected.size>0?'':'none';
}

function updateHistCheckAll(){
  const ch=document.getElementById('histCheckAll');
  if(ch)ch.textContent=histSelected.size===getHistory().length&&getHistory().length>0?'☑':'☐';
}

function updateFavCheckAll(){
  const ch=document.getElementById('favCheckAll');
  if(ch)ch.textContent=favSelected.size===getFavorites().length&&getFavorites().length>0?'☑':'☐';
}

function deleteHistItem(idx){
  showConfirm('确定删除这条观看记录？',()=>{
    const h=getHistory();h.splice(idx,1);saveHistoryList(h);loadProfileData();showToast('已删除');
  });
}

function deleteFavItem(idx){
  showConfirm('确定取消收藏？',()=>{
    const f=getFavorites();f.splice(idx,1);saveFavorites(f);loadProfileData();showToast('已取消收藏');
  });
}

function histBatchDelete(){
  if(!histSelected.size){showToast('请先选择');return;}
  showConfirm(`确定删除选中的${histSelected.size}条记录？`,()=>{
    const h=getHistory();
    const sorted=[...histSelected].sort((a,b)=>b-a);
    sorted.forEach(i=>h.splice(i,1));
    saveHistoryList(h);histSelected.clear();
    histMgmtMode=false;
    document.getElementById('histMgmtBtn').textContent='管理';
    document.getElementById('histSelectAllBtn').style.display='none';
    document.getElementById('histDeleteBtn').style.display='none';
    document.querySelectorAll('#historyList .mgmt-ch').forEach(ch=>ch.style.display='none');
    document.querySelectorAll('#historyList .mgmt-del-btn').forEach(b=>b.style.display='');
    loadProfileData();showToast('已删除'+sorted.length+'条记录');
  });
}

function favBatchDelete(){
  if(!favSelected.size){showToast('请先选择');return;}
  showConfirm(`确定删除选中的${favSelected.size}个收藏？`,()=>{
    const f=getFavorites();
    const sorted=[...favSelected].sort((a,b)=>b-a);
    sorted.forEach(i=>f.splice(i,1));
    saveFavorites(f);favSelected.clear();
    favMgmtMode=false;
    document.getElementById('favMgmtBtn').textContent='管理';
    document.getElementById('favSelectAllBtn').style.display='none';
    document.getElementById('favDeleteBtn').style.display='none';
    document.querySelectorAll('#favList .mgmt-ch').forEach(ch=>ch.style.display='none');
    document.querySelectorAll('#favList .mgmt-del-btn').forEach(b=>b.style.display='');
    loadProfileData();showToast('已删除'+sorted.length+'个收藏');
  });
}

// 通用确认弹窗
function showConfirm(msg,onConfirm){
  let modal=document.getElementById('confirmModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='confirmModal';
    modal.innerHTML=`<div class="confirm-overlay" id="confirmOverlay"></div><div class="confirm-dialog"><div class="confirm-msg" id="confirmMsg"></div><div class="confirm-btns"><button class="confirm-cancel" id="confirmCancel">取消</button><button class="confirm-ok" id="confirmOk">确定</button></div></div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('confirmMsg').textContent=msg;
  modal.style.display='';
  document.getElementById('confirmCancel').onclick=()=>{modal.style.display='none';};
  document.getElementById('confirmOverlay').onclick=()=>{modal.style.display='none';};
  document.getElementById('confirmOk').onclick=()=>{modal.style.display='none';onConfirm();};
}

// ==================== 清除缓存 ====================
function clearCache(){
  localStorage.removeItem('ys_hist');
  localStorage.removeItem('ys_fav');
  showToast('缓存已清除');
  loadProfileData();
}

// ==================== 源管理 ====================
// ==================== 采集源管理 ====================
let editingSourceId = null;
let editingSourceIsServer = false;

// ==================== 采集源健康检测 ====================
// 检测单个采集源健康状态（带重试，分步验证）
function checkSourceHealth(url, retries){
  retries = retries || 1;
  return new Promise(function(resolve){
    function attempt(remain){
      var done = false;
      var timer=setTimeout(function(){
        if(done) return; done=true;
        if(remain>0) attempt(remain-1);
        else resolve(false);
      },8000);
      // 第一步：尝试实际API接口（/?ac=list）
      var testUrl = url.replace(/\/+$/,'') + '/?ac=list';
      fetch(testUrl,{method:'GET',cache:'no-cache'}).then(function(r){
        if(done) return; done=true; clearTimeout(timer);
        if(r.ok && r.type!=='opaque'){
          // CORS允许，验证返回内容
          r.text().then(function(txt){
            var valid = txt.length > 10;
            resolve(valid);
          }).catch(function(){ resolve(true); }); // 能读到响应头就算OK
        } else {
          // CORS被拦截或返回非ok，降级到基本连通性检测
          fallbackCheck(url, remain, resolve);
        }
      }).catch(function(){
        if(done) return; done=true; clearTimeout(timer);
        // API请求失败，降级到基本连通性检测
        fallbackCheck(url, remain, resolve);
      });
    }
    attempt(retries);
  });
}
// 降级检测：用no-cors验证服务器是否在线
function fallbackCheck(url, remain, resolve){
  var timer2=setTimeout(function(){
    if(remain>0) { checkSourceHealth(url, remain-1).then(resolve); }
    else resolve(false);
  },6000);
  fetch(url,{method:'HEAD',mode:'no-cors',cache:'no-cache'}).then(function(r){
    clearTimeout(timer2);
    // opaque说明服务器有响应，至少没挂
    if(r.type==='opaque') resolve(true);
    else if(r.ok) resolve(true);
    else if(remain>0) { checkSourceHealth(url, remain-1).then(resolve); }
    else resolve(false);
  }).catch(function(){
    clearTimeout(timer2);
    if(remain>0) { checkSourceHealth(url, remain-1).then(resolve); }
    else resolve(false);
  });
}

// 获取采集源状态缓存（6小时有效期）
function getSourceStatusCache(){
  const cache=localStorage.getItem('ys_source_status');
  if(!cache) return null;
  try{
    const data=JSON.parse(cache);
    // 6小时有效期
    if(Date.now()-data.time>6*60*60*1000) return null;
    return data.status;
  }catch(e){return null;}
}

// 批量检测所有采集源
async function checkAllSources(){
  const btn=document.getElementById('checkAllBtn');
  if(btn){btn.textContent='检测中...';btn.disabled=true;}
  showToast('开始检测采集源...');
  
  // 获取所有采集源
  let serverSources=[];
  try{const d=await apiFetch(`${API}/api/sources`);if(d&&d.sources)serverSources=d.sources;}catch(e){}
  let customSources=JSON.parse(localStorage.getItem('ys_custom_sources')||'[]');
  let hiddenSources=JSON.parse(localStorage.getItem('ys_source_hidden')||'[]');
  
  let allSources=[];
  var serverUrls = new Set();
  serverSources.forEach(s=>{
    const url=s.url||s.api_url||'';
    const eid='s_'+s.id;
    if(hiddenSources.includes(eid)) return;
    serverUrls.add(url.replace(/\/+$/,''));
    allSources.push({id:eid, url:url});
  });
  customSources.forEach((s,i)=>{
    var url = (s.url||'').replace(/\/+$/,'');
    if(serverUrls.has(url)) return; // 服务端已有，跳过避免重复
    allSources.push({id:'c_'+i, url:s.url});
  });
  
  const status={};
  let checked=0;
  for(const src of allSources){
    if(src.url){
      const ok=await checkSourceHealth(src.url);
      status[src.id]=ok;
    }
    checked++;
    // 更新按钮文字
    if(btn) btn.textContent=`检测中 ${checked}/${allSources.length}`;
  }
  
  // 保存缓存
  localStorage.setItem('ys_source_status',JSON.stringify({time:Date.now(),status:status}));
  
  if(btn){btn.textContent='检测';btn.disabled=false;}
  showToast(`检测完成：${Object.values(status).filter(v=>v).length}/${allSources.length} 正常`);
  loadSourcePage();
}

// 获取单个采集源状态
function getSourceStatus(id){
  const cache=getSourceStatusCache();
  if(!cache) return 'unknown';
  if(cache.hasOwnProperty(id)) return cache[id]?'ok':'fail';
  return 'unknown';
}

// 默认采集源预设模板
const DEFAULT_SOURCE_TEMPLATES = [
  {name:"非凡资源",url:"https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8/"},
  {name:"量子资源",url:"https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8/"},
  {name:"暴风资源",url:"https://bfzyapi.com/api.php/provide/vod/from/bfzym3u8/"},
  {name:"光速资源",url:"https://api.guangsuapi.com/api.php/provide/vod/from/gsm3u8/"},
  {name:"天空资源",url:"https://m3u8.tiankongapi.com/api.php/provide/vod/from/tkm3u8/"},
  {name:"红牛资源",url:"https://www.hongniuzy2.com/api.php/provide/vod/from/hnm3u8/"},
  // 蛋播星球采集源（默认不启用）
  {name:"爱奇艺",url:"https://iqiyizyapi.com/api.php/provide/vod/",disabled:true},
  {name:"黑料资源",url:"https://www.heiliaozyapi.com/api.php/provide/vod/",disabled:true},
  {name:"如意资源",url:"https://cj.rycjapi.com/api.php/provide/vod/",disabled:true},
  {name:"卧龙资源",url:"https://wolongzyw.com/api.php/provide/vod/",disabled:true},
  {name:"极速资源",url:"https://jszyapi.com/api.php/provide/vod/",disabled:true},
  {name:"茅台资源",url:"https://caiji.maotaizy.cc/api.php/provide/vod/",disabled:true},
  {name:"猫眼资源",url:"https://api.maoyanapi.top/api.php/provide/vod/",disabled:true},
  {name:"电影天堂",url:"http://caiji.dyttzyapi.com/api.php/provide/vod/",disabled:true},
];

async function loadSourcePage(){
  showPage('sourcePage');
  const c=document.getElementById('sourceContent');
  
  // 从Java端获取服务端源列表作为基础
  let serverSources=[];
  try{const d=await apiFetch(`${API}/api/sources`);if(d&&d.sources)serverSources=d.sources;}catch(e){}
  // 缓存服务端源列表，供getEnabledSources()使用
  if(serverSources.length) localStorage.setItem('ys_server_sources_cache',JSON.stringify(serverSources));
  
  // 读取前端自定义源列表（localStorage）
  let customSources=JSON.parse(localStorage.getItem('ys_custom_sources')||'[]');
  
  // 合并：服务端源 + 前端自定义源
  // 服务端源用 enabledMap 管理启用状态
  let enabledMap=JSON.parse(localStorage.getItem('ys_source_enabled')||'{}');
  let hiddenSources=JSON.parse(localStorage.getItem('ys_source_hidden')||'[]');
  let nameOverride=JSON.parse(localStorage.getItem('ys_source_name_override')||'{}');
  let allSources=[];
  
  // 服务端源（过滤被隐藏的）
  serverSources.forEach(s=>{
    const url=s.url||s.api_url||'';
    const eid='s_'+s.id;
    if(hiddenSources.includes(eid)) return; // 跳过已隐藏的
    allSources.push({
      id:eid, name:nameOverride[eid]||s.name, url:url, 
      enabled: enabledMap.hasOwnProperty(eid)?enabledMap[eid]:s.enabled,
      isServer:true
    });
  });
  
  // 前端自定义源（按 URL 去重，已有服务端源的跳过）
  var serverUrls = new Set(serverSources.map(function(s){ return (s.url||s.api_url||'').replace(/\/+$/,''); }));
  customSources.forEach(function(s,i){
    var url = (s.url||'').replace(/\/+$/,'');
    if(serverUrls.has(url)) return; // 服务端已有，跳过避免重复
    allSources.push({
      id:'c_'+i, name:s.name, url:s.url,
      enabled: enabledMap.hasOwnProperty('c_'+i)?enabledMap['c_'+i]:true,
      isServer:false, _idx:i
    });
  });

  // 已有采集源卡片
  let existingHtml='';
  if(allSources.length){
    existingHtml=`<div class="src-section-title">已配置采集源（${allSources.length}）</div>`+allSources.map(s=>{
      const isOn=s.enabled;
      const urlEsc=(s.url||'').replace(/'/g,"\\'");
      const nameEsc=(s.name||'').replace(/'/g,"\\'");
      const st=getSourceStatus(s.id);
      const statusHtml=`<span class="source-status ${st}"><span class="dot"></span>${st==='ok'?'正常':st==='fail'?'已失效':'未检测'}</span>`;
      return `<div class="src-card ${isOn?'':'disabled'}">
        <div class="src-card-header">
          <div class="src-card-icon ${isOn?'on':''}">${isOn?'🟢':'🔴'}</div>
          <div class="src-card-info">
            <div class="src-card-name">${s.name||'未命名'}${statusHtml}</div>
            <div class="src-card-url">${s.url||''}</div>
          </div>
        </div>
        <div class="src-card-actions">
          <button class="src-action-btn toggle ${isOn?'on':''}" onclick="toggleSourceLocal('${s.id}',${!isOn})">${isOn?'已启用':'已禁用'}</button>
          <button class="src-action-btn edit" onclick="showEditSourceModal('${s.id}','${nameEsc}','${urlEsc}',${s.isServer})">编辑</button>
          <button class="src-action-btn del" onclick="confirmRemoveSourceLocal('${s.id}','${nameEsc}',${s.isServer})">删除</button>
        </div>
      </div>`;
    }).join('');
  } else {
    existingHtml='<div class="mgmt-empty">暂无采集源，可从下方预设列表添加</div>';
  }

  // 预设采集源模板（过滤掉已添加的）
  const existingUrls=allSources.map(s=>(s.url||'').replace(/\/$/,''));
  const templates=DEFAULT_SOURCE_TEMPLATES.filter(t=>!existingUrls.includes(t.url.replace(/\/$/,'')));
  let templateHtml='';
  if(templates.length){
    templateHtml=`<div class="src-section-title" style="margin-top:8px">预设采集源（点击添加）</div>`+templates.map(t=>{
      return `<div class="src-card src-card-template" onclick="addSourceFromTemplate('${t.name.replace(/'/g,"\\'")}','${t.url.replace(/'/g,"\\'")}')">
        <div class="src-card-header">
          <div class="src-card-icon">➕</div>
          <div class="src-card-info">
            <div class="src-card-name">${t.name}</div>
            <div class="src-card-url">${t.url}</div>
          </div>
        </div>
        <div class="src-card-actions">
          <button class="src-action-btn add-template">一键添加</button>
        </div>
      </div>`;
    }).join('');
  }

  let addAllHtml='';
  if(templates.length>1){
    addAllHtml=`<div style="padding:8px 14px 16px"><button class="src-action-btn add-template" style="width:100%;padding:10px;font-size:14px" onclick="addAllDefaultSources()">一键添加全部预设源</button></div>`;
  }

  c.innerHTML=existingHtml+templateHtml+addAllHtml;
}

function toggleSourceLocal(id,enable){
  let enabledMap=JSON.parse(localStorage.getItem('ys_source_enabled')||'{}');
  enabledMap[id]=enable;
  localStorage.setItem('ys_source_enabled',JSON.stringify(enabledMap));
  showToast(enable?'已启用':'已禁用');
  loadSourcePage();
  syncSourcesToBackend();
}

function addSourceFromTemplate(name,url){
  let customSources=JSON.parse(localStorage.getItem('ys_custom_sources')||'[]');
  if(customSources.some(s=>s.url.replace(/\/$/,'')===url.replace(/\/$/,''))){showToast('该源已存在');return;}
  customSources.push({name,url});
  localStorage.setItem('ys_custom_sources',JSON.stringify(customSources));
  showToast(`已添加「${name}」`);
  loadSourcePage();
  syncSourcesToBackend();
}

function addAllDefaultSources(){
  let customSources=JSON.parse(localStorage.getItem('ys_custom_sources')||'[]');
  let existingUrls=customSources.map(s=>s.url.replace(/\/$/,''));
  // 也排除服务端已有的
  // 简化：直接添加所有预设模板中不在customSources里的
  let toAdd=DEFAULT_SOURCE_TEMPLATES.filter(t=>!existingUrls.includes(t.url.replace(/\/$/,'')));
  if(!toAdd.length){showToast('所有预设源已添加');return;}
  toAdd.forEach(t=>customSources.push({name:t.name,url:t.url}));
  localStorage.setItem('ys_custom_sources',JSON.stringify(customSources));
  showToast(`已添加 ${toAdd.length} 个采集源`);
  loadSourcePage();
  syncSourcesToBackend();
}

function confirmRemoveSourceLocal(id,name,isServer){
  showConfirm(`确定删除采集源「${name}」？`,()=>{
    if(isServer){
      // 服务端源：标记禁用并从展示中移除（加入隐藏列表）
      let hiddenSources=JSON.parse(localStorage.getItem('ys_source_hidden')||'[]');
      hiddenSources.push(id);
      localStorage.setItem('ys_source_hidden',JSON.stringify(hiddenSources));
    } else {
      // 前端自定义源：从localStorage删除
      let customSources=JSON.parse(localStorage.getItem('ys_custom_sources')||'[]');
      customSources=customSources.filter(s=>s.url!==undefined); // keep all, we need index
      // 按id找idx
      let idx=parseInt(id.replace('c_',''));
      if(idx>=0&&idx<customSources.length) customSources.splice(idx,1);
      localStorage.setItem('ys_custom_sources',JSON.stringify(customSources));
    }
    showToast('已删除');
    loadSourcePage();
    syncSourcesToBackend();
  });
}

function showAddSourceModal(){
  editingSourceId=null;
  document.getElementById('srcModalTitle').textContent='添加采集源';
  document.getElementById('srcModalOkBtn').textContent='添加';
  document.getElementById('srcNameInput').value='';
  document.getElementById('srcUrlInput').value='';
  document.getElementById('sourceModal').style.display='';
}

function showEditSourceModal(id,name,url,isServer){
  editingSourceId=id;
  editingSourceIsServer=isServer;
  document.getElementById('srcModalTitle').textContent='编辑采集源';
  document.getElementById('srcModalOkBtn').textContent='保存';
  document.getElementById('srcNameInput').value=name;
  document.getElementById('srcUrlInput').value=url;
  document.getElementById('sourceModal').style.display='';
}

function closeSourceModal(){
  document.getElementById('sourceModal').style.display='none';
}

function submitSource(){
  const n=document.getElementById('srcNameInput').value.trim();
  const u=document.getElementById('srcUrlInput').value.trim();
  if(!n||!u){showToast('请填写完整信息');return;}
  if(editingSourceId){
    // 编辑 - 保存到自定义源或更新名称
    if(!editingSourceIsServer){
      let customSources=JSON.parse(localStorage.getItem('ys_custom_sources')||'[]');
      let idx=parseInt(editingSourceId.replace('c_',''));
      if(idx>=0&&idx<customSources.length){
        customSources[idx].name=n;
        customSources[idx].url=u;
        localStorage.setItem('ys_custom_sources',JSON.stringify(customSources));
      }
    } else {
      // 服务端源编辑：创建一个自定义源替代
      let nameMap=JSON.parse(localStorage.getItem('ys_source_name_override')||'{}');
      nameMap[editingSourceId]=n;
      localStorage.setItem('ys_source_name_override',JSON.stringify(nameMap));
    }
    showToast('已更新');
  } else {
    // 添加到自定义源
    let customSources=JSON.parse(localStorage.getItem('ys_custom_sources')||'[]');
    customSources.push({name:n,url:u});
    localStorage.setItem('ys_custom_sources',JSON.stringify(customSources));
    showToast('已添加');
  }
  closeSourceModal();
  loadSourcePage();
  syncSourcesToBackend();
}

// ==================== 关于页面（页面切换方式） ====================
function showAboutPage(){
  var c=document.getElementById('aboutContent');
  if(c&&!c.innerHTML.trim()){
    fetch('about.html').then(function(r){return r.text();}).then(function(html){
      var doc=new DOMParser().parseFromString(html,'text/html');
      // 只复制 about.html 自己的样式（跳过可能影响主页面的样式）
      var body=doc.querySelector('body');
      if(body){
        var wrap=document.createElement('div');
        wrap.innerHTML=body.innerHTML;
        // 移除返回按钮（已有top-bar）
        var oldBack=wrap.querySelector('.back-btn');
        if(oldBack)oldBack.parentElement.removeChild(oldBack);
        // 保留 bg-decoration（背景装饰）
        var oldH1=wrap.querySelector('.page-title');
        if(oldH1&&oldH1.style.display==='none')oldH1.parentElement.removeChild(oldH1);
        c.appendChild(wrap);
      }
      // 复制样式到 aboutContent 内部（限制作用域）
      var styleWrap=document.createElement('div');
      styleWrap.className='about-styles';
      doc.querySelectorAll('style').forEach(function(s){styleWrap.appendChild(s.cloneNode(true));});
      c.insertBefore(styleWrap,c.firstChild);
      // 主题检测
      doc.querySelectorAll('script').forEach(function(s){
        if(s.textContent.indexOf('ys_theme')>-1){
          try{eval(s.textContent);}catch(e){}
        }
      });
      // 触发特性动画
      setTimeout(function(){
        c.querySelectorAll('.feature-item').forEach(function(item,i){
          setTimeout(function(){item.classList.add('show');},400+i*80);
        });
      },200);
    }).catch(function(){});
  }
  showPage('aboutPage');
}

// ==================== 主题 ====================
function toggleTheme(){
  const d=!document.body.classList.contains('theme-dark');
  // 添加过渡类
  document.documentElement.classList.add('theme-transition');
  document.body.classList.toggle('theme-dark',d);
  document.documentElement.classList.toggle('theme-dark',d);
  localStorage.setItem('ys_theme',d?'dark':'light');
  if(window.YunShaoNative&&typeof YunShaoNative.updateStatusBar==='function')YunShaoNative.updateStatusBar(d);
  // 更新"我的"页面的主题显示
  const mt=document.getElementById('menuTheme');
  if(mt) mt.textContent=d?'深色':'浅色';
  showToast(d?'深色模式':'浅色模式');
  // 移除过渡类
  setTimeout(()=>document.documentElement.classList.remove('theme-transition'),350);
}

// ==================== 布局切换 ====================
function toggleLayout(){
  var current=localStorage.getItem('ys_layout')||'auto';
  var next=current==='auto'?'wide':current==='wide'?'narrow':'auto';
  localStorage.setItem('ys_layout',next);
  applyLayout(next);
  var labels={auto:'自动',wide:'横屏',narrow:'竖屏'};
  var ml=document.getElementById('menuLayout');
  if(ml)ml.textContent=labels[next];
  showToast('布局：'+labels[next]);
}
function applyLayout(mode){
  document.body.classList.remove('layout-auto','layout-wide','layout-narrow');
  if(mode!=='auto'){
    document.body.classList.add('layout-'+mode);
  }
  // 手动布局时，通过JS强制设置viewport，确保CSS媒体查询生效
  updateViewport(mode);
}
// 根据布局模式和物理屏幕尺寸动态设置viewport
function updateViewport(mode){
  // 优先用Java注入的物理像素，否则回退到screen
  var sw = window.__screenW || screen.width * (window.devicePixelRatio||1);
  var sh = window.__screenH || screen.height * (window.devicePixelRatio||1);
  var isWideScreen = Math.max(sw,sh) >= 900; // 物理像素宽边>=900视为平板以上
  var viewport = document.querySelector('meta[name=viewport]');
  if(!viewport){
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }
  if(mode==='wide' && isWideScreen){
    // 横屏模式：强制viewport为屏幕实际宽度（dp），让CSS媒体查询按真实尺寸触发
    var wideDp = Math.max(sw,sh) / (window.devicePixelRatio||1);
    viewport.content = 'width='+Math.round(wideDp)+', initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.body.classList.add('is-widescreen');
  } else if(mode==='narrow'){
    // 竖屏模式：固定窄viewport
    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.body.classList.remove('is-widescreen');
  } else {
    // 自动模式：根据物理尺寸决定
    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    if(isWideScreen){
      document.body.classList.add('is-widescreen');
    } else {
      document.body.classList.remove('is-widescreen');
    }
  }
}
// 初始化布局
(function(){
  var mode=localStorage.getItem('ys_layout')||'auto';
  var labels={auto:'自动',wide:'横屏',narrow:'竖屏'};
  applyLayout(mode);
  var ml=document.getElementById('menuLayout');
  if(ml)ml.textContent=labels[mode];
})();
// 监听屏幕旋转，自动模式时重新应用
window.addEventListener('orientationchange', function(){
  var mode=localStorage.getItem('ys_layout')||'auto';
  if(mode==='auto') applyLayout('auto');
});

// ==================== 事件绑定 ====================
document.getElementById('searchInput')?.addEventListener('click',()=>openSearchPage());
document.getElementById('searchInputFull')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});

// ==================== 问题1修复：推荐页鼠标滚轮滚动兜底 ====================
// 监听main-content的wheel事件，直接代理滚动
document.addEventListener('DOMContentLoaded', () => {
  // 桌面端：给main-content添加wheel事件兜底
  const mainContent = document.getElementById('homeContent');
  if (mainContent) {
    mainContent.addEventListener('wheel', (e) => {
      // 只有在推荐页且当前有滚动内容时才处理
      if (currentPage !== 'homePage' || currentHomeTab !== 'recommend') return;
      // 直接让main-content滚动
      mainContent.scrollTop += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }
});

// 侧滑返回
let sx=0,sy=0,swiping=false;
const MAIN_PAGES=['homePage','catPage','tvPage','profilePage']; // 底部导航主页，侧滑不应返回
document.addEventListener('touchstart',e=>{if(document.fullscreenElement||(typeof isCSSFullscreen!=='undefined'&&isCSSFullscreen))return;if(e.touches[0].clientX<15){sx=e.touches[0].clientX;sy=e.touches[0].clientY;swiping=true;}},{passive:true});
document.addEventListener('touchend',e=>{if(!swiping)return;swiping=false;if(typeof isCSSFullscreen!=='undefined'&&isCSSFullscreen)return;const dx=e.changedTouches[0].clientX-sx,dy=Math.abs(e.changedTouches[0].clientY-sy);if(dx>80&&dy<60&&!MAIN_PAGES.includes(currentPage))goBack();},{passive:true});

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded',()=>{
  // 点击其他区域关闭直播源下拉
  document.addEventListener('click',(e)=>{
    const bar = document.getElementById('tvSourceBar');
    if(bar && !bar.contains(e.target)){
      const dd=document.getElementById('tvSourceDropdown');
      const sel=document.getElementById('tvSourceSelector');
      if(dd)dd.classList.remove('show');
      if(sel)sel.classList.remove('open');
    }
  });
  // 修复WebView初始无法交互：延迟模拟点击激活触摸事件
  setTimeout(function(){
    // 点击页面上方空白安全区域（品牌区），不会触发页面跳转
    var el = document.elementFromPoint(40, 40);
    if(el && el.click) { el.click(); }
  }, 300);
  // 清除启动时防闪烁的inline background
  document.body.style.background='';
  const bootStyle=document.getElementById('boot-style');
  if(bootStyle)bootStyle.remove();
  // 主题持久化：根据localStorage设置主题，默认浅色
  const t=localStorage.getItem('ys_theme');
  if(t==='dark'){
    document.body.classList.add('theme-dark');
    if(window.YunShaoNative)YunShaoNative.updateStatusBar(true);
  } else {
    document.body.classList.remove('theme-dark');
    if(window.YunShaoNative)YunShaoNative.updateStatusBar(false);
  }

  // 首次启动：自动添加蛋播星球采集源（默认禁用，用户自行启用）
  if(!localStorage.getItem('ys_db_sources_inited')) {
    let customSources = JSON.parse(localStorage.getItem('ys_custom_sources') || '[]');
    let enabledMap = JSON.parse(localStorage.getItem('ys_source_enabled') || '{}');
    let existingUrls = customSources.map(s => s.url.replace(/\/$/, ''));
    const dbSources = DEFAULT_SOURCE_TEMPLATES.filter(t => t.disabled);
    for (const t of dbSources) {
      if (!existingUrls.includes(t.url.replace(/\/$/, ''))) {
        const idx = customSources.length;
        customSources.push({name: t.name, url: t.url});
        enabledMap['c_' + idx] = false; // 默认禁用
      }
    }
    localStorage.setItem('ys_custom_sources', JSON.stringify(customSources));
    localStorage.setItem('ys_source_enabled', JSON.stringify(enabledMap));
    localStorage.setItem('ys_db_sources_inited', '1');
  }
  // 并行执行：同步后端采集源 + 加载首页，互不阻塞
  syncSourcesToBackend();
  loadHomeData();
  // 下拉刷新
  initPullRefresh();
  initCatPagePullRefresh();
});

// ==================== 分类页方案四：筛选功能 ====================

// 更新分类页快捷筛选UI
function updateCatQuickFilterUI(){
  document.querySelectorAll('#catQuickFilterScroll .qf-item').forEach(item=>{
    item.classList.toggle('active',item.dataset.filter===categoryState.quickFilter);
  });
}

// 分类页快捷筛选点击 - 从当前Tab的数据中筛选并重新渲染
document.querySelectorAll('#catQuickFilterScroll .qf-item').forEach(item=>{
  item.addEventListener('click',()=>{
    categoryState.quickFilter=item.dataset.filter;
    updateCatQuickFilterUI();
    const tabState = catPageTabStates[currentCatPageTab];
    if(!tabState || !tabState.allData.length) return;
    const allItems = [...tabState.allData];
    const filtered = filterCatData(allItems);
    const listView = document.getElementById('catPageList_'+currentCatPageTab);
    if(!listView) return;
    if(filtered.length===0){
      listView.innerHTML='<div class="cat-empty"><div class="cat-empty-icon">🔍</div><div class="cat-empty-text">没有符合筛选条件的内容</div></div>';
    } else {
      listView.innerHTML = filtered.map((v,i)=>{
        const rank=i+1;
        const tags=(v.vod_class||v.type_name||'').split(',').filter(Boolean).slice(0,3);
        const metaItems=[v.vod_score?`<span class="cat-list-meta-item rating">⭐ ${v.vod_score}</span>`:'',v.vod_year?`<span class="cat-list-meta-item">${v.vod_year}</span>`:'',v.vod_area?`<span class="cat-list-meta-item">${v.vod_area}</span>`:''].filter(Boolean);
        const idx = '_w'+Math.random().toString(36).slice(2,8);
        window._vodData[idx] = v;
        return `<div class="cat-list-item" data-vid="${idx}">`+
          `<div class="cat-list-cover"><img src="${v.vod_pic||''}" alt="" loading="lazy" onerror="this.src='${noImg}'"><span class="cat-list-rank ${rank<=3?'top':''}">${rank}</span></div>`+
          `<div class="cat-list-info"><div class="cat-list-title">${v.vod_name||''}</div><div class="cat-list-meta">${metaItems.join('')}</div>`+
          (tags.length?`<div class="cat-list-tags">${tags.map(t=>`<span class="cat-list-tag-item">${t}</span>`).join('')}</div>`:'')+
          `</div></div>`;
      }).join('');
      listView.querySelectorAll('.cat-list-item').forEach(el=>{el.onclick=()=>{try{const v=window._vodData[el.dataset.vid];if(v)showDetail(v);}catch(e){}};});
    }
  });
});

// 分类页大类Tab切换
document.querySelectorAll('#catTypeTabs .ctt-item').forEach(tab=>{
  tab.addEventListener('click',()=>{
    const typeId=parseInt(tab.dataset.type);
    document.querySelectorAll('#catTypeTabs .ctt-item').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    updateCatQuickFilterUI();
    switchCatPageTab(typeId);
  });
});

// 分类页高级筛选弹窗
const catFilterModal=document.getElementById('catFilterModal');
const catFilterOverlay=document.getElementById('catFilterOverlay');

function openCatFilterModal(){
  catFilterModal.classList.add('active');
  catFilterOverlay.style.display='';
  setTimeout(()=>catFilterOverlay.classList.add('active'),10);
  document.body.style.overflow='hidden';
  syncCatFilterToModal();
}

function closeCatFilterModal(){
  catFilterModal.classList.remove('active');
  catFilterOverlay.classList.remove('active');
  setTimeout(()=>{catFilterOverlay.style.display='none';},300);
  document.body.style.overflow='';
}

function syncCatFilterToModal(){
  const {area,year,sort}=categoryState.filter;
  document.querySelectorAll('#catFilterAreaOptions .filter-opt').forEach(o=>o.classList.toggle('active',o.dataset.area===area));
  document.querySelectorAll('#catFilterYearOptions .filter-opt').forEach(o=>o.classList.toggle('active',o.dataset.year===year));
  document.querySelectorAll('#catFilterSortOptions .filter-opt').forEach(o=>o.classList.toggle('active',o.dataset.sort===sort));
}

document.getElementById('catFilterBtn')?.addEventListener('click',openCatFilterModal);
document.getElementById('catFilterCloseBtn')?.addEventListener('click',closeCatFilterModal);
catFilterOverlay?.addEventListener('click',closeCatFilterModal);

// 分类页筛选选项点击
document.querySelectorAll('#catFilterAreaOptions .filter-opt').forEach(opt=>{
  opt.addEventListener('click',()=>{
    document.querySelectorAll('#catFilterAreaOptions .filter-opt').forEach(o=>o.classList.remove('active'));
    opt.classList.add('active');
    categoryState.filter.area=opt.dataset.area;
  });
});
document.querySelectorAll('#catFilterYearOptions .filter-opt').forEach(opt=>{
  opt.addEventListener('click',()=>{
    document.querySelectorAll('#catFilterYearOptions .filter-opt').forEach(o=>o.classList.remove('active'));
    opt.classList.add('active');
    categoryState.filter.year=opt.dataset.year;
  });
});
document.querySelectorAll('#catFilterSortOptions .filter-opt').forEach(opt=>{
  opt.addEventListener('click',()=>{
    document.querySelectorAll('#catFilterSortOptions .filter-opt').forEach(o=>o.classList.remove('active'));
    opt.classList.add('active');
    categoryState.filter.sort=opt.dataset.sort;
  });
});

// 分类页重置筛选
document.getElementById('catFilterResetBtn')?.addEventListener('click',()=>{
  categoryState.filter={area:'all',year:'all',sort:'hot'};
  categoryState.quickFilter='all';
  updateCatQuickFilterUI();
  syncCatFilterToModal();
  showToast('已重置筛选条件');
});

// 分类页应用筛选
document.getElementById('catFilterApplyBtn')?.addEventListener('click',()=>{
  closeCatFilterModal();
  categoryState.quickFilter='all';
  updateCatQuickFilterUI();
  // 使用当前Tab的数据重新渲染
  const state = catPageTabStates[currentCatPageTab];
  const listView = document.getElementById('catPageList_'+currentCatPageTab);
  if(state && listView){
    const sorted = sortCatData([...state.allData]);
    renderCatList(sorted, listView);
  }
  showToast('筛选已应用');
});

// 分类页滚动加载：监听每个Tab面板的滚动
Object.values(catPagePanelMap).forEach(id=>{
  const panel = document.getElementById(id);
  if(!panel) return;
  panel.addEventListener('scroll',function(){
    const typeId = Object.keys(catPagePanelMap).find(k=>catPagePanelMap[k]===id);
    if(!typeId) return;
    const state = catPageTabStates[typeId];
    if(this.scrollTop+this.clientHeight>=this.scrollHeight-400){
      if(state.hasMore&&!state.loading) loadMoreCatPageTab(parseInt(typeId));
    }
  });
});

// ==================== 下拉刷新 ====================
function initPullRefresh(){
  // 首页每个Tab面板各自下拉刷新
  const allPanels = [{id:'homeTab_recommend',tab:'recommend'},...Object.entries(tabPanelMap).map(([tab,id])=>({id,tab}))];
  allPanels.forEach(({id,tab})=>{
    const panel = document.getElementById(id);
    if(!panel) return;
    let startY=0, pulling=false;
    const indicator=document.createElement('div');
    indicator.id='pullIndicator_'+tab;
    indicator.style.cssText='text-align:center;padding:12px;font-size:13px;color:var(--text-secondary);display:none;transition:opacity 0.2s';
    indicator.textContent='↓ 下拉刷新';
    panel.insertBefore(indicator,panel.firstChild);

    panel.addEventListener('touchstart',e=>{
      if(panel.scrollTop<=0){startY=e.touches[0].clientY;pulling=true;}
    },{passive:true});

    panel.addEventListener('touchmove',e=>{
      if(!pulling) return;
      const dy=e.touches[0].clientY-startY;
      if(dy>100&&panel.scrollTop<=0){indicator.style.display='block';indicator.textContent='↑ 释放刷新';}
      else if(dy>60&&panel.scrollTop<=0){indicator.style.display='block';indicator.textContent='↓ 下拉刷新';}
      else{indicator.style.display='none';}
    },{passive:true});

    panel.addEventListener('touchend',()=>{
      if(indicator.style.display==='block'&&indicator.textContent.includes('释放')){
        indicator.textContent='刷新中...';
        doHomeTabRefresh(tab,panel,indicator);
      } else {indicator.style.display='none';}
      pulling=false;
    });
  });
}

async function doHomeTabRefresh(tabName,panel,indicator){
  if(tabName==='recommend'){
    homeDataCache=null;
    await loadHomeData();
    Object.keys(catTabStates).forEach(k=>{
      catTabStates[k]={page:1,loading:false,hasMore:true,loaded:false};
      const grid=document.getElementById('catGrid_'+k);
      if(grid) grid.innerHTML='';
    });
  } else {
    const typeId=tabTypeMap[tabName];
    catTabStates[typeId]={page:1,loading:false,hasMore:true,loaded:false};
    const grid=document.getElementById('catGrid_'+typeId);
    if(grid) grid.innerHTML='';
    await loadHomeCatData(typeId, true);
  }
  // 刷新后滚动归0
  panel.scrollTop=0;
  if(indicator){indicator.textContent='✓ 已刷新';setTimeout(()=>{indicator.style.display='none';},800);}
  showToast('已刷新');
}

// ==================== 分类页下拉刷新 ====================
function initCatPagePullRefresh(){
  Object.keys(catPagePanelMap).forEach(typeId=>{
    const panel = document.getElementById(catPagePanelMap[typeId]);
    if(!panel) return;
    let startY=0, pulling=false;
    const indicator=document.createElement('div');
    indicator.className='cat-pull-indicator';
    indicator.style.cssText='text-align:center;padding:12px;font-size:13px;color:var(--text-secondary);display:none;transition:opacity 0.2s';
    indicator.textContent='↓ 下拉刷新';
    panel.insertBefore(indicator,panel.firstChild);

    panel.addEventListener('touchstart',e=>{
      if(panel.scrollTop<=0){startY=e.touches[0].clientY;pulling=true;}
    },{passive:true});

    panel.addEventListener('touchmove',e=>{
      if(!pulling) return;
      const dy=e.touches[0].clientY-startY;
      if(dy>100&&panel.scrollTop<=0){indicator.style.display='block';indicator.textContent='↑ 释放刷新';}
      else if(dy>60&&panel.scrollTop<=0){indicator.style.display='block';indicator.textContent='↓ 下拉刷新';}
      else{indicator.style.display='none';}
    },{passive:true});

    panel.addEventListener('touchend',()=>{
      if(indicator.style.display==='block'&&indicator.textContent.includes('释放')){
        indicator.textContent='刷新中...';
        doCatPageRefresh(parseInt(typeId),indicator);
      } else {indicator.style.display='none';}
      pulling=false;
    });
  });
}

async function doCatPageRefresh(typeId,indicator){
  catPageTabStates[typeId]={page:1,loading:false,hasMore:true,loaded:false,allData:[]};
  const grid=document.getElementById('catPageList_'+typeId);
  if(grid) grid.innerHTML='';
  const panel=document.getElementById(catPagePanelMap[typeId]);
  await loadCatPageTabData(typeId);
  // 刷新后滚动归0
  if(panel) panel.scrollTop=0;
  if(indicator){indicator.textContent='✓ 已刷新';setTimeout(()=>{indicator.style.display='none';},800);}
  showToast('已刷新');
}
// ==================== 直播源管理 ====================
const LIVE_SOURCES_KEY = 'ys_live_sources';
function getLiveSources() { try { return JSON.parse(localStorage.getItem(LIVE_SOURCES_KEY) || '[]'); } catch { return []; } }
function saveLiveSources(s) { localStorage.setItem(LIVE_SOURCES_KEY, JSON.stringify(s)); }

function getActiveLiveSourceIdx() {
  const sources = getLiveSources();
  const idx = sources.findIndex(s => s.enabled);
  return idx >= 0 ? idx : -1;
}

function setActiveLiveSource(idx) {
  let sources = getLiveSources();
  sources.forEach((s, i) => { s.enabled = (i === idx); });
  saveLiveSources(sources);
  loadLiveSourcePage();
}

function loadLiveSourcePage() {
  showPage('liveSourcePage');
  const c = document.getElementById('liveSourceContent');
  const sources = getLiveSources();
  
  let html = '';
  if (sources.length) {
    html = '<div class="src-section-title">已配置直播源（' + sources.length + '）</div>' + sources.map((s, i) => {
      const typeLabel = s.type === 'tvbox' ? 'TVBox' : s.type === 'txt' ? '频道列表' : s.type === 'm3u' ? 'M3U' : '自动';
      const isActive = !!s.enabled;
      const toggleLabel = isActive ? '启用中' : '启用';
      const toggleClass = isActive ? 'src-action-btn active-live' : 'src-action-btn enable-live';
      return '<div class="src-card' + (isActive ? ' src-card-active' : '') + '"><div class="src-card-header"><div class="src-card-icon ' + (isActive ? 'on' : 'off') + '">' + (isActive ? '🟢' : '⚪') + '</div><div class="src-card-info"><div class="src-card-name">' + (s.name || '未命名') + '</div><div class="src-card-url">' + (s.url || '') + '</div></div></div><div class="src-card-actions"><span style="font-size:11px;color:var(--text-tertiary);margin-right:auto;padding-left:4px">' + typeLabel + '</span><button class="' + toggleClass + '" onclick="setActiveLiveSource(' + i + ')">' + toggleLabel + '</button><button class="src-action-btn edit" onclick="showEditLiveSourceModal(' + i + ')">编辑</button><button class="src-action-btn del" onclick="confirmRemoveLiveSource(' + i + ')">删除</button></div></div>';
    }).join('');
  } else {
    html = '<div class="mgmt-empty">暂无直播源，可从下方预设列表添加</div>';
  }
  
  const presetLiveSources = [
    { name: 'DailyIPTV验证源', url: 'https://raw.githubusercontent.com/mymsnn/DailyIPTV/main/outputs/full_validated.m3u', type: 'm3u' }
  ];
  const existingUrls = sources.map(s => (s.url || '').replace(/\/$/, ''));
  const presets = presetLiveSources.filter(p => !existingUrls.includes(p.url.replace(/\/$/, '')));
  if (presets.length) {
    html += '<div class="src-section-title" style="margin-top:16px">预设直播源（点击添加）</div>' + presets.map(p => {
      return '<div class="src-card src-card-template" onclick="addPresetLiveSource(\'' + p.name.replace(/'/g, "\\'") + '\',\'' + p.url.replace(/'/g, "\\'") + '\',\'' + p.type + '\')"><div class="src-card-header"><div class="src-card-icon">➕</div><div class="src-card-info"><div class="src-card-name">' + p.name + '</div><div class="src-card-url">' + p.url + '</div></div></div><div class="src-card-actions"><button class="src-action-btn add-template">一键添加</button></div></div>';
    }).join('');
  }
  
  c.innerHTML = html;
}

function addPresetLiveSource(name, url, type) {
  let sources = getLiveSources();
  if (sources.some(s => s.url.replace(/\/$/, '') === url.replace(/\/$/, ''))) { showToast('该源已存在'); return; }
  const isFirst = sources.length === 0;
  sources.push({ name, url, type: type || 'auto', enabled: isFirst });
  saveLiveSources(sources);
  showToast('已添加「' + name + '」');
  loadLiveSourcePage();
}

function showAddLiveSourceModal() {
  document.getElementById('liveSrcNameInput').value = '';
  document.getElementById('liveSrcUrlInput').value = '';
  document.getElementById('liveSrcTypeInput').value = 'auto';
  document.getElementById('liveSrcModalTitle').textContent = '添加直播源';
  document.getElementById('liveSourceModal').style.display = '';
  delete document.getElementById('liveSourceModal').dataset.editIdx;
}

function showEditLiveSourceModal(idx) {
  const sources = getLiveSources();
  const s = sources[idx];
  if (!s) return;
  document.getElementById('liveSrcNameInput').value = s.name || '';
  document.getElementById('liveSrcUrlInput').value = s.url || '';
  document.getElementById('liveSrcTypeInput').value = s.type || 'auto';
  document.getElementById('liveSrcModalTitle').textContent = '编辑直播源';
  document.getElementById('liveSourceModal').style.display = '';
  document.getElementById('liveSourceModal').dataset.editIdx = idx;
}

function closeLiveSourceModal() {
  document.getElementById('liveSourceModal').style.display = 'none';
  delete document.getElementById('liveSourceModal').dataset.editIdx;
}

function submitLiveSource() {
  const name = document.getElementById('liveSrcNameInput').value.trim();
  const url = document.getElementById('liveSrcUrlInput').value.trim();
  const type = document.getElementById('liveSrcTypeInput').value;
  if (!name || !url) { showToast('请填写完整信息'); return; }
  
  const modal = document.getElementById('liveSourceModal');
  const editIdx = modal.dataset.editIdx;
  let sources = getLiveSources();
  
  if (editIdx !== undefined) {
    const oldEnabled = sources[parseInt(editIdx)].enabled;
    sources[parseInt(editIdx)] = { name, url, type, enabled: !!oldEnabled };
    showToast('已更新');
  } else {
    if (sources.some(s => s.url.replace(/\/$/, '') === url.replace(/\/$/, ''))) { showToast('该源已存在'); return; }
    const isFirst = sources.length === 0;
    sources.push({ name, url, type, enabled: isFirst });
    showToast('已添加');
  }
  
  saveLiveSources(sources);
  closeLiveSourceModal();
  loadLiveSourcePage();
}

function confirmRemoveLiveSource(idx) {
  const sources = getLiveSources();
  const name = sources[idx]?.name || '该源';
  showConfirm('确定删除直播源「' + name + '」？', () => {
    let sources = getLiveSources();
    sources.splice(idx, 1);
    saveLiveSources(sources);
    showToast('已删除');
    loadLiveSourcePage();
  });
}

// ==================== 电视直播页面 ====================
let currentLiveSource = null;
let currentLiveGroups = [];
let currentLiveGroupIdx = 0;
let currentLiveChannel = null;
let tvHls = null;

function initTvPage() {
  const sources = getLiveSources();
  if (sources.length > 0) {
    // 优先加载enabled的源，否则fallback到第一个
    const activeIdx = sources.findIndex(s => s.enabled);
    const idx = activeIdx >= 0 ? activeIdx : 0;
    // 首次使用自动启用第一个
    if (activeIdx < 0) {
      sources[0].enabled = true;
      saveLiveSources(sources);
    }
    loadLiveSource(idx);
  } else {
    renderTvEmpty();
  }
}

function renderTvEmpty() {
  const grid = document.getElementById('tvChannelGrid');
  if (grid) grid.innerHTML = '<div class="tv-empty"><div class="tv-empty-icon">📺</div><div class="tv-empty-text">暂无直播源</div><div class="tv-empty-hint">请先在"我的→直播源管理"中添加直播源</div><button class="tv-empty-btn" onclick="switchTab(\'profilePage\')">前往添加</button></div>';
  const tabs = document.getElementById('tvGroupScroll');
  if (tabs) tabs.innerHTML = '';
  // tvNowPlaying 已移除，不再操作
}

function updateTvSourceSelect(activeIdx) {
  const bar = document.getElementById('tvSourceBar');
  const current = document.getElementById('tvSourceCurrent');
  const dropdown = document.getElementById('tvSourceDropdown');
  if (!bar) return;
  const sources = getLiveSources();
  if (sources.length <= 1) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  const active = sources[activeIdx];
  if (current && active) current.textContent = active.name || '未命名';
  if (dropdown) {
    dropdown.innerHTML = sources.map((s, i) =>
      '<div class="tv-source-option' + (i === activeIdx ? ' active' : '') + '" onclick="selectTvSource(' + i + ')">' +
      '<span>' + (s.name || '未命名') + '</span>' +
      (i === activeIdx ? '<span class="tv-source-check">✓</span>' : '') +
      '</div>'
    ).join('');
  }
}

function toggleTvSourceDropdown() {
  const selector = document.getElementById('tvSourceSelector');
  const dropdown = document.getElementById('tvSourceDropdown');
  if (!selector || !dropdown) return;
  const isOpen = dropdown.classList.contains('show');
  if (isOpen) {
    dropdown.classList.remove('show');
    selector.classList.remove('open');
  } else {
    dropdown.classList.add('show');
    selector.classList.add('open');
  }
}

function selectTvSource(idx) {
  // 关闭下拉
  const dropdown = document.getElementById('tvSourceDropdown');
  const selector = document.getElementById('tvSourceSelector');
  if (dropdown) dropdown.classList.remove('show');
  if (selector) selector.classList.remove('open');
  // 切换源
  setActiveLiveSourceSilent(idx);
  loadLiveSource(idx);
}

function onTvSourceChange(val) {
  const idx = parseInt(val);
  if (isNaN(idx)) return;
  setActiveLiveSourceSilent(idx);
  loadLiveSource(idx);
}

function setActiveLiveSourceSilent(idx) {
  let sources = getLiveSources();
  sources.forEach((s, i) => { s.enabled = (i === idx); });
  saveLiveSources(sources);
}

async function loadLiveSource(idx) {
  const sources = getLiveSources();
  if (idx < 0 || idx >= sources.length) { renderTvEmpty(); return; }
  const source = sources[idx];
  currentLiveSource = source;
  localStorage.setItem('ys_last_live_source', String(idx));
  
  const grid = document.getElementById('tvChannelGrid');
  if (grid) grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary)">加载中...</div>';
  
  try {
    // 走本地后端代理获取直播源，避免CORS
    const resp = await fetch(`${API}/api/live/fetch?url=${encodeURIComponent(source.url)}`);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch(e) {}
    
    // 如果返回的是HTML页面（如agit.ai的反爬重定向），提示用户
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      showToast('该源地址无法访问（被重定向），请更换源地址');
      renderTvEmpty();
      return;
    }
    
    if (data && data.lives) {
      await parseTVBoxLive(data);
    } else if (data && (data.sites || data.urls)) {
      // 有sites但没lives，说明是VOD采集源不是直播源
      showToast('该源是影视采集源，不包含直播频道，请添加直播源');
      renderTvEmpty();
      return;
    } else if (text.includes('#EXTM3U') || text.includes('#EXTINF')) {
      currentLiveGroups = parseM3U(text);
    } else if (text.includes('#genre#') || text.includes(',')) {
      currentLiveGroups = parseChannelText(text);
    } else {
      showToast('无法识别的直播源格式');
      renderTvEmpty();
      return;
    }
    
    if (!currentLiveGroups.length) {
      showToast('未找到频道数据');
      renderTvEmpty();
      return;
    }
    updateTvSourceSelect(idx);
    renderTvChannels();
  } catch(e) {
    console.error('Load live source error:', e);
    renderTvEmpty();
    showToast('加载直播源失败');
  }
}

async function parseTVBoxLive(data) {
  let liveEntries = [];
  if (data.urls && Array.isArray(data.urls)) {
    for (const sub of data.urls) {
      try {
        const resp = await fetch(`${API}/api/live/fetch?url=${encodeURIComponent(sub.url)}`);
        const subText = await resp.text();
        // 子URL可能直接是频道列表而非JSON
        if (subText.includes('#EXTM3U') || subText.includes('#EXTINF')) {
          currentLiveGroups = parseM3U(subText);
          if (currentLiveGroups.length > 0) return;
          continue;
        }
        if (subText.includes('#genre#') || (subText.includes(',') && !subText.trim().startsWith('{'))) {
          currentLiveGroups = parseChannelText(subText);
          if (currentLiveGroups.length > 0) return;
          continue;
        }
        let subData;
        try { subData = JSON.parse(subText); } catch(e) {}
        if (subData && subData.lives) liveEntries = liveEntries.concat(subData.lives);
      } catch(e) {}
    }
  }
  if (data.lives) liveEntries = liveEntries.concat(data.lives);
  if (!liveEntries.length) { showToast('未找到直播频道(lives为空)'); return; }
  
  for (const live of liveEntries) {
    if (!live.url) continue;
    try {
      const resp = await fetch(`${API}/api/live/fetch?url=${encodeURIComponent(live.url)}`);
      const text = await resp.text();
      if (text.includes('#EXTM3U') || text.includes('#EXTINF')) {
        currentLiveGroups = parseM3U(text);
      } else {
        currentLiveGroups = parseChannelText(text);
      }
      if (currentLiveGroups.length > 0) return;
    } catch(e) {}
  }
}

function parseChannelText(text) {
  const groups = [];
  let currentGroup = { name: '默认', channels: [] };
  const seen = new Set(); // 去重：组名+频道名
  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.includes('#genre#')) {
      if (currentGroup.channels.length > 0) groups.push(currentGroup);
      const groupName = line.split(',')[0].trim();
      currentGroup = { name: groupName, channels: [] };
    } else if (line.includes(',')) {
      const idx = line.indexOf(',');
      const name = line.substring(0, idx).trim();
      const url = line.substring(idx + 1).trim();
      if (name && url) {
        const key = currentGroup.name + '_' + name;
        if (!seen.has(key)) { seen.add(key); currentGroup.channels.push({ name, url }); }
      }
    }
  }
  if (currentGroup.channels.length > 0) groups.push(currentGroup);
  return groups;
}

function parseM3U(text) {
  const groups = {};
  const groupOrder = [];
  const seen = {}; // 每组内频道名去重
  let currentInfo = {};
  // 先把可能被换行分割的EXTINF行合并（如果某行不是#开头也不是URL，拼到上一行）
  const rawLines = text.split('\n');
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    if (!t) continue;
    // 如果上一行是#EXTINF开头但没逗号（没闭合），当前行拼上去
    if (lines.length > 0 && lines[lines.length-1].startsWith('#EXTINF') && !lines[lines.length-1].includes(',')) {
      lines[lines.length-1] += ' ' + t;
    } else {
      lines.push(t);
    }
  }
  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const nameMatch = line.match(/,(.+)$/);
      let name = nameMatch ? nameMatch[1].trim() : '';
      // 清理频道名：去掉可能残留的属性标签和引号包裹
      name = name.replace(/\s+tvg-\w+\s*=\s*"[^"]*"/gi, '').replace(/\s+group-title\s*=\s*"[^"]*"/gi, '').trim();
      // 如果还有引号包裹（如 "河北卫视" 或 tvg-id="河北卫视"残留），提取最后一段纯文字
      name = name.replace(/^tvg-\w+\s*=\s*"?/i, '').replace(/"$/, '').replace(/.*?,\s*/, '').trim();
      // 最终兜底：去掉所有引号
      name = name.replace(/"/g, '').trim();
      currentInfo = { group: groupMatch ? groupMatch[1] : '默认', name };
    } else if (!line.startsWith('#') && currentInfo.name) {
      const group = currentInfo.group;
      if (!groups[group]) { groups[group] = []; groupOrder.push(group); seen[group] = new Set(); }
      if (!seen[group].has(currentInfo.name)) {
        seen[group].add(currentInfo.name);
        groups[group].push({ name: currentInfo.name, url: line });
      }
      currentInfo = {};
    }
  }
  return groupOrder.map(name => ({ name, channels: groups[name] }));
}

function renderTvChannels() {
  const tabsEl = document.getElementById('tvGroupScroll');
  if (tabsEl) {
    tabsEl.innerHTML = currentLiveGroups.map((g, i) =>
      '<span class="tv-group-tab ' + (i === currentLiveGroupIdx ? 'active' : '') + '" onclick="switchLiveGroup(' + i + ')">' + g.name + '</span>'
    ).join('');
  }
  renderLiveChannelList(currentLiveGroups[currentLiveGroupIdx]?.channels || []);

  // 检查并恢复上次播放的频道
  const lastChannelStr = localStorage.getItem('ys_last_live_channel');
  if (lastChannelStr) {
    try {
      const lastChannel = JSON.parse(lastChannelStr);
      // 如果上次频道在当前列表中，自动播放
      if (lastChannel && lastChannel.name && lastChannel.url) {
        // 先尝试在上次所在的组查找
        const lastGroup = currentLiveGroups[lastChannel.groupIdx];
        if (lastGroup) {
          const ch = lastGroup.channels.find(c => c.name === lastChannel.name && c.url === lastChannel.url);
          if (ch) {
            currentLiveGroupIdx = lastChannel.groupIdx;
            // 更新tab高亮
            document.querySelectorAll('.tv-group-tab').forEach((t, i) => t.classList.toggle('active', i === lastChannel.groupIdx));
            renderLiveChannelList(lastGroup.channels);
            playLiveChannel(ch.name, ch.url);
            return;
          }
        }
        // 如果不在上次的组，在所有组中搜索
        for (let i = 0; i < currentLiveGroups.length; i++) {
          if (i === lastChannel.groupIdx) continue;
          const ch = currentLiveGroups[i].channels.find(c => c.name === lastChannel.name && c.url === lastChannel.url);
          if (ch) {
            currentLiveGroupIdx = i;
            document.querySelectorAll('.tv-group-tab').forEach((t, j) => t.classList.toggle('active', j === i));
            renderLiveChannelList(currentLiveGroups[i].channels);
            playLiveChannel(ch.name, ch.url);
            return;
          }
        }
      }
    } catch(e) {}
  }
}

function switchLiveGroup(idx) {
  currentLiveGroupIdx = idx;
  document.querySelectorAll('.tv-group-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  renderLiveChannelList(currentLiveGroups[idx]?.channels || []);
}

function renderLiveChannelList(channels) {
  const grid = document.getElementById('tvChannelGrid');
  if (!grid) return;
  grid.innerHTML = channels.map((ch, idx) => {
    const isPlaying = currentLiveChannel && currentLiveChannel.name === ch.name;
    // 安全处理：频道名去掉可能残留的URL/属性，HTML转义
    const safeName = ch.name.replace(/https?:\/\/\S+/gi, '').replace(/tvg-\w+\s*=/gi, '').replace(/[<>"&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;','&':'&amp;'}[c]||c)).trim();
    return '<div class="tv-channel-item ' + (isPlaying ? 'playing' : '') + '" data-idx="' + idx + '"><span class="tv-ch-name">' + safeName + '</span>' + (isPlaying ? '<span class="tv-live-badge">● LIVE</span>' : '') + '</div>';
  }).join('');
  // 用事件委托替代onclick内联，避免引号转义问题
  grid.querySelectorAll('.tv-channel-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      const ch = channels[idx];
      if (ch) playLiveChannel(ch.name, ch.url);
    });
  });
}

function playLiveChannel(name, url) {
  currentLiveChannel = { name, url };

  // 保存上次播放的频道
  localStorage.setItem('ys_last_live_channel', JSON.stringify({ name, url, groupIdx: currentLiveGroupIdx, channelIdx: -1 }));

  const pa = document.getElementById('tvPlayerArea');
  // 清理之前的HLS和定时器
  if (tvHls) { tvHls.destroy(); tvHls = null; }
  if (pa._progressTimer) clearInterval(pa._progressTimer);
  if (pa._hls) { pa._hls.destroy(); pa._hls = null; }
  
  // 隐藏placeholder
  const placeholder = document.getElementById('tvPlayerPlaceholder');
  if (placeholder) placeholder.style.display = 'none';
  
  // 创建video元素（和playCurrent一样的配置）
  const video = document.createElement('video');
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  video.style.cssText = 'width:100%;height:100%;background:#000;object-fit:contain;position:relative;z-index:1';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('x5-playsinline', '');
  video.setAttribute('x5-video-player-type', 'h5');
  video.setAttribute('x5-video-player-fullscreen', 'true');
  pa.innerHTML = '';
  pa.appendChild(video);
  
  // 播放信息overlay（LIVE标记+频道名，和详情页player-info-overlay一样）
  const safeName = name.replace(/"/g, '').replace(/tvg-\w+\s*=\s*/gi, '').replace(/https?:\/\/\S+/gi, '').trim();
  const infoOverlay = document.createElement('div');
  infoOverlay.className = 'player-info-overlay';
  infoOverlay.innerHTML = '<div class="pio-title"><span style="display:inline-block;width:8px;height:8px;background:#EF4444;border-radius:50%;margin-right:6px;animation:pulse 1.5s infinite;vertical-align:middle"></span>' + safeName + '</div><div class="pio-ep">LIVE</div>';
  pa.appendChild(infoOverlay);
  
  // 全屏按钮（和详情页一样）
  const fsBtn = document.createElement('button');
  fsBtn.className = 'video-fs-btn';
  fsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
  fsBtn.onclick = (e) => { e.stopPropagation(); enterFullscreenMode(); };
  pa.appendChild(fsBtn);
  
  // 点击视频区域切换overlay显示/隐藏 + 双击全屏
  let overlayVisible = true, overlayTimer = null;
  function showOv() { overlayVisible = true; infoOverlay.classList.add('visible'); clearTimeout(overlayTimer); overlayTimer = setTimeout(() => { overlayVisible = false; infoOverlay.classList.remove('visible'); }, 3000); }
  function hideOv() { overlayVisible = false; infoOverlay.classList.remove('visible'); clearTimeout(overlayTimer); }
  showOv();
  let lastTap = 0;
  video.addEventListener('click', e => { const now = Date.now(); if (now - lastTap < 300) { enterFullscreenMode(); e.preventDefault(); } else { if (overlayVisible) hideOv(); else showOv(); } lastTap = now; });
  
  // HLS播放
  if ((url.includes('.m3u8') || url.includes('m3u8')) && typeof Hls !== 'undefined' && Hls.isSupported()) {
    tvHls = new Hls({ lowLatencyMode: true });
    tvHls.loadSource(url);
    tvHls.attachMedia(video);
    tvHls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
    tvHls.on(Hls.Events.ERROR, (event, data) => { if (data.fatal) showToast('直播源加载失败'); });
    pa._hls = tvHls;
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
  
  video.onerror = () => showToast('播放失败');
  
  // 更新频道列表高亮
  const currentChannels = currentLiveGroups[currentLiveGroupIdx]?.channels || [];
  renderLiveChannelList(currentChannels);
}

// ==================== 页面切换时初始化电视页面 ====================
const originalShowPage = showPage;
showPage = function(pid) {
  // 离开tvPage时暂停直播视频
  if (currentPage === 'tvPage' && pid !== 'tvPage') {
    const v = document.querySelector('#tvPlayerArea video');
    if (v) v.pause();
  }
  originalShowPage(pid);
  if (pid === 'tvPage') {
    setTimeout(initTvPage, 100);
  }
};

// ==================== 桌面端鼠标滚轮强制修复 ====================
(function() {
  function fixScroll() {
    var homeMain = document.querySelector('#homePage .main-content');
    if (homeMain) {
      var parent = homeMain.parentElement;
      if (parent) {
        var topBarH = (document.querySelector('#homePage .top-bar') || {}).offsetHeight || 0;
        var tabNavH = (document.querySelector('#homePage .tab-nav') || {}).offsetHeight || 0;
        homeMain.style.height = (window.innerHeight - topBarH - tabNavH) + 'px';
        homeMain.style.overflowY = 'auto';
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(fixScroll, 1000); });
  } else {
    setTimeout(fixScroll, 1000);
  }
  window.addEventListener('resize', fixScroll);
  // 横竖屏切换时强制重绘
  window.addEventListener('resize', function() {
    document.body.style.display = 'none';
    document.body.offsetHeight;
    document.body.style.display = '';
  });
  // 数据加载后也修复
  var origLoad = window.loadHomeData;
  if (origLoad) {
    window.loadHomeData = function() {
      origLoad.apply(this, arguments);
      setTimeout(fixScroll, 500);
    };
  }
})();

// === 详情页/播放页功能 ===
async function showDoubanDetail(id, title) {
  if(!id) return;
  showPage('detailPage');
  cleanupPlayer();
  currentSourceIndex = 0;
  currentEpisodeIndex = -1;
  isPlaying = false;
  playSources = [];
  currentVideo = { vod_name: title, douban_id: id };
  
  document.getElementById('detailTitle').textContent=title;
  document.getElementById('infoTitle').textContent=title;
  document.getElementById('miniPlayerBar').style.display = 'none';
  
  // 显示加载中的简介
  document.getElementById('infoDesc').textContent='正在加载详情...';
  document.getElementById('infoMeta').innerHTML='';
  document.getElementById('episodesCard').style.display='none';
  document.getElementById('sourceCard').style.display='none';
  
  // 异步获取豆瓣详情
  try {
    const detail = await apiFetch(`${API}/api/douban/detail?id=${id}`, 15000);
    if(detail && detail.code === 200){
      doubanDetailCache[id] = detail;
      renderDoubanDetail(detail, title);
    } else {
      document.getElementById('infoDesc').textContent='暂无简介';
    }
  } catch(e) {
    document.getElementById('infoDesc').textContent='暂无简介';
  }
  
  // 后台异步搜索播放资源
  searchPlaySource(title);
  
  // 设置海报背景
  const poster=document.getElementById('detailPoster');
  if(poster) poster.style.display='none';
  
  document.getElementById('playerArea').innerHTML=`<div class="player-start-overlay" id="playerStartOverlay">
    <div class="ps-bg" id="psBg"></div>
    <div class="ps-content">
      <div class="ps-play-btn" onclick="startPlayFirst()">
        <svg viewBox="0 0 24 24" width="36" height="36"><polygon points="6,3 20,12 6,21" fill="#fff"/></svg>
      </div>
      <span class="ps-hint">立即播放</span>
    </div>
  </div>`;
  
  updateFavBtn();
}

function renderDoubanDetail(detail, title) {
  document.getElementById('detailTitle').textContent=detail.title||title;
  document.getElementById('infoTitle').textContent=detail.title||title;
  
  // 元信息
  const genres = (detail.genres||[]).join(' / ');
  const meta = [detail.year, detail.region, genres].filter(Boolean).join(' · ');
  document.getElementById('infoMeta').innerHTML=meta;

  // 评分卡片
  if(detail.rate) {
    const r = parseFloat(detail.rate);
    const full = Math.floor(r/2);
    const half = (r%2)>=1?1:0;
    const empty = 5-full-half;
    const stars = '★'.repeat(full) + (half?'½':'') + '☆'.repeat(empty);
    document.getElementById('ratingBody').innerHTML=`<div class="detail-rating-num">${detail.rate}</div><div class="detail-rating-stars">${stars}</div>`;
    document.getElementById('ratingCard').style.display='';
  } else {
    document.getElementById('ratingCard').style.display='none';
  }

  // 简介卡片
  let desc = detail.summary || '';
  desc = desc.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim();
  if(desc) {
    document.getElementById('descCardBody').innerHTML=`<div class="detail-desc-text" id="detailDescText">${desc}</div><span class="desc-toggle" id="descToggle" onclick="toggleDesc()">展开</span>`;
    document.getElementById('descCard').style.display='';
    // 超过3行显示展开按钮
    setTimeout(()=>{
      const el=document.getElementById('detailDescText');
      if(el && el.scrollHeight > el.clientHeight+2) {
        document.getElementById('descToggle').style.display='';
      } else if(document.getElementById('descToggle')) {
        document.getElementById('descToggle').style.display='none';
      }
    },100);
  } else {
    document.getElementById('descCard').style.display='none';
  }

  // 导演卡片
  if(detail.directors && detail.directors.length) {
    document.getElementById('directorCardBody').innerHTML=detail.directors.map(d=>`<span class="detail-tag">${d}</span>`).join(' ');
    document.getElementById('directorCard').style.display='';
  } else {
    document.getElementById('directorCard').style.display='none';
  }

  // 演员卡片
  if(detail.actors && detail.actors.length) {
    document.getElementById('actorCardBody').innerHTML=`<div class="detail-actor-scroll">${detail.actors.slice(0,12).map(a=>`<div class="detail-actor-item"><div class="detail-actor-avatar">👤</div><span class="detail-actor-name">${a.name}</span></div>`).join('')}</div>`;
    document.getElementById('actorCard').style.display='';
  } else {
    document.getElementById('actorCard').style.display='none';
  }
  
  // 海报背景
  const psBg=document.getElementById('psBg');
  if(psBg && detail.cover) psBg.style.backgroundImage=`url(${detail.cover})`;
  const poster=document.getElementById('detailPoster');
  if(poster){
    if(detail.cover){
      poster.src=detail.cover;
      poster.style.display='';
    } else {
      poster.style.display='none';
    }
  }
  
  updateFavBtn();
}

function renderInfoPageCards(detail, title) {
  // 基本信息用采集源的，不被豆瓣数据覆盖
  // 只在采集源没有时才用豆瓣数据补充
  
  // 副标题/别名：只在没有vod_sub时才用aka补充
  const existingSub = document.getElementById('infoSubTitle');
  if(existingSub && (existingSub.textContent || '').trim() === '') {
    const aka=detail.aka||[];
    if(aka.length) {
      existingSub.textContent='又名：'+aka.join(' / ');
      existingSub.style.display='';
    }
  }
  
  // 标签：只在没有时才用genres补充
  const existingTags = document.getElementById('infoTags');
  if(existingTags && (existingTags.textContent || '').trim() === '') {
    const genres=detail.genres||[];
    if(genres.length) {
      existingTags.innerHTML=genres.map(g=>`<span class="detail-tag">${g}</span>`).join(' ');
      existingTags.style.display='';
    }
  }
  
  // 海报：只在没有时才用豆瓣cover
  const poster = document.getElementById('infoPoster');
  if(poster && !poster.src) {
    if(detail.cover) poster.src=detail.cover;
  }
  
  // 评分：只在没有评分时才用豆瓣评分补充
  const ratingCard = document.getElementById('infoRatingCard');
  if(ratingCard && ratingCard.style.display === 'none' && detail.rate) {
    const r = parseFloat(detail.rate);
    if(r > 0) {
      const full = Math.floor(r/2);
      const half = (r%2)>=1?1:0;
      const stars = '★'.repeat(full) + (half?'½':'') + '☆'.repeat(5-full-half);
      const ratingCount = detail.rating_count||'';
      document.getElementById('infoRatingBody').innerHTML=`<div class="detail-rating-num">${detail.rate}</div><div class="detail-rating-stars">${stars}</div>${ratingCount?`<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${ratingCount}人评分</div>`:''}`;
      ratingCard.style.display='';
    }
  }
  
  // 简介：只在没有时才用豆瓣summary补充
  const descCard = document.getElementById('infoDescCard');
  const descText = document.getElementById('infoDescText');
  if(descCard && descText && (descText.textContent || '').trim() === '' && detail.summary) {
    let desc = detail.summary||'';
    desc = decodeHTML(desc).replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim();
    if(desc) {
      descText.textContent = desc;
      descCard.style.display='';
      setTimeout(()=>{
        const el=document.getElementById('infoDescText');
        const tog=document.getElementById('infoDescToggle');
        if(el&&tog&&el.scrollHeight>el.clientHeight+2) tog.style.display='';
      },100);
    }
  }
  
  // 导演：只在没有时才用豆瓣数据补充
  const directorCard = document.getElementById('infoDirectorCard');
  const directorBody = document.getElementById('infoDirectorBody');
  if(directorCard && directorBody && (directorBody.textContent || '').trim() === '' && detail.directors&&detail.directors.length) {
    directorBody.innerHTML=detail.directors.map(d=>`<span class="detail-tag">${typeof d==='string'?d:d.name||d}</span>`).join(' ');
    directorCard.style.display='';
  }
  
  // 演员：只在没有时才用豆瓣数据补充
  const actorCard = document.getElementById('infoActorCard');
  const actorBody = document.getElementById('infoActorBody');
  if(actorCard && actorBody && (actorBody.textContent || '').trim() === '' && detail.actors&&detail.actors.length) {
    actorBody.innerHTML=`<div class="detail-actor-scroll">${detail.actors.slice(0,20).map(a=>{
      const name=typeof a==='string'?a:a.name||a;
      const role=a.role||a.character||'';
      return `<div class="detail-actor-item"><div class="detail-actor-avatar">👤</div><span class="detail-actor-name">${name}</span>${role?`<span class="detail-actor-role">${role}</span>`:''}</div>`;
    }).join('')}</div>`;
    actorCard.style.display='';
  }
  
  updateInfoFavBtn();
}

function renderInfoPageCardsFromSource(v) {
  if(!v) return;
  document.getElementById('infoTitle2').textContent=v.vod_name||'';
  
  // 又名/别名（vod_sub）
  const sub=v.vod_sub||'';
  if(sub) {
    document.getElementById('infoSubTitle').textContent='又名：'+sub;
    document.getElementById('infoSubTitle').style.display='';
  }
  
  // 第一行元信息：年份 / 地区 / 语言
  const meta1=[v.vod_year,v.vod_area,v.vod_lang].filter(Boolean).join(' / ');
  document.getElementById('infoMeta2').innerHTML=meta1;
  
  // 第二行元信息：上映日期 / 时长 / 状态
  const meta2=[];
  if(v.vod_pubdate) meta2.push(v.vod_pubdate);
  if(v.vod_duration) meta2.push(v.vod_duration);
  if(v.vod_remarks) meta2.push(v.vod_remarks);
  if(meta2.length) {
    document.getElementById('infoMeta3').innerHTML=meta2.join(' / ');
    document.getElementById('infoMeta3').style.display='';
  }
  
  // 标签
  const tags=(v.type_name||v.vod_class||'').split(',').filter(Boolean);
  if(tags.length) {
    document.getElementById('infoTags').innerHTML=tags.map(t=>`<span class="detail-tag">${t}</span>`).join(' ');
    document.getElementById('infoTags').style.display='';
  }
  
  if(v.vod_pic) document.getElementById('infoPoster').src=v.vod_pic;
  
  // 评分（优先用豆瓣评分vod_douban_score，没有再用vod_score）
  const score=v.vod_douban_score||v.vod_score||'';
  if(score) {
    const r=parseFloat(score);
    if(r>0) {
      const full=Math.floor(r/2);
      const half=(r%2)>=1?1:0;
      const stars='★'.repeat(full)+(half?'½':'')+'☆'.repeat(5-full-half);
      document.getElementById('infoRatingBody').innerHTML=`<div class="detail-rating-num">${score}</div><div class="detail-rating-stars">${stars}</div>`;
      document.getElementById('infoRatingCard').style.display='';
    }
  }
  
  // 简介（优先用vod_blurb，没有再用vod_content）
  let desc=v.vod_blurb||v.vod_content||'';
  desc=desc.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
  if(desc) {
    document.getElementById('infoDescText').textContent=desc;
    document.getElementById('infoDescCard').style.display='';
    setTimeout(()=>{
      const el=document.getElementById('infoDescText');
      const tog=document.getElementById('infoDescToggle');
      if(el&&tog&&el.scrollHeight>el.clientHeight+2) tog.style.display='';
    },100);
  }
  
  // 导演
  if(v.vod_director) {
    const directors=v.vod_director.split(/[,，\/]/).filter(Boolean);
    if(directors.length) {
      document.getElementById('infoDirectorBody').innerHTML=directors.map(d=>`<span class="detail-tag">${d.trim()}</span>`).join(' ');
      document.getElementById('infoDirectorCard').style.display='';
    }
  }
  
  // 演员
  if(v.vod_actor) {
    const actors=v.vod_actor.split(/[,，\/]/).filter(Boolean);
    if(actors.length) {
      document.getElementById('infoActorBody').innerHTML=`<div class="detail-actor-scroll">${actors.slice(0,20).map(a=>{
        const name=a.trim();
        return `<div class="detail-actor-item"><div class="detail-actor-avatar">👤</div><span class="detail-actor-name">${name}</span></div>`;
      }).join('')}</div>`;
      document.getElementById('infoActorCard').style.display='';
    }
  }
  
  updateInfoFavBtn();
}

function goToPlayFromInfo() {
  const v = window._pendingPlayVideo;
  if(!v) { showToast('暂无播放源'); return; }
  showPage('detailPage');
  // 复用旧的播放页逻辑
  openPlayPage(v);
}

async function openPlayPage(v) {
  document.getElementById('detailTitle').textContent=v.vod_name;
  document.getElementById('infoTitle').textContent=v.vod_name;
  document.getElementById('episodesCard').style.display='none';
  document.getElementById('sourceCard').style.display='none';
  document.getElementById('playerArea').innerHTML=`<div class="player-start-overlay" id="playerStartOverlay"><div class="ps-bg" id="psBg"></div><div class="ps-content"><div class="ps-play-btn" onclick="startPlayFirst()"><svg viewBox="0 0 24 24" width="36" height="36"><polygon points="6,3 20,12 6,21" fill="#fff"/></svg></div><span class="ps-hint">立即播放</span></div></div>`;
  const poster=document.getElementById('detailPoster');
  if(poster&&v.vod_pic){poster.src=v.vod_pic;poster.style.display='';}else if(poster)poster.style.display='none';
  const psBg=document.getElementById('psBg');
  if(psBg&&v.vod_pic) psBg.style.backgroundImage=`url(${v.vod_pic})`;
  
  // 显示剧情简介
  const descCard = document.getElementById('detailDescCard');
  const descText = document.getElementById('detailDescText');
  const descToggle = document.getElementById('detailDescToggle');
  if(descCard && descText) {
    const rawDesc = v.vod_blurb || v.vod_content || '';
    const desc = cleanDescText(rawDesc);
    if(desc) {
      descText.textContent = desc;
      descCard.style.display = '';
      // 检查是否需要展开按钮
      if (descToggle) {
        descToggle.style.display = descText.scrollHeight > descText.clientHeight + 5 ? '' : 'none';
        descToggle.textContent = '展开';
        descText.classList.remove('expanded');
      }
    } else {
      descCard.style.display = 'none';
    }
  }
  
  // 同步收藏状态
  updateDetailFavBtn();
  
  // 播放源处理
  if(v.vod_play_url) {
    playSources = parsePlayUrls(v);
    if(playSources.length===1){document.getElementById('sourceCard').style.display='none';renderEpisodes(playSources[0],0);}
    else if(playSources.length>1){document.getElementById('sourceCard').style.display='';renderSourceTabs();renderEpisodes(playSources[0],0);}
    fetchOtherSources(v.vod_name);
    updateFavBtn();
  } else {
    // 没有播放源信息，通过详情接口获取（首页/分类页列表数据被后端strip了vod_play_url）
    try {
      let matchedVod=null;
      // 优先用 /api/video/detail 接口（通过 source_id + vod_id 直接获取详情，最快最准）
      if(v.source_id && v.vod_id) {
        try {
          const detail=await apiFetch(`${API}/api/video/detail?source_id=${v.source_id}&ids=${v.vod_id}`,15000);
          if(detail&&detail.list&&detail.list.length){
            matchedVod=detail.list.find(d=>d.vod_name===v.vod_name)||detail.list[0];
          }
        }catch(e){}
      }
      // 如果有 source_url，用 /api/video/detail/url 接口
      if(!matchedVod&&v.source_url&&v.vod_id) {
        try {
          const detail=await apiFetch(`${API}/api/video/detail/url?url=${encodeURIComponent(v.source_url)}&ids=${v.vod_id}`,15000);
          if(detail&&detail.list&&detail.list.length){
            matchedVod=detail.list.find(d=>d.vod_name===v.vod_name)||detail.list[0];
          }
        }catch(e){}
      }
      // fallback: 搜索接口
      if(!matchedVod) {
        let dd=null;
        if(v.source_url) { try{dd=await apiFetch(`${API}/api/search/source?url=${encodeURIComponent(v.source_url)}&wd=${encodeURIComponent(v.vod_name)}`,15000);}catch(e){} }
        if(dd&&dd.list&&dd.list.length) { matchedVod=dd.list.find(d=>d.vod_name===v.vod_name); if(!matchedVod)matchedVod=dd.list[0]; }
        if(!matchedVod&&v.source_id) {
          try {
            const sources=await getEnabledSources();
            const src=sources.find(s=>s.id==v.source_id||s.source_id==v.source_id);
            if(src&&src.url) { dd=await apiFetch(`${API}/api/search/source?url=${encodeURIComponent(src.url)}&wd=${encodeURIComponent(v.vod_name)}`,15000); if(dd&&dd.list&&dd.list.length){matchedVod=dd.list.find(d=>d.vod_name===v.vod_name);if(!matchedVod)matchedVod=dd.list[0];} }
          }catch(e){}
        }
      }
      if(matchedVod) {
        currentVideo=Object.assign({},currentVideo,{vod_play_url:matchedVod.vod_play_url||'',vod_play_from:matchedVod.vod_play_from||'',vod_content:matchedVod.vod_content||currentVideo.vod_content||'',vod_pic:matchedVod.vod_pic||currentVideo.vod_pic||''});
        playSources=parsePlayUrls(currentVideo);
        if(playSources.length===1){document.getElementById('sourceCard').style.display='none';renderEpisodes(playSources[0],0);}
        else if(playSources.length>1){document.getElementById('sourceCard').style.display='';renderSourceTabs();renderEpisodes(playSources[0],0);}
        fetchOtherSources(v.vod_name);
      } else {
        // 所有方式都失败，显示提示
        document.getElementById('episodesCard').style.display='';
        document.getElementById('episodesGrid').innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-secondary);font-size:13px">暂无播放源</div>';
      }
    }catch(e){}
    updateFavBtn();
  }
}

async function searchPlaySource(title) {
  if(!title) return;
  const sources = await getEnabledSources();
  if(!sources.length) return;
  
  for(const src of sources) {
    try {
      const data = await apiFetch(`${API}/api/search/source?url=${encodeURIComponent(src.url)}&wd=${encodeURIComponent(title)}`, 10000);
      if(data && data.list && data.list.length){
        // 精确匹配
        let matched = data.list.find(v=>v.vod_name === title);
        if(!matched && data.list.length > 0) matched = data.list[0];
        
        if(matched){
          currentVideo = Object.assign({}, currentVideo, {
            vod_play_url: matched.vod_play_url || '',
            vod_play_from: matched.vod_play_from || '',
            vod_content: matched.vod_content || '',
            vod_pic: matched.vod_pic || currentVideo.vod_pic || '',
            source_id: matched.source_id,
            source_name: matched.source_name,
            source_url: src.url
          });
          
          // 更新描述
          if(matched.vod_content){
            let desc = matched.vod_content.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim();
            document.getElementById('infoDesc').textContent = desc;
            checkDescExpand();
          }
          
          // 更新海报
          const psBg = document.getElementById('psBg');
          if(psBg && currentVideo.vod_pic) psBg.style.backgroundImage = `url(${currentVideo.vod_pic})`;
          const poster = document.getElementById('detailPoster');
          if(poster && currentVideo.vod_pic) {
            poster.src = currentVideo.vod_pic;
            poster.style.display = '';
          }
          
          // 解析播放链接
          playSources = parsePlayUrls(currentVideo);
          if(playSources.length === 1) {
            document.getElementById('sourceCard').style.display='none';
            renderEpisodes(playSources[0], 0);
          } else if(playSources.length > 1) {
            document.getElementById('sourceCard').style.display='';
            renderSourceTabs();
            renderEpisodes(playSources[0], 0);
          }
          
          updateFavBtn();
          return;
        }
      }
    } catch(e) {}
  }
  
  // 没有找到播放资源
  document.getElementById('infoDesc').textContent='暂无播放资源';
}

function toggleInfoDesc() {
  const el=document.getElementById('infoDescText');
  const tog=document.getElementById('infoDescToggle');
  if(!el||!tog) return;
  el.classList.toggle('expanded');
  tog.textContent=el.classList.contains('expanded')?'收起':'展开';
}

function toggleInfoFav() {
  if(!currentVideo) return;
  const f=getFavorites();
  const i=f.findIndex(x=>x.vod_id===currentVideo.vod_id&&x.source_id===currentVideo.source_id);
  if(i>=0){f.splice(i,1);showToast('已取消收藏');}
  else{f.unshift({vod_id:currentVideo.vod_id,vod_name:currentVideo.vod_name||currentVideo.title||'',vod_pic:currentVideo.vod_pic||(currentVideo.cover||''),source_id:currentVideo.source_id||'',source_name:currentVideo.source_name||'',douban_id:currentVideo.douban_id});showToast('已收藏');}
  saveFavorites(f);
  updateDetailFavBtn();
  updateInfoFavBtn();
}

function updateInfoFavBtn() {
  const btn=document.getElementById('infoFavBtn');
  if(!btn||!currentVideo) return;
  const f=getFavorites();
  const i=f.findIndex(x=>x.vod_id===currentVideo.vod_id&&x.source_id===currentVideo.source_id);
  if(i>=0){btn.textContent='♥';btn.classList.add('is-fav');}
  else{btn.textContent='♡';btn.classList.remove('is-fav');}
}

function toggleDetailDesc() {
  const el = document.getElementById('detailDescText');
  const toggle = document.getElementById('detailDescToggle');
  if (!el || !toggle) return;
  const isExpanded = el.classList.toggle('expanded');
  toggle.textContent = isExpanded ? '收起' : '展开';
}

function toggleDetailFav() {
  if(!currentVideo) return;
  const f=getFavorites();
  const i=f.findIndex(x=>x.vod_id===currentVideo.vod_id&&x.source_id===currentVideo.source_id);
  const infoBtn=document.getElementById('infoFavBtn');
  const detailBtn=document.getElementById('detailFavBtn');
  if(i>=0){f.splice(i,1);showToast('已取消收藏');}
  else{f.unshift({vod_id:currentVideo.vod_id,vod_name:currentVideo.vod_name||currentVideo.title||'',vod_pic:currentVideo.vod_pic||(currentVideo.cover||''),source_id:currentVideo.source_id||'',source_name:currentVideo.source_name||'',douban_id:currentVideo.douban_id});showToast('已收藏 ★');}
  saveFavorites(f);
  // 触发动画
  if(infoBtn){infoBtn.classList.remove('fav-animate');void infoBtn.offsetWidth;infoBtn.classList.add('fav-animate');}
  if(detailBtn){detailBtn.classList.remove('fav-animate');void detailBtn.offsetWidth;detailBtn.classList.add('fav-animate');}
  updateDetailFavBtn();
  updateInfoFavBtn();
}

function updateDetailFavBtn() {
  const btn=document.getElementById('detailFavBtn');
  if(!btn||!currentVideo) return;
  const f=getFavorites();
  const i=f.findIndex(x=>x.vod_id===currentVideo.vod_id&&x.source_id===currentVideo.source_id);
  if(i>=0){btn.textContent='♥';btn.classList.add('is-fav');}
  else{btn.textContent='♡';btn.classList.remove('is-fav');}
}

function getGradientBg(text) {
  const colors = [
    ['#667eea','#764ba2'],['#f093fb','#f5576c'],['#4facfe','#00f2fe'],
    ['#43e97b','#38f9d7'],['#fa709a','#fee140'],['#a8edea','#fed6e3'],
    ['#ff9a9e','#fecfef'],['#ffecd2','#fcb69f'],['#a1c4fd','#c2e9fb'],
    ['#d299c2','#fef9d7'],['#89f7fe','#66a6ff'],['#cd9cf2','#f6f3ff']
  ];
  const idx = text ? text.charCodeAt(0) % colors.length : 0;
  const [c1, c2] = colors[idx];
  return `background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:rgba(255,255,255,0.9);text-shadow:0 2px 8px rgba(0,0,0,0.3)`;
}

function cleanDescText(str) {
  if (!str) return '';
  return decodeHTML(str).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function decodeHTML(str) {
  if (!str) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function fixPicUrl(pic, sourceUrl) {
  if(!pic) return '';
  if(pic.startsWith('http://') || pic.startsWith('https://') || pic.startsWith('data:')) return pic;
  // 相对路径，拼接采集源域名
  try {
    const u = new URL(sourceUrl);
    if(pic.startsWith('/')) return u.origin + pic;
    return u.origin + '/' + pic;
  } catch(e) { return pic; }
}

function getSourceNameCN(name) {
  if (!name) return '源';
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();
  // 先精确匹配
  if (SOURCE_NAME_MAP[lower]) return SOURCE_NAME_MAP[lower];
  if (SOURCE_NAME_MAP[name]) return SOURCE_NAME_MAP[name];
  // 模糊匹配包含关系
  for (const key in SOURCE_NAME_MAP) {
    if (lower.includes(key) || key.includes(lower)) {
      return SOURCE_NAME_MAP[key];
    }
  }
  return name;
}