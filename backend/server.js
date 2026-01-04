const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS配置 - 允许移动端和Web端访问
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*', // 生产环境建议设置具体域名
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// 中间件
app.use(cors(corsOptions));
// 增加 JSON body 大小限制（用于数据迁移）
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务（前端）
app.use(express.static(path.join(__dirname, '../frontend')));

// 路由
app.use('/api/items', require('./routes/items'));
app.use('/api/parse', require('./routes/parse'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/export', require('./routes/export'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/consultation', require('./routes/consultation'));
app.use('/api/contexts', require('./routes/context'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/knowledge-bases', require('./routes/knowledge-bases'));
app.use('/api/files', require('./routes/files'));
app.use('/api/migrate', require('./routes/migrate'));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '服务运行正常' });
});

// 404处理 - API路由未找到（必须在所有API路由之后）
app.use('/api/*', (req, res) => {
  // 记录未匹配的路由，用于调试
  console.log(`[404] 未匹配的API路由: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    success: false, 
    message: `API端点 ${req.method} ${req.path} 不存在` 
  });
});

// 404处理 - 前端路由（SPA支持）
app.get('*', (req, res) => {
  // 如果是API请求，已经在上面的中间件处理了
  // 这里只处理前端路由，返回index.html
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// 检查并初始化数据库表
async function ensureDatabaseInitialized() {
  try {
    // 检查是PostgreSQL还是SQLite
    const isPostgreSQL = !!db.pool;
    
    if (!isPostgreSQL) {
      // SQLite数据库：表初始化已经在init-db.js中完成，这里跳过
      console.log('✓ 使用SQLite数据库，表初始化已在init-db.js中完成');
      return;
    }

    // PostgreSQL数据库：检查表是否存在
    const client = db.pool;
    if (!client) {
      throw new Error('Database pool not initialized');
    }

    // 检查 source_items 表是否存在
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'source_items'
      )
    `);
    
    const tableExists = result.rows[0]?.exists || false;
    
    if (!tableExists) {
      console.log('检测到数据库表不存在，开始初始化数据库...');
      
      // 创建表
      await client.query(`
        CREATE TABLE IF NOT EXISTS source_items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('text', 'link', 'memo', 'pdf')),
          title TEXT NOT NULL,
          raw_content TEXT,
          original_url TEXT,
          summary_ai TEXT,
          source TEXT,
          tags TEXT DEFAULT '[]',
          file_path TEXT,
          page_count INTEGER,
          page_content TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'archived')),
          knowledge_base_id TEXT,
          module_id TEXT
        )
      `);
      console.log('✓ source_items表已创建');

      // tags 表
      await client.query(`
        CREATE TABLE IF NOT EXISTS tags (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          color TEXT DEFAULT '#6366f1',
          count INTEGER DEFAULT 0,
          created_at BIGINT NOT NULL
        )
      `);
      console.log('✓ tags表已创建');

      // settings 表
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      console.log('✓ settings表已创建');

      // user_contexts 表
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_contexts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          context_data TEXT NOT NULL,
          is_active BOOLEAN DEFAULT FALSE,
          created_at BIGINT NOT NULL
        )
      `);
      console.log('✓ user_contexts表已创建');

      // knowledge_bases 表
      await client.query(`
        CREATE TABLE IF NOT EXISTS knowledge_bases (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT DEFAULT 'book',
          color TEXT DEFAULT '#6366f1',
          is_default BOOLEAN DEFAULT FALSE,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);
      console.log('✓ knowledge_bases表已创建');

      // modules 表
      await client.query(`
        CREATE TABLE IF NOT EXISTS modules (
          id TEXT PRIMARY KEY,
          knowledge_base_id TEXT NOT NULL,
          step_number INTEGER NOT NULL,
          step_name TEXT NOT NULL,
          checkpoint_number INTEGER,
          checkpoint_name TEXT,
          description TEXT,
          order_index INTEGER NOT NULL,
          created_at BIGINT NOT NULL
        )
      `);
      console.log('✓ modules表已创建');

      // 创建索引
      await client.query(`CREATE INDEX IF NOT EXISTS idx_items_type ON source_items(type)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_items_status ON source_items(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_items_created_at ON source_items(created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_items_knowledge_base_id ON source_items(knowledge_base_id)`);
      console.log('✓ 索引已创建');

      console.log('✓ PostgreSQL数据库初始化完成');
    } else {
      console.log('✓ 数据库表已存在，跳过初始化');
    }
  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw error;
  }
}

// 启动服务器
async function startServer() {
  try {
    // 连接数据库
    await db.connect();
    console.log('✓ 数据库连接成功');

    // 检查并初始化数据库表
    await ensureDatabaseInitialized();

    // 启动HTTP服务器
    app.listen(PORT, () => {
      console.log(`✓ 服务器运行在 http://localhost:${PORT}`);
      console.log(`✓ 前端访问: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('启动服务器失败:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n正在关闭服务器...');
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n正在关闭服务器...');
  await db.close();
  process.exit(0);
});

startServer();

