/* 给applyFullscreenCSS()的控制层HTML加进度条，并加更新逻辑 */
const fs = require('fs');
const path = 'D:/项目/影视星球_yunshao-app_yunshao_v3.9.0_source/app.js';
let src = fs.readFileSync(path, 'utf8');

/* 1. 在controls.innerHTML的模板里，.fs-top-bar 闭合后、.fs-bottom-bar 前插入进度条HTML */
const progressBarHTML = `    <!-- 进度条 -->
    <div class="fs-progress-bar">
      <span class="fs-time-current" id="fsTimeCurrent">0:00</span>
      <div class="fs-progress-track" id="fsProgressTrack">
        <div class="fs-progress-played" id="fsProgressPlayed"></div>
        <div class="fs-progress-handle" id="fsProgressHandle"></div>
      </div>
      <span class="fs-time-total" id="fsTimeTotal">0:00</span>
    </div>

    `;

// 在 .fs-top-bar 的 </div> 后、<!-- 底部控制栏 --> 前插入
src = src.replace(
  /(\s*<\/div>\s*<!-- 底部控制栏 -->)/,
  '\n' + progressBarHTML + '$1'
);

/* 2. 在 applyFullscreenCSS() 末尾（showFullscreenControls(pa); 之后）加进度条更新定时器 */
const timerCode = `
  // 启动进度条更新定时器
  pa._fsProgressTimer = setInterval(() => {
    const v = pa.querySelector('video');
    if (!v) return;
    const cur = document.getElementById('fsTimeCurrent');
    const total = document.getElementById('fsTimeTotal');
    const played = document.getElementById('fsProgressPlayed');
    if (cur) cur.textContent = fmt(v.currentTime);
    if (total) total.textContent = fmt(v.duration);
    if (played && v.duration) played.style.width = (v.currentTime / v.duration * 100) + '%';
  }, 500);

  // 进度条点击跳转
  const track = document.getElementById('fsProgressTrack');
  if (track) {
    track.addEventListener('click', (e) => {
      const v = pa.querySelector('video');
      if (!v || !v.duration) return;
      const rect = track.getBoundingClientRect();
      v.currentTime = (e.clientX - rect.left) / rect.width * v.duration;
    });
  }
`;

// 在 showFullscreenControls(pa); 后面插入
src = src.replace(
  /(\s*)showFullscreenControls\(pa\);\s*\n(\s*)function removeFullscreenCSS/,
  '$1showFullscreenControls(pa);' + timerCode + '\n$2function removeFullscreenCSS'
);

/* 3. 在 removeFullscreenCSS() 里清除定时器 */
src = src.replace(
  /(isCSSFullscreen=false;)/,
  '$1\n  clearInterval(pa._fsProgressTimer); pa._fsProgressTimer = null;'
);

/* 4. 加 fmt 函数（如果不存在）*/
if (!src.includes('function fmt(seconds)')) {
  const fmtFn = `
function fmt(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
`;
  // 加到 exitFullscreenMode 函数前
  src = src.replace(/(function exitFullscreenMode\(\))/, fmtFn + '$1');
}

fs.writeFileSync(path, src, 'utf8');
console.log('Done');
