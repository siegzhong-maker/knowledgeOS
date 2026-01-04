const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { encryptToString, decryptFromString } = require('../services/crypto');
const { testConnection } = require('../services/ai');

// 获取设置
router.get('/', async (req, res) => {
  try {
    const settings = await db.all('SELECT key, value FROM settings');
    const result = {};

    for (const setting of settings) {
      if (setting.key === 'deepseek_api_key') {
        // API Key需要部分显示
        const decrypted = decryptFromString(setting.value);
        if (decrypted) {
          // 只显示前4位和后4位
          const masked = decrypted.substring(0, 4) + '...' + decrypted.substring(decrypted.length - 4);
          result[setting.key] = masked;
          result[setting.key + '_configured'] = true;
        } else {
          result[setting.key + '_configured'] = false;
        }
      } else {
        result[setting.key] = setting.value;
      }
    }

    // 如果没有设置评估开关，默认返回true
    if (result.enable_relevance_evaluation === undefined) {
      result.enable_relevance_evaluation = 'true';
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('获取设置失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 更新设置
router.put('/', async (req, res) => {
  try {
    const { apiKey, model, darkMode, enableRelevanceEvaluation } = req.body;

    if (apiKey !== undefined) {
      // 验证API Key格式
      if (apiKey && !apiKey.startsWith('sk-')) {
        return res.status(400).json({ success: false, message: 'API Key格式无效' });
      }

      if (apiKey) {
        const encrypted = encryptToString(apiKey);
        // 使用兼容SQLite和PostgreSQL的语法
        const sql = process.env.DATABASE_URL 
          ? 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2'
          : 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
        await db.run(sql, ['deepseek_api_key', encrypted]);
      } else {
        // 清空API Key
        await db.run('DELETE FROM settings WHERE key = ?', ['deepseek_api_key']);
      }
    }

    if (model !== undefined) {
      const sql = process.env.DATABASE_URL 
        ? 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2'
        : 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
      await db.run(sql, ['deepseek_model', model]);
    }

    if (darkMode !== undefined) {
      const sql = process.env.DATABASE_URL 
        ? 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2'
        : 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
      await db.run(sql, ['dark_mode', darkMode.toString()]);
    }

    if (enableRelevanceEvaluation !== undefined) {
      const sql = process.env.DATABASE_URL 
        ? 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2'
        : 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
      await db.run(sql, ['enable_relevance_evaluation', enableRelevanceEvaluation.toString()]);
    }

    res.json({ success: true, message: '设置已保存' });
  } catch (error) {
    console.error('更新设置失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 测试API连接
router.post('/test-api', async (req, res) => {
  try {
    const { apiKey } = req.body;

    const result = await testConnection(apiKey || null);

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('测试API连接失败:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || '测试连接失败' 
    });
  }
});

// 获取API状态
router.get('/api-status', async (req, res) => {
  try {
    const setting = await db.get('SELECT value FROM settings WHERE key = ?', ['deepseek_api_key']);
    const configured = !!setting;

    if (!configured) {
      return res.json({ 
        success: true, 
        data: { configured: false, status: '未配置' } 
      });
    }

    // 测试连接
    const result = await testConnection();
    res.json({
      success: true,
      data: {
        configured: true,
        status: result.success ? '已连接' : '连接失败',
        message: result.message
      }
    });
  } catch (error) {
    console.error('获取API状态失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

