// 根据环境变量选择数据库类型（SQLite 或 PostgreSQL）
const DATABASE_URL = process.env.DATABASE_URL;
const DB_TYPE = process.env.DB_TYPE;

// 如果设置了 DATABASE_URL，使用 PostgreSQL
if (DATABASE_URL || DB_TYPE === 'postgres') {
  module.exports = require('./db-pg');
} else {
  // 否则使用 SQLite（向后兼容）
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const fs = require('fs');

  // 支持环境变量配置数据库路径（Railway部署时使用）
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../database/knowledge.db');

  // 确保数据库目录存在
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // 数据库查询性能监控
  const queryPerformance = {
    queries: [],
    maxRecords: 500,
    enabled: process.env.NODE_ENV !== 'production' || process.env.ENABLE_PERF === '1'
  };

  // 记录查询性能
  function recordQuery(sql, params, duration, resultSize) {
    if (!queryPerformance.enabled) return;
    
    const record = {
      sql: sql.substring(0, 200), // 限制 SQL 长度
      params: Array.isArray(params) ? params.slice(0, 5) : params, // 限制参数数量
      duration,
      resultSize,
      timestamp: Date.now(),
      severity: getQuerySeverity(duration)
    };

    queryPerformance.queries.push(record);
    
    // 限制记录数量
    if (queryPerformance.queries.length > queryPerformance.maxRecords) {
      queryPerformance.queries.shift();
    }

    // 输出慢查询警告
    if (duration >= 100) {
      console.warn(`⚠️ 慢查询 (${duration}ms): ${sql.substring(0, 100)}...`);
    }
  }

  function getQuerySeverity(duration) {
    if (duration >= 1000) return 'critical';
    if (duration >= 500) return 'severe';
    if (duration >= 100) return 'warning';
    return 'normal';
  }

  class Database {
    constructor() {
      this.db = null;
    }

    connect() {
      return new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log('✓ 已连接到SQLite数据库');
            resolve();
          }
        });
      });
    }

    close() {
      return new Promise((resolve, reject) => {
        if (this.db) {
          this.db.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    }

    // 通用查询方法（带性能监控）
    get(sql, params = []) {
      const startTime = Date.now();
      return new Promise((resolve, reject) => {
        this.db.get(sql, params, (err, row) => {
          const duration = Date.now() - startTime;
          if (err) {
            reject(err);
          } else {
            const resultSize = row ? JSON.stringify(row).length : 0;
            recordQuery(sql, params, duration, resultSize);
            resolve(row);
          }
        });
      });
    }

    all(sql, params = []) {
      const startTime = Date.now();
      return new Promise((resolve, reject) => {
        this.db.all(sql, params, (err, rows) => {
          const duration = Date.now() - startTime;
          if (err) {
            reject(err);
          } else {
            const resultSize = rows ? JSON.stringify(rows).length : 0;
            recordQuery(sql, params, duration, resultSize);
            resolve(rows || []);
          }
        });
      });
    }

    run(sql, params = []) {
      const startTime = Date.now();
      return new Promise((resolve, reject) => {
        this.db.run(sql, params, function(err) {
          const duration = Date.now() - startTime;
          if (err) {
            reject(err);
          } else {
            recordQuery(sql, params, duration, 0);
            resolve({ lastID: this.lastID, changes: this.changes });
          }
        });
      });
    }

    // 获取查询性能数据
    getQueryPerformance() {
      return {
        queries: queryPerformance.queries,
        summary: getQuerySummary()
      };
    }
  }

  // 获取查询性能摘要
  function getQuerySummary() {
    const queries = queryPerformance.queries;
    if (queries.length === 0) {
      return { totalQueries: 0, message: '暂无查询数据' };
    }

    const totalDuration = queries.reduce((sum, q) => sum + q.duration, 0);
    const avgDuration = totalDuration / queries.length;

    // 按 SQL 模式分组（简化 SQL，移除具体参数值）
    const byPattern = {};
    queries.forEach(q => {
      // 简化 SQL，移除参数值，用于分组
      const pattern = q.sql.replace(/\?/g, '?').substring(0, 100);
      if (!byPattern[pattern]) {
        byPattern[pattern] = {
          pattern,
          count: 0,
          totalDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
          avgDuration: 0
        };
      }

      const stats = byPattern[pattern];
      stats.count++;
      stats.totalDuration += q.duration;
      stats.minDuration = Math.min(stats.minDuration, q.duration);
      stats.maxDuration = Math.max(stats.maxDuration, q.duration);
    });

    Object.values(byPattern).forEach(stats => {
      stats.avgDuration = stats.totalDuration / stats.count;
    });

    // 找出最慢的查询
    const slowest = [...queries]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 20);

    const severityCounts = {
      critical: queries.filter(q => q.severity === 'critical').length,
      severe: queries.filter(q => q.severity === 'severe').length,
      warning: queries.filter(q => q.severity === 'warning').length,
      normal: queries.filter(q => q.severity === 'normal').length
    };

    return {
      totalQueries: queries.length,
      totalDuration,
      avgDuration,
      byPattern,
      slowest,
      severityCounts
    };
  }

  // 单例模式
  const db = new Database();
  module.exports = db;
}

