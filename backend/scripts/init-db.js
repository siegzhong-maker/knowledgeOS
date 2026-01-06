// 检查是否使用PostgreSQL
const DATABASE_URL = process.env.DATABASE_URL;
const DB_TYPE = process.env.DB_TYPE;

if (DATABASE_URL || DB_TYPE === 'postgres') {
  // 使用PostgreSQL初始化
  console.log('检测到PostgreSQL配置，使用PostgreSQL初始化脚本...');
  require('./init-db-pg');
  process.exit(0);
}

// 使用SQLite初始化（向后兼容）
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

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
    process.exit(1);
  }
  console.log('已连接到SQLite数据库');
});

// 创建表
db.serialize(() => {
  // source_items 表 - 扩展支持PDF类型
  db.run(`
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'archived'))
    )
  `, (err) => {
    if (err) {
      console.error('创建source_items表失败:', err.message);
    } else {
      console.log('✓ source_items表已创建');
    }
  });

  // 为现有表添加新字段（如果不存在）
  db.run(`ALTER TABLE source_items ADD COLUMN file_path TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加file_path字段失败:', err.message);
    }
  });
  db.run(`ALTER TABLE source_items ADD COLUMN page_count INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加page_count字段失败:', err.message);
    }
  });
  db.run(`ALTER TABLE source_items ADD COLUMN page_content TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加page_content字段失败:', err.message);
    }
  });

  // tags 表
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#6366f1',
      count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('创建tags表失败:', err.message);
    } else {
      console.log('✓ tags表已创建');
    }
  });

  // settings 表
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('创建settings表失败:', err.message);
    } else {
      console.log('✓ settings表已创建');
    }
  });

  // user_contexts 表 - 用户背景档案
  db.run(`
    CREATE TABLE IF NOT EXISTS user_contexts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      context_data TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('创建user_contexts表失败:', err.message);
    } else {
      console.log('✓ user_contexts表已创建');
    }
  });

  // personal_knowledge_items 表
  db.run(`
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT
    )
  `, (err) => {
    if (err) {
      console.error('创建personal_knowledge_items表失败:', err.message);
    } else {
      console.log('✓ personal_knowledge_items表已创建');
    }
  });

  // knowledge_relations 表
  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_relations (
      id TEXT PRIMARY KEY,
      source_knowledge_id TEXT NOT NULL,
      target_knowledge_id TEXT NOT NULL,
      relation_type TEXT DEFAULT 'related' CHECK(relation_type IN ('related', 'similar', 'derived')),
      similarity_score REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('创建knowledge_relations表失败:', err.message);
    } else {
      console.log('✓ knowledge_relations表已创建');
    }
  });

  // category_subcategories 表
  db.run(`
    CREATE TABLE IF NOT EXISTS category_subcategories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('work', 'learning', 'leisure', 'life')),
      name TEXT NOT NULL,
      keywords TEXT DEFAULT '[]',
      order_index INTEGER DEFAULT 0,
      is_custom INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(category, name)
    )
  `, (err) => {
    if (err) {
      console.error('创建category_subcategories表失败:', err.message);
    } else {
      console.log('✓ category_subcategories表已创建');
    }
  });

  // 为personal_knowledge_items表添加subcategory_id字段
  db.run(`ALTER TABLE personal_knowledge_items ADD COLUMN subcategory_id TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加subcategory_id字段失败:', err.message);
    }
  });

  // 创建索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_items_type ON source_items(type)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_items_status ON source_items(status)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_items_created_at ON source_items(created_at DESC)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });

  // personal_knowledge_items 表索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_knowledge_base_id ON personal_knowledge_items(knowledge_base_id)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_item_id ON personal_knowledge_items(source_item_id)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON personal_knowledge_items(status)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON personal_knowledge_items(created_at DESC)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });

  // knowledge_relations 表索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source ON knowledge_relations(source_knowledge_id)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target ON knowledge_relations(target_knowledge_id)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });

  // category_subcategories 表索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_subcategories_category ON category_subcategories(category)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_subcategories_order ON category_subcategories(category, order_index)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });

  // personal_knowledge_items 表索引（subcategory_id）
  db.run(`CREATE INDEX IF NOT EXISTS idx_knowledge_items_subcategory ON personal_knowledge_items(subcategory_id)`, (err) => {
    if (err) console.error('创建索引失败:', err.message);
  });

  // 插入预设子分类数据
  const { v4: uuidv4 } = require('uuid');
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
  presetSubcategories.forEach((subcat) => {
    const id = `subcat-${uuidv4()}`;
    db.run(`
      INSERT OR IGNORE INTO category_subcategories (id, category, name, keywords, order_index, is_custom, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `, [id, subcat.category, subcat.name, subcat.keywords, subcat.order_index, now, now], (err) => {
      if (err && !err.message.includes('UNIQUE')) {
        console.warn(`插入子分类 ${subcat.name} 时出现警告:`, err.message);
      }
    });
  });
  console.log('✓ 预设子分类数据已插入');

  db.close((err) => {
    if (err) {
      console.error('关闭数据库连接失败:', err.message);
    } else {
      console.log('✓ 数据库初始化完成');
    }
  });
});

