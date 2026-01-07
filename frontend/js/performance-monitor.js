/**
 * 性能监控核心模块
 * 提供操作计时、数据收集和报告生成功能
 */

class PerformanceMonitor {
  constructor() {
    this.records = [];
    this.activeTimers = new Map();
    this.enabled = this.shouldEnable();
    this.thresholds = {
      warning: 500,    // 警告阈值（毫秒）
      severe: 2000,    // 严重阈值（毫秒）
      critical: 5000   // 极慢阈值（毫秒）
    };
    
    // 监听页面卸载，保存性能数据
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.saveToLocalStorage();
      });
      
      // 从本地存储恢复数据
      this.loadFromLocalStorage();
    }
  }

  shouldEnable() {
    if (typeof window === 'undefined') return false;
    
    // 开发模式自动启用
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' ||
                  window.location.search.includes('perf=1');
    
    return isDev;
  }

  /**
   * 开始计时
   */
  start(label, metadata = {}) {
    if (!this.enabled) return;
    
    const startTime = performance.now();
    const timerId = `${label}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.activeTimers.set(timerId, {
      label,
      startTime,
      metadata
    });
    
    return timerId;
  }

  /**
   * 结束计时并记录
   */
  end(timerId, additionalMetadata = {}) {
    if (!this.enabled) return null;
    
    const timer = this.activeTimers.get(timerId);
    if (!timer) {
      console.warn(`性能监控: 未找到计时器 ${timerId}`);
      return null;
    }
    
    const endTime = performance.now();
    const duration = endTime - timer.startTime;
    
    const record = {
      id: timerId,
      label: timer.label,
      duration,
      startTime: timer.startTime,
      endTime,
      timestamp: Date.now(),
      metadata: { ...timer.metadata, ...additionalMetadata },
      severity: this.getSeverity(duration)
    };
    
    this.records.push(record);
    this.activeTimers.delete(timerId);
    
    // 实时输出警告
    this.logRecord(record);
    
    return record;
  }

  /**
   * 包装函数，自动监控执行时间
   */
  wrap(label, fn, metadata = {}) {
    if (!this.enabled) return fn;
    
    return async (...args) => {
      const timerId = this.start(label, metadata);
      try {
        const result = await fn(...args);
        this.end(timerId, { success: true });
        return result;
      } catch (error) {
        this.end(timerId, { success: false, error: error.message });
        throw error;
      }
    };
  }

  /**
   * 标记性能点（用于标记关键事件）
   */
  mark(label, metadata = {}) {
    if (!this.enabled) return;
    
    const record = {
      id: `mark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label: `[标记] ${label}`,
      duration: 0,
      timestamp: Date.now(),
      metadata,
      severity: 'info'
    };
    
    this.records.push(record);
    console.log(`🔖 性能标记: ${label}`, metadata);
  }

  /**
   * 获取严重程度
   */
  getSeverity(duration) {
    if (duration >= this.thresholds.critical) return 'critical';
    if (duration >= this.thresholds.severe) return 'severe';
    if (duration >= this.thresholds.warning) return 'warning';
    return 'normal';
  }

  /**
   * 记录日志
   */
  logRecord(record) {
    const icon = {
      critical: '🔴',
      severe: '🟠',
      warning: '🟡',
      normal: '✅'
    }[record.severity] || '✅';
    
    const color = {
      critical: 'color: red; font-weight: bold',
      severe: 'color: orange; font-weight: bold',
      warning: 'color: #ffa500',
      normal: 'color: green'
    }[record.severity] || 'color: green';
    
    console.log(
      `%c${icon} ${record.label}: ${record.duration.toFixed(2)}ms`,
      color,
      record.metadata
    );
    
    // 严重性能问题输出详细警告
    if (record.severity === 'critical' || record.severity === 'severe') {
      console.warn(`⚠️ 性能警告: ${record.label} 耗时 ${record.duration.toFixed(2)}ms`, record);
    }
  }

  /**
   * 获取性能摘要
   */
  getSummary() {
    if (this.records.length === 0) {
      return {
        totalRecords: 0,
        message: '暂无性能数据'
      };
    }
    
    const totalDuration = this.records.reduce((sum, r) => sum + r.duration, 0);
    const avgDuration = totalDuration / this.records.length;
    
    // 按标签分组统计
    const byLabel = {};
    this.records.forEach(record => {
      if (!byLabel[record.label]) {
        byLabel[record.label] = {
          label: record.label,
          count: 0,
          totalDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
          avgDuration: 0
        };
      }
      
      const stats = byLabel[record.label];
      stats.count++;
      stats.totalDuration += record.duration;
      stats.minDuration = Math.min(stats.minDuration, record.duration);
      stats.maxDuration = Math.max(stats.maxDuration, record.duration);
    });
    
    // 计算平均值
    Object.values(byLabel).forEach(stats => {
      stats.avgDuration = stats.totalDuration / stats.count;
    });
    
    // 找出最慢的操作
    const slowest = [...this.records]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);
    
    // 统计严重程度
    const severityCounts = {
      critical: this.records.filter(r => r.severity === 'critical').length,
      severe: this.records.filter(r => r.severity === 'severe').length,
      warning: this.records.filter(r => r.severity === 'warning').length,
      normal: this.records.filter(r => r.severity === 'normal').length
    };
    
    return {
      totalRecords: this.records.length,
      totalDuration,
      avgDuration,
      byLabel,
      slowest,
      severityCounts,
      timeRange: {
        start: this.records[0]?.timestamp,
        end: this.records[this.records.length - 1]?.timestamp
      }
    };
  }

  /**
   * 显示性能报告
   */
  showReport() {
    const summary = this.getSummary();
    
    console.group('📊 性能监控报告');
    console.log(`总记录数: ${summary.totalRecords}`);
    console.log(`总耗时: ${summary.totalDuration.toFixed(2)}ms`);
    console.log(`平均耗时: ${summary.avgDuration.toFixed(2)}ms`);
    
    if (summary.severityCounts) {
      console.group('严重程度统计');
      console.log(`🔴 极慢 (≥${this.thresholds.critical}ms): ${summary.severityCounts.critical}`);
      console.log(`🟠 严重 (≥${this.thresholds.severe}ms): ${summary.severityCounts.severe}`);
      console.log(`🟡 警告 (≥${this.thresholds.warning}ms): ${summary.severityCounts.warning}`);
      console.log(`✅ 正常 (<${this.thresholds.warning}ms): ${summary.severityCounts.normal}`);
      console.groupEnd();
    }
    
    if (summary.slowest && summary.slowest.length > 0) {
      console.group('🐌 最慢的 10 个操作');
      summary.slowest.forEach((record, index) => {
        const icon = {
          critical: '🔴',
          severe: '🟠',
          warning: '🟡',
          normal: '✅'
        }[record.severity] || '✅';
        
        console.log(
          `${index + 1}. ${icon} ${record.label}: ${record.duration.toFixed(2)}ms`,
          record.metadata
        );
      });
      console.groupEnd();
    }
    
    if (summary.byLabel) {
      console.group('📈 按操作类型统计');
      const sortedLabels = Object.values(summary.byLabel)
        .sort((a, b) => b.avgDuration - a.avgDuration);
      
      sortedLabels.forEach(stats => {
        console.log(
          `${stats.label}: 平均 ${stats.avgDuration.toFixed(2)}ms ` +
          `(最小 ${stats.minDuration.toFixed(2)}ms, 最大 ${stats.maxDuration.toFixed(2)}ms, 执行 ${stats.count} 次)`
        );
      });
      console.groupEnd();
    }
    
    console.groupEnd();
    
    return summary;
  }

  /**
   * 清除所有记录
   */
  clear() {
    this.records = [];
    this.activeTimers.clear();
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem('performance_monitor_data');
      } catch (e) {
        console.warn('清除性能数据失败:', e);
      }
    }
    console.log('✅ 性能数据已清除');
  }

  /**
   * 保存到本地存储
   */
  saveToLocalStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    
    try {
      const data = {
        records: this.records,
        timestamp: Date.now()
      };
      window.localStorage.setItem('performance_monitor_data', JSON.stringify(data));
    } catch (e) {
      console.warn('保存性能数据失败:', e);
    }
  }

  /**
   * 从本地存储加载
   */
  loadFromLocalStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    
    try {
      const data = window.localStorage.getItem('performance_monitor_data');
      if (data) {
        const parsed = JSON.parse(data);
        // 只保留最近 1 小时的数据
        const oneHourAgo = Date.now() - 3600000;
        this.records = (parsed.records || []).filter(r => r.timestamp > oneHourAgo);
      }
    } catch (e) {
      console.warn('加载性能数据失败:', e);
    }
  }

  /**
   * 导出为 JSON
   */
  exportJSON() {
    const data = {
      summary: this.getSummary(),
      records: this.records,
      exportTime: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('✅ 性能数据已导出为 JSON');
  }

  /**
   * 导出为 CSV
   */
  exportCSV() {
    const headers = ['标签', '耗时(ms)', '开始时间', '结束时间', '严重程度', '元数据'];
    const rows = this.records.map(record => [
      record.label,
      record.duration.toFixed(2),
      new Date(record.startTime + performance.timeOrigin).toISOString(),
      new Date(record.endTime + performance.timeOrigin).toISOString(),
      record.severity,
      JSON.stringify(record.metadata)
    ]);
    
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('✅ 性能数据已导出为 CSV');
  }

  /**
   * 导出为 HTML 报告
   */
  exportHTML() {
    const summary = this.getSummary();
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>性能监控报告</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
    h1 { color: #333; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
    .summary-card { background: #f8f9fa; padding: 15px; border-radius: 6px; }
    .summary-card h3 { margin: 0 0 10px 0; color: #666; font-size: 14px; }
    .summary-card .value { font-size: 24px; font-weight: bold; color: #333; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f8f9fa; font-weight: bold; }
    .critical { color: red; font-weight: bold; }
    .severe { color: orange; font-weight: bold; }
    .warning { color: #ffa500; }
    .normal { color: green; }
  </style>
</head>
<body>
  <div class="container">
    <h1>性能监控报告</h1>
    <p>生成时间: ${new Date().toLocaleString()}</p>
    
    <div class="summary">
      <div class="summary-card">
        <h3>总记录数</h3>
        <div class="value">${summary.totalRecords}</div>
      </div>
      <div class="summary-card">
        <h3>总耗时</h3>
        <div class="value">${summary.totalDuration.toFixed(2)}ms</div>
      </div>
      <div class="summary-card">
        <h3>平均耗时</h3>
        <div class="value">${summary.avgDuration.toFixed(2)}ms</div>
      </div>
    </div>
    
    <h2>最慢的操作</h2>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>耗时</th>
          <th>严重程度</th>
          <th>元数据</th>
        </tr>
      </thead>
      <tbody>
        ${summary.slowest.map(record => `
          <tr>
            <td>${record.label}</td>
            <td class="${record.severity}">${record.duration.toFixed(2)}ms</td>
            <td class="${record.severity}">${record.severity}</td>
            <td>${JSON.stringify(record.metadata)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    <h2>所有记录</h2>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>耗时</th>
          <th>严重程度</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        ${this.records.map(record => `
          <tr>
            <td>${record.label}</td>
            <td class="${record.severity}">${record.duration.toFixed(2)}ms</td>
            <td class="${record.severity}">${record.severity}</td>
            <td>${new Date(record.timestamp).toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>
    `;
    
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-report-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('✅ 性能数据已导出为 HTML');
  }

  /**
   * 获取所有记录
   */
  getRecords() {
    return [...this.records];
  }

  /**
   * 启用/禁用监控
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`性能监控已${enabled ? '启用' : '禁用'}`);
  }
}

// 创建全局实例
const performanceMonitor = new PerformanceMonitor();

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = performanceMonitor;
}

// 暴露到全局
if (typeof window !== 'undefined') {
  window.performanceMonitor = performanceMonitor;
}

export default performanceMonitor;

