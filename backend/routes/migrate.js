const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { v4: uuidv4 } = require('uuid');

/**
 * 通过 API 迁移数据
 * POST /api/migrate/upload
 * Body: {
 *   knowledge_bases: [...],
 *   modules: [...],
 *   source_items: [...],
 *   tags: [...],
 *   settings: [...],
 *   user_contexts: [...]
 * }
 */
router.post('/upload', async (req, res) => {
  try {
    const { knowledge_bases, modules, source_items, tags, settings, user_contexts } = req.body;
    const client = db.pool;
    
    if (!client) {
      return res.status(500).json({ 
        success: false, 
        message: '数据库连接未初始化' 
      });
    }

    const stats = {
      knowledge_bases: 0,
      modules: 0,
      source_items: 0,
      tags: 0,
      settings: 0,
      user_contexts: 0
    };

    // 迁移 knowledge_bases
    if (knowledge_bases && Array.isArray(knowledge_bases)) {
      for (const item of knowledge_bases) {
        try {
          await client.query(`
            INSERT INTO knowledge_bases (id, name, description, icon, color, is_default, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              icon = EXCLUDED.icon,
              color = EXCLUDED.color,
              is_default = EXCLUDED.is_default,
              updated_at = EXCLUDED.updated_at
          `, [
            item.id, item.name, item.description || null, 
            item.icon || 'book', item.color || '#6366f1',
            item.is_default || false, item.created_at, item.updated_at || item.created_at
          ]);
          stats.knowledge_bases++;
        } catch (err) {
          if (err.code !== '23505') { // 忽略重复键错误
            console.error('迁移 knowledge_bases 失败:', err.message);
          }
        }
      }
    }

    // 迁移 modules
    if (modules && Array.isArray(modules)) {
      for (const item of modules) {
        try {
          await client.query(`
            INSERT INTO modules (id, knowledge_base_id, step_number, step_name, checkpoint_number, checkpoint_name, description, order_index, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
              knowledge_base_id = EXCLUDED.knowledge_base_id,
              step_number = EXCLUDED.step_number,
              step_name = EXCLUDED.step_name,
              checkpoint_number = EXCLUDED.checkpoint_number,
              checkpoint_name = EXCLUDED.checkpoint_name,
              description = EXCLUDED.description,
              order_index = EXCLUDED.order_index
          `, [
            item.id, item.knowledge_base_id, item.step_number, item.step_name,
            item.checkpoint_number || null, item.checkpoint_name || null,
            item.description || null, item.order_index, item.created_at
          ]);
          stats.modules++;
        } catch (err) {
          if (err.code !== '23505') {
            console.error('迁移 modules 失败:', err.message);
          }
        }
      }
    }

    // 迁移 source_items
    if (source_items && Array.isArray(source_items)) {
      for (const item of source_items) {
        try {
          await client.query(`
            INSERT INTO source_items (
              id, type, title, raw_content, original_url, summary_ai, source,
              tags, file_path, page_count, page_content, created_at, updated_at,
              status, knowledge_base_id, module_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (id) DO UPDATE SET
              type = EXCLUDED.type,
              title = EXCLUDED.title,
              raw_content = EXCLUDED.raw_content,
              original_url = EXCLUDED.original_url,
              summary_ai = EXCLUDED.summary_ai,
              source = EXCLUDED.source,
              tags = EXCLUDED.tags,
              file_path = EXCLUDED.file_path,
              page_count = EXCLUDED.page_count,
              page_content = EXCLUDED.page_content,
              updated_at = EXCLUDED.updated_at,
              status = EXCLUDED.status,
              knowledge_base_id = EXCLUDED.knowledge_base_id,
              module_id = EXCLUDED.module_id
          `, [
            item.id, item.type, item.title, item.raw_content || null,
            item.original_url || null, item.summary_ai || null, item.source || null,
            item.tags || '[]', item.file_path || null, item.page_count || null,
            item.page_content || null, item.created_at, item.updated_at || item.created_at,
            item.status || 'pending', item.knowledge_base_id || null, item.module_id || null
          ]);
          stats.source_items++;
        } catch (err) {
          if (err.code !== '23505') {
            console.error('迁移 source_items 失败:', err.message);
          }
        }
      }
    }

    // 迁移 tags
    if (tags && Array.isArray(tags)) {
      for (const item of tags) {
        try {
          await client.query(`
            INSERT INTO tags (name, color, count, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (name) DO UPDATE SET
              color = EXCLUDED.color,
              count = EXCLUDED.count
          `, [
            item.name, item.color || '#6366f1', item.count || 0, item.created_at
          ]);
          stats.tags++;
        } catch (err) {
          if (err.code !== '23505') {
            console.error('迁移 tags 失败:', err.message);
          }
        }
      }
    }

    // 迁移 settings
    if (settings && Array.isArray(settings)) {
      for (const item of settings) {
        try {
          await client.query(`
            INSERT INTO settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          `, [item.key, item.value]);
          stats.settings++;
        } catch (err) {
          if (err.code !== '23505') {
            console.error('迁移 settings 失败:', err.message);
          }
        }
      }
    }

    // 迁移 user_contexts
    if (user_contexts && Array.isArray(user_contexts)) {
      for (const item of user_contexts) {
        try {
          await client.query(`
            INSERT INTO user_contexts (id, name, context_data, is_active, created_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              context_data = EXCLUDED.context_data,
              is_active = EXCLUDED.is_active
          `, [
            item.id, item.name, item.context_data,
            item.is_active === 1 || item.is_active === true, item.created_at
          ]);
          stats.user_contexts++;
        } catch (err) {
          if (err.code !== '23505') {
            console.error('迁移 user_contexts 失败:', err.message);
          }
        }
      }
    }

    res.json({
      success: true,
      message: '数据迁移完成',
      stats
    });

  } catch (error) {
    console.error('迁移失败:', error);
    res.status(500).json({
      success: false,
      message: '迁移失败: ' + error.message
    });
  }
});

/**
 * 创建缺失的数据库表
 * POST /api/migrate/create-tables
 */
router.post('/create-tables', async (req, res) => {
  try {
    const client = db.pool;
    
    if (!client) {
      return res.status(500).json({ 
        success: false, 
        message: '数据库连接未初始化' 
      });
    }

    const results = {
      tables: [],
      indexes: []
    };

    // 1. 创建 personal_knowledge_items 表
    try {
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
          subcategory_id TEXT,
          tags TEXT DEFAULT '[]',
          knowledge_base_id TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          metadata TEXT
        )
      `);
      results.tables.push('personal_knowledge_items');
      
      // 确保 subcategory_id 字段存在
      try {
        await client.query(`
          ALTER TABLE personal_knowledge_items 
          ADD COLUMN IF NOT EXISTS subcategory_id TEXT
        `);
      } catch (err) {
        // 忽略字段已存在的错误
        if (!err.message.includes('duplicate') && !err.message.includes('already exists')) {
          console.warn('添加 subcategory_id 字段时出现警告:', err.message);
        }
      }
    } catch (err) {
      console.error('创建 personal_knowledge_items 失败:', err.message);
    }

    // 2. 创建 knowledge_relations 表
    try {
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
      results.tables.push('knowledge_relations');
    } catch (err) {
      console.error('创建 knowledge_relations 失败:', err.message);
    }

    // 3. 创建 category_subcategories 表
    try {
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
      results.tables.push('category_subcategories');
    } catch (err) {
      console.error('创建 category_subcategories 失败:', err.message);
    }

    // 4. 创建索引
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_knowledge_items_knowledge_base_id ON personal_knowledge_items(knowledge_base_id)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON personal_knowledge_items(status)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON personal_knowledge_items(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_items_subcategory ON personal_knowledge_items(subcategory_id)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_item_id ON personal_knowledge_items(source_item_id)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source ON knowledge_relations(source_knowledge_id)',
      'CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target ON knowledge_relations(target_knowledge_id)',
      'CREATE INDEX IF NOT EXISTS idx_subcategories_category ON category_subcategories(category)',
      'CREATE INDEX IF NOT EXISTS idx_subcategories_order ON category_subcategories(category, order_index)'
    ];

    for (const sql of indexes) {
      try {
        await client.query(sql);
        results.indexes.push(sql.substring(0, 50) + '...');
      } catch (err) {
        console.error('创建索引失败:', err.message);
      }
    }

    // 5. 插入预设子分类数据
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
        const result = await client.query(`
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
          console.warn(`插入子分类 ${subcat.name} 时出现警告:`, err.message);
        }
      }
    }

    // 6. 验证表是否创建成功
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('personal_knowledge_items', 'knowledge_relations', 'category_subcategories')
      ORDER BY table_name
    `);

    // 验证子分类数据
    const subcategoryCount = await client.query(`
      SELECT COUNT(*) as count FROM category_subcategories
    `);

    res.json({
      success: true,
      message: '数据库表创建完成',
      createdTables: results.tables,
      createdIndexes: results.indexes.length,
      verifiedTables: tables.rows.map(r => r.table_name),
      subcategories: {
        inserted: insertedCount,
        total: parseInt(subcategoryCount.rows[0].count)
      }
    });

  } catch (error) {
    console.error('创建表失败:', error);
    res.status(500).json({
      success: false,
      message: '创建表失败: ' + error.message
    });
  }
});

module.exports = router;

