const db = require('../services/db-pg');

async function initDatabase() {
  try {
    // 连接数据库
    await db.connect();

    // 使用 db.pool getter 访问连接池
    const client = db.pool;
    if (!client) {
      throw new Error('Database pool not initialized');
    }
    
    // 创建表
    console.log('开始创建PostgreSQL表...\n');

    // source_items 表
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

    // 为source_items表添加可选字段（如果不存在）
    try {
      await client.query(`ALTER TABLE source_items ADD COLUMN IF NOT EXISTS file_path TEXT`);
      await client.query(`ALTER TABLE source_items ADD COLUMN IF NOT EXISTS page_count INTEGER`);
      await client.query(`ALTER TABLE source_items ADD COLUMN IF NOT EXISTS page_content TEXT`);
      await client.query(`ALTER TABLE source_items ADD COLUMN IF NOT EXISTS knowledge_base_id TEXT`);
      await client.query(`ALTER TABLE source_items ADD COLUMN IF NOT EXISTS module_id TEXT`);
      await client.query(`ALTER TABLE source_items ADD COLUMN IF NOT EXISTS metadata TEXT`);
    } catch (err) {
      // 字段可能已存在，忽略错误
      console.warn('添加字段时出现警告（可忽略）:', err.message);
    }

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

    console.log('\n✓ PostgreSQL数据库初始化完成');
    
    // 关闭连接
    await db.close();
    process.exit(0);
  } catch (error) {
    console.error('数据库初始化失败:', error);
    await db.close();
    process.exit(1);
  }
}

initDatabase();

