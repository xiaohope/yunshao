/* 给style.css加全屏进度条CSS */
const fs = require('fs');
const path = 'D:/项目/影视星球_yunshao-app_yunshao_v3.9.0_source/style.css';
let src = fs.readFileSync(path, 'utf8');

const insertCSS = `
/* 全屏进度条 */
.fs-progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12px;
  color: #fff;
  pointer-events: auto;
}
.fs-time-current, .fs-time-total {
  min-width: 36px;
  text-align: center;
  flex-shrink: 0;
}
.fs-progress-track {
  flex: 1;
  height: 4px;
  background: rgba(255,255,255,0.3);
  border-radius: 2px;
  position: relative;
  cursor: pointer;
}
.fs-progress-track:hover {
  height: 6px;
}
.fs-progress-played {
  height: 100%;
  background: #ff6b35;
  border-radius: 2px;
  width: 0%;
  transition: width 0.3s;
}
.fs-progress-handle {
  display: none;
}
.fs-progress-track:hover .fs-progress-handle {
  display: block;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  background: #ff6b35;
  border-radius: 50%;
  left: 0%;
}

`;

// 在 .fs-bottom-bar 前插入
src = src.replace(/(.fs-bottom-bar\s*\{)/, insertCSS + '$1');

fs.writeFileSync(path, src, 'utf8');
console.log('Done');
