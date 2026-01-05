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

// 文件系统诊断端点
app.get('/api/diagnose/files', async (req, res) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const db = require('./services/db');
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: {
        NODE_ENV: process.env.NODE_ENV || '未设置',
        UPLOADS_PATH: process.env.UPLOADS_PATH || '未设置',
        PORT: process.env.PORT || '未设置',
        DATABASE_URL: process.env.DATABASE_URL ? '已设置' : '未设置'
      },
      uploadsDirectory: {
        path: null,
        exists: false,
        accessible: false,
        writable: false,
        fileCount: 0,
        files: [],
        error: null
      },
      database: {
        connected: false,
        pdfCount: 0,
        pdfFiles: [],
        error: null
      },
      recommendations: []
    };
    
    // 计算上传目录路径
    const uploadsDir = process.env.UPLOADS_PATH || 
                       (process.env.NODE_ENV === 'production' ? '/data/uploads' : path.resolve(__dirname, 'uploads'));
    diagnostics.uploadsDirectory.path = uploadsDir;
    
    // 检查上传目录
    try {
      await fs.access(uploadsDir);
      diagnostics.uploadsDirectory.exists = true;
      diagnostics.uploadsDirectory.accessible = true;
      
      // 尝试读取目录内容
      try {
        const files = await fs.readdir(uploadsDir);
        diagnostics.uploadsDirectory.fileCount = files.length;
        diagnostics.uploadsDirectory.files = files.slice(0, 20); // 只返回前20个文件
        
        // 检查目录是否可写
        try {
          const testFile = path.join(uploadsDir, '.test-write-' + Date.now());
          await fs.writeFile(testFile, 'test');
          await fs.unlink(testFile);
          diagnostics.uploadsDirectory.writable = true;
        } catch (writeErr) {
          diagnostics.uploadsDirectory.writable = false;
          diagnostics.recommendations.push('上传目录不可写，请检查目录权限');
        }
      } catch (readErr) {
        diagnostics.uploadsDirectory.error = `无法读取目录内容: ${readErr.message}`;
      }
    } catch (accessErr) {
      diagnostics.uploadsDirectory.exists = false;
      diagnostics.uploadsDirectory.error = `目录不存在或不可访问: ${accessErr.message}`;
      
      if (process.env.NODE_ENV === 'production') {
        diagnostics.recommendations.push('⚠️ 生产环境中 /data/uploads 目录不存在。请检查 Railway Volume 是否已配置并挂载到 /data/uploads');
      } else {
        diagnostics.recommendations.push('上传目录不存在，应用会自动创建');
      }
    }
    
    // 检查数据库中的PDF文件
    try {
      const pdfItems = await db.all(
        'SELECT id, title, file_path, created_at FROM source_items WHERE type = ? ORDER BY created_at DESC LIMIT 10',
        ['pdf']
      );
      diagnostics.database.connected = true;
      diagnostics.database.pdfCount = pdfItems.length;
      diagnostics.database.pdfFiles = pdfItems.map(item => {
        // 安全地处理时间戳：PostgreSQL 返回的 created_at 是 BIGINT（时间戳）
        let createdAt = null;
        if (item.created_at) {
          try {
            // 如果是数字（时间戳），直接转换
            const timestamp = typeof item.created_at === 'number' 
              ? item.created_at 
              : parseInt(item.created_at, 10);
            if (!isNaN(timestamp) && timestamp > 0) {
              createdAt = new Date(timestamp).toISOString();
            }
          } catch (e) {
            // 如果转换失败，使用原始值
            createdAt = item.created_at.toString();
          }
        }
        return {
          id: item.id,
          title: item.title,
          file_path: item.file_path,
          created_at: createdAt
        };
      });
      
      // 检查文件是否真的存在
      if (diagnostics.uploadsDirectory.accessible && pdfItems.length > 0) {
        const missingFiles = [];
        for (const item of pdfItems.slice(0, 5)) { // 只检查前5个
          if (item.file_path) {
            try {
              const filePath = path.isAbsolute(item.file_path) 
                ? item.file_path 
                : path.join(uploadsDir, item.file_path);
              await fs.access(filePath);
            } catch (fileErr) {
              missingFiles.push({
                id: item.id,
                title: item.title,
                file_path: item.file_path
              });
            }
          }
        }
        if (missingFiles.length > 0) {
          diagnostics.recommendations.push(`⚠️ 发现 ${missingFiles.length} 个PDF文件记录，但物理文件不存在。可能原因：Volume未配置、文件已删除或路径不匹配`);
        }
      }
    } catch (dbErr) {
      diagnostics.database.error = `数据库查询失败: ${dbErr.message}`;
      diagnostics.recommendations.push('无法查询数据库，请检查数据库连接');
    }
    
    // 生成建议
    if (process.env.NODE_ENV === 'production' && !diagnostics.uploadsDirectory.exists) {
      diagnostics.recommendations.push('🚨 重要：生产环境中需要配置 Railway Volume');
      diagnostics.recommendations.push('   1. 在Railway服务页面点击"Settings"');
      diagnostics.recommendations.push('   2. 找到"Volumes"部分');
      diagnostics.recommendations.push('   3. 点击"+ New Volume"');
      diagnostics.recommendations.push('   4. Mount Path: /data/uploads');
      diagnostics.recommendations.push('   5. 保存并重新部署');
    }
    
    if (process.env.NODE_ENV !== 'production' && !diagnostics.uploadsDirectory.exists) {
      diagnostics.recommendations.push('开发环境：上传目录将自动创建');
    }
    
    if (diagnostics.database.pdfCount > 0 && !diagnostics.uploadsDirectory.accessible) {
      diagnostics.recommendations.push('⚠️ 数据库中有PDF文件记录，但上传目录不可访问。这些文件可能已丢失，需要重新上传');
    }
    
    res.json({
      success: true,
      data: diagnostics
    });
  } catch (error) {
    console.error('诊断失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '诊断失败',
      error: error.stack
    });
  }
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
    // 检查上传目录
    const uploadsDir = process.env.UPLOADS_PATH || 
                       (process.env.NODE_ENV === 'production' ? '/data/uploads' : path.join(__dirname, 'uploads'));
    try {
      const fs = require('fs').promises;
      await fs.mkdir(uploadsDir, { recursive: true });
      console.log(`✓ 上传目录已准备: ${uploadsDir}`);
      
      // 检查Volume挂载（生产环境）
      if (process.env.NODE_ENV === 'production') {
        try {
          const stats = await fs.stat(uploadsDir);
          console.log(`✓ Volume挂载检查: ${uploadsDir} 可访问`);
          
          // 列出目录中的文件数量（用于诊断）
          try {
            const files = await fs.readdir(uploadsDir);
            console.log(`✓ Volume文件检查: 发现 ${files.length} 个文件/目录`);
          } catch (readErr) {
            console.warn('读取上传目录内容失败:', readErr.message);
          }
        } catch (statErr) {
          console.error(`⚠️  Volume挂载警告: ${uploadsDir} 可能未正确挂载`);
          console.error('   请检查Railway Volume配置，挂载路径应为: /data/uploads');
        }
      }
    } catch (error) {
      console.warn('上传目录检查失败（可能不影响功能）:', error.message);
    }

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

