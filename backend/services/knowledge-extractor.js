const { callDeepSeekAPI } = require('./ai');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

/**
 * 从文档内容中提取知识点
 * @param {string} content - 文档内容
 * @param {string} sourceItemId - 来源文档ID
 * @param {number} sourcePage - 来源页码（可选）
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<Array>} 提取的知识点数组
 */
async function extractKnowledgeFromContent(content, sourceItemId, sourcePage = null, userApiKey = null) {
  if (!content || content.trim().length === 0) {
    return [];
  }

  // 限制内容长度（避免超出API限制）
  const maxLength = 30000;
  const contentSample = content.length > maxLength 
    ? content.substring(0, maxLength) + '\n\n[内容已截断...]'
    : content;

  const messages = [
    {
      role: 'system',
      content: `你是一个知识提取专家。请从以下文档内容中提取关键知识点。

提取要求：
1. 提取核心概念、要点、规则、方法等关键信息
2. 每个知识点应该独立、完整、有意义
3. 为每个知识点生成简洁的标题和详细描述
4. 评估每个知识点的置信度（0-100分）
5. 从内容中提取关键结论（2-5个）
6. 为每个知识点生成相关标签（2-5个）

输出格式（JSON数组）：
[
  {
    "title": "知识点标题",
    "content": "知识点详细内容",
    "summary": "简短摘要（可选）",
    "keyConclusions": ["关键结论1", "关键结论2"],
    "confidence": 85,
    "tags": ["标签1", "标签2"],
    "sourceExcerpt": "原文片段"
  }
]

只返回JSON数组，不要其他文字。`
    },
    {
      role: 'user',
      content: `请从以下文档内容中提取关键知识点：\n\n${contentSample}`
    }
  ];

  try {
    const response = await callDeepSeekAPI(messages, {
      max_tokens: 4000,
      temperature: 0.3,
      userApiKey
    });

    // 尝试解析JSON响应
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let jsonString = jsonMatch[0];
      
      // 尝试解析JSON，如果失败则尝试修复
      let knowledgeItems;
      try {
        knowledgeItems = JSON.parse(jsonString);
      } catch (parseError) {
        // 如果解析失败，尝试修复常见的JSON问题
        try {
          // 方法1：清理字符串值外的控制字符（在JSON结构中的换行、制表等）
          // 使用更保守的方法：只清理明显不在字符串值中的控制字符
          jsonString = jsonString
            // 移除对象/数组结束前的换行和空格
            .replace(/\n\s*(?=[}\]])/g, '')
            // 移除对象/数组开始后的换行和空格
            .replace(/(?<=[{\[])\s*\n/g, '')
            // 将逗号后的换行和空格替换为单个空格
            .replace(/,\s*\n\s*/g, ', ')
            // 将冒号后的换行和空格替换为单个空格
            .replace(/:\s*\n\s*/g, ': ');
          
          knowledgeItems = JSON.parse(jsonString);
        } catch (secondError) {
          // 如果还是失败，尝试使用eval（不推荐但作为最后手段）
          // 或者尝试手动修复字符串值中的控制字符
          try {
            // 使用更安全的方法：逐字符处理，识别字符串边界
            let fixedJson = '';
            let inString = false;
            let escapeNext = false;
            
            for (let i = 0; i < jsonString.length; i++) {
              const char = jsonString[i];
              
              if (escapeNext) {
                fixedJson += char;
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                fixedJson += char;
                continue;
              }
              
              if (char === '"') {
                inString = !inString;
                fixedJson += char;
                continue;
              }
              
              if (inString) {
                // 在字符串值中，转义控制字符
                if (char === '\n') fixedJson += '\\n';
                else if (char === '\r') fixedJson += '\\r';
                else if (char === '\t') fixedJson += '\\t';
                else if (char === '\f') fixedJson += '\\f';
                else if (char === '\b') fixedJson += '\\b';
                else fixedJson += char;
              } else {
                // 在JSON结构中，移除控制字符
                if (!/[\n\r\t\f\b]/.test(char)) {
                  fixedJson += char;
                }
              }
            }
            
            knowledgeItems = JSON.parse(fixedJson);
          } catch (thirdError) {
            // 最后尝试：使用更宽松的JSON清理
            try {
              // 移除所有未转义的控制字符（除了在已转义的序列中）
              let cleanedJson = jsonString
                .replace(/(?<!\\)\n/g, '\\n')  // 转义未转义的换行
                .replace(/(?<!\\)\r/g, '\\r')  // 转义未转义的回车
                .replace(/(?<!\\)\t/g, '\\t')  // 转义未转义的制表符
                .replace(/(?<!\\)\f/g, '\\f')  // 转义未转义的换页
                .replace(/(?<!\\)\b/g, '\\b'); // 转义未转义的退格
              
              knowledgeItems = JSON.parse(cleanedJson);
            } catch (finalError) {
              console.error('JSON解析失败，原始响应（前1000字符）:', response.substring(0, 1000));
              console.error('提取的JSON字符串（前1000字符）:', jsonString.substring(0, 1000));
              console.error('所有解析错误:', {
                first: parseError.message,
                second: secondError.message,
                third: thirdError.message,
                final: finalError.message
              });
              // 返回空数组而不是抛出错误，让提取流程继续
              return [];
            }
          }
        }
      }
      
      // 验证和清洗数据
      return knowledgeItems
        .filter(item => item.title && item.content)
        .map(item => ({
          title: item.title.trim(),
          content: item.content.trim(),
          summary: item.summary ? item.summary.trim() : null,
          keyConclusions: Array.isArray(item.keyConclusions) ? item.keyConclusions : [],
          confidence: Math.min(Math.max(item.confidence || 70, 0), 100),
          tags: Array.isArray(item.tags) ? item.tags.slice(0, 5) : [],
          sourceExcerpt: item.sourceExcerpt ? item.sourceExcerpt.trim() : null,
          sourceItemId,
          sourcePage
        }));
    }

    // 如果解析失败，返回空数组
    console.warn('知识提取响应解析失败:', response.substring(0, 200));
    return [];
  } catch (error) {
    console.error('知识提取失败:', error);
    throw new Error(`知识提取失败: ${error.message}`);
  }
}

/**
 * 保存知识点到数据库
 * @param {Object} knowledgeItem - 知识点对象
 * @param {string} knowledgeBaseId - 知识库ID
 * @returns {Promise<string>} 保存的知识点ID
 */
async function saveKnowledgeItem(knowledgeItem, knowledgeBaseId) {
  const id = `ki-${uuidv4().split('-')[0]}`;
  const now = Date.now();
  
  // 所有提取的知识默认需要审核
  const status = 'pending';

  // 使用新的子分类词向量距离分类算法
  let category = 'work';
  let subcategory_id = null;
  
  if (knowledgeItem.tags && Array.isArray(knowledgeItem.tags) && knowledgeItem.tags.length > 0) {
    try {
      // 获取所有子分类
      const subcategories = await db.all(
        `SELECT id, category, name, keywords FROM category_subcategories 
         ORDER BY category, order_index ASC`
      );
      
      if (subcategories.length > 0) {
        // 计算相似度
        let bestMatch = null;
        let bestSimilarity = 0;
        
        for (const subcat of subcategories) {
          const keywords = JSON.parse(subcat.keywords || '[]');
          let totalWeight = 0;
          
          knowledgeItem.tags.forEach(tag => {
            keywords.forEach(keyword => {
              if (tag === keyword) {
                totalWeight += 2; // 完全匹配权重2
              } else if (tag.includes(keyword) || keyword.includes(tag)) {
                totalWeight += 1; // 部分匹配权重1
              }
            });
          });
          
          const similarity = totalWeight / (keywords.length + knowledgeItem.tags.length);
          
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = subcat;
          }
        }
        
        // 如果相似度太低，使用默认分类的第一个子分类
        if (bestMatch && bestSimilarity >= 0.1) {
          category = bestMatch.category;
          subcategory_id = bestMatch.id;
        } else {
          // 使用work分类的第一个子分类
          const defaultSubcat = await db.get(
            `SELECT id, category FROM category_subcategories 
             WHERE category = 'work' 
             ORDER BY order_index ASC LIMIT 1`
          );
          if (defaultSubcat) {
            category = defaultSubcat.category;
            subcategory_id = defaultSubcat.id;
          }
        }
      } else {
        // 没有子分类，使用简单的标签映射
        const TAG_TO_CATEGORY_MAP = {
          '工作': 'work', '职场': 'work', '职业': 'work', '业务': 'work', '项目': 'work',
          '管理': 'work', '团队': 'work', '领导': 'work', '会议': 'work', '报告': 'work',
          '学习': 'learning', '教育': 'learning', '课程': 'learning', '培训': 'learning',
          '知识': 'learning', '技能': 'learning', '阅读': 'learning', '研究': 'learning',
          '学术': 'learning', '考试': 'learning', '笔记': 'learning',
          '娱乐': 'leisure', '游戏': 'leisure', '电影': 'leisure', '音乐': 'leisure',
          '旅行': 'leisure', '旅游': 'leisure', '运动': 'leisure', '健身': 'leisure',
          '美食': 'leisure', '购物': 'leisure', '兴趣': 'leisure', '爱好': 'leisure',
          '生活': 'life', '家庭': 'life', '健康': 'life', '医疗': 'life', '养生': 'life',
          '理财': 'life', '投资': 'life', '房产': 'life', '装修': 'life', '育儿': 'life',
          '情感': 'life', '人际关系': 'life', '社交': 'life'
        };
        const categoryCounts = { work: 0, learning: 0, leisure: 0, life: 0 };
        knowledgeItem.tags.forEach(tag => {
          const cat = TAG_TO_CATEGORY_MAP[tag];
          if (cat) categoryCounts[cat]++;
        });
        const maxCategory = Object.keys(categoryCounts).reduce((a, b) => 
          categoryCounts[a] > categoryCounts[b] ? a : b
        );
        category = categoryCounts[maxCategory] > 0 ? maxCategory : 'work';
      }
    } catch (error) {
      console.warn('分类失败，使用默认分类:', error.message);
      category = 'work';
    }
  }

  await db.run(
    `INSERT INTO personal_knowledge_items 
     (id, title, content, summary, key_conclusions, source_item_id, source_page, 
      source_excerpt, confidence_score, status, category, subcategory_id, tags, knowledge_base_id, 
      created_at, updated_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      knowledgeItem.title,
      knowledgeItem.content,
      knowledgeItem.summary || null,
      JSON.stringify(knowledgeItem.keyConclusions || []),
      knowledgeItem.sourceItemId,
      knowledgeItem.sourcePage || null,
      knowledgeItem.sourceExcerpt || null,
      knowledgeItem.confidence,
      status,
      category,
      subcategory_id,
      JSON.stringify(knowledgeItem.tags || []),
      knowledgeBaseId,
      now,
      now,
      JSON.stringify({})
    ]
  );

  // 如果知识点有关联的文档，标记文档为已提取
  if (knowledgeItem.sourceItemId) {
    try {
      // 使用兼容SQLite和PostgreSQL的语法
      // SQLite使用INTEGER，PostgreSQL使用BOOLEAN，但在db层会自动转换
      const DATABASE_URL = process.env.DATABASE_URL;
      const DB_TYPE = process.env.DB_TYPE;
      const isPostgreSQL = DATABASE_URL || DB_TYPE === 'postgres';
      
      if (isPostgreSQL) {
        await db.run(
          `UPDATE source_items SET knowledge_extracted = TRUE, updated_at = ? WHERE id = ?`,
          [now, knowledgeItem.sourceItemId]
        );
      } else {
        await db.run(
          `UPDATE source_items SET knowledge_extracted = 1, updated_at = ? WHERE id = ?`,
          [now, knowledgeItem.sourceItemId]
        );
      }
    } catch (error) {
      // 如果字段不存在或更新失败，只记录警告，不影响知识点保存
      console.warn('标记文档为已提取失败:', error.message);
    }
  }

  return id;
}

/**
 * 计算两个知识点之间的相似度
 * @param {Object} item1 - 知识点1
 * @param {Object} item2 - 知识点2
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<number>} 相似度分数（0-100）
 */
async function calculateSimilarity(item1, item2, userApiKey = null) {
  // 标签匹配（权重20%）
  const tags1 = new Set(Array.isArray(item1.tags) ? item1.tags : JSON.parse(item1.tags || '[]'));
  const tags2 = new Set(Array.isArray(item2.tags) ? item2.tags : JSON.parse(item2.tags || '[]'));
  const commonTags = [...tags1].filter(tag => tags2.has(tag));
  const tagSimilarity = tags1.size > 0 || tags2.size > 0
    ? (commonTags.length / Math.max(tags1.size, tags2.size)) * 100
    : 0;

  // 分类匹配（权重10%）
  const categorySimilarity = item1.category === item2.category && item1.category
    ? 100
    : 0;

  // 语义相似度（权重70%）
  let semanticSimilarity = 0;
  try {
    const content1 = `${item1.title} ${item1.content}`.substring(0, 2000);
    const content2 = `${item2.title} ${item2.content}`.substring(0, 2000);

    const messages = [
      {
        role: 'system',
        content: '你是一个相似度评估专家。请评估两个知识点之间的语义相似度，返回0-100的分数。只返回数字，不要其他文字。'
      },
      {
        role: 'user',
        content: `知识点1：${content1}\n\n知识点2：${content2}\n\n请评估这两个知识点的语义相似度（0-100分）：`
      }
    ];

    const response = await callDeepSeekAPI(messages, {
      max_tokens: 50,
      temperature: 0.1,
      userApiKey
    });

    const scoreMatch = response.match(/\d+/);
    if (scoreMatch) {
      semanticSimilarity = Math.min(Math.max(parseInt(scoreMatch[0]), 0), 100);
    }
  } catch (error) {
    // 如果错误是因为未配置API Key，使用基于文本相似度的简单计算
    if (error.message && error.message.includes('未配置DeepSeek API Key')) {
      // 使用简单的文本匹配作为后备方案
      const text1 = `${item1.title} ${item1.content}`.toLowerCase();
      const text2 = `${item2.title} ${item2.content}`.toLowerCase();
      const words1 = text1.split(/\s+/).filter(w => w.length > 1);
      const words2 = text2.split(/\s+/).filter(w => w.length > 1);
      const commonWords = words1.filter(w => words2.includes(w));
      const similarity = words1.length > 0 && words2.length > 0
        ? (commonWords.length / Math.max(words1.length, words2.length)) * 100
        : 0;
      semanticSimilarity = Math.min(Math.max(similarity, 0), 100);
    } else {
      console.warn('语义相似度计算失败，使用默认值:', error.message);
      semanticSimilarity = 50; // 默认中等相似度
    }
  }

  // 综合评分
  const finalScore = Math.round(
    semanticSimilarity * 0.7 +
    tagSimilarity * 0.2 +
    categorySimilarity * 0.1
  );

  return finalScore;
}

/**
 * 获取相关知识推荐
 * @param {string} knowledgeItemId - 当前知识点ID
 * @param {number} limit - 返回数量（默认5）
 * @param {number} minSimilarity - 最低相似度（默认60）
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<Array>} 相关知识列表
 */
async function getRelatedKnowledge(knowledgeItemId, limit = 5, minSimilarity = 60, userApiKey = null) {
  // 获取当前知识点
  const currentItem = await db.get(
    'SELECT * FROM personal_knowledge_items WHERE id = ?',
    [knowledgeItemId]
  );

  if (!currentItem) {
    return [];
  }

  // 获取同一知识库中的其他知识点
  const otherItems = await db.all(
    `SELECT * FROM personal_knowledge_items 
     WHERE id != ? AND knowledge_base_id = ? AND status = 'confirmed'
     ORDER BY created_at DESC
     LIMIT 20`,
    [knowledgeItemId, currentItem.knowledge_base_id]
  );

  if (otherItems.length === 0) {
    return [];
  }

  // 计算相似度
  const similarities = [];
  for (const item of otherItems) {
    const similarity = await calculateSimilarity(currentItem, item, userApiKey);
    if (similarity >= minSimilarity) {
      similarities.push({
        item,
        similarity
      });
    }
  }

  // 按相似度排序并返回Top N
  similarities.sort((a, b) => b.similarity - a.similarity);
  
  return similarities.slice(0, limit).map(({ item, similarity }) => ({
    id: item.id,
    title: item.title,
    contentPreview: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
    summary: item.summary,
    knowledgeBaseId: item.knowledge_base_id,
    similarityScore: similarity
  }));
}

/**
 * 阶段权重定义
 */
const STAGE_WEIGHTS = {
  parsing: 0.20,      // 20%
  extracting: 0.40,   // 40%
  summarizing: 0.20,  // 20%
  saving: 0.20        // 20%
};

/**
 * 计算当前阶段的进度百分比（0-1）
 * @param {string} stage - 当前阶段
 * @param {number} stageProgress - 阶段内进度（0-1）
 * @returns {number} 该阶段在整个流程中的进度百分比（0-1）
 */
function calculateStageProgress(stage, stageProgress = 0) {
  const stageOrder = ['parsing', 'extracting', 'summarizing', 'saving'];
  const currentStageIndex = stageOrder.indexOf(stage);
  
  if (currentStageIndex === -1) return 0;
  
  // 计算已完成阶段的权重总和
  let completedWeight = 0;
  for (let i = 0; i < currentStageIndex; i++) {
    completedWeight += STAGE_WEIGHTS[stageOrder[i]] || 0;
  }
  
  // 当前阶段的进度
  const currentStageWeight = (STAGE_WEIGHTS[stage] || 0) * stageProgress;
  
  return completedWeight + currentStageWeight;
}

/**
 * 批量提取文档知识
 * @param {Array<string>} itemIds - 文档ID数组
 * @param {string} knowledgeBaseId - 目标知识库ID
 * @param {Object} options - 提取选项
 * @param {string} options.userApiKey - 用户API Key（可选）
 * @returns {Promise<Object>} 提取结果
 */
async function extractFromDocuments(itemIds, knowledgeBaseId, options = {}) {
  const extractionId = options.extractionId || `ext-${uuidv4().split('-')[0]}`;
  const updateProgress = options.updateProgress || (() => {});
  
  // 进度历史记录（用于ETA计算）
  const progressHistory = [];
  const startTime = Date.now();
  
  const results = {
    extractionId,
    totalItems: itemIds.length,
    processedItems: 0,
    extractedCount: 0,
    knowledgeItemIds: [],
    knowledgeItems: [] // 添加已提取的知识点列表
  };

  // 初始化进度（从5%开始，避免一开始就是0%）
  updateProgress({
    extractionId,
    stage: 'parsing',
    processedItems: 0,
    totalItems: itemIds.length,
    extractedCount: 0,
    currentDocIndex: 0,
    progress: 5,
    knowledgeItems: []
  });

  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i];
    const currentDocIndex = i + 1; // 当前处理的文档序号（从1开始）
    
    try {
      // 阶段1: 解析文档
      const parsingStageProgress = 0.5; // 解析中，假设50%完成
      const docStageProgress = calculateStageProgress('parsing', parsingStageProgress);
      const baseProgress = (results.processedItems / itemIds.length) * 100;
      const currentDocProgress = (docStageProgress / itemIds.length) * 100;
      const totalProgress = Math.min(100, Math.max(5, Math.round(baseProgress + currentDocProgress)));
      
      updateProgress({
        extractionId,
        stage: 'parsing',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex,
        progress: totalProgress,
        knowledgeItems: results.knowledgeItems.slice(-5)
      });

      // 获取文档内容
      const item = await db.get(
        'SELECT * FROM source_items WHERE id = ?',
        [itemId]
      );

      if (!item) {
        console.warn(`文档不存在: ${itemId}`);
        results.processedItems++;
        continue;
      }

      // 获取文档内容
      let content = '';
      if (item.type === 'pdf' && item.raw_content) {
        content = item.raw_content;
      } else if (item.raw_content) {
        content = item.raw_content;
      } else {
        console.warn(`文档无内容: ${itemId}`);
        results.processedItems++;
        continue;
      }

      // 阶段2: 提取知识
      const extractingStageProgress = 0.3; // 提取开始，假设30%完成
      const extractingDocProgress = calculateStageProgress('extracting', extractingStageProgress);
      const extractingBaseProgress = (results.processedItems / itemIds.length) * 100;
      const extractingCurrentDocProgress = (extractingDocProgress / itemIds.length) * 100;
      const extractingTotalProgress = Math.min(100, Math.round(extractingBaseProgress + extractingCurrentDocProgress));
      
      updateProgress({
        extractionId,
        stage: 'extracting',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex,
        progress: extractingTotalProgress,
        knowledgeItems: results.knowledgeItems.slice(-5)
      });

      // 提取知识点
      const knowledgeItems = await extractKnowledgeFromContent(
        content,
        itemId,
        null,
        options.userApiKey
      );

      // 阶段3: 生成摘要
      const summarizingStageProgress = 0.5; // 摘要生成中
      const summarizingDocProgress = calculateStageProgress('summarizing', summarizingStageProgress);
      const summarizingBaseProgress = (results.processedItems / itemIds.length) * 100;
      const summarizingCurrentDocProgress = (summarizingDocProgress / itemIds.length) * 100;
      const summarizingTotalProgress = Math.min(100, Math.round(summarizingBaseProgress + summarizingCurrentDocProgress));
      
      updateProgress({
        extractionId,
        stage: 'summarizing',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex,
        progress: summarizingTotalProgress,
        knowledgeItems: knowledgeItems.map(ki => ({
          id: null, // 尚未保存，ID为null
          title: ki.title,
          content: ki.content.substring(0, 100) + '...'
        }))
      });

      // 批量保存知识点（优化：减少数据库操作和进度更新频率）
      const BATCH_SIZE = 5; // 每批保存 5 个知识点
      const PROGRESS_UPDATE_INTERVAL = 3; // 每保存 3 个知识点更新一次进度
      
      for (let j = 0; j < knowledgeItems.length; j += BATCH_SIZE) {
        const batch = knowledgeItems.slice(j, j + BATCH_SIZE);
        
        // 批量保存知识点
        const batchPromises = batch.map(knowledgeItem => 
          saveKnowledgeItem(knowledgeItem, knowledgeBaseId)
        );
        const savedIds = await Promise.all(batchPromises);
        
        // 批量获取保存的知识点详情（减少数据库查询）
        if (savedIds.length > 0) {
          const placeholders = savedIds.map(() => '?').join(',');
          const savedItems = await db.all(
            `SELECT id, title, content FROM personal_knowledge_items WHERE id IN (${placeholders})`,
            savedIds
          );
          
          // 添加到结果
          savedIds.forEach(id => results.knowledgeItemIds.push(id));
          results.extractedCount += savedIds.length;
          
          savedItems.forEach(item => {
            results.knowledgeItems.push({
              id: item.id,
              title: item.title,
              content: item.content.substring(0, 100) + '...'
            });
          });
        }
        
        // 减少进度更新频率：每保存 PROGRESS_UPDATE_INTERVAL 个知识点或批次结束时更新
        const shouldUpdateProgress = (j + batch.length) % PROGRESS_UPDATE_INTERVAL === 0 || 
                                      (j + batch.length) >= knowledgeItems.length;
        
        if (shouldUpdateProgress) {
          const savingStageProgress = Math.min(1, (j + batch.length) / knowledgeItems.length);
          const savingDocProgress = calculateStageProgress('saving', savingStageProgress);
          const savingBaseProgress = (results.processedItems / itemIds.length) * 100;
          const savingCurrentDocProgress = (savingDocProgress / itemIds.length) * 100;
          const savingTotalProgress = Math.min(100, Math.round(savingBaseProgress + savingCurrentDocProgress));
          
          // 记录进度历史（用于ETA计算）
          progressHistory.push({
            progress: savingTotalProgress,
            timestamp: Date.now()
          });
          // 只保留最近10条记录
          if (progressHistory.length > 10) {
            progressHistory.shift();
          }
          
          updateProgress({
            extractionId,
            stage: 'saving',
            processedItems: results.processedItems,
            totalItems: itemIds.length,
            extractedCount: results.extractedCount,
            currentDocIndex,
            progress: savingTotalProgress,
            knowledgeItems: results.knowledgeItems.slice(-5)
          });
        }
      }

      // 文档处理完成
      results.processedItems++;
      
      // 如果还有文档，进入下一个文档的解析阶段
      if (results.processedItems < itemIds.length) {
        const nextDocBaseProgress = (results.processedItems / itemIds.length) * 100;
        const nextDocStageProgress = calculateStageProgress('parsing', 0.1);
        const nextDocCurrentProgress = (nextDocStageProgress / itemIds.length) * 100;
        const nextDocTotalProgress = Math.min(100, Math.round(nextDocBaseProgress + nextDocCurrentProgress));
        
        updateProgress({
          extractionId,
          stage: 'parsing',
          processedItems: results.processedItems,
          totalItems: itemIds.length,
          extractedCount: results.extractedCount,
          currentDocIndex: results.processedItems + 1,
          progress: nextDocTotalProgress,
          knowledgeItems: results.knowledgeItems.slice(-5)
        });
      } else {
        // 所有文档处理完成
        updateProgress({
          extractionId,
          stage: 'saving',
          processedItems: results.processedItems,
          totalItems: itemIds.length,
          extractedCount: results.extractedCount,
          currentDocIndex: results.processedItems,
          progress: 100,
          knowledgeItems: results.knowledgeItems.slice(-5)
        });
      }
    } catch (error) {
      console.error(`提取文档 ${itemId} 失败:`, error);
      results.processedItems++;
      
      // 即使失败也要更新进度
      const errorBaseProgress = (results.processedItems / itemIds.length) * 100;
      updateProgress({
        extractionId,
        stage: 'extracting',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex: results.processedItems,
        progress: Math.min(100, Math.round(errorBaseProgress)),
        knowledgeItems: results.knowledgeItems.slice(-5)
      });
    }
  }

  return results;
}

module.exports = {
  extractKnowledgeFromContent,
  saveKnowledgeItem,
  calculateSimilarity,
  getRelatedKnowledge,
  extractFromDocuments
};

