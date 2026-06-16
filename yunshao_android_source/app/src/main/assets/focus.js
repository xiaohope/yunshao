/**
 * 云梢影视 TV 遥控器焦点管理模块
 * 支持 D-Pad 方向键导航、焦点记忆、遥控器按键映射
 */

const FocusManager = (function() {
  'use strict';

  // 配置
  const config = {
    focusClass: 'focused',
    focusableSelector: '[data-focusable], .video-card, .cat-card, .ep-btn, .tv-channel-item, .filter-opt, .nav-item, .action-btn, .ep-btn, .hot-item, .mgmt-item, .menu-row, .stat-cell',
    containerSelector: '[data-focus-container]',
    autoScroll: true,
    scrollPadding: 20,
    rememberPosition: true,
    storageKey: 'focus_manager_state'
  };

  // 状态
  let state = {
    currentFocus: null,
    containers: new Map(),
    lastPosition: new Map(),
    keyRepeatTimer: null,
    keyRepeatDelay: 200,
    keyRepeatInterval: 80
  };

  // 按键码映射
  const KeyMap = {
    UP: ['ArrowUp', 'ChannelUp', 'UP'],
    DOWN: ['ArrowDown', 'ChannelDown', 'DOWN'],
    LEFT: ['ArrowLeft', 'LEFT'],
    RIGHT: ['ArrowRight', 'RIGHT'],
    ENTER: ['Enter', 'OK', 'SELECT', 'CONFIRM'],
    BACK: ['Backspace', 'Escape', 'BACK', 'RETURN'],
    MENU: ['Menu', 'ContextMenu', 'CONTEXT_MENU'],
    PLAY: ['Play', 'PAUSE', 'PLAY_PAUSE'],
    INFO: ['Info', 'INFO', 'GUIDE']
  };

  /**
   * 初始化焦点管理
   * @param {Object} options - 配置选项
   */
  function init(options = {}) {
    Object.assign(config, options);
    
    // 从存储恢复焦点位置
    if (config.rememberPosition) {
      restoreState();
    }

    // 绑定按键事件
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // 监听页面可见性变化
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('FocusManager initialized');
    return FocusManager;
  }

  /**
   * 销毁焦点管理
   */
  function destroy() {
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    saveState();
    state = {
      currentFocus: null,
      containers: new Map(),
      lastPosition: new Map(),
      keyRepeatTimer: null
    };
  }

  /**
   * 处理按键事件
   */
  function handleKeyDown(e) {
    const action = getKeyAction(e);
    if (!action) return;

    e.preventDefault();

    switch (action) {
      case 'UP':
      case 'DOWN':
      case 'LEFT':
      case 'RIGHT':
        handleNavigation(action);
        break;
      case 'ENTER':
        handleEnter();
        break;
      case 'BACK':
        handleBack();
        break;
      case 'MENU':
        handleMenu();
        break;
      default:
        break;
    }
  }

  /**
   * 处理按键抬起
   */
  function handleKeyUp() {
    if (state.keyRepeatTimer) {
      clearTimeout(state.keyRepeatTimer);
      state.keyRepeatTimer = null;
    }
  }

  /**
   * 获取按键动作
   */
  function getKeyAction(e) {
    const code = e.code || e.key;
    for (const [action, keys] of Object.entries(KeyMap)) {
      if (keys.includes(code)) {
        return action;
      }
    }
    return null;
  }

  /**
   * 处理导航
   */
  function handleNavigation(direction) {
    if (!state.currentFocus) {
      // 没有焦点时，默认聚焦第一个可聚焦元素
      const first = getFirstFocusable();
      if (first) focus(first);
      return;
    }

    // 尝试在当前容器内导航
    const next = findNextFocusable(direction);
    if (next) {
      focus(next);
    }
  }

  /**
   * 查找下一个可聚焦元素
   */
  function findNextFocusable(direction) {
    const current = state.currentFocus;
    if (!current) return null;

    const container = findFocusContainer(current);
    const allFocusable = getFocusableInContainer(container);
    if (allFocusable.length === 0) return null;

    const currentIndex = allFocusable.indexOf(current);
    if (currentIndex === -1) return allFocusable[0];

    let nextIndex;
    
    switch (direction) {
      case 'UP':
        nextIndex = findVerticalNext(current, allFocusable, -1);
        break;
      case 'DOWN':
        nextIndex = findVerticalNext(current, allFocusable, 1);
        break;
      case 'LEFT':
        nextIndex = findHorizontalPrev(currentIndex, allFocusable);
        break;
      case 'RIGHT':
        nextIndex = findHorizontalNext(currentIndex, allFocusable);
        break;
      default:
        nextIndex = currentIndex;
    }

    return allFocusable[nextIndex] || current;
  }

  /**
   * 垂直方向查找下一个元素
   */
  function findVerticalNext(current, allFocusable, direction) {
    const currentRect = current.getBoundingClientRect();
    const threshold = currentRect.width / 2;

    let candidates = allFocusable.filter(el => {
      const rect = el.getBoundingClientRect();
      if (direction < 0) {
        return rect.bottom <= currentRect.top + 5;
      } else {
        return rect.top >= currentRect.bottom - 5;
      }
    });

    if (candidates.length === 0) {
      // 没有找到同列的，尝试找最近的
      candidates = allFocusable.filter(el => {
        const rect = el.getBoundingClientRect();
        return el !== current && 
               Math.abs(rect.left - currentRect.left) < threshold;
      });
    }

    if (candidates.length === 0) {
      // 仍然没有，找所有元素中最接近的
      candidates = [...allFocusable];
    }

    // 排序找到最近的
    candidates.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const currentCenter = currentRect.left + currentRect.width / 2;
      
      if (direction < 0) {
        return rectB.bottom - rectA.bottom;
      } else {
        return rectA.top - rectB.top;
      }
    });

    // 返回最接近的
    const sorted = candidates.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      const currentCenter = currentRect.left + currentRect.width / 2;
      return Math.abs(rectA.left + rectA.width/2 - currentCenter) - 
             Math.abs(rectB.left + rectB.width/2 - currentCenter);
    });

    return allFocusable.indexOf(sorted[0]);
  }

  /**
   * 水平方向查找上一个元素
   */
  function findHorizontalPrev(currentIndex, allFocusable) {
    return Math.max(0, currentIndex - 1);
  }

  /**
   * 水平方向查找下一个元素
   */
  function findHorizontalNext(currentIndex, allFocusable) {
    return Math.min(allFocusable.length - 1, currentIndex + 1);
  }

  /**
   * 处理确认键
   */
  function handleEnter() {
    const current = state.currentFocus;
    if (!current) return;

    // 模拟点击
    current.click();

    // 触发自定义事件
    current.dispatchEvent(new CustomEvent('focus-enter', {
      bubbles: true,
      detail: { element: current }
    }));
  }

  /**
   * 处理返回键
   */
  function handleBack() {
    // 触发自定义事件
    document.dispatchEvent(new CustomEvent('focus-back', {
      bubbles: true
    }));
  }

  /**
   * 处理菜单键
   */
  function handleMenu() {
    document.dispatchEvent(new CustomEvent('focus-menu', {
      bubbles: true
    }));
  }

  /**
   * 聚焦指定元素
   */
  function focus(element) {
    if (!element) return;

    // 移除旧焦点
    if (state.currentFocus) {
      state.currentFocus.classList.remove(config.focusClass);
    }

    // 设置新焦点
    state.currentFocus = element;
    element.classList.add(config.focusClass);

    // 自动滚动
    if (config.autoScroll) {
      scrollIntoView(element);
    }

    // 保存位置
    if (config.rememberPosition) {
      savePosition();
    }

    // 触发事件
    element.dispatchEvent(new CustomEvent('focus-changed', {
      bubbles: true,
      detail: { element: element }
    }));
  }

  /**
   * 滚动元素到可见区域
   */
  function scrollIntoView(element) {
    const parent = findScrollableParent(element);
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    const padding = config.scrollPadding;

    // 上下滚动
    if (elementRect.top < parentRect.top + padding) {
      parent.scrollTop -= (parentRect.top - elementRect.top) + padding;
    } else if (elementRect.bottom > parentRect.bottom - padding) {
      parent.scrollTop += (elementRect.bottom - parentRect.bottom) + padding;
    }

    // 左右滚动
    if (elementRect.left < parentRect.left + padding) {
      parent.scrollLeft -= (parentRect.left - elementRect.left) + padding;
    } else if (elementRect.right > parentRect.right - padding) {
      parent.scrollLeft += (elementRect.right - parentRect.right) + padding;
    }
  }

  /**
   * 查找可滚动的父元素
   */
  function findScrollableParent(element) {
    let parent = element.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      const overflow = style.overflowX + style.overflowY;
      if (overflow.includes('auto') || overflow.includes('scroll')) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return document.documentElement;
  }

  /**
   * 移动焦点到指定方向
   */
  function moveTo(direction) {
    handleNavigation(direction);
  }

  /**
   * 获取当前焦点元素
   */
  function getCurrent() {
    return state.currentFocus;
  }

  /**
   * 获取第一个可聚焦元素
   */
  function getFirstFocusable() {
    const container = document.querySelector(config.containerSelector) || document.body;
    return container.querySelector(config.focusableSelector);
  }

  /**
   * 获取容器内所有可聚焦元素
   */
  function getFocusableInContainer(container) {
    if (!container) {
      container = document.body;
    }
    return Array.from(container.querySelectorAll(config.focusableSelector)).filter(el => {
      return !el.disabled && 
             !el.hasAttribute('disabled') &&
             window.getComputedStyle(el).display !== 'none' &&
             window.getComputedStyle(el).visibility !== 'hidden';
    });
  }

  /**
   * 查找元素的焦点容器
   */
  function findFocusContainer(element) {
    let parent = element.parentElement;
    while (parent) {
      if (parent.hasAttribute('data-focus-container') ||
          parent.classList.contains('focus-container')) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return document.body;
  }

  /**
   * 注册焦点区域
   */
  function register(container, options = {}) {
    const id = options.id || container.id || `container_${Date.now()}`;
    
    state.containers.set(id, {
      element: container,
      options: options
    });

    // 设置默认焦点
    if (options.defaultFocus) {
      const defaultEl = container.querySelector(options.defaultFocus);
      if (defaultEl) {
        state.lastPosition.set(id, defaultEl);
      }
    }

    return id;
  }

  /**
   * 取消注册焦点区域
   */
  function unregister(id) {
    state.containers.delete(id);
    state.lastPosition.delete(id);
  }

  /**
   * 保存状态
   */
  function saveState() {
    if (!config.rememberPosition) return;
    try {
      const stateData = {
        lastPosition: Array.from(state.lastPosition.entries()),
        timestamp: Date.now()
      };
      localStorage.setItem(config.storageKey, JSON.stringify(stateData));
    } catch (e) {
      console.warn('Failed to save focus state:', e);
    }
  }

  /**
   * 恢复状态
   */
  function restoreState() {
    if (!config.rememberPosition) return;
    try {
      const saved = localStorage.getItem(config.storageKey);
      if (saved) {
        const data = JSON.parse(saved);
        state.lastPosition = new Map(data.lastPosition);
      }
    } catch (e) {
      console.warn('Failed to restore focus state:', e);
    }
  }

  /**
   * 保存当前位置
   */
  function savePosition() {
    const current = state.currentFocus;
    if (!current) return;

    const container = findFocusContainer(current);
    const containerId = container.id || 'default';
    
    // 移除容器中的其他焦点索引
    const allFocusable = getFocusableInContainer(container);
    const index = allFocusable.indexOf(current);
    
    if (index !== -1) {
      state.lastPosition.set(containerId, index);
    }
  }

  /**
   * 恢复焦点位置
   */
  function restorePosition(containerId = 'default') {
    const index = state.lastPosition.get(containerId);
    if (typeof index !== 'number') return;

    const container = document.getElementById(containerId) || document.body;
    const allFocusable = getFocusableInContainer(container);
    
    if (allFocusable[index]) {
      focus(allFocusable[index]);
    }
  }

  /**
   * 处理页面可见性变化
   */
  function handleVisibilityChange() {
    if (document.hidden) {
      saveState();
    } else {
      // 页面重新可见时，恢复焦点
      restoreState();
    }
  }

  /**
   * 设置焦点样式类名
   */
  function setFocusClass(className) {
    if (state.currentFocus) {
      state.currentFocus.classList.remove(config.focusClass);
    }
    config.focusClass = className;
    if (state.currentFocus) {
      state.currentFocus.classList.add(config.focusClass);
    }
  }

  /**
   * 添加焦点变化监听器
   */
  function onFocusChange(callback) {
    document.addEventListener('focus-changed', (e) => {
      callback(e.detail.element);
    });
  }

  /**
   * 添加按键监听器
   */
  function onKey(action, callback) {
    document.addEventListener('keydown', (e) => {
      if (getKeyAction(e) === action) {
        callback(e);
      }
    });
  }

  // 导出公共 API
  return {
    init,
    destroy,
    focus,
    moveTo,
    getCurrent,
    register,
    unregister,
    restorePosition,
    setFocusClass,
    onFocusChange,
    onKey,
    config
  };
})();

// 自动初始化（可选）
// 如果在 TV 环境中，可以自动初始化
// if (window.matchMedia('(min-width: 768px)').matches) {
//   FocusManager.init();
// }

// 支持 ES Module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FocusManager;
}

// 支持 AMD
if (typeof define === 'function' && define.amd) {
  define([], function() { return FocusManager; });
}

// 全局导出
window.FocusManager = FocusManager;
