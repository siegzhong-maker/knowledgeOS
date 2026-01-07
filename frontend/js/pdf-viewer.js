/**
 * PDF查看器组件
 * 使用PDF.js渲染PDF文件
 */
import { loadPDFJS } from './utils.js';

/**
 * 初始化PDF查看器
 * @param {string} pdfUrl - PDF文件URL
 * @param {HTMLElement} container - 容器元素
 * @param {Object} options - 选项 { scale, page }
 */
export async function initPDFViewer(pdfUrl, container, options = {}) {
  if (!pdfUrl || !container) {
    console.error('PDF查看器初始化失败：缺少参数');
    return null;
  }

  // 动态加载 PDF.js
  let pdfjsLib;
  try {
    pdfjsLib = await loadPDFJS();
  } catch (error) {
    console.error('PDF.js 加载失败:', error);
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20">
        <p class="text-sm text-red-600 mb-2">PDF.js 加载失败</p>
        <p class="text-xs text-slate-500">${error.message}</p>
      </div>
    `;
    return null;
  }

  // 检查Worker配置
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    console.warn('PDF.js Worker未配置，尝试配置...');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const { scale = 1.0, page: initialPage = 1 } = options;
  
  try {
    // 显示加载状态
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
        <p class="text-sm text-slate-500">正在加载PDF...</p>
      </div>
    `;

    // 加载PDF文档
    console.log('开始加载PDF文档:', pdfUrl);
    console.log('PDF.js Worker:', pdfjsLib.GlobalWorkerOptions.workerSrc);
    
    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      httpHeaders: {},
      withCredentials: false,
      // 确保使用标准模式，支持图片和复杂内容
      verbosity: 0, // 0 = errors, 1 = warnings, 5 = infos
      disableAutoFetch: false,
      disableStream: false
    });

    // 监听加载进度
    loadingTask.onProgress = (progress) => {
      if (progress.total > 0) {
        const percent = Math.round((progress.loaded / progress.total) * 100);
        console.log(`PDF加载进度: ${percent}%`);
      }
    };

    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    console.log('PDF加载成功，总页数:', numPages);

    // 创建PDF查看器结构
    const viewerHTML = `
      <div class="pdf-viewer-container bg-white w-full h-full flex flex-col">
        <!-- 工具栏 -->
        <div class="pdf-toolbar bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-center justify-between sticky top-0 z-10 shadow-sm flex-shrink-0">
          <div class="flex items-center gap-2">
            <button id="pdf-prev-page" class="px-3 py-1.5 text-sm text-slate-700 hover:bg-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="上一页">
              <i data-lucide="chevron-left" size="16"></i>
            </button>
            <span class="text-sm text-slate-600">
              <span id="pdf-current-page">1</span> / <span id="pdf-total-pages">${numPages}</span>
            </span>
            <button id="pdf-next-page" class="px-3 py-1.5 text-sm text-slate-700 hover:bg-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="下一页">
              <i data-lucide="chevron-right" size="16"></i>
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button id="pdf-zoom-out" class="px-3 py-1.5 text-sm text-slate-700 hover:bg-white rounded transition-colors" title="缩小">
              <i data-lucide="zoom-out" size="16"></i>
            </button>
            <span class="text-sm text-slate-600 min-w-[60px] text-center">
              <span id="pdf-zoom-level">${Math.round(scale * 100)}</span>%
            </span>
            <button id="pdf-zoom-in" class="px-3 py-1.5 text-sm text-slate-700 hover:bg-white rounded transition-colors" title="放大">
              <i data-lucide="zoom-in" size="16"></i>
            </button>
            <button id="pdf-fit-width" class="px-3 py-1.5 text-sm text-slate-700 hover:bg-white rounded transition-colors ml-2" title="适应宽度">
              <i data-lucide="maximize" size="16"></i>
            </button>
          </div>
        </div>
        
        <!-- PDF页面容器 -->
        <div id="pdf-pages-container" class="pdf-pages-container p-4 pb-12 space-y-4 overflow-y-auto w-full flex-1">
          <!-- 页面将在这里动态渲染 -->
        </div>
      </div>
    `;

    container.innerHTML = viewerHTML;

    // 初始化Lucide图标
    if (window.lucide) {
      lucide.createIcons(container);
    }

    const pagesContainer = document.getElementById('pdf-pages-container');
    let currentPage = Math.min(initialPage, numPages);
    let currentScale = scale;

    // 渲染页面
    async function renderPage(pageNum) {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: currentScale });

        // 创建canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // 获取设备像素比，用于高DPI显示
        const dpr = window.devicePixelRatio || 1;
        const outputScale = dpr;
        
        // 设置canvas的实际像素尺寸（考虑设备像素比）
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        
        // 设置canvas的CSS显示尺寸（保持原始viewport尺寸）
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        
        // 缩放context以匹配设备像素比
        context.scale(outputScale, outputScale);
        
        canvas.className = 'pdf-page-canvas mx-auto block shadow-lg border border-slate-200';
        canvas.id = `pdf-page-${pageNum}`;

        // 创建页面容器
        const pageContainer = document.createElement('div');
        pageContainer.className = 'pdf-page-wrapper flex justify-center';
        pageContainer.id = `pdf-page-wrapper-${pageNum}`;
        pageContainer.appendChild(canvas);

        // 检查是否已存在该页面
        const existingPage = document.getElementById(`pdf-page-wrapper-${pageNum}`);
        if (existingPage) {
          existingPage.replaceWith(pageContainer);
        } else {
          // 如果是第一页，移除"正在加载页面..."的提示
          if (pageNum === 1) {
            const loadingDiv = pagesContainer.querySelector('.text-center');
            if (loadingDiv && loadingDiv.textContent.includes('正在加载页面')) {
              pagesContainer.innerHTML = ''; // 清空容器，移除加载提示
            }
          }
          pagesContainer.appendChild(pageContainer);
        }

        // 渲染页面（使用原始viewport，context已经scale过了）
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;

        return pageContainer;
      } catch (error) {
        console.error(`渲染第${pageNum}页失败:`, error);
        return null;
      }
    }

    // 渲染所有页面（按需加载）
    async function renderAllPages() {
      // 清空容器并显示加载提示
      pagesContainer.innerHTML = '<div class="text-center py-4 text-slate-400 text-sm">正在加载页面...</div>';
      
      try {
        // 先渲染第一页
        const firstPage = await renderPage(1);
        
        // 如果第一页渲染成功，清除加载提示
        if (firstPage) {
          // 清空加载提示，保留已渲染的页面
          const loadingDiv = pagesContainer.querySelector('.text-center');
          if (loadingDiv && loadingDiv.textContent.includes('正在加载页面')) {
            loadingDiv.remove();
          }
        }
        
        // 然后渲染其他页面（延迟加载以提高性能）
        for (let i = 2; i <= numPages; i++) {
          // 使用setTimeout延迟加载，避免阻塞
          setTimeout(async () => {
            await renderPage(i);
          }, (i - 1) * 100);
        }
      } catch (error) {
        console.error('渲染PDF页面失败:', error);
        pagesContainer.innerHTML = `
          <div class="text-center py-8 text-red-400">
            <p class="text-sm mb-2">渲染失败</p>
            <p class="text-xs text-slate-400">${error.message || '未知错误'}</p>
          </div>
        `;
      }
    }

    // 移除文本高亮overlay
    function removeTextHighlights() {
      pagesContainer.querySelectorAll('.pdf-text-highlight').forEach(el => {
        el.remove();
      });
    }

    // 仅滚动到页面（不处理文本搜索，避免递归）
    function scrollToPageOnly(pageNum) {
      const pageElement = document.getElementById(`pdf-page-wrapper-${pageNum}`);
      if (pageElement) {
        // 移除所有现有的高亮
        pagesContainer.querySelectorAll('.highlighted-pdf-page').forEach(el => {
          el.classList.remove('highlighted-pdf-page');
        });
        removeTextHighlights();
        
        // 滚动到页面（居中显示）
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 添加高亮效果
        pageElement.classList.add('highlighted-pdf-page');
        
        // 3秒后移除高亮
        setTimeout(() => {
          pageElement.classList.remove('highlighted-pdf-page');
        }, 3000);
      }
    }

    // 定位到页面中的特定文本
    async function scrollToText(pageNum, searchText) {
      if (!searchText || !searchText.trim()) {
        scrollToPageOnly(pageNum);
        return;
      }

      console.log('开始文本定位:', { pageNum, searchText });

      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: currentScale });
        
        // 清理和规范化搜索文本 - 移除HTML实体，统一空格，转小写
        let cleanSearchText = searchText.trim();
        // 解码HTML实体（如果存在）
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cleanSearchText;
        cleanSearchText = tempDiv.textContent || tempDiv.innerText || cleanSearchText;
        
        // 规范化：移除多余空格，转小写
        const normalizedSearchText = cleanSearchText.replace(/\s+/g, ' ').toLowerCase();
        console.log('规范化搜索文本:', normalizedSearchText);
        console.log('搜索文本长度:', normalizedSearchText.length);
        
        const items = textContent.items;
        console.log('文本项数量:', items.length);
        
        // 更简单可靠的匹配算法：直接遍历文本项，逐步构建文本
        let startIndex = -1;
        let endIndex = -1;
        let accumulatedText = '';
        
        // 尝试多种匹配策略
        const searchVariants = [
          normalizedSearchText, // 完整文本
          normalizedSearchText.substring(0, Math.min(50, normalizedSearchText.length)), // 前50字符
          normalizedSearchText.substring(0, Math.min(30, normalizedSearchText.length)), // 前30字符
          normalizedSearchText.substring(0, Math.min(20, normalizedSearchText.length)), // 前20字符
        ];
        
        for (const searchVariant of searchVariants) {
          if (searchVariant.length < 5) break; // 太短不搜索
          
          accumulatedText = '';
          startIndex = -1;
          endIndex = -1;
          
          // 构建文本并查找匹配
          for (let i = 0; i < items.length; i++) {
            const itemText = items[i].str || '';
            accumulatedText += itemText + ' ';
            
            // 规范化累积文本
            const normalizedAccumulated = accumulatedText.replace(/\s+/g, ' ').toLowerCase();
            
              // 检查是否包含搜索文本
              const matchIndex = normalizedAccumulated.indexOf(searchVariant);
              if (matchIndex !== -1 && startIndex === -1) {
                // 找到匹配，向前追溯找到起始文本项
                let tempText = '';
                for (let j = 0; j <= i; j++) {
                  tempText += (items[j].str || '') + ' ';
                  const normalizedTemp = tempText.replace(/\s+/g, ' ').toLowerCase();
                  if (normalizedTemp.includes(searchVariant)) {
                    startIndex = j;
                    // 继续查找，确定结束位置
                    let endText = '';
                    for (let k = j; k <= Math.min(j + 50, items.length - 1); k++) {
                      endText += (items[k].str || '') + ' ';
                      const normalizedEnd = endText.replace(/\s+/g, ' ').toLowerCase();
                      // 如果累积文本包含了完整的搜索变体，这就是结束位置
                      if (normalizedEnd.length >= normalizedAccumulated.length || 
                          normalizedEnd.includes(searchVariant) && normalizedEnd.length > searchVariant.length * 1.5) {
                        endIndex = k;
                        break;
                      }
                    }
                    if (endIndex === -1) {
                      // 如果没找到明确的结束位置，使用估算
                      const estimatedItems = Math.max(5, Math.ceil(searchVariant.length / 8));
                      endIndex = Math.min(j + estimatedItems, items.length - 1);
                    }
                    break;
                  }
                }
                if (startIndex !== -1) break;
              }
          }
          
          if (startIndex !== -1) {
            console.log('匹配成功，使用搜索变体:', searchVariant.substring(0, 30) + '...');
            break;
          }
        }
        
        console.log('匹配结果:', { startIndex, endIndex });
        
        if (startIndex === -1 || startIndex >= items.length) {
          console.warn('未找到匹配文本，降级到页面定位');
          scrollToPageOnly(pageNum);
          return;
        }
        
        // 计算匹配文本的边界框
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const searchEndIndex = Math.min(endIndex !== -1 ? endIndex + 1 : startIndex + 10, items.length);
        
        for (let i = startIndex; i < searchEndIndex; i++) {
          const item = items[i];
          if (!item || !item.transform) continue;
          
          const transform = item.transform;
          const x = transform[4]; // X position in PDF coordinates
          const y = transform[5]; // Y position in PDF coordinates (origin at bottom-left)
          
          // 计算文本宽度和高度
          const fontSize = item.fontSize || 12;
          const width = item.width || (item.str.length * fontSize * 0.6); // 估算宽度
          const height = item.height || fontSize;
          
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x + width);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y + height);
        }
        
        console.log('边界框 (PDF坐标):', { minX, minY, maxX, maxY });
        
        if (minX === Infinity || maxX === -Infinity) {
          console.warn('边界框计算失败，降级到页面定位');
          scrollToPageOnly(pageNum);
          return;
        }
        
        // 获取页面元素和canvas
        const pageElement = document.getElementById(`pdf-page-wrapper-${pageNum}`);
        const canvas = document.getElementById(`pdf-page-${pageNum}`);
        
        if (!pageElement || !canvas) {
          console.warn('找不到页面元素或canvas，降级到页面定位');
          scrollToPageOnly(pageNum);
          return;
        }
        
        // 移除现有的文本高亮
        removeTextHighlights();
        
        // 滚动到页面
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 添加页面高亮
        pagesContainer.querySelectorAll('.highlighted-pdf-page').forEach(el => {
          el.classList.remove('highlighted-pdf-page');
        });
        pageElement.classList.add('highlighted-pdf-page');
        setTimeout(() => {
          pageElement.classList.remove('highlighted-pdf-page');
        }, 3000);
        
        // 等待滚动完成后再添加文本高亮
        setTimeout(() => {
          // PDF坐标转viewport坐标
          // PDF坐标系：原点在左下角，Y轴向上
          // Viewport坐标系：原点在左上角，Y轴向下
          const viewportY1 = viewport.height - maxY; // 顶部Y坐标（viewport）
          const viewportY2 = viewport.height - minY; // 底部Y坐标（viewport）
          const viewportX = minX;
          const viewportWidth = maxX - minX;
          const viewportHeight = viewportY2 - viewportY1;
          
          console.log('Viewport坐标:', { viewportX, viewportY1, viewportY2, viewportWidth, viewportHeight });
          
          // 获取canvas的实际显示尺寸
          const canvasRect = canvas.getBoundingClientRect();
          const scaleX = canvasRect.width / viewport.width;
          const scaleY = canvasRect.height / viewport.height;
          
          console.log('缩放比例:', { scaleX, scaleY, canvasWidth: canvasRect.width, canvasHeight: canvasRect.height });
          
          // 计算高亮区域在canvas上的像素坐标（相对于canvas左上角）
          const highlightLeft = viewportX * scaleX;
          const highlightTop = viewportY1 * scaleY;
          const highlightWidth = viewportWidth * scaleX;
          const highlightHeight = Math.max(viewportHeight * scaleY, 15); // 最小高度15px
          
          console.log('高亮区域 (像素):', { highlightLeft, highlightTop, highlightWidth, highlightHeight });
          
          // 创建高亮overlay
          const highlightDiv = document.createElement('div');
          highlightDiv.className = 'pdf-text-highlight';
          highlightDiv.style.position = 'absolute';
          highlightDiv.style.left = highlightLeft + 'px';
          highlightDiv.style.top = highlightTop + 'px';
          highlightDiv.style.width = highlightWidth + 'px';
          highlightDiv.style.height = highlightHeight + 'px';
          highlightDiv.style.pointerEvents = 'none';
          highlightDiv.style.zIndex = '10';
          
          // 确保pageElement有relative定位
          if (window.getComputedStyle(pageElement).position === 'static') {
            pageElement.style.position = 'relative';
          }
          
          // 将高亮div添加到pageElement中（相对于pageElement定位）
          pageElement.appendChild(highlightDiv);
          
          console.log('高亮div已创建:', highlightDiv);
          
          // 调整滚动位置，使高亮区域可见
          setTimeout(() => {
            const pageElementRect = pageElement.getBoundingClientRect();
            const containerRect = pagesContainer.getBoundingClientRect();
            const highlightAbsoluteTop = pageElementRect.top - containerRect.top + highlightTop + pagesContainer.scrollTop;
            const highlightCenter = highlightAbsoluteTop + highlightHeight / 2;
            const containerCenter = pagesContainer.clientHeight / 2;
            const targetScrollTop = highlightCenter - containerCenter;
            
            if (Math.abs(targetScrollTop - pagesContainer.scrollTop) > 10) {
              pagesContainer.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth'
              });
            }
          }, 100);
          
          // 5秒后移除文本高亮
          setTimeout(() => {
            if (highlightDiv.parentNode) {
              highlightDiv.remove();
              console.log('文本高亮已移除');
            }
          }, 5000);
        }, 600); // 增加延迟，确保滚动完成
      } catch (error) {
        console.error('文本定位失败:', error);
        console.error('错误堆栈:', error.stack);
        // 降级到页面定位
        scrollToPageOnly(pageNum);
      }
    }

    // 滚动到指定页面
    function scrollToPage(pageNum, searchText = null) {
      const pageElement = document.getElementById(`pdf-page-wrapper-${pageNum}`);
      if (pageElement) {
        // 如果有搜索文本，使用文本定位
        if (searchText) {
          scrollToText(pageNum, searchText);
          return;
        }
        
        // 移除所有现有的高亮
        pagesContainer.querySelectorAll('.highlighted-pdf-page').forEach(el => {
          el.classList.remove('highlighted-pdf-page');
        });
        removeTextHighlights();
        
        // 滚动到页面（居中显示）
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 添加高亮效果
        pageElement.classList.add('highlighted-pdf-page');
        
        // 3秒后移除高亮
        setTimeout(() => {
          pageElement.classList.remove('highlighted-pdf-page');
        }, 3000);
      }
    }

    // 更新页面信息
    function updatePageInfo() {
      const currentPageEl = document.getElementById('pdf-current-page');
      const totalPagesEl = document.getElementById('pdf-total-pages');
      const zoomLevelEl = document.getElementById('pdf-zoom-level');
      
      if (currentPageEl) currentPageEl.textContent = currentPage;
      if (totalPagesEl) totalPagesEl.textContent = numPages;
      if (zoomLevelEl) zoomLevelEl.textContent = Math.round(currentScale * 100);
    }

    // 绑定事件
    const prevBtn = document.getElementById('pdf-prev-page');
    const nextBtn = document.getElementById('pdf-next-page');
    const zoomInBtn = document.getElementById('pdf-zoom-in');
    const zoomOutBtn = document.getElementById('pdf-zoom-out');
    const fitWidthBtn = document.getElementById('pdf-fit-width');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          scrollToPage(currentPage);
          updatePageInfo();
          prevBtn.disabled = currentPage === 1;
          nextBtn.disabled = currentPage === numPages;
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentPage < numPages) {
          currentPage++;
          scrollToPage(currentPage);
          updatePageInfo();
          prevBtn.disabled = currentPage === 1;
          nextBtn.disabled = currentPage === numPages;
        }
      });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', async () => {
        currentScale = Math.min(currentScale + 0.25, 3);
        await renderAllPages();
        scrollToPage(currentPage);
        updatePageInfo();
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', async () => {
        currentScale = Math.max(currentScale - 0.25, 0.5);
        await renderAllPages();
        scrollToPage(currentPage);
        updatePageInfo();
      });
    }

    if (fitWidthBtn) {
      fitWidthBtn.addEventListener('click', async () => {
        // 计算适应宽度的缩放比例
        const firstPage = await pdf.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        const containerWidth = pagesContainer.clientWidth || 800;
        currentScale = (containerWidth - 40) / viewport.width; // 减去padding
        await renderAllPages();
        scrollToPage(currentPage);
        updatePageInfo();
      });
    }

    // 初始化按钮状态
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === numPages;

    // 初始渲染
    await renderAllPages();
    updatePageInfo();
    
    // 自动适应宽度，确保在右侧面板中完整显示
    if (fitWidthBtn) {
      // 延迟执行，确保容器尺寸已计算
      setTimeout(async () => {
        const firstPage = await pdf.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        const containerWidth = pagesContainer.clientWidth || 800;
        currentScale = Math.min((containerWidth - 40) / viewport.width, 1.0); // 适应宽度，但不超过100%
        await renderAllPages();
        scrollToPage(currentPage);
        updatePageInfo();
      }, 100);
    }

    // 监听滚动，更新当前页面
    let scrollTimeout;
    pagesContainer.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const pages = Array.from(document.querySelectorAll('.pdf-page-wrapper'));
        const containerTop = pagesContainer.scrollTop;
        
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          const pageTop = page.offsetTop - pagesContainer.offsetTop;
          const pageBottom = pageTop + page.offsetHeight;
          
          if (containerTop >= pageTop - 100 && containerTop < pageBottom - 100) {
            const pageNum = parseInt(page.id.replace('pdf-page-wrapper-', ''));
            if (pageNum !== currentPage) {
              currentPage = pageNum;
              updatePageInfo();
              if (prevBtn) prevBtn.disabled = currentPage === 1;
              if (nextBtn) nextBtn.disabled = currentPage === numPages;
            }
            break;
          }
        }
      }, 100);
    });

    return {
      pdf,
      currentPage,
      numPages,
      scale: currentScale,
      renderPage,
      scrollToPage
    };
  } catch (error) {
    console.error('PDF查看器初始化失败:', error);
    console.error('错误详情:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      pdfUrl,
      workerSrc: pdfjsLib?.GlobalWorkerOptions?.workerSrc
    });
    
    let errorMessage = error.message || '未知错误';
    if (error.name === 'MissingPDFException' || error.name === 'InvalidPDFException') {
      errorMessage = 'PDF文件格式无效或损坏，请检查文件';
    } else if (error.message && error.message.includes('404')) {
      errorMessage = 'PDF文件未找到（404错误），请检查文件路径';
    } else if (error.message && error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = '无法连接到服务器，请检查网络连接';
    } else if (error.message && error.message.includes('Worker')) {
      errorMessage = 'PDF.js Worker加载失败，请刷新页面重试';
    }
    
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20">
        <i data-lucide="file-x" size="48" class="text-red-400 mb-4"></i>
        <p class="text-sm text-red-600 mb-2">加载PDF失败</p>
        <p class="text-xs text-slate-500 mb-4">${errorMessage}</p>
        <p class="text-xs text-slate-400">PDF URL: ${pdfUrl}</p>
        <button 
          onclick="location.reload()" 
          class="mt-4 px-4 py-2 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
        >
          刷新页面
        </button>
      </div>
    `;
    if (window.lucide) {
      lucide.createIcons(container);
    }
    return null;
  }
}

/**
 * 销毁PDF查看器
 * @param {HTMLElement} container - 容器元素
 */
export function destroyPDFViewer(container) {
  if (container) {
    container.innerHTML = '';
  }
}

