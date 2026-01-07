import { pdfAPI } from './api.js';

// PDF 内容缓存（避免重复请求）
const pdfContentCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

/**
 * 上传PDF文件
 * @param {File} file - PDF文件
 * @param {string} moduleId - 模块ID（可选）
 * @param {string} knowledgeBaseId - 知识库ID（可选，默认使用当前知识库）
 * @returns {Promise<Object>}
 */
export async function uploadPDF(file, moduleId = null, knowledgeBaseId = null) {
  try {
    // 如果没有提供知识库ID，使用当前知识库
    if (!knowledgeBaseId) {
      const kbModule = await import('./knowledge-bases.js');
      knowledgeBaseId = kbModule.getCurrentKnowledgeBaseId();
    }
    
    const response = await pdfAPI.upload(file, moduleId, knowledgeBaseId);
    return response.data;
  } catch (error) {
    throw new Error(error.message || 'PDF上传失败');
  }
}

/**
 * 获取PDF内容（带缓存）
 * @param {string} id - PDF文档ID
 * @returns {Promise<Object>}
 */
export async function getPDFContent(id) {
  // 检查缓存
  if (pdfContentCache.has(id)) {
    const cached = pdfContentCache.get(id);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('从缓存获取PDF内容:', id);
      return cached.data;
    } else {
      // 缓存过期，删除
      pdfContentCache.delete(id);
    }
  }
  
  try {
    const response = await pdfAPI.getContent(id);
    console.log('getPDFContent响应:', response);
    
    let pdfData = null;
    
    // 处理不同的响应格式
    if (response && response.success && response.data) {
      pdfData = response.data;
    } else if (response && response.data) {
      pdfData = response.data;
    } else if (response) {
      pdfData = response;
    } else {
      throw new Error('响应格式错误');
    }
    
    // 确保 page_content 被正确解析
    if (pdfData && pdfData.page_content) {
      if (typeof pdfData.page_content === 'string') {
        try {
          pdfData.page_content = JSON.parse(pdfData.page_content);
        } catch (e) {
          console.warn('page_content JSON解析失败:', e);
          pdfData.page_content = [];
        }
      }
      // 确保是数组
      if (!Array.isArray(pdfData.page_content)) {
        console.warn('page_content不是数组，转换为数组');
        pdfData.page_content = [];
      }
    } else if (pdfData && pdfData.type === 'pdf') {
      // 如果没有 page_content，初始化为空数组
      pdfData.page_content = [];
    }
    
    // 确保返回的数据包含必要的字段
    if (pdfData && !pdfData.id && response.data && response.data.id) {
      pdfData.id = response.data.id;
    }
    if (pdfData && !pdfData.type && response.data && response.data.type) {
      pdfData.type = response.data.type;
    }
    if (pdfData && !pdfData.file_path && response.data && response.data.file_path) {
      pdfData.file_path = response.data.file_path;
    }
    
    console.log('处理后的PDF数据:', pdfData);
    
    // 缓存结果
    if (pdfData) {
      pdfContentCache.set(id, {
        data: pdfData,
        timestamp: Date.now()
      });
      
      // 限制缓存大小（最多保存 50 个）
      if (pdfContentCache.size > 50) {
        const firstKey = pdfContentCache.keys().next().value;
        pdfContentCache.delete(firstKey);
      }
    }
    
    return pdfData;
  } catch (error) {
    console.error('getPDFContent错误:', error);
    throw new Error(error.message || '获取PDF内容失败');
  }
}

/**
 * 清除PDF缓存
 * @param {string} id - PDF文档ID（可选，不提供则清除所有）
 */
export function clearPDFCache(id = null) {
  if (id) {
    pdfContentCache.delete(id);
  } else {
    pdfContentCache.clear();
  }
}

/**
 * 渲染PDF内容到右侧面板
 * @param {Object} pdfData - PDF数据 { raw_content, page_content, id, file_path, type }
 * @param {HTMLElement} container - 容器元素
 */
export async function renderPDFContent(pdfData, container) {
  console.log('=== renderPDFContent 开始 ===');
  console.log('PDF数据:', pdfData);
  console.log('容器元素:', container);
  
  if (!pdfData || !container) {
    console.error('renderPDFContent: 缺少参数', { pdfData, container });
    if (container) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20">
          <p class="text-sm text-red-600">渲染失败：缺少必要参数</p>
        </div>
      `;
      container.classList.remove('opacity-0');
    }
    return;
  }

  // 如果是PDF类型且有文件路径，使用PDF.js查看器
  console.log('renderPDFContent - 检查PDF数据:', { 
    type: pdfData.type, 
    hasFilePath: !!pdfData.file_path, 
    hasId: !!pdfData.id,
    id: pdfData.id,
    file_path: pdfData.file_path
  });
  
  if (pdfData.type === 'pdf' && pdfData.file_path) {
    // 在try块外定义pdfUrl，以便在catch块中使用
    let pdfUrl = null;
    
    try {
      // 构建PDF文件URL
      const pdfId = pdfData.id;
      if (!pdfId) {
        console.warn('PDF数据缺少id，无法构建文件URL，PDF数据:', pdfData);
        // 降级到文本显示
        return renderPDFContentAsText(pdfData, container);
      }

      pdfUrl = `/api/files/pdf/${pdfId}`;
      console.log('使用PDF.js查看器加载PDF:', pdfUrl, '文件路径:', pdfData.file_path);

      // 先显示加载状态
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20">
          <div class="relative">
            <div class="animate-spin rounded-full h-16 w-16 border-4 border-indigo-200 border-t-indigo-600 mb-6"></div>
            <i data-lucide="file-text" size="24" class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-indigo-600"></i>
          </div>
          <p class="text-sm font-medium text-slate-700 mb-2">正在加载PDF...</p>
          <p class="text-xs text-slate-400">请稍候</p>
        </div>
      `;
      container.classList.remove('opacity-0');
      if (window.lucide) {
        lucide.createIcons(container);
      }

      // 先测试PDF URL是否可访问（带重试机制，处理文件上传后立即加载的情况）
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 2000; // 2秒
      
      while (retryCount <= maxRetries) {
        try {
          console.log(`测试PDF URL可访问性 (尝试 ${retryCount + 1}/${maxRetries + 1}):`, pdfUrl);
          const testResponse = await fetch(pdfUrl, { method: 'HEAD' });
          console.log('PDF URL测试响应:', testResponse.status, testResponse.statusText);
          
          if (!testResponse.ok) {
            // 如果是404且还有重试次数，等待后重试
            if (testResponse.status === 404 && retryCount < maxRetries) {
              console.log(`文件未找到，等待 ${retryDelay}ms 后重试...`);
              // 更新加载提示
              container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20">
                  <div class="relative">
                    <div class="animate-spin rounded-full h-16 w-16 border-4 border-indigo-200 border-t-indigo-600 mb-6"></div>
                    <i data-lucide="file-text" size="24" class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-indigo-600"></i>
                  </div>
                  <p class="text-sm font-medium text-slate-700 mb-2">正在加载PDF...</p>
                  <p class="text-xs text-slate-400">文件处理中，请稍候 (${retryCount + 1}/${maxRetries + 1})</p>
                </div>
              `;
              if (window.lucide) {
                lucide.createIcons(container);
              }
              
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              retryCount++;
              continue;
            }
            
            // 其他错误或重试次数用完，抛出错误
            if (testResponse.status === 404) {
              throw new Error('PDF文件访问失败: 404 文件未找到');
            } else if (testResponse.status === 403) {
              throw new Error('PDF文件访问失败: 403 权限不足');
            } else {
              throw new Error(`PDF文件访问失败: ${testResponse.status} ${testResponse.statusText}`);
            }
          }
          
          // 成功，跳出循环
          break;
        } catch (fetchError) {
          // 如果是网络错误且还有重试次数，重试
          if (retryCount < maxRetries && (fetchError.message.includes('fetch failed') || fetchError.message.includes('Failed to fetch'))) {
            console.log(`网络错误，等待 ${retryDelay}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            retryCount++;
            continue;
          }
          
          // 其他错误或重试次数用完，抛出错误
          console.error('PDF URL访问测试失败:', fetchError);
          // 如果是404，提供更明确的错误信息
          if (fetchError.message.includes('404')) {
            console.error('PDF文件未找到，可能的原因：');
            console.error('1. 文件路径不正确');
            console.error('2. 文件已被删除');
            console.error('3. 后端文件服务未正确配置');
            console.error('4. 文件可能还在处理中，请稍后刷新页面');
          }
          throw fetchError;
        }
      }
      
      // 导入PDF查看器
      const { initPDFViewer } = await import('./pdf-viewer.js');
      
      // 初始化PDF查看器（默认100%缩放，适合右侧面板显示）
      const viewer = await initPDFViewer(pdfUrl, container, {
        scale: 1.0,
        page: 1
      });

      if (viewer) {
        console.log('PDF查看器初始化成功');
        // 保存PDF查看器实例到state
        if (window.setPDFViewerInstance) {
          window.setPDFViewerInstance(viewer);
        }
        container.classList.remove('opacity-0');
        return;
      } else {
        console.warn('PDF查看器初始化失败，降级到文本显示');
        // 降级到文本显示
        return renderPDFContentAsText(pdfData, container);
      }
    } catch (error) {
      console.error('PDF.js查看器加载失败:', error);
      console.error('错误堆栈:', error.stack);
      console.error('错误详情:', {
        name: error.name,
        message: error.message,
        pdfUrl: pdfUrl || '未定义',
        pdfId: pdfData.id,
        file_path: pdfData.file_path,
        hasPdfJs: typeof pdfjsLib !== 'undefined',
        workerSrc: typeof pdfjsLib !== 'undefined' ? pdfjsLib.GlobalWorkerOptions?.workerSrc : 'N/A'
      });
      
      // 根据错误类型提供更友好的提示
      let errorMessage = error.message || '未知错误';
      let errorIcon = 'file-x';
      let errorTitle = 'PDF加载失败';
      let showTextFallback = true;
      
      // 针对404错误提供更友好的提示
      if (error.message && error.message.includes('404')) {
        errorTitle = 'PDF文件未找到';
        errorMessage = '文件可能已被删除或路径不正确';
        errorIcon = 'file-question';
        showTextFallback = false; // 404时不需要降级到文本显示
      } else if (error.message && error.message.includes('403')) {
        errorTitle = '无法访问PDF文件';
        errorMessage = '没有权限访问此文件';
        errorIcon = 'file-lock';
      } else if (error.message && error.message.includes('500')) {
        errorTitle = '服务器错误';
        errorMessage = '服务器处理文件时出错，请稍后重试';
      }
      
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 px-4">
          <i data-lucide="${errorIcon}" size="64" class="text-slate-300 mb-6"></i>
          <h3 class="text-base font-semibold text-slate-700 mb-2">${errorTitle}</h3>
          <p class="text-sm text-slate-500 mb-6 text-center max-w-md">${errorMessage}</p>
          ${showTextFallback ? `
            <div class="flex items-center gap-2 text-xs text-slate-400">
              <i data-lucide="loader-2" size="14" class="animate-spin"></i>
              <span>正在尝试显示文本内容...</span>
            </div>
          ` : ''}
        </div>
      `;
      container.classList.remove('opacity-0');
      if (window.lucide) {
        lucide.createIcons(container);
      }
      
      // 只在非404错误时延迟降级到文本显示
      if (showTextFallback && pdfData && pdfData.page_content) {
        setTimeout(() => {
          console.log('降级到文本显示...');
          renderPDFContentAsText(pdfData, container);
        }, 2000);
      }
      
      return;
    }
  }

  // 如果不是PDF类型或没有文件路径，使用文本显示
  console.log('PDF类型不匹配或缺少文件路径，使用文本显示');
  return renderPDFContentAsText(pdfData, container);
}

/**
 * 渲染PDF内容为文本（降级方案）
 * @param {Object} pdfData - PDF数据 { raw_content, page_content }
 * @param {HTMLElement} container - 容器元素
 */
function renderPDFContentAsText(pdfData, container) {
  if (!pdfData || !container) {
    console.error('renderPDFContentAsText: 缺少参数', { pdfData, container });
    return;
  }
  
  // 确保 page_content 是数组
  let pages = [];
  if (pdfData.page_content) {
    if (Array.isArray(pdfData.page_content)) {
      pages = pdfData.page_content;
    } else if (typeof pdfData.page_content === 'string') {
      // 如果是字符串，尝试解析JSON
      try {
        pages = JSON.parse(pdfData.page_content);
        if (!Array.isArray(pages)) {
          pages = [];
        }
      } catch (e) {
        console.warn('page_content JSON解析失败:', e);
        pages = [];
      }
    }
  }
  
  console.log('renderPDFContent - pages:', pages, 'type:', typeof pages, 'isArray:', Array.isArray(pages));
  
  // 最终确保 pages 是数组
  if (!Array.isArray(pages)) {
    console.warn('pages不是数组，强制转换为数组');
    pages = [];
  }
  
  // 如果没有分页内容，使用原始内容
  if (pages.length === 0) {
    if (pdfData.raw_content) {
      container.innerHTML = `
        <div class="bg-white shadow-sm border border-slate-200 min-h-[800px] p-10 pb-20 max-w-[700px] mx-auto overflow-y-auto" style="max-height: calc(100vh - 100px); padding-bottom: 4rem;">
          <div class="mb-8" data-page="1">
            <div class="text-xs text-slate-300 font-mono mb-2 text-right">PAGE 1</div>
            <div class="prose prose-sm text-slate-600 leading-8">
              ${escapeHtml(pdfData.raw_content).replace(/\n/g, '<br>')}
            </div>
          </div>
        </div>
      `;
      container.classList.remove('opacity-0');
      return;
    } else {
      container.innerHTML = `
        <div class="bg-white shadow-sm border border-slate-200 min-h-[800px] p-10 max-w-[700px] mx-auto flex items-center justify-center">
          <div class="text-center text-slate-400 py-8">暂无内容</div>
        </div>
      `;
      container.classList.remove('opacity-0');
      return;
    }
  }
  
  // 现在可以安全地使用 forEach
  let html = '';
  try {
    pages.forEach((page, index) => {
      // 为每个段落添加可能的引用标记
      const content = page?.content || page?.text || '';
      const pageNum = page?.pageNum || page?.page || (index + 1);
      
      if (!content || !content.trim()) {
        // 跳过空页面，但保留页码标记
        html += `
          <div class="mb-8 pb-6 border-b border-slate-100" data-page="${pageNum}">
            <div class="text-xs text-slate-300 font-mono mb-2 text-right">PAGE ${pageNum}</div>
            <div class="prose prose-sm text-slate-400 italic">
              （本页无内容）
            </div>
          </div>
        `;
        return;
      }
      
      // 将文本按段落分割，每段单独显示
      const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
      const contentHtml = paragraphs.length > 0 
        ? paragraphs.map(p => `<p class="mb-3">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')
        : `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`;
      
      html += `
        <div class="mb-8 pb-6 border-b border-slate-100 last:border-0" data-page="${pageNum}">
          <div class="text-xs text-slate-300 font-mono mb-3 text-right">PAGE ${pageNum}</div>
          <div class="prose prose-sm text-slate-600 leading-7 max-w-none">
            ${contentHtml}
          </div>
        </div>
      `;
    });
  } catch (error) {
    console.error('渲染PDF页面时出错:', error);
    html = '<div class="text-center text-red-400 py-8">渲染出错，请查看控制台</div>';
  }
  
  if (!html) {
    html = '<div class="text-center text-slate-400 py-8">暂无内容</div>';
  }
  
  // 包装在容器中以便正确显示
  container.innerHTML = `
    <div class="bg-white shadow-sm border border-slate-200 min-h-[800px] p-10 pb-20 max-w-[700px] mx-auto overflow-y-auto" style="max-height: calc(100vh - 100px); padding-bottom: 4rem;">
      ${html}
    </div>
  `;
  container.classList.remove('opacity-0');
}

/**
 * 高亮指定页面
 * @param {HTMLElement} container - PDF容器
 * @param {number} pageNumber - 页码
 */
export function highlightPage(container, pageNumber) {
  if (!container) return;
  
  // 移除所有高亮
  container.querySelectorAll('.highlighted-page').forEach(el => {
    el.classList.remove('highlighted-page', 'bg-yellow-100', 'border-l-4', 'border-yellow-500', 'pl-4');
  });
  
  // 高亮指定页面
  const pageEl = container.querySelector(`[data-page="${pageNumber}"]`);
  if (pageEl) {
    pageEl.classList.add('highlighted-page', 'bg-yellow-100', 'border-l-4', 'border-yellow-500', 'pl-4', 'transition-all', 'duration-300');
    pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // 3秒后移除高亮
    setTimeout(() => {
      pageEl.classList.remove('highlighted-page', 'bg-yellow-100', 'border-l-4', 'border-yellow-500', 'pl-4');
    }, 3000);
  }
}

/**
 * 滚动到引用位置
 * @param {HTMLElement} container - PDF容器
 * @param {string} quoteText - 引用文本
 */
export function scrollToQuote(container, quoteText) {
  if (!container || !quoteText) return;
  
  // 在PDF内容中搜索匹配文本
  const text = container.textContent || '';
  const index = text.indexOf(quoteText);
  
  if (index === -1) return;
  
  // 找到包含该文本的元素
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let node;
  let currentIndex = 0;
  
  while ((node = walker.nextNode())) {
    const nodeLength = node.textContent.length;
    if (currentIndex + nodeLength >= index) {
      // 找到包含引用的元素
      let parent = node.parentElement;
      while (parent && parent !== container) {
        if (parent.hasAttribute('data-page')) {
          highlightPage(container, parseInt(parent.getAttribute('data-page')));
          break;
        }
        parent = parent.parentElement;
      }
      break;
    }
    currentIndex += nodeLength;
  }
}

/**
 * 在PDF内容中高亮指定文本
 * @param {HTMLElement} container - PDF容器
 * @param {string} text - 要高亮的文本
 */
export function highlightTextInPDF(container, text) {
  if (!container || !text) return;
  
  // 在所有页面中搜索文本
  const pages = container.querySelectorAll('[data-page]');
  pages.forEach(pageEl => {
    const pageContent = pageEl.querySelector('.prose');
    if (pageContent && pageContent.textContent.includes(text)) {
      const originalHtml = pageContent.innerHTML;
      const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedText})`, 'gi');
      const highlightedHtml = originalHtml.replace(regex, '<mark class="bg-yellow-300 px-1 rounded">$1</mark>');
      pageContent.innerHTML = highlightedHtml;
      
      // 滚动到该页面
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // 3秒后恢复
      setTimeout(() => {
        pageContent.innerHTML = originalHtml;
      }, 3000);
    }
  });
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

