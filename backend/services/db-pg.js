const { Pool } = require('pg');
const dns = require('dns');

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
    const pattern = q.sql.replace(/\$\d+/g, '$?').substring(0, 100);
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

// 强制使用 IPv4 解析，避免 Railway 环境中的 DNS 解析问题
// Node.js 17.0.0+ 支持此 API
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
  console.log('[Database] DNS 配置: 强制使用 IPv4 优先解析');
}

class Database {
  constructor() {
    this._pool = null;
  }

  get pool() {
    return this._pool;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        // 从环境变量获取数据库连接字符串
        const connectionString = process.env.DATABASE_URL;
        
        if (!connectionString) {
          return reject(new Error('DATABASE_URL environment variable is required for PostgreSQL'));
        }

        // 调试日志：输出数据库连接信息（隐藏密码）
        try {
          const url = new URL(connectionString);
          const host = url.hostname;
          const port = url.port || '5432';
          const dbName = url.pathname.replace('/', '') || 'unknown';
          console.log(`[Database] 连接信息: ${url.protocol}//${url.username}@${host}:${port}/${dbName}`);
          console.log(`[Database] 数据库名称: ${dbName}`);
          
          // Railway 内部域名不需要 DNS 解析
          const isRailwayInternal = host.includes('railway.internal');
          const isSupabase = host.includes('supabase.co');
          const isAWS = host.includes('amazonaws.com');
          
          // 只对外部域名进行 DNS 解析（Railway 内部域名会失败）
          if (!isRailwayInternal) {
            // 尝试解析主机名，验证 DNS 解析结果（仅用于调试）
            dns.lookup(host, { family: 4, all: false }, (err, addresses) => {
              if (err) {
                // DNS 解析失败不影响连接，只记录警告
                console.warn(`[Database] DNS 解析警告: ${err.message} (不影响数据库连接)`);
              } else if (addresses) {
                // 安全地获取 IP 地址
                let ip = null;
                if (Array.isArray(addresses)) {
                  ip = addresses.length > 0 ? addresses[0].address : null;
                } else if (addresses && typeof addresses === 'object' && addresses.address) {
                  ip = addresses.address;
                } else if (typeof addresses === 'string') {
                  ip = addresses;
                }
                
                if (ip) {
                  console.log(`[Database] DNS 解析结果: ${host} -> ${ip}`);
                  // 检查是否是 IPv6 地址
                  if (ip.includes && ip.includes(':')) {
                    console.warn(`[Database] 警告: 解析到 IPv6 地址 ${ip}，可能存在问题`);
                  }
                }
              }
            });
          } else {
            console.log(`[Database] 使用 Railway 内部域名，跳过 DNS 解析`);
          }
        } catch (urlError) {
          // 如果 URL 解析失败，输出原始字符串的部分信息（隐藏密码）
          const maskedUrl = connectionString.replace(/:[^:@]+@/, ':****@');
          console.log(`[Database] 连接字符串: ${maskedUrl.substring(0, 100)}...`);
        }

        // 创建连接池，使用 IPv4 优先的 DNS 配置
        // Railway 内部连接不需要 SSL，外部连接（Supabase/AWS）需要 SSL
        const needsSSL = connectionString.includes('supabase') || connectionString.includes('amazonaws.com');
        this._pool = new Pool({
          connectionString: connectionString,
          ssl: needsSSL ? { rejectUnauthorized: false } : false
        });

        // 测试连接
        this._pool.query('SELECT NOW()', (err, result) => {
          if (err) {
            reject(err);
          } else {
            console.log('✓ 已连接到PostgreSQL数据库');
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this._pool) {
        this._pool.end((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // 将SQLite的?占位符转换为PostgreSQL的$1, $2格式
  convertPlaceholders(sql) {
    let paramIndex = 1;
    return sql.replace(/\?/g, () => `$${paramIndex++}`);
  }

  // 修复PostgreSQL布尔值查询：将 = 1 和 = 0 转换为 = true 和 = false
  fixBooleanQueries(sql) {
    // 修复 is_default = 1 和 is_default = 0
    sql = sql.replace(/\bis_default\s*=\s*1\b/gi, 'is_default = true');
    sql = sql.replace(/\bis_default\s*=\s*0\b/gi, 'is_default = false');
    // 修复 is_active = 1 和 is_active = 0
    sql = sql.replace(/\bis_active\s*=\s*1\b/gi, 'is_active = true');
    sql = sql.replace(/\bis_active\s*=\s*0\b/gi, 'is_active = false');
    // 修复 is_custom = 1 和 is_custom = 0（如果字段是布尔类型）
    sql = sql.replace(/\bis_custom\s*=\s*1\b/gi, 'is_custom = true');
    sql = sql.replace(/\bis_custom\s*=\s*0\b/gi, 'is_custom = false');
    return sql;
  }

  // 通用查询方法 - 返回单行（带性能监控）
  async get(sql, params = []) {
    const startTime = Date.now();
    try {
      let convertedSql = this.convertPlaceholders(sql);
      convertedSql = this.fixBooleanQueries(convertedSql);
      const result = await this._pool.query(convertedSql, params);
      const duration = Date.now() - startTime;
      const resultSize = result.rows[0] ? JSON.stringify(result.rows[0]).length : 0;
      recordQuery(sql, params, duration, resultSize);
      return result.rows[0] || null;
    } catch (error) {
      const duration = Date.now() - startTime;
      recordQuery(sql, params, duration, 0);
      console.error('Database get error:', error);
      throw error;
    }
  }

  // 通用查询方法 - 返回多行（带性能监控）
  async all(sql, params = []) {
    const startTime = Date.now();
    try {
      let convertedSql = this.convertPlaceholders(sql);
      convertedSql = this.fixBooleanQueries(convertedSql);
      const result = await this._pool.query(convertedSql, params);
      const duration = Date.now() - startTime;
      const resultSize = result.rows ? JSON.stringify(result.rows).length : 0;
      recordQuery(sql, params, duration, resultSize);
      return result.rows || [];
    } catch (error) {
      const duration = Date.now() - startTime;
      recordQuery(sql, params, duration, 0);
      console.error('Database all error:', error);
      throw error;
    }
  }

  // 执行SQL语句（INSERT, UPDATE, DELETE）（带性能监控）
  async run(sql, params = []) {
    const startTime = Date.now();
    try {
      let convertedSql = this.convertPlaceholders(sql);
      convertedSql = this.fixBooleanQueries(convertedSql);
      
      // 处理布尔值参数：将整数 0/1 转换为布尔值 true/false
      const convertedParams = params.map(param => {
        // 如果参数是数字 0 或 1，且 SQL 中包含布尔字段，则转换为布尔值
        // 这里简化处理：对于 is_default, is_active, is_custom 字段的值进行转换
        if (typeof param === 'number' && (param === 0 || param === 1)) {
          // 检查 SQL 中是否包含这些布尔字段名
          const sqlLower = sql.toLowerCase();
          if (sqlLower.includes('is_default') || sqlLower.includes('is_active')) {
            return param === 1;
          }
        }
        return param;
      });
      
      const result = await this._pool.query(convertedSql, convertedParams);
      const duration = Date.now() - startTime;
      recordQuery(sql, params, duration, 0);
      
      // 返回与SQLite兼容的格式
      return {
        lastID: result.rows[0]?.id || null, // 如果有RETURNING id，则获取
        changes: result.rowCount || 0
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      recordQuery(sql, params, duration, 0);
      console.error('Database run error:', error);
      throw error;
    }
  }

  // 获取查询性能数据
  getQueryPerformance() {
    return {
      queries: queryPerformance.queries,
      summary: getQuerySummary()
    };
  }
}

// 单例模式
const db = new Database();

module.exports = db;

