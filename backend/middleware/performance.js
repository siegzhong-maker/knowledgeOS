/**
 * 性能监控中间件
 * 监控 API 响应时间和请求处理性能
 */

const performanceData = {
  requests: [],
  maxRecords: 1000, // 最多保存 1000 条记录
  enabled: process.env.NODE_ENV !== 'production' || process.env.ENABLE_PERF === '1'
};

/**
 * 性能监控中间件
 */
function performanceMiddleware(req, res, next) {
  if (!performanceData.enabled) {
    return next();
  }

  const startTime = Date.now();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // 记录请求开始
  const requestRecord = {
    id: requestId,
    method: req.method,
    path: req.path,
    url: req.originalUrl || req.url,
    query: req.query,
    startTime,
    timestamp: startTime
  };

  // 监听响应结束
  res.on('finish', () => {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const record = {
      ...requestRecord,
      endTime,
      duration,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      contentLength: res.get('content-length') || 0,
      severity: getSeverity(duration)
    };

    // 添加到记录列表
    performanceData.requests.push(record);
    
    // 限制记录数量
    if (performanceData.requests.length > performanceData.maxRecords) {
      performanceData.requests.shift();
    }

    // 输出慢请求警告
    if (duration >= 1000) {
      console.warn(
        `⚠️ 慢请求: ${req.method} ${req.path} - ${duration}ms (状态码: ${res.statusCode})`
      );
    } else if (duration >= 500) {
      console.log(
        `🟡 请求: ${req.method} ${req.path} - ${duration}ms`
      );
    }
  });

  next();
}

/**
 * 获取严重程度
 */
function getSeverity(duration) {
  if (duration >= 5000) return 'critical';
  if (duration >= 2000) return 'severe';
  if (duration >= 500) return 'warning';
  return 'normal';
}

/**
 * 获取性能摘要
 */
function getSummary() {
  const requests = performanceData.requests;
  
  if (requests.length === 0) {
    return {
      totalRequests: 0,
      message: '暂无性能数据'
    };
  }

  const totalDuration = requests.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / requests.length;

  // 按路径分组统计
  const byPath = {};
  requests.forEach(req => {
    const key = `${req.method} ${req.path}`;
    if (!byPath[key]) {
      byPath[key] = {
        method: req.method,
        path: req.path,
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
        statusCodes: {}
      };
    }

    const stats = byPath[key];
    stats.count++;
    stats.totalDuration += req.duration;
    stats.minDuration = Math.min(stats.minDuration, req.duration);
    stats.maxDuration = Math.max(stats.maxDuration, req.duration);
    
    // 统计状态码
    const statusCode = req.statusCode.toString();
    stats.statusCodes[statusCode] = (stats.statusCodes[statusCode] || 0) + 1;
  });

  // 计算平均值
  Object.values(byPath).forEach(stats => {
    stats.avgDuration = stats.totalDuration / stats.count;
  });

  // 找出最慢的请求
  const slowest = [...requests]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 20);

  // 统计严重程度
  const severityCounts = {
    critical: requests.filter(r => r.severity === 'critical').length,
    severe: requests.filter(r => r.severity === 'severe').length,
    warning: requests.filter(r => r.severity === 'warning').length,
    normal: requests.filter(r => r.severity === 'normal').length
  };

  // 统计状态码分布
  const statusCodeCounts = {};
  requests.forEach(req => {
    const code = req.statusCode.toString();
    statusCodeCounts[code] = (statusCodeCounts[code] || 0) + 1;
  });

  return {
    totalRequests: requests.length,
    totalDuration,
    avgDuration,
    byPath,
    slowest,
    severityCounts,
    statusCodeCounts,
    timeRange: {
      start: requests[0]?.timestamp,
      end: requests[requests.length - 1]?.timestamp
    }
  };
}

/**
 * 获取性能数据
 */
function getPerformanceData(limit = 100) {
  return performanceData.requests.slice(-limit);
}

/**
 * 清除性能数据
 */
function clearPerformanceData() {
  performanceData.requests = [];
  console.log('✅ 性能数据已清除');
}

/**
 * 启用/禁用性能监控
 */
function setEnabled(enabled) {
  performanceData.enabled = enabled;
  console.log(`性能监控已${enabled ? '启用' : '禁用'}`);
}

module.exports = {
  performanceMiddleware,
  getSummary,
  getPerformanceData,
  clearPerformanceData,
  setEnabled
};

