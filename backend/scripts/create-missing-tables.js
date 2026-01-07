#!/usr/bin/env node

/**
 * 创建缺失的数据库表（用于知识提取功能）
 * 
 * 此脚本会创建以下表和初始数据：
 * 1. personal_knowledge_items - 存储提取的知识点卡片
 * 2. knowledge_relations - 存储知识点之间的关系
 * 3. category_subcategories - 存储分类和子分类（含16个预设子分类）
 * 
 * 用法（Railway 部署）：
 *   1. 在 Railway Web 服务终端中运行（推荐，使用内部地址）：
 *      node backend/scripts/create-missing-tables.js
 * 
 *   2. 使用 Railway 公网连接字符串（如果需要在本地运行）：
 *      DATABASE_PUBLIC_URL="postgresql://postgres:密码@centerbeam.proxy.rlwy.net:41682/railway" node backend/scripts/create-missing-tables.js
 * 
 *   3. 或手动指定 DATABASE_URL：
 *      DATABASE_URL="postgresql://..." node backend/scripts/create-missing-tables.js
 * 
 * 注意：
 *   - 脚本会自动检查并添加缺失的字段（如 subcategory_id）
 *   - 预设子分类数据使用 ON CONFLICT DO NOTHING，不会覆盖已有数据
 *   - 脚本会输出详细的执行日志和验证结果
 */

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

async function createMissingTables() {
  try {
    console.log('🔧 开始创建缺失的数据库表...\n');

    // 优先使用 DATABASE_PUBLIC_URL（Railway 提供），否则使用 DATABASE_URL
    const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('未设置 DATABASE_URL 或 DATABASE_PUBLIC_URL 环境变量');
    }

    // 创建连接池
    const pool = new Pool({
      connectionString: connectionString,
      ssl: connectionString.includes('proxy.rlwy.net') || connectionString.includes('railway.app') 
        ? { rejectUnauthorized: false } 
        : false
    });

    // 测试连接
    await pool.query('SELECT NOW()');
    console.log('✓ 数据库连接成功\n');

    // 1. 创建 personal_knowledge_items 表
    console.log('1️⃣  创建 personal_knowledge_items 表...');
    await pool.query(`
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
        subcategory_id TEXT,
        tags TEXT DEFAULT '[]',
        knowledge_base_id TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        metadata TEXT
      )
    `);
    console.log('   ✓ personal_knowledge_items 表已创建');

    // 为 personal_knowledge_items 表添加 subcategory_id 字段（如果表已存在但字段缺失）
    try {
      await pool.query(`
        ALTER TABLE personal_knowledge_items 
        ADD COLUMN IF NOT EXISTS subcategory_id TEXT
      `);
      console.log('   ✓ 确保 subcategory_id 字段存在');
    } catch (err) {
      // 忽略字段已存在的错误
      if (!err.message.includes('duplicate') && !err.message.includes('already exists')) {
        console.warn('   ⚠️  添加 subcategory_id 字段时出现警告:', err.message);
      }
    }

    // 2. 创建 knowledge_relations 表
    console.log('2️⃣  创建 knowledge_relations 表...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        source_knowledge_id TEXT NOT NULL,
        target_knowledge_id TEXT NOT NULL,
        relation_type TEXT DEFAULT 'related' CHECK(relation_type IN ('related', 'similar', 'derived')),
        similarity_score REAL DEFAULT 0,
        created_at BIGINT NOT NULL
      )
    `);
    console.log('   ✓ knowledge_relations 表已创建');

    // 3. 创建 category_subcategories 表
    console.log('3️⃣  创建 category_subcategories 表...');
    await pool.query(`
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
    console.log('   ✓ category_subcategories 表已创建');

    // 4. 创建索引
    console.log('4️⃣  创建索引...');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_items_knowledge_base_id ON personal_knowledge_items(knowledge_base_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON personal_knowledge_items(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON personal_knowledge_items(created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_items_subcategory ON personal_knowledge_items(subcategory_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_item_id ON personal_knowledge_items(source_item_id)');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source ON knowledge_relations(source_knowledge_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target ON knowledge_relations(target_knowledge_id)');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_subcategories_category ON category_subcategories(category)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_subcategories_order ON category_subcategories(category, order_index)');
    
    console.log('   ✓ 所有索引已创建');

    // 5. 插入预设子分类数据
    console.log('\n5️⃣  插入预设子分类数据...');
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
    let insertedCount = 0;
    for (const subcat of presetSubcategories) {
      try {
        const id = `subcat-${uuidv4()}`;
        const result = await pool.query(`
          INSERT INTO category_subcategories (id, category, name, keywords, order_index, is_custom, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
          ON CONFLICT (category, name) DO NOTHING
        `, [id, subcat.category, subcat.name, subcat.keywords, subcat.order_index, now, now]);
        
        if (result.rowCount > 0) {
          insertedCount++;
        }
      } catch (err) {
        // 忽略重复插入错误
        if (!err.message.includes('duplicate') && !err.message.includes('UNIQUE')) {
          console.warn(`    ⚠️  插入子分类 ${subcat.name} 时出现警告:`, err.message);
        }
      }
    }
    console.log(`   ✓ 预设子分类数据已插入（新增 ${insertedCount} 条，已存在 ${presetSubcategories.length - insertedCount} 条）`);

    // 6. 验证表是否创建成功
    console.log('\n6️⃣  验证表创建结果...');
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('personal_knowledge_items', 'knowledge_relations', 'category_subcategories')
      ORDER BY table_name
    `);

    console.log('\n✅ 已创建的表：');
    tables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    // 验证字段和数据结构
    console.log('\n7️⃣  验证数据结构...');
    
    // 验证 personal_knowledge_items 表的 subcategory_id 字段
    const personalKnowledgeColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'personal_knowledge_items'
      AND column_name = 'subcategory_id'
    `);
    if (personalKnowledgeColumns.rows.length > 0) {
      console.log('   ✓ personal_knowledge_items.subcategory_id 字段存在');
    } else {
      console.warn('   ⚠️  personal_knowledge_items.subcategory_id 字段不存在，请检查表结构');
    }

    // 验证 category_subcategories 表的数据
    const subcategoryCount = await pool.query(`
      SELECT COUNT(*) as count FROM category_subcategories
    `);
    console.log(`   ✓ category_subcategories 表中有 ${subcategoryCount.rows[0].count} 条记录`);
    
    // 显示各分类的子分类数量
    const categoryStats = await pool.query(`
      SELECT category, COUNT(*) as count 
      FROM category_subcategories 
      GROUP BY category 
      ORDER BY category
    `);
    categoryStats.rows.forEach(stat => {
      console.log(`      - ${stat.category}: ${stat.count} 个子分类`);
    });

    console.log('\n' + '='.repeat(50));
    console.log('✅ 所有缺失的表已成功创建！');
    console.log('='.repeat(50));
    console.log('\n💡 提示：现在可以刷新应用页面，知识库错误应该消失了。');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ 创建表失败:', error.message);
    console.error('\n错误详情:', error);
    process.exit(1);
  }
}

// 运行
createMissingTables();

