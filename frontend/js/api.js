// API调用封装
const API_BASE = window.location.origin.includes('localhost') 
  ? 'http://localhost:3000/api' 
  : '/api';

// 请求缓存（仅用于 GET 请求）
const requestCache = new Map();
const CACHE_TTL = 30000; // 30秒缓存

// 进行中的请求（用于去重）
const pendingRequests = new Map();

// 获取用户API Key（如果已配置）
async function getUserApiKey() {
  try {
    const { getCurrentUserApiKey } = await import('./user-manager.js');
    return getCurrentUserApiKey();
  } catch (e) {
    console.warn('无法加载用户管理模块:', e);
    return null;
  }
}

async function apiRequest(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const useCache = method === 'GET' && options.cache !== false;
  const cacheKey = `${method}:${endpoint}:${JSON.stringify(options.body || {})}`;
  
  // 检查缓存（仅 GET 请求）
  if (useCache && requestCache.has(cacheKey)) {
    const cached = requestCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return Promise.resolve(cached.data);
    } else {
      requestCache.delete(cacheKey);
    }
  }
  
  // 检查是否有相同的请求正在进行（去重）
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }
  
  // 获取用户API Key
  const userApiKey = await getUserApiKey();
  
  // 处理URL和查询参数
  let url = `${API_BASE}${endpoint}`;
  
  // 对于GET请求，通过query参数传递userApiKey
  if (method === 'GET' && userApiKey) {
    const separator = endpoint.includes('?') ? '&' : '?';
    url = `${url}${separator}userApiKey=${encodeURIComponent(userApiKey)}`;
  }
  
  // 准备请求体
  let body = options.body;
  if (body && typeof body === 'object') {
    // 如果用户已配置API Key，添加到请求体（POST/PUT等请求）
    if (userApiKey) {
      body.userApiKey = userApiKey;
    }
    body = JSON.stringify(body);
  }
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options,
    body
  };

  // 创建请求 Promise
  const requestPromise = (async () => {
    try {
      const response = await fetch(url, config);
      
      // 检查响应类型
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        // 如果不是JSON，读取文本内容
        const text = await response.text();
        console.error('非JSON响应:', text.substring(0, 200));
        
        // 尝试解析为JSON（可能服务器返回了错误但格式不对）
        try {
          data = JSON.parse(text);
        } catch (e) {
          // 如果解析失败，返回友好的错误信息
          if (response.status === 404) {
            throw new Error('请求的资源不存在，请检查API端点是否正确');
          } else if (response.status === 500) {
            throw new Error('服务器内部错误，请稍后重试');
          } else {
            throw new Error(`请求失败 (${response.status}): ${response.statusText}`);
          }
        }
      }
      
      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }
      
      // 缓存 GET 请求的响应
      if (useCache) {
        requestCache.set(cacheKey, {
          data,
          timestamp: Date.now()
        });
        // 限制缓存大小，避免内存泄漏
        if (requestCache.size > 100) {
          const firstKey = requestCache.keys().next().value;
          requestCache.delete(firstKey);
        }
      }
      
      return data;
    } catch (error) {
      console.error('API请求失败:', error);
      // 如果是网络错误，提供更友好的提示
      if (error.message.includes('fetch failed') || error.message.includes('Failed to fetch')) {
        throw new Error('无法连接到服务器，请检查网络连接或服务器是否运行');
      }
      // 如果是HTTP错误，提供更详细的错误信息
      if (error.message.includes('HTTP')) {
        const statusMatch = error.message.match(/HTTP (\d+)/);
        if (statusMatch) {
          const status = statusMatch[1];
          if (status === '404') {
            throw new Error('请求的资源不存在');
          } else if (status === '500') {
            throw new Error('服务器内部错误，请稍后重试');
          } else if (status === '403') {
            throw new Error('没有权限访问该资源');
          }
        }
      }
      throw error;
    } finally {
      // 请求完成后从 pendingRequests 中移除
      pendingRequests.delete(cacheKey);
    }
  })();
  
  // 将请求添加到 pendingRequests（用于去重）
  pendingRequests.set(cacheKey, requestPromise);
  
  return requestPromise;
}

// 清除缓存（用于强制刷新）
export function clearAPICache() {
  requestCache.clear();
}

// 知识项API
export const itemsAPI = {
  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/items?${query}`);
  },
  getById: (id) => apiRequest(`/items/${id}`),
  create: (data) => apiRequest('/items', { method: 'POST', body: data }),
  update: (id, data) => apiRequest(`/items/${id}`, { method: 'PUT', body: data }),
  updateModule: (id, moduleId) => apiRequest(`/items/${id}`, { method: 'PUT', body: { module_id: moduleId || null } }),
  delete: (id) => apiRequest(`/items/${id}`, { method: 'DELETE' }),
  archive: (id) => apiRequest(`/items/${id}/archive`, { method: 'POST' }),
  restore: (id) => apiRequest(`/items/${id}/restore`, { method: 'POST' }),
  permanentDelete: (id) => apiRequest(`/items/${id}/permanent`, { method: 'DELETE' }),
  getStats: () => apiRequest('/items/stats')
};

// URL解析API
export const parseAPI = {
  parseURL: (url) => apiRequest('/parse/url', { method: 'POST', body: { url } })
};

// AI API
export const aiAPI = {
  generateSummary: (content, itemId) => 
    apiRequest('/ai/summary', { method: 'POST', body: { content, itemId } }),
  chat: async (messages, context, onChunk) => {
    // 获取用户API Key
    const userApiKey = await getUserApiKey();
    const requestBody = { messages, context };
    if (userApiKey) {
      requestBody.userApiKey = userApiKey;
    }
    
    const response = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'AI对话失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }
          try {
            const json = JSON.parse(data);
            if (json.content && onChunk) {
              onChunk(json.content);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
  },
  suggestTags: (content) => 
    apiRequest('/ai/suggest-tags', { method: 'POST', body: { content } })
};

// 设置API
export const settingsAPI = {
  get: () => apiRequest('/settings'),
  update: (data) => apiRequest('/settings', { method: 'PUT', body: data }),
  testAPI: (apiKey) => 
    apiRequest('/settings/test-api', { method: 'POST', body: { apiKey } }),
  getAPIStatus: () => apiRequest('/settings/api-status')
};

// 标签API
export const tagsAPI = {
  getAll: () => apiRequest('/tags'),
  create: (data) => apiRequest('/tags', { method: 'POST', body: data }),
  update: (id, data) => apiRequest(`/tags/${id}`, { method: 'PUT', body: data }),
  delete: (id) => apiRequest(`/tags/${id}`, { method: 'DELETE' })
};

// 导出API
export const exportAPI = {
  exportJSON: () => {
    window.open(`${API_BASE}/export/json`, '_blank');
  },
  exportMarkdown: () => {
    window.open(`${API_BASE}/export/markdown`, '_blank');
  }
};

// PDF上传API
export const pdfAPI = {
  upload: async (file, moduleId = null, knowledgeBaseId = null) => {
    const formData = new FormData();
    formData.append('file', file);
    if (moduleId) {
      formData.append('moduleId', moduleId);
    }
    if (knowledgeBaseId) {
      formData.append('knowledge_base_id', knowledgeBaseId);
    }
    
    const response = await fetch(`${API_BASE}/upload/pdf`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'PDF上传失败' }));
      throw new Error(error.message || 'PDF上传失败');
    }
    
    return await response.json();
  },
  getContent: async (id) => {
    try {
      const response = await apiRequest(`/items/${id}`);
      return response;
    } catch (error) {
      console.error('获取PDF内容失败:', error);
      throw error;
    }
  }
};

// 咨询对话API
export const consultationAPI = {
  // 分析文档
  analyzeDocument: async (docId) => {
    return apiRequest('/consultation/analyze-document', {
      method: 'POST',
      body: { docId }
    });
  },
  
  // 匹配文档
  matchDocument: async (question, currentKnowledgeBaseId = null, searchAllBases = false) => {
    return apiRequest('/consultation/match-document', {
      method: 'POST',
      body: { question, currentKnowledgeBaseId, searchAllBases }
    });
  },
  
  // 生成欢迎消息
  getWelcomeMessage: async (docId) => {
    return apiRequest('/consultation/welcome-message', {
      method: 'POST',
      body: { docId }
    });
  },
  
  // 咨询对话
  chat: async (messages, docId, context, docInfo, onChunk, enableEvaluation = null) => {
    // 如果enableEvaluation为null，从localStorage读取会话级设置，否则使用传入的值
    let shouldEvaluate = enableEvaluation;
    if (shouldEvaluate === null) {
      const sessionSetting = localStorage.getItem('knowledge_relevance_evaluation_enabled');
      if (sessionSetting !== null) {
        shouldEvaluate = sessionSetting === 'true';
      } else {
        // 如果没有会话级设置，从全局设置读取（需要先获取，这里先设为undefined让后端处理）
        shouldEvaluate = undefined;
      }
    }
    
    // 确保 false 值也被正确传递，而不是转换为 undefined
    // 如果 shouldEvaluate 是 false，应该明确传递 false
    const evaluationParam = shouldEvaluate === undefined ? undefined : shouldEvaluate;
    
    console.log('[前端] 相关性评估参数:', {
      enableEvaluation,
      sessionSetting: localStorage.getItem('knowledge_relevance_evaluation_enabled'),
      shouldEvaluate,
      evaluationParam,
      docId,
      hasDocInfo: !!docInfo
    });
    
    // 获取用户API Key
    const userApiKey = await getUserApiKey();
    const requestBody = { messages, docId, context, docInfo, enableEvaluation: evaluationParam };
    if (userApiKey) {
      requestBody.userApiKey = userApiKey;
    }
    
    const response = await fetch(`${API_BASE}/consultation/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorMessage = '咨询对话失败';
      try {
        const error = await response.json();
        errorMessage = error.message || errorMessage;
      } catch (e) {
        // 如果响应不是JSON，尝试读取文本
        const text = await response.text().catch(() => '');
        errorMessage = text || `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    // 检查响应类型
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/event-stream')) {
      throw new Error('服务器响应格式错误，期望流式响应');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let citations = [];
    let evaluationResult = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue; // 跳过空行
          
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              return { content: fullContent, citations, evaluation: evaluationResult };
            }
            
            // 检查是否是错误消息
            if (data.startsWith('{') && data.includes('"error"')) {
              try {
                const errorJson = JSON.parse(data);
                if (errorJson.error) {
                  throw new Error(errorJson.error);
                }
              } catch (e) {
                if (e.message && e.message !== '[object Object]') {
                  throw e;
                }
              }
            }
            
            try {
              const json = JSON.parse(data);
              
              // 处理评估结果
              if (json.evaluation) {
                evaluationResult = json.evaluation;
                if (onChunk) {
                  onChunk({ evaluation: json.evaluation });
                }
                continue;
              }
              
              // 处理内容
              if (json.content !== undefined) {
                fullContent += json.content || '';
                if (onChunk) {
                  onChunk({ content: json.content || '', citations: json.citations || [] });
                }
              }
              
              // 处理引用
              if (json.citations && Array.isArray(json.citations) && json.citations.length > 0) {
                // 合并引用，去重
                json.citations.forEach(citation => {
                  const exists = citations.find(c => 
                    c.page === citation.page && c.text === citation.text
                  );
                  if (!exists) {
                    citations.push(citation);
                  }
                });
                // 如果有新引用，也触发回调更新
                if (onChunk) {
                  onChunk({ content: '', citations: json.citations });
                }
              }
            } catch (e) {
              // 忽略非JSON数据（可能是流式数据的分片）
              console.warn('解析SSE数据失败:', data.substring(0, 100), e);
            }
          }
        }
      }
    } catch (error) {
      // 确保释放reader
      try {
        reader.releaseLock();
      } catch (e) {
        // 忽略释放错误
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    
    return { content: fullContent, citations, evaluation: evaluationResult };
  }
};

// Context管理API
export const contextAPI = {
  getActive: () => apiRequest('/contexts/active'),
  update: (data) => apiRequest('/contexts/active', { method: 'PUT', body: data })
};

// 知识库提取API
export const knowledgeAPI = {
  // 提取知识
  extract: (itemIds, knowledgeBaseId, extractionOptions = {}) => {
    return apiRequest('/knowledge/extract', {
      method: 'POST',
      body: { itemIds, knowledgeBaseId, extractionOptions }
    });
  },
  
  // 获取提取状态
  getExtractionStatus: (extractionId) => {
    return apiRequest(`/knowledge/extract/${extractionId}/status`);
  },
  
  // 获取知识列表
  getItems: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/knowledge/items?${query}`);
  },
  
  // 获取知识点详情
  getItemById: (id) => {
    return apiRequest(`/knowledge/items/${id}`);
  },
  
  // 创建知识点（手动）
  createItem: (data) => {
    return apiRequest('/knowledge/items', {
      method: 'POST',
      body: data
    });
  },
  
  // 更新知识点
  updateItem: (id, data) => {
    return apiRequest(`/knowledge/items/${id}`, {
      method: 'PUT',
      body: data
    });
  },
  
  // 删除知识点
  deleteItem: (id) => {
    return apiRequest(`/knowledge/items/${id}`, {
      method: 'DELETE'
    });
  },
  
  // 获取相关知识
  getRelatedKnowledge: (id, limit = 5, minSimilarity = 60) => {
    return apiRequest(`/knowledge/items/${id}/related?limit=${limit}&minSimilarity=${minSimilarity}`);
  },
  
  // 获取知识图谱数据
  getGraphData: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/knowledge/graph?${query}`);
  },
  
  // 获取子分类列表
  getSubcategories: (category = null) => {
    const query = category ? `?category=${category}` : '';
    return apiRequest(`/knowledge/subcategories${query}`);
  },
  
  // 创建子分类
  createSubcategory: (data) => {
    return apiRequest('/knowledge/subcategories', {
      method: 'POST',
      body: data
    });
  },
  
  // 更新子分类
  updateSubcategory: (id, data) => {
    return apiRequest(`/knowledge/subcategories/${id}`, {
      method: 'PUT',
      body: data
    });
  },
  
  // 删除子分类
  deleteSubcategory: (id) => {
    return apiRequest(`/knowledge/subcategories/${id}`, {
      method: 'DELETE'
    });
  }
};

