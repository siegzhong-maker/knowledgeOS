// 为现有数据库添加subcategory_id字段
const db = require('../services/db');

async function addSubcategoryField() {
  try {
    await db.connect();
    
    console.log('开始添加subcategory_id字段...');
    
    // 检查字段是否已存在（SQLite）
    try {
      // 尝试添加字段
      await db.run('ALTER TABLE personal_knowledge_items ADD COLUMN subcategory_id TEXT');
      console.log('✓ 已添加subcategory_id字段到personal_knowledge_items表');
    } catch (error) {
      if (error.message && error.message.includes('duplicate column')) {
        console.log('✓ subcategory_id字段已存在，跳过');
      } else {
        throw error;
      }
    }
    
    // 检查category_subcategories表是否存在
    try {
      const result = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='category_subcategories'");
      if (!result) {
        console.log('创建category_subcategories表...');
        await db.run(`
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
        `);
        
        // 创建索引
        await db.run('CREATE INDEX IF NOT EXISTS idx_subcategories_category ON category_subcategories(category)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_subcategories_order ON category_subcategories(category, order_index)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_items_subcategory ON personal_knowledge_items(subcategory_id)');
        
        console.log('✓ category_subcategories表已创建');
        
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
        for (const subcat of presetSubcategories) {
          try {
            const id = `subcat-${uuidv4()}`;
            await db.run(`
              INSERT OR IGNORE INTO category_subcategories (id, category, name, keywords, order_index, is_custom, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            `, [id, subcat.category, subcat.name, subcat.keywords, subcat.order_index, now, now]);
          } catch (err) {
            if (!err.message.includes('UNIQUE')) {
              console.warn(`插入子分类 ${subcat.name} 时出现警告:`, err.message);
            }
          }
        }
        console.log('✓ 预设子分类数据已插入');
      } else {
        console.log('✓ category_subcategories表已存在');
      }
    } catch (error) {
      console.error('检查/创建category_subcategories表失败:', error);
    }
    
    console.log('\n✓ 数据库迁移完成');
    await db.close();
    process.exit(0);
  } catch (error) {
    console.error('数据库迁移失败:', error);
    await db.close();
    process.exit(1);
  }
}

addSubcategoryField();

