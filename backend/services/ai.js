const db = require('./db');
const { decryptFromString } = require('./crypto');

/**
 * 获取DeepSeek API Key
 * @param {string} userApiKey - 用户提供的API Key（可选，优先使用）
 */
async function getApiKey(userApiKey = null) {
  // 如果用户提供了API Key，优先使用
  if (userApiKey && userApiKey.startsWith('sk-')) {
    return userApiKey;
  }
  
  // 否则使用全局配置的API Key（向后兼容）
  const setting = await db.get('SELECT value FROM settings WHERE key = ?', ['deepseek_api_key']);
  if (!setting) {
    throw new Error('未配置DeepSeek API Key，请在设置中配置');
  }
  const apiKey = decryptFromString(setting.value);
  if (!apiKey) {
    throw new Error('API Key解密失败，请重新配置');
  }
  return apiKey;
}

/**
 * 获取模型配置
 */
async function getModel() {
  const setting = await db.get('SELECT value FROM settings WHERE key = ?', ['deepseek_model']);
  return setting ? setting.value : 'deepseek-chat';
}

/**
 * 调用DeepSeek API
 * @param {Array} messages - 消息数组
 * @param {Object} options - 选项
 * @param {string} options.userApiKey - 用户提供的API Key（可选）
 */
async function callDeepSeekAPI(messages, options = {}) {
  let apiKey;
  let model;
  
  try {
    apiKey = await getApiKey(options.userApiKey);
    model = await getModel();
  } catch (keyError) {
    console.error('[AI] ❌ API Key获取失败', {
      error: keyError.message,
      hasUserApiKey: !!options.userApiKey,
      userApiKeyPreview: options.userApiKey ? `${options.userApiKey.substring(0, 8)}...` : 'none',
      stack: keyError.stack
    });
    throw keyError;
  }

  const requestBody = {
    model: model,
    messages: messages,
    temperature: options.temperature || 0.7,
    max_tokens: options.max_tokens || 2000,
    stream: options.stream || false
  };

  // 记录请求信息（不记录完整API Key）
  console.log('[AI] 准备调用DeepSeek API', {
    model,
    messagesCount: messages.length,
    maxTokens: requestBody.max_tokens,
    temperature: requestBody.temperature,
    hasApiKey: !!apiKey,
    apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : 'none',
    hasUserApiKey: !!options.userApiKey
  });

  try {
    const startTime = Date.now();
    // 增加超时设置（Railway环境和大文档需要更长时间）
    // 对于知识提取任务，使用更长的超时（180秒）
    // 普通任务60秒，知识提取任务180秒
    const timeoutMs = options.timeout || 120000; // 默认120秒（2分钟），知识提取任务可指定180秒
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `API请求失败: ${response.status}`;
      
      console.error('[AI] ❌ DeepSeek API调用失败', {
        status: response.status,
        statusText: response.statusText,
        error: errorMessage,
        errorData: errorData.error || errorData,
        duration,
        model,
        messagesCount: messages.length
      });
      
      if (response.status === 401) {
        throw new Error('API Key无效，请检查配置');
      } else if (response.status === 429) {
        throw new Error('请求频率过高，请稍后重试');
      } else {
        throw new Error(errorMessage);
      }
    }

    if (options.stream) {
      console.log('[AI] ✅ DeepSeek API调用成功（流式）', { duration, model });
      return response.body; // 返回流对象
    } else {
      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      
      console.log('[AI] ✅ DeepSeek API调用成功', {
        duration,
        model,
        contentLength: content ? content.length : 0,
        tokensUsed: data.usage?.total_tokens || 'unknown'
      });
      
      if (!content) {
        console.error('[AI] ❌ API响应中没有content字段', {
          responseData: JSON.stringify(data).substring(0, 500),
          choices: data.choices
        });
        throw new Error('API响应格式错误：缺少content字段');
      }
      
      return content;
    }
  } catch (error) {
    // 增强错误日志
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      console.error('[AI] ❌ DeepSeek API调用超时', {
        error: error.message,
        model,
        messagesCount: messages.length,
        possibleCauses: [
          '网络连接问题',
          'Railway服务网络限制',
          'API服务响应慢',
          '请求内容过大'
        ]
      });
      throw new Error('API调用超时，请检查网络连接或稍后重试');
    } else if (error.message.includes('fetch failed') || error.message.includes('network')) {
      console.error('[AI] ❌ DeepSeek API网络连接失败', {
        error: error.message,
        model,
        possibleCauses: [
          'Railway服务无法访问api.deepseek.com',
          '网络防火墙限制',
          'DNS解析失败'
        ]
      });
      throw new Error('无法连接到DeepSeek API，请检查网络连接');
    } else if (error.message.includes('API Key')) {
      console.error('[AI] ❌ API Key相关错误', {
        error: error.message,
        hasApiKey: !!apiKey,
        apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : 'none'
      });
      throw error;
    } else {
      console.error('[AI] ❌ DeepSeek API调用失败', {
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        model,
        messagesCount: messages.length
      });
      throw new Error(`调用DeepSeek API失败: ${error.message}`);
    }
  }
}

/**
 * 生成摘要
 * @param {string} content - 内容
 * @param {string} itemId - 项目ID（可选）
 * @param {string} userApiKey - 用户API Key（可选）
 */
async function generateSummary(content, itemId = null, userApiKey = null) {
  const messages = [
    {
      role: 'system',
      content: '你是一个专业的知识管理助手，擅长总结和提炼文章的核心观点。请用简洁的中文总结以下内容，突出关键信息和要点。'
    },
    {
      role: 'user',
      content: `请为以下内容生成摘要：\n\n${content.substring(0, 30000)}` // 限制长度
    }
  ];

  const summary = await callDeepSeekAPI(messages, {
    max_tokens: 500,
    temperature: 0.5,
    userApiKey
  });

  // 如果提供了itemId，自动保存摘要
  if (itemId) {
    await db.run(
      'UPDATE source_items SET summary_ai = ?, updated_at = ? WHERE id = ?',
      [summary, Date.now(), itemId]
    );
  }

  return summary;
}

/**
 * AI对话（流式响应）
 * @param {Array} messages - 消息数组
 * @param {string} context - 上下文（可选）
 * @param {string} userApiKey - 用户API Key（可选）
 */
async function chat(messages, context = null, userApiKey = null) {
  // 如果有上下文，添加到系统消息
  if (context) {
    const systemMessage = {
      role: 'system',
      content: `你是一个知识管理助手。当前用户正在阅读以下内容，请基于此内容回答用户的问题：\n\n${context.substring(0, 20000)}`
    };
    messages = [systemMessage, ...messages];
  }

  return callDeepSeekAPI(messages, {
    stream: true,
    max_tokens: 2000,
    userApiKey
  });
}

/**
 * 标签建议
 */
async function suggestTags(content, userApiKey = null) {
  const messages = [
    {
      role: 'system',
      content: '你是一个标签生成助手。请根据内容生成3-5个简洁的中文标签，用逗号分隔。标签应该是名词或短语，长度不超过4个字。'
    },
    {
      role: 'user',
      content: `请为以下内容生成标签：\n\n${content.substring(0, 10000)}`
    }
  ];

  const tagsStr = await callDeepSeekAPI(messages, {
    max_tokens: 100,
    temperature: 0.8,
    userApiKey
  });

  // 解析标签字符串
  const tags = tagsStr.split(/[,，、]/).map(t => t.trim()).filter(t => t);
  return tags.slice(0, 5); // 最多返回5个
}

/**
 * 测试API连接
 */
async function testConnection(apiKey = null) {
  let testKey = apiKey;
  
  if (!testKey) {
    testKey = await getApiKey();
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${testKey}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, message: 'API Key无效' };
      }
      return { success: false, message: `连接失败: ${response.status}` };
    }

    return { success: true, message: '连接成功' };
  } catch (error) {
    return { success: false, message: `连接失败: ${error.message}` };
  }
}

/**
 * 咨询顾问对话（流式响应）- 动态模式
 * @param {Array} messages - 对话消息数组
 * @param {string} pdfContent - PDF内容（可选）
 * @param {Object} context - 用户背景信息（可选）
 * @param {Object} docInfo - 文档信息 { title, category, theme, role }（可选）
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<ReadableStream>}
 */
async function consultantChat(messages, pdfContent = null, context = null, docInfo = null, userApiKey = null) {
  // 动态生成System Prompt
  let systemPrompt = '';

  if (!docInfo && !pdfContent) {
    // 没有文档信息，作为通用助手
    systemPrompt = `你是一个专业的知识助手，基于知识库回答用户的问题。

**回答格式要求：**
1. **简洁回答**：直接给出核心要点（3-5个），每个要点1-2句话，避免冗长解释

2. **基于知识库**：如果有知识库内容，优先基于知识库回答；如果没有，基于你的知识回答

3. **专业准确**：确保回答准确、专业，避免误导用户

保持专业、简洁的语气。`;
  } else {
    // 有文档信息，基于文档内容回答
    const docTitle = docInfo?.title || '知识库文档';
    const docCategory = docInfo?.category || '通用';
    const docTheme = docInfo?.theme || docTitle;
    const assistantRole = docInfo?.role || '知识助手';
    const contextStr = context ? JSON.stringify(context) : '{}';
    
    systemPrompt = `你是一个专业的知识助手，基于知识库回答用户的问题。

**回答格式要求：**
1. **简洁回答**：直接给出核心要点（3-5个），每个要点1-2句话，避免冗长解释

2. **引用标注**：引用文档内容时使用 [Page X] 格式，引用标记紧跟在相关内容之后

3. **基于文档**：严格基于提供的文档内容回答，不要使用文档中没有的信息

4. **专业准确**：确保回答准确、专业，避免误导用户

**文档主题：** ${docTheme}
**当前用户背景：** ${contextStr}

${pdfContent ? `\n\n**文档内容（请严格基于此内容回答）：**\n${pdfContent.substring(0, 50000)}` : '**警告：未提供文档内容，请告知用户需要先加载知识库文档。**'}`;
  }
  
  // 构建消息
  const systemMessage = {
    role: 'system',
    content: systemPrompt
  };
  
  const allMessages = [systemMessage, ...messages];
  
  return callDeepSeekAPI(allMessages, {
    stream: true,
    max_tokens: 1000,
    temperature: 0.5,
    userApiKey
  });
}

/**
 * 从AI返回文本中提取引用
 * @param {string} text - AI返回的文本
 * @param {string} docId - 文档ID（可选）
 * @param {string} docTitle - 文档标题（可选）
 * @returns {Array} 引用数组 [{ docId, page, text, docTitle }]
 */
function extractCitations(text, docId = null, docTitle = null) {
  const citations = [];
  
  if (!text || typeof text !== 'string') {
    return citations;
  }
  
  // 匹配格式：
  // 1. [文档名 - Page X] 或 [文档名 - 第X页]
  // 2. [Page X] 或 [第X页]
  // 3. [PX] 或 [P.X] 或 [P X]
  // 4. 页码：Page X 或 第X页（在句子末尾）
  const citationRegex = /\[([^\]]+)\s*[-–—]\s*(?:Page|页|第)\s*(\d+)\]|\[(?:Page|页|第)\s*(\d+)\]|\[P[.\s]*(\d+)\]|(?:Page|页|第)\s*(\d+)(?=\s*[。，、；：！？\n]|$)/gi;
  let match;
  const seen = new Set(); // 用于去重
  
  while ((match = citationRegex.exec(text)) !== null) {
    // 提取页码（尝试多个匹配组）
    const page = match[2] ? parseInt(match[2]) : 
                 (match[3] ? parseInt(match[3]) : 
                 (match[4] ? parseInt(match[4]) : 
                 (match[5] ? parseInt(match[5]) : null)));
    
    if (!page || isNaN(page)) continue;
    
    const docName = match[1] || docTitle || '';
    
    // 创建唯一标识符用于去重
    const uniqueKey = `${page}-${docName || docId || 'default'}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    
    // 提取引用文本（引用标记前后的更多上下文）
    const startIndex = Math.max(0, match.index - 100);
    const endIndex = Math.min(text.length, match.index + match[0].length + 100);
    let quoteText = text.substring(startIndex, endIndex).trim();
    
    // 清理引用文本，移除引用标记本身
    quoteText = quoteText.replace(/\[[^\]]*\]/g, '').trim();
    // 移除多余的空白字符和换行
    quoteText = quoteText.replace(/\s+/g, ' ').substring(0, 200);
    
    if (quoteText && quoteText.length > 10) { // 确保有足够的文本
      citations.push({
        docId: docId, // 设置文档ID
        page: page,
        text: quoteText,
        fullMatch: match[0],
        docName: docName,
        docTitle: docTitle || docName || '文档' // 设置文档标题
      });
    }
  }
  
  return citations;
}

/**
 * 分析文档主题和分类（使用AI）
 * @param {string} content - 文档内容
 * @param {string} title - 文档标题
 * @returns {Promise<Object>} { category, theme, description, keywords }
 */
async function analyzeDocument(content, title = '', userApiKey = null) {
  const sampleContent = content.substring(0, 10000); // 限制长度以提高效率
  
  const messages = [
    {
      role: 'system',
      content: `你是一个文档分析专家。请分析以下文档，识别其主题、分类和关键信息。

请以JSON格式返回分析结果，格式如下：
{
  "category": "文档的主要分类（如：团队管理、品牌营销、财务管理等，用简洁的中文）",
  "theme": "文档的核心主题（一句话概括）",
  "description": "文档的简要描述（50字以内）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "role": "适合的助手角色名称（如：团队管理助手、品牌营销助手等）"
}

只返回JSON，不要其他文字。`
    },
    {
      role: 'user',
      content: `文档标题：${title}\n\n文档内容：\n${sampleContent}`
    }
  ];

  try {
    const response = await callDeepSeekAPI(messages, {
      max_tokens: 500,
      temperature: 0.3,
      userApiKey
    });
    
    // 尝试解析JSON响应
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // 如果解析失败，返回默认值
    return {
      category: '通用',
      theme: title || '未分类文档',
      description: '文档内容分析中...',
      keywords: [],
      role: '知识助手'
    };
  } catch (error) {
    console.error('分析文档失败:', error);
    return {
      category: '通用',
      theme: title || '未分类文档',
      description: '文档内容分析中...',
      keywords: [],
      role: '知识助手'
    };
  }
}

/**
 * 根据用户问题匹配最相关的文档
 * @param {string} question - 用户问题
 * @param {Array} documents - 文档列表 [{ id, title, category, theme, description, keywords }]
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<Object>} { docId, relevance, reason }
 */
async function matchDocument(question, documents, userApiKey = null) {
  if (!documents || documents.length === 0) {
    return { docId: null, relevance: 0, reason: '没有可用文档' };
  }

  // 构建文档摘要
  const docsSummary = documents.map((doc, idx) => {
    return `${idx + 1}. 标题：${doc.title}\n   分类：${doc.category || '未分类'}\n   主题：${doc.theme || ''}\n   描述：${doc.description || ''}\n   关键词：${doc.keywords?.join('、') || ''}`;
  }).join('\n\n');

  const messages = [
    {
      role: 'system',
      content: `你是一个智能文档匹配专家。根据用户的问题，从以下文档列表中选择最相关的一个。

请以JSON格式返回结果，格式如下：
{
  "index": 文档编号（从1开始）,
  "relevance": 相关度评分（0-100）,
  "reason": "选择理由（简短说明）"
}

只返回JSON，不要其他文字。`
    },
    {
      role: 'user',
      content: `用户问题：${question}\n\n可用文档：\n${docsSummary}\n\n请选择最相关的文档。`
    }
  ];

  try {
    const response = await callDeepSeekAPI(messages, {
      max_tokens: 200,
      temperature: 0.3,
      userApiKey
    });
    
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const docIndex = (result.index || 1) - 1;
      if (docIndex >= 0 && docIndex < documents.length) {
        return {
          docId: documents[docIndex].id,
          relevance: result.relevance || 50,
          reason: result.reason || '匹配成功'
        };
      }
    }
    
    // 如果解析失败，返回第一个文档
    return {
      docId: documents[0].id,
      relevance: 50,
      reason: '自动匹配'
    };
  } catch (error) {
    console.error('匹配文档失败:', error);
    // 降级到关键词匹配
    const questionLower = question.toLowerCase();
    for (const doc of documents) {
      const keywords = doc.keywords || [];
      const title = (doc.title || '').toLowerCase();
      const theme = (doc.theme || '').toLowerCase();
      
      if (keywords.some(k => questionLower.includes(k.toLowerCase())) ||
          questionLower.includes(title) ||
          questionLower.includes(theme)) {
        return {
          docId: doc.id,
          relevance: 60,
          reason: '关键词匹配'
        };
      }
    }
    
    return {
      docId: documents[0]?.id || null,
      relevance: 30,
      reason: '默认匹配'
    };
  }
}

/**
 * 动态生成助手欢迎消息
 * @param {Object} docInfo - 文档信息 { title, category, theme, role }
 * @returns {string} 欢迎消息
 */
async function generateWelcomeMessage(docInfo, userApiKey = null) {
  const { title, category, theme, role } = docInfo;
  
  const messages = [
    {
      role: 'system',
      content: '你是一个友好的AI助手。根据文档信息生成一段欢迎消息，介绍你能帮助用户解决什么问题。消息要简洁、友好、易懂。'
    },
    {
      role: 'user',
      content: `文档标题：${title}\n分类：${category}\n主题：${theme}\n助手角色：${role}\n\n请生成一段欢迎消息（100字以内），告诉用户我能帮助他们解决什么问题。`
    }
  ];

  try {
    const response = await callDeepSeekAPI(messages, {
      max_tokens: 200,
      temperature: 0.7,
      userApiKey
    });
    return response.trim();
  } catch (error) {
    console.error('生成欢迎消息失败:', error);
    return `您好！我是${role}，可以基于《${title}》为您解答相关问题。请告诉我您的问题。`;
  }
}

module.exports = {
  generateSummary,
  chat,
  consultantChat,
  suggestTags,
  testConnection,
  callDeepSeekAPI,
  extractCitations,
  analyzeDocument,
  matchDocument,
  generateWelcomeMessage,
  getApiKey
};

