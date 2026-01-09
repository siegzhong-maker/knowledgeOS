const express = require('express');
const router = express.Router();
const db = require('../services/db');
const { extractFromDocuments, getRelatedKnowledge } = require('../services/knowledge-extractor');
const { v4: uuidv4 } = require('uuid');

// 存储提取任务状态（实际应用中应使用Redis或数据库）
const extractionTasks = new Map();

/**
 * 计算预估剩余时间（ETA）
 * @param {Array} progressHistory - 进度历史记录 [{progress, timestamp}, ...]
 * @param {number} currentProgress - 当前进度（0-100）
 * @param {number} startTime - 任务开始时间
 * @returns {number|null} 预估剩余秒数，如果无法估算则返回null
 */
function calculateETA(progressHistory, currentProgress, startTime) {
  if (progressHistory.length < 2 || currentProgress <= 0 || currentProgress >= 100) {
    return null;
  }
  
  // 计算最近几次更新的平均速度
  const recentHistory = progressHistory.slice(-5); // 使用最近5条记录
  if (recentHistory.length < 2) {
    return null;
  }
  
  // 计算平均每1%所需时间
  let totalTimePerPercent = 0;
  let validPairs = 0;
  
  for (let i = 1; i < recentHistory.length; i++) {
    const prev = recentHistory[i - 1];
    const curr = recentHistory[i];
    const progressDiff = curr.progress - prev.progress;
    const timeDiff = curr.timestamp - prev.timestamp;
    
    if (progressDiff > 0 && timeDiff > 0) {
      totalTimePerPercent += timeDiff / progressDiff;
      validPairs++;
    }
  }
  
  if (validPairs === 0) {
    return null;
  }
  
  const avgSecondsPerPercent = (totalTimePerPercent / validPairs) / 1000; // 转换为秒
  const remainingProgress = 100 - currentProgress;
  const etaSeconds = Math.round(remainingProgress * avgSecondsPerPercent);
  
  // 如果ETA超过1小时或小于0，返回null
  if (etaSeconds > 3600 || etaSeconds < 0) {
    return null;
  }
  
  return etaSeconds;
}

/**
 * 知识提取API
 * POST /api/knowledge/extract
 */
router.post('/extract', async (req, res) => {
  try {
    const { itemIds, knowledgeBaseId, extractionOptions = {}, userApiKey } = req.body;
    
    // 调试：记录 API Key 状态
    console.log('[提取API] 接收提取请求', {
      itemIdsCount: itemIds?.length || 0,
      knowledgeBaseId,
      hasUserApiKey: !!userApiKey,
      userApiKeyPreview: userApiKey ? `${userApiKey.substring(0, 8)}...` : 'none'
    });

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '文档ID列表不能为空'
      });
    }

    // 如果没有指定知识库，使用默认知识库
    let targetKnowledgeBaseId = knowledgeBaseId;
    if (!targetKnowledgeBaseId) {
      const defaultKb = await db.get(
        'SELECT * FROM knowledge_bases WHERE is_default = 1 LIMIT 1'
      );
      if (!defaultKb) {
        const firstKb = await db.get(
          'SELECT * FROM knowledge_bases ORDER BY created_at ASC LIMIT 1'
        );
        if (!firstKb) {
          return res.status(400).json({
            success: false,
            message: '请先创建知识库'
          });
        }
        targetKnowledgeBaseId = firstKb.id;
      } else {
        targetKnowledgeBaseId = defaultKb.id;
      }
    }

    const extractionId = `ext-${uuidv4().split('-')[0]}`;
    const startTime = Date.now();
    
    // 异步执行提取任务
    extractionTasks.set(extractionId, {
      status: 'processing',
      totalItems: itemIds.length,
      processedItems: 0,
      extractedCount: 0,
      knowledgeItemIds: [],
      stage: 'parsing',
      knowledgeItems: [],
      progress: 0,
      currentDocIndex: 0,
      startTime,
      progressHistory: []
    });

    // 进度更新回调
    const updateProgress = (progress) => {
      const currentTask = extractionTasks.get(extractionId);
      if (currentTask) {
        // 确保 knowledgeItemIds 被正确合并（如果 progress 中有新的，使用新的；否则保留旧的）
        const mergedKnowledgeItemIds = progress.knowledgeItemIds !== undefined
          ? progress.knowledgeItemIds
          : (currentTask.knowledgeItemIds || []);
        const mergedKnowledgeItems = progress.knowledgeItems !== undefined
          ? progress.knowledgeItems
          : (currentTask.knowledgeItems || []);
        
        const updatedTask = {
          ...currentTask,
          ...progress,
          knowledgeItemIds: mergedKnowledgeItemIds,
          knowledgeItems: mergedKnowledgeItems,
          status: 'processing'
        };
        
        // 更新进度历史（用于ETA计算）
        if (progress.progress !== undefined) {
          updatedTask.progressHistory = updatedTask.progressHistory || [];
          updatedTask.progressHistory.push({
            progress: progress.progress,
            timestamp: Date.now()
          });
          // 只保留最近20条记录
          if (updatedTask.progressHistory.length > 20) {
            updatedTask.progressHistory.shift();
          }
        }
        
        // 调试日志：只在 knowledgeItemIds 发生变化时记录
        if (progress.knowledgeItemIds !== undefined && 
            JSON.stringify(mergedKnowledgeItemIds) !== JSON.stringify(currentTask.knowledgeItemIds || [])) {
          console.log('[后端] 进度更新：knowledgeItemIds 已更新', {
            extractionId,
            stage: progress.stage,
            oldCount: (currentTask.knowledgeItemIds || []).length,
            newCount: mergedKnowledgeItemIds.length,
            extractedCount: progress.extractedCount || currentTask.extractedCount
          });
        }
        
        extractionTasks.set(extractionId, updatedTask);
      }
    };

    // 异步执行提取（不阻塞响应）
    extractFromDocuments(itemIds, targetKnowledgeBaseId, {
      extractionId,
      userApiKey,
      updateProgress,
      ...extractionOptions
    }).then(result => {
      console.log('[后端] 提取任务完成', {
        extractionId,
        totalItems: result.totalItems,
        processedItems: result.processedItems,
        extractedCount: result.extractedCount,
        knowledgeItemIds: result.knowledgeItemIds || [],
        knowledgeItemIdsLength: result.knowledgeItemIds ? result.knowledgeItemIds.length : 0,
        knowledgeItemsLength: result.knowledgeItems ? result.knowledgeItems.length : 0,
        environment: {
          nodeEnv: process.env.NODE_ENV,
          isRailway: !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID)
        }
      });
      
      // 获取当前任务状态（可能包含进度更新中的 knowledgeItemIds）
      const currentTask = extractionTasks.get(extractionId);
      const finalKnowledgeItemIds = result.knowledgeItemIds && result.knowledgeItemIds.length > 0
        ? result.knowledgeItemIds
        : (currentTask?.knowledgeItemIds || []);
      const finalKnowledgeItems = result.knowledgeItems && result.knowledgeItems.length > 0
        ? result.knowledgeItems
        : (currentTask?.knowledgeItems || []);
      
      console.log('[后端] 最终合并任务状态', {
        extractionId,
        resultKnowledgeItemIds: result.knowledgeItemIds?.length || 0,
        currentTaskKnowledgeItemIds: currentTask?.knowledgeItemIds?.length || 0,
        finalKnowledgeItemIds: finalKnowledgeItemIds.length,
        resultKnowledgeItems: result.knowledgeItems?.length || 0,
        currentTaskKnowledgeItems: currentTask?.knowledgeItems?.length || 0,
        finalKnowledgeItems: finalKnowledgeItems.length
      });
      
      extractionTasks.set(extractionId, {
        ...result,
        knowledgeItemIds: finalKnowledgeItemIds,
        knowledgeItems: finalKnowledgeItems,
        status: 'completed',
        stage: 'completed'
      });
      
      // 验证结果
      if (!finalKnowledgeItemIds || finalKnowledgeItemIds.length === 0) {
        console.warn('[后端] ⚠️ 提取完成但没有知识点ID', {
          extractionId,
          extractedCount: result.extractedCount,
          knowledgeItemsLength: finalKnowledgeItems.length,
          resultKnowledgeItemIds: result.knowledgeItemIds?.length || 0,
          currentTaskKnowledgeItemIds: currentTask?.knowledgeItemIds?.length || 0,
          possibleCauses: [
            'AI未返回知识点数据',
            '知识点保存失败',
            'ID收集逻辑有问题',
            '数据库插入失败但未抛出错误'
          ],
          recommendations: [
            '检查Railway日志中的[提取]和[保存]相关错误',
            '访问 /api/diagnose/extraction 查看详细诊断信息',
            '确认API Key已正确配置',
            '确认数据库表结构正确'
          ]
        });
      } else {
        console.log('[后端] ✅ 提取完成，已保存知识点ID', {
          extractionId,
          knowledgeItemIdsCount: finalKnowledgeItemIds.length,
          extractedCount: result.extractedCount
        });
      }
    }).catch(error => {
      // 增强错误日志，特别针对Railway环境
      const errorDetails = {
        extractionId,
        error: error.message,
        errorStack: error.stack,
        errorName: error.name,
        environment: {
          nodeEnv: process.env.NODE_ENV,
          isRailway: !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
          hasDatabaseUrl: !!process.env.DATABASE_URL
        },
        possibleCauses: {
          apiKey: error.message.includes('API Key') ? 'API Key未配置或无效' : null,
          network: error.message.includes('网络') || error.message.includes('timeout') ? '网络连接问题' : null,
          database: error.message.includes('数据库') || error.message.includes('table') ? '数据库问题' : null,
          ai: error.message.includes('AI') || error.message.includes('DeepSeek') ? 'AI调用失败' : null
        },
        recommendations: [
          '查看Railway日志获取详细错误信息',
          '访问 /api/diagnose/extraction 进行诊断',
          '检查API Key配置',
          '检查数据库连接和表结构'
        ]
      };
      
      console.error('[后端] ❌ 提取任务失败', errorDetails);
      
      extractionTasks.set(extractionId, {
        status: 'failed',
        error: error.message,
        stage: 'failed',
        knowledgeItemIds: [],
        knowledgeItems: [],
        errorDetails: {
          name: error.name,
          message: error.message
        }
      });
    });

    res.json({
      success: true,
      data: {
        extractionId,
        status: 'processing',
        totalItems: itemIds.length,
        processedItems: 0,
        extractedCount: 0
      }
    });
  } catch (error) {
    console.error('知识提取失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '知识提取失败'
    });
  }
});

/**
 * 获取提取状态API
 * GET /api/knowledge/extract/:extractionId/status
 */
router.get('/extract/:extractionId/status', async (req, res) => {
  try {
    const { extractionId } = req.params;
    const task = extractionTasks.get(extractionId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: '提取任务不存在'
      });
    }

    // 如果已完成，获取知识点详情
    let knowledgeItems = [];
    console.log('[后端] 提取任务状态检查', {
      extractionId,
      status: task.status,
      knowledgeItemIds: task.knowledgeItemIds || [],
      knowledgeItemIdsLength: task.knowledgeItemIds ? task.knowledgeItemIds.length : 0,
      knowledgeItemIdsType: Array.isArray(task.knowledgeItemIds) ? 'array' : typeof task.knowledgeItemIds,
      knowledgeItems: task.knowledgeItems || [],
      knowledgeItemsLength: task.knowledgeItems ? task.knowledgeItems.length : 0
    });
    
    if (task.status === 'completed' && task.knowledgeItemIds.length > 0) {
      console.log('[后端] 任务已完成，从数据库获取知识点详情', {
        knowledgeItemIds: task.knowledgeItemIds,
        count: task.knowledgeItemIds.length
      });
      const placeholders = task.knowledgeItemIds.map(() => '?').join(',');
      knowledgeItems = await db.all(
        `SELECT id, title, content FROM personal_knowledge_items WHERE id IN (${placeholders})`,
        task.knowledgeItemIds
      );
      console.log('[后端] 从数据库获取到的知识点', {
        requestedIds: task.knowledgeItemIds,
        foundItems: knowledgeItems.length,
        foundIds: knowledgeItems.map(item => item.id)
      });
    } else if (task.knowledgeItems && task.knowledgeItems.length > 0) {
      console.log('[后端] 使用任务中的 knowledgeItems', {
        count: task.knowledgeItems.length
      });
      knowledgeItems = task.knowledgeItems;
    } else {
      // 任务完成但没有知识点数据，记录详细信息用于调试
      console.warn('[后端] ⚠️ 任务已完成但没有知识点数据', {
        status: task.status,
        extractionId,
        hasKnowledgeItemIds: !!task.knowledgeItemIds,
        knowledgeItemIdsLength: task.knowledgeItemIds ? task.knowledgeItemIds.length : 0,
        hasKnowledgeItems: !!task.knowledgeItems,
        knowledgeItemsLength: task.knowledgeItems ? task.knowledgeItems.length : 0,
        extractedCount: task.extractedCount || 0,
        totalItems: task.totalItems || 0,
        processedItems: task.processedItems || 0,
        error: task.error || null,
        possibleCauses: [
          task.extractedCount === 0 ? 'AI未返回知识点数据或提取失败' : null,
          task.error ? `提取过程出错: ${task.error}` : null,
          '数据保存失败',
          'JSON解析失败'
        ].filter(Boolean),
        recommendations: [
          '查看Railway日志中的[提取]和[保存]相关错误',
          '检查AI调用是否成功',
          '检查数据库表结构是否正确',
          '尝试提取其他文档'
        ]
      });
    }

    // 计算进度百分比（优先使用任务中的progress，否则计算）
    const progress = task.progress !== undefined 
      ? task.progress
      : (task.totalItems > 0 
          ? Math.round((task.processedItems / task.totalItems) * 100)
          : 0);

    // 计算ETA
    const etaSeconds = task.status === 'processing' && task.progressHistory
      ? calculateETA(task.progressHistory, progress, task.startTime || Date.now())
      : null;

    const responseData = {
      status: task.status,
      stage: task.stage || 'extracting',
      totalItems: task.totalItems || 0,
      processedItems: task.processedItems || 0,
      extractedCount: task.extractedCount || 0,
      currentDocIndex: task.currentDocIndex || 0,
      knowledgeItems: knowledgeItems || [],
      knowledgeItemIds: task.knowledgeItemIds || [],
      progress: progress,
      etaSeconds: etaSeconds
    };
    
    // 如果任务完成但没有知识点，添加调试信息
    if (task.status === 'completed' && (task.extractedCount === 0 || (task.knowledgeItemIds && task.knowledgeItemIds.length === 0))) {
      responseData.debugInfo = {
        hasError: !!task.error,
        error: task.error || null,
        hasKnowledgeItemIds: !!task.knowledgeItemIds,
        knowledgeItemIdsLength: task.knowledgeItemIds ? task.knowledgeItemIds.length : 0,
        hasKnowledgeItems: !!task.knowledgeItems,
        knowledgeItemsLength: task.knowledgeItems ? task.knowledgeItems.length : 0,
        recommendation: '查看Railway日志中的[提取]和[保存]相关错误，或访问 /api/diagnose/extraction 查看详细诊断'
      };
    }
    
    console.log('[后端] 返回提取状态响应', {
      extractionId,
      status: responseData.status,
      knowledgeItemIds: responseData.knowledgeItemIds,
      knowledgeItemIdsLength: responseData.knowledgeItemIds.length,
      knowledgeItemIdsType: Array.isArray(responseData.knowledgeItemIds) ? 'array' : typeof responseData.knowledgeItemIds,
      knowledgeItemsLength: responseData.knowledgeItems.length,
      extractedCount: responseData.extractedCount
    });
    
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('获取提取状态失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取提取状态失败'
    });
  }
});

/**
 * 获取知识列表API
 * GET /api/knowledge/items
 */
router.get('/items', async (req, res) => {
  try {
    const {
      knowledgeBaseId,
      status,
      category,
      tags,
      search,
      page = 1,
      limit = 50
    } = req.query;

    let sql = 'SELECT * FROM personal_knowledge_items WHERE 1=1';
    const params = [];

    if (knowledgeBaseId) {
      sql += ' AND knowledge_base_id = ?';
      params.push(knowledgeBaseId);
    }

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (tags) {
      const tagList = tags.split(',').map(t => t.trim());
      // 使用JSON查询（SQLite和PostgreSQL都支持）
      tagList.forEach(tag => {
        sql += ' AND tags LIKE ?';
        params.push(`%"${tag}"%`);
      });
    }

    if (search) {
      sql += ' AND (title LIKE ? OR content LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    // 获取总数（在 JOIN 之前，使用原始表名）
    const countSql = sql.replace('SELECT * FROM personal_knowledge_items', 'SELECT COUNT(*) as count FROM personal_knowledge_items');
    const countResult = await db.get(countSql, params);
    const total = countResult?.count || 0;

    // 排序和分页 - 使用 LEFT JOIN 一次性获取子分类信息，避免 N+1 查询
    sql = sql.replace(
      'SELECT * FROM personal_knowledge_items',
      `SELECT 
        pki.*,
        cs.id as subcat_id,
        cs.category as subcat_category,
        cs.name as subcat_name,
        cs.keywords as subcat_keywords
      FROM personal_knowledge_items pki
      LEFT JOIN category_subcategories cs ON pki.subcategory_id = cs.id`
    );
    
    sql += ' ORDER BY pki.created_at DESC';
    sql += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const items = await db.all(sql, params);

    // 解析JSON字段并添加分类和子分类信息（不再需要单独查询）
    const itemsWithParsed = items.map((item) => {
      const tags = JSON.parse(item.tags || '[]');
      const category = item.category || getCategoryFromTags(tags);
      
      // 从 JOIN 结果中获取子分类信息
      let subcategory = null;
      if (item.subcat_id) {
        subcategory = {
          id: item.subcat_id,
          name: item.subcat_name,
          keywords: JSON.parse(item.subcat_keywords || '[]')
        };
      }
      
      // 移除 JOIN 产生的临时字段，保留原始字段
      const {
        subcat_id,
        subcat_category,
        subcat_name,
        subcat_keywords,
        ...cleanItem
      } = item;
      
      return {
        ...cleanItem,
        tags,
        keyConclusions: JSON.parse(cleanItem.key_conclusions || '[]'),
        metadata: cleanItem.metadata ? JSON.parse(cleanItem.metadata) : {},
        category, // 添加分类字段
        subcategory_id: cleanItem.subcategory_id || null,
        subcategory // 添加子分类信息
      };
    });

    res.json({
      success: true,
      data: itemsWithParsed,
      total: parseInt(total),
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: (parseInt(page) * parseInt(limit)) < parseInt(total)
    });
  } catch (error) {
    console.error('获取知识列表失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取知识列表失败'
    });
  }
});

/**
 * 获取知识点详情API
 * GET /api/knowledge/items/:id
 */
router.get('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const item = await db.get(
      'SELECT * FROM personal_knowledge_items WHERE id = ?',
      [id]
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: '知识点不存在'
      });
    }

    // 获取来源文档信息
    let sourceItem = null;
    if (item.source_item_id) {
      sourceItem = await db.get(
        'SELECT id, title, type, page_count FROM source_items WHERE id = ?',
        [item.source_item_id]
      );
    }

    // 获取知识库信息
    let knowledgeBase = null;
    if (item.knowledge_base_id) {
      knowledgeBase = await db.get(
        'SELECT id, name FROM knowledge_bases WHERE id = ?',
        [item.knowledge_base_id]
      );
    }

    // 获取子分类信息
    let subcategory = null;
    if (item.subcategory_id) {
      const subcat = await db.get(
        'SELECT id, category, name, keywords FROM category_subcategories WHERE id = ?',
        [item.subcategory_id]
      );
      if (subcat) {
        subcategory = {
          id: subcat.id,
          name: subcat.name,
          keywords: JSON.parse(subcat.keywords || '[]')
        };
      }
    }

    // 解析JSON字段
    const result = {
      ...item,
      tags: JSON.parse(item.tags || '[]'),
      keyConclusions: JSON.parse(item.key_conclusions || '[]'),
      metadata: item.metadata ? JSON.parse(item.metadata) : {},
      sourceItem,
      knowledgeBase,
      subcategory_id: item.subcategory_id || null,
      subcategory,
      relatedKnowledge: [] // 初始化为空，前端异步加载
    };

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('获取知识点详情失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取知识点详情失败'
    });
  }
});

/**
 * 创建知识点API（手动创建）
 * POST /api/knowledge/items
 */
router.post('/items', async (req, res) => {
  try {
    const {
      title,
      content,
      summary,
      keyConclusions,
      knowledgeBaseId,
      category,
      tags,
      userApiKey
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: '标题和内容不能为空'
      });
    }

    // 如果没有指定知识库，使用默认知识库
    let targetKnowledgeBaseId = knowledgeBaseId;
    if (!targetKnowledgeBaseId) {
      const defaultKb = await db.get(
        'SELECT * FROM knowledge_bases WHERE is_default = 1 LIMIT 1'
      );
      if (defaultKb) {
        targetKnowledgeBaseId = defaultKb.id;
      } else {
        const firstKb = await db.get(
          'SELECT * FROM knowledge_bases ORDER BY created_at ASC LIMIT 1'
        );
        if (!firstKb) {
          return res.status(400).json({
            success: false,
            message: '请先创建知识库'
          });
        }
        targetKnowledgeBaseId = firstKb.id;
      }
    }

    const id = `ki-${uuidv4().split('-')[0]}`;
    const now = Date.now();

    await db.run(
      `INSERT INTO personal_knowledge_items 
       (id, title, content, summary, key_conclusions, knowledge_base_id, 
        category, tags, confidence_score, status, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title.trim(),
        content.trim(),
        summary || null,
        JSON.stringify(keyConclusions || []),
        targetKnowledgeBaseId,
        category || null,
        JSON.stringify(tags || []),
        100, // 手动创建的知识点置信度为100
        'confirmed',
        now,
        now,
        JSON.stringify({})
      ]
    );

    const newItem = await db.get(
      'SELECT * FROM personal_knowledge_items WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...newItem,
        tags: JSON.parse(newItem.tags || '[]'),
        keyConclusions: JSON.parse(newItem.key_conclusions || '[]')
      }
    });
  } catch (error) {
    console.error('创建知识点失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '创建知识点失败'
    });
  }
});

/**
 * 更新知识点API
 * PUT /api/knowledge/items/:id
 */
router.put('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      content,
      summary,
      keyConclusions,
      category,
      subcategory_id,
      tags,
      status
    } = req.body;

    // 检查知识点是否存在
    const existing = await db.get(
      'SELECT * FROM personal_knowledge_items WHERE id = ?',
      [id]
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '知识点不存在'
      });
    }

    // 构建更新语句
    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title.trim());
    }
    if (content !== undefined) {
      updates.push('content = ?');
      params.push(content.trim());
    }
    if (summary !== undefined) {
      updates.push('summary = ?');
      params.push(summary || null);
    }
    if (keyConclusions !== undefined) {
      updates.push('key_conclusions = ?');
      params.push(JSON.stringify(keyConclusions || []));
    }
    if (category !== undefined) {
      // 验证分类值
      if (category && !['work', 'learning', 'leisure', 'life'].includes(category)) {
        return res.status(400).json({
          success: false,
          message: '无效的分类值，必须是 work/learning/leisure/life 之一'
        });
      }
      updates.push('category = ?');
      params.push(category || null);
    }
    if (subcategory_id !== undefined) {
      // 验证子分类是否存在且属于对应的分类
      if (subcategory_id) {
        const subcat = await db.get(
          'SELECT id, category FROM category_subcategories WHERE id = ?',
          [subcategory_id]
        );
        if (!subcat) {
          return res.status(400).json({
            success: false,
            message: '子分类不存在'
          });
        }
        // 如果同时更新了category，验证它们是否匹配
        const finalCategory = category !== undefined ? category : existing.category;
        if (finalCategory && subcat.category !== finalCategory) {
          return res.status(400).json({
            success: false,
            message: '子分类与分类不匹配'
          });
        }
      }
      updates.push('subcategory_id = ?');
      params.push(subcategory_id || null);
    }
    if (tags !== undefined) {
      updates.push('tags = ?');
      params.push(JSON.stringify(tags || []));
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    await db.run(
      `UPDATE personal_knowledge_items 
       SET ${updates.join(', ')} 
       WHERE id = ?`,
      params
    );

    const updated = await db.get(
      'SELECT * FROM personal_knowledge_items WHERE id = ?',
      [id]
    );

    // 获取子分类信息
    let subcategory = null;
    if (updated.subcategory_id) {
      const subcat = await db.get(
        'SELECT id, category, name, keywords FROM category_subcategories WHERE id = ?',
        [updated.subcategory_id]
      );
      if (subcat) {
        subcategory = {
          id: subcat.id,
          name: subcat.name,
          keywords: JSON.parse(subcat.keywords || '[]')
        };
      }
    }

    res.json({
      success: true,
      data: {
        ...updated,
        tags: JSON.parse(updated.tags || '[]'),
        keyConclusions: JSON.parse(updated.key_conclusions || '[]'),
        subcategory_id: updated.subcategory_id || null,
        subcategory
      }
    });
  } catch (error) {
    console.error('更新知识点失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '更新知识点失败'
    });
  }
});

/**
 * 删除知识点API
 * DELETE /api/knowledge/items/:id
 */
router.delete('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 检查知识点是否存在
    const existing = await db.get(
      'SELECT * FROM personal_knowledge_items WHERE id = ?',
      [id]
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '知识点不存在'
      });
    }

    // 保存来源文档ID（在删除前）
    const sourceItemId = existing.source_item_id;

    // 删除知识点
    await db.run(
      'DELETE FROM personal_knowledge_items WHERE id = ?',
      [id]
    );

    // 删除相关关联关系
    await db.run(
      'DELETE FROM knowledge_relations WHERE source_knowledge_id = ? OR target_knowledge_id = ?',
      [id, id]
    );

    // 如果知识点有关联的文档，检查文档是否还有其他知识点
    if (sourceItemId) {
      try {
        // 检查该文档是否还有其他知识点
        const remainingKnowledge = await db.get(
          'SELECT COUNT(*) as count FROM personal_knowledge_items WHERE source_item_id = ?',
          [sourceItemId]
        );

        // 如果没有其他知识点，重置文档的提取状态
        if (remainingKnowledge && (remainingKnowledge.count === 0 || remainingKnowledge.count === '0')) {
          const DATABASE_URL = process.env.DATABASE_URL;
          const DB_TYPE = process.env.DB_TYPE;
          const isPostgreSQL = DATABASE_URL || DB_TYPE === 'postgres';
          const now = Date.now();

          if (isPostgreSQL) {
            await db.run(
              'UPDATE source_items SET knowledge_extracted = FALSE, updated_at = ? WHERE id = ?',
              [now, sourceItemId]
            );
          } else {
            await db.run(
              'UPDATE source_items SET knowledge_extracted = 0, updated_at = ? WHERE id = ?',
              [now, sourceItemId]
            );
          }
        }
      } catch (error) {
        // 如果字段不存在或更新失败，只记录警告，不影响删除操作
        console.warn('重置文档提取状态失败:', error.message);
      }
    }

    res.json({
      success: true,
      message: '知识点已删除'
    });
  } catch (error) {
    console.error('删除知识点失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '删除知识点失败'
    });
  }
});

/**
 * 获取相关知识API
 * GET /api/knowledge/items/:id/related
 */
router.get('/items/:id/related', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 5, minSimilarity = 60, userApiKey } = req.query;

    const related = await getRelatedKnowledge(
      id,
      parseInt(limit),
      parseInt(minSimilarity),
      userApiKey || null
    );

    res.json({
      success: true,
      data: related
    });
  } catch (error) {
    console.error('获取相关知识失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取相关知识失败'
    });
  }
});

/**
 * 获取知识图谱数据API
 * GET /api/knowledge/graph
 */
/**
 * 标签到分类的映射表
 */
const TAG_TO_CATEGORY_MAP = {
  // 工作相关
  '工作': 'work', '职场': 'work', '职业': 'work', '业务': 'work', '项目': 'work',
  '管理': 'work', '团队': 'work', '领导': 'work', '会议': 'work', '报告': 'work',
  // 学习相关
  '学习': 'learning', '教育': 'learning', '课程': 'learning', '培训': 'learning',
  '知识': 'learning', '技能': 'learning', '阅读': 'learning', '研究': 'learning',
  '学术': 'learning', '考试': 'learning', '笔记': 'learning',
  // 娱乐相关
  '娱乐': 'leisure', '游戏': 'leisure', '电影': 'leisure', '音乐': 'leisure',
  '旅行': 'leisure', '旅游': 'leisure', '运动': 'leisure', '健身': 'leisure',
  '美食': 'leisure', '购物': 'leisure', '兴趣': 'leisure', '爱好': 'leisure',
  // 生活相关
  '生活': 'life', '家庭': 'life', '健康': 'life', '医疗': 'life', '养生': 'life',
  '理财': 'life', '投资': 'life', '房产': 'life', '装修': 'life', '育儿': 'life',
  '情感': 'life', '人际关系': 'life', '社交': 'life'
};

/**
 * 根据标签获取分类（保留用于向后兼容）
 */
function getCategoryFromTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return 'work'; // 默认返回work，不再返回other
  }
  
  // 统计每个分类的匹配次数
  const categoryCounts = { work: 0, learning: 0, leisure: 0, life: 0 };
  
  tags.forEach(tag => {
    const category = TAG_TO_CATEGORY_MAP[tag] || null;
    if (category) {
      categoryCounts[category]++;
    }
  });
  
  // 返回匹配次数最多的分类，如果没有匹配则返回work
  const maxCategory = Object.keys(categoryCounts).reduce((a, b) => 
    categoryCounts[a] > categoryCounts[b] ? a : b
  );
  
  return categoryCounts[maxCategory] > 0 ? maxCategory : 'work';
}

/**
 * 计算相似度（词向量距离）
 * @param {Array} tags - 知识点的标签数组
 * @param {Array} subcategoryKeywords - 子分类的关键词数组
 * @returns {number} 相似度分数（0-1）
 */
function calculateSimilarity(tags, subcategoryKeywords) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return 0;
  }
  if (!Array.isArray(subcategoryKeywords) || subcategoryKeywords.length === 0) {
    return 0;
  }
  
  let totalWeight = 0;
  
  tags.forEach(tag => {
    subcategoryKeywords.forEach(keyword => {
      if (tag === keyword) {
        totalWeight += 2; // 完全匹配权重2
      } else if (tag.includes(keyword) || keyword.includes(tag)) {
        totalWeight += 1; // 部分匹配权重1
      }
    });
  });
  
  // 归一化：相似度 = 匹配权重 / (关键词总数 + 标签总数)
  const similarity = totalWeight / (subcategoryKeywords.length + tags.length);
  return similarity;
}

/**
 * 基于子分类词向量距离进行分类
 * @param {Array} tags - 知识点的标签数组
 * @param {string} content - 知识点内容（可选，用于未来扩展）
 * @returns {Promise<{category: string, subcategory_id: string}>}
 */
async function classifyBySubcategoryVector(tags, content = '') {
  if (!Array.isArray(tags) || tags.length === 0) {
    // 如果没有标签，返回默认分类的第一个子分类
    const defaultSubcat = await db.get(
      `SELECT id, category FROM category_subcategories 
       WHERE category = 'work' 
       ORDER BY order_index ASC LIMIT 1`
    );
    return {
      category: 'work',
      subcategory_id: defaultSubcat ? defaultSubcat.id : null
    };
  }
  
  // 获取所有子分类
  const subcategories = await db.all(
    `SELECT id, category, name, keywords FROM category_subcategories 
     ORDER BY category, order_index ASC`
  );
  
  if (subcategories.length === 0) {
    // 如果没有子分类，使用旧的标签映射方法
    const category = getCategoryFromTags(tags);
    return {
      category,
      subcategory_id: null
    };
  }
  
  // 计算每个子分类的相似度
  const similarities = [];
  for (const subcat of subcategories) {
    const keywords = JSON.parse(subcat.keywords || '[]');
    const similarity = calculateSimilarity(tags, keywords);
    similarities.push({
      subcategory_id: subcat.id,
      category: subcat.category,
      similarity
    });
  }
  
  // 按相似度排序
  similarities.sort((a, b) => b.similarity - a.similarity);
  
  // 选择相似度最高的子分类
  const bestMatch = similarities[0];
  
  // 如果所有相似度都很低（<0.1），默认选择该分类下第一个子分类
  if (bestMatch.similarity < 0.1) {
    const defaultSubcat = await db.get(
      `SELECT id, category FROM category_subcategories 
       WHERE category = ? 
       ORDER BY order_index ASC LIMIT 1`,
      [bestMatch.category]
    );
    return {
      category: bestMatch.category,
      subcategory_id: defaultSubcat ? defaultSubcat.id : null
    };
  }
  
  return {
    category: bestMatch.category,
    subcategory_id: bestMatch.subcategory_id
  };
}

/**
 * 根据子分类词向量获取分类（对外接口）
 * @param {Array} tags - 知识点的标签数组
 * @param {string} content - 知识点内容（可选）
 * @returns {Promise<{category: string, subcategory_id: string}>}
 */
async function getCategoryFromSubcategoryVector(tags, content = '') {
  const result = await classifyBySubcategoryVector(tags, content);
  // 确保返回 work/learning/leisure/life 之一
  if (!['work', 'learning', 'leisure', 'life'].includes(result.category)) {
    result.category = 'work';
  }
  return result;
}

router.get('/graph', async (req, res) => {
  try {
    const { minSimilarity = 60, limit = 100, maxEdges = 50, useCache = 'true', userApiKey } = req.query;
    const useCacheFlag = useCache === 'true';

    // 获取所有已确认的知识点
    const items = await db.all(
      `SELECT id, title, content, tags, key_conclusions, status, confidence_score, created_at
       FROM personal_knowledge_items
       WHERE status = 'confirmed'
       ORDER BY created_at DESC
       LIMIT ?`,
      [parseInt(limit)]
    );

    if (items.length === 0) {
      return res.json({
        success: true,
        data: {
          nodes: [],
          edges: [],
          categories: {}
        }
      });
    }

    // 解析JSON字段并添加分类
    const parsedItems = items.map(item => {
      const tags = JSON.parse(item.tags || '[]');
      const category = getCategoryFromTags(tags);
      return {
        ...item,
        tags,
        keyConclusions: JSON.parse(item.key_conclusions || '[]'),
        category
      };
    });

    // 计算节点（包含分类信息）
    const nodes = parsedItems.map(item => ({
      id: item.id,
      title: item.title,
      content: item.content.substring(0, 200),
      status: item.status,
      confidence: item.confidence_score,
      tags: item.tags,
      category: item.category,
      createdAt: item.created_at
    }));

    // 统计分类信息
    const categoryStats = {};
    nodes.forEach(node => {
      categoryStats[node.category] = (categoryStats[node.category] || 0) + 1;
    });

    // 计算相似度并创建边（使用缓存优化）
    const edges = [];
    const { calculateSimilarity } = require('../services/knowledge-extractor');
    const { v4: uuidv4 } = require('uuid');
    
    // 只计算相邻节点之间的相似度（减少计算量）
    for (let i = 0; i < parsedItems.length; i++) {
      for (let j = i + 1; j < Math.min(i + 10, parsedItems.length); j++) {
        const item1 = parsedItems[i];
        const item2 = parsedItems[j];
        
        // 尝试从缓存获取相似度
        let similarity = null;
        if (useCacheFlag) {
          try {
            const cached = await db.get(
              `SELECT similarity_score FROM knowledge_relations 
               WHERE (source_knowledge_id = ? AND target_knowledge_id = ?)
                  OR (source_knowledge_id = ? AND target_knowledge_id = ?)
               ORDER BY created_at DESC LIMIT 1`,
              [item1.id, item2.id, item2.id, item1.id]
            );
            if (cached) {
              similarity = cached.similarity_score;
            }
          } catch (error) {
            console.warn('读取相似度缓存失败:', error.message);
          }
        }
        
        // 如果缓存中没有，计算相似度
        if (similarity === null) {
          try {
            similarity = await calculateSimilarity(item1, item2, userApiKey || null);
            
            // 保存到缓存
            if (useCacheFlag && similarity >= parseInt(minSimilarity)) {
              try {
                await db.run(
                  `INSERT INTO knowledge_relations 
                   (id, source_knowledge_id, target_knowledge_id, similarity_score, relation_type, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [uuidv4(), item1.id, item2.id, similarity, 'similarity', Date.now()]
                );
              } catch (error) {
                // 忽略重复插入错误
                if (!error.message.includes('UNIQUE constraint') && !error.message.includes('duplicate')) {
                  console.warn('保存相似度缓存失败:', error.message);
                }
              }
            }
          } catch (error) {
            console.warn(`计算相似度失败 (${item1.id} <-> ${item2.id}):`, error.message);
            continue;
          }
        }
        
        if (similarity >= parseInt(minSimilarity)) {
          edges.push({
            source: item1.id,
            target: item2.id,
            similarity: similarity,
            type: 'similarity'
          });
        }
      }
    }

    // 限制边的数量，按相似度排序
    const sortedEdges = edges.sort((a, b) => b.similarity - a.similarity);
    const limitedEdges = sortedEdges.slice(0, parseInt(maxEdges));

    res.json({
      success: true,
      data: {
        nodes,
        edges: limitedEdges,
        categories: categoryStats
      }
    });
  } catch (error) {
    console.error('获取知识图谱数据失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取知识图谱数据失败'
    });
  }
});

/**
 * 子分类管理API
 */

/**
 * 获取子分类列表
 * GET /api/knowledge/subcategories
 */
router.get('/subcategories', async (req, res) => {
  try {
    const { category } = req.query;
    
    let sql = `
      SELECT id, category, name, keywords, order_index, is_custom, created_at, updated_at
      FROM category_subcategories
    `;
    const params = [];
    
    if (category) {
      sql += ` WHERE category = ?`;
      params.push(category);
    }
    
    sql += ` ORDER BY category, order_index ASC`;
    
    const subcategories = await db.all(sql, params);
    
    // 解析keywords JSON
    const parsed = subcategories.map(sub => ({
      ...sub,
      keywords: JSON.parse(sub.keywords || '[]'),
      is_custom: sub.is_custom === 1 || sub.is_custom === true
    }));
    
    res.json({
      success: true,
      data: parsed
    });
  } catch (error) {
    console.error('获取子分类列表失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取子分类列表失败'
    });
  }
});

/**
 * 创建子分类
 * POST /api/knowledge/subcategories
 */
router.post('/subcategories', async (req, res) => {
  try {
    const { category, name, keywords, order_index = 0 } = req.body;
    
    if (!category || !name) {
      return res.status(400).json({
        success: false,
        message: '分类和名称不能为空'
      });
    }
    
    if (!['work', 'learning', 'leisure', 'life'].includes(category)) {
      return res.status(400).json({
        success: false,
        message: '无效的分类值'
      });
    }
    
    const keywordsArray = Array.isArray(keywords) ? keywords : (keywords ? [keywords] : []);
    const keywordsJson = JSON.stringify(keywordsArray);
    
    const id = `subcat-${uuidv4()}`;
    const now = Date.now();
    
    await db.run(`
      INSERT INTO category_subcategories (id, category, name, keywords, order_index, is_custom, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `, [id, category, name, keywordsJson, order_index, now, now]);
    
    res.json({
      success: true,
      data: {
        id,
        category,
        name,
        keywords: keywordsArray,
        order_index,
        is_custom: true,
        created_at: now,
        updated_at: now
      }
    });
  } catch (error) {
    console.error('创建子分类失败:', error);
    if (error.message.includes('UNIQUE') || error.message.includes('duplicate')) {
      return res.status(400).json({
        success: false,
        message: '该分类下已存在同名子分类'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || '创建子分类失败'
    });
  }
});

/**
 * 更新子分类
 * PUT /api/knowledge/subcategories/:id
 */
router.put('/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, keywords, order_index } = req.body;
    
    // 检查子分类是否存在且是用户自定义的
    const existing = await db.get(
      'SELECT * FROM category_subcategories WHERE id = ?',
      [id]
    );
    
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '子分类不存在'
      });
    }
    
    if (existing.is_custom === 0 || existing.is_custom === false) {
      return res.status(403).json({
        success: false,
        message: '预设子分类不允许修改'
      });
    }
    
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    
    if (keywords !== undefined) {
      const keywordsArray = Array.isArray(keywords) ? keywords : (keywords ? [keywords] : []);
      updates.push('keywords = ?');
      params.push(JSON.stringify(keywordsArray));
    }
    
    if (order_index !== undefined) {
      updates.push('order_index = ?');
      params.push(order_index);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有需要更新的字段'
      });
    }
    
    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    
    await db.run(`
      UPDATE category_subcategories
      SET ${updates.join(', ')}
      WHERE id = ?
    `, params);
    
    // 返回更新后的数据
    const updated = await db.get(
      'SELECT * FROM category_subcategories WHERE id = ?',
      [id]
    );
    
    res.json({
      success: true,
      data: {
        ...updated,
        keywords: JSON.parse(updated.keywords || '[]'),
        is_custom: updated.is_custom === 1 || updated.is_custom === true
      }
    });
  } catch (error) {
    console.error('更新子分类失败:', error);
    if (error.message.includes('UNIQUE') || error.message.includes('duplicate')) {
      return res.status(400).json({
        success: false,
        message: '该分类下已存在同名子分类'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || '更新子分类失败'
    });
  }
});

/**
 * 删除子分类
 * DELETE /api/knowledge/subcategories/:id
 */
router.delete('/subcategories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查子分类是否存在且是用户自定义的
    const existing = await db.get(
      'SELECT * FROM category_subcategories WHERE id = ?',
      [id]
    );
    
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '子分类不存在'
      });
    }
    
    if (existing.is_custom === 0 || existing.is_custom === false) {
      return res.status(403).json({
        success: false,
        message: '预设子分类不允许删除'
      });
    }
    
    // 检查是否有知识点使用此子分类
    const itemsUsing = await db.get(
      'SELECT COUNT(*) as count FROM personal_knowledge_items WHERE subcategory_id = ?',
      [id]
    );
    
    if (itemsUsing && itemsUsing.count > 0) {
      return res.status(400).json({
        success: false,
        message: `该子分类正在被 ${itemsUsing.count} 个知识点使用，无法删除`
      });
    }
    
    await db.run('DELETE FROM category_subcategories WHERE id = ?', [id]);
    
    res.json({
      success: true,
      message: '子分类已删除'
    });
  } catch (error) {
    console.error('删除子分类失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '删除子分类失败'
    });
  }
});

module.exports = router;

