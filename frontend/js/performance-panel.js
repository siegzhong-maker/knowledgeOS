/**
 * 性能监控可视化面板
 */

import performanceMonitor from './performance-monitor.js';

class PerformancePanel {
  constructor() {
    this.panel = null;
    this.isVisible = false;
    this.updateInterval = null;
  }

  create() {
    if (this.panel) return;

    // 创建面板容器
    this.panel = document.createElement('div');
    this.panel.id = 'performance-panel';
    this.panel.className = 'fixed bottom-4 right-4 w-96 max-h-[80vh] bg-white rounded-lg shadow-2xl border border-slate-200 z-[100] hidden flex flex-col';
    this.panel.innerHTML = `
      <div class="flex items-center justify-between p-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-purple-50">
        <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span>⚡</span>
          <span>性能监控</span>
        </h3>
        <div class="flex items-center gap-2">
          <button id="perf-panel-refresh" class="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-white rounded transition-colors" title="刷新">
            <i class="fa-solid fa-rotate text-sm"></i>
          </button>
          <button id="perf-panel-export" class="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-white rounded transition-colors" title="导出">
            <i class="fa-solid fa-download text-sm"></i>
          </button>
          <button id="perf-panel-clear" class="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-white rounded transition-colors" title="清除">
            <i class="fa-solid fa-trash text-sm"></i>
          </button>
          <button id="perf-panel-close" class="p-1.5 text-slate-500 hover:text-red-600 hover:bg-white rounded transition-colors" title="关闭">
            <i class="fa-solid fa-xmark text-sm"></i>
          </button>
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto p-4">
        <div id="perf-panel-summary" class="mb-4">
          <!-- 摘要信息 -->
        </div>
        
        <div class="mb-4">
          <h4 class="text-sm font-semibold text-slate-700 mb-2">最慢的操作</h4>
          <div id="perf-panel-slowest" class="space-y-2">
            <!-- 最慢操作列表 -->
          </div>
        </div>
        
        <div>
          <h4 class="text-sm font-semibold text-slate-700 mb-2">所有操作</h4>
          <div id="perf-panel-all" class="space-y-1 max-h-64 overflow-y-auto">
            <!-- 所有操作列表 -->
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.panel);
    this.bindEvents();
  }

  bindEvents() {
    if (!this.panel) return;

    // 关闭按钮
    const closeBtn = this.panel.querySelector('#perf-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // 刷新按钮
    const refreshBtn = this.panel.querySelector('#perf-panel-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.update());
    }

    // 导出按钮
    const exportBtn = this.panel.querySelector('#perf-panel-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const format = prompt('选择导出格式:\n1. JSON\n2. CSV\n3. HTML', '1');
        if (format === '1') {
          performanceMonitor.exportJSON();
        } else if (format === '2') {
          performanceMonitor.exportCSV();
        } else if (format === '3') {
          performanceMonitor.exportHTML();
        }
      });
    }

    // 清除按钮
    const clearBtn = this.panel.querySelector('#perf-panel-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('确定要清除所有性能数据吗？')) {
          performanceMonitor.clear();
          this.update();
        }
      });
    }
  }

  show() {
    if (!this.panel) {
      this.create();
    }
    
    this.panel.classList.remove('hidden');
    this.isVisible = true;
    this.update();
    
    // 每 2 秒自动更新
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      if (this.isVisible) {
        this.update();
      }
    }, 2000);
  }

  hide() {
    if (this.panel) {
      this.panel.classList.add('hidden');
    }
    this.isVisible = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  update() {
    if (!this.panel || !this.isVisible) return;

    const summary = performanceMonitor.getSummary();
    const records = performanceMonitor.getRecords();

    // 更新摘要
    this.updateSummary(summary);
    
    // 更新最慢操作列表
    this.updateSlowest(summary.slowest || []);
    
    // 更新所有操作列表
    this.updateAll(records);
  }

  updateSummary(summary) {
    const summaryEl = this.panel.querySelector('#perf-panel-summary');
    if (!summaryEl) return;

    if (summary.totalRecords === 0) {
      summaryEl.innerHTML = '<p class="text-sm text-slate-500 text-center py-4">暂无性能数据</p>';
      return;
    }

    const severityColors = {
      critical: 'bg-red-100 text-red-800',
      severe: 'bg-orange-100 text-orange-800',
      warning: 'bg-yellow-100 text-yellow-800',
      normal: 'bg-green-100 text-green-800'
    };

    summaryEl.innerHTML = `
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-500 mb-1">总记录数</div>
          <div class="text-lg font-bold text-slate-800">${summary.totalRecords}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-500 mb-1">平均耗时</div>
          <div class="text-lg font-bold text-slate-800">${summary.avgDuration.toFixed(2)}ms</div>
        </div>
      </div>
      
      ${summary.severityCounts ? `
        <div class="flex gap-2 flex-wrap">
          ${summary.severityCounts.critical > 0 ? `
            <span class="px-2 py-1 rounded text-xs ${severityColors.critical}">
              🔴 极慢: ${summary.severityCounts.critical}
            </span>
          ` : ''}
          ${summary.severityCounts.severe > 0 ? `
            <span class="px-2 py-1 rounded text-xs ${severityColors.severe}">
              🟠 严重: ${summary.severityCounts.severe}
            </span>
          ` : ''}
          ${summary.severityCounts.warning > 0 ? `
            <span class="px-2 py-1 rounded text-xs ${severityColors.warning}">
              🟡 警告: ${summary.severityCounts.warning}
            </span>
          ` : ''}
          ${summary.severityCounts.normal > 0 ? `
            <span class="px-2 py-1 rounded text-xs ${severityColors.normal}">
              ✅ 正常: ${summary.severityCounts.normal}
            </span>
          ` : ''}
        </div>
      ` : ''}
    `;
  }

  updateSlowest(slowest) {
    const slowestEl = this.panel.querySelector('#perf-panel-slowest');
    if (!slowestEl) return;

    if (slowest.length === 0) {
      slowestEl.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">暂无数据</p>';
      return;
    }

    const severityIcons = {
      critical: '🔴',
      severe: '🟠',
      warning: '🟡',
      normal: '✅'
    };

    slowestEl.innerHTML = slowest.slice(0, 5).map((record, index) => {
      const icon = severityIcons[record.severity] || '✅';
      return `
        <div class="flex items-center justify-between p-2 bg-slate-50 rounded text-xs">
          <div class="flex-1 min-w-0">
            <div class="font-medium text-slate-700 truncate">${icon} ${record.label}</div>
            <div class="text-slate-500 text-[10px] mt-0.5">
              ${new Date(record.timestamp).toLocaleTimeString()}
            </div>
          </div>
          <div class="ml-2 font-bold text-slate-800">
            ${record.duration.toFixed(0)}ms
          </div>
        </div>
      `;
    }).join('');
  }

  updateAll(records) {
    const allEl = this.panel.querySelector('#perf-panel-all');
    if (!allEl) return;

    if (records.length === 0) {
      allEl.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">暂无数据</p>';
      return;
    }

    const severityColors = {
      critical: 'border-l-red-500',
      severe: 'border-l-orange-500',
      warning: 'border-l-yellow-500',
      normal: 'border-l-green-500'
    };

    // 只显示最近 20 条
    const recentRecords = records.slice(-20).reverse();

    allEl.innerHTML = recentRecords.map(record => {
      const borderColor = severityColors[record.severity] || 'border-l-slate-300';
      return `
        <div class="flex items-center justify-between p-1.5 border-l-2 ${borderColor} bg-slate-50 rounded text-xs">
          <div class="flex-1 min-w-0 truncate text-slate-700">${record.label}</div>
          <div class="ml-2 text-slate-600 font-medium">${record.duration.toFixed(0)}ms</div>
        </div>
      `;
    }).join('');
  }
}

// 创建全局实例
const performancePanel = new PerformancePanel();

// 暴露到全局
if (typeof window !== 'undefined') {
  window.performancePanel = performancePanel;
  
  // 添加快捷键：Ctrl+Shift+P 打开/关闭性能面板
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      performancePanel.toggle();
    }
  });
}

export default performancePanel;

