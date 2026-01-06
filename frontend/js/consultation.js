import { consultationAPI } from './api.js';
import { pdfAPI } from './api.js';
import { itemsAPI } from './api.js';
import { settingsAPI } from './api.js';
import { getCurrentContext, formatContextLabel, getValidContext } from './context.js';
import { renderPDFContent, highlightPage, scrollToQuote, getPDFContent, highlightTextInPDF } from './pdf.js';

// 左侧边栏宽度调整功能
let isResizingLeftSidebar = false;
let leftSidebarStartX = 0;
let leftSidebarStartWidth = 0;

// 初始化左侧边栏宽度（从localStorage恢复）
function initLeftSidebarWidth() {
  const savedWidth = localStorage.getItem('leftSidebarWidth');
  if (savedWidth) {
    const width = parseInt(savedWidth, 10);
    const leftSidebar = document.getElementById('left-sidebar');
    if (leftSidebar) {
      leftSidebar.style.width = `${width}px`;
    }
  }
}

  // 开始调整左侧边栏宽度
  window.startResizeLeftSidebar = function(e) {
  e.preventDefault();
  e.stopPropagation();
  
  isResizingLeftSidebar = true;
  const leftSidebar = document.getElementById('left-sidebar');
  
  if (e.type === 'touchstart') {
    leftSidebarStartX = e.touches[0].clientX;
  } else {
    leftSidebarStartX = e.clientX;
  }
  
  leftSidebarStartWidth = leftSidebar ? parseInt(window.getComputedStyle(leftSidebar).width, 10) : 260;
  
  document.addEventListener('mousemove', handleLeftSidebarResize);
  document.addEventListener('mouseup', stopResizeLeftSidebar);
  document.addEventListener('touchmove', handleLeftSidebarResize);
  document.addEventListener('touchend', stopResizeLeftSidebar);
  
  // 添加视觉反馈
  document.body.classList.add('resizing');
};

// 处理左侧边栏宽度调整
function handleLeftSidebarResize(e) {
  if (!isResizingLeftSidebar) return;
  
  e.preventDefault();
  
  const leftSidebar = document.getElementById('left-sidebar');
  if (!leftSidebar) return;
  
  let currentX;
  if (e.type === 'touchmove') {
    currentX = e.touches[0].clientX;
  } else {
    currentX = e.clientX;
  }
  
  const diff = currentX - leftSidebarStartX;
  const newWidth = Math.max(200, Math.min(500, leftSidebarStartWidth + diff));
  
  leftSidebar.style.width = `${newWidth}px`;
}

// 停止调整左侧边栏宽度
function stopResizeLeftSidebar() {
  if (!isResizingLeftSidebar) return;
  
  isResizingLeftSidebar = false;
  
  const leftSidebar = document.getElementById('left-sidebar');
  if (leftSidebar) {
    const width = parseInt(window.getComputedStyle(leftSidebar).width, 10);
    localStorage.setItem('leftSidebarWidth', width.toString());
  }
  
  document.removeEventListener('mousemove', handleLeftSidebarResize);
  document.removeEventListener('mouseup', stopResizeLeftSidebar);
  document.removeEventListener('touchmove', handleLeftSidebarResize);
  document.removeEventListener('touchend', stopResizeLeftSidebar);
  
  // 恢复样式
  document.body.classList.remove('resizing');
}

// 状态管理
const state = {
  currentDocId: null,
  currentDoc: null,
  currentDocInfo: null, // 当前文档的分析信息 { category, theme, role, etc. }
  history: [],
  currentConversationId: null, // 当前活跃的对话ID
  pdfList: [],
  docMetadata: {}, // 文档元数据缓存 { docId: { category, theme, role, ... } }
  sortedConversationsCache: null, // 缓存排序后的对话列表
  conversationsCacheTimestamp: 0, // 缓存时间戳
  migrationChecked: new Set(), // 已检查迁移的文档ID集合
  expandedDocs: new Set(), // 已展开对话列表的文档ID集合
  pdfViewerInstance: null, // PDF.js查看器实例
  // 分支相关
  baseMessages: [], // 分支点之前的消息（所有分支共享）
  branches: [], // 分支列表 [{ branchId, version, branchPoint, messages, docIds, knowledgeBaseIds, createdAt }]
  currentBranchId: null // 当前显示的分支ID
};

// 加载PDF列表
export async function loadPDFList() {
  try {
    console.log('开始加载PDF列表...');
    
    // 获取当前知识库ID
    const kbModule = await import('./knowledge-bases.js');
    const currentKbId = kbModule.getCurrentKnowledgeBaseId();
    
    // 构建查询参数
    const queryParams = { type: 'pdf' };
    if (currentKbId) {
      queryParams.knowledge_base_id = currentKbId;
    }
    
    const response = await itemsAPI.getAll(queryParams);
    console.log('PDF列表API响应:', response);
    
    if (response.success) {
      state.pdfList = response.data || [];
      console.log(`加载到 ${state.pdfList.length} 个PDF文档:`, state.pdfList.map(d => d.title));
      
      // 渲染PDF列表
      renderPDFList();
      
      // 异步分析所有文档（不阻塞UI），分析完成后更新显示
      if (state.pdfList.length > 0) {
        analyzeAllDocuments().then(() => {
          // 分析完成后重新渲染，显示分类信息
          console.log('文档分析完成，更新显示');
          renderPDFList();
          renderWelcomeDocs();
        });
      }
    } else {
      console.warn('PDF列表API返回失败:', response);
      // 即使没有数据也要渲染空状态
      state.pdfList = [];
      renderPDFList();
    }
  } catch (error) {
    console.error('加载PDF列表失败:', error);
    state.pdfList = [];
    renderPDFList();
  }
}

// 初始化：加载PDF列表并分析文档
export async function initConsultation() {
  // 初始化左侧边栏宽度
  initLeftSidebarWidth();
  try {
    // 先初始化知识库系统（在函数顶部声明一次，后续复用）
    const kbModule = await import('./knowledge-bases.js');
    const initSuccess = await kbModule.initKnowledgeBases();
    
    // 无论初始化成功与否，都渲染知识库切换器
    kbModule.renderKnowledgeBaseSwitcher();
    
    if (!initSuccess) {
      console.warn('知识库初始化失败，但继续初始化其他模块');
    }
    
    // 监听知识库切换事件
    document.addEventListener('knowledgeBaseChanged', async (e) => {
      const { knowledgeBaseId, knowledgeBase } = e.detail;
      console.log('知识库切换:', knowledgeBaseId, knowledgeBase);
      
      // 重新加载PDF列表
      await loadPDFList();
      
      // 重新加载并渲染对话历史
      await renderConversationHistory();
    });
    
    // 加载PDF列表
    await loadPDFList();
    
    // 初始化对话区域（默认显示，不显示欢迎界面）
    initChatArea();
    
    // 初始化context标签显示
    import('./context.js').then(({ loadContext, formatContextLabel, isContextSet }) => {
      loadContext().then(() => {
        // 更新标签显示
        if (typeof updateContextLabel === 'function') {
          updateContextLabel();
        } else {
          const labelEl = document.getElementById('context-label-text');
          if (labelEl) {
            const labelText = formatContextLabel();
            labelEl.textContent = labelText;
          }
        }
        
        // 首次使用检测：如果未设置，显示提示
        if (!isContextSet()) {
          // 延迟显示，避免与页面加载冲突
          setTimeout(() => {
            showFirstTimeContextGuide();
          }, 500);
        }
      });
    });
    
    // 显示首次使用引导
    function showFirstTimeContextGuide() {
      // 检查是否已经显示过引导（避免每次刷新都显示）
      const hasShownGuide = localStorage.getItem('context_guide_shown') === 'true';
      if (hasShownGuide) return;
      
      // 创建提示元素
      const guideEl = document.createElement('div');
      guideEl.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-white border border-indigo-200 rounded-lg shadow-lg p-4 z-50 max-w-md';
      guideEl.innerHTML = `
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
            <i data-lucide="info" class="text-indigo-600" size="18"></i>
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-semibold text-slate-900 mb-1">设置项目背景信息</h3>
            <p class="text-xs text-slate-600 mb-3">为了让AI更好地帮助您，请先设置您的创业阶段和团队规模。</p>
            <div class="flex items-center gap-2">
              <button 
                onclick="window.openContextModal(); this.closest('.fixed').remove(); localStorage.setItem('context_guide_shown', 'true');"
                class="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                去设置
              </button>
              <button 
                onclick="this.closest('.fixed').remove(); localStorage.setItem('context_guide_shown', 'true');"
                class="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                稍后
              </button>
            </div>
          </div>
          <button 
            onclick="this.closest('.fixed').remove(); localStorage.setItem('context_guide_shown', 'true');"
            class="flex-shrink-0 text-slate-400 hover:text-slate-600"
          >
            <i data-lucide="x" size="16"></i>
          </button>
        </div>
      `;
      
      document.body.appendChild(guideEl);
      
      // 初始化图标
      if (window.lucide) {
        lucide.createIcons(guideEl);
      }
      
      // 5秒后自动关闭
      setTimeout(() => {
        if (guideEl.parentNode) {
          guideEl.remove();
          localStorage.setItem('context_guide_shown', 'true');
        }
      }, 5000);
    }
    
    // 绑定上传按钮事件监听器
    setupUploadButton();
    
    // 绑定评估快速开关（可能有多个按钮）
    const toggleEvaluationQuickButtons = document.querySelectorAll('#toggle-evaluation-quick');
    if (toggleEvaluationQuickButtons.length > 0) {
      // 初始化图标状态
      updateEvaluationQuickToggle();
      
      // 为所有按钮绑定事件
      toggleEvaluationQuickButtons.forEach(button => {
        button.addEventListener('click', () => {
          const currentValue = localStorage.getItem('knowledge_relevance_evaluation_enabled');
          const newValue = currentValue === 'true' ? 'false' : 'true';
          localStorage.setItem('knowledge_relevance_evaluation_enabled', newValue);
          updateEvaluationQuickToggle();
          
          // 显示提示
          const status = newValue === 'true' ? '已启用' : '已禁用';
          const toast = document.createElement('div');
          toast.className = 'fixed bottom-6 right-6 bg-slate-900 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm';
          toast.textContent = `相关性评估${status}`;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 2000);
        });
      });
    }
    
    // 绑定对话历史搜索输入框事件监听器
    const searchInput = document.getElementById('conversation-history-search');
    if (searchInput) {
      searchInput.addEventListener('input', async () => {
        // 输入变化时重新渲染对话历史
        await renderConversationHistory();
      });
    }
    
    // 确保在初始化完成后渲染历史对话列表
    // 延迟一点确保DOM已准备好
    setTimeout(async () => {
      await renderConversationHistory();
      // 初始化评估快速开关状态
      updateEvaluationQuickToggle();
    }, 100);
  } catch (error) {
    console.error('加载PDF列表失败:', error);
    // 出错时也要渲染空状态
    state.pdfList = [];
    renderPDFList();
    initChatArea();
    
    // 绑定上传按钮事件监听器
    setupUploadButton();
    
    // 即使出错也要渲染历史对话列表
    setTimeout(async () => {
      await renderConversationHistory();
    }, 100);
  }
}

// 设置上传按钮事件监听器
function setupUploadButton() {
  const uploadBtn = document.getElementById('btn-upload-pdf');
  if (!uploadBtn) {
    console.warn('上传按钮不存在，延迟重试...');
    // 如果按钮还不存在，延迟重试
    setTimeout(setupUploadButton, 200);
    return;
  }
  
  // 移除旧的事件监听器（如果存在）
  const newUploadBtn = uploadBtn.cloneNode(true);
  uploadBtn.parentNode.replaceChild(newUploadBtn, uploadBtn);
  
  // 绑定新的事件监听器
  newUploadBtn.addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        newUploadBtn.disabled = true;
        const originalHtml = newUploadBtn.innerHTML;
        newUploadBtn.innerHTML = '上传中...';
        
        // 上传PDF
        const { uploadPDF } = await import('./pdf.js');
        const result = await uploadPDF(file, null);
        
        // 重新加载PDF列表
        await loadPDFList();
        
        // 显示成功消息
        console.log('PDF上传成功:', result);
        alert('PDF上传成功！');
        
        newUploadBtn.disabled = false;
        newUploadBtn.innerHTML = originalHtml;
        if (typeof lucide !== 'undefined') {
          lucide.createIcons(newUploadBtn);
        }
      } catch (error) {
        console.error('上传失败:', error);
        const errorMessage = error.message || '上传失败，请重试';
        alert('上传失败: ' + errorMessage);
        newUploadBtn.disabled = false;
        newUploadBtn.innerHTML = originalHtml;
        if (typeof lucide !== 'undefined') {
          lucide.createIcons(newUploadBtn);
        }
      }
    };
    input.click();
  });
  
  // 重新初始化图标
  if (typeof lucide !== 'undefined') {
    lucide.createIcons(newUploadBtn);
  }
  
  console.log('上传按钮事件监听器已绑定');
}

// 初始化对话区域（默认显示，不显示欢迎界面）
function initChatArea() {
  const welcomeScreen = document.getElementById('welcome-screen');
  const chatStream = document.getElementById('chat-stream');
  
  // 隐藏欢迎界面，显示对话区域
  if (welcomeScreen) welcomeScreen.classList.add('hidden');
  if (chatStream) chatStream.classList.remove('hidden');
  
  // 如果没有任何对话，显示简洁的空状态
  if (state.history.length === 0) {
    showEmptyChatState();
  }
  
  // 自动聚焦输入框
  setTimeout(() => {
    const input = document.getElementById('user-input');
    if (input) {
      input.focus();
    }
  }, 100);
}

// 显示空状态（简洁提示）
function showEmptyChatState() {
  const chatStream = document.getElementById('chat-stream');
  if (!chatStream) return;
  
  // 检查是否已有消息
  if (chatStream.querySelector('.msg-user, .msg-ai')) {
    return; // 已有消息，不显示空状态
  }
  
  // 显示简洁的空状态提示
  const emptyState = chatStream.querySelector('.empty-chat-state');
  if (!emptyState) {
    const emptyHtml = `
      <div class="empty-chat-state flex flex-col items-center justify-center py-20 text-center">
        <p class="text-sm text-slate-400 mb-2">输入问题开始对话</p>
        <p class="text-xs text-slate-300">支持直接输入，AI会自动匹配相关文档</p>
      </div>
    `;
    chatStream.insertAdjacentHTML('afterbegin', emptyHtml);
  }
}

// 隐藏空状态
function hideEmptyChatState() {
  const chatStream = document.getElementById('chat-stream');
  if (!chatStream) return;
  const emptyState = chatStream.querySelector('.empty-chat-state');
  if (emptyState) {
    emptyState.remove();
  }
}

// 加载模块文档（从modules.js调用或内部调用）
export async function loadModuleDocuments(moduleId) {
  try {
    const response = await fetch(`/api/modules/${moduleId}/documents`);
    const result = await response.json();
    
    if (result.success) {
      state.pdfList = result.data || [];
      renderPDFList();
      renderWelcomeDocs();
    }
  } catch (error) {
    console.error('加载模块文档失败:', error);
  }
}

// 渲染欢迎页面的文档卡片
function renderWelcomeDocs() {
  const container = document.getElementById('welcome-docs-grid');
  if (!container) return;
  
  if (state.pdfList.length === 0) {
    container.innerHTML = `
      <div class="col-span-2 text-center py-8 text-slate-400">
        <i data-lucide="book-open" size="24" class="mx-auto mb-2 opacity-50"></i>
        <p class="text-sm">暂无参考文档</p>
        <p class="text-xs mt-1">点击左侧"上传参考文档"按钮添加文档</p>
      </div>
    `;
    if (window.lucide) {
      lucide.createIcons(container);
    }
    return;
  }
  
  // 只显示前4个文档
  const docsToShow = state.pdfList.slice(0, 4);
  
  container.innerHTML = docsToShow.map(doc => {
    const title = escapeHtml(doc.title || '未命名文档');
    const metadata = state.docMetadata[doc.id] || {};
    const category = metadata.category || '通用';
    const theme = metadata.theme || title;
    
    // 根据分类选择图标和颜色
    let iconType = 'file-text';
    let iconBg = 'bg-indigo-100';
    let iconColor = 'text-indigo-600';
    if (category.includes('团队') || category.includes('股权') || category.includes('管理')) {
      iconType = 'users';
      iconBg = 'bg-emerald-100';
      iconColor = 'text-emerald-600';
    } else if (category.includes('品牌') || category.includes('营销') || category.includes('推广')) {
      iconType = 'target';
      iconBg = 'bg-blue-100';
      iconColor = 'text-blue-600';
    }
    
    return `
      <div onclick="startWithDocument('${doc.id}')" class="scenario-card group cursor-pointer">
        <div class="flex items-center gap-3 mb-3">
          <div class="p-2 ${iconBg} ${iconColor} rounded-lg group-hover:opacity-80 transition-colors">
            <i data-lucide="${iconType}" size="20"></i>
          </div>
          <span class="font-semibold text-slate-800">${title}</span>
        </div>
        <p class="text-xs text-slate-500 leading-relaxed">${theme}</p>
        ${category !== '通用' ? `<p class="text-[10px] text-slate-400 mt-1">${category}</p>` : ''}
      </div>
    `;
  }).join('');
  
  // 如果文档少于4个，添加"更多"提示
  if (state.pdfList.length > 4) {
    container.innerHTML += `
      <div class="scenario-card group cursor-pointer border-dashed" onclick="document.getElementById('knowledge-base-list')?.scrollIntoView({ behavior: 'smooth' })">
        <div class="flex items-center justify-center gap-2 text-slate-400">
          <i data-lucide="more-horizontal" size="20"></i>
          <span class="text-sm">还有 ${state.pdfList.length - 4} 个文档</span>
        </div>
      </div>
    `;
  }
  
  // 初始化Lucide图标
  if (window.lucide) {
    lucide.createIcons(container);
  }
}

// 分析所有文档（后台进行）
async function analyzeAllDocuments() {
  for (const doc of state.pdfList) {
    try {
      // 检查是否已有元数据
      if (doc.metadata) {
        try {
          state.docMetadata[doc.id] = JSON.parse(doc.metadata);
          continue; // 已有元数据，跳过
        } catch (e) {
          // 解析失败，继续分析
        }
      }
      
      // 分析文档
      const result = await consultationAPI.analyzeDocument(doc.id);
      if (result.success && result.data) {
        state.docMetadata[doc.id] = result.data;
      }
    } catch (error) {
      console.warn(`分析文档 ${doc.id} 失败:`, error);
    }
  }
}

// 渲染PDF列表到左侧栏（增强版：显示对话数量，支持展开对话列表）
export async function renderPDFList() {
  const container = document.getElementById('knowledge-base-list');
  if (!container) return;
  
  if (state.pdfList.length === 0) {
    container.innerHTML = `
      <div class="text-xs text-slate-400 px-3 py-4 text-center">
        <i data-lucide="book-open" size="16" class="mx-auto mb-2 opacity-50"></i>
        <p>暂无参考文档</p>
        <p class="text-[10px] mt-1">点击下方"上传知识库"按钮添加文档</p>
      </div>
    `;
    if (window.lucide) {
      lucide.createIcons(container);
    }
    return;
  }
  
  console.log('渲染PDF列表，文档数量:', state.pdfList.length);
  
  // 为每个文档获取对话数量
  const docsWithConversations = await Promise.all(
    state.pdfList.map(async (doc) => {
      const conversations = await getConversationsByDocId(doc.id);
      return { 
        ...doc, 
        conversationCount: conversations.length, 
        conversations
      };
    })
  );
  
  container.innerHTML = docsWithConversations.map(doc => {
    const title = escapeHtml(doc.title || '未命名文档');
    const metadata = state.docMetadata[doc.id] || {};
    const category = metadata.category || '通用';
    const conversationCount = doc.conversationCount || 0;
    const isExpanded = state.expandedDocs && state.expandedDocs.has(doc.id);
    
    console.log('渲染文档:', { id: doc.id, title, category, hasMetadata: !!state.docMetadata[doc.id], conversationCount });
    
    // 根据分类选择图标和颜色
    let iconType = 'file-text';
    let iconColor = 'indigo';
    if (category.includes('团队') || category.includes('股权') || category.includes('管理')) {
      iconType = 'users';
      iconColor = 'emerald';
    } else if (category.includes('品牌') || category.includes('营销') || category.includes('推广')) {
      iconType = 'target';
      iconColor = 'blue';
    }
    
    return `
    <div class="w-full group/item relative" data-doc-wrapper="${doc.id}" data-doc-id="${doc.id}">
      <button 
        data-doc-id="${doc.id}"
        class="w-full flex items-center gap-2 px-2 py-1.5 text-slate-600 hover:bg-slate-50 rounded transition-colors text-xs relative ${state.currentDocId === doc.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''}"
        oncontextmenu="event.preventDefault(); showDocContextMenu(event, '${doc.id}')"
        title="${title}"
      >
        <i data-lucide="${iconType}" 
           size="14" 
           class="text-${iconColor}-500 flex-shrink-0">
        </i>
        <div class="flex-1 min-w-0 text-left">
          <div class="truncate font-medium text-xs">${title}</div>
          <div class="flex items-center gap-1 flex-wrap mt-0.5">
            ${conversationCount > 0 ? `<span 
              data-doc-toggle="${doc.id}"
              onclick="event.stopPropagation(); toggleDocConversations('${doc.id}')"
              class="px-1 py-0 text-[9px] bg-indigo-100 text-indigo-700 rounded font-medium hover:bg-indigo-200 transition-colors cursor-pointer" 
              title="${conversationCount}个历史对话"
            >${conversationCount}</span>` : ''}
          </div>
        </div>
      </button>
      ${conversationCount > 0 ? `
        <div class="mt-1 ${isExpanded ? '' : 'hidden'}" data-doc-conversations="${doc.id}">
          ${renderDocConversationsList(doc.conversations || [], doc.id)}
        </div>
      ` : ''}
    </div>
  `;
  }).join('');
  
  console.log('PDF列表渲染完成，HTML长度:', container.innerHTML.length);
  
  // 初始化Lucide图标
  if (window.lucide) {
    lucide.createIcons(container);
  }
  
  // 绑定文档点击事件（打开右侧面板）
  container.querySelectorAll('[data-doc-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // 如果点击的是按钮内的其他按钮，不触发文档加载
      if (e.target.closest('button[onclick*="toggleDocConversations"]') ||
          e.target.closest('button[data-doc-toggle]')) {
        console.log('点击了文档内的子按钮，不触发文档加载');
        return;
      }
      
      const docId = btn.getAttribute('data-doc-id');
      console.log('=== 文档卡片被点击 ===');
      console.log('文档ID:', docId);
      console.log('点击元素:', e.target);
      console.log('开始加载文档...');
      
      // 确保loadDoc被调用
      loadDoc(docId, true).catch(error => {
        console.error('加载文档失败:', error);
        alert('加载文档失败: ' + (error.message || '未知错误'));
      });
    });
  });
  
  console.log(`已绑定 ${container.querySelectorAll('[data-doc-id]').length} 个文档的点击事件`);
}

// 切换文档对话列表的展开/折叠（全局函数）
window.toggleDocConversations = async function(docId) {
  if (!state.expandedDocs) {
    state.expandedDocs = new Set();
  }
  
  if (state.expandedDocs.has(docId)) {
    state.expandedDocs.delete(docId);
  } else {
    state.expandedDocs.add(docId);
  }
  
  // 重新渲染列表
  await renderPDFList();
};

// 渲染文档的对话列表
function renderDocConversationsList(conversations, docId) {
  if (!conversations || conversations.length === 0) {
    return '';
  }
  
  // 最多显示5个，按时间倒序
  const displayConvs = conversations.slice(0, 5);
  const hasMore = conversations.length > 5;
  
  return `
    <div class="pl-3 pr-2 pb-2 space-y-1">
      ${displayConvs.map(conv => {
        const preview = getConversationPreview(conv);
        const timeStr = formatConversationTime(conv.timestamp);
        const escapedId = escapeHtml(conv.id);
        const isCurrent = state.currentConversationId === conv.id;
        
        return `
          <div class="px-2 py-1.5 rounded-lg bg-white hover:bg-slate-50 transition-colors ${isCurrent ? 'bg-indigo-50 border-l-2 border-indigo-500' : 'border border-slate-100'}" data-conv-id="${escapedId}">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="text-[11px] font-medium text-slate-700 truncate mb-0.5">${escapeHtml(preview)}</div>
                <div class="text-[10px] text-slate-400">${timeStr}</div>
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <button 
                  onclick="event.stopPropagation(); continueConversation('${escapedId}')"
                  class="px-2 py-0.5 text-[10px] text-indigo-600 hover:bg-indigo-100 rounded transition-colors"
                  title="继续对话"
                >
                  继续
                </button>
                <button 
                  onclick="event.stopPropagation(); editConversationTitle('${escapedId}')"
                  class="p-0.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                  title="编辑名称"
                >
                  <i data-lucide="edit-2" size="12"></i>
                </button>
                <button 
                  onclick="event.stopPropagation(); deleteConversation('${escapedId}')"
                  class="p-0.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="删除对话"
                >
                  <i data-lucide="trash-2" size="12"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
      ${hasMore ? `<div class="text-[10px] text-slate-400 text-center px-2 py-1">还有 ${conversations.length - 5} 个对话...</div>` : ''}
      <button 
        onclick="event.stopPropagation(); startNewConversationForDoc('${docId}')"
        class="w-full px-2 py-1.5 text-[11px] bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors flex items-center justify-center gap-1"
      >
        <i data-lucide="plus-circle" size="12"></i>
        <span>开始新对话</span>
      </button>
    </div>
  `;
}

// 继续对话（从文档对话列表中）
window.continueConversation = async function(conversationId) {
  await loadConversationFromHistory(conversationId);
};

// 为文档开始新对话
window.startNewConversationForDoc = async function(docId) {
  await loadDoc(docId, false);
  await createNewConversation();
};

// 启动对话（根据用户问题自动匹配文档）
export async function startConversation(question = null) {
  // 确保对话区域可见
  const chatStream = document.getElementById('chat-stream');
  if (chatStream) chatStream.classList.remove('hidden');
  
  // 隐藏空状态
  hideEmptyChatState();
  
  // 如果有问题，尝试匹配文档
  if (question && state.pdfList.length > 0) {
    try {
      const matchResult = await consultationAPI.matchDocument(question);
      if (matchResult.success && matchResult.data.docId) {
        await loadDoc(matchResult.data.docId, false);
        state.currentDocInfo = matchResult.data.docInfo;
        updateModeDisplay();
      }
    } catch (error) {
      console.warn('匹配文档失败:', error);
    }
  }
  
  // 加载历史对话（如果已有当前对话，会继续使用；否则会创建新对话）
  loadHistory();
  
  // 更新历史对话列表
  await renderConversationHistory();
  
  // 如果没有历史对话，显示欢迎消息
  if (state.history.length === 0) {
    // 检查是否有有效的文档信息（需要同时有ID和标题）
    if (state.currentDocId && state.currentDocInfo && state.currentDocInfo.title) {
      // 有文档，生成欢迎消息
      try {
        const welcomeResult = await consultationAPI.getWelcomeMessage(state.currentDocId);
        if (welcomeResult.success && welcomeResult.data.welcomeMessage) {
          addAiMessage(welcomeResult.data.welcomeMessage);
        } else {
          addAiMessage(`您好！我是${state.currentDocInfo.role || '知识助手'}，可以基于《${state.currentDocInfo.title}》为您解答相关问题。请告诉我您的问题。`);
        }
      } catch (error) {
        console.warn('获取欢迎消息失败:', error);
        addAiMessage(`您好！我是${state.currentDocInfo.role || '知识助手'}，可以基于《${state.currentDocInfo.title}》为您解答相关问题。请告诉我您的问题。`);
      }
    } else {
      // 没有文档，显示通用欢迎消息
      addAiMessage('您好！我是您的知识助手。\n\n我可以帮您解答基于知识库的问题。请告诉我您想了解什么，或者从左侧选择参考文档开始。');
    }
  }
  
  // 自动聚焦输入框
  focusInput();
}

// 直接选择文档开始对话
export async function startWithDocument(docId) {
  await loadDoc(docId, false);
  await startConversation();
}

// 更新模式显示（基于当前文档信息）
function updateModeDisplay() {
  const display = document.getElementById('current-mode-display');
  if (!display) return;
  
  if (state.currentDocInfo) {
    const role = state.currentDocInfo.role || '知识助手';
    const category = state.currentDocInfo.category || '通用';
    
    // 根据分类选择颜色
    let color = 'bg-indigo-500';
    if (category.includes('团队') || category.includes('股权') || category.includes('管理')) {
      color = 'bg-emerald-500';
    } else if (category.includes('品牌') || category.includes('营销') || category.includes('推广')) {
      color = 'bg-blue-500';
    }
    
    const descEl = display.parentElement.querySelector('p');
    if (descEl) {
      descEl.textContent = `正在基于《${state.currentDocInfo.title}》为您解答问题`;
    }
    display.innerHTML = `
      <div class="w-2 h-2 rounded-full ${color} animate-pulse"></div>
      <span class="text-sm font-medium text-slate-600">${role}</span>
    `;
  } else {
    const descEl = display.parentElement.querySelector('p');
    if (descEl) {
      descEl.textContent = '输入问题后，助手会为您匹配最相关的文档';
    }
    display.innerHTML = `
      <div class="w-2 h-2 rounded-full bg-slate-400"></div>
      <span class="text-sm font-medium text-slate-600">待命中</span>
    `;
  }
  
  // 同时更新聊天状态指示器
  updateChatStatusIndicator();
}

// 更新聊天区域状态指示器
function updateChatStatusIndicator() {
  const indicator = document.getElementById('chat-status-indicator');
  const statusText = document.getElementById('chat-status-text');
  const switchBtn = document.getElementById('chat-switch-conversation-btn');
  
  if (!indicator || !statusText) return;
  
  // 如果有对话历史，显示状态指示器
  if (state.history.length > 0 || state.currentDocId) {
    indicator.classList.remove('hidden');
    
    let status = '';
    if (state.currentDocId && state.currentDocInfo) {
      const preview = state.currentConversationId 
        ? getConversationPreview({ messages: state.history }) 
        : '新对话';
      status = `📄 ${state.currentDocInfo.title} · ${preview}`;
      
      // 如果有多个对话，显示切换按钮
      if (switchBtn) {
        getConversationsByDocId(state.currentDocId).then(convs => {
          if (convs.length > 1) {
            switchBtn.classList.remove('hidden');
          } else {
            switchBtn.classList.add('hidden');
          }
        });
      }
    } else if (state.currentConversationId) {
      const preview = getConversationPreview({ messages: state.history });
      status = `💬 继续对话: ${preview}`;
    } else {
      status = '准备就绪';
    }
    
    statusText.textContent = status;
  } else {
    indicator.classList.add('hidden');
  }
}

// 显示对话切换器（简单实现：打开右侧面板的对话历史标签页）
window.showConversationSwitcher = function() {
  const panel = document.getElementById('right-panel');
  if (panel) {
    // 确保面板打开
    const isOpen = panel.style.width === '40%' || panel.style.width === '45%' || panel.classList.contains('w-[45%]') || panel.offsetWidth > 100;
    if (!isOpen) {
      panel.style.width = '40%';
      panel.style.minWidth = '40%';
      panel.classList.add('w-[40%]');
      localStorage.removeItem('rightPanelClosed');
    }
    // 切换到对话历史标签页
    switchRightPanelTab('conversations');
  }
};

// 加载PDF文档
export async function loadDoc(docId, autoOpenPanel = false) {
  console.log('=== loadDoc 函数被调用 ===');
  console.log('文档ID:', docId);
  console.log('自动打开面板:', autoOpenPanel);
  
  try {
    console.log('开始加载PDF文档:', docId);
    const pdfData = await getPDFContent(docId);
    console.log('PDF数据获取成功:', pdfData);
    
    if (!pdfData) {
      console.error('PDF数据为空');
      alert('加载PDF内容失败：数据为空');
      return;
    }
    
    state.currentDocId = docId;
    state.currentDoc = pdfData;
    
    // 获取或加载文档元数据
    if (!state.docMetadata[docId]) {
      try {
        const result = await consultationAPI.analyzeDocument(docId);
        if (result.success && result.data) {
          state.docMetadata[docId] = result.data;
          state.currentDocInfo = result.data;
        }
      } catch (error) {
        console.warn('分析文档失败:', error);
        // 使用默认值
        state.currentDocInfo = {
          id: docId,
          title: pdfData.title || '未命名文档',
          category: '通用',
          theme: pdfData.title || '未分类',
          role: '知识助手'
        };
      }
    } else {
      state.currentDocInfo = state.docMetadata[docId];
    }
    
    
    // 渲染到右侧面板
    const container = document.getElementById('pdf-content');
    if (container) {
      console.log('找到pdf-content容器，开始渲染PDF内容');
      console.log('当前文档数据:', state.currentDoc);
      // 清除旧的PDF查看器实例
      state.pdfViewerInstance = null;
      // 先清空容器并显示加载状态
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
      
      try {
        // renderPDFContent现在是async函数
        await renderPDFContent(state.currentDoc, container);
        console.log('PDF内容渲染完成');
        // 确保容器可见
        container.classList.remove('opacity-0');
      } catch (error) {
        console.error('渲染PDF内容时出错:', error);
        
        // 根据错误类型提供更友好的提示
        let errorMessage = error.message || '未知错误';
        let errorIcon = 'file-x';
        let errorTitle = 'PDF加载失败';
        
        // 针对404错误提供更友好的提示
        if (error.message && error.message.includes('404')) {
          errorTitle = 'PDF文件未找到';
          errorMessage = '文件可能已被删除或路径不正确，请刷新页面或联系管理员';
          errorIcon = 'file-question';
        } else if (error.message && error.message.includes('403')) {
          errorTitle = '无法访问PDF文件';
          errorMessage = '没有权限访问此文件';
          errorIcon = 'file-lock';
        } else if (error.message && error.message.includes('500')) {
          errorTitle = '服务器错误';
          errorMessage = '服务器处理文件时出错，请稍后重试';
          errorIcon = 'alert-circle';
        }
        
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center py-20 px-4">
            <i data-lucide="${errorIcon}" size="64" class="text-slate-300 mb-6"></i>
            <h3 class="text-base font-semibold text-slate-700 mb-2">${errorTitle}</h3>
            <p class="text-sm text-slate-500 text-center max-w-md">${errorMessage}</p>
          </div>
        `;
        container.classList.remove('opacity-0');
        if (window.lucide) {
          lucide.createIcons(container);
        }
      }
    } else {
      console.error('找不到pdf-content容器');
      alert('找不到PDF显示容器，请刷新页面重试');
    }
    
    // 更新文档标题
    const titleEl = document.getElementById('doc-title');
    if (titleEl) {
      titleEl.textContent = state.currentDoc.title || '文档查看';
    }
    
    // 更新输入区域当前文档提示
    updateCurrentDocHint();
    
    // 重新渲染PDF列表以更新高亮
    await renderPDFList();
    
    // 渲染文档的对话历史
    await renderDocConversationsInRightPanel(docId);
    
    // 更新聊天状态指示器
    updateChatStatusIndicator();
    
    // 自动展开右侧面板以显示PDF内容（智能显示策略）
    const panel = document.getElementById('right-panel');
    if (panel) {
      console.log('检查右侧面板状态，autoOpenPanel:', autoOpenPanel);
      // 检查用户偏好（是否手动关闭过）
      const panelClosed = localStorage.getItem('rightPanelClosed') === 'true';
      
      // 检查面板是否已展开
      const isOpen = panel.style.width === '40%' || panel.style.width === '45%' || panel.classList.contains('w-[45%]') || panel.offsetWidth > 100;
      console.log('右侧面板是否已展开:', isOpen, '用户偏好关闭:', panelClosed);
      
      // 如果用户没有手动关闭，或者autoOpenPanel为true，则自动打开
      if ((!panelClosed && !isOpen) || autoOpenPanel) {
        console.log('展开右侧面板以显示PDF内容');
        panel.style.width = '40%';
        panel.style.minWidth = '40%';
        panel.classList.add('w-[40%]');
        // 确保面板可见
        panel.style.display = 'flex';
        // 清除关闭标记
        localStorage.removeItem('rightPanelClosed');
      }
    } else {
      console.error('找不到right-panel元素');
    }
    
    // 确保PDF内容容器可见
    const pdfContainer = document.getElementById('pdf-content');
    if (pdfContainer) {
      pdfContainer.classList.remove('opacity-0');
      pdfContainer.style.opacity = '1';
      console.log('PDF内容容器已设置为可见');
    }
    
    // 切换到内容标签页
    const contentTab = document.getElementById('right-panel-tab-content');
    const conversationsTab = document.getElementById('right-panel-tab-conversations');
    const contentPanel = document.getElementById('right-panel-content');
    const conversationsPanel = document.getElementById('right-panel-conversations');
    
    if (contentTab && conversationsTab && contentPanel && conversationsPanel) {
      contentTab.classList.add('bg-indigo-50', 'text-indigo-600');
      contentTab.classList.remove('text-slate-500');
      conversationsTab.classList.remove('bg-indigo-50', 'text-indigo-600');
      conversationsTab.classList.add('text-slate-500');
      contentPanel.classList.remove('hidden');
      conversationsPanel.classList.add('hidden');
      console.log('已切换到PDF内容标签页');
    }
  } catch (error) {
    console.error('加载PDF失败:', error);
    alert('加载PDF失败: ' + error.message);
  }
}

// 在右侧面板渲染文档的对话历史
async function renderDocConversationsInRightPanel(docId) {
  const container = document.getElementById('doc-conversations-list');
  if (!container) return;
  
  try {
    const conversations = await getConversationsByDocId(docId);
    
    if (conversations.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-slate-400">
          <i data-lucide="message-square" size="32" class="mx-auto mb-3 opacity-50"></i>
          <p class="text-sm">暂无历史对话</p>
          <p class="text-xs mt-1">开始对话后，历史记录会显示在这里</p>
        </div>
      `;
      if (window.lucide) {
        lucide.createIcons(container);
      }
      return;
    }
    
    container.innerHTML = `
      <div class="mb-4 flex items-center justify-between">
        <div class="text-sm font-semibold text-slate-700">
          💬 对话历史 (${conversations.length})
        </div>
        <button 
          onclick="startNewConversationForDoc('${docId}')"
          class="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors flex items-center gap-1"
        >
          <i data-lucide="plus-circle" size="14"></i>
          <span>新对话</span>
        </button>
      </div>
      <div class="space-y-2">
        ${conversations.map(conv => {
          const preview = getConversationPreview(conv);
          const timeStr = formatConversationTime(conv.timestamp);
          const messageCount = conv.messages ? conv.messages.length : 0;
          const escapedId = escapeHtml(conv.id);
          const isCurrent = state.currentConversationId === conv.id;
          
          return `
            <div class="p-3 rounded-lg border ${isCurrent ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-200 hover:border-indigo-200'} transition-colors" data-conv-id="${escapedId}">
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-slate-700 mb-1 truncate">${escapeHtml(preview)}</div>
                  <div class="flex items-center gap-2 text-xs text-slate-400">
                    <span>${timeStr}</span>
                    <span>·</span>
                    <span>${messageCount}条消息</span>
                  </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <button 
                    onclick="continueConversation('${escapedId}')"
                    class="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-100 rounded transition-colors"
                    title="继续对话"
                  >
                    继续
                  </button>
                  <button 
                    onclick="editConversationTitle('${escapedId}')"
                    class="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                    title="编辑名称"
                  >
                    <i data-lucide="edit-2" size="14"></i>
                  </button>
                  <button 
                    onclick="deleteConversation('${escapedId}')"
                    class="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="删除对话"
                  >
                    <i data-lucide="trash-2" size="14"></i>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    
    if (window.lucide) {
      lucide.createIcons(container);
    }
  } catch (error) {
    console.error('渲染文档对话历史失败:', error);
    container.innerHTML = '<div class="text-center py-4 text-red-400 text-sm">加载对话历史失败</div>';
  }
}

// 切换右侧面板标签页
window.switchRightPanelTab = function(tab) {
  const contentTab = document.getElementById('right-panel-tab-content');
  const conversationsTab = document.getElementById('right-panel-tab-conversations');
  const contentPanel = document.getElementById('right-panel-content');
  const conversationsPanel = document.getElementById('right-panel-conversations');
  
  if (tab === 'content') {
    contentTab?.classList.add('active-tab', 'text-indigo-600');
    contentTab?.classList.remove('text-slate-500');
    conversationsTab?.classList.remove('active-tab', 'text-indigo-600');
    conversationsTab?.classList.add('text-slate-500');
    contentPanel?.classList.remove('hidden');
    conversationsPanel?.classList.add('hidden');
  } else if (tab === 'conversations') {
    conversationsTab?.classList.add('active-tab', 'text-indigo-600');
    conversationsTab?.classList.remove('text-slate-500');
    contentTab?.classList.remove('active-tab', 'text-indigo-600');
    contentTab?.classList.add('text-slate-500');
    conversationsPanel?.classList.remove('hidden');
    contentPanel?.classList.add('hidden');
    
    // 如果切换到对话历史标签页，重新渲染
    if (state.currentDocId) {
      renderDocConversationsInRightPanel(state.currentDocId);
    }
  }
};

// 处理对话逻辑（动态匹配文档）
export async function handleConversation(text) {
  // 确保聊天流区域可见
  const chatStream = document.getElementById('chat-stream');
  if (chatStream) chatStream.classList.remove('hidden');
  
  // 隐藏空状态
  hideEmptyChatState();
  
  // 如果没有当前文档，尝试匹配
  if (!state.currentDocId && state.pdfList.length > 0) {
    try {
      // 获取当前知识库ID
      let currentKnowledgeBaseId = null;
      try {
        const kbModule = await import('./knowledge-bases.js');
        const currentKb = kbModule.getCurrentKnowledgeBase();
        if (currentKb) {
          currentKnowledgeBaseId = currentKb.id;
        }
      } catch (e) {
        console.warn('获取当前知识库ID失败:', e);
      }
      
      // 先尝试在当前知识库中匹配
      let matchResult = await consultationAPI.matchDocument(text, currentKnowledgeBaseId, false);
      
      // 如果当前知识库没有匹配（相关度 < 30），自动扩展到所有知识库
      if (matchResult.success && matchResult.data.relevance < 30) {
        matchResult = await consultationAPI.matchDocument(text, currentKnowledgeBaseId, true);
      }
      
      if (matchResult.success && matchResult.data.docId) {
        await loadDoc(matchResult.data.docId, false);
        state.currentDocInfo = {
          ...matchResult.data.docInfo,
          knowledgeBaseId: matchResult.data.knowledgeBaseId || matchResult.data.docInfo?.knowledgeBaseId,
          knowledgeBaseName: matchResult.data.knowledgeBaseName || matchResult.data.docInfo?.knowledgeBaseName
        };
        updateModeDisplay();
        
        // 如果匹配成功，添加提示消息
        if (matchResult.data.relevance > 50) {
          const kbName = matchResult.data.knowledgeBaseName ? `（来自知识库：${matchResult.data.knowledgeBaseName}）` : '';
          addAiMessage(`我已经为您找到了相关的参考文档《${matchResult.data.docInfo?.title || '文档'}》${kbName}。让我基于这个文档为您解答。`);
        } else if (matchResult.data.knowledgeBaseId && matchResult.data.knowledgeBaseId !== currentKnowledgeBaseId) {
          // 如果匹配到其他知识库的文档，提示用户
          const kbName = matchResult.data.knowledgeBaseName || '其他知识库';
          addAiMessage(`我在${kbName}中找到了相关文档《${matchResult.data.docInfo?.title || '文档'}》，将基于此文档为您解答。`);
        }
      }
    } catch (error) {
      console.warn('匹配文档失败:', error);
    }
  }
  
  // 发送消息到后端
  const messages = [
    ...state.history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: text }
  ];
  
  // 获取有效的Context（未设置时返回null）
  const context = getValidContext();
  
  // 在try块外声明responseEl，以便在catch块中使用
  let responseEl = null;
  
  try {
    let fullResponse = '';
    let allCitations = [];
    let evaluationResult = null;
    
    // 获取评估开关状态
    const sessionEvaluationEnabled = localStorage.getItem('knowledge_relevance_evaluation_enabled');
    const enableEvaluation = sessionEvaluationEnabled !== null 
      ? sessionEvaluationEnabled === 'true' 
      : null; // null表示使用全局设置
    
    console.log('[前端] 发送消息时的评估状态:', {
      localStorageValue: sessionEvaluationEnabled,
      enableEvaluation,
      currentDocId: state.currentDocId,
      currentDocInfo: state.currentDocInfo
    });
    
    // 创建AI消息占位符，显示加载状态
    responseEl = addAiMessage('正在思考...', true, []);
    
    // 添加一个小的延迟，让用户看到"正在思考"状态
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await consultationAPI.chat(
      messages,
      state.currentDocId,
      context,
      state.currentDocInfo,
      (chunk) => {
        // chunk 应该总是一个对象 { content, citations, evaluation }
        if (chunk && typeof chunk === 'object') {
          // 处理评估结果
          if (chunk.evaluation) {
            evaluationResult = chunk.evaluation;
            // 更新消息显示，添加评估结果
            if (responseEl) {
              updateAiMessage(responseEl, fullResponse, allCitations, evaluationResult);
            }
            return;
          }
          
          // 累积内容
          if (chunk.content) {
            fullResponse += chunk.content;
          }
          
          // 处理引用
          if (chunk.citations && Array.isArray(chunk.citations) && chunk.citations.length > 0) {
            // 合并引用，去重
            chunk.citations.forEach(citation => {
              // 确保引用有docId、docTitle和知识库信息
              const citationWithDoc = {
                ...citation,
                docId: citation.docId || state.currentDocId || null,
                docTitle: citation.docTitle || citation.docName || state.currentDoc?.title || '文档',
                knowledgeBaseId: citation.knowledgeBaseId || state.currentDocInfo?.knowledgeBaseId || null,
                knowledgeBaseName: citation.knowledgeBaseName || state.currentDocInfo?.knowledgeBaseName || null
              };
              
              const exists = allCitations.find(c => 
                c.page === citationWithDoc.page && 
                c.text === citationWithDoc.text &&
                c.fullMatch === citationWithDoc.fullMatch
              );
              if (!exists) {
                allCitations.push(citationWithDoc);
              }
            });
          }
          
          // 实时更新消息显示
          if (responseEl) {
            updateAiMessage(responseEl, fullResponse, allCitations, evaluationResult);
          }
        }
      },
      enableEvaluation
    );
    
    // 流式完成，移除光标，添加操作按钮
    if (responseEl) {
      const contentEl = responseEl.querySelector('.msg-ai');
      if (contentEl) {
        contentEl.innerHTML = contentEl.innerHTML.replace('<span class="cursor-blink">▋</span>', '');
        const msgContainer = responseEl.querySelector('.space-y-1');
        if (msgContainer && !msgContainer.querySelector('.message-actions')) {
          msgContainer.insertAdjacentHTML('beforeend', renderMessageActions(responseEl.getAttribute('data-message-id')));
          if (window.lucide) lucide.createIcons(responseEl);
          bindMessageActions(responseEl);
        }
      }
    }
    
    // 如果有引用，自动打开右侧面板并加载文档
    if (allCitations.length > 0) {
      if (state.currentDocId && !state.currentDoc) {
        // 文档未加载，加载并打开面板
        await loadDoc(state.currentDocId, true);
      } else if (state.currentDocId) {
        // 文档已加载，确保面板打开
        const panel = document.getElementById('right-panel');
        if (panel) {
          const isOpen = panel.style.width === '40%' || panel.style.width === '45%' || panel.classList.contains('w-[45%]') || panel.offsetWidth > 100;
          if (!isOpen) {
            panel.style.width = '40%';
            panel.style.minWidth = '40%';
            panel.classList.add('w-[40%]');
            localStorage.removeItem('rightPanelClosed');
          }
        }
      }
    }
    
    // 保存到历史
    const userMessage = { role: 'user', content: text };
    const assistantMessage = { 
      role: 'assistant', 
      content: fullResponse, 
      citations: allCitations,
      evaluation: evaluationResult, // 保存评估结果
      docId: state.currentDocId, // 保存文档ID
      docInfo: state.currentDocInfo ? {
        ...state.currentDocInfo,
        docId: state.currentDocId,
        knowledgeBaseId: state.currentDocInfo.knowledgeBaseId,
        knowledgeBaseName: state.currentDocInfo.knowledgeBaseName
      } : null
    };
    
    state.history.push(userMessage);
    state.history.push(assistantMessage);
    
    // 如果有当前分支，更新分支消息
    if (state.currentBranchId && state.branches && state.branches.length > 0) {
      const currentBranch = state.branches.find(b => b.branchId === state.currentBranchId);
      if (currentBranch) {
        // 计算分支消息的起始索引（baseMessages的长度）
        const branchStartIndex = state.baseMessages.length;
        // 获取从分支点开始的消息（包括新添加的消息）
        const branchMessages = state.history.slice(branchStartIndex);
        currentBranch.messages = branchMessages;
        // 更新分支的文档和知识库ID
        currentBranch.docIds = extractDocIdsFromMessages(branchMessages);
        currentBranch.knowledgeBaseIds = extractKnowledgeBaseIdsFromMessages(branchMessages);
      }
    }
    
    await saveHistory();
    
    // 更新历史对话列表
    await renderConversationHistory();
    
    // 更新聊天状态指示器
    updateChatStatusIndicator();
    
  } catch (error) {
    console.error('咨询对话失败:', error);
    
    // 移除可能存在的加载中的消息
    if (responseEl) {
      const chatStream = document.getElementById('chat-stream');
      if (chatStream) {
        const loadingMsg = responseEl.querySelector('.cursor-blink');
        if (loadingMsg) {
          responseEl.remove();
        }
      }
    }
    
    // 显示错误消息
    const errorMessage = error.message || '咨询对话失败，请稍后重试';
    addAiMessage(`❌ **出错了**：${errorMessage}\n\n请检查：\n1. 是否已在设置中配置了 API Key\n2. 网络连接是否正常\n3. 如果问题持续，请稍后再试`);
  }
}

// 添加用户消息
export function addUserMessage(text) {
  const container = document.getElementById('chat-stream');
  if (!container) return;
  
  // 隐藏空状态
  hideEmptyChatState();
  
  const div = document.createElement('div');
  div.className = 'flex justify-end fade-in mb-4';
  div.innerHTML = `
    <div class="msg-user px-5 py-3 text-[15px] leading-relaxed max-w-xl shadow-md">
      ${escapeHtml(text)}
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
}

// 添加AI消息
export function addAiMessage(html, isStreaming = false, citations = []) {
  const container = document.getElementById('chat-stream');
  if (!container) return null;
  
  // 确保聊天流区域可见
  const welcomeScreen = document.getElementById('welcome-screen');
  if (welcomeScreen) welcomeScreen.classList.add('hidden');
  if (container) container.classList.remove('hidden');
  
  // 根据当前文档信息生成badge
  let badge = { label: '知识助手', class: 'role-triage' };
  if (state.currentDocInfo) {
    const role = state.currentDocInfo.role || '知识助手';
    const category = state.currentDocInfo.category || '通用';
    
    if (category.includes('团队') || category.includes('股权') || category.includes('管理')) {
      badge = { label: role, class: 'role-equity' };
    } else if (category.includes('品牌') || category.includes('营销') || category.includes('推广')) {
      badge = { label: role, class: 'role-brand' };
    } else {
      badge = { label: role, class: 'role-triage' };
    }
  }
  
  const messageId = Date.now().toString();
  const div = document.createElement('div');
  div.className = 'flex gap-4 fade-in mb-4 max-w-3xl';
  div.setAttribute('data-message-id', messageId);
  
  // 渲染引用区域
  const citationsHtml = renderCitations(citations, messageId);
  
  // 如果是流式响应，显示加载状态
  const contentHtml = isStreaming 
    ? (html === '正在思考...' 
        ? '<div class="flex items-center gap-2 text-slate-400"><div class="w-4 h-4 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin"></div><span>正在思考...</span></div>' 
        : parseMarkdown(html) + '<span class="cursor-blink">▋</span>')
    : parseMarkdown(html);
  
  div.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 shadow-sm mt-1">
      <i data-lucide="bot" size="16" class="text-indigo-600"></i>
    </div>
    <div class="space-y-1 flex-1">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-slate-800">DeepSeek</span>
        <span class="role-badge ${badge.class}">${badge.label}</span>
      </div>
      ${citationsHtml}
      <div class="msg-ai px-5 py-4 text-[15px] text-slate-600 leading-relaxed">
        ${contentHtml}
      </div>
      ${!isStreaming ? renderMessageActions(messageId) : ''}
    </div>
  `;
  
  container.appendChild(div);
  
  // 初始化Lucide图标
  if (window.lucide) {
    lucide.createIcons(div);
  }
  
  // 绑定引用点击事件
  bindCitationClicks(div);
  bindMessageActions(div);
  
  // 绑定引用卡片按钮点击事件
  div.querySelectorAll('.view-citation-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.getAttribute('data-citation-index'));
      const page = parseInt(btn.getAttribute('data-page'));
      const text = btn.getAttribute('data-text') || '';
      const docId = btn.getAttribute('data-doc-id') || '';
      handleCitationClick(index, page, text, docId);
    });
  });
  
  scrollToBottom();
  return div;
}

// 渲染引用卡片区域
function renderCitations(citations, messageId) {
  if (!citations || citations.length === 0) {
    return '';
  }
  
  // 获取当前知识库ID（用于判断是否需要显示知识库标签）
  let currentKnowledgeBaseId = null;
  try {
    // 尝试从state.currentDocInfo获取
    if (state.currentDocInfo && state.currentDocInfo.knowledgeBaseId) {
      currentKnowledgeBaseId = state.currentDocInfo.knowledgeBaseId;
    }
  } catch (e) {
    // 忽略错误
  }
  
  // 知识库颜色映射（不同知识库使用不同颜色）
  const kbColors = {
    default: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
    kb1: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    kb2: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
    kb3: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    kb4: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' }
  };
  
  // 根据知识库ID生成颜色（简单哈希）
  function getKbColor(kbId) {
    if (!kbId) return kbColors.default;
    const hash = kbId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = Object.values(kbColors);
    return colors[hash % colors.length] || kbColors.default;
  }
  
  const citationCards = citations.map((citation, index) => {
    const docTitle = citation.docTitle || state.currentDoc?.title || '文档';
    const pageNum = citation.page || 1;
    const previewText = citation.text ? citation.text.substring(0, 50) + (citation.text.length > 50 ? '...' : '') : '';
    // 使用实际的文档ID，而不是字符串标识
    const actualDocId = citation.docId && citation.docId !== 'equity' && citation.docId !== 'brand' 
      ? citation.docId 
      : state.currentDocId || '';
    // 转义文本用于HTML属性
    const escapedText = (citation.text || '').replace(/'/g, "\\'").replace(/\n/g, ' ').substring(0, 100);
    
    // 获取知识库信息
    const kbId = citation.knowledgeBaseId || null;
    const kbName = citation.knowledgeBaseName || null;
    const showKbLabel = kbId && kbId !== currentKnowledgeBaseId;
    const kbColor = showKbLabel ? getKbColor(kbId) : null;
    
    return `
      <div class="citation-card" data-citation-id="${index}" data-page="${pageNum}" data-doc-id="${actualDocId}">
        <div class="citation-header">
          <i data-lucide="file-text" size="14" class="text-slate-400"></i>
          <span class="doc-name">${escapeHtml(docTitle)}</span>
          ${showKbLabel && kbName ? `<span class="kb-badge ${kbColor.bg} ${kbColor.text} ${kbColor.border} border px-1.5 py-0.5 rounded text-[10px] font-medium ml-1">${escapeHtml(kbName)}</span>` : ''}
          <span class="page-badge">P.${pageNum}</span>
        </div>
        <div class="citation-preview">"${escapeHtml(previewText)}"</div>
        <button class="view-citation-btn" data-citation-index="${index}" data-page="${pageNum}" data-text="${escapeHtml(escapedText)}" data-doc-id="${actualDocId}">
          查看原文
        </button>
      </div>
    `;
  }).join('');
  
  return `
    <div class="citations-area mb-3" data-message-id="${messageId}">
      <div class="citations-header">
        <i data-lucide="book-open" size="14"></i>
        <span class="citations-count">引用 (${citations.length})</span>
      </div>
      <div class="citations-list">
        ${citationCards}
      </div>
    </div>
  `;
}

// 获取可信度等级
function getTrustLevel(score) {
  if (score >= 80) {
    return { 
      level: 'high', 
      label: '高度可信', 
      icon: '✓', 
      color: 'green',
      iconColor: 'text-green-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200'
    };
  }
  if (score >= 60) {
    return { 
      level: 'medium', 
      label: '基本可信', 
      icon: '⚠️', 
      color: 'yellow',
      iconColor: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200'
    };
  }
  return { 
    level: 'low', 
    label: '可信度较低', 
    icon: '❌', 
    color: 'red',
    iconColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200'
  };
}

// 从AI评估说明中提取关键信息
function extractKeyPoints(explanation, citationValidation, textSimilarity) {
  if (!explanation) return [];
  
  const points = [];
  const explanationLower = explanation.toLowerCase();
  
  // 检测基于知识库
  if (explanationLower.includes('基于知识库') || explanationLower.includes('知识库内容') || explanationLower.includes('引用自知识库')) {
    points.push('回答主要来自您的知识库');
  }
  
  // 检测引用信息
  if (citationValidation.totalCount > 0) {
    points.push(`引用了${citationValidation.totalCount}个文档页面`);
    if (citationValidation.validCount === citationValidation.totalCount) {
      points.push('所有引用都指向真实存在的页面');
    }
  }
  
  // 检测是否使用通用知识
  if (explanationLower.includes('通用知识') || explanationLower.includes('外部知识') || explanationLower.includes('ai的通用')) {
    if (explanationLower.includes('没有') || explanationLower.includes('未')) {
      points.push('没有使用AI的通用知识');
    } else {
      points.push('部分内容来自AI的通用知识');
    }
  }
  
  // 检测具体案例或数据
  if (explanationLower.includes('具体') || explanationLower.includes('案例') || explanationLower.includes('数据')) {
    points.push('使用了知识库中的具体案例或数据');
  }
  
  // 如果没有提取到关键点，使用原始说明的前50个字符
  if (points.length === 0 && explanation) {
    const shortExplanation = explanation.length > 50 ? explanation.substring(0, 50) + '...' : explanation;
    points.push(shortExplanation);
  }
  
  return points;
}

// 生成用户友好的评估说明
function generateUserFriendlyExplanation(trustLevel, keyPoints, aiExplanation) {
  let summary = '';
  
  if (trustLevel.level === 'high') {
    summary = '这个回答高度可信，主要基于您的知识库内容。';
  } else if (trustLevel.level === 'medium') {
    summary = '这个回答基本可信，主要基于您的知识库，但可能包含一些AI的通用知识。';
  } else {
    summary = '这个回答的可信度较低，可能主要依赖AI的通用知识而非您的知识库。';
  }
  
  return {
    summary,
    keyPoints
  };
}

// 生成改进建议
function generateSuggestions(trustLevel, overallScore, citationValidation) {
  if (trustLevel.level === 'high') {
    return null; // 高分不需要建议
  }
  
  const suggestions = [];
  
  if (trustLevel.level === 'low') {
    suggestions.push({
      title: '在问题中明确指出需要引用的文档',
      detail: '例如："根据《创业流程》文档，..." 或 "参考知识库中的相关内容"',
      example: '❌ "什么是好老大？"\n✓ "根据知识库中的《创业流程》文档，什么是好老大的标准？"'
    });
    suggestions.push({
      title: '检查知识库中是否有相关文档',
      detail: '如果知识库缺少相关信息，AI会使用通用知识回答',
      example: '可以尝试添加更多相关文档到知识库'
    });
    suggestions.push({
      title: '补充知识库内容',
      detail: '如果知识库缺少相关信息，考虑补充相关内容',
      example: '上传相关文档或添加相关笔记到知识库'
    });
  } else if (trustLevel.level === 'medium') {
    suggestions.push({
      title: '更明确地指定引用的文档',
      detail: '在提问时指出具体的文档或章节',
      example: '例如："根据《创业流程》第3章的内容..."'
    });
    suggestions.push({
      title: '要求AI引用具体页面',
      detail: '可以在问题中要求AI引用具体的页面或段落',
      example: '例如："请引用具体的页面和段落来回答"'
    });
    
    if (citationValidation.totalCount === 0) {
      suggestions.push({
        title: '检查知识库中是否有更相关的文档',
        detail: '可以尝试添加更多相关文档到知识库',
        example: ''
      });
    }
  }
  
  return suggestions;
}

// 渲染评估结果
function renderEvaluation(evaluation, messageId) {
  if (!evaluation) return '';
  
  const overallScore = evaluation.overallScore || 0;
  const textSimilarity = evaluation.textSimilarity || {};
  const citationValidation = evaluation.citationValidation || {};
  const aiEvaluation = evaluation.aiEvaluation || {};
  
  // 获取可信度等级
  const trustLevel = getTrustLevel(overallScore);
  
  // 根据可信度确定颜色
  const scoreColor = trustLevel.iconColor;
  const scoreBg = trustLevel.bgColor;
  const scoreBorder = trustLevel.borderColor;
  
  // 警告提示
  const showWarning = overallScore < 60;
  
  // 格式化引用准确性显示
  let citationDisplay = '无引用';
  let citationStatus = '';
  if (citationValidation.totalCount > 0) {
    const validCount = citationValidation.validCount || 0;
    const totalCount = citationValidation.totalCount;
    if (validCount === totalCount) {
      citationDisplay = `${validCount}/${totalCount}`;
      citationStatus = '<span class="text-green-600 ml-1">✓ 全部有效</span>';
    } else {
      const invalidCount = totalCount - validCount;
      citationDisplay = `${validCount}/${totalCount}`;
      citationStatus = `<span class="text-red-600 ml-1">⚠️ ${invalidCount}个无效</span>`;
    }
  }
  
  // 生成引用详情HTML
  let citationDetailsHtml = '';
  if (citationValidation.details && citationValidation.details.length > 0) {
    const citationItems = citationValidation.details.map((detail, idx) => {
      const isValid = detail.valid;
      const icon = isValid ? 'check-circle-2' : 'x-circle';
      const iconColor = isValid ? 'text-green-600' : 'text-red-600';
      const statusText = isValid ? '有效' : '无效';
      const reason = detail.reason || (isValid ? '引用有效' : '引用无效');
      
      return `
        <div class="flex items-center gap-2 py-1">
          <i data-lucide="${icon}" size="12" class="${iconColor}"></i>
          <span class="text-slate-600">引用 ${idx + 1} (第${detail.page}页):</span>
          <span class="text-xs ${isValid ? 'text-green-600' : 'text-red-600'}">${statusText}</span>
          ${!isValid ? `<span class="text-xs text-slate-500 ml-1">(${reason})</span>` : ''}
        </div>
      `;
    }).join('');
    
    citationDetailsHtml = `
      <div class="mt-2 pt-2 border-t border-slate-200">
        <div class="text-slate-500 mb-1">引用详情:</div>
        <div class="space-y-0.5">
          ${citationItems}
        </div>
      </div>
    `;
  }
  
  // 生成用户友好的评估说明
  let explanationHtml = '';
  if (aiEvaluation.explanation) {
    // 提取关键信息
    const keyPoints = extractKeyPoints(aiEvaluation.explanation, citationValidation, textSimilarity);
    
    // 生成用户友好的说明
    const userFriendly = generateUserFriendlyExplanation(trustLevel, keyPoints, aiEvaluation.explanation);
    
    // 生成改进建议
    const suggestions = generateSuggestions(trustLevel, overallScore, citationValidation);
    
    // 构建关键信息列表
    let keyPointsHtml = '';
    if (keyPoints.length > 0) {
      keyPointsHtml = `
        <div class="mt-2 space-y-1">
          ${keyPoints.map(point => `
            <div class="flex items-start gap-2">
              <span class="text-slate-400 mt-0.5">•</span>
              <span class="text-slate-600 text-xs">${escapeHtml(point)}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
    
    // 构建改进建议HTML
    let suggestionsHtml = '';
    if (suggestions && suggestions.length > 0) {
      const suggestionsList = suggestions.map((suggestion, idx) => `
        <div class="mb-3 last:mb-0">
          <div class="font-medium text-slate-700 text-xs mb-1">${idx + 1}. ${escapeHtml(suggestion.title)}</div>
          <div class="text-slate-600 text-xs mb-1">${escapeHtml(suggestion.detail)}</div>
          ${suggestion.example ? `<div class="text-slate-500 text-xs font-mono bg-slate-50 p-2 rounded mt-1 whitespace-pre-line">${escapeHtml(suggestion.example)}</div>` : ''}
        </div>
      `).join('');
      
      suggestionsHtml = `
        <div class="mt-3 pt-3 border-t border-slate-200">
          <div class="flex items-center gap-2 mb-2">
            <i data-lucide="lightbulb" size="14" class="text-yellow-600"></i>
            <span class="text-slate-700 font-medium text-xs">💡 如何改进：</span>
          </div>
          <div class="space-y-2">
            ${suggestionsList}
          </div>
        </div>
      `;
    }
    
    explanationHtml = `
      <div class="pt-3 border-t border-slate-200">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-lg font-bold ${trustLevel.iconColor}">${trustLevel.icon}</span>
          <span class="text-slate-700 font-semibold text-sm">回答可信度：${trustLevel.label}</span>
        </div>
        <p class="text-slate-600 text-xs mb-2 leading-relaxed">${escapeHtml(userFriendly.summary)}</p>
        ${keyPointsHtml}
        ${suggestionsHtml}
      </div>
    `;
  }
  
  return `
    <div class="evaluation-area mb-3" data-message-id="${messageId}">
      <div class="evaluation-header flex items-center justify-between cursor-pointer" onclick="toggleEvaluationDetails('${messageId}')">
        <div class="flex items-center gap-2">
          <i data-lucide="bar-chart-2" size="14" class="text-slate-400"></i>
          <span class="text-xs font-medium text-slate-700">相关性评估</span>
          <span class="evaluation-score-badge px-2 py-0.5 rounded-full text-xs font-semibold ${scoreColor} ${scoreBg} ${scoreBorder} border">
            ${overallScore}分
          </span>
          <span class="trust-level-badge px-2 py-0.5 rounded-full text-xs font-medium ${trustLevel.iconColor} ${trustLevel.bgColor} ${trustLevel.borderColor} border">
            ${trustLevel.icon} ${trustLevel.label}
          </span>
          ${showWarning ? '<span class="text-xs text-red-600">⚠️ 相关性较低</span>' : ''}
          <button 
            class="evaluation-help-btn ml-1 text-slate-400 hover:text-slate-600 transition-colors" 
            onclick="event.stopPropagation(); showEvaluationHelp('${messageId}')"
            title="查看指标说明"
          >
            <i data-lucide="help-circle" size="14"></i>
          </button>
        </div>
        <i data-lucide="chevron-down" size="14" class="text-slate-400 evaluation-chevron"></i>
      </div>
      <div class="evaluation-details hidden mt-2 p-3 bg-slate-50 rounded-lg text-xs space-y-2" id="evaluation-details-${messageId}">
        <div class="grid grid-cols-2 gap-3">
          <div class="metric-item" data-metric="textSimilarity">
            <div class="flex items-center gap-1.5 mb-1">
              <i data-lucide="file-text" size="12" class="text-slate-400"></i>
              <span class="text-slate-500">文本相似度</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-slate-200 rounded-full h-1.5">
                <div class="bg-indigo-500 h-1.5 rounded-full" style="width: ${Math.min(Math.round(textSimilarity.similarity || 0), 100)}%"></div>
              </div>
              <span class="font-medium text-slate-700 min-w-[3rem] text-right">${Math.round(textSimilarity.similarity || 0)}%</span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">用词接近程度</div>
          </div>
          <div class="metric-item" data-metric="contentRatio">
            <div class="flex items-center gap-1.5 mb-1">
              <i data-lucide="search" size="12" class="text-slate-400"></i>
              <span class="text-slate-500">内容匹配度</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-slate-200 rounded-full h-1.5">
                <div class="bg-blue-500 h-1.5 rounded-full" style="width: ${Math.min(Math.round(textSimilarity.contentRatio || 0), 100)}%"></div>
              </div>
              <span class="font-medium text-slate-700 min-w-[3rem] text-right">${Math.round(textSimilarity.contentRatio || 0)}%</span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">知识库中找到的内容比例</div>
          </div>
          <div class="metric-item" data-metric="citationAccuracy">
            <div class="flex items-center gap-1.5 mb-1">
              <i data-lucide="book-open" size="12" class="text-slate-400"></i>
              <span class="text-slate-500">引用准确性</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-slate-700">${citationDisplay}</span>
              ${citationStatus}
            </div>
            <div class="text-xs text-slate-400 mt-0.5">引用的文档页码和内容是否真实存在</div>
            ${citationDetailsHtml}
          </div>
          <div class="metric-item" data-metric="aiEvaluation">
            <div class="flex items-center gap-1.5 mb-1">
              <i data-lucide="brain" size="12" class="text-slate-400"></i>
              <span class="text-slate-500">AI评估</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-slate-200 rounded-full h-1.5">
                <div class="bg-purple-500 h-1.5 rounded-full" style="width: ${Math.min(Math.round(aiEvaluation.relevanceScore || 0), 100)}%"></div>
              </div>
              <span class="font-medium text-slate-700 min-w-[3rem] text-right">${Math.round(aiEvaluation.relevanceScore || 0)}%</span>
            </div>
            <div class="text-xs text-slate-400 mt-0.5">基于知识库而非通用知识的程度</div>
          </div>
        </div>
        ${explanationHtml}
      </div>
    </div>
  `;
}

// 切换评估详情显示
window.toggleEvaluationDetails = function(messageId) {
  const detailsEl = document.getElementById(`evaluation-details-${messageId}`);
  const chevronEl = document.querySelector(`[data-message-id="${messageId}"] .evaluation-chevron`);
  if (detailsEl) {
    detailsEl.classList.toggle('hidden');
    if (chevronEl && window.lucide) {
      if (detailsEl.classList.contains('hidden')) {
        chevronEl.setAttribute('data-lucide', 'chevron-down');
      } else {
        chevronEl.setAttribute('data-lucide', 'chevron-up');
      }
      lucide.createIcons(chevronEl);
    }
  }
};

// 显示评估帮助说明
window.showEvaluationHelp = function(messageId) {
  // 检查是否已存在帮助弹窗
  let helpModal = document.getElementById('evaluation-help-modal');
  if (helpModal) {
    helpModal.remove();
  }
  
  // 创建帮助弹窗
  helpModal = document.createElement('div');
  helpModal.id = 'evaluation-help-modal';
  helpModal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
  helpModal.onclick = function(e) {
    if (e.target === helpModal) {
      helpModal.remove();
    }
  };
  
  helpModal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
      <div class="p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <i data-lucide="help-circle" size="20" class="text-indigo-600"></i>
            相关性评估指标说明
          </h3>
          <button onclick="document.getElementById('evaluation-help-modal').remove()" class="text-slate-400 hover:text-slate-600">
            <i data-lucide="x" size="20"></i>
          </button>
        </div>
        <div class="space-y-4 text-sm">
          <div class="p-3 bg-slate-50 rounded-lg">
            <div class="flex items-center gap-2 mb-2">
              <i data-lucide="file-text" size="16" class="text-indigo-600"></i>
              <span class="font-medium text-slate-900">文本相似度</span>
            </div>
            <p class="text-slate-600 text-xs leading-relaxed">
              AI回答与知识库内容的词汇相似程度。数值越高表示AI回答使用的词汇与知识库越接近。
              例如：如果知识库提到"创业阶段"，AI回答也使用了"创业阶段"这个词，相似度会提高。
            </p>
          </div>
          <div class="p-3 bg-slate-50 rounded-lg">
            <div class="flex items-center gap-2 mb-2">
              <i data-lucide="search" size="16" class="text-blue-600"></i>
              <span class="font-medium text-slate-900">内容匹配度</span>
            </div>
            <p class="text-slate-600 text-xs leading-relaxed">
              AI回答中有多少内容能在知识库中找到。反映AI回答是否真正基于知识库内容。
              例如：如果AI回答中的关键短语和句子都能在知识库文档中找到，匹配度会较高。
            </p>
          </div>
          <div class="p-3 bg-slate-50 rounded-lg">
            <div class="flex items-center gap-2 mb-2">
              <i data-lucide="book-open" size="16" class="text-green-600"></i>
              <span class="font-medium text-slate-900">引用准确性</span>
            </div>
            <p class="text-slate-600 text-xs leading-relaxed">
              AI引用的文档页码和内容是否真实存在。格式为"有效数/总数"，例如"4/4"表示4个引用全部有效。
              <br><br>
              <strong>如何理解：</strong>
              <ul class="list-disc list-inside mt-1 space-y-1 text-xs">
                <li><strong>4/4 ✓ 全部有效</strong>：所有引用都指向真实存在的文档页面</li>
                <li><strong>2/4 ⚠️ 2个无效</strong>：有2个引用指向不存在的页面或内容不匹配</li>
                <li><strong>无引用</strong>：AI回答没有引用任何文档</li>
              </ul>
            </p>
          </div>
          <div class="p-3 bg-slate-50 rounded-lg">
            <div class="flex items-center gap-2 mb-2">
              <i data-lucide="brain" size="16" class="text-purple-600"></i>
              <span class="font-medium text-slate-900">AI评估</span>
            </div>
            <p class="text-slate-600 text-xs leading-relaxed">
              AI判断回答多大程度基于知识库内容，而非AI的通用知识。这是综合评估，考虑回答的整体相关性。
              例如：如果AI主要使用知识库中的具体案例和数据，而不是通用知识，评分会较高。
            </p>
          </div>
          <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div class="flex items-center gap-2 mb-2">
              <i data-lucide="lightbulb" size="16" class="text-yellow-600"></i>
              <span class="font-medium text-slate-900">综合评分</span>
            </div>
            <p class="text-slate-600 text-xs leading-relaxed">
              综合评分 = 文本相似度(30%) + 引用准确性(20%) + AI评估(50%)
              <br><br>
              <strong>评分参考：</strong>
              <ul class="list-disc list-inside mt-1 space-y-1 text-xs">
                <li><strong>80-100分（绿色）</strong>：回答高度基于知识库，相关性很好</li>
                <li><strong>60-79分（黄色）</strong>：回答基本基于知识库，但可以更准确</li>
                <li><strong>0-59分（红色）</strong>：回答相关性较低，可能主要依赖AI通用知识</li>
              </ul>
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(helpModal);
  
  // 初始化图标
  if (window.lucide) {
    lucide.createIcons(helpModal);
  }
};

// 渲染消息操作按钮
function renderMessageActions(messageId) {
  return `
    <div class="message-actions mt-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <button class="action-btn" onclick="copyMessage('${messageId}')" title="复制">
        <i data-lucide="copy" size="14"></i>
      </button>
      <button class="action-btn" onclick="regenerateMessage('${messageId}')" title="重新生成">
        <i data-lucide="refresh-cw" size="14"></i>
      </button>
    </div>
  `;
}

// 绑定消息操作事件
function bindMessageActions(element) {
  element.classList.add('group');
}

// 更新AI消息（流式）
function updateAiMessage(element, content, citations = [], evaluation = null) {
  if (!element) return;
  
  const messageId = element.getAttribute('data-message-id');
  
  // 更新评估结果区域
  const evaluationArea = element.querySelector('.evaluation-area');
  if (evaluation) {
    const evaluationHtml = renderEvaluation(evaluation, messageId);
    if (evaluationArea) {
      evaluationArea.outerHTML = evaluationHtml;
      if (window.lucide) lucide.createIcons(element);
    } else {
      // 插入评估区域（在引用区域之后）
      const msgContainer = element.querySelector('.space-y-1');
      if (msgContainer) {
        const citationsArea = msgContainer.querySelector('.citations-area');
        if (citationsArea) {
          citationsArea.insertAdjacentHTML('afterend', evaluationHtml);
        } else {
          const badgeEl = msgContainer.querySelector('.flex.items-center');
          if (badgeEl) {
            badgeEl.insertAdjacentHTML('afterend', evaluationHtml);
          }
        }
        if (window.lucide) lucide.createIcons(element);
      }
    }
  } else if (evaluationArea) {
    // 如果没有评估结果，移除评估区域
    evaluationArea.remove();
  }
  
  // 更新引用区域
  const citationsArea = element.querySelector('.citations-area');
  if (citations && citations.length > 0) {
    const citationsHtml = renderCitations(citations, messageId);
    if (citationsArea) {
      citationsArea.outerHTML = citationsHtml;
      if (window.lucide) lucide.createIcons(element);
    } else {
      // 插入引用区域
      const msgContainer = element.querySelector('.space-y-1');
      if (msgContainer) {
        const badgeEl = msgContainer.querySelector('.flex.items-center');
        if (badgeEl) {
          badgeEl.insertAdjacentHTML('afterend', citationsHtml);
          if (window.lucide) lucide.createIcons(element);
        }
      }
    }
  }
  
  const contentEl = element.querySelector('.msg-ai');
  if (contentEl) {
    // 如果有内容，移除"正在思考"状态
    if (content && content.trim()) {
      // 先解析markdown，再高亮引用
      let html = parseMarkdown(content);
      
      // 高亮答案中的引用文本
      if (citations && citations.length > 0) {
        // 根据当前文档分类选择颜色
        const category = state.currentDocInfo?.category || '通用';
        const citationColor = category.includes('团队') || category.includes('股权') || category.includes('管理') 
          ? 'emerald' 
          : (category.includes('品牌') || category.includes('营销') || category.includes('推广') ? 'blue' : 'indigo');
        
        citations.forEach((citation, index) => {
          const citationText = citation.text || '';
          if (citationText) {
            const pageNum = citation.page || 1;
            const citationHtml = `<span class="citation-link text-${citationColor}-700 cursor-pointer hover:underline" 
              data-citation-id="${index}"
              data-page="${pageNum}" 
              data-text="${escapeHtml(citationText)}"
              data-doc-id="${citation.docId && citation.docId !== 'equity' && citation.docId !== 'brand' ? citation.docId : state.currentDocId || ''}"
              title="点击查看原文 (第${pageNum}页)"
            >
              ${escapeHtml(citationText)}
              <span class="citation-marker">[P.${pageNum}]</span>
            </span>`;
            
            // 替换引用文本
            const regex = new RegExp(escapeRegex(citationText), 'gi');
            html = html.replace(regex, citationHtml);
          }
        });
      }
      
      contentEl.innerHTML = html + '<span class="cursor-blink">▋</span>';
    } else {
      // 如果没有内容，保持加载状态
      contentEl.innerHTML = '<div class="flex items-center gap-2 text-slate-400"><div class="w-4 h-4 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin"></div><span>正在思考...</span></div>';
    }
    
    // 重新绑定引用点击
    bindCitationClicks(element);
    
    // 绑定答案中的引用链接点击事件
    element.querySelectorAll('.citation-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(link.getAttribute('data-citation-id'));
        const page = parseInt(link.getAttribute('data-page'));
        const text = link.getAttribute('data-text') || '';
        const docId = link.getAttribute('data-doc-id') || '';
        handleCitationInAnswerClick(index, page, text, docId);
      });
    });
  }
  
  scrollToBottom();
}

// 绑定引用点击事件
function bindCitationClicks(element) {
  element.querySelectorAll('.highlight-mark').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = parseInt(el.getAttribute('data-page'));
      const text = el.getAttribute('data-text');
      locateQuote(page, text);
    });
  });
}

// 处理引用卡片点击
export function handleCitationClick(citationIndex, page, text, docId) {
  // 标记为已查看
  const citationCard = document.querySelector(`[data-citation-id="${citationIndex}"]`);
  if (citationCard) {
    citationCard.classList.add('viewed');
  }
  
  // 跳转到PDF（点击引用时自动打开面板）
  if (docId && docId !== state.currentDocId) {
    loadDoc(docId, true).then(() => {
      setTimeout(() => {
        locateQuote(page, text, docId);
      }, 300);
    });
  } else {
    // 如果文档已加载，直接定位并打开面板
    const panel = document.getElementById('right-panel');
    if (panel) {
      const isOpen = panel.style.width === '40%' || panel.style.width === '45%' || panel.classList.contains('w-[45%]') || panel.offsetWidth > 100;
      if (!isOpen) {
        panel.style.width = '40%';
        panel.style.minWidth = '40%';
        panel.classList.add('w-[40%]');
        // 清除关闭标记（用户点击引用，说明需要查看文档）
        localStorage.removeItem('rightPanelClosed');
      }
    }
    locateQuote(page, text, docId);
  }
}

// 处理答案中引用文本点击
export function handleCitationInAnswerClick(citationIndex, page, text, docId) {
  // 高亮对应的引用卡片
  const citationCard = document.querySelector(`[data-citation-id="${citationIndex}"]`);
  if (citationCard) {
    citationCard.style.animation = 'pulse 0.5s ease-in-out';
    setTimeout(() => {
      citationCard.style.animation = '';
    }, 500);
  }
  
  // 跳转到PDF（点击引用时自动打开面板）
  if (docId && docId !== state.currentDocId) {
    loadDoc(docId, true).then(() => {
      setTimeout(() => {
        locateQuote(page, text, docId);
      }, 300);
    });
  } else {
    // 如果文档已加载，直接定位并打开面板
    const panel = document.getElementById('right-panel');
    if (panel) {
      const isOpen = panel.style.width === '40%' || panel.style.width === '45%' || panel.classList.contains('w-[45%]') || panel.offsetWidth > 100;
      if (!isOpen) {
        panel.style.width = '40%';
        panel.style.minWidth = '40%';
        panel.classList.add('w-[40%]');
        // 清除关闭标记（用户点击引用，说明需要查看文档）
        localStorage.removeItem('rightPanelClosed');
      }
    }
    locateQuote(page, text, docId);
  }
}

// 设置PDF查看器实例
export function setPDFViewerInstance(viewerInstance) {
  state.pdfViewerInstance = viewerInstance;
}

// 定位引用（只在用户点击引用时调用，此时面板应该已经打开）
export function locateQuote(page, text, docId = null) {
  const targetDocId = docId || state.currentDocId;
  
  // 验证页码：确保是数字类型且大于0
  const pageNum = typeof page === 'number' ? page : parseInt(page, 10);
  if (!pageNum || pageNum < 1 || isNaN(pageNum)) {
    console.warn('无效的页码:', page);
    return;
  }
  
  // 跳转到PDF并高亮
  if (targetDocId && targetDocId === state.currentDocId) {
    const container = document.getElementById('pdf-content');
    if (container && state.currentDoc) {
      // 检查是否使用PDF.js查看器（canvas渲染）
      const pdfViewerContainer = container.querySelector('.pdf-viewer-container');
      if (pdfViewerContainer && state.pdfViewerInstance && state.pdfViewerInstance.scrollToPage) {
        // 如果PDF查看器实例有总页数信息，验证页码是否在有效范围内
        if (state.pdfViewerInstance.numPages && pageNum > state.pdfViewerInstance.numPages) {
          console.warn(`页码 ${pageNum} 超出范围（总页数: ${state.pdfViewerInstance.numPages}）`);
          return;
        }
        // 使用PDF.js查看器的scrollToPage方法，传递文本参数以实现精确定位
        state.pdfViewerInstance.scrollToPage(pageNum, text || null);
      } else {
        // 降级到文本模式的高亮（适用于文本渲染）
        highlightPage(container, pageNum);
        if (text) {
          highlightTextInPDF(container, text);
        }
      }
    }
  }
}

// 复制消息
export function copyMessage(messageId) {
  const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) return;
  
  const contentEl = messageEl.querySelector('.msg-ai');
  if (!contentEl) return;
  
  const text = contentEl.textContent || contentEl.innerText;
  navigator.clipboard.writeText(text).then(() => {
    // 显示复制成功提示
    const btn = messageEl.querySelector('[onclick*="copyMessage"]');
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="check" size="14"></i> 已复制';
      setTimeout(() => {
        btn.innerHTML = original;
        if (window.lucide) lucide.createIcons();
      }, 2000);
    }
  });
}

// 检查API是否配置
async function checkApiConfigured() {
  try {
    // 优先检查用户API Key
    const { isCurrentUserApiKeyConfigured } = await import('./user-manager.js');
    const userApiConfigured = isCurrentUserApiKeyConfigured();
    
    if (userApiConfigured) {
      return true;
    }
    
    // 向后兼容：检查全局API Key
    const res = await settingsAPI.get();
    const data = res.data || {};
    return !!data.deepseek_api_key_configured;
  } catch (error) {
    console.error('检查API配置失败:', error);
    return false;
  }
}

// 打开设置对话框（咨询工作台专用）
async function openSettingsModalFromConsultation() {
  try {
    // 尝试触发设置按钮的点击事件（这是最推荐的方式，因为会触发loadSettings）
    const settingsBtn = document.getElementById('btn-open-settings');
    if (settingsBtn) {
      settingsBtn.click();
      return;
    }
    
    // 如果按钮不存在，尝试直接操作模态框并加载设置
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
      // 尝试加载设置（通过调用settingsAPI）
      try {
        await settingsAPI.get();
      } catch (e) {
        console.warn('加载设置失败:', e);
      }
      
      settingsModal.classList.remove('hidden');
      settingsModal.classList.add('flex');
      const settingsContent = document.getElementById('settings-content');
      if (settingsContent) {
        requestAnimationFrame(() => {
          settingsContent.classList.remove('opacity-0', 'scale-95');
          settingsContent.classList.add('opacity-100', 'scale-100');
        });
      }
      return;
    }
    
    // 最后的降级方案：显示提示
    alert('请先在设置中配置 DeepSeek API Key\n\n点击侧边栏底部的设置图标进行配置');
  } catch (error) {
    console.error('打开设置对话框失败:', error);
    alert('请先在设置中配置 DeepSeek API Key\n\n点击侧边栏底部的设置图标进行配置');
  }
}

// 从消息中提取文档ID列表
function extractDocIdsFromMessages(messages) {
  const docIds = new Set();
  messages.forEach(msg => {
    if (msg.citations && Array.isArray(msg.citations)) {
      msg.citations.forEach(citation => {
        if (citation.docId) {
          docIds.add(citation.docId);
        }
      });
    }
    if (msg.docInfo && msg.docInfo.docId) {
      docIds.add(msg.docInfo.docId);
    }
  });
  return Array.from(docIds);
}

// 从消息中提取知识库ID列表
function extractKnowledgeBaseIdsFromMessages(messages) {
  const kbIds = new Set();
  messages.forEach(msg => {
    if (msg.citations && Array.isArray(msg.citations)) {
      msg.citations.forEach(citation => {
        if (citation.knowledgeBaseId) {
          kbIds.add(citation.knowledgeBaseId);
        }
      });
    }
    if (msg.docInfo && msg.docInfo.knowledgeBaseId) {
      kbIds.add(msg.docInfo.knowledgeBaseId);
    }
  });
  return Array.from(kbIds);
}

// 重新生成消息
export async function regenerateMessage(messageId) {
  try {
    // 检查API配置
    const apiConfigured = await checkApiConfigured();
    if (!apiConfigured) {
      // 显示提示并打开设置对话框
      const shouldConfigure = confirm('未配置 DeepSeek API Key，无法重新生成对话。\n\n是否前往设置页面配置？');
      if (shouldConfigure) {
        openSettingsModalFromConsultation();
      }
      return;
    }
    
    // 找到对应的消息元素
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) {
      console.error('找不到消息元素:', messageId);
      return;
    }
    
    // 找到消息在DOM中的位置
    const chatStream = document.getElementById('chat-stream');
    if (!chatStream) {
      console.error('找不到聊天流容器');
      return;
    }
    
    // 找到消息在DOM中的所有消息列表中的位置
    const allMessages = Array.from(chatStream.children);
    const messageIndex = allMessages.indexOf(messageEl);
    if (messageIndex === -1) {
      console.error('无法找到消息在列表中的位置');
      return;
    }
    
    // 向前查找对应的用户消息（应该在前一个位置）
    let userMessageEl = null;
    let userMessageIndex = -1;
    
    // 方法1: 通过 justify-end 类查找（用户消息右对齐）
    for (let i = messageIndex - 1; i >= 0; i--) {
      const msgEl = allMessages[i];
      if (msgEl.classList.contains('justify-end')) {
        // 找到用户消息（右对齐的消息）
        userMessageEl = msgEl;
        userMessageIndex = i;
        break;
      }
    }
    
    // 方法2: 如果方法1失败，尝试通过 .msg-user 类查找
    if (!userMessageEl) {
      for (let i = messageIndex - 1; i >= 0; i--) {
        const msgEl = allMessages[i];
        const userMsg = msgEl.querySelector('.msg-user');
        if (userMsg) {
          userMessageEl = msgEl;
          userMessageIndex = i;
          break;
        }
      }
    }
    
    // 方法3: 如果前两种方法都失败，尝试从 state.history 中查找
    if (!userMessageEl) {
      console.warn('无法通过DOM找到用户消息，尝试从历史记录中查找');
      // 从后往前查找，找到最后一个用户消息
      for (let i = state.history.length - 1; i >= 0; i--) {
        const msg = state.history[i];
        if (msg.role === 'user') {
          // 检查这是否是对应的消息对
          if (i + 1 < state.history.length && state.history[i + 1].role === 'assistant') {
            // 尝试通过内容匹配找到DOM元素
            const userContent = msg.content;
            for (let j = messageIndex - 1; j >= 0; j--) {
              const msgEl = allMessages[j];
              const msgUserEl = msgEl.querySelector('.msg-user');
              if (msgUserEl && msgUserEl.textContent?.trim() === userContent) {
                userMessageEl = msgEl;
                userMessageIndex = j;
                break;
              }
            }
            if (userMessageEl) break;
          }
        }
      }
    }
    
    if (!userMessageEl) {
      console.error('找不到对应的用户消息，消息索引:', messageIndex, '总消息数:', allMessages.length);
      console.error('尝试查找的消息ID:', messageId);
      if (window.showToast) {
        window.showToast('无法找到对应的用户消息，请刷新页面后重试', 'error');
      } else {
        alert('无法找到对应的用户消息，请刷新页面后重试');
      }
      return;
    }
    
    // 获取用户消息的内容
    const userMessageContent = userMessageEl.querySelector('.msg-user')?.textContent?.trim();
    if (!userMessageContent) {
      console.error('无法获取用户消息内容，DOM结构:', userMessageEl.innerHTML.substring(0, 200));
      if (window.showToast) {
        window.showToast('无法获取用户消息内容，请刷新页面后重试', 'error');
      } else {
        alert('无法获取用户消息内容，请刷新页面后重试');
      }
      return;
    }
    
    // 在state.history中找到对应的消息对（分支点）
    // 从后往前查找，找到最后一个匹配的用户消息
    let foundUserIndex = -1;
    for (let i = state.history.length - 1; i >= 0; i--) {
      const msg = state.history[i];
      if (msg.role === 'user' && msg.content === userMessageContent) {
        // 检查这是否是对应的消息对
        // 如果下一个消息是assistant，且是我们找到的消息，则确认
        if (i + 1 < state.history.length && state.history[i + 1].role === 'assistant') {
          foundUserIndex = i;
          break;
        }
      }
    }
    
    if (foundUserIndex === -1) {
      console.error('在历史记录中找不到对应的消息');
      // 仍然尝试重新生成，使用找到的用户消息内容
      await handleConversation(userMessageContent);
      return;
    }
    
    // 分支逻辑：创建新分支而不是删除消息
    // 1. 确定分支点（用户消息的索引）
    const branchPoint = foundUserIndex;
    
    // 2. 如果还没有分支结构，初始化
    if (!state.branches || state.branches.length === 0) {
      // 将分支点之前的消息保存为baseMessages
      state.baseMessages = state.history.slice(0, branchPoint);
      // 创建第一个分支（当前分支）
      const firstBranchId = `branch-${Date.now()}-1`;
      const branchMessages = state.history.slice(branchPoint); // 从分支点开始的所有消息
      state.branches = [{
        branchId: firstBranchId,
        version: 1,
        branchPoint: branchPoint,
        messages: branchMessages,
        docIds: extractDocIdsFromMessages(branchMessages),
        knowledgeBaseIds: extractKnowledgeBaseIdsFromMessages(branchMessages),
        createdAt: Date.now()
      }];
      state.currentBranchId = firstBranchId;
    } else {
      // 已有分支：保存当前分支，创建新分支
      // 找到当前分支
      const currentBranch = state.branches.find(b => b.branchId === state.currentBranchId);
      if (currentBranch) {
        // 更新当前分支的消息（从分支点开始的所有消息）
        const branchMessages = state.history.slice(branchPoint);
        currentBranch.messages = branchMessages;
        currentBranch.docIds = extractDocIdsFromMessages(branchMessages);
        currentBranch.knowledgeBaseIds = extractKnowledgeBaseIdsFromMessages(branchMessages);
      }
      
      // 创建新分支
      const maxVersion = Math.max(...state.branches.map(b => b.version), 0);
      const newVersion = maxVersion + 1;
      const newBranchId = `branch-${Date.now()}-${newVersion}`;
      
      // 新分支从分支点开始，但消息为空（等待重新生成）
      const newBranch = {
        branchId: newBranchId,
        version: newVersion,
        branchPoint: branchPoint,
        messages: [], // 初始为空，等待重新生成
        docIds: [],
        knowledgeBaseIds: [],
        createdAt: Date.now()
      };
      
      state.branches.push(newBranch);
      state.currentBranchId = newBranchId;
      
      // 更新baseMessages（确保包含分支点之前的消息）
      if (state.baseMessages.length < branchPoint) {
        state.baseMessages = state.history.slice(0, branchPoint);
      }
    }
    
    // 3. 更新state.history为baseMessages（新分支还没有消息）
    state.history = [...state.baseMessages];
    
    // 4. 从DOM中移除用户消息和AI消息（从分支点开始的消息）
    const messagesToRemove = [];
    if (userMessageIndex >= 0) {
      messagesToRemove.push(userMessageEl);
    }
    if (messageIndex >= 0) {
      messagesToRemove.push(messageEl);
    }
    
    messagesToRemove.forEach(msg => {
      if (msg.parentNode) {
        msg.remove();
      }
    });
    
    // 5. 重新渲染历史消息（显示baseMessages）
    renderHistory();
    
    // 6. 重新发送用户消息（这将创建新分支的消息）
    await handleConversation(userMessageContent);
    
  } catch (error) {
    console.error('重新生成消息失败:', error);
    const errorMsg = error.message || '重新生成失败，请稍后重试';
    addAiMessage(`❌ **重新生成失败**：${errorMsg}`);
  }
}

// 切换分支
export async function switchBranch(branchId) {
  if (!state.branches || state.branches.length === 0) {
    console.warn('没有分支可切换');
    return;
  }
  
  const targetBranch = state.branches.find(b => b.branchId === branchId);
  if (!targetBranch) {
    console.warn('找不到目标分支:', branchId);
    return;
  }
  
  // 保存当前分支（如果有）
  if (state.currentBranchId) {
    const currentBranch = state.branches.find(b => b.branchId === state.currentBranchId);
    if (currentBranch) {
      // 更新当前分支的消息
      const branchStartIndex = state.baseMessages.length;
      const branchMessages = state.history.slice(branchStartIndex);
      currentBranch.messages = branchMessages;
      currentBranch.docIds = extractDocIdsFromMessages(branchMessages);
      currentBranch.knowledgeBaseIds = extractKnowledgeBaseIdsFromMessages(branchMessages);
    }
  }
  
  // 切换到目标分支
  state.currentBranchId = branchId;
  
  // 构建新的历史消息：baseMessages + 目标分支的消息
  state.history = [...state.baseMessages, ...targetBranch.messages];
  
  // 保存历史
  await saveHistory();
  
  // 重新渲染历史消息
  renderHistory();
  
  // 滚动到底部
  scrollToBottom();
}

// 渲染分支切换器
function renderBranchSwitcher(branchPoint) {
  if (!state.branches || state.branches.length === 0) {
    return '';
  }
  
  // 找到该分支点的所有分支
  const branchesAtPoint = state.branches.filter(b => b.branchPoint === branchPoint);
  if (branchesAtPoint.length <= 1) {
    return ''; // 只有一个分支，不需要显示切换器
  }
  
  // 按版本号排序
  branchesAtPoint.sort((a, b) => a.version - b.version);
  
  const currentBranch = branchesAtPoint.find(b => b.branchId === state.currentBranchId);
  const currentVersion = currentBranch ? currentBranch.version : branchesAtPoint[branchesAtPoint.length - 1].version;
  
  // 生成分支选项HTML
  const branchOptions = branchesAtPoint.map(branch => {
    const isCurrent = branch.branchId === state.currentBranchId;
    return `
      <button
        onclick="switchBranch('${branch.branchId}')"
        class="w-full px-3 py-2 text-left text-sm ${isCurrent ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'} rounded transition-colors"
      >
        <div class="flex items-center justify-between">
          <span>版本${branch.version}</span>
          ${isCurrent ? '<i data-lucide="check" size="14" class="text-indigo-600"></i>' : ''}
        </div>
      </button>
    `;
  }).join('');
  
  return `
    <div class="branch-switcher relative inline-block">
      <button
        onclick="toggleBranchSwitcher('branch-switcher-${branchPoint}')"
        class="px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors flex items-center gap-1"
        title="切换版本"
      >
        <i data-lucide="git-branch" size="12"></i>
        <span>版本${currentVersion}</span>
        <i data-lucide="chevron-down" size="10"></i>
      </button>
      <div
        id="branch-switcher-${branchPoint}"
        class="hidden absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[120px] py-1"
      >
        ${branchOptions}
      </div>
    </div>
  `;
}

// 切换分支切换器显示/隐藏
window.toggleBranchSwitcher = function(switcherId) {
  const switcher = document.getElementById(switcherId);
  if (!switcher) return;
  
  // 关闭其他分支切换器
  document.querySelectorAll('[id^="branch-switcher-"]').forEach(el => {
    if (el.id !== switcherId) {
      el.classList.add('hidden');
    }
  });
  
  switcher.classList.toggle('hidden');
  
  // 点击外部关闭
  if (!switcher.classList.contains('hidden')) {
    const closeHandler = (e) => {
      if (!switcher.contains(e.target) && !e.target.closest('.branch-switcher')) {
        switcher.classList.add('hidden');
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeHandler);
    }, 10);
  }
};

// 切换分支（全局函数）
window.switchBranch = switchBranch;

// 切换右侧面板
export function toggleRightPanel() {
  const panel = document.getElementById('right-panel');
  if (!panel) {
    console.error('找不到right-panel元素');
    return;
  }
  
  const isOpen = panel.style.width === '40%' || panel.style.width === '45%' || panel.classList.contains('w-[45%]') || panel.offsetWidth > 100;
  if (isOpen) {
    panel.style.width = '0';
    panel.style.minWidth = '0';
    panel.classList.remove('w-[45%]', 'w-[40%]');
    // 记住用户手动关闭
    localStorage.setItem('rightPanelClosed', 'true');
  } else {
    panel.style.width = '40%';
    panel.style.minWidth = '40%';
    panel.classList.add('w-[40%]');
    // 清除关闭标记
    localStorage.removeItem('rightPanelClosed');
  }
}

// 滚动到底部
function scrollToBottom() {
  const container = document.getElementById('chat-container');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// 渲染历史对话列表（按模块分组）
export async function renderConversationHistory() {
  const container = document.getElementById('conversation-history-list');
  if (!container) {
    console.warn('渲染历史对话：找不到容器元素');
    return;
  }
  
  // 强制清除缓存，确保获取最新数据
  invalidateConversationsCache();
  
  // 获取排序后的对话列表（不使用缓存，因为已清除）
  let sorted = await getSortedConversations();
  console.log('渲染历史对话：准备渲染', sorted.length, '个对话');
  console.log('对话详情:', sorted.map(c => ({ id: c.id, moduleId: c.moduleId, docId: c.docId, messageCount: c.messages?.length || 0 })));
  
  // 搜索过滤
  const searchInput = document.getElementById('conversation-history-search');
  if (searchInput) {
    const searchTerm = (searchInput.value || '').trim().toLowerCase();
    if (searchTerm) {
      // 根据搜索关键词过滤对话
      sorted = sorted.filter(conv => {
        const preview = getConversationPreview(conv).toLowerCase();
        return preview.includes(searchTerm);
      });
      console.log('搜索过滤后剩余', sorted.length, '个对话');
    }
  }
  
  // 调试：检查localStorage中的所有对话键
  const allKeys = Object.keys(localStorage).filter(k => k.includes('conversation'));
  console.log('localStorage中所有对话相关的键:', allKeys);
  allKeys.forEach(key => {
    try {
      const value = localStorage.getItem(key);
      const parsed = JSON.parse(value);
      console.log(`键 ${key}:`, {
        conversationsCount: parsed.conversations?.length || 0,
        currentConversationId: parsed.currentConversationId,
        moduleId: parsed.moduleId
      });
    } catch (e) {
      console.log(`键 ${key}: 解析失败`, e);
    }
  });
  
  if (sorted.length === 0) {
    console.log('渲染历史对话：没有对话，显示空状态');
    const searchInput = document.getElementById('conversation-history-search');
    const hasSearchTerm = searchInput && searchInput.value.trim();
    
    container.innerHTML = `
      <div class="text-xs text-slate-400 px-3 py-4 text-center flex flex-col items-center gap-1.5">
        <i data-lucide="message-square" size="16" class="opacity-50"></i>
        <p>${hasSearchTerm ? '未找到匹配的对话' : '暂无历史对话'}</p>
        <p class="text-[10px]">${hasSearchTerm ? '尝试使用其他关键词搜索' : '开始对话后，历史记录会显示在这里'}</p>
      </div>
    `;
    if (window.lucide) {
      lucide.createIcons(container);
    }
    return;
  }
  
  // 按文档和模块分组
  try {
    const modulesModule = await import('./modules.js');
    const modules = modulesModule.moduleState?.modules || [];
    const moduleMap = new Map(modules.map(m => [m.id, m]));
    
    // 先按文档分组，再按模块分组
    const groupedByDoc = {};
    sorted.forEach(conv => {
      const docId = conv.docId || 'general';
      if (!groupedByDoc[docId]) {
        groupedByDoc[docId] = [];
      }
      groupedByDoc[docId].push(conv);
    });
    
    // 按模块分组对话（保留原有逻辑用于兼容）
    const groupedByModule = {};
    sorted.forEach(conv => {
      // 如果没有moduleId或者是null/undefined，归类为未分类
      let moduleId = conv.moduleId;
      if (!moduleId || moduleId === 'null' || moduleId === 'undefined') {
        moduleId = 'uncategorized';
      }
      
      if (!groupedByModule[moduleId]) {
        groupedByModule[moduleId] = [];
      }
      groupedByModule[moduleId].push(conv);
    });
    
    // 获取当前模块ID
    const currentModuleId = modulesModule.getCurrentModuleId();
    
    // 渲染分组后的对话
    let html = '';
    
    // 先渲染当前模块的对话
    if (currentModuleId) {
      // 处理未分类模块
      if (currentModuleId === 'uncategorized') {
        const uncategorizedConvs = groupedByModule['uncategorized'] || [];
        html += `
          <div class="mb-3">
            <div class="px-2 text-[10px] font-semibold text-slate-400 mb-1">未分类对话</div>
            ${uncategorizedConvs.length > 0 
              ? uncategorizedConvs.map(conv => renderConversationCard(conv, null)).join('')
              : '<div class="text-xs text-slate-400 px-3 py-2 text-center">暂无对话</div>'
            }
          </div>
        `;
      } else if (groupedByModule[currentModuleId]) {
        const module = moduleMap.get(currentModuleId);
        if (module) {
          const step = modulesModule.moduleState?.groupedModules?.find(s => 
            s.checkpoints.some(cp => cp.id === currentModuleId)
          );
          if (step) {
            html += renderModuleConversations(step, module, groupedByModule[currentModuleId], true);
          }
        }
      }
    }
    
    // 渲染其他模块的对话
    Object.keys(groupedByModule).forEach(moduleId => {
      if (moduleId === currentModuleId) return; // 已渲染
      
      // 跳过未分类，因为它是通过 'general' 或 null 处理的
      if (moduleId === 'uncategorized') return;
      
      const module = moduleMap.get(moduleId);
      if (module) {
        const step = modulesModule.moduleState?.groupedModules?.find(s => 
          s.checkpoints.some(cp => cp.id === moduleId)
        );
        if (step) {
          html += renderModuleConversations(step, module, groupedByModule[moduleId], false);
        }
      }
    });
    
    // 渲染未关联模块的对话（general、null，以及未分类的）
    const unclassifiedKeys = ['general', null, 'uncategorized'];
    const hasUnclassified = unclassifiedKeys.some(key => {
      if (key === null) {
        return groupedByModule[null] || groupedByModule['null'];
      }
      return groupedByModule[key] && (currentModuleId !== key);
    });
    
    if (hasUnclassified) {
      const generalConvs = [];
      unclassifiedKeys.forEach(key => {
        if (key === currentModuleId) return; // 当前模块已渲染
        const convs = groupedByModule[key] || groupedByModule[String(key)] || [];
        generalConvs.push(...convs);
      });
      
      if (generalConvs.length > 0) {
        html += `
          <div class="mb-3">
            <div class="px-2 text-[10px] font-semibold text-slate-400 mb-1">其他对话</div>
            ${generalConvs.map(conv => renderConversationCard(conv, null)).join('')}
          </div>
        `;
      }
    }
    
    container.innerHTML = html || '<div class="text-xs text-slate-400 px-3 py-2 text-center">暂无对话</div>';
    
    // 初始化Lucide图标
    if (window.lucide) {
      lucide.createIcons(container);
    }
    
    return;
  } catch (e) {
    console.warn('按模块分组失败，使用简单列表:', e);
    // 降级到简单列表
  }
  
  // 简单列表渲染（降级方案）
  container.innerHTML = sorted.map((conv, index) => {
    const preview = getConversationPreview(conv);
    const timeStr = formatConversationTime(conv.timestamp);
    const escapedId = escapeJsString(conv.id);
    
    return `
      <div 
        data-conversation-id="${escapeHtml(conv.id)}"
        class="w-full group"
      >
        <button 
          class="w-full flex flex-col items-start gap-1.5 px-3 py-2.5 text-left hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-200 group"
          onclick="loadConversationFromHistory('${escapedId}')"
        >
            <div class="flex items-start justify-between w-full gap-2">
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-slate-800 leading-snug line-clamp-2 mb-1">
                ${escapeHtml(preview)}
              </div>
              <div class="flex items-center gap-1.5 mt-1">
                <i data-lucide="clock" size="10" class="text-slate-400"></i>
                <span class="text-[10px] text-slate-400">${timeStr}</span>
              </div>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0">
              <button 
                onclick="event.stopPropagation(); editConversationTitle('${escapedId}')"
                class="p-1 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded transition-all"
                title="编辑名称"
              >
                <i data-lucide="edit-2" size="12"></i>
              </button>
              <button 
                onclick="event.stopPropagation(); deleteConversation('${escapedId}')"
                class="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                title="删除"
              >
                <i data-lucide="trash-2" size="12"></i>
              </button>
            </div>
          </div>
        </button>
      </div>
    `;
  }).join('');
  
  // 初始化Lucide图标
  if (window.lucide) {
    lucide.createIcons(container);
  }
}

// 渲染模块对话组
function renderModuleConversations(step, module, conversations, isExpanded = false) {
  const stepId = `conv-step-${step.stepNumber}`;
  const isExpandedKey = `conversation-step-${step.stepNumber}-expanded`;
  const savedExpanded = localStorage.getItem(isExpandedKey) === 'true' || isExpanded;
  
  return `
    <div class="mb-3">
      <button 
        onclick="toggleConversationStep('${stepId}')"
        class="w-full px-2 py-1.5 text-left text-[10px] font-semibold text-slate-500 hover:bg-slate-50 rounded flex items-center justify-between"
      >
        <span>第${step.stepNumber}步：${step.stepName} (${conversations.length})</span>
        <i data-lucide="${savedExpanded ? 'chevron-up' : 'chevron-down'}" size="10"></i>
      </button>
      <div id="${stepId}" class="${savedExpanded ? '' : 'hidden'} ml-2 mt-1 space-y-1">
        ${conversations.map(conv => renderConversationCard(conv, module)).join('')}
      </div>
    </div>
  `;
}

// 渲染单个对话卡片
function renderConversationCard(conv, module) {
  const preview = getConversationPreview(conv);
  const timeStr = formatConversationTime(conv.timestamp);
  const escapedId = escapeJsString(conv.id);
  
  // 获取文档信息
  let docInfo = '';
  if (conv.docId) {
    const doc = state.pdfList.find(d => d.id === conv.docId);
    if (doc) {
      docInfo = `<div class="text-[10px] text-indigo-500 mb-1 flex items-center gap-1">
        <i data-lucide="file-text" size="10"></i>
        <span class="truncate">${escapeHtml(doc.title || '未命名文档')}</span>
      </div>`;
    }
  }
  
  const moduleInfo = module ? 
    `<div class="text-[10px] text-slate-400 mb-1">📍 ${module.checkpoint_name}</div>` : '';
  
  return `
    <div 
      data-conversation-id="${escapeHtml(conv.id)}"
      class="w-full group"
    >
      <button 
        class="w-full flex flex-col items-start gap-1 px-2 py-2 text-left hover:bg-slate-50 rounded transition-colors border border-transparent hover:border-slate-200 group"
        onclick="loadConversationFromHistory('${escapedId}')"
      >
        ${docInfo}
        ${moduleInfo}
          <div class="flex items-start justify-between w-full gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-slate-800 leading-snug line-clamp-2 mb-1">
              ${escapeHtml(preview)}
            </div>
            <div class="flex items-center gap-1.5">
              <i data-lucide="clock" size="10" class="text-slate-400"></i>
              <span class="text-[10px] text-slate-400">${timeStr}</span>
            </div>
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0">
            <button 
              onclick="event.stopPropagation(); editConversationTitle('${escapedId}')"
              class="p-1 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded transition-all"
              title="编辑名称"
            >
              <i data-lucide="edit-2" size="12"></i>
            </button>
            <button 
              onclick="event.stopPropagation(); deleteConversation('${escapedId}')"
              class="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-all"
              title="删除"
            >
              <i data-lucide="trash-2" size="12"></i>
            </button>
          </div>
        </div>
      </button>
    </div>
  `;
}

// 切换对话步骤展开/折叠
export function toggleConversationStep(stepId) {
  const element = document.getElementById(stepId);
  if (!element) return;
  
  const isExpanded = !element.classList.contains('hidden');
  const stepNumber = stepId.replace('conv-step-', '');
  localStorage.setItem(`conversation-step-${stepNumber}-expanded`, !isExpanded);
  
  // 更新图标
  const button = element.previousElementSibling;
  const icon = button.querySelector('[data-lucide]');
  if (icon) {
    icon.setAttribute('data-lucide', isExpanded ? 'chevron-down' : 'chevron-up');
  }
  
  element.classList.toggle('hidden');
  
  // 重新初始化图标
  if (window.lucide) {
    lucide.createIcons(button);
  }
}

window.toggleConversationStep = toggleConversationStep;

// 转义JavaScript字符串的函数（用于onclick等属性）
function escapeJsString(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// 获取所有历史对话会话（从所有模块）
export async function getAllConversations() {
  try {
    // 先执行数据迁移
    migrateConversationHistory();
    
    // 获取所有模块的对话
    let allConversations = [];
    const loadedKeys = new Set(); // 记录已加载的键，避免重复
    
    // 检查当前知识库是否是默认知识库（需要加载旧格式对话）
    let isDefaultKnowledgeBase = false;
    try {
      const kbModule = await import('./knowledge-bases.js');
      const currentKb = kbModule.getCurrentKnowledgeBase();
      isDefaultKnowledgeBase = currentKb && currentKb.is_default === 1;
      console.log('当前知识库:', currentKb?.name, '是否默认:', isDefaultKnowledgeBase);
    } catch (e) {
      // 如果知识库模块未加载，假设是默认知识库以保持兼容性
      isDefaultKnowledgeBase = true;
      console.warn('无法获取知识库信息，假设是默认知识库:', e);
    }
    
    // 策略1: 扫描所有localStorage键，查找所有对话数据（最全面的方法）
    const allStorageKeys = Object.keys(localStorage);
    const conversationKeys = allStorageKeys.filter(k => 
      k.startsWith('consultation_conversations') || 
      k.startsWith('consultation_conversations_module_')
    );
    
    console.log('找到所有对话存储键:', conversationKeys);
    
    for (const key of conversationKeys) {
      if (loadedKeys.has(key)) continue;
      
      try {
        const saved = localStorage.getItem(key);
        if (!saved) continue;
        
        const data = JSON.parse(saved);
        if (!data || !data.conversations || !Array.isArray(data.conversations)) continue;
        
        // 从键名提取模块ID
        let moduleId = null;
        if (key === 'consultation_conversations') {
          moduleId = 'uncategorized';
        } else if (key.startsWith('consultation_conversations_module_')) {
          moduleId = key.replace('consultation_conversations_module_', '');
        }
        
        const conversations = data.conversations.map(c => {
          // 确保每个对话都有必要的字段
          const conv = {
            ...c,
            moduleId: c.moduleId || moduleId || 'uncategorized' // 优先使用对话中的moduleId
          };
          
          // 如果没有标题，生成默认标题（向后兼容）
          if (!conv.title && conv.messages && conv.messages.length > 0) {
            let docTitle = null;
            if (conv.docId) {
              const doc = state.pdfList.find(d => d.id === conv.docId);
              if (doc) {
                docTitle = doc.title;
              }
            }
            conv.title = generateDefaultConversationTitle(conv, docTitle);
          }
          
          return conv;
        });
        
        allConversations.push(...conversations);
        loadedKeys.add(key);
        console.log(`从键 ${key} 加载了 ${conversations.length} 个对话`);
      } catch (e) {
        console.warn(`解析键 ${key} 失败:`, e);
      }
    }
    
    // 策略2: 如果当前知识库是默认知识库，确保加载旧格式对话
    if (isDefaultKnowledgeBase && !loadedKeys.has('consultation_conversations')) {
      const oldStorageKey = 'consultation_conversations';
      const saved = localStorage.getItem(oldStorageKey);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          if (data && data.conversations && Array.isArray(data.conversations)) {
            const conversations = (data.conversations || []).map(c => {
              const conv = {
                ...c,
                moduleId: c.moduleId || 'uncategorized'
              };
              
              // 如果没有标题，生成默认标题（向后兼容）
              if (!conv.title && conv.messages && conv.messages.length > 0) {
                let docTitle = null;
                if (conv.docId) {
                  const doc = state.pdfList.find(d => d.id === conv.docId);
                  if (doc) {
                    docTitle = doc.title;
                  }
                }
                conv.title = generateDefaultConversationTitle(conv, docTitle);
              }
              
              return conv;
            });
            allConversations.push(...conversations);
            loadedKeys.add(oldStorageKey);
            console.log(`从旧格式键加载了 ${conversations.length} 个对话`);
          }
        } catch (e) {
          console.warn('解析旧格式对话失败:', e);
        }
      }
    }
    
    // 去重：基于对话ID去重
    const uniqueConversations = [];
    const seenIds = new Set();
    for (const conv of allConversations) {
      if (conv.id && !seenIds.has(conv.id)) {
        seenIds.add(conv.id);
        uniqueConversations.push(conv);
      }
    }
    
    // 返回对话列表（过滤掉没有消息的对话）
    const filtered = uniqueConversations.filter(c => c.messages && c.messages.length > 0);
    console.log('获取历史对话：总共找到', filtered.length, '个有效对话（从', conversationKeys.length, '个存储键）');
    return filtered;
  } catch (error) {
    console.error('获取历史对话失败:', error);
    return [];
  }
}

// 根据文档ID获取该文档的所有对话
export async function getConversationsByDocId(docId) {
  try {
    const allConversations = await getAllConversations();
    // 筛选出指定docId的对话，如果没有docId则返回null的对话（通用对话）
    const filtered = allConversations.filter(c => {
      if (!docId) {
        return !c.docId || c.docId === null;
      }
      return c.docId === docId;
    });
    // 按时间倒序排列
    return filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch (error) {
    console.error('获取文档对话失败:', error);
    return [];
  }
}

// 获取对话预览文本
function getConversationPreview(conversation) {
  if (!conversation || !conversation.messages || conversation.messages.length === 0) {
    return '空对话';
  }
  
  // 如果有自定义标题，优先使用标题
  if (conversation.title) {
    return conversation.title;
  }
  
  // 获取第一条用户消息作为预览
  const firstUserMsg = conversation.messages.find(msg => msg.role === 'user');
  if (firstUserMsg && firstUserMsg.content) {
    // 移除Markdown格式，获取纯文本
    let preview = firstUserMsg.content
      .replace(/\*\*(.+?)\*\*/g, '$1')  // 移除粗体
      .replace(/\*(.+?)\*/g, '$1')      // 移除斜体
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 移除链接
      .replace(/\n/g, ' ')              // 替换换行
      .trim();
    
    // 限制长度
    if (preview.length > 40) {
      preview = preview.substring(0, 40) + '...';
    }
    return preview || '对话';
  }
  
  return '对话';
}

// 生成默认对话标题
function generateDefaultConversationTitle(conversation, docTitle = null) {
  // 如果有关联文档，使用文档标题
  if (docTitle) {
    return `关于 ${docTitle} 的对话`;
  }
  
  // 如果有消息，使用第一条用户消息的前30个字符
  if (conversation.messages && conversation.messages.length > 0) {
    const firstUserMsg = conversation.messages.find(msg => msg.role === 'user');
    if (firstUserMsg && firstUserMsg.content) {
      // 移除Markdown格式，获取纯文本
      let title = firstUserMsg.content
        .replace(/\*\*(.+?)\*\*/g, '$1')  // 移除粗体
        .replace(/\*(.+?)\*/g, '$1')      // 移除斜体
        .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 移除链接
        .replace(/\n/g, ' ')              // 替换换行
        .trim();
      
      // 限制长度
      if (title.length > 30) {
        title = title.substring(0, 30) + '...';
      }
      if (title) {
        return title;
      }
    }
  }
  
  // 默认使用时间格式
  const date = new Date(conversation.timestamp || Date.now());
  return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

// 格式化对话时间
function formatConversationTime(timestamp) {
  if (!timestamp) return '';
  
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) { // 1分钟内
    return '刚刚';
  } else if (diff < 3600000) { // 1小时内
    return `${Math.floor(diff / 60000)}分钟前`;
  } else if (diff < 86400000) { // 24小时内
    return `${Math.floor(diff / 3600000)}小时前`;
  } else if (diff < 604800000) { // 7天内
    return `${Math.floor(diff / 86400000)}天前`;
  } else {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }
}

// 从历史对话加载（优化版本：使用对话ID或索引，支持模块切换）
export async function loadConversationFromHistory(indexOrId) {
  // 先保存当前对话（如果有）
  if (state.currentConversationId && state.history.length > 0) {
    await saveHistory();
  }
  
  // 清除缓存，确保获取最新数据
  invalidateConversationsCache();
  
  // 获取排序后的对话列表（不使用缓存，因为已清除）
  const sorted = await getSortedConversations();
  
  let conversation;
  if (typeof indexOrId === 'string') {
    // 如果传入的是对话ID，直接查找
    conversation = sorted.find(c => c.id === indexOrId);
  } else {
    // 如果传入的是索引，使用索引查找
    if (indexOrId < 0 || indexOrId >= sorted.length) {
      console.error('无效的对话索引:', indexOrId);
      return;
    }
    conversation = sorted[indexOrId];
  }
  
  if (!conversation || !conversation.messages || conversation.messages.length === 0) {
    console.error('对话为空');
    return;
  }
  
  // 如果对话有关联的模块，切换到该模块
  if (conversation.moduleId) {
    try {
      const modulesModule = await import('./modules.js');
      await modulesModule.switchToModule(conversation.moduleId);
    } catch (e) {
      console.warn('切换模块失败:', e);
    }
  }
  
  // 如果对话有关联的文档，自动加载文档
  if (conversation.docId && conversation.docId !== state.currentDocId) {
    try {
      await loadDoc(conversation.docId, false); // 不自动打开面板，保持当前状态
    } catch (e) {
      console.warn('加载关联文档失败:', e);
    }
  }
  
  // 加载对话到当前状态
  // 向后兼容：如果没有分支信息，使用旧格式
  if (conversation.branches && conversation.branches.length > 0) {
    // 有分支：加载分支信息
    state.baseMessages = conversation.baseMessages || [];
    state.branches = conversation.branches || [];
    state.currentBranchId = conversation.currentBranchId || (conversation.branches.length > 0 ? conversation.branches[conversation.branches.length - 1].branchId : null);
    
    // 构建当前显示的消息：baseMessages + 当前分支的消息
    const currentBranch = state.branches.find(b => b.branchId === state.currentBranchId);
    if (currentBranch) {
      state.history = [...state.baseMessages, ...currentBranch.messages];
    } else {
      // 如果没有找到当前分支，使用第一个分支或baseMessages
      state.history = state.baseMessages.length > 0 ? [...state.baseMessages] : conversation.messages;
    }
  } else {
    // 没有分支：使用旧格式，初始化分支结构
    state.baseMessages = [];
    state.branches = [];
    state.currentBranchId = null;
    state.history = conversation.messages || [];
  }
  
  state.currentConversationId = conversation.id;
  
  // 更新存储中的当前对话ID
  try {
    const moduleId = conversation.moduleId || null;
    const storageKey = getConversationsStorageKey(moduleId);
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const data = JSON.parse(saved);
      data.currentConversationId = conversation.id;
      localStorage.setItem(storageKey, JSON.stringify(data));
    }
  } catch (error) {
    console.error('更新当前对话ID失败:', error);
  }
  
  // 清空聊天流并重新渲染
  const container = document.getElementById('chat-stream');
  if (container) {
    container.innerHTML = '';
  }
  
  // 渲染历史消息
  renderHistory();
  
  // 更新聊天状态指示器
  updateChatStatusIndicator();
  
  // 滚动到底部
  scrollToBottom();
}

// 获取排序后的对话列表（带缓存，按模块分组）
async function getSortedConversations() {
  const now = Date.now();
  const cacheMaxAge = 1000; // 缓存1秒
  
  // 如果缓存有效，直接返回
  if (state.sortedConversationsCache && (now - state.conversationsCacheTimestamp) < cacheMaxAge) {
    console.log('获取排序后的对话：使用缓存，', state.sortedConversationsCache.length, '个对话');
    return state.sortedConversationsCache;
  }
  
  // 重新获取并排序
  const conversations = await getAllConversations();
  const sorted = [...conversations].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  
  console.log('获取排序后的对话：重新计算，', sorted.length, '个对话');
  
  // 更新缓存
  state.sortedConversationsCache = sorted;
  state.conversationsCacheTimestamp = now;
  
  return sorted;
}

// 清除对话列表缓存（当对话发生变化时调用）
export function invalidateConversationsCache() {
  state.sortedConversationsCache = null;
  state.conversationsCacheTimestamp = 0;
  console.log('对话缓存已清除');
}

// 编辑对话标题
export async function editConversationTitle(conversationId) {
  // 先清除缓存，确保获取最新数据
  invalidateConversationsCache();
  
  // 获取所有对话
  const allConversations = await getAllConversations();
  const conversation = allConversations.find(c => c.id === conversationId);
  
  if (!conversation) {
    console.warn('编辑对话标题失败：找不到对话', conversationId);
    return;
  }
  
  // 获取当前标题（如果有）
  const currentTitle = conversation.title || '';
  
  // 使用 prompt 让用户输入新标题
  const newTitle = prompt('请输入对话名称：', currentTitle);
  
  // 如果用户取消或标题为空，不进行任何操作
  if (newTitle === null) {
    return; // 用户取消
  }
  
  const trimmedTitle = newTitle.trim();
  if (!trimmedTitle) {
    alert('对话名称不能为空');
    return;
  }
  
  // 在所有存储键中查找并更新对话
  const allStorageKeys = Object.keys(localStorage);
  const conversationKeys = allStorageKeys.filter(k => 
    k.startsWith('consultation_conversations') || 
    k.startsWith('consultation_conversations_module_')
  );
  
  let updated = false;
  for (const key of conversationKeys) {
    try {
      const saved = localStorage.getItem(key);
      if (!saved) continue;
      
      const data = JSON.parse(saved);
      if (!data || !data.conversations || !Array.isArray(data.conversations)) continue;
      
      const conversationIndex = data.conversations.findIndex(c => c.id === conversationId);
      if (conversationIndex >= 0) {
        // 找到对话，更新标题
        data.conversations[conversationIndex].title = trimmedTitle;
        localStorage.setItem(key, JSON.stringify(data));
        updated = true;
        console.log(`已更新对话标题: ${conversationId} -> ${trimmedTitle}`);
        break; // 找到后立即退出
      }
    } catch (e) {
      console.warn(`更新键 ${key} 中的对话标题失败:`, e);
    }
  }
  
  if (updated) {
    // 清除缓存并重新渲染对话列表
    invalidateConversationsCache();
    await renderConversationHistory();
  } else {
    console.warn('更新对话标题失败：在所有存储键中都找不到对话', conversationId);
  }
}

// 删除历史对话（优化版本：使用对话ID）
export async function deleteConversation(indexOrId) {
  if (!confirm('确定要删除这条历史对话吗？')) {
    return;
  }
  
  // 先清除缓存，确保获取最新数据
  invalidateConversationsCache();
  
  // 获取排序后的对话列表（不使用缓存）
  const sorted = await getSortedConversations();
  
  let conversation;
  if (typeof indexOrId === 'string') {
    // 如果传入的是对话ID，直接查找
    conversation = sorted.find(c => c.id === indexOrId);
  } else {
    // 如果传入的是索引，使用索引查找
    if (indexOrId < 0 || indexOrId >= sorted.length) {
      return;
    }
    conversation = sorted[indexOrId];
  }
  
  if (!conversation || !conversation.messages || !conversation.id) {
    console.warn('删除对话失败：找不到对话', indexOrId);
    return;
  }
  
  const conversationId = conversation.id;
  console.log('开始删除对话:', conversationId);
  
  try {
    // 检查是否是当前显示的对话
    const isCurrentConversation = state.currentConversationId === conversationId;
    
    // 扫描所有可能的存储键，从每个键中删除该对话
    const allStorageKeys = Object.keys(localStorage);
    const conversationKeys = allStorageKeys.filter(k => 
      k.startsWith('consultation_conversations') || 
      k.startsWith('consultation_conversations_module_')
    );
    
    console.log('找到所有对话存储键:', conversationKeys);
    
    let deletedFromKeys = [];
    let foundInAnyKey = false;
    
    // 遍历所有存储键，从每个键中删除该对话
    for (const storageKey of conversationKeys) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (!saved) continue;
        
        const data = JSON.parse(saved);
        if (!data || !data.conversations || !Array.isArray(data.conversations)) continue;
        
        const conversationsList = data.conversations || [];
        const originalLength = conversationsList.length;
        
        // 从对话列表中移除该对话
        const updatedConversations = conversationsList.filter(c => c.id !== conversationId);
        
        // 如果找到了对话并删除了
        if (updatedConversations.length < originalLength) {
          foundInAnyKey = true;
          deletedFromKeys.push(storageKey);
          
          // 更新存储
          data.conversations = updatedConversations;
          
          // 如果删除的是当前对话，更新当前对话ID
          if (data.currentConversationId === conversationId) {
            if (updatedConversations.length > 0) {
              const latest = updatedConversations.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
              data.currentConversationId = latest.id;
            } else {
              data.currentConversationId = null;
            }
          }
          
          localStorage.setItem(storageKey, JSON.stringify(data));
          console.log(`从键 ${storageKey} 删除了对话 ${conversationId}`);
        }
      } catch (e) {
        console.warn(`处理存储键 ${storageKey} 时出错:`, e);
      }
    }
    
    if (!foundInAnyKey) {
      console.warn('未在任何存储键中找到要删除的对话:', conversationId);
    } else {
      console.log(`成功从 ${deletedFromKeys.length} 个存储键中删除了对话:`, deletedFromKeys);
    }
    
    // 如果删除的是当前对话，需要创建新对话
    if (isCurrentConversation) {
      state.history = [];
      state.currentConversationId = null;
      
      // 重新获取所有对话，找到最新的作为当前对话
      invalidateConversationsCache();
      const allConversations = await getAllConversations();
      if (allConversations.length > 0) {
        const sorted = [...allConversations].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const latest = sorted[0];
        state.currentConversationId = latest.id;
        state.history = latest.messages || [];
      }
      
      // 清空聊天流并重新加载
      const container = document.getElementById('chat-stream');
      if (container) {
        container.innerHTML = '';
      }
      
      // 如果有其他对话，加载它；否则显示欢迎消息
      if (state.history.length > 0) {
        renderHistory();
      } else {
        // 显示欢迎消息（检查是否有有效的文档信息）
        if (state.currentDocId && state.currentDocInfo && state.currentDocInfo.title) {
          addAiMessage(`您好！我是${state.currentDocInfo.role || '知识助手'}，可以基于《${state.currentDocInfo.title}》为您解答相关问题。请告诉我您的问题。`);
        } else {
          addAiMessage('您好！我是您的知识助手。\n\n我可以帮您解答基于知识库的问题。请告诉我您想了解什么，或者从左侧选择参考文档开始。');
        }
      }
    }
    
    // 清除缓存，因为对话列表已更新
    invalidateConversationsCache();
    
    // 等待一小段时间确保存储已更新，然后更新历史对话列表
    await new Promise(resolve => setTimeout(resolve, 50));
    await renderConversationHistory();
    
    console.log('删除对话完成:', conversationId);
  } catch (error) {
    console.error('删除对话失败:', error);
    // 即使出错也清除缓存并刷新UI
    invalidateConversationsCache();
    await renderConversationHistory();
  }
}

// 解析Markdown
function parseMarkdown(text) {
  if (!text) return '';
  
  // 简单的Markdown解析
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// HTML转义（供内部使用）
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 转义正则表达式特殊字符
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 发送消息
export async function sendMessage() {
  const input = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  // 设置发送中状态
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.classList.add('sending');
    sendButton.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>';
  }
  input.disabled = true;
  
  // 添加用户消息
  addUserMessage(text);
  input.value = '';
  updateSendButtonState();
  autoResizeTextarea();
  
  try {
    // 处理对话
    await handleConversation(text);
  } catch (error) {
    console.error('发送消息失败:', error);
    // 显示错误提示
    const chatStream = document.getElementById('chat-stream');
    if (chatStream) {
      const lastMessage = chatStream.lastElementChild;
      const isError = lastMessage && lastMessage.querySelector('.msg-ai') && 
                     lastMessage.querySelector('.msg-ai').textContent.includes('错误');
      if (!isError) {
        addAiMessage(`❌ **发送失败**：${error.message || '网络错误，请稍后重试'}`);
      }
    }
  } finally {
    // 恢复输入状态
    input.disabled = false;
    if (sendButton) {
      sendButton.classList.remove('sending');
      sendButton.innerHTML = '<i data-lucide="arrow-up" size="20" id="send-icon"></i><span id="send-text" class="hidden">发送</span>';
      if (window.lucide) lucide.createIcons();
    }
    updateSendButtonState();
    focusInput();
  }
}

// 获取历史存储键（基于文档ID）
function getHistoryStorageKey(docId = null) {
  const key = docId || state.currentDocId || 'general';
  return `consultation_history_${key}`;
}

// 获取对话存储键（基于模块ID，如果没有模块则基于文档ID）
function getConversationsStorageKey(moduleId = null) {
  // 优先使用模块ID
  if (moduleId) {
    // 未分类模块使用旧存储键以保持兼容性
    if (moduleId === 'uncategorized') {
      return 'consultation_conversations';
    }
    return `consultation_conversations_module_${moduleId}`;
  }
  
  // 尝试从modules.js获取当前模块ID
  try {
    const { getCurrentModuleId } = require('./modules.js');
    const currentModuleId = getCurrentModuleId();
    if (currentModuleId) {
      if (currentModuleId === 'uncategorized') {
        return 'consultation_conversations';
      }
      return `consultation_conversations_module_${currentModuleId}`;
    }
  } catch (e) {
    // modules.js可能还未加载
  }
  
  // 降级到文档ID或general
  const key = state.currentDocId || 'general';
  return `consultation_conversations_${key}`;
}

// 数据迁移：将旧的平铺数组格式转换为新的对话结构（优化版本：使用标志位避免重复检查）
function migrateConversationHistory(docId = null) {
  // 生成缓存键
  const cacheKey = docId || 'general';
  
  // 如果已经检查过，直接返回
  if (state.migrationChecked.has(cacheKey)) {
    return;
  }
  
  try {
    const oldKey = getHistoryStorageKey(docId);
    const newKey = getConversationsStorageKey(docId);
    
    // 检查是否已经迁移过（快速检查）
    const newData = localStorage.getItem(newKey);
    if (newData) {
      // 标记为已检查，避免重复检查
      state.migrationChecked.add(cacheKey);
      return; // 已经迁移过，不需要再次迁移
    }
    
    // 读取旧数据
    const oldData = localStorage.getItem(oldKey);
    if (!oldData) {
      // 标记为已检查，即使没有旧数据
      state.migrationChecked.add(cacheKey);
      return; // 没有旧数据，不需要迁移
    }
    
    const oldHistory = JSON.parse(oldData);
    if (!Array.isArray(oldHistory) || oldHistory.length === 0) {
      // 标记为已检查
      state.migrationChecked.add(cacheKey);
      return; // 旧数据为空，不需要迁移
    }
    
    // 将旧数据转换为新格式
    // 将所有消息作为一个对话
    const conversationId = Date.now().toString();
    
    // 尝试推断docId：如果提供了docId参数，使用它；否则尝试从消息中推断
    let inferredDocId = docId || null;
    if (!inferredDocId && oldHistory.length > 0) {
      // 尝试从消息中查找文档相关信息（例如引用中的docId）
      for (const msg of oldHistory) {
        if (msg.citations && Array.isArray(msg.citations)) {
          for (const citation of msg.citations) {
            if (citation.docId) {
              inferredDocId = citation.docId;
              break;
            }
          }
        }
        if (inferredDocId) break;
      }
    }
    
    const conversations = [{
      id: conversationId,
      timestamp: Date.now(),
      messages: oldHistory,
      docId: inferredDocId // 添加docId字段
    }];
    
    const newDataObj = {
      conversations: conversations,
      currentConversationId: conversationId
    };
    
    // 保存新格式数据
    localStorage.setItem(newKey, JSON.stringify(newDataObj));
    
    // 标记为已检查
    state.migrationChecked.add(cacheKey);
    
    console.log('对话历史数据迁移完成:', { oldKey, newKey, conversationCount: conversations.length });
  } catch (error) {
    console.error('数据迁移失败:', error);
    // 即使出错也标记为已检查，避免重复尝试
    state.migrationChecked.add(cacheKey);
  }
}

// 加载历史记录
export async function loadHistory() {
  try {
    // 先执行数据迁移
    migrateConversationHistory();
    
    const storageKey = getConversationsStorageKey();
    const saved = localStorage.getItem(storageKey);
    
    if (saved) {
      const data = JSON.parse(saved);
      const conversations = data.conversations || [];
      const currentId = data.currentConversationId || null;
      
      // 如果没有当前对话ID，使用最新的对话
      let targetConversationId = currentId;
      if (!targetConversationId && conversations.length > 0) {
        // 按时间戳排序，使用最新的
        const sorted = [...conversations].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        targetConversationId = sorted[0].id;
      }
      
      // 加载当前对话的消息
      if (targetConversationId) {
        const conversation = conversations.find(c => c.id === targetConversationId);
        if (conversation && conversation.messages) {
          // 向后兼容：如果没有分支信息，使用旧格式
          if (conversation.branches && conversation.branches.length > 0) {
            // 有分支：加载分支信息
            state.baseMessages = conversation.baseMessages || [];
            state.branches = conversation.branches || [];
            state.currentBranchId = conversation.currentBranchId || (conversation.branches.length > 0 ? conversation.branches[conversation.branches.length - 1].branchId : null);
            
            // 构建当前显示的消息：baseMessages + 当前分支的消息
            const currentBranch = state.branches.find(b => b.branchId === state.currentBranchId);
            if (currentBranch) {
              state.history = [...state.baseMessages, ...currentBranch.messages];
            } else {
              state.history = state.baseMessages.length > 0 ? [...state.baseMessages] : conversation.messages;
            }
          } else {
            // 没有分支：使用旧格式，初始化分支结构
            state.baseMessages = [];
            state.branches = [];
            state.currentBranchId = null;
            state.history = conversation.messages || [];
          }
          
          state.currentConversationId = targetConversationId;
          // 重新渲染历史消息
          renderHistory();
        }
      }
    }
    
    // 如果没有找到对话，清空历史
    if (!state.currentConversationId) {
      state.history = [];
      state.currentConversationId = null;
    }
    
    // 无论是否找到当前对话，都要渲染历史对话列表
    await renderConversationHistory();
  } catch (error) {
    console.error('加载历史失败:', error);
    state.history = [];
    state.currentConversationId = null;
    // 即使出错也要渲染历史对话列表（可能显示空状态）
    await renderConversationHistory();
  }
}

// 保存历史记录
async function saveHistory() {
  try {
    // 获取当前模块ID
    let currentModuleId = null;
    try {
      const modulesModule = await import('./modules.js');
      currentModuleId = modulesModule.getCurrentModuleId();
    } catch (e) {
      // modules.js可能还未加载
    }
    
    // 确保有当前对话ID
    if (!state.currentConversationId) {
      // 如果没有当前对话ID，创建一个新对话
      const conversationId = Date.now().toString();
      state.currentConversationId = conversationId;
    }
    
    const storageKey = getConversationsStorageKey(currentModuleId);
    const saved = localStorage.getItem(storageKey);
    
    let data = {
      conversations: [],
      currentConversationId: state.currentConversationId,
      moduleId: currentModuleId // 保存模块ID
    };
    
    if (saved) {
      try {
        data = JSON.parse(saved);
      } catch (e) {
        // 解析失败，使用默认值
      }
    }
    
    // 更新或添加当前对话
    const conversationIndex = data.conversations.findIndex(c => c.id === state.currentConversationId);
    const existingConversation = conversationIndex >= 0 ? data.conversations[conversationIndex] : null;
    
    // 获取文档标题用于生成默认标题
    let docTitle = null;
    if (state.currentDocId) {
      const doc = state.pdfList.find(d => d.id === state.currentDocId);
      if (doc) {
        docTitle = doc.title;
      }
    }
    
    // 如果没有标题，生成默认标题（新对话或没有标题的现有对话）
    let conversationTitle = existingConversation?.title;
    if (!conversationTitle && state.history.length > 0) {
      conversationTitle = generateDefaultConversationTitle(
        { messages: state.history, timestamp: existingConversation?.timestamp || Date.now() },
        docTitle
      );
    }
    
    const conversation = {
      id: state.currentConversationId,
      timestamp: conversationIndex >= 0 ? data.conversations[conversationIndex].timestamp : Date.now(),
      messages: state.history, // 当前显示的消息（从baseMessages + 当前分支消息）
      baseMessages: state.baseMessages || [], // 分支点之前的消息（所有分支共享）
      branches: state.branches || [], // 分支列表
      currentBranchId: state.currentBranchId || null, // 当前显示的分支ID
      moduleId: currentModuleId, // 保存模块ID到对话
      docId: state.currentDocId || null, // 保存文档ID到对话
      title: conversationTitle || null // 保存对话标题
    };
    
    if (conversationIndex >= 0) {
      // 更新现有对话（保留原有标题，如果存在）
      data.conversations[conversationIndex] = conversation;
    } else {
      // 添加新对话
      data.conversations.push(conversation);
    }
    
    // 更新当前对话ID和模块ID
    data.currentConversationId = state.currentConversationId;
    data.moduleId = currentModuleId;
    
    // 保存到localStorage
    localStorage.setItem(storageKey, JSON.stringify(data));
    
    // 清除缓存，因为对话列表已更新
    invalidateConversationsCache();
    
    // 刷新模块统计
    try {
      const modulesModule = await import('./modules.js');
      await modulesModule.refreshModuleStats();
    } catch (e) {
      // 忽略错误
    }
  } catch (error) {
    console.error('保存历史失败:', error);
  }
}

// 渲染历史消息（批量优化版本）
function renderHistory() {
  const container = document.getElementById('chat-stream');
  if (!container || state.history.length === 0) return;
  
  // 确保聊天流区域可见
  const welcomeScreen = document.getElementById('welcome-screen');
  if (welcomeScreen) welcomeScreen.classList.add('hidden');
  if (container) container.classList.remove('hidden');
  
  // 清空容器
  container.innerHTML = '';
  
  // 根据当前文档信息生成badge（只计算一次）
  let badge = { label: '知识助手', class: 'role-triage' };
  if (state.currentDocInfo) {
    const role = state.currentDocInfo.role || '知识助手';
    const category = state.currentDocInfo.category || '通用';
    
    if (category.includes('团队') || category.includes('股权') || category.includes('管理')) {
      badge = { label: role, class: 'role-equity' };
    } else if (category.includes('品牌') || category.includes('营销') || category.includes('推广')) {
      badge = { label: role, class: 'role-brand' };
    } else {
      badge = { label: role, class: 'role-triage' };
    }
  }
  
  // 使用 DocumentFragment 批量构建
  const fragment = document.createDocumentFragment();
  const elementsToBind = []; // 存储需要绑定事件的元素
  
  // 批量生成所有消息的HTML
  state.history.forEach((msg, index) => {
    if (msg.role === 'user') {
      // 用户消息
      const div = document.createElement('div');
      div.className = 'flex justify-end fade-in mb-4';
      
      // 检查是否是分支点（在baseMessages的末尾，或者有分支且索引等于baseMessages长度）
      const isBranchPoint = state.branches && state.branches.length > 0 && 
                           index === state.baseMessages.length;
      
      // 生成分支切换器HTML（如果是分支点）
      const branchSwitcherHtml = isBranchPoint ? renderBranchSwitcher(index) : '';
      
      div.innerHTML = `
        <div class="flex flex-col items-end gap-2">
          ${branchSwitcherHtml}
          <div class="msg-user px-5 py-3 text-[15px] leading-relaxed max-w-xl shadow-md">
            ${escapeHtml(msg.content)}
          </div>
        </div>
      `;
      fragment.appendChild(div);
    } else if (msg.role === 'assistant') {
      // AI消息
      const messageId = `msg-${Date.now()}-${index}`;
      const citations = msg.citations || [];
      const citationsHtml = renderCitations(citations, messageId);
      const contentHtml = parseMarkdown(msg.content);
      
      const div = document.createElement('div');
      div.className = 'flex gap-4 fade-in mb-4 max-w-3xl group';
      div.setAttribute('data-message-id', messageId);
      div.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 shadow-sm mt-1">
          <i data-lucide="bot" size="16" class="text-indigo-600"></i>
        </div>
        <div class="space-y-1 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-800">DeepSeek</span>
            <span class="role-badge ${badge.class}">${badge.label}</span>
          </div>
          ${citationsHtml}
          <div class="msg-ai px-5 py-4 text-[15px] text-slate-600 leading-relaxed">
            ${contentHtml}
          </div>
          ${renderMessageActions(messageId)}
        </div>
      `;
      fragment.appendChild(div);
      elementsToBind.push({ element: div, citations: citations });
    }
  });
  
  // 一次性插入所有消息（只触发一次重排）
  container.appendChild(fragment);
  
  // 批量绑定事件（只在最后执行一次）
  elementsToBind.forEach(({ element, citations }) => {
    // 绑定引用点击事件
    bindCitationClicks(element);
    bindMessageActions(element);
    
    // 绑定引用卡片按钮点击事件
    element.querySelectorAll('.view-citation-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-citation-index'));
        const page = parseInt(btn.getAttribute('data-page'));
        const text = btn.getAttribute('data-text') || '';
        const docId = btn.getAttribute('data-doc-id') || '';
        handleCitationClick(index, page, text, docId);
      });
    });
  });
  
  // 只在最后初始化一次图标（而不是每条消息都初始化）
  if (window.lucide) {
    lucide.createIcons(container);
  }
  
  // 只在最后滚动一次
  scrollToBottom();
}

// 创建新对话
export async function createNewConversation() {
  // 先保存当前对话（如果有）
  if (state.currentConversationId && state.history.length > 0) {
    await saveHistory();
  }
  
  // 创建新对话ID
  const newConversationId = Date.now().toString();
  
  // 清空当前历史
  state.history = [];
  state.baseMessages = [];
  state.branches = [];
  state.currentBranchId = null;
  state.currentConversationId = newConversationId;
  
  // 更新存储中的当前对话ID
  try {
    const storageKey = getConversationsStorageKey();
    const saved = localStorage.getItem(storageKey);
    let data = {
      conversations: [],
      currentConversationId: newConversationId
    };
    
    if (saved) {
      try {
        data = JSON.parse(saved);
      } catch (e) {
        // 解析失败，使用默认值
      }
    }
    
    data.currentConversationId = newConversationId;
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error) {
    console.error('创建新对话失败:', error);
  }
  
  // 清除缓存，因为创建了新对话
  invalidateConversationsCache();
  
  // 清空聊天流
  const container = document.getElementById('chat-stream');
  if (container) {
    container.innerHTML = '';
  }
  
  // 更新历史对话列表
  await renderConversationHistory();
  
  // 显示欢迎消息（检查是否有有效的文档信息）
  if (state.currentDocId && state.currentDocInfo && state.currentDocInfo.title) {
    addAiMessage(`您好！我是${state.currentDocInfo.role || '知识助手'}，可以基于《${state.currentDocInfo.title}》为您解答相关问题。请告诉我您的问题。`);
  } else {
    addAiMessage('您好！我是您的知识助手。\n\n我可以帮您解答基于知识库的问题。请告诉我您想了解什么，或者从左侧选择参考文档开始。');
  }
  
  // 更新聊天状态指示器
  updateChatStatusIndicator();
  
  // 滚动到底部
  scrollToBottom();
  
  // 自动聚焦输入框
  focusInput();
}

// 清除对话（只清除当前对话，保留历史记录）
export async function clearConversation() {
  if (state.history.length === 0) {
    return; // 没有对话，无需清除
  }
  
  if (!confirm('确定要清除当前对话吗？此操作无法撤销，但历史对话记录会保留。')) {
    return;
  }
  
  // 先保存当前对话（如果有消息）
  if (state.currentConversationId && state.history.length > 0) {
    await saveHistory();
  }
  
  // 创建新对话（清空当前对话）
  const newConversationId = Date.now().toString();
  state.history = [];
  state.baseMessages = [];
  state.branches = [];
  state.currentBranchId = null;
  state.currentConversationId = newConversationId;
  
  // 更新存储中的当前对话ID
  try {
    const storageKey = getConversationsStorageKey();
    const saved = localStorage.getItem(storageKey);
    let data = {
      conversations: [],
      currentConversationId: newConversationId
    };
    
    if (saved) {
      try {
        data = JSON.parse(saved);
      } catch (e) {
        // 解析失败，使用默认值
      }
    }
    
    data.currentConversationId = newConversationId;
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error) {
    console.error('清除对话失败:', error);
  }
  
  // 更新历史对话列表
  await renderConversationHistory();
  
  // 清空聊天流
  const container = document.getElementById('chat-stream');
  if (container) {
    container.innerHTML = '';
  }
  
  // 显示欢迎消息（检查是否有有效的文档信息）
  if (state.currentDocId && state.currentDocInfo && state.currentDocInfo.title) {
    try {
      const welcomeResult = await consultationAPI.getWelcomeMessage(state.currentDocId);
      if (welcomeResult.success && welcomeResult.data.welcomeMessage) {
        addAiMessage(welcomeResult.data.welcomeMessage);
      } else {
        addAiMessage(`您好！我是${state.currentDocInfo.role || '知识助手'}，可以基于《${state.currentDocInfo.title}》为您解答相关问题。请告诉我您的问题。`);
      }
    } catch (error) {
      addAiMessage(`您好！我是${state.currentDocInfo.role || '知识助手'}，可以基于《${state.currentDocInfo.title}》为您解答相关问题。请告诉我您的问题。`);
    }
  } else {
    addAiMessage('您好！我是您的知识助手。\n\n我可以帮您解答基于知识库的问题。请告诉我您想了解什么，或者从左侧选择参考文档开始。');
  }
  
  // 滚动到底部
  scrollToBottom();
}

// 输入框处理
function handleInputKeydown(e) {
  // Shift+Enter 换行，Enter 发送
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = e.target.value.trim();
    if (text) {
      sendMessage();
    }
  } else if (e.key === 'Escape') {
    const input = document.getElementById('user-input');
    if (input) {
      input.value = '';
      updateSendButtonState();
    }
  }
}

// 添加快捷键支持（全局）
if (typeof window !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + D 切换文档面板
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      toggleRightPanel();
    }
  });
}

function handleInputChange() {
  updateSendButtonState();
  autoResizeTextarea();
}

function updateSendButtonState() {
  const input = document.getElementById('user-input');
  const sendButton = document.getElementById('send-button');
  const sendIcon = document.getElementById('send-icon');
  const sendText = document.getElementById('send-text');
  
  if (!input || !sendButton) return;
  
  const hasContent = input.value.trim().length > 0;
  const isSending = sendButton.disabled && sendButton.classList.contains('sending');
  
  if (isSending) {
    // 发送中状态保持不变
    return;
  }
  
  if (hasContent) {
    sendButton.disabled = false;
    sendButton.classList.remove('bg-slate-300', 'hover:bg-slate-400');
    sendButton.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
    if (sendIcon) sendIcon.classList.add('hidden');
    if (sendText) sendText.classList.remove('hidden');
  } else {
    sendButton.disabled = true;
    sendButton.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
    sendButton.classList.add('bg-slate-300', 'hover:bg-slate-400');
    if (sendIcon) sendIcon.classList.remove('hidden');
    if (sendText) sendText.classList.add('hidden');
  }
}

function autoResizeTextarea() {
  const input = document.getElementById('user-input');
  if (!input) return;
  
  input.style.height = 'auto';
  const newHeight = Math.min(input.scrollHeight, 128); // 最大4行
  input.style.height = newHeight + 'px';
}

function updatePlaceholder() {
  const input = document.getElementById('user-input');
  if (!input) return;
  
  if (state.currentDocInfo) {
    input.placeholder = `请输入您关于${state.currentDocInfo.theme || '文档内容'}的问题...`;
  } else {
    input.placeholder = '请输入您的问题，我会为您匹配最相关的文档...';
  }
}

// 自动聚焦输入框
function focusInput() {
  const input = document.getElementById('user-input');
  if (input) {
    setTimeout(() => input.focus(), 100);
  }
}

// 更新当前文档提示
function updateCurrentDocHint() {
  const hintEl = document.getElementById('current-doc-hint');
  const nameEl = document.getElementById('current-doc-name');
  
  if (!hintEl || !nameEl) return;
  
  if (state.currentDoc && state.currentDoc.title) {
    hintEl.classList.remove('hidden');
    nameEl.textContent = state.currentDoc.title;
  } else {
    hintEl.classList.add('hidden');
  }
}

// 导出给全局使用
window.startConversation = startConversation;
window.startWithDocument = startWithDocument;
window.sendMessage = sendMessage;
window.toggleRightPanel = toggleRightPanel;
window.locateQuote = locateQuote;
window.handleInputKeydown = handleInputKeydown;
window.handleInputChange = handleInputChange;
window.handleCitationClick = handleCitationClick;
window.handleCitationInAnswerClick = handleCitationInAnswerClick;
window.copyMessage = copyMessage;
window.regenerateMessage = regenerateMessage;
window.createNewConversation = createNewConversation;
window.clearConversation = clearConversation;
window.loadConversationFromHistory = loadConversationFromHistory;
window.deleteConversation = deleteConversation;
window.editConversationTitle = editConversationTitle;
window.setPDFViewerInstance = setPDFViewerInstance;

// 为文档显示模块选择器
async function showModuleSelectorForDoc(docId) {
  try {
    const modulesModule = await import('./modules.js');
    const { moduleState } = modulesModule;
    
    if (!moduleState.groupedModules || moduleState.groupedModules.length === 0) {
      alert('模块数据未加载，请稍候再试');
      return;
    }
    
    // 获取文档信息
    const doc = state.pdfList.find(d => d.id === docId);
    const docTitle = doc ? (doc.title || '未命名文档') : '文档';
    const currentModuleId = doc ? (doc.module_id || null) : null;
    
    // 创建模态对话框
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 max-h-[70vh] overflow-hidden flex flex-col">
        <div class="p-6 border-b border-slate-200">
          <h2 class="text-lg font-bold text-slate-900">调整文档模块</h2>
          <p class="text-sm text-slate-500 mt-1">文档：${escapeHtml(docTitle)}</p>
          <p class="text-xs text-slate-400 mt-1">选择要将文档移动到的模块</p>
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <div class="space-y-2" id="module-selector-list">
            <!-- 模块列表由JS动态渲染 -->
          </div>
        </div>
        <div class="p-4 border-t border-slate-200 flex justify-end">
          <button
            onclick="closeModuleSelectorForDoc()"
            class="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 渲染模块列表
    const listContainer = modal.querySelector('#module-selector-list');
    let html = '';
    
    // 添加未分类选项
    const isUncategorized = currentModuleId === null || currentModuleId === 'uncategorized';
    html += `
      <button
        onclick="selectModuleForDoc('${docId}', null)"
        class="w-full px-3 py-2.5 text-left bg-white border ${isUncategorized ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-slate-300'} rounded-lg hover:bg-slate-50 transition-colors relative"
      >
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-slate-400"></div>
          <span class="text-sm font-medium text-slate-700">未分类</span>
          ${isUncategorized ? '<span class="ml-auto text-xs text-indigo-600 font-medium">当前</span>' : ''}
        </div>
      </button>
    `;
    
    // 确定当前文档所在的步骤（用于默认展开）
    let currentStepNumber = null;
    if (currentModuleId) {
      for (const step of moduleState.groupedModules) {
        if (step.checkpoints.some(cp => cp.id === currentModuleId)) {
          currentStepNumber = step.stepNumber;
          break;
        }
      }
    }
    
    // 添加所有模块选项，按步骤分组（可折叠）
    moduleState.groupedModules.forEach(step => {
      const color = stepColors[step.stepNumber] || stepColors[1];
      const stepId = `module-selector-step-${step.stepNumber}`;
      const isExpanded = step.stepNumber === currentStepNumber; // 默认展开当前步骤
      const hasCurrentCheckpoint = step.checkpoints.some(cp => cp.id === currentModuleId);
      
      // 如果步骤只有一个关卡，直接显示为按钮，不可折叠
      if (step.checkpoints.length === 1) {
        const checkpoint = step.checkpoints[0];
        const isCurrent = currentModuleId === checkpoint.id;
        html += `
          <button
            onclick="selectModuleForDoc('${docId}', '${checkpoint.id}')"
            class="w-full px-3 py-2.5 text-left bg-white border ${isCurrent ? 'border-indigo-500 ring-2 ring-indigo-500' : color.border} rounded-lg hover:bg-slate-50 transition-colors relative"
          >
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full ${color.icon.replace('text-', 'bg-')}"></div>
              <div class="flex-1">
                <div class="text-sm font-medium text-slate-700">
                  第${step.stepNumber}步：${step.stepName}
                </div>
                <div class="text-xs text-slate-500 mt-0.5">
                  ${checkpoint.checkpoint_number}. ${checkpoint.checkpoint_name}
                </div>
              </div>
              ${isCurrent ? '<span class="ml-auto text-xs text-indigo-600 font-medium">当前</span>' : ''}
            </div>
          </button>
        `;
      } else {
        // 多个关卡，使用可折叠的步骤
        // 将 icon 颜色转换为背景色（用于小圆点）
        const iconColorClass = color.icon.replace('text-', 'bg-');
        html += `
          <div class="border ${color.border} rounded-lg overflow-hidden">
            <button
              onclick="toggleModuleSelectorStep('${stepId}')"
              class="w-full px-3 py-2.5 text-left ${color.bg} hover:opacity-80 transition-all flex items-center justify-between"
            >
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full ${iconColorClass}"></div>
                <div>
                  <div class="text-sm font-medium ${color.text}">
                    第${step.stepNumber}步：${step.stepName}
                  </div>
                  <div class="text-xs ${color.text} opacity-70 mt-0.5">
                    ${step.checkpoints.length}个关卡
                  </div>
                </div>
              </div>
              <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" size="16" class="${color.text} transition-transform"></i>
            </button>
            <div id="${stepId}" class="module-step-content ${isExpanded ? 'expanded' : ''} border-t ${color.border} bg-white">
              ${step.checkpoints.map(checkpoint => {
                const isCurrent = currentModuleId === checkpoint.id;
                return `
                  <button
                    onclick="selectModuleForDoc('${docId}', '${checkpoint.id}')"
                    class="w-full px-3 py-2 pl-6 text-left hover:bg-slate-50 transition-colors border-l-2 ${isCurrent ? 'border-indigo-500 bg-indigo-50' : 'border-transparent'} relative"
                  >
                    <div class="flex items-center gap-2">
                      <div class="w-1.5 h-1.5 rounded-full ${iconColorClass}"></div>
                      <div class="flex-1">
                        <div class="text-xs font-medium text-slate-700">
                          ${checkpoint.checkpoint_number}. ${checkpoint.checkpoint_name}
                        </div>
                      </div>
                      ${isCurrent ? '<span class="ml-auto text-xs text-indigo-600 font-medium">当前</span>' : ''}
                    </div>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
    });
    
    listContainer.innerHTML = html;
    
    // 初始化Lucide图标
    if (window.lucide) {
      lucide.createIcons(listContainer);
    }
    
    // 全局函数：切换步骤展开/折叠
    window.toggleModuleSelectorStep = function(stepId) {
      const stepContent = document.getElementById(stepId);
      if (!stepContent) return;
      
      const isExpanded = stepContent.classList.contains('expanded');
      stepContent.classList.toggle('expanded');
      
      // 更新图标
      const button = stepContent.previousElementSibling;
      if (button) {
        const icon = button.querySelector('[data-lucide]');
        if (icon) {
          icon.setAttribute('data-lucide', isExpanded ? 'chevron-right' : 'chevron-down');
          if (window.lucide) {
            lucide.createIcons(icon);
          }
        }
      }
    };
    
    // 全局函数
    window.closeModuleSelectorForDoc = () => {
      document.body.removeChild(modal);
      delete window.closeModuleSelectorForDoc;
      delete window.selectModuleForDoc;
      delete window.toggleModuleSelectorStep;
    };
    
    window.selectModuleForDoc = async (docId, moduleId) => {
      try {
        // 获取文档的原模块ID
        const doc = state.pdfList.find(d => d.id === docId);
        const oldModuleId = doc ? (doc.module_id || null) : null;
        const newModuleId = moduleId || null;
        
        // 如果模块没有变化，直接关闭
        if (oldModuleId === newModuleId || (oldModuleId === null && newModuleId === null)) {
          document.body.removeChild(modal);
          delete window.closeModuleSelectorForDoc;
          delete window.selectModuleForDoc;
          return;
        }
        
        const { itemsAPI } = await import('./api.js');
        await itemsAPI.updateModule(docId, moduleId);
        
        // 更新本地文档数据
        if (doc) {
          doc.module_id = newModuleId;
        }
        
        // 获取当前模块ID
        const modulesModule = await import('./modules.js');
        const consultationModule = await import('./consultation.js');
        const currentModuleId = modulesModule.moduleState.currentModuleId || 'uncategorized';
        
        // 如果文档从当前模块移出，需要从列表中移除
        const wasInCurrentModule = (oldModuleId === currentModuleId) || 
                                   (oldModuleId === null && currentModuleId === 'uncategorized');
        
        // 如果文档移入当前模块，需要添加到列表
        const movedToCurrentModule = (newModuleId === currentModuleId) || 
                                     (newModuleId === null && currentModuleId === 'uncategorized');
        
        // 刷新当前模块的文档列表
        await consultationModule.loadModuleDocuments(currentModuleId);
        
        // 如果原模块或新模块不是当前模块，也需要刷新它们的文档列表（在模块导航中）
        // 处理未分类模块
        if ((oldModuleId === null || oldModuleId === 'uncategorized') && currentModuleId !== 'uncategorized') {
          const uncategorizedContent = document.getElementById('uncategorized-content');
          if (uncategorizedContent && !uncategorizedContent.classList.contains('hidden')) {
            // 重新加载未分类内容
            try {
              const docsResponse = await fetch(`/api/modules/uncategorized/documents`);
              const docsResult = await docsResponse.json();
              const documents = docsResult.success ? (docsResult.data || []) : [];
              const documentsContainer = document.getElementById('uncategorized-documents');
              if (documentsContainer) {
                if (documents.length === 0) {
                  documentsContainer.innerHTML = '';
                } else {
                  const docsToShow = documents.slice(0, 5);
                  documentsContainer.innerHTML = `
                    <div class="text-[10px] font-semibold text-slate-500 mb-1.5 px-1">📄 文档 (${documents.length})</div>
                    ${docsToShow.map(doc => {
                      const title = escapeHtml(doc.title || '未命名文档');
                      return `
                        <div class="flex items-center gap-1 group">
                          <button
                            onclick="loadDocFromCheckpoint('${doc.id}')"
                            class="flex-1 text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-white hover:border-indigo-200 border border-transparent rounded transition-colors group"
                          >
                            <div class="flex items-center gap-2">
                              <i data-lucide="file-text" size="12" class="text-slate-400 group-hover:text-indigo-600 flex-shrink-0"></i>
                              <span class="truncate flex-1">${title}</span>
                            </div>
                          </button>
                          <button
                            onclick="event.stopPropagation(); showModuleSelectorForDoc('${doc.id}')"
                            class="px-2 py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                            title="调整模块"
                          >
                            <i data-lucide="move" size="10"></i>
                            <span>调整</span>
                          </button>
                        </div>
                      `;
                    }).join('')}
                    ${documents.length > 5 ? `<div class="text-[10px] text-slate-400 text-center px-2 py-1">还有 ${documents.length - 5} 个文档...</div>` : ''}
                  `;
                  if (window.lucide) {
                    lucide.createIcons(documentsContainer);
                  }
                }
              }
            } catch (e) {
              console.warn('刷新未分类模块文档列表失败:', e);
            }
          }
        }
        
        if ((newModuleId === null || newModuleId === 'uncategorized') && currentModuleId !== 'uncategorized') {
          const uncategorizedContent = document.getElementById('uncategorized-content');
          if (uncategorizedContent && !uncategorizedContent.classList.contains('hidden')) {
            // 重新加载未分类内容
            try {
              const docsResponse = await fetch(`/api/modules/uncategorized/documents`);
              const docsResult = await docsResponse.json();
              const documents = docsResult.success ? (docsResult.data || []) : [];
              const documentsContainer = document.getElementById('uncategorized-documents');
              if (documentsContainer) {
                const docsToShow = documents.slice(0, 5);
                documentsContainer.innerHTML = `
                  <div class="text-[10px] font-semibold text-slate-500 mb-1.5 px-1">📄 文档 (${documents.length})</div>
                  ${docsToShow.map(doc => {
                    const title = escapeHtml(doc.title || '未命名文档');
                    return `
                      <div class="flex items-center gap-1 group">
                        <button
                          onclick="loadDocFromCheckpoint('${doc.id}')"
                          class="flex-1 text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-white hover:border-indigo-200 border border-transparent rounded transition-colors group"
                        >
                          <div class="flex items-center gap-2">
                            <i data-lucide="file-text" size="12" class="text-slate-400 group-hover:text-indigo-600 flex-shrink-0"></i>
                            <span class="truncate flex-1">${title}</span>
                          </div>
                        </button>
                          <button
                            onclick="event.stopPropagation(); showModuleSelectorForDoc('${doc.id}')"
                            class="px-2 py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                            title="调整模块"
                          >
                            <i data-lucide="move" size="10"></i>
                            <span>调整</span>
                          </button>
                        </div>
                      `;
                    }).join('')}
                    ${documents.length > 5 ? `<div class="text-[10px] text-slate-400 text-center px-2 py-1">还有 ${documents.length - 5} 个文档...</div>` : ''}
                `;
                if (window.lucide) {
                  lucide.createIcons(documentsContainer);
                }
              }
            } catch (e) {
              console.warn('刷新未分类模块文档列表失败:', e);
            }
          }
        }
        
        // 通过触发模块切换事件来刷新（如果模块已展开）
        if (oldModuleId && oldModuleId !== currentModuleId && oldModuleId !== 'uncategorized') {
          const oldModuleContent = document.getElementById(`checkpoint-${oldModuleId}-content`);
          if (oldModuleContent && !oldModuleContent.classList.contains('hidden')) {
            // 重新加载该模块的内容
            try {
              const docsResponse = await fetch(`/api/modules/${oldModuleId}/documents`);
              const docsResult = await docsResponse.json();
              const documents = docsResult.success ? (docsResult.data || []) : [];
              // 直接更新DOM（简化处理）
              const documentsContainer = document.getElementById(`checkpoint-${oldModuleId}-documents`);
              if (documentsContainer && documents.length === 0) {
                documentsContainer.innerHTML = '';
              } else if (documentsContainer && documents.length > 0) {
                // 重新渲染（使用简化的方式）
                const docsToShow = documents.slice(0, 5);
                documentsContainer.innerHTML = `
                  <div class="text-[10px] font-semibold text-slate-500 mb-1.5 px-1">📄 文档 (${documents.length})</div>
                  ${docsToShow.map(doc => {
                    const title = escapeHtml(doc.title || '未命名文档');
                    return `
                      <div class="flex items-center gap-1 group">
                        <button
                          onclick="loadDocFromCheckpoint('${doc.id}')"
                          class="flex-1 text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-white hover:border-indigo-200 border border-transparent rounded transition-colors group"
                        >
                          <div class="flex items-center gap-2">
                            <i data-lucide="file-text" size="12" class="text-slate-400 group-hover:text-indigo-600 flex-shrink-0"></i>
                            <span class="truncate flex-1">${title}</span>
                          </div>
                        </button>
                        <button
                          onclick="event.stopPropagation(); showModuleSelectorForDoc('${doc.id}')"
                          class="px-2 py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                          title="调整模块"
                        >
                          <i data-lucide="move" size="10"></i>
                          <span>调整</span>
                        </button>
                      </div>
                    `;
                  }).join('')}
                  ${documents.length > 5 ? `<div class="text-[10px] text-slate-400 text-center px-2 py-1">还有 ${documents.length - 5} 个文档...</div>` : ''}
                `;
                if (window.lucide) {
                  lucide.createIcons(documentsContainer);
                }
              }
            } catch (e) {
              console.warn('刷新原模块文档列表失败:', e);
            }
          }
        }
        
        if (newModuleId && newModuleId !== currentModuleId) {
          const newModuleContent = document.getElementById(`checkpoint-${newModuleId}-content`);
          if (newModuleContent && !newModuleContent.classList.contains('hidden')) {
            // 重新加载该模块的内容
            try {
              const docsResponse = await fetch(`/api/modules/${newModuleId}/documents`);
              const docsResult = await docsResponse.json();
              const documents = docsResult.success ? (docsResult.data || []) : [];
              // 直接更新DOM
              const documentsContainer = document.getElementById(`checkpoint-${newModuleId}-documents`);
              if (documentsContainer) {
                const docsToShow = documents.slice(0, 5);
                documentsContainer.innerHTML = `
                  <div class="text-[10px] font-semibold text-slate-500 mb-1.5 px-1">📄 文档 (${documents.length})</div>
                  ${docsToShow.map(doc => {
                    const title = escapeHtml(doc.title || '未命名文档');
                    return `
                      <div class="flex items-center gap-1 group">
                        <button
                          onclick="loadDocFromCheckpoint('${doc.id}')"
                          class="flex-1 text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-white hover:border-indigo-200 border border-transparent rounded transition-colors group"
                        >
                          <div class="flex items-center gap-2">
                            <i data-lucide="file-text" size="12" class="text-slate-400 group-hover:text-indigo-600 flex-shrink-0"></i>
                            <span class="truncate flex-1">${title}</span>
                          </div>
                        </button>
                        <button
                          onclick="event.stopPropagation(); showModuleSelectorForDoc('${doc.id}')"
                          class="px-2 py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                          title="调整模块"
                        >
                          <i data-lucide="move" size="10"></i>
                          <span>调整</span>
                        </button>
                      </div>
                    `;
                  }).join('')}
                  ${documents.length > 5 ? `<div class="text-[10px] text-slate-400 text-center px-2 py-1">还有 ${documents.length - 5} 个文档...</div>` : ''}
                `;
                if (window.lucide) {
                  lucide.createIcons(documentsContainer);
                }
              }
            } catch (e) {
              console.warn('刷新新模块文档列表失败:', e);
            }
          }
        }
        
        // 刷新模块统计信息
        await modulesModule.refreshModuleStats();
        
        // 刷新文档列表（显示新的模块标签）
        await consultationModule.renderPDFList();
        
        // 关闭模态框
        document.body.removeChild(modal);
        delete window.closeModuleSelectorForDoc;
        delete window.selectModuleForDoc;
        
        // 显示成功提示
        const moduleName = newModuleId 
          ? (() => {
              for (const step of modulesModule.moduleState.groupedModules || []) {
                const checkpoint = step.checkpoints.find(cp => cp.id === newModuleId);
                if (checkpoint) {
                  return `第${step.stepNumber}步：${checkpoint.checkpoint_name}`;
                }
              }
              return '模块';
            })()
          : '未分类';
        
        if (window.showToast) {
          window.showToast(`文档已移动到${moduleName}`, 'success');
        } else {
          alert(`文档已移动到${moduleName}`);
        }
      } catch (error) {
        console.error('更新文档模块失败:', error);
        alert('更新失败: ' + (error.message || '未知错误'));
      }
    };
    
    // 点击背景关闭
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        window.closeModuleSelectorForDoc();
      }
    });
  } catch (error) {
    console.error('显示模块选择器失败:', error);
    alert('加载模块选择器失败');
  }
}

// 步骤颜色映射（从modules.js复制）
const stepColors = {
  1: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-600' },
  2: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: 'text-green-600' },
  3: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'text-purple-600' },
  4: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: 'text-orange-600' },
  5: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'text-red-600' },
  6: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', icon: 'text-cyan-600' }
};

window.showModuleSelectorForDoc = showModuleSelectorForDoc;

// 显示文档右键菜单
window.showDocContextMenu = function(event, docId) {
  event.preventDefault();
  event.stopPropagation();
  
  // 移除已存在的菜单
  const existingMenu = document.getElementById('doc-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
  
  // 创建菜单
  const menu = document.createElement('div');
  menu.id = 'doc-context-menu';
  menu.className = 'fixed bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50 min-w-[160px]';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  
  menu.innerHTML = `
    <button
      onclick="showModuleSelectorForDoc('${docId}'); document.getElementById('doc-context-menu')?.remove();"
      class="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
    >
      <i data-lucide="move" size="14"></i>
      <span>调整模块</span>
    </button>
  `;
  
  document.body.appendChild(menu);
  
  // 初始化图标
  if (window.lucide) {
    lucide.createIcons(menu);
  }
  
  // 点击外部关闭菜单
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 10);
};

// 更新评估快速开关的图标状态
function updateEvaluationQuickToggle() {
  const toggleButtons = document.querySelectorAll('#toggle-evaluation-quick');
  const iconElements = document.querySelectorAll('#evaluation-icon');
  const labelElements = document.querySelectorAll('#evaluation-label');
  
  if (toggleButtons.length === 0 || iconElements.length === 0) return;
  
  const sessionValue = localStorage.getItem('knowledge_relevance_evaluation_enabled');
  const isEnabled = sessionValue === null || sessionValue === 'true'; // 默认启用
  
  // 更新所有按钮、图标和标签
  toggleButtons.forEach((toggleBtn, index) => {
    const iconEl = iconElements[index] || iconElements[0]; // 如果索引不匹配，使用第一个图标
    const labelEl = labelElements[index] || labelElements[0]; // 标签元素
    
    if (isEnabled) {
      // 开启状态：使用激活样式和图标
      toggleBtn.classList.remove('text-slate-600', 'bg-white', 'border-slate-200');
      toggleBtn.classList.add('text-indigo-600', 'bg-indigo-50', 'border-indigo-200');
      if (iconEl) iconEl.setAttribute('data-lucide', 'bar-chart-2');
      if (labelEl) labelEl.textContent = '评估';
      toggleBtn.title = '相关性评估已开启：点击关闭';
    } else {
      // 关闭状态：使用非激活样式和图标
      toggleBtn.classList.remove('text-indigo-600', 'bg-indigo-50', 'border-indigo-200');
      toggleBtn.classList.add('text-slate-600', 'bg-white', 'border-slate-200');
      if (iconEl) iconEl.setAttribute('data-lucide', 'bar-chart');
      if (labelEl) labelEl.textContent = '评估';
      toggleBtn.title = '相关性评估已关闭：点击开启';
    }
    
    if (window.lucide && iconEl) {
      lucide.createIcons(iconEl);
    }
  });
}

