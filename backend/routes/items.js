const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { v4: uuidv4 } = require('uuid');

// （可选调试中间件）如需调试永久删除请求，可在本地开发环境中临时启用
// 为避免生产环境日志噪音，这里默认关闭

// 获取所有知识项
router.get('/', async (req, res) => {
  try {
    const { type, status, search, page = 1, limit = 50, knowledge_base_id } = req.query;
    
    // 优化：列表查询只返回必要字段，排除大文本字段（raw_content, page_content）
    // 这些字段只在查看详情时加载
    let sql = `SELECT id, type, title, original_url, summary_ai, source, tags, 
               file_path, page_count, created_at, updated_at, status, 
               knowledge_base_id, module_id, knowledge_extracted
               FROM source_items WHERE 1=1`;
    const params = [];

    if (type && type !== 'all') {
      sql += ' AND type = ?';
      params.push(type);
    }

    // 知识库过滤
    if (knowledge_base_id) {
      sql += ' AND knowledge_base_id = ?';
      params.push(knowledge_base_id);
    }

    // 默认排除archived，除非明确指定status=archived或status=all
    if (status === 'archived') {
      sql += ' AND status = ?';
      params.push('archived');
    } else if (status === 'all') {
      // 显示所有状态
    } else {
      // 默认排除archived，但包含pending和processed
      sql += ' AND status != ?';
      params.push('archived');
    }

    if (search) {
      // 只搜索已索引的字段，避免大文本字段全表扫描
      sql += ' AND (title LIKE ? OR summary_ai LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    // 获取总数（在应用ORDER BY和LIMIT之前）
    // 构建COUNT查询：移除SELECT字段列表，替换为COUNT(*)
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as count FROM');
    const countResult = await db.get(countSql, params);
    const total = countResult?.count || 0;

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    
    const items = await db.all(sql, params);

    // 解析tags JSON（不再解析page_content，因为列表查询不返回该字段）
    const itemsWithParsedTags = items.map(item => {
      const parsed = {
        ...item,
        tags: JSON.parse(item.tags || '[]')
      };
      
      return parsed;
    });

    res.json({
      success: true,
      data: itemsWithParsedTags,
      total: parseInt(total),
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: (parseInt(page) * parseInt(limit)) < parseInt(total)
    });
  } catch (error) {
    console.error('获取知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取统计信息（必须在 /:id 之前，使用精确匹配）
router.get('/stats', async (req, res) => {
  try {
    const total = await db.get('SELECT COUNT(*) as count FROM source_items WHERE status != ?', ['archived']);
    const pending = await db.get('SELECT COUNT(*) as count FROM source_items WHERE status = ?', ['pending']);
    const archived = await db.get('SELECT COUNT(*) as count FROM source_items WHERE status = ?', ['archived']);
    
    // 今日新增
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = await db.get(
      'SELECT COUNT(*) as count FROM source_items WHERE created_at >= ? AND status != ?',
      [todayStart.getTime(), 'archived']
    );

    res.json({
      success: true,
      data: {
        total: total?.count || 0,
        pending: pending?.count || 0,
        archived: archived?.count || 0,
        todayAdded: todayCount?.count || 0
      }
    });
  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 获取单个知识项（必须在更具体的路由之后）
router.get('/:id', async (req, res) => {
  try {
    const item = await db.get('SELECT * FROM source_items WHERE id = ?', [req.params.id]);
    
    if (!item) {
      return res.status(404).json({ success: false, message: '知识项不存在' });
    }

    item.tags = JSON.parse(item.tags || '[]');
    
    // 如果是PDF类型，解析page_content
    if (item.type === 'pdf' && item.page_content) {
      try {
        item.page_content = JSON.parse(item.page_content);
      } catch (e) {
        console.warn('page_content JSON解析失败:', e);
        item.page_content = [];
      }
    } else if (item.type === 'pdf') {
      item.page_content = [];
    }
    
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('获取知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 创建知识项
router.post('/', async (req, res) => {
  try {
    const { type, title, raw_content, original_url, source, tags } = req.body;

    if (!type || !title) {
      return res.status(400).json({ success: false, message: '类型和标题不能为空' });
    }

    if (!['text', 'link', 'memo', 'pdf'].includes(type)) {
      return res.status(400).json({ success: false, message: '类型无效' });
    }

    const id = uuidv4();
    const now = Date.now();
    const tagsJson = JSON.stringify(tags || []);

    await db.run(
      `INSERT INTO source_items 
       (id, type, title, raw_content, original_url, source, tags, created_at, updated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, type, title, raw_content || '', original_url || '', source || '', tagsJson, now, now, 'pending']
    );

    const item = await db.get('SELECT * FROM source_items WHERE id = ?', [id]);
    item.tags = JSON.parse(item.tags || '[]');

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error('创建知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 更新知识项
router.put('/:id', async (req, res) => {
  try {
    const { title, raw_content, summary_ai, tags, status, module_id } = req.body;
    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (raw_content !== undefined) {
      updates.push('raw_content = ?');
      params.push(raw_content);
    }
    if (summary_ai !== undefined) {
      updates.push('summary_ai = ?');
      params.push(summary_ai);
    }
    if (tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(tags));
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (module_id !== undefined) {
      // 允许设置为null（未分类）
      updates.push('module_id = ?');
      params.push(module_id || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '没有要更新的字段' });
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);

    await db.run(
      `UPDATE source_items SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const item = await db.get('SELECT * FROM source_items WHERE id = ?', [req.params.id]);
    if (!item) {
      return res.status(404).json({ success: false, message: '知识项不存在' });
    }

    item.tags = JSON.parse(item.tags || '[]');
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('更新知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 归档知识项（必须在 /:id 之前）
router.post('/:id/archive', async (req, res) => {
  try {
    await db.run('UPDATE source_items SET status = ?, updated_at = ? WHERE id = ?', ['archived', Date.now(), req.params.id]);
    res.json({ success: true, message: '已归档' });
  } catch (error) {
    console.error('归档知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 恢复归档的知识项（必须在 /:id 之前）
router.post('/:id/restore', async (req, res) => {
  try {
    await db.run('UPDATE source_items SET status = ?, updated_at = ? WHERE id = ?', ['processed', Date.now(), req.params.id]);
    res.json({ success: true, message: '已恢复' });
  } catch (error) {
    console.error('恢复知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 永久删除知识项（硬删除，必须在 /:id 之前）
router.delete('/:id/permanent', async (req, res) => {
  try {
    await db.run('DELETE FROM source_items WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: '已永久删除' });
  } catch (error) {
    console.error('永久删除知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 删除知识项（软删除，归档）- 必须在更具体的路由之后
router.delete('/:id', async (req, res) => {
  try {
    await db.run('UPDATE source_items SET status = ?, updated_at = ? WHERE id = ?', ['archived', Date.now(), req.params.id]);
    res.json({ success: true, message: '已归档' });
  } catch (error) {
    console.error('归档知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 批量创建知识项（用于saynote app批量同步）
router.post('/batch', async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items必须是非空数组' });
    }

    const results = [];
    const now = Date.now();

    for (const item of items) {
      const { type, title, raw_content, original_url, source, tags } = item;

      if (!type || !title) {
        results.push({ success: false, message: '类型和标题不能为空' });
        continue;
      }

      if (!['text', 'link', 'memo'].includes(type)) {
        results.push({ success: false, message: '类型无效' });
        continue;
      }

      try {
        const id = uuidv4();
        const tagsJson = JSON.stringify(tags || []);

        await db.run(
          `INSERT INTO source_items 
           (id, type, title, raw_content, original_url, source, tags, created_at, updated_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, type, title, raw_content || '', original_url || '', source || '', tagsJson, now, now, 'pending']
        );

        const createdItem = await db.get('SELECT * FROM source_items WHERE id = ?', [id]);
        createdItem.tags = JSON.parse(createdItem.tags || '[]');
        results.push({ success: true, data: createdItem });
      } catch (error) {
        results.push({ success: false, message: error.message });
      }
    }

    res.json({
      success: true,
      data: results,
      total: items.length,
      successCount: results.filter(r => r.success).length
    });
  } catch (error) {
    console.error('批量创建知识项失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

