const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { consultantChat, extractCitations, analyzeDocument, matchDocument, generateWelcomeMessage } = require('../services/ai');
const { evaluateRelevance } = require('../services/relevance-evaluator');

// 分析文档主题和分类
router.post('/analyze-document', async (req, res) => {
  try {
    const { docId } = req.body;
    
    if (!docId) {
      return res.status(400).json({ success: false, message: '文档ID不能为空' });
    }

    const item = await db.get('SELECT id, title, raw_content FROM source_items WHERE id = ? AND type = ?', [docId, 'pdf']);
    if (!item) {
      return res.status(404).json({ success: false, message: '文档不存在' });
    }

    // 分析文档
    const userApiKey = req.body.userApiKey || null;
    const analysis = await analyzeDocument(item.raw_content || '', item.title || '', userApiKey);
    
    // 保存分析结果到数据库（可选）
    // 注意：如果metadata列不存在，这个操作会失败，但不影响主要功能
    try {
      await db.run(
        'UPDATE source_items SET metadata = ? WHERE id = ?',
        [JSON.stringify(analysis), docId]
      );
    } catch (err) {
      // 如果metadata列不存在，只记录警告，不影响主要功能
      if (err.message && err.message.includes('metadata')) {
        console.warn('metadata列不存在，跳过保存分析结果（不影响功能）');
      } else {
        throw err; // 其他错误继续抛出
      }
    }

    res.json({
      success: true,
      data: {
        docId: item.id,
        title: item.title,
        ...analysis
      }
    });
  } catch (error) {
    console.error('分析文档失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '分析文档失败'
    });
  }
});

// 根据用户问题匹配最相关的文档
router.post('/match-document', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ success: false, message: '问题不能为空' });
    }

    // 获取所有PDF文档
    const items = await db.all('SELECT id, title, metadata FROM source_items WHERE type = ? AND status != ?', ['pdf', 'archived']);
    
    if (!items || items.length === 0) {
      return res.json({
        success: true,
        data: { docId: null, relevance: 0, reason: '没有可用文档' }
      });
    }

    // 解析文档元数据
    const documents = items.map(item => {
      let metadata = {};
      try {
        metadata = item.metadata ? JSON.parse(item.metadata) : {};
      } catch (e) {
        // 如果元数据不存在或解析失败，使用默认值
        metadata = {
          category: '通用',
          theme: item.title || '未分类',
          description: '',
          keywords: [],
          role: '知识助手'
        };
      }
      
      return {
        id: item.id,
        title: item.title,
        ...metadata
      };
    });

    // 匹配文档
    const userApiKey = req.body.userApiKey || null;
    const match = await matchDocument(question, documents, userApiKey);
    
    // 获取匹配的文档信息
    const matchedDoc = documents.find(doc => doc.id === match.docId);
    
    res.json({
      success: true,
      data: {
        ...match,
        docInfo: matchedDoc || null
      }
    });
  } catch (error) {
    console.error('匹配文档失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '匹配文档失败'
    });
  }
});

// 生成欢迎消息
router.post('/welcome-message', async (req, res) => {
  try {
    const { docId } = req.body;
    
    if (!docId) {
      return res.status(400).json({ success: false, message: '文档ID不能为空' });
    }

    // 尝试查询metadata，如果列不存在则只查询id和title
    let item;
    try {
      item = await db.get('SELECT id, title, metadata FROM source_items WHERE id = ? AND type = ?', [docId, 'pdf']);
    } catch (err) {
      if (err.message && err.message.includes('metadata')) {
        console.warn('metadata列不存在，使用简化查询');
        item = await db.get('SELECT id, title FROM source_items WHERE id = ? AND type = ?', [docId, 'pdf']);
      } else {
        throw err;
      }
    }
    
    if (!item) {
      return res.status(404).json({ success: false, message: '文档不存在' });
    }

    // 解析元数据
    let metadata = {};
    try {
      // 如果item有metadata字段且不为null/undefined，尝试解析
      if (item.metadata !== null && item.metadata !== undefined) {
        metadata = JSON.parse(item.metadata);
      }
    } catch (e) {
      console.warn(`解析文档 ${docId} 的metadata失败:`, e.message);
    }
    
    // 如果metadata为空，使用默认值
    if (!metadata || Object.keys(metadata).length === 0) {
      metadata = {
        category: '通用',
        theme: item.title || '未分类',
        role: '知识助手'
      };
    }

    // 如果元数据不完整，先分析文档
    const userApiKey = req.body.userApiKey || null;
    if (!metadata.category || !metadata.theme) {
      const itemFull = await db.get('SELECT raw_content FROM source_items WHERE id = ?', [docId]);
      if (itemFull) {
        const analysis = await analyzeDocument(itemFull.raw_content || '', item.title || '', userApiKey);
        metadata = { ...metadata, ...analysis };
      }
    }

    // 生成欢迎消息
    const welcomeMessage = await generateWelcomeMessage({
      title: item.title,
      category: metadata.category || '通用',
      theme: metadata.theme || item.title,
      role: metadata.role || '知识助手'
    }, userApiKey);

    res.json({
      success: true,
      data: {
        welcomeMessage,
        docInfo: {
          id: item.id,
          title: item.title,
          ...metadata
        }
      }
    });
  } catch (error) {
    console.error('生成欢迎消息失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '生成欢迎消息失败'
    });
  }
});

// 咨询对话接口（流式响应）
router.post('/chat', async (req, res) => {
  try {
    const { messages, docId, context, docInfo, enableEvaluation } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: '消息不能为空' });
    }

    // 检查评估开关状态
    let shouldEvaluate = false;
    if (enableEvaluation !== undefined) {
      // 请求级别优先
      shouldEvaluate = enableEvaluation === true || enableEvaluation === 'true';
    } else {
      // 检查全局设置
      const setting = await db.get('SELECT value FROM settings WHERE key = ?', ['enable_relevance_evaluation']);
      shouldEvaluate = !setting || setting.value === 'true' || setting.value === true;
    }

    // 获取PDF内容（如果提供了docId）
    let pdfContent = null;
    if (docId) {
      const item = await db.get('SELECT raw_content, page_content FROM source_items WHERE id = ? AND type = ?', [docId, 'pdf']);
      if (item) {
        pdfContent = item.raw_content;
        // 如果有分页内容，也包含分页信息以便更精确的引用
        if (item.page_content) {
          try {
            const pageContent = typeof item.page_content === 'string' 
              ? JSON.parse(item.page_content) 
              : item.page_content;
            if (Array.isArray(pageContent) && pageContent.length > 0) {
              // 将分页内容也添加到上下文中，格式：Page X: content
              const pageContentStr = pageContent.map((page, idx) => {
                const pageNum = page.pageNum || page.page || (idx + 1);
                const content = page.content || page.text || '';
                return `Page ${pageNum}: ${content}`;
              }).join('\n\n');
              pdfContent = pdfContent + '\n\n--- 分页内容 ---\n\n' + pageContentStr;
            }
          } catch (e) {
            console.warn('解析page_content失败:', e);
          }
        }
      }
    }

    // 设置SSE响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 获取用户API Key
    const userApiKey = req.body.userApiKey || null;
    
    // 调用咨询对话（动态模式，基于文档信息）
    const stream = await consultantChat(messages, pdfContent, context, docInfo, userApiKey);

    // 读取流并发送SSE事件
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let citations = [];
    
    // 获取文档信息用于设置引用
    const docTitle = docInfo?.title || null;
    
    // 获取用户问题（用于评估）
    const userQuestion = messages.length > 0 ? messages[messages.length - 1].content : null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // 流结束，提取所有引用并设置docId
          citations = extractCitations(fullContent, docId, docTitle);
          if (citations.length > 0) {
            res.write(`data: ${JSON.stringify({ content: '', citations: citations })}\n\n`);
          }
          
          // 如果启用评估，执行评估（在发送[DONE]之前）
          if (shouldEvaluate && fullContent && pdfContent) {
            try {
              console.log('开始执行评估，回答长度:', fullContent.length, '知识库长度:', pdfContent.length);
              
              // 获取分页内容用于引用验证
              let pageContent = null;
              if (docId) {
                const item = await db.get('SELECT page_content FROM source_items WHERE id = ? AND type = ?', [docId, 'pdf']);
                if (item && item.page_content) {
                  pageContent = item.page_content;
                }
              }
              
              // 等待评估完成后再发送[DONE]
              try {
                const evaluationResult = await evaluateRelevance(fullContent, pdfContent, citations, pageContent, userQuestion);
                console.log('评估完成，分数:', evaluationResult.overallScore);
                
                // 在响应关闭前发送评估结果
                res.write(`data: ${JSON.stringify({ evaluation: evaluationResult })}\n\n`);
              } catch (evalError) {
                console.error('评估过程出错:', evalError);
                // 评估失败不影响主流程，继续发送[DONE]
              }
            } catch (evalError) {
              console.error('启动评估失败:', evalError);
            }
          }
          
          res.write('data: [DONE]\n\n');
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue; // 跳过空行
          
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              // 流结束，提取所有引用并设置docId
              citations = extractCitations(fullContent, docId, docTitle);
              if (citations.length > 0) {
                res.write(`data: ${JSON.stringify({ content: '', citations: citations })}\n\n`);
              }
              res.write('data: [DONE]\n\n');
              break;
            }
            try {
              const json = JSON.parse(data);
              
              // 检查是否有错误
              if (json.error) {
                res.write(`data: ${JSON.stringify({ error: json.error.message || json.error })}\n\n`);
                res.write('data: [DONE]\n\n');
                break;
              }
              
              if (json.choices && json.choices[0]) {
                // 处理流式内容
                if (json.choices[0].delta && json.choices[0].delta.content) {
                  const content = json.choices[0].delta.content;
                  fullContent += content;
                  
                  // 实时提取引用（增量），但只在完整内容中提取以避免重复
                  // 注意：增量提取可能不准确，所以只在流结束时提取完整引用
                  res.write(`data: ${JSON.stringify({ content: content, citations: [] })}\n\n`);
                }
                
                // 处理完成消息
                if (json.choices[0].finish_reason) {
                  // 流结束，提取所有引用并设置docId
                  citations = extractCitations(fullContent, docId, docTitle);
                  if (citations.length > 0) {
                    res.write(`data: ${JSON.stringify({ content: '', citations: citations })}\n\n`);
                  }
                  
                  // 如果启用评估，执行评估（在发送[DONE]之前）
                  if (shouldEvaluate && fullContent && pdfContent) {
                    try {
                      console.log('开始执行评估，回答长度:', fullContent.length, '知识库长度:', pdfContent.length);
                      
                      // 获取分页内容用于引用验证
                      let pageContent = null;
                      if (docId) {
                        const item = await db.get('SELECT page_content FROM source_items WHERE id = ? AND type = ?', [docId, 'pdf']);
                        if (item && item.page_content) {
                          pageContent = item.page_content;
                        }
                      }
                      
                      // 等待评估完成后再发送[DONE]
                      try {
                        const evaluationResult = await evaluateRelevance(fullContent, pdfContent, citations, pageContent, userQuestion);
                        console.log('评估完成，分数:', evaluationResult.overallScore);
                        
                        // 在响应关闭前发送评估结果
                        res.write(`data: ${JSON.stringify({ evaluation: evaluationResult })}\n\n`);
                      } catch (evalError) {
                        console.error('评估过程出错:', evalError);
                        // 评估失败不影响主流程，继续发送[DONE]
                      }
                    } catch (evalError) {
                      console.error('启动评估失败:', evalError);
                    }
                  }
                  
                  res.write('data: [DONE]\n\n');
                  break;
                }
              }
            } catch (e) {
              // 忽略解析错误（可能是流式数据的分片）
              console.warn('解析SSE数据失败:', data.substring(0, 100));
            }
          }
        }
      }
    } catch (streamError) {
      console.error('读取流时出错:', streamError);
      res.write(`data: ${JSON.stringify({ error: streamError.message || '流式响应处理失败' })}\n\n`);
      res.write('data: [DONE]\n\n');
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // 忽略释放错误
      }
      res.end();
    }
  } catch (error) {
    console.error('咨询对话失败:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message || '咨询对话失败'
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

module.exports = router;

