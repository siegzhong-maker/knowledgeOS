#!/usr/bin/env node
/**
 * 快速配置 DeepSeek API Key
 * 用法: node backend/scripts/setup-api-key.js <your-api-key>
 */

const db = require('../services/db');
const { encryptToString } = require('../services/crypto');

async function setupApiKey(apiKey) {
  if (!apiKey) {
    console.error('错误: 请提供 API Key');
    console.log('\n用法: node backend/scripts/setup-api-key.js <your-api-key>');
    console.log('示例: node backend/scripts/setup-api-key.js sk-xxxxxxxxxxxxx');
    process.exit(1);
  }

  if (!apiKey.startsWith('sk-')) {
    console.error('错误: API Key 格式不正确，应以 "sk-" 开头');
    process.exit(1);
  }

  try {
    await db.connect();
    console.log('✓ 已连接到数据库\n');

    // 加密 API Key
    const encrypted = encryptToString(apiKey);

    // 保存到数据库
    const sql = process.env.DATABASE_URL 
      ? 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2'
      : 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
    
    await db.run(sql, ['deepseek_api_key', encrypted]);

    console.log('✓ API Key 已成功配置到数据库');
    console.log(`  - 格式: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
    console.log('\n现在可以尝试提取知识点了！');
    console.log('提示: 也可以在前端设置中配置个人 API Key（推荐）\n');

    await db.close();
  } catch (error) {
    console.error('配置失败:', error.message);
    process.exit(1);
  }
}

const apiKey = process.argv[2];
setupApiKey(apiKey);

