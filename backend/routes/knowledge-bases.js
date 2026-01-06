const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { v4: uuidv4 } = require('uuid');

// 获取所有知识库列表
router.get('/', async (req, res) => {
  try {
    const knowledgeBases = await db.all(
      'SELECT * FROM knowledge_bases ORDER BY is_default DESC, created_at ASC'
    );
    
    res.json({
      success: true,
      data: knowledgeBases
    });
  } catch (error) {
    console.error('获取知识库列表失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取知识库列表失败'
    });
  }
});

// 获取默认知识库
router.get('/default', async (req, res) => {
  try {
    const kb = await db.get(
      'SELECT * FROM knowledge_bases WHERE is_default = 1 LIMIT 1'
    );
    
    if (!kb) {
      // 如果没有默认知识库，返回第一个
      const firstKb = await db.get(
        'SELECT * FROM knowledge_bases ORDER BY created_at ASC LIMIT 1'
      );
      return res.json({
        success: true,
        data: firstKb || null
      });
    }
    
    res.json({
      success: true,
      data: kb
    });
  } catch (error) {
    console.error('获取默认知识库失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取默认知识库失败'
    });
  }
});

// 获取单个知识库详情
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const kb = await db.get(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );
    
    if (!kb) {
      return res.status(404).json({
        success: false,
        message: '知识库不存在'
      });
    }
    
    res.json({
      success: true,
      data: kb
    });
  } catch (error) {
    console.error('获取知识库详情失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取知识库详情失败'
    });
  }
});

// 创建新知识库
router.post('/', async (req, res) => {
  try {
    const { name, description, icon, color } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '知识库名称不能为空'
      });
    }
    
    const id = `kb-${uuidv4().split('-')[0]}`;
    const now = Date.now();
    
    // 检查是否使用 PostgreSQL（布尔值需要使用 true/false）
    const isPostgreSQL = !!process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres';
    const defaultValue = isPostgreSQL ? false : 0;
    
    await db.run(
      `INSERT INTO knowledge_bases 
       (id, name, description, icon, color, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name.trim(),
        description || '',
        icon || 'book',
        color || '#6366f1',
        defaultValue, // 新建的知识库不是默认的
        now,
        now
      ]
    );
    
    const newKb = await db.get(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );
    
    res.json({
      success: true,
      data: newKb
    });
  } catch (error) {
    console.error('创建知识库失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '创建知识库失败'
    });
  }
});

// 更新知识库
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, color, is_default } = req.body;
    
    // 检查知识库是否存在
    const existing = await db.get(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );
    
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '知识库不存在'
      });
    }
    
    // 如果设置为默认，先取消其他默认知识库
    if (is_default === 1 || is_default === true) {
      // db-pg.js 会自动处理布尔值转换
      await db.run(
        'UPDATE knowledge_bases SET is_default = false WHERE is_default = true'
      );
    }
    
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (icon !== undefined) {
      updates.push('icon = ?');
      params.push(icon);
    }
    if (color !== undefined) {
      updates.push('color = ?');
      params.push(color);
    }
    if (is_default !== undefined) {
      updates.push('is_default = ?');
      // db-pg.js 会自动处理布尔值转换
      const isPostgreSQL = !!process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres';
      params.push(isPostgreSQL ? (is_default ? true : false) : (is_default ? 1 : 0));
    }
    
    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    
    await db.run(
      `UPDATE knowledge_bases 
       SET ${updates.join(', ')} 
       WHERE id = ?`,
      params
    );
    
    const updated = await db.get(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );
    
    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('更新知识库失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '更新知识库失败'
    });
  }
});

// 删除知识库
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查是否是默认知识库
    const kb = await db.get(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );
    
    if (!kb) {
      return res.status(404).json({
        success: false,
        message: '知识库不存在'
      });
    }
    
    // PostgreSQL 返回布尔值，SQLite 返回整数
    const isDefault = kb.is_default === true || kb.is_default === 1;
    if (isDefault) {
      return res.status(400).json({
        success: false,
        message: '不能删除默认知识库'
      });
    }
    
    // 检查是否有模块关联
    const moduleCount = await db.get(
      'SELECT COUNT(*) as count FROM modules WHERE knowledge_base_id = ?',
      [id]
    );
    
    if (moduleCount && moduleCount.count > 0) {
      return res.status(400).json({
        success: false,
        message: `该知识库下有 ${moduleCount.count} 个模块，无法删除。请先删除或迁移模块。`
      });
    }
    
    // 检查是否有文档关联
    const docCount = await db.get(
      'SELECT COUNT(*) as count FROM source_items WHERE knowledge_base_id = ?',
      [id]
    );
    
    if (docCount && docCount.count > 0) {
      return res.status(400).json({
        success: false,
        message: `该知识库下有 ${docCount.count} 个文档，无法删除。请先迁移文档。`
      });
    }
    
    await db.run(
      'DELETE FROM knowledge_bases WHERE id = ?',
      [id]
    );
    
    res.json({
      success: true,
      message: '知识库已删除'
    });
  } catch (error) {
    console.error('删除知识库失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '删除知识库失败'
    });
  }
});

// 获取知识库统计信息
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    
    const kb = await db.get(
      'SELECT * FROM knowledge_bases WHERE id = ?',
      [id]
    );
    
    if (!kb) {
      return res.status(404).json({
        success: false,
        message: '知识库不存在'
      });
    }
    
    // 统计模块数量
    const moduleCount = await db.get(
      'SELECT COUNT(*) as count FROM modules WHERE knowledge_base_id = ?',
      [id]
    );
    
    // 统计文档数量
    const docCount = await db.get(
      'SELECT COUNT(*) as count FROM source_items WHERE knowledge_base_id = ? AND type = ? AND status != ?',
      [id, 'pdf', 'archived']
    );
    
    res.json({
      success: true,
      data: {
        knowledgeBase: kb,
        moduleCount: moduleCount?.count || 0,
        documentCount: docCount?.count || 0
      }
    });
  } catch (error) {
    console.error('获取知识库统计失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取知识库统计失败'
    });
  }
});

module.exports = router;

