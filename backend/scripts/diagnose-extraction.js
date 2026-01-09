#!/usr/bin/env node
/**
 * 诊断知识提取问题
 */

const db = require('../services/db');
const { getApiKey, testConnection } = require('../services/ai');

async function diagnoseExtraction() {
  console.log('=== 知识提取诊断 ===\n');
  
  try {
    // 1. 检查 API Key 配置
    console.log('1. 检查 DeepSeek API Key 配置...');
    try {
      const apiKey = await getApiKey();
      if (apiKey && apiKey.startsWith('sk-')) {
        console.log('   ✓ API Key 已配置');
        console.log(`   - 格式: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
        
        // 测试连接
        console.log('\n   测试 API 连接...');
        const testResult = await testConnection(apiKey);
        if (testResult.success) {
          console.log('   ✓ API 连接成功');
        } else {
          console.log(`   ✗ API 连接失败: ${testResult.message}`);
        }
      } else {
        console.log('   ✗ API Key 未配置或格式不正确');
      }
    } catch (error) {
      console.log(`   ✗ API Key 检查失败: ${error.message}`);
    }
    
    // 2. 检查数据库中的文档
    console.log('\n2. 检查文档记录...');
    try {
      const docs = await db.all(`
        SELECT id, title, type, 
               LENGTH(raw_content) as content_length,
               knowledge_extracted,
               created_at
        FROM source_items 
        ORDER BY created_at DESC 
        LIMIT 10
      `);
      
      console.log(`   - 最近 10 个文档:`);
      docs.forEach((doc, index) => {
        const hasContent = doc.content_length > 0;
        const extracted = doc.knowledge_extracted === 1 || doc.knowledge_extracted === true;
        console.log(`   ${index + 1}. ${doc.title || doc.id}`);
        console.log(`      - 类型: ${doc.type}`);
        console.log(`      - 内容长度: ${doc.content_length || 0} 字符`);
        console.log(`      - 有内容: ${hasContent ? '✓' : '✗'}`);
        console.log(`      - 已提取: ${extracted ? '✓' : '✗'}`);
      });
      
      // 统计
      const stats = await db.get(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN LENGTH(raw_content) > 0 THEN 1 END) as with_content,
          COUNT(CASE WHEN knowledge_extracted = 1 OR knowledge_extracted = true THEN 1 END) as extracted
        FROM source_items
      `);
      console.log(`\n   - 统计:`);
      console.log(`     - 总文档数: ${stats.total}`);
      console.log(`     - 有内容的文档: ${stats.with_content}`);
      console.log(`     - 已提取的文档: ${stats.extracted}`);
    } catch (error) {
      console.log(`   ✗ 检查文档失败: ${error.message}`);
    }
    
    // 3. 检查知识点记录
    console.log('\n3. 检查知识点记录...');
    try {
      const knowledgeStats = await db.get(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
        FROM personal_knowledge_items
      `);
      console.log(`   - 总知识点数: ${knowledgeStats.total}`);
      console.log(`   - 已确认: ${knowledgeStats.confirmed}`);
      console.log(`   - 待确认: ${knowledgeStats.pending}`);
      
      // 最近的知识点
      const recentKnowledge = await db.all(`
        SELECT id, title, status, source_item_id, created_at
        FROM personal_knowledge_items
        ORDER BY created_at DESC
        LIMIT 5
      `);
      
      if (recentKnowledge.length > 0) {
        console.log(`\n   - 最近 5 个知识点:`);
        recentKnowledge.forEach((item, index) => {
          console.log(`   ${index + 1}. ${item.title || item.id}`);
          console.log(`      - 状态: ${item.status}`);
          console.log(`      - 来源文档: ${item.source_item_id || '无'}`);
        });
      } else {
        console.log(`   ⚠️  没有知识点记录`);
      }
    } catch (error) {
      console.log(`   ✗ 检查知识点失败: ${error.message}`);
      if (error.message.includes('no such table')) {
        console.log(`   ⚠️  知识点表不存在，可能需要初始化数据库`);
      }
    }
    
    // 4. 检查知识库
    console.log('\n4. 检查知识库...');
    try {
      const knowledgeBases = await db.all(`
        SELECT id, name, is_default, created_at
        FROM knowledge_bases
        ORDER BY created_at ASC
      `);
      
      if (knowledgeBases.length > 0) {
        console.log(`   - 知识库列表:`);
        knowledgeBases.forEach((kb, index) => {
          console.log(`   ${index + 1}. ${kb.name} (${kb.id})`);
          console.log(`      - 默认: ${kb.is_default ? '是' : '否'}`);
        });
      } else {
        console.log(`   ⚠️  没有知识库，提取时需要先创建知识库`);
      }
    } catch (error) {
      console.log(`   ✗ 检查知识库失败: ${error.message}`);
    }
    
    // 5. 检查最近的提取任务（如果有的话）
    console.log('\n5. 建议检查项:');
    console.log('   - 确认 API Key 已正确配置');
    console.log('   - 确认文档有内容（raw_content 不为空）');
    console.log('   - 确认至少有一个知识库');
    console.log('   - 查看后端日志中的提取错误信息');
    console.log('   - 尝试手动提取一个文档，观察错误信息');
    
    console.log('\n=== 诊断完成 ===\n');
    
  } catch (error) {
    console.error('诊断过程中出错:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

diagnoseExtraction();

