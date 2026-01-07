// 工具函数

// 格式化时间
export function formatTime(timestamp) {
  if (!timestamp) return '';
  
  let date;
  
  // 处理多种时间戳格式
  if (typeof timestamp === 'number') {
    // 数字时间戳（BIGINT或毫秒时间戳）
    date = new Date(timestamp);
  } else if (typeof timestamp === 'string') {
    // 字符串格式
    // 尝试解析为ISO字符串
    if (timestamp.includes('T') || timestamp.includes('-')) {
      date = new Date(timestamp);
    } else {
      // 可能是数字字符串（BIGINT）
      const numTimestamp = parseInt(timestamp, 10);
      if (!isNaN(numTimestamp) && numTimestamp > 0) {
        date = new Date(numTimestamp);
      } else {
        date = new Date(timestamp);
      }
    }
  } else {
    date = new Date(timestamp);
  }
  
  // 检查日期是否有效
  if (isNaN(date.getTime())) {
    console.warn('无法解析时间戳:', timestamp);
    return '未知时间';
  }
  
  const now = new Date();
  const diff = now - date;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  
  return date.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

// 截断文本
export function truncate(text, length = 100) {
  if (!text) return '';
  if (text.length <= length) return text;
  return text.substring(0, length) + '...';
}

// 检测URL
export function isURL(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

// 防抖
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 节流
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// 生成UUID（简单版本）
export function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 动态加载 PDF.js
let pdfjsLoading = null;
export async function loadPDFJS() {
  if (typeof pdfjsLib !== 'undefined') {
    return pdfjsLib;
  }
  
  if (pdfjsLoading) {
    return pdfjsLoading;
  }
  
  pdfjsLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      if (typeof pdfjsLib !== 'undefined') {
        // 配置 Worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        console.log('✓ PDF.js 已动态加载');
        resolve(pdfjsLib);
      } else {
        reject(new Error('PDF.js 加载失败'));
      }
    };
    script.onerror = () => {
      pdfjsLoading = null;
      reject(new Error('PDF.js 脚本加载失败'));
    };
    document.head.appendChild(script);
  });
  
  return pdfjsLoading;
}

// 动态加载 D3.js
let d3Loading = null;
export async function loadD3() {
  if (typeof d3 !== 'undefined') {
    return d3;
  }
  
  if (d3Loading) {
    return d3Loading;
  }
  
  d3Loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://d3js.org/d3.v7.min.js';
    script.async = true;
    script.onload = () => {
      if (typeof d3 !== 'undefined') {
        console.log('✓ D3.js 已动态加载');
        resolve(d3);
      } else {
        reject(new Error('D3.js 加载失败'));
      }
    };
    script.onerror = () => {
      d3Loading = null;
      reject(new Error('D3.js 脚本加载失败'));
    };
    document.head.appendChild(script);
  });
  
  return d3Loading;
}

