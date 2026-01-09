#!/usr/bin/env node
/**
 * 测试知识提取功能
 * 用法: node backend/scripts/test-extraction.js [文档ID]
 */

const db = require('../services/db');
const { extractKnowledgeFromContent } = require('../services/knowledge-extractor');
const { getApiKey, testConnection } = require('../services/ai');

async function testExtraction(docId = null) {
  console.log('=== 知识提取测试 ===\n');
  
  try {
    // 连接数据库
    await db.connect();
    // 1. 检查 API Key
    console.log('1. 检查 API Key...');
    let apiKey = null;
    try {
      apiKey = await getApiKey();
      if (apiKey && apiKey.startsWith('sk-')) {
        console.log('   ✓ API Key 已配置');
        
        // 测试连接
        const testResult = await testConnection(apiKey);
        if (testResult.success) {
          console.log('   ✓ API 连接成功\n');
        } else {
          console.log(`   ✗ API 连接失败: ${testResult.message}\n`);
          return;
        }
      } else {
        console.log('   ✗ API Key 未配置或格式不正确\n');
        return;
      }
    } catch (error) {
      console.log(`   ✗ API Key 检查失败: ${error.message}\n`);
      return;
    }
    
    // 2. 获取测试文档
    let testDoc = null;
    if (docId) {
      testDoc = await db.get('SELECT * FROM source_items WHERE id = ?', [docId]);
      if (!testDoc) {
        console.log(`   ✗ 文档 ${docId} 不存在\n`);
        return;
      }
    } else {
      // 获取第一个有内容的文档
      testDoc = await db.get(`
        SELECT * FROM source_items 
        WHERE LENGTH(raw_content) > 0 
        ORDER BY created_at DESC 
        LIMIT 1
      `);
      
      if (!testDoc) {
        console.log('   ✗ 没有找到有内容的文档\n');
        return;
      }
    }
    
    console.log(`2. 使用文档进行测试:`);
    console.log(`   - 文档ID: ${testDoc.id}`);
    console.log(`   - 标题: ${testDoc.title || '无标题'}`);
    console.log(`   - 类型: ${testDoc.type}`);
    console.log(`   - 内容长度: ${testDoc.raw_content ? testDoc.raw_content.length : 0} 字符\n`);
    
    if (!testDoc.raw_content || testDoc.raw_content.trim().length === 0) {
      console.log('   ✗ 文档内容为空，无法提取\n');
      return;
    }
    
    // 3. 执行提取测试
    console.log('3. 开始提取测试...');
    console.log('   (这可能需要几秒钟，请耐心等待...)\n');
    
    try {
      const startTime = Date.now();
      const knowledgeItems = await extractKnowledgeFromContent(
        testDoc.raw_content,
        testDoc.id,
        null,
        apiKey
      );
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      console.log(`4. 提取结果:`);
      console.log(`   - 耗时: ${duration} 秒`);
      console.log(`   - 提取到的知识点数量: ${knowledgeItems.length}\n`);
      
      if (knowledgeItems.length > 0) {
        console.log('   ✓ 提取成功！知识点列表:');
        knowledgeItems.forEach((item, index) => {
          console.log(`\n   ${index + 1}. ${item.title}`);
          console.log(`      - 内容长度: ${item.content.length} 字符`);
          console.log(`      - 置信度: ${item.confidence}`);
          console.log(`      - 标签: ${item.tags.join(', ') || '无'}`);
          console.log(`      - 关键结论: ${item.keyConclusions.length} 个`);
        });
        console.log('\n   ✓ 测试通过！提取功能正常工作。\n');
      } else {
        console.log('   ⚠️  未提取到任何知识点');
        console.log('\n   可能的原因:');
        console.log('   1. 文档内容质量不高或太短');
        console.log('   2. AI 返回的格式不正确');
        console.log('   3. 文档内容不包含可提取的知识点');
        console.log('\n   建议:');
        console.log('   - 检查后端日志中的详细错误信息');
        console.log('   - 尝试使用更长的、包含明确知识点的文档');
        console.log('   - 确认 API Key 有效且有足够的配额\n');
      }
    } catch (error) {
      console.log(`   ✗ 提取失败: ${error.message}\n`);
      console.log('   错误详情:');
      console.log(`   - 错误类型: ${error.name}`);
      if (error.stack) {
        console.log(`   - 堆栈跟踪:\n${error.stack.split('\n').slice(0, 5).join('\n')}`);
      }
      console.log('\n   建议:');
      if (error.message.includes('API Key')) {
        console.log('   - 检查 API Key 是否正确配置');
        console.log('   - 确认 API Key 有效且有足够的配额');
      } else if (error.message.includes('网络') || error.message.includes('fetch')) {
        console.log('   - 检查网络连接');
        console.log('   - 确认可以访问 api.deepseek.com');
      } else {
        console.log('   - 查看后端日志获取更多信息');
        console.log('   - 检查文档内容是否有效');
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('测试过程中出错:', error);
    process.exit(1);
  } finally {
    // 关闭数据库连接
    try {
      await db.close();
    } catch (e) {
      // 忽略关闭错误
    }
  }
  
  process.exit(0);
}

// 从命令行参数获取文档ID
const docId = process.argv[2] || null;
testExtraction(docId);

