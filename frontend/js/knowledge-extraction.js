// 知识提取模块
import { knowledgeAPI } from './api.js';
import { showToast } from './toast.js';
import { updateExtractionProgress, removeExtractionTask } from './extraction-progress-bar.js';

// 提取任务状态管理
const extractionTasks = new Map();

/**
 * 从文档提取知识
 * @param {string} docId - 文档ID
 * @param {string} knowledgeBaseId - 知识库ID（可选）
 * @param {Function} onProgress - 进度回调函数
 * @returns {Promise<string>} 提取任务ID
 */
export async function extractFromDocument(docId, knowledgeBaseId = null, onProgress = null) {
  try {
    // 调用提取API
    const response = await knowledgeAPI.extract([docId], knowledgeBaseId);
    
    if (!response.success) {
      throw new Error(response.message || '提取失败');
    }

    const { extractionId } = response.data;
    
    // 获取文档名称（用于进度显示）
    let docName = '文档';
    try {
      // 尝试从当前文档列表中获取文档名称
      const docElement = document.querySelector(`[data-doc-id="${docId}"]`);
      if (docElement) {
        const titleElement = docElement.querySelector('.item-title, [data-title]');
        if (titleElement) {
          docName = titleElement.textContent.trim() || titleElement.getAttribute('data-title') || docName;
        }
      }
    } catch (e) {
      console.warn('无法获取文档名称:', e);
    }
    
    // 存储任务信息
    extractionTasks.set(extractionId, {
      docId,
      docName,
      knowledgeBaseId,
      status: 'processing',
      onProgress
    });
    
    // 同时更新进度条中的任务信息（用于重试功能）
    const { updateExtractionProgress } = await import('./extraction-progress-bar.js');
    updateExtractionProgress(extractionId, {
      docName,
      status: 'processing',
      progress: 0,
      totalItems: 1,
      processedItems: 0,
      extractedCount: 0,
      docId, // 传递docId
      knowledgeBaseId // 传递knowledgeBaseId
    });

    // 更新进度通知栏
    updateExtractionProgress(extractionId, {
      docName,
      status: 'processing',
      progress: 0,
      totalItems: 1,
      processedItems: 0,
      extractedCount: 0
    });

    // 开始轮询状态
    pollExtractionStatus(extractionId);

    return extractionId;
  } catch (error) {
    console.error('提取知识失败:', error);
    showToast(error.message || '提取知识失败', 'error');
    throw error;
  }
}

/**
 * 批量提取文档知识
 * @param {Array<string>} docIds - 文档ID数组
 * @param {string} knowledgeBaseId - 知识库ID（可选）
 * @param {Function} onProgress - 进度回调函数
 * @returns {Promise<string>} 提取任务ID
 */
export async function extractFromDocuments(docIds, knowledgeBaseId = null, onProgress = null) {
  try {
    if (!docIds || docIds.length === 0) {
      throw new Error('请选择至少一个文档');
    }

    const response = await knowledgeAPI.extract(docIds, knowledgeBaseId);
    
    if (!response.success) {
      throw new Error(response.message || '提取失败');
    }

    const { extractionId } = response.data;
    
    // 生成文档名称（用于进度显示）
    const docName = docIds.length === 1 
      ? '文档' 
      : `${docIds.length} 个文档`;

    // 存储任务信息
    extractionTasks.set(extractionId, {
      docIds,
      docName,
      knowledgeBaseId,
      status: 'processing',
      onProgress
    });
    
    // 同时更新进度条中的任务信息（用于重试功能）
    const { updateExtractionProgress } = await import('./extraction-progress-bar.js');
    updateExtractionProgress(extractionId, {
      docName,
      status: 'processing',
      progress: 0,
      totalItems: docIds.length,
      processedItems: 0,
      extractedCount: 0,
      docIds, // 传递docIds
      knowledgeBaseId // 传递knowledgeBaseId
    });

    // 更新进度通知栏
    updateExtractionProgress(extractionId, {
      docName,
      status: 'processing',
      progress: 0,
      totalItems: docIds.length,
      processedItems: 0,
      extractedCount: 0
    });

    // 开始轮询状态
    pollExtractionStatus(extractionId);

    return extractionId;
  } catch (error) {
    console.error('批量提取知识失败:', error);
    showToast(error.message || '批量提取知识失败', 'error');
    throw error;
  }
}

/**
 * 轮询提取状态
 * @param {string} extractionId - 提取任务ID
 */
async function pollExtractionStatus(extractionId) {
  const task = extractionTasks.get(extractionId);
  if (!task) {
    return;
  }

  try {
    const response = await knowledgeAPI.getExtractionStatus(extractionId);
    
    if (!response.success) {
      throw new Error(response.message || '获取状态失败');
    }

    const {
      status,
      stage,
      totalItems,
      processedItems,
      extractedCount,
      knowledgeItems,
      knowledgeItemIds,
      progress: progressValue,
      currentDocIndex,
      etaSeconds
    } = response.data;
    
    // 调试：记录每次轮询的完整响应数据
    console.log('[提取] 轮询状态响应', {
      extractionId,
      status,
      stage,
      extractedCount,
      knowledgeItemIds: knowledgeItemIds || [],
      knowledgeItemIdsType: Array.isArray(knowledgeItemIds) ? 'array' : typeof knowledgeItemIds,
      knowledgeItemIdsLength: Array.isArray(knowledgeItemIds) ? knowledgeItemIds.length : 0,
      knowledgeItems: knowledgeItems || [],
      knowledgeItemsLength: Array.isArray(knowledgeItems) ? knowledgeItems.length : 0,
      fullResponse: response.data
    });
    
    // 更新任务状态
    task.status = status;
    task.processedItems = processedItems;
    task.extractedCount = extractedCount;

    // 使用后端返回的进度值（已包含平滑计算）
    const progress = progressValue !== undefined 
      ? progressValue 
      : (totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 0);

    // 更新进度通知栏
    updateExtractionProgress(extractionId, {
      docName: task.docName || '文档',
      status,
      stage: stage || 'parsing',
      progress,
      totalItems,
      processedItems,
      extractedCount,
      currentDocIndex: currentDocIndex || 0,
      etaSeconds: etaSeconds || null,
      knowledgeItems: knowledgeItems || []
    });

    // 调用进度回调
    if (task.onProgress) {
      task.onProgress({
        status,
        totalItems,
        processedItems,
        extractedCount,
        progress
      });
    }

    // 如果还在处理中，继续轮询
    if (status === 'processing') {
      setTimeout(() => pollExtractionStatus(extractionId), 2000); // 每2秒轮询一次
    } else if (status === 'completed') {
      // 提取完成
      // 收集本次提取产生的知识点ID，用于在知识列表中高亮显示
      try {
        console.log('[提取] 提取完成，开始收集知识点ID', {
          knowledgeItemIds,
          knowledgeItemIdsType: Array.isArray(knowledgeItemIds) ? 'array' : typeof knowledgeItemIds,
          knowledgeItemIdsLength: Array.isArray(knowledgeItemIds) ? knowledgeItemIds.length : 0,
          knowledgeItems,
          knowledgeItemsType: Array.isArray(knowledgeItems) ? 'array' : typeof knowledgeItems,
          knowledgeItemsLength: Array.isArray(knowledgeItems) ? knowledgeItems.length : 0
        });
        
        const latestIdsFromApi = Array.isArray(knowledgeItemIds) && knowledgeItemIds.length > 0 
          ? knowledgeItemIds 
          : null;
        const latestIdsFromItems = (!latestIdsFromApi || latestIdsFromApi.length === 0)
          ? (Array.isArray(knowledgeItems) && knowledgeItems.length > 0
              ? knowledgeItems.map(item => item.id).filter(Boolean)
              : [])
          : [];
        
        const latestIds = latestIdsFromApi && latestIdsFromApi.length > 0
          ? latestIdsFromApi
          : latestIdsFromItems;

        console.log('[提取] 收集到的知识点ID', {
          latestIdsFromApi,
          latestIdsFromItems,
          latestIds,
          latestIdsLength: latestIds ? latestIds.length : 0
        });

        if (latestIds && latestIds.length > 0 && typeof window !== 'undefined' && window.localStorage) {
          // 统一转换为字符串，确保类型一致
          const idsAsStrings = latestIds.map(id => String(id));
          
          // 验证转换后的 ID
          console.log('[提取] ID 转换验证', {
            originalIds: latestIds,
            convertedIds: idsAsStrings,
            allAreStrings: idsAsStrings.every(id => typeof id === 'string'),
            conversionSuccess: idsAsStrings.length === latestIds.length
          });
          
          // 保存到 localStorage
          const storageKey = 'latestExtractionHighlightIds';
          const storageValue = JSON.stringify(idsAsStrings);
          window.localStorage.setItem(storageKey, storageValue);
          
          // 验证保存是否成功
          const savedValue = window.localStorage.getItem(storageKey);
          const savedIds = savedValue ? JSON.parse(savedValue) : null;
          console.log('[提取] localStorage 保存验证', {
            storageKey,
            savedValue,
            savedIds,
            savedIdsLength: savedIds ? savedIds.length : 0,
            saveSuccess: JSON.stringify(savedIds) === storageValue,
            savedIdsType: savedIds && savedIds.length > 0 ? typeof savedIds[0] : 'unknown'
          });
          
          console.log('[提取] ✅ 已保存本次提取高亮ID到 localStorage:', idsAsStrings.length, '个', idsAsStrings);
          
          // 如果当前在知识库视图，主动刷新高亮显示
          try {
            const knowledgeView = document.getElementById('view-knowledge-items');
            const isKnowledgeViewVisible = knowledgeView && !knowledgeView.classList.contains('hidden');
            console.log('[提取] 知识库视图状态检查', {
              knowledgeViewExists: !!knowledgeView,
              isVisible: isKnowledgeViewVisible,
              currentView: window.currentView || 'unknown'
            });
            
            if (isKnowledgeViewVisible) {
              console.log('[提取] 当前在知识库视图，主动刷新显示');
              // 当前在知识库视图，主动刷新
              import('./knowledge-items.js').then(({ refreshKnowledgeView }) => {
                console.log('[提取] 调用 refreshKnowledgeView');
                refreshKnowledgeView();
              }).catch(e => {
                console.error('[提取] 刷新知识库视图失败:', e);
              });
            } else {
              console.log('[提取] 当前不在知识库视图，用户切换到知识库视图时会自动显示');
            }
          } catch (e) {
            console.error('[提取] 检查知识库视图状态失败:', e);
          }
        } else {
          console.error('[提取] ❌ 没有找到知识点ID，无法保存高亮信息', {
            latestIds,
            latestIdsLength: latestIds ? latestIds.length : 0,
            latestIdsType: latestIds ? (Array.isArray(latestIds) ? 'array' : typeof latestIds) : 'null',
            hasLocalStorage: typeof window !== 'undefined' && window.localStorage,
            hasWindow: typeof window !== 'undefined'
          });
        }
      } catch (e) {
        console.error('保存本次提取高亮ID失败:', e);
      }

      updateExtractionProgress(extractionId, {
        docName: task.docName || '文档',
        status: 'completed',
        stage: 'saving',
        progress: 100,
        totalItems,
        processedItems,
        extractedCount,
        currentDocIndex: totalItems,
        etaSeconds: null,
        knowledgeItems: knowledgeItems || []
      });
      
      // 只通过进度回调通知，不在轮询函数中显示Toast
      // 让UI层的进度回调统一处理成功消息和跳转
      if (task.onProgress) {
        task.onProgress({
          status: 'completed',
          totalItems,
          processedItems,
          extractedCount,
          knowledgeItems,
          progress: 100
        });
      } else {
        // 如果没有进度回调，才在这里显示Toast
        showToast(`提取完成！成功生成 ${extractedCount} 个知识点`, 'success');
      }
      
      // 刷新文档列表以更新提取状态（如果在文档库视图中）
      try {
        if (typeof window !== 'undefined' && window.loadItems) {
          // 延迟刷新，确保后端状态已更新
          setTimeout(() => {
            window.loadItems();
          }, 1000);
        }
      } catch (e) {
        console.warn('刷新文档列表失败:', e);
      }
      
      // 延迟清理任务，让用户看到完成状态
      setTimeout(() => {
        extractionTasks.delete(extractionId);
        removeExtractionTask(extractionId);
      }, 5000); // 5秒后自动关闭
    } else if (status === 'failed') {
      // 提取失败
      updateExtractionProgress(extractionId, {
        docName: task.docName || '文档',
        status: 'failed',
        stage: 'failed',
        progress: task.progress || 0,
        totalItems: task.totalItems || 0,
        processedItems: task.processedItems || 0,
        extractedCount: task.extractedCount || 0,
        error: '提取失败，请重试'
      });
      
      if (task.onProgress) {
        task.onProgress({
          status: 'failed',
          error: '提取失败，请重试'
        });
      } else {
        showToast('提取失败，请重试', 'error');
      }
      
      // 延迟清理任务
      setTimeout(() => {
        extractionTasks.delete(extractionId);
        removeExtractionTask(extractionId);
      }, 5000);
    }
  } catch (error) {
    console.error('轮询提取状态失败:', error);
    const task = extractionTasks.get(extractionId);
    updateExtractionProgress(extractionId, {
      docName: task?.docName || '文档',
      status: 'failed',
      stage: 'failed',
      progress: task?.progress || 0,
      totalItems: task?.totalItems || 0,
      processedItems: task?.processedItems || 0,
      extractedCount: task?.extractedCount || 0,
      error: '获取提取状态失败'
    });
    showToast('获取提取状态失败', 'error');
    setTimeout(() => {
      extractionTasks.delete(extractionId);
      removeExtractionTask(extractionId);
    }, 5000);
  }
}

/**
 * 获取提取状态
 * @param {string} extractionId - 提取任务ID
 * @returns {Object|null} 任务状态
 */
export function getExtractionStatus(extractionId) {
  return extractionTasks.get(extractionId) || null;
}

/**
 * 处理提取进度UI更新
 * @param {string} docId - 文档ID
 * @param {Object} progress - 进度信息
 */
export function handleExtractionProgress(docId, progress) {
  // 查找文档对应的UI元素并更新
  const docElement = document.querySelector(`[data-doc-id="${docId}"]`);
  if (!docElement) {
    return;
  }

  const statusElement = docElement.querySelector('.extraction-status');
  if (statusElement) {
    if (progress.status === 'processing') {
      statusElement.innerHTML = `
        <div class="flex items-center space-x-2 text-indigo-600">
          <i data-lucide="loader-2" class="animate-spin" size="16"></i>
          <span class="text-sm font-medium">AI 提取中... ${progress.progress}%</span>
        </div>
      `;
      // 重新初始化Lucide图标
      if (window.lucide) {
        window.lucide.createIcons();
      }
    } else if (progress.status === 'completed') {
      statusElement.innerHTML = `
        <div class="flex items-center space-x-2 text-green-600">
          <i data-lucide="check-circle" size="16"></i>
          <span class="text-sm font-medium">已提取 ${progress.extractedCount} 个知识点</span>
        </div>
      `;
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }
  }

// 将核心方法暴露到全局，便于其他脚本在模块动态加载异常时直接调用
if (typeof window !== 'undefined') {
  window.knowledgeExtraction = {
    extractFromDocument,
    extractFromDocuments,
    getExtractionStatus,
    handleExtractionProgress
  };
}

}

