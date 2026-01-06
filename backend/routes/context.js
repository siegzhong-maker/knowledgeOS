const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { v4: uuidv4 } = require('uuid');

// 获取激活的Context
router.get('/active', async (req, res) => {
  try {
    // db-pg.js 会自动处理布尔值转换
    let context = await db.get('SELECT * FROM user_contexts WHERE is_active = true LIMIT 1');
    
    // 如果没有激活的Context，创建默认的
    if (!context) {
      const isPostgreSQL = !!process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres';
      const defaultContext = {
        id: uuidv4(),
        name: '默认场景',
        context_data: JSON.stringify({
          stage: '初创期',
          teamSize: 3,
          industry: ''
        }),
        is_active: isPostgreSQL ? true : 1,
        created_at: Date.now()
      };
      
      await db.run(
        'INSERT INTO user_contexts (id, name, context_data, is_active, created_at) VALUES (?, ?, ?, ?, ?)',
        [defaultContext.id, defaultContext.name, defaultContext.context_data, defaultContext.is_active, defaultContext.created_at]
      );
      
      context = defaultContext;
    }
    
    // 解析JSON
    context.context_data = JSON.parse(context.context_data);
    
    res.json({
      success: true,
      data: context
    });
  } catch (error) {
    console.error('获取Context失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取Context失败'
    });
  }
});

// 更新激活的Context
router.put('/active', async (req, res) => {
  try {
    const { context_data } = req.body;
    
    if (!context_data) {
      return res.status(400).json({ success: false, message: 'context_data不能为空' });
    }
    
    // 获取当前激活的Context
    // db-pg.js 会自动处理布尔值转换
    let context = await db.get('SELECT * FROM user_contexts WHERE is_active = true LIMIT 1');
    
    if (context) {
      // 更新现有Context
      await db.run(
        'UPDATE user_contexts SET context_data = ? WHERE id = ?',
        [JSON.stringify(context_data), context.id]
      );
    } else {
      // 创建新Context
      const id = uuidv4();
      const isPostgreSQL = !!process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres';
      await db.run(
        'INSERT INTO user_contexts (id, name, context_data, is_active, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, '默认场景', JSON.stringify(context_data), isPostgreSQL ? true : 1, Date.now()]
      );
      context = { id };
    }
    
    res.json({
      success: true,
      data: {
        id: context.id,
        context_data: context_data
      }
    });
  } catch (error) {
    console.error('更新Context失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '更新Context失败'
    });
  }
});

module.exports = router;

