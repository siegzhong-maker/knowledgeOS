const db = require('../services/db-pg');
const { v4: uuidv4 } = require('uuid');

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
        module_id TEXT,
        knowledge_extracted BOOLEAN DEFAULT FALSE
      )
    `);
    console.log('✓ source_items表已创建');

    // 为source_items表添加可选字段（使用健壮的检查方法）
    console.log('检查并添加可选字段...');
    const optionalFields = [
      { name: 'file_path', def: 'TEXT' },
      { name: 'page_count', def: 'INTEGER' },
      { name: 'page_content', def: 'TEXT' },
      { name: 'knowledge_base_id', def: 'TEXT' },
      { name: 'module_id', def: 'TEXT' },
      { name: 'metadata', def: 'TEXT' },
      { name: 'knowledge_extracted', def: 'BOOLEAN DEFAULT FALSE' }
    ];

    for (const field of optionalFields) {
      try {
        const check = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'source_items'
          AND column_name = $1
        `, [field.name]);
        
        if (check.rows.length === 0) {
          await client.query(`ALTER TABLE source_items ADD COLUMN ${field.name} ${field.def}`);
          console.log(`   ✓ ${field.name} 字段已添加`);
        } else {
          console.log(`   ✓ ${field.name} 字段已存在，跳过`);
        }
      } catch (err) {
        console.warn(`   ⚠️  添加 ${field.name} 字段时出现警告:`, err.message);
      }
    }

    // 初始化 knowledge_extracted 字段：标记已有知识点的文档为已提取
    try {
      const updateResult = await client.query(`
        UPDATE source_items
        SET knowledge_extracted = TRUE
        WHERE id IN (
          SELECT DISTINCT source_item_id 
          FROM personal_knowledge_items 
          WHERE source_item_id IS NOT NULL
        )
        AND (knowledge_extracted IS NULL OR knowledge_extracted = FALSE)
      `);
      
      if (updateResult.rowCount > 0) {
        console.log(`   ✓ 已将 ${updateResult.rowCount} 个已有知识点的文档标记为已提取`);
      }
    } catch (err) {
      // personal_knowledge_items 表可能不存在，忽略错误
      if (!err.message.includes('does not exist') && !err.message.includes('relation') && !err.message.includes('不存在')) {
        console.warn('   初始化 knowledge_extracted 字段时出现警告:', err.message);
      }
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

    // personal_knowledge_items 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS personal_knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        key_conclusions TEXT DEFAULT '[]',
        source_item_id TEXT,
        source_page INTEGER,
        source_excerpt TEXT,
        confidence_score REAL DEFAULT 0,
        status TEXT DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'pending', 'archived')),
        category TEXT,
        tags TEXT DEFAULT '[]',
        knowledge_base_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        metadata TEXT
      )
    `);
    console.log('✓ personal_knowledge_items表已创建');

    // knowledge_relations 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        source_knowledge_id TEXT NOT NULL,
        target_knowledge_id TEXT NOT NULL,
        relation_type TEXT DEFAULT 'related' CHECK(relation_type IN ('related', 'similar', 'derived')),
        similarity_score REAL DEFAULT 0,
        created_at BIGINT NOT NULL
      )
    `);
    console.log('✓ knowledge_relations表已创建');

    // category_subcategories 表
    await client.query(`
      CREATE TABLE IF NOT EXISTS category_subcategories (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK(category IN ('work', 'learning', 'leisure', 'life')),
        name TEXT NOT NULL,
        keywords TEXT DEFAULT '[]',
        order_index INTEGER DEFAULT 0,
        is_custom INTEGER DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(category, name)
      )
    `);
    console.log('✓ category_subcategories表已创建');

    // 为personal_knowledge_items表添加subcategory_id字段
    try {
      await client.query(`ALTER TABLE personal_knowledge_items ADD COLUMN IF NOT EXISTS subcategory_id TEXT`);
    } catch (err) {
      console.warn('添加subcategory_id字段时出现警告（可忽略）:', err.message);
    }

    // 创建索引（性能优化）
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_type ON source_items(type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_status ON source_items(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_created_at ON source_items(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_knowledge_base_id ON source_items(knowledge_base_id)`);
    // 添加更多索引以优化查询性能
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_title ON source_items(title)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_type_status ON source_items(type, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_items_updated_at ON source_items(updated_at DESC)`);
    // knowledge_extracted 字段索引（用于筛选优化）
    await client.query(`CREATE INDEX IF NOT EXISTS idx_source_items_knowledge_extracted ON source_items(knowledge_extracted)`);
    
    // personal_knowledge_items 表索引
    await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_knowledge_base_id ON personal_knowledge_items(knowledge_base_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_item_id ON personal_knowledge_items(source_item_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON personal_knowledge_items(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON personal_knowledge_items(created_at DESC)`);
    
    // knowledge_relations 表索引
    await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source ON knowledge_relations(source_knowledge_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target ON knowledge_relations(target_knowledge_id)`);
    
    // category_subcategories 表索引
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subcategories_category ON category_subcategories(category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subcategories_order ON category_subcategories(category, order_index)`);
    
    // personal_knowledge_items 表索引（subcategory_id）
    await client.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_subcategory ON personal_knowledge_items(subcategory_id)`);
    
    // settings 表索引（优化查询性能）
    await client.query(`CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)`);
    // 为搜索优化：创建文本搜索索引（如果PostgreSQL支持）
    try {
      // 尝试创建GIN索引用于全文搜索（需要pg_trgm扩展）
      await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_items_title_trgm ON source_items USING gin(title gin_trgm_ops)`);
      console.log('✓ 全文搜索索引已创建');
    } catch (err) {
      // 如果扩展不可用，忽略错误（不影响基本功能）
      console.log('⚠️  全文搜索索引创建失败（可忽略）:', err.message);
    }
    console.log('✓ 索引已创建');

    // 插入预设子分类数据
    const presetSubcategories = [
      // 工作 (work)
      { category: 'work', name: '项目管理', keywords: JSON.stringify(['项目', '计划', '执行', '进度', '里程碑', '任务', '团队协作']), order_index: 0 },
      { category: 'work', name: '业务分析', keywords: JSON.stringify(['数据', '分析', '报告', '指标', '趋势', '洞察', '决策']), order_index: 1 },
      { category: 'work', name: '团队管理', keywords: JSON.stringify(['团队', '领导', '沟通', '协调', '激励', '绩效', '发展']), order_index: 2 },
      { category: 'work', name: '产品运营', keywords: JSON.stringify(['产品', '用户', '市场', '运营', '推广', '增长', '优化']), order_index: 3 },
      // 学习 (learning)
      { category: 'learning', name: '技能提升', keywords: JSON.stringify(['技能', '能力', '方法', '技巧', '实践', '练习', '掌握']), order_index: 0 },
      { category: 'learning', name: '知识体系', keywords: JSON.stringify(['知识', '理论', '概念', '原理', '框架', '体系', '结构']), order_index: 1 },
      { category: 'learning', name: '阅读笔记', keywords: JSON.stringify(['阅读', '笔记', '总结', '思考', '启发', '感悟', '应用']), order_index: 2 },
      { category: 'learning', name: '学术研究', keywords: JSON.stringify(['研究', '学术', '论文', '实验', '数据', '分析', '结论']), order_index: 3 },
      // 娱乐 (leisure)
      { category: 'leisure', name: '影视音乐', keywords: JSON.stringify(['电影', '音乐', '剧集', '综艺', '娱乐', '欣赏', '推荐']), order_index: 0 },
      { category: 'leisure', name: '旅行探索', keywords: JSON.stringify(['旅行', '旅游', '景点', '攻略', '体验', '探索', '发现']), order_index: 1 },
      { category: 'leisure', name: '运动健身', keywords: JSON.stringify(['运动', '健身', '锻炼', '健康', '训练', '计划', '目标']), order_index: 2 },
      { category: 'leisure', name: '兴趣爱好', keywords: JSON.stringify(['兴趣', '爱好', '收藏', '创作', '分享', '交流', '社区']), order_index: 3 },
      // 生活 (life)
      { category: 'life', name: '健康养生', keywords: JSON.stringify(['健康', '养生', '医疗', '饮食', '作息', '运动', '调理']), order_index: 0 },
      { category: 'life', name: '理财投资', keywords: JSON.stringify(['理财', '投资', '资产', '规划', '风险', '收益', '策略']), order_index: 1 },
      { category: 'life', name: '家庭情感', keywords: JSON.stringify(['家庭', '情感', '亲情', '爱情', '友情', '相处', '沟通']), order_index: 2 },
      { category: 'life', name: '生活技巧', keywords: JSON.stringify(['生活', '技巧', '方法', '经验', '整理', '收纳', '优化']), order_index: 3 }
    ];

    const now = Date.now();
    for (const subcat of presetSubcategories) {
      try {
        const id = `subcat-${uuidv4()}`;
        await client.query(`
          INSERT INTO category_subcategories (id, category, name, keywords, order_index, is_custom, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
          ON CONFLICT (category, name) DO NOTHING
        `, [id, subcat.category, subcat.name, subcat.keywords, subcat.order_index, now, now]);
      } catch (err) {
        // 忽略重复插入错误
        if (!err.message.includes('duplicate') && !err.message.includes('UNIQUE')) {
          console.warn(`插入子分类 ${subcat.name} 时出现警告:`, err.message);
        }
      }
    }
    console.log('✓ 预设子分类数据已插入');

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

