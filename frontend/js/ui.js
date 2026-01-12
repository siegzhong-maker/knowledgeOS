import { itemsAPI, parseAPI, aiAPI, settingsAPI, tagsAPI, exportAPI, clearAPICache } from './api.js';
import { storage } from './storage.js';
import { formatTime, truncate, isURL, debounce, throttle, loadPDFJS } from './utils.js';
import { showToast, showLoadingToast } from './toast.js';
import { showConfirm, showAlert, showPrompt } from './dialog.js';

// 配置 Marked.js
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true,  // 支持 GitHub 风格的换行
    gfm: true,     // 支持 GitHub Flavored Markdown
  });
}

// Markdown 解析函数
function parseMarkdown(markdown) {
  if (!markdown) return '';
  
  if (typeof marked !== 'undefined') {
    try {
      return marked.parse(markdown);
    } catch (error) {
      console.error('Markdown 解析失败:', error);
      // 降级到简单处理
      return escapeHtml(markdown).replace(/\n/g, '<br>');
    }
  }
  
  // 降级方案：简单处理基本 Markdown 语法
  return escapeHtml(markdown)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

// HTML 转义函数（用于降级方案）
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 去除 Markdown 格式，返回纯文本（用于卡片预览）
function stripMarkdown(text) {
  if (!text) return '';
  // 移除 Markdown 格式标记
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // 粗体
    .replace(/\*(.+?)\*/g, '$1')      // 斜体
    .replace(/`(.+?)`/g, '$1')         // 行内代码
    .replace(/#{1,6}\s+(.+)/g, '$1')   // 标题
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 链接
    .replace(/!\[(.+?)\]\(.+?\)/g, '$1') // 图片
    .replace(/\n{3,}/g, '\n\n')        // 多个换行合并为两个
    .replace(/\s+/g, ' ')              // 多个空格合并为一个
    .trim();
}

// 状态
let allItems = [];
let archivedItems = [];
let currentFilter = 'all';
let currentView = 'dashboard';
let currentStatusFilter = 'all'; // 用于文档库页面的状态筛选
let currentItem = null;
let repoSortBy = 'created_at'; // 文档库排序字段：title, created_at, page_count
let repoSortOrder = 'desc'; // 排序方向：asc, desc
let archiveSortBy = 'updated_at'; // 归档排序字段：title, updated_at, page_count
let archiveSortOrder = 'desc'; // 排序方向：asc, desc
let apiConfigured = false;
let globalSearchTerm = '';
let stats = null;
let repoTotalCount = 0; // 文档库总数量
let repoLoadedCount = 0; // 文档库已加载数量
let repoCurrentPage = 1; // 文档库当前页码
let archiveTotalCount = 0; // 归档总数量
let archiveLoadedCount = 0; // 归档已加载数量
let archiveCurrentPage = 1; // 归档当前页码
let repoLoading = false; // 文档库首屏加载状态

// 批量渲染优化：使用requestAnimationFrame合并多个渲染调用
let renderScheduled = false;
let renderQueue = {
  cards: false,
  repoList: false,
  tagsCloud: false,
  archiveList: false
};

function scheduleRender(types) {
  if (typeof types === 'string') {
    types = [types];
  }
  types.forEach(type => {
    renderQueue[type] = true;
  });
  
  if (!renderScheduled) {
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      const queue = { ...renderQueue };
      // 重置队列
      Object.keys(renderQueue).forEach(key => renderQueue[key] = false);
      
      // 批量执行渲染
      if (queue.cards) renderCards();
      if (queue.repoList) renderRepoList();
      if (queue.tagsCloud) renderTagsCloud();
      if (queue.archiveList) renderArchiveList();
    });
  }
}

// 元素获取
const $ = (id) => document.getElementById(id);

// 已删除：顶部搜索栏
// const elQuickInput = $('quick-input');
// const elGlobalSearch = $('global-search');
const elCardGrid = $('card-grid');
const elDashboardSkeleton = $('dashboard-skeleton');
const elDashboardGreeting = $('dashboard-greeting');
const elRepoList = $('repo-list');
const elDashboardSubtitle = $('dashboard-subtitle');
const elApiPill = $('api-pill');
const elApiStatusText = $('api-status-text');
const elSidebar = $('sidebar');
const elSidebarOverlay = $('sidebar-overlay');
const elMobileMenuBtn = $('btn-mobile-menu');
const elSettingsModal = $('settings-modal');
const elSettingsContent = $('settings-content');
const elBtnOpenSettings = $('btn-open-settings');
const elBtnCloseSettings = $('btn-close-settings');
const elInputApiKey = $('input-api-key');
const elSelectModel = $('select-model');
const elToggleEvaluation = $('toggle-evaluation');
const elBtnToggleApiKey = $('btn-toggle-api-key');
const elBtnSaveSettings = $('btn-save-settings');
const elBtnTestApi = $('btn-test-api');
const elSettingsMessage = $('settings-message');
const elBtnExportJSON = $('btn-export-json');
const elBtnExportMD = $('btn-export-md');
const elBtnRefresh = $('btn-refresh');
const elFilterContainer = $('filter-container');
const elViewConsultation = $('view-consultation');
const elViewDashboard = $('view-dashboard');
const elViewRepository = $('view-repository');
const elViewArchive = $('view-archive');
const elViewTags = $('view-tags');
const elViewKnowledgeItems = $('view-knowledge-items');
const elViewDetail = $('view-detail');
const elArchiveList = $('archive-list');
const elArchiveSearchInput = $('archive-search-input');
const elDetailContent = $('detail-content-container');
const elChatHistory = $('chat-history');
const elChatInput = $('chat-input');
const elBtnSendChat = $('btn-send-chat');
const elBtnGenerateSummary = $('btn-generate-summary');
const elBtnCloseDetail = $('btn-close-detail');
const elRepoSearchInput = $('repo-search-input');
const elTagsContainer = $('tags-container');
const elGuideModal = $('guide-modal');
const elGuideContent = $('guide-content');
const elBtnOpenGuide = $('btn-open-guide');
const elBtnCloseGuide = $('btn-close-guide');
const elBtnCloseGuideFooter = $('btn-close-guide-footer');
const elBtnGuideOpenSettings = $('btn-guide-open-settings');
// Toast系统已统一到 toast.js，不再需要本地容器引用
// const elToastContainer = $('toast-container');

// PDF预览器状态
let pdfViewerState = {
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  scale: 1.0,
  renderTask: null,  // 当前的渲染任务
  isRendering: false  // 是否正在渲染
};

// 当前选中的行ID
let selectedRowId = null;

// Toast系统已统一到 toast.js，已在文件顶部导入

// 视图切换
function switchView(view) {
  currentView = view;
  // 保存当前视图到 localStorage
  storage.set('lastView', view);
  
  [elViewConsultation, elViewDashboard, elViewRepository, elViewArchive, elViewTags, elViewKnowledgeItems].forEach((el) => {
    if (!el) return;
    el.classList.add('hidden');
  });

  // 已删除：全局搜索框显示/隐藏逻辑

  if (view === 'consultation' && elViewConsultation) {
    // 先显示 loading overlay，避免视图显示时的闪烁
    const overlay = document.getElementById('consultation-loading-overlay');
    if (overlay) {
      overlay.classList.remove('hidden');
    }
    
    // 使用 requestAnimationFrame 确保 overlay 先显示，然后再显示视图
    requestAnimationFrame(() => {
      elViewConsultation.classList.remove('hidden');
      // 初始化Lucide图标（性能优化：只在咨询视图容器内初始化）
      if (typeof lucide !== 'undefined') {
        lucide.createIcons(elViewConsultation);
      }
      // 初始化咨询工作台
      import('./consultation.js').then(({ initConsultation, loadHistory }) => {
        initConsultation();
        loadHistory();
      });
    });
    import('./context.js').then(({ loadContext, formatContextLabel }) => {
      loadContext().then(() => {
        const labelEl = document.getElementById('context-label-text');
        if (labelEl) {
          const labelText = formatContextLabel();
          labelEl.textContent = labelText || '未设置';
        }
        // 重新初始化图标（性能优化：只在context相关元素内初始化）
        if (typeof lucide !== 'undefined' && labelEl) {
          lucide.createIcons(labelEl.closest('[id^="view-"], [id^="context"]') || elViewConsultation);
        }
      });
    });
  }
  if (view === 'dashboard') {
    elViewDashboard.classList.remove('hidden');
    // 更新问候语
    updateGreeting();
    // 如果数据为空，显示骨架屏
    if (allItems.length === 0) {
      if (elDashboardSkeleton) {
        renderSkeleton();
        elDashboardSkeleton.classList.remove('hidden');
      }
      if (elCardGrid) {
        elCardGrid.classList.add('hidden');
        elCardGrid.classList.remove('fade-in');
      }
    }
    // 切换到工作台时重新加载数据
    loadItems();
  }
  if (view === 'repository') {
    elViewRepository.classList.remove('hidden');
    // 切换到知识库时重新加载数据
    loadItems();
    setTimeout(() => updateSortIcons('repo'), 100);
  }
  if (view === 'archive') {
    elViewArchive.classList.remove('hidden');
    loadArchivedItems();
    setTimeout(() => updateSortIcons('archive'), 100);
  }
  if (view === 'tags') elViewTags.classList.remove('hidden');
  if (view === 'knowledge-items' && elViewKnowledgeItems) {
    elViewKnowledgeItems.classList.remove('hidden');
    // 初始化Lucide图标（文档库视图需要）
    if (typeof lucide !== 'undefined') {
      lucide.createIcons(elViewKnowledgeItems);
    }
    // 初始化知识库视图
    import('./knowledge-items.js').then(({ initKnowledgeView, handleSearch }) => {
      initKnowledgeView();
      
      // 注意：筛选按钮的事件绑定已在 initKnowledgeView() 内部的 initFilterButtons() 中处理
      // 这里不再重复绑定，避免事件监听器累积导致重复触发
      
      // 搜索框的事件绑定（如果 initKnowledgeView 中没有处理，需要在这里绑定）
      // 但根据代码，搜索框应该在 initKnowledgeView() 的 initSearch() 中已处理，这里也不重复绑定
      
      // 暴露刷新函数
      window.refreshKnowledgeList = () => {
        initKnowledgeView();
      };
    });
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.remove('bg-slate-800', 'text-white');
    btn.classList.add('text-slate-300');
    if (btn.dataset.view === view) {
      btn.classList.add('bg-slate-800', 'text-white');
      btn.classList.remove('text-slate-300');
    }
  });
  
  // 确保侧边栏图标已初始化（特别是知识库的 Lucide 图标）
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    try {
      // 初始化侧边栏中的图标
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        lucide.createIcons(sidebar);
      }
    } catch (e) {
      console.warn('视图切换时初始化侧边栏图标失败:', e);
    }
  }
}

// 暴露switchView到全局作用域（供HTML内联事件使用）
window.switchView = switchView;

// Sidebar 移动端
function toggleSidebar(open) {
  const show = open ?? elSidebar.classList.contains('-translate-x-full');
  if (show) {
    elSidebar.classList.remove('-translate-x-full');
    elSidebarOverlay.classList.remove('hidden');
  } else {
    elSidebar.classList.add('-translate-x-full');
    elSidebarOverlay.classList.add('hidden');
  }
}

// 过滤
function setFilter(filter) {
  currentFilter = filter;
  currentTagFilter = null; // 清除标签筛选
  globalSearchTerm = ''; // 清除搜索
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.remove('bg-slate-800', 'text-white');
    btn.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-200');
    if (btn.dataset.filter === filter) {
      btn.classList.add('bg-slate-800', 'text-white');
      btn.classList.remove('bg-white', 'text-slate-600', 'border', 'border-slate-200');
    }
  });
  scheduleRender(['cards', 'repoList']);
}

// 获取时间相关的问候语
function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 12) {
    return { text: '早安, 探索者', emoji: '☀️' };
  } else if (hour >= 12 && hour < 14) {
    return { text: '午安, 探索者', emoji: '🌤️' };
  } else if (hour >= 14 && hour < 18) {
    return { text: '下午好, 探索者', emoji: '☁️' };
  } else if (hour >= 18 && hour < 22) {
    return { text: '晚上好, 探索者', emoji: '🌙' };
  } else {
    return { text: '夜深了, 探索者', emoji: '✨' };
  }
}

// 更新问候语
function updateGreeting() {
  if (elDashboardGreeting) {
    const greeting = getTimeBasedGreeting();
    elDashboardGreeting.textContent = `${greeting.text} ${greeting.emoji}`;
  }
}

// 渲染卡片
// 渲染骨架屏
function renderSkeleton() {
  if (!elDashboardSkeleton) return;
  
  // 根据响应式网格，渲染 8 个骨架卡片（2行，每行4个）
  const skeletonCount = 8;
  const skeletonCards = Array(skeletonCount).fill(0).map(() => `
    <article 
      class="skeleton-card bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col"
      style="min-height: 280px;"
    >
      <div class="p-5 flex flex-col flex-1 min-h-0">
        <div class="flex items-center justify-between mb-3 flex-shrink-0">
          <div class="flex items-center gap-2">
            <div class="skeleton-line w-12 h-4"></div>
            <div class="skeleton-line w-20 h-4"></div>
          </div>
          <div class="skeleton-line w-16 h-4"></div>
        </div>
        <div class="mb-2 flex-shrink-0">
          <div class="skeleton-line w-full h-5 mb-2"></div>
          <div class="skeleton-line w-3/4 h-5"></div>
        </div>
        <div class="mb-3 flex-1 min-h-0">
          <div class="skeleton-line w-full h-3 mb-2"></div>
          <div class="skeleton-line w-full h-3 mb-2"></div>
          <div class="skeleton-line w-2/3 h-3"></div>
        </div>
        <div class="flex justify-between items-center mt-auto pt-2 border-t border-slate-100 flex-shrink-0 gap-2">
          <div class="flex flex-wrap gap-1 flex-1 min-w-0">
            <div class="skeleton-line w-12 h-5 rounded-full"></div>
            <div class="skeleton-line w-14 h-5 rounded-full"></div>
          </div>
          <div class="skeleton-line w-16 h-4 flex-shrink-0"></div>
        </div>
      </div>
    </article>
  `).join('');
  
  elDashboardSkeleton.innerHTML = skeletonCards;
}

function renderCards() {
  const perfMonitor = window.performanceMonitor;
  const timer = perfMonitor ? perfMonitor.start('render-cards') : null;
  
  // 目前所有内容都视为「文本」，不再按照类型区分
  let data = allItems;
  
  // 如果有标签筛选，应用筛选
  if (currentTagFilter) {
    data = data.filter((item) => (item.tags || []).includes(currentTagFilter));
  }
  
  // 如果有全局搜索，应用搜索
  if (globalSearchTerm) {
    const searchLower = globalSearchTerm.toLowerCase();
    data = data.filter((item) => {
      const title = (item.title || '').toLowerCase();
      const content = (item.raw_content || '').toLowerCase();
      const summary = (item.summary_ai || '').toLowerCase();
      const tags = (item.tags || []).join(' ').toLowerCase();
      return title.includes(searchLower) || 
             content.includes(searchLower) || 
             summary.includes(searchLower) ||
             tags.includes(searchLower);
    });
  }

  if (data.length === 0) {
    let emptyMessage = '暂无内容，试着在上方输入框粘贴URL或文本';
    if (globalSearchTerm) {
      emptyMessage = `没有找到包含 "${globalSearchTerm}" 的内容`;
    } else if (currentTagFilter) {
      emptyMessage = `没有找到标签为 "#${currentTagFilter}" 的内容`;
    }
    elCardGrid.innerHTML = `
      <div class="col-span-full text-center py-16">
        <i class="fa-solid fa-inbox text-5xl text-slate-300 mb-4"></i>
        <p class="text-slate-400 text-sm">${emptyMessage}</p>
        ${globalSearchTerm || currentTagFilter ? `
          <button 
            onclick="window.clearFilters && window.clearFilters()"
            class="mt-4 px-4 py-2 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            清除筛选
          </button>
        ` : ''}
      </div>
    `;
    return;
  }

  elCardGrid.innerHTML = data
    .map((item) => {
      // 现在统一为「文本」类型，不再区分文章 / Memo
      const typeLabel = '文本';
      const badge =
        '<span class="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-700 border border-slate-200">TEXT</span>';
      const summary = item.summary_ai || item.raw_content || '';

      return `
      <article 
        class="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-pointer overflow-hidden flex flex-col"
        data-id="${item.id}"
        style="min-height: 280px;"
      >
        <div class="p-5 flex flex-col flex-1 min-h-0">
          <div class="flex items-center justify-between mb-3 text-xs text-slate-500 flex-shrink-0">
            <div class="flex items-center gap-2">
              ${badge}
              <span>${escapeHtml(item.source || '手动添加')}</span>
            </div>
            <span class="text-slate-400 flex-shrink-0">${formatTime(item.created_at)}</span>
          </div>
          <h3 class="font-bold text-slate-800 text-base leading-snug mb-2 line-clamp-2 group-hover:text-indigo-600 transition-colors flex-shrink-0">
            ${escapeHtml(item.title)}
          </h3>
          <p class="text-xs text-slate-500 line-clamp-3 mb-3 flex-1 leading-relaxed min-h-0">
            ${truncate(stripMarkdown(summary), 120)}
          </p>
          <div class="flex justify-between items-center mt-auto pt-2 border-t border-slate-100 flex-shrink-0 gap-2">
            <div class="flex flex-wrap gap-1 flex-1 min-w-0">
              ${(item.tags || []).length > 0
                ? (item.tags || [])
                    .slice(0, 3)
                    .map(
                      (tag) =>
                        `<span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full text-[10px] whitespace-nowrap">#${escapeHtml(tag)}</span>`
                    )
                    .join('')
                : '<span class="text-slate-400 text-[10px]">无标签</span>'}
            </div>
            <span class="text-indigo-500 inline-flex items-center text-[11px] flex-shrink-0 whitespace-nowrap">
              查看详情 <i class="fa-solid fa-arrow-right ml-1"></i>
            </span>
          </div>
        </div>
      </article>`;
    })
    .join('');
  
  // 事件委托已在bindEvents中设置，无需重复绑定
}

// 渲染文档库列表
function renderRepoList() {
  if (!elRepoList) return;

  // 首次进入文档库且数据仍在加载时，展示 loading 行而不是空态
  if (repoLoading && allItems.length === 0) {
    elRepoList.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-16 text-center">
          <div class="flex flex-col items-center justify-center max-w-md mx-auto text-slate-500">
            <div class="w-10 h-10 mb-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p class="text-sm font-medium mb-1">正在加载文档列表...</p>
            <p class="text-xs text-slate-400">首次进入会稍慢一点，请稍候</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const search = (elRepoSearchInput?.value || '').trim();
  let data = allItems;
  
  // 状态筛选（基于提取状态）
  if (currentStatusFilter !== 'all') {
    if (currentStatusFilter === 'extracted') {
      // 筛选已提取的文档
      data = data.filter(item => {
        const extracted = item.knowledge_extracted;
        return extracted === true || extracted === 1;
      });
    } else if (currentStatusFilter === 'not-extracted') {
      // 筛选未提取的文档
      data = data.filter(item => {
        const extracted = item.knowledge_extracted;
        return extracted === false || extracted === 0 || extracted === null || extracted === undefined;
      });
    }
  }
  
  // 搜索筛选
  if (search) {
    data = data.filter(
      (item) =>
        (item.title && item.title.includes(search)) ||
        (item.raw_content && item.raw_content.includes(search)) ||
        (item.summary_ai && item.summary_ai.includes(search))
    );
  }
  
  // 排序
  data.sort((a, b) => {
    let aVal, bVal;
    if (repoSortBy === 'title') {
      aVal = (a.title || '').toLowerCase();
      bVal = (b.title || '').toLowerCase();
    } else if (repoSortBy === 'page_count') {
      aVal = a.page_count || 0;
      bVal = b.page_count || 0;
    } else { // created_at
      aVal = a.created_at || 0;
      bVal = b.created_at || 0;
    }
    
    if (repoSortOrder === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    }
  });

  if (data.length === 0) {
    // 检查是否是搜索/筛选导致的空结果
    const isFiltered = search || currentStatusFilter !== 'all';
    elRepoList.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-16 text-center">
          <div class="flex flex-col items-center justify-center max-w-md mx-auto">
            <div class="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <i class="fa-solid ${isFiltered ? 'fa-search' : 'fa-file-upload'} text-3xl text-slate-400"></i>
            </div>
            <h3 class="text-lg font-semibold text-slate-700 mb-2">
              ${isFiltered ? '没有找到匹配的文档' : '还没有文档'}
            </h3>
            <p class="text-sm text-slate-500 mb-6">
              ${isFiltered 
                ? '尝试调整搜索条件或筛选器' 
                : '上传PDF文档开始使用，系统会自动提取知识点'}
            </p>
            ${!isFiltered ? `
              <button
                onclick="document.getElementById('btn-upload-pdf')?.click() || (window.switchView && window.switchView('consultation'))"
                class="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm hover:shadow-md flex items-center gap-2"
              >
                <i class="fa-solid fa-upload"></i>
                <span>上传第一个文档</span>
              </button>
              <p class="text-xs text-slate-400 mt-4">
                提示：也可以在智能问答页面左侧上传文档
              </p>
            ` : `
              <button
                onclick="document.getElementById('repo-search-input').value = ''; document.getElementById('repo-search-input').dispatchEvent(new Event('input')); document.querySelectorAll('.status-filter-btn').forEach(btn => { if(btn.dataset.statusFilter === 'all') btn.click(); });"
                class="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                清除筛选条件
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
    return;
  }

  // 使用DocumentFragment优化DOM操作性能
  // 注意：由于elRepoList是tbody，需要使用tbody作为临时容器
  const fragment = document.createDocumentFragment();
  const tempTbody = document.createElement('tbody');
  
  data.forEach((item) => {
    // 提取状态徽章（统一显示提取状态，不再显示处理状态）
    const extracted = item.knowledge_extracted;
    const isExtracted = extracted === true || extracted === 1;
    const extractionBadge = isExtracted
      ? '<span class="px-2 inline-flex text-[11px] leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1"><i class="fa-solid fa-check text-[10px]"></i>已提取</span>'
      : '<span class="px-2 inline-flex text-[11px] leading-5 font-semibold rounded-full bg-slate-100 text-slate-600 flex items-center gap-1"><i class="fa-solid fa-circle text-[10px]"></i>未提取</span>';
    
    tempTbody.innerHTML = `
    <tr class="cursor-pointer" data-id="${item.id}">
      <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-slate-900">
        ${escapeHtml(truncate(item.title || '无标题', 28))}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-file-pdf text-red-600"></i>
          <span>PDF${item.page_count ? ` (${item.page_count} 页)` : ''}</span>
        </div>
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        ${formatTime(item.created_at)}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        ${item.page_count || 0} 页
      </td>
      <td class="px-6 py-3 whitespace-nowrap">
        ${extractionBadge}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-sm">
        <div class="flex items-center justify-end gap-2">
          <button
            data-action="extract"
            data-id="${item.id}"
            class="px-2.5 py-1.5 ${isExtracted ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'} rounded-md transition-colors font-medium text-xs flex items-center gap-1.5"
            title="${isExtracted ? '重新提取知识点（将覆盖已提取的知识点）' : '提取知识点'}"
          >
            <i class="fa-solid ${isExtracted ? 'fa-rotate' : 'fa-sparkles'} text-xs"></i>
            <span>${isExtracted ? '重新提取' : '提取'}</span>
          </button>
          <button
            data-action="view"
            data-id="${item.id}"
            class="px-2.5 py-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors flex items-center justify-center"
            title="预览"
          >
            <i class="fa-solid fa-eye text-sm"></i>
          </button>
          <button
            data-action="archive"
            data-id="${item.id}"
            class="px-2.5 py-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-md transition-colors flex items-center justify-center"
            title="标记为已贯通（归档后不在智能问答中引用）"
          >
            <i class="fa-solid fa-archive text-sm"></i>
          </button>
          <button
            data-action="delete"
            data-id="${item.id}"
            class="px-2.5 py-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors flex items-center justify-center"
            title="删除"
          >
            <i class="fa-solid fa-trash text-sm"></i>
          </button>
        </div>
      </td>
    </tr>
    `;
    // 将tbody中的tr移动到fragment
    while (tempTbody.firstChild) {
      fragment.appendChild(tempTbody.firstChild);
    }
  });
  
  // 清空现有内容并批量插入
  elRepoList.innerHTML = '';
  elRepoList.appendChild(fragment);
  
  // 事件委托已在bindEvents中设置，无需重复绑定
}

// 渲染归档列表
function renderArchiveList() {
  const search = (elArchiveSearchInput?.value || '').trim();
  let data = archivedItems;
  
  if (search) {
    data = data.filter(
      (item) =>
        (item.title && item.title.includes(search)) ||
        (item.raw_content && item.raw_content.includes(search)) ||
        (item.summary_ai && item.summary_ai.includes(search))
    );
  }
  
  // 排序
  data.sort((a, b) => {
    let aVal, bVal;
    if (archiveSortBy === 'title') {
      aVal = (a.title || '').toLowerCase();
      bVal = (b.title || '').toLowerCase();
    } else if (archiveSortBy === 'page_count') {
      aVal = a.page_count || 0;
      bVal = b.page_count || 0;
    } else { // updated_at
      aVal = a.updated_at || a.created_at || 0;
      bVal = b.updated_at || b.created_at || 0;
    }
    
    if (archiveSortOrder === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
    }
  });

  if (data.length === 0) {
    elArchiveList.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-12 text-center text-slate-400">
          <i class="fa-solid fa-archive text-3xl mb-2"></i>
          <p>暂无已贯通的知识点</p>
        </td>
      </tr>
    `;
    return;
  }

  // 使用DocumentFragment优化DOM操作性能
  // 注意：由于elArchiveList是tbody，需要使用tbody作为临时容器
  const fragment = document.createDocumentFragment();
  const tempTbody = document.createElement('tbody');
  
  data.forEach((item) => {
    tempTbody.innerHTML = `
    <tr class="cursor-pointer" data-id="${item.id}">
      <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-slate-900">
        ${escapeHtml(truncate(item.title || '无标题', 28))}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-file-pdf text-red-600"></i>
          <span>PDF${item.page_count ? ` (${item.page_count} 页)` : ''}</span>
        </div>
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        ${formatTime(item.updated_at || item.created_at)}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        ${item.page_count || 0} 页
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-sm">
        <div class="flex items-center justify-end gap-2">
          <button
            data-action="view"
            data-id="${item.id}"
            class="px-2.5 py-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors flex items-center justify-center"
            title="预览"
          >
            <i class="fa-solid fa-eye text-sm"></i>
          </button>
          <button
            data-action="restore"
            data-id="${item.id}"
            class="px-2.5 py-1.5 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-md transition-colors flex items-center justify-center"
            title="恢复"
          >
            <i class="fa-solid fa-rotate-left text-sm"></i>
          </button>
          <button
            data-action="permanent-delete"
            data-id="${item.id}"
            class="px-2.5 py-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors flex items-center justify-center"
            title="永久删除"
          >
            <i class="fa-solid fa-trash text-sm"></i>
          </button>
        </div>
      </td>
    </tr>
    `;
    // 将tbody中的tr移动到fragment
    while (tempTbody.firstChild) {
      fragment.appendChild(tempTbody.firstChild);
    }
  });
  
  // 清空现有内容并批量插入
  elArchiveList.innerHTML = '';
  elArchiveList.appendChild(fragment);
  
  // 事件委托已在bindEvents中设置，无需重复绑定
}

// 更新排序图标
function updateSortIcons(type) {
  const prefix = type === 'repo' ? 'repo-sort-' : 'archive-sort-';
  const sortBy = type === 'repo' ? repoSortBy : archiveSortBy;
  const sortOrder = type === 'repo' ? repoSortOrder : archiveSortOrder;
  
  // 清除所有排序图标
  document.querySelectorAll(`[id^="${prefix}"] i`).forEach(icon => {
    icon.className = 'fa-solid fa-sort text-slate-400 text-[10px]';
  });
  
  // 设置当前排序字段的图标
  let sortId = '';
  if (sortBy === 'created_at') {
    sortId = 'created';
  } else if (sortBy === 'updated_at') {
    sortId = 'time';
  } else {
    sortId = sortBy;
  }
  
  const currentTh = document.getElementById(`${prefix}${sortId}`);
  if (currentTh) {
    const icon = currentTh.querySelector('i');
    if (icon) {
      if (sortOrder === 'asc') {
        icon.className = 'fa-solid fa-sort-up text-indigo-600 text-[10px]';
      } else {
        icon.className = 'fa-solid fa-sort-down text-indigo-600 text-[10px]';
      }
    }
  }
}

// 加载归档内容（使用分页）
async function loadArchivedItems(reset = true) {
  try {
    // 使用合理的分页大小
    const pageSize = 50;
    
    if (reset) {
      archiveCurrentPage = 1;
      archivedItems = [];
      archiveLoadedCount = 0;
    }
    
    const res = await itemsAPI.getAll({ status: 'archived', page: archiveCurrentPage, limit: pageSize });
    
    const newItems = res.data || [];
    archivedItems = reset ? newItems : [...archivedItems, ...newItems];
    
    archiveTotalCount = res.total || archivedItems.length;
    archiveLoadedCount = archivedItems.length;
    const hasMore = res.hasMore || (archiveLoadedCount < archiveTotalCount);
    
    console.log(`加载了 ${newItems.length} 个归档项目，已加载 ${archiveLoadedCount}/${archiveTotalCount}`);
    
    renderArchiveList();
    
    // 更新加载更多按钮状态
    updateLoadMoreButton('archive', hasMore);
  } catch (error) {
    console.error('加载归档内容失败:', error);
    showToast(error.message || '加载归档内容失败', 'error');
  }
}

// 加载更多归档项目
async function loadMoreArchivedItems() {
  archiveCurrentPage++;
  await loadArchivedItems(false);
}

// 更新加载更多按钮
function updateLoadMoreButton(type, hasMore) {
  const buttonId = type === 'repo' ? 'btn-load-more-repo' : 'btn-load-more-archive';
  const countId = type === 'repo' ? 'repo-count-info' : 'archive-count-info';
  const button = document.getElementById(buttonId);
  const countInfo = document.getElementById(countId);
  
  if (countInfo) {
    const loaded = type === 'repo' ? repoLoadedCount : archiveLoadedCount;
    const total = type === 'repo' ? repoTotalCount : archiveTotalCount;
    countInfo.textContent = `已加载 ${loaded}/${total}`;
  }
  
  if (button) {
    if (hasMore) {
      button.classList.remove('hidden');
      button.disabled = false;
    } else {
      button.classList.add('hidden');
    }
  }
}

// 加载Dashboard统计信息
async function loadDashboardStats() {
  try {
    const res = await itemsAPI.getStats();
    stats = res.data || {};
    updateDashboardStats();
  } catch (error) {
    console.error('加载统计信息失败:', error);
  }
}

// 更新Dashboard统计信息显示
function updateDashboardStats() {
  if (!stats) return;
  const total = stats.total || 0;
  const pending = stats.pending || 0;
  const todayAdded = stats.todayAdded || 0;
  
  elDashboardSubtitle.textContent = `你有 ${total} 条内容在知识库中${pending > 0 ? `，${pending} 条待处理` : ''}${todayAdded > 0 ? `，今日新增 ${todayAdded} 条` : ''}`;
}

// 暴露给全局，供表格行点击使用
window.openDetailById = async (id) => {
  // 先从活跃内容中查找，再从归档内容中查找
  let item = allItems.find((it) => it.id === id);
  if (!item) {
    item = archivedItems.find((it) => it.id === id);
  }
  if (item) {
    await openDetail(item);
  } else {
    // 如果本地没有找到，从API获取
    try {
      const res = await itemsAPI.getById(id);
      if (res.success && res.data) {
        await openDetail(res.data);
      } else {
        showToast('内容不存在', 'error');
      }
    } catch (error) {
      console.error('加载详情失败:', error);
      showToast('加载详情失败', 'error');
    }
  }
};

// 清除筛选
window.clearFilters = () => {
  globalSearchTerm = '';
  currentTagFilter = null;
  if (elGlobalSearch) elGlobalSearch.value = '';
  scheduleRender(['cards', 'repoList']);
  showToast('已清除筛选', 'info');
};

// 渲染标签云（简单：从所有 items 中统计）
function renderTagsCloud() {
  const tagCount = {};
  allItems.forEach((item) => {
    (item.tags || []).forEach((tag) => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });

  const entries = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
  
  // 添加创建标签输入框
  let html = `
    <div class="mb-6 pb-6 border-b border-slate-200">
      <div class="flex gap-2">
        <input
          type="text"
          id="input-new-tag"
          placeholder="输入标签名称，回车创建"
          class="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <button
          id="btn-create-tag"
          class="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all flex items-center"
        >
          <i class="fa-solid fa-plus mr-2"></i> 创建
        </button>
      </div>
      <p class="text-xs text-slate-500 mt-2">点击标签可筛选内容，悬停显示编辑/删除选项</p>
    </div>
    <div class="flex flex-wrap gap-3">
  `;

  if (entries.length === 0) {
    html += `
      <div class="w-full text-center py-12">
        <i class="fa-solid fa-hashtag text-4xl text-slate-300 mb-3"></i>
        <p class="text-sm text-slate-400 mb-2">暂无标签</p>
        <p class="text-xs text-slate-500">在上方输入框创建你的第一个标签</p>
      </div>
    `;
    html += '</div>';
    elTagsContainer.innerHTML = html;
    
    // 绑定创建标签按钮和回车
    const btnCreate = elTagsContainer.querySelector('#btn-create-tag');
    const inputNewTag = elTagsContainer.querySelector('#input-new-tag');
    if (btnCreate) {
      btnCreate.addEventListener('click', () => {
        const tagName = inputNewTag.value.trim();
        if (tagName) {
          handleCreateTag(tagName);
          inputNewTag.value = '';
        }
      });
    }
    if (inputNewTag) {
      inputNewTag.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const tagName = inputNewTag.value.trim();
          if (tagName) {
            handleCreateTag(tagName);
            inputNewTag.value = '';
          }
        }
      });
    }
    return;
  }

  html += entries
    .map(
      ([tag, count]) => `
    <div class="group relative inline-block">
      <button 
        data-tag="${tag}"
        class="tag-item px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center shadow-sm"
      >
        <span class="font-medium"># ${tag}</span>
        <span class="ml-2 text-xs text-slate-500 bg-white px-2 py-0.5 rounded-full">${count}</span>
      </button>
      <div class="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 -mt-1 -mr-1">
        <button 
          data-tag-edit="${tag}"
          class="p-1.5 bg-white rounded-lg shadow-md text-xs text-indigo-600 hover:bg-indigo-50 border border-indigo-200"
          title="重命名"
        >
          <i class="fa-solid fa-pen"></i>
        </button>
        <button 
          data-tag-delete="${tag}"
          class="p-1.5 bg-white rounded-lg shadow-md text-xs text-red-600 hover:bg-red-50 border border-red-200"
          title="删除"
        >
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `
    )
    .join('');
  html += '</div>';

  elTagsContainer.innerHTML = html;

  // 绑定标签点击事件（筛选）
  elTagsContainer.querySelectorAll('.tag-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-tag-edit]') || e.target.closest('[data-tag-delete]')) {
        return; // 编辑/删除按钮点击不触发筛选
      }
      const tag = btn.getAttribute('data-tag');
      filterByTag(tag);
    });
  });

  // 绑定编辑按钮
  elTagsContainer.querySelectorAll('[data-tag-edit]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = btn.getAttribute('data-tag-edit');
      showEditTagModal(tag);
    });
  });

  // 绑定删除按钮
  elTagsContainer.querySelectorAll('[data-tag-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = btn.getAttribute('data-tag-delete');
      handleDeleteTag(tag);
    });
  });

  // 绑定创建标签按钮和输入框
  const btnCreate = elTagsContainer.querySelector('#btn-create-tag');
  const inputNewTag = elTagsContainer.querySelector('#input-new-tag');
  if (btnCreate && inputNewTag) {
    btnCreate.addEventListener('click', () => {
      const tagName = inputNewTag.value.trim();
      if (tagName) {
        handleCreateTag(tagName);
        inputNewTag.value = '';
      }
    });
    inputNewTag.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const tagName = inputNewTag.value.trim();
        if (tagName) {
          handleCreateTag(tagName);
          inputNewTag.value = '';
        }
      }
    });
  }
}

// 按标签筛选
let currentTagFilter = null;
function filterByTag(tag) {
  currentTagFilter = tag;
  globalSearchTerm = ''; // 清除搜索
  switchView('dashboard');
  scheduleRender(['cards', 'repoList']);
  showToast(`已筛选标签: #${tag}`, 'info');
}

// 显示编辑标签模态框
async function showEditTagModal(oldTag) {
  try {
    const newTagName = await showPrompt('请输入新标签名称:', {
      title: '重命名标签',
      defaultValue: oldTag,
      placeholder: '标签名称'
    });
    if (!newTagName || !newTagName.trim() || newTagName === oldTag) return;
    handleRenameTag(oldTag, newTagName.trim());
  } catch {
    // 用户取消
  }
}

// 创建标签
async function handleCreateTag(tagName) {
  try {
    // 检查标签是否已存在
    const exists = allItems.some((item) => (item.tags || []).includes(tagName));
    if (exists) {
      showToast('标签已存在', 'info');
      return;
    }

    // 标签创建成功提示（标签会在使用到知识项时自动创建）
    showToast('标签创建成功，现在可以为知识项添加此标签', 'success');
    renderTagsCloud();
  } catch (error) {
    console.error('创建标签失败:', error);
    showToast(error.message || '创建标签失败', 'error');
  }
}

// 重命名标签
async function handleRenameTag(oldTag, newTag) {
  try {
    // 更新所有包含该标签的知识项
    const itemsToUpdate = allItems.filter((item) => (item.tags || []).includes(oldTag));

    if (itemsToUpdate.length === 0) {
      showToast('没有找到使用该标签的内容', 'info');
      return;
    }

    const loadingToast = showLoadingToast('正在更新标签...');

    try {
      for (const item of itemsToUpdate) {
        const newTags = (item.tags || []).map((t) => (t === oldTag ? newTag : t));
        await itemsAPI.update(item.id, { tags: newTags });
      }

      // 清除缓存并重新加载数据
      clearAPICache();
      await loadItems();
      renderTagsCloud();
      loadingToast.close();
      showToast('标签重命名成功', 'success');
    } catch (error) {
      loadingToast.close();
      console.error('重命名标签失败:', error);
      showToast(error.message || '重命名标签失败', 'error');
    }
  } catch (error) {
    console.error('重命名标签失败:', error);
    showToast(error.message || '重命名标签失败', 'error');
  }
}

// 删除标签
async function handleDeleteTag(tag) {
  try {
    await showConfirm(`确定要删除标签 "#${tag}" 吗？这将从所有使用该标签的内容中移除。`, {
      title: '确认删除',
      type: 'warning'
    });
  } catch {
    return; // 用户取消
  }

  try {
    // 从所有包含该标签的知识项中移除
    const itemsToUpdate = allItems.filter((item) => (item.tags || []).includes(tag));

    if (itemsToUpdate.length === 0) {
      showToast('没有找到使用该标签的内容', 'info');
      return;
    }

    const loadingToast = showLoadingToast('正在删除标签...');

    try {
      for (const item of itemsToUpdate) {
        const newTags = (item.tags || []).filter((t) => t !== tag);
        await itemsAPI.update(item.id, { tags: newTags });
      }

      // 清除缓存并重新加载数据
      clearAPICache();
      await loadItems();
      renderTagsCloud();
      loadingToast.close();
      showToast('标签删除成功', 'success');
    } catch (error) {
      loadingToast.close();
      console.error('删除标签失败:', error);
      showToast(error.message || '删除标签失败', 'error');
    }
  } catch (error) {
    console.error('删除标签失败:', error);
    showToast(error.message || '删除标签失败', 'error');
  }
}

// 更新Context状态显示

// 打开详情
let isEditing = false;

async function openDetail(item) {
  // 移除之前选中的行
  if (selectedRowId) {
    const prevRow = document.querySelector(`tr[data-id="${selectedRowId}"]`);
    if (prevRow) {
      prevRow.classList.remove('selected');
    }
  }
  
  // 标记当前行为选中状态
  selectedRowId = item.id;
  const currentRow = document.querySelector(`tr[data-id="${item.id}"]`);
  if (currentRow) {
    currentRow.classList.add('selected');
  }
  // 如果item没有raw_content（列表查询不返回），需要从API获取完整数据
  // 对于所有类型（包括PDF），如果没有raw_content都从API获取
  // 检查raw_content是否存在且不为空字符串
  const hasContent = item.raw_content && item.raw_content.trim().length > 0;
  
  // 对于PDF文档，统一在initPDFViewer中显示toast，这里不显示
  // 对于非PDF文档，显示统一的"正在加载..."
  const isPDF = item.type === 'pdf' && item.file_path;
  
  if (!hasContent && !isPDF) {
    try {
      // 不显示loading toast，因为文档基本信息已经显示
      const res = await itemsAPI.getById(item.id);
      if (res.success && res.data) {
        item = res.data;
        console.log('加载详情成功:', {
          id: item.id,
          type: item.type,
          hasRawContent: !!item.raw_content,
          rawContentLength: item.raw_content ? item.raw_content.length : 0,
          hasPageContent: !!item.page_content,
          pageContentType: Array.isArray(item.page_content) ? 'array' : typeof item.page_content,
          pageContentLength: Array.isArray(item.page_content) ? item.page_content.length : 0
        });
        // 更新allItems中的对应项
        const index = allItems.findIndex(it => it.id === item.id);
        if (index !== -1) {
          allItems[index] = item;
        }
        // 也更新archivedItems中的对应项
        const archiveIndex = archivedItems.findIndex(it => it.id === item.id);
        if (archiveIndex !== -1) {
          archivedItems[archiveIndex] = item;
        }
        // 不显示成功toast，因为文档已经显示出来了
      }
    } catch (error) {
      console.error('加载详情失败:', error);
      // 只在失败时显示错误toast
      showToast('加载失败: ' + (error.message || '未知错误'), 'error');
      // 如果加载失败，仍然显示基本信息，只是没有raw_content
    }
  } else if (!hasContent && isPDF) {
    // PDF文档需要从API获取，但不显示toast（由initPDFViewer统一处理）
    try {
      const res = await itemsAPI.getById(item.id);
      if (res.success && res.data) {
        item = res.data;
        // 更新allItems中的对应项
        const index = allItems.findIndex(it => it.id === item.id);
        if (index !== -1) {
          allItems[index] = item;
        }
        // 也更新archivedItems中的对应项
        const archiveIndex = archivedItems.findIndex(it => it.id === item.id);
        if (archiveIndex !== -1) {
          archivedItems[archiveIndex] = item;
        }
      }
    } catch (error) {
      console.error('加载详情失败:', error);
      // PDF加载失败会在initPDFViewer中处理
    }
  }
  
  currentItem = item;
  isEditing = false;
  elViewDetail.classList.remove('hidden');
  
  // 防止背景滚动（当详情页显示时）
  document.body.style.overflow = 'hidden';
  
  // 清理PDF预览器状态（如果存在）
  // 取消正在进行的渲染任务
  if (pdfViewerState.renderTask) {
    try {
      pdfViewerState.renderTask.cancel();
    } catch (e) {
      // 忽略取消错误
    }
  }
  pdfViewerState = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    renderTask: null,
    isRendering: false
  };

  const tagsStr =
    (item.tags && item.tags.length > 0
      ? item.tags.map((t) => `#${t}`).join(' ')
      : '') || '无';

  // 如果是PDF类型且有file_path，显示PDF预览
  if (item.type === 'pdf' && item.file_path) {
    elDetailContent.innerHTML = `
      <div class="mb-4">
        <button
          id="btn-back-detail"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          <i class="fa-solid fa-arrow-left"></i>
          <span>返回</span>
        </button>
      </div>
      <header class="mb-6 border-b border-slate-200 pb-4">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center text-xs text-slate-500">
            <span class="inline-flex items-center mr-3 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
              <i class="fa-solid fa-file-pdf mr-1"></i> PDF
            </span>
            <span>${formatTime(item.created_at)}</span>
            ${item.page_count ? `<span class="ml-3">共 ${item.page_count} 页</span>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <button
              id="btn-extract-knowledge"
              class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              data-doc-id="${item.id}"
            >
              <i class="fa-solid fa-sparkles"></i>
              <span>提取知识</span>
            </button>
          </div>
        </div>
        <h1 id="detail-title" class="text-2xl md:text-3xl font-bold text-slate-900 leading-tight mb-2">
          ${item.title}
        </h1>
        <div class="flex flex-wrap items-center text-xs text-slate-500 gap-2">
          <span>来源：${item.source || '手动添加'}</span>
          ${item.tags && item.tags.length > 0 ? `<span class="mx-1 text-slate-300">·</span><span>标签：${item.tags.map(t => `#${t}`).join(' ')}</span>` : ''}
        </div>
      </header>
      <section class="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <div id="pdf-viewer-container" class="w-full">
          <div class="flex items-center justify-center mb-4">
            <div class="flex items-center gap-2">
              <button id="pdf-prev-page" class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <i class="fa-solid fa-chevron-left mr-1"></i> 上一页
              </button>
              <span id="pdf-page-info" class="px-4 py-1.5 text-sm text-slate-600">加载中...</span>
              <button id="pdf-next-page" class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                下一页 <i class="fa-solid fa-chevron-right ml-1"></i>
              </button>
              <span class="mx-2 text-slate-300">|</span>
              <button id="pdf-zoom-out" class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                <i class="fa-solid fa-minus"></i>
              </button>
              <span id="pdf-zoom-level" class="px-3 py-1.5 text-sm text-slate-600">100%</span>
              <button id="pdf-zoom-in" class="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
          <div id="pdf-canvas-container" class="w-full overflow-auto bg-slate-100 rounded border border-slate-200" style="min-height: 600px; max-height: calc(100vh - 250px);">
            <canvas id="pdf-canvas" class="mx-auto block"></canvas>
          </div>
        </div>
      </section>
    `;
    
    // 绑定返回按钮事件
    const btnBackDetail = document.getElementById('btn-back-detail');
    if (btnBackDetail) {
      btnBackDetail.addEventListener('click', closeDetail);
    }
    
    // 绑定提取知识按钮事件
    const btnExtract = document.getElementById('btn-extract-knowledge');
    if (btnExtract) {
      btnExtract.addEventListener('click', async () => {
        try {
          const { getCurrentKnowledgeBaseId } = await import('./knowledge-bases.js');
          const { showToast } = await import('./toast.js');
          const extractionModule = window.knowledgeExtraction;
          
          if (!extractionModule || typeof extractionModule.extractFromDocument !== 'function') {
            console.error('提取模块未初始化或加载失败', extractionModule);
            if (showToast) {
              showToast('提取模块加载失败，请刷新页面后重试', 'error');
            }
            return;
          }
          
          const currentKbId = getCurrentKnowledgeBaseId();
          // 不再显示toast，进度信息由底部进度条显示
          
          await extractionModule.extractFromDocument(item.id, currentKbId, async (progress) => {
            if (progress.status === 'completed') {
              // 清除缓存并刷新文档列表以显示更新后的提取状态
              clearAPICache();
              await loadItems();
              // 可选：自动跳转到知识库视图
              setTimeout(() => {
                switchView('knowledge-items');
                closeDetail();
              }, 1500);
            }
            // 进度信息由进度条显示，不再使用toast
          });
        } catch (error) {
          console.error('提取知识失败:', error);
          // 错误信息由进度条显示，不再使用toast
        }
      });
    }
    
    // 初始化PDF预览
    initPDFViewer(item.id, item.file_path);
  } else {
    // 非PDF类型或没有file_path，显示文本内容
    elDetailContent.innerHTML = `
      <div class="mb-4">
        <button
          id="btn-back-detail"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          <i class="fa-solid fa-arrow-left"></i>
          <span>返回</span>
        </button>
      </div>
      <header class="mb-8 border-b border-slate-100 pb-5">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center text-xs text-slate-500">
            <span class="inline-flex items-center mr-3 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
              item.type === 'link'
                ? 'bg-blue-100 text-blue-700'
                : item.type === 'memo'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-slate-100 text-slate-700'
            }">
              ${item.type === 'link'
                ? '<i class="fa-solid fa-link mr-1"></i> 链接'
                : item.type === 'memo'
                ? '<i class="fa-solid fa-sticky-note mr-1"></i> 备忘录'
                : 'TEXT'}
            </span>
            <span>${formatTime(item.created_at)}</span>
            ${
              item.original_url
                ? `<a href="${item.original_url}" target="_blank" class="ml-4 text-indigo-600 hover:underline text-xs">原始链接 ↗</a>`
                : ''
            }
          </div>
          <div class="flex items-center gap-2">
            <button
              id="btn-extract-knowledge"
              class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              data-doc-id="${item.id}"
            >
              <i class="fa-solid fa-sparkles"></i>
              <span>提取知识</span>
            </button>
          </div>
        </div>
        <h1 id="detail-title" class="text-2xl md:text-3xl font-bold text-slate-900 leading-tight mb-3">
          ${item.title}
        </h1>
        <div class="flex flex-wrap items-center text-xs text-slate-500 gap-2">
          <span>来源：${item.source || '手动添加'}</span>
          ${item.tags && item.tags.length > 0 ? `<span class="mx-1 text-slate-300">·</span><span>标签：${item.tags.map(t => `#${t}`).join(' ')}</span>` : ''}
        </div>
      </header>
      ${
        item.summary_ai
          ? `<section class="mb-6">
              <h2 class="text-sm font-semibold text-slate-800 mb-2">AI 摘要</h2>
              <div class="prose prose-sm prose-slate max-w-none text-slate-700 bg-indigo-50 border border-indigo-100 rounded-xl p-4 prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
                ${parseMarkdown(item.summary_ai)}
              </div>
            </section>`
          : ''
      }
      <section>
        <h2 class="text-sm font-semibold text-slate-800 mb-2">原文内容</h2>
        <article class="prose prose-slate max-w-none text-sm">
          <div id="detail-content" class="whitespace-pre-line leading-relaxed">
            ${
              (item.type === 'pdf' && item.page_content && Array.isArray(item.page_content) && item.page_content.length > 0)
                ? item.page_content.map((page, idx) => {
                    const pageText = page.text || page.content || '';
                    return pageText.trim() 
                      ? `<div class="mb-4 p-3 bg-slate-50 rounded border border-slate-200">
                          <div class="text-xs text-slate-500 mb-2 font-medium">第 ${idx + 1} 页</div>
                          <div class="text-slate-700">${escapeHtml(pageText)}</div>
                        </div>`
                      : '';
                  }).filter(Boolean).join('') || '（暂无正文内容）'
                : (item.raw_content && item.raw_content.trim())
                ? escapeHtml(item.raw_content)
                : '（暂无正文内容）'
            }
          </div>
        </article>
      </section>
    `;
    
    // 绑定返回按钮事件
    const btnBackDetail = document.getElementById('btn-back-detail');
    if (btnBackDetail) {
      btnBackDetail.addEventListener('click', closeDetail);
    }
    
    // 绑定提取知识按钮事件
    const btnExtract = document.getElementById('btn-extract-knowledge');
    if (btnExtract) {
      btnExtract.addEventListener('click', async () => {
        try {
          const { getCurrentKnowledgeBaseId } = await import('./knowledge-bases.js');
          const { showToast } = await import('./toast.js');
          const extractionModule = window.knowledgeExtraction;
          
          if (!extractionModule || typeof extractionModule.extractFromDocument !== 'function') {
            console.error('提取模块未初始化或加载失败', extractionModule);
            if (showToast) {
              showToast('提取模块加载失败，请刷新页面后重试', 'error');
            }
            return;
          }
          
          const currentKbId = getCurrentKnowledgeBaseId();
          // 不再显示toast，进度信息由底部进度条显示
          
          await extractionModule.extractFromDocument(item.id, currentKbId, async (progress) => {
            if (progress.status === 'completed') {
              // 清除缓存并刷新文档列表以显示更新后的提取状态
              clearAPICache();
              await loadItems();
              // 可选：自动跳转到知识库视图
              setTimeout(() => {
                switchView('knowledge-items');
                closeDetail();
              }, 1500);
            }
            // 进度信息由进度条显示，不再使用toast
          });
        } catch (error) {
          console.error('提取知识失败:', error);
          // 错误信息由进度条显示，不再使用toast
        }
      });
    }
  }

  // 如果是PDF，初始化PDF预览器
  if (item.type === 'pdf' && item.file_path) {
    // PDF预览器的事件绑定在initPDFViewer中处理
  }
}

// 切换编辑模式
function toggleEditMode() {
  if (!currentItem) return;

  if (!isEditing) {
    // 进入编辑模式
    isEditing = true;
    const titleEl = elDetailContent.querySelector('#detail-title');
    const contentEl = elDetailContent.querySelector('#detail-content');
    const btnEdit = elDetailContent.querySelector('#btn-edit-item');

    // 保存原始值
    const originalTitle = currentItem.title;
    const originalContent = currentItem.raw_content || '';

    // 创建编辑输入框
    titleEl.innerHTML = `
      <input 
        type="text" 
        id="edit-title" 
        value="${originalTitle.replace(/"/g, '&quot;')}" 
        class="w-full text-2xl md:text-3xl font-bold text-slate-900 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    `;

    contentEl.innerHTML = `
      <textarea 
        id="edit-content" 
        rows="15"
        class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
      >${originalContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
    `;

    btnEdit.innerHTML = '<i class="fa-solid fa-check mr-1"></i> 保存';
    btnEdit.className = 'px-3 py-1.5 text-xs font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors';

    // 添加取消按钮
    const btnCancel = document.createElement('button');
    btnCancel.className = 'px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors ml-2';
    btnCancel.innerHTML = '<i class="fa-solid fa-xmark mr-1"></i> 取消';
    btnCancel.addEventListener('click', async () => {
      isEditing = false;
      await openDetail(currentItem); // 重新加载详情
    });
    btnEdit.parentNode.insertBefore(btnCancel, btnEdit.nextSibling);

    // 绑定保存事件
    btnEdit.onclick = () => handleSaveEdit();
  }
}

// 保存编辑
async function handleSaveEdit() {
  if (!currentItem) return;

  const titleInput = elDetailContent.querySelector('#edit-title');
  const contentInput = elDetailContent.querySelector('#edit-content');

  if (!titleInput || !contentInput) return;

  const newTitle = titleInput.value.trim();
  const newContent = contentInput.value.trim();

  if (!newTitle) {
    showToast('标题不能为空', 'error');
    return;
  }

  try {
    const loadingToast = showLoadingToast('正在保存...');
    try {
      await itemsAPI.update(currentItem.id, {
        title: newTitle,
        raw_content: newContent
      });

      // 清除API缓存并重新加载数据，确保所有视图数据一致
      clearAPICache();
      await loadItems();

      // 从最新数据中获取更新后的项
      const updatedItem = allItems.find((it) => it.id === currentItem.id) || {
        ...currentItem,
        title: newTitle,
        raw_content: newContent
      };

      // 同步更新当前项和归档列表
      currentItem = updatedItem;
      archivedItems = archivedItems.map((it) =>
        it.id === currentItem.id ? { ...it, title: currentItem.title, raw_content: currentItem.raw_content } : it
      );

      isEditing = false;
      await openDetail(currentItem); // 重新渲染
      scheduleRender(['cards', 'repoList', 'archiveList']);

      loadingToast.close();
      showToast('保存成功', 'success');
    } catch (error) {
      loadingToast.close();
      console.error('保存失败:', error);
      showToast(error.message || '保存失败', 'error');
      throw error; // 重新抛出以便外层catch处理
    }
  } catch (error) {
    // 外层catch处理未预期的错误
    console.error('保存失败:', error);
    if (!error.message || !error.message.includes('保存失败')) {
      showToast(error.message || '保存失败', 'error');
    }
  }
}

function closeDetail() {
  elViewDetail.classList.add('hidden');
  currentItem = null;
  
  // 清除选中状态
  if (selectedRowId) {
    const row = document.querySelector(`tr[data-id="${selectedRowId}"]`);
    if (row) {
      row.classList.remove('selected');
    }
    selectedRowId = null;
  }
  
  // 恢复背景滚动
  document.body.style.overflow = '';
}

// AI 聊天消息渲染
function addChatMessage(role, text) {
  const isAI = role === 'ai';
  const wrapper = document.createElement('div');
  // AI消息头像对齐到顶部，用户消息居中对齐
  wrapper.className = `flex ${isAI ? 'items-start' : 'items-center'} mb-3 ${isAI ? '' : 'flex-row-reverse'}`;

  const avatar = isAI
    ? `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs">AI</div>`
    : `<img class="h-8 w-8 rounded-full border border-slate-200" src="https://ui-avatars.com/api/?name=User&background=6366f1&color=fff" />`;

  const bubbleClass = isAI
    ? 'bg-white border border-slate-200 rounded-2xl rounded-tl-none'
    : 'bg-indigo-600 text-white rounded-2xl rounded-tr-none';

  const bubble = document.createElement('div');
  // 调整 padding 以确保与头像垂直居中对齐
  const paddingClass = isAI ? 'px-3 py-2' : 'px-3 py-2.5';
  bubble.className = `${bubbleClass} ${paddingClass} text-xs max-w-[90%] shadow-sm ${
    isAI ? 'prose prose-xs prose-slate max-w-none' : ''
  }`;
  
  if (isAI) {
    // AI 消息使用 Markdown 解析
    bubble.innerHTML = parseMarkdown(text);
  } else {
    // 用户消息保持纯文本
    bubble.innerText = text;
  }

  const avatarWrapper = document.createElement('div');
  avatarWrapper.className = 'flex-shrink-0';
  avatarWrapper.innerHTML = avatar;

  if (isAI) {
    wrapper.appendChild(avatarWrapper);
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = 'ml-2';
    bubbleWrapper.appendChild(bubble);
    wrapper.appendChild(bubbleWrapper);
  } else {
    wrapper.appendChild(avatarWrapper);
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = 'mr-2';
    bubbleWrapper.appendChild(bubble);
    wrapper.appendChild(bubbleWrapper);
  }

  elChatHistory.appendChild(wrapper);
  elChatHistory.scrollTop = elChatHistory.scrollHeight;
}

// AI 对话
async function handleSendChat() {
  if (!apiConfigured) {
    showToast('请先在设置中配置 DeepSeek API Key', 'info');
    openSettingsModal();
    return;
  }
  const text = elChatInput.value.trim();
  if (!text) return;

  addChatMessage('user', text);
  elChatInput.value = '';
  // 重置输入框高度
  elChatInput.style.height = 'auto';

  const messages = [{ role: 'user', content: text }];
  const context = currentItem ? currentItem.raw_content || '' : null;

  let buffer = '';
  let hasError = false;

  try {
    await aiAPI.chat(messages, context, (chunk) => {
      buffer += chunk;
      // 简单地每若干字符刷新一次
        if (buffer.length > 10) {
        // 更新最后一个 AI 气泡或新建
        const last = elChatHistory.querySelector('[data-role="ai-temp"]');
        if (!last) {
          const wrapper = document.createElement('div');
          wrapper.className = 'flex items-start mb-3';
          wrapper.dataset.role = 'ai-temp';

          const avatarWrapper = document.createElement('div');
          avatarWrapper.className = 'flex-shrink-0';
          avatarWrapper.innerHTML =
            '<div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs">AI</div>';

          const bubbleWrapper = document.createElement('div');
          bubbleWrapper.className = 'ml-2';
          const bubble = document.createElement('div');
          bubble.className =
            'bg-white border border-slate-200 rounded-2xl rounded-tl-none px-3 py-2 text-xs max-w-[90%] prose prose-xs prose-slate max-w-none shadow-sm';
          bubble.innerHTML = parseMarkdown(buffer);
          bubbleWrapper.appendChild(bubble);

          wrapper.appendChild(avatarWrapper);
          wrapper.appendChild(bubbleWrapper);
          elChatHistory.appendChild(wrapper);
        } else {
          const bubble = last.querySelector('div.bg-white');
          if (bubble) bubble.innerHTML = parseMarkdown(buffer);
        }
        elChatHistory.scrollTop = elChatHistory.scrollHeight;
      }
    });
  } catch (error) {
    console.error('AI 对话失败:', error);
    showToast(error.message || 'AI 对话失败', 'error');
    hasError = true;
  }

  if (!hasError && buffer.trim()) {
    // 确保最终内容展示
    addChatMessage('ai', buffer.trim());
    const temp = elChatHistory.querySelector('[data-role="ai-temp"]');
    if (temp) temp.remove();
  }
}

// 生成摘要
async function handleGenerateSummary() {
  if (!currentItem) return;
  if (!apiConfigured) {
    showToast('请先在设置中配置 DeepSeek API Key', 'info');
    openSettingsModal();
    return;
  }
  if (!currentItem.raw_content) {
    showToast('当前内容没有正文可供总结', 'info');
    return;
  }

  const loadingToast = showLoadingToast('正在生成摘要...');
  try {
    const res = await aiAPI.generateSummary(currentItem.raw_content, currentItem.id);
    const summary = res.data.summary;
    currentItem.summary_ai = summary;

    // 更新 allItems 中对应项
    allItems = allItems.map((it) =>
      it.id === currentItem.id ? { ...it, summary_ai: summary } : it
    );

    // 重新加载数据确保同步
    await refreshItemAfterSummary(currentItem.id);

    loadingToast.close();
    showToast('摘要已生成', 'success');
    
    // 自动建议标签
    if (currentItem.raw_content) {
      setTimeout(() => {
        showTagSuggestions(currentItem.id, currentItem.raw_content);
      }, 500); // 延迟500ms，让用户看到摘要生成成功的提示
    }
  } catch (error) {
    loadingToast.close();
    console.error('生成摘要失败:', error);
    showToast(error.message || '生成摘要失败', 'error');
  }
}

// 显示标签建议
async function showTagSuggestions(itemId, content) {
  if (!apiConfigured) return;
  
  try {
    const loadingToast = showLoadingToast('正在生成标签建议...');
    try {
      const res = await aiAPI.suggestTags(content);
      const suggestedTags = res.data.tags || [];
      
      loadingToast.close();
      
      if (suggestedTags.length === 0) {
        showToast('未生成标签建议', 'info');
        return;
      }
      
      // 显示标签选择界面
      showTagSelectionModal(itemId, suggestedTags);
    } catch (error) {
      loadingToast.close();
      console.error('获取标签建议失败:', error);
      showToast(error.message || '获取标签建议失败', 'error');
    }
  } catch (error) {
    console.error('获取标签建议失败:', error);
    showToast(error.message || '获取标签建议失败', 'error');
  }
}

// 显示标签选择模态框
function showTagSelectionModal(itemId, suggestedTags) {
  const item = allItems.find((it) => it.id === itemId);
  if (!item) return;
  
  const existingTags = item.tags || [];
  const selectedTags = new Set(existingTags);
  
  // 创建模态框
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center';
  modal.id = 'tag-suggestion-modal';
  
  const tagsHtml = suggestedTags.map((tag) => {
    const isSelected = selectedTags.has(tag);
    return `
      <label class="flex items-center p-3 bg-white border-2 rounded-lg cursor-pointer transition-all ${
        isSelected 
          ? 'border-indigo-500 bg-indigo-50' 
          : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50'
      }">
        <input 
          type="checkbox" 
          value="${tag}" 
          ${isSelected ? 'checked disabled' : ''}
          class="mr-3 w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
          onchange="this.closest('label').classList.toggle('border-indigo-500', this.checked); this.closest('label').classList.toggle('bg-indigo-50', this.checked);"
        />
        <span class="text-sm font-medium text-slate-700"># ${tag}</span>
        ${isSelected ? '<span class="ml-auto text-xs text-slate-400">(已存在)</span>' : ''}
      </label>
    `;
  }).join('');
  
  modal.innerHTML = `
    <div class="glass w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all duration-200 scale-95 opacity-0" id="tag-suggestion-content">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-slate-900">标签建议</h2>
        <button
          id="btn-close-tag-modal"
          class="text-slate-400 hover:text-slate-600"
        >
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>
      <p class="text-sm text-slate-600 mb-4">选择要添加的标签：</p>
      <div class="space-y-2 max-h-64 overflow-y-auto mb-4">
        ${tagsHtml}
      </div>
      <div class="flex justify-end gap-2">
        <button
          id="btn-cancel-tags"
          class="px-4 py-2 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
        >
          取消
        </button>
        <button
          id="btn-confirm-tags"
          class="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-all"
        >
          添加选中标签
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 动画显示
  requestAnimationFrame(() => {
    const content = modal.querySelector('#tag-suggestion-content');
    content.classList.remove('scale-95', 'opacity-0');
    content.classList.add('scale-100', 'opacity-100');
  });
  
  // 绑定事件
  const btnClose = modal.querySelector('#btn-close-tag-modal');
  const btnCancel = modal.querySelector('#btn-cancel-tags');
  const btnConfirm = modal.querySelector('#btn-confirm-tags');
  
  const closeModal = () => {
    const content = modal.querySelector('#tag-suggestion-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => modal.remove(), 200);
  };
  
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  btnConfirm.addEventListener('click', async () => {
    const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
    const tagsToAdd = Array.from(checkboxes).map((cb) => cb.value);
    
    if (tagsToAdd.length === 0) {
      showToast('请至少选择一个标签', 'info');
      return;
    }
    
    try {
      const newTags = [...existingTags, ...tagsToAdd];
      await itemsAPI.update(itemId, { tags: newTags });
      
      // 清除缓存并重新从服务器加载数据，确保所有视图数据一致
      clearAPICache();
      await loadItems();
      
      // 如果正在查看该项，重新打开详情以显示最新数据
      if (currentItem && currentItem.id === itemId) {
        const updatedItem = allItems.find(it => it.id === itemId);
        if (updatedItem) {
          await openDetail(updatedItem);
        }
      }
      
      closeModal();
      showToast(`已添加 ${tagsToAdd.length} 个标签`, 'success');
    } catch (error) {
      console.error('添加标签失败:', error);
      showToast(error.message || '添加标签失败', 'error');
    }
  });
}

// 批量生成摘要
// 修复摘要显示问题：生成摘要后重新加载数据
async function refreshItemAfterSummary(itemId) {
  try {
    const res = await itemsAPI.getById(itemId);
    if (res.success && res.data) {
      // 更新 allItems
      allItems = allItems.map((it) => (it.id === itemId ? res.data : it));
      
      // 如果当前正在查看该项，更新详情
      if (currentItem && currentItem.id === itemId) {
        currentItem = res.data;
        await openDetail(currentItem);
      }
      
      scheduleRender(['cards', 'repoList']);
    }
  } catch (error) {
    console.error('刷新数据失败:', error);
  }
}

// 已删除：快速导入功能（handleQuickInputKeydown）

// 快速加载前 20 条数据（用于初始显示）
async function loadItemsFast() {
  const perfMonitor = window.performanceMonitor;
  const timer = perfMonitor ? perfMonitor.start('load-items-fast') : null;
  
  // 记录开始加载时间，用于计算最小显示时间
  const startTime = Date.now();
  const MIN_DISPLAY_TIME = 800; // 骨架屏最小显示时间（毫秒）
  
  try {
    repoLoading = true;
    scheduleRender('repoList');

    // 显示骨架屏
    if (elDashboardSkeleton && currentView === 'dashboard') {
      renderSkeleton();
      elDashboardSkeleton.classList.remove('hidden');
    }
    // 隐藏实际内容容器
    if (elCardGrid) {
      elCardGrid.classList.add('hidden');
      elCardGrid.classList.remove('fade-in');
    }

    // 显示加载状态
    if (elDashboardSubtitle) {
      elDashboardSubtitle.textContent = '正在加载内容...';
    }
    
    // 快速加载前 20 条
    const pageSize = 20;
    
    repoCurrentPage = 1;
    allItems = [];
    repoLoadedCount = 0;
    
    const res = await itemsAPI.getAll({ type: 'all', page: 1, limit: pageSize });
    
    const newItems = res.data || [];
    allItems = newItems;
    
    repoTotalCount = res.total || allItems.length;
    repoLoadedCount = allItems.length;
    const hasMore = res.hasMore || (repoLoadedCount < repoTotalCount);
    
    console.log(`快速加载了 ${newItems.length} 个项目，已加载 ${repoLoadedCount}/${repoTotalCount}`);
    
    // 先渲染内容，然后再切换显示
    scheduleRender(['cards', 'repoList', 'tagsCloud']);
    
    // 计算已用时间，确保骨架屏至少显示最小时间
    const elapsedTime = Date.now() - startTime;
    const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsedTime);
    
    // 渲染完成后，切换显示状态（使用双重 requestAnimationFrame 确保渲染完成）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 延迟隐藏骨架屏，确保最小显示时间
        setTimeout(() => {
          // 隐藏骨架屏
          if (elDashboardSkeleton && currentView === 'dashboard') {
            elDashboardSkeleton.classList.add('hidden');
          }
          // 显示实际内容容器并添加淡入动画
          if (elCardGrid && currentView === 'dashboard') {
            elCardGrid.classList.remove('hidden');
            // 使用 setTimeout 确保样式已应用
            setTimeout(() => {
              elCardGrid.classList.add('fade-in');
              
              // 内容显示完成后，更新统计信息
              loadDashboardStats().catch(err => {
                console.warn('统计信息加载失败（非关键）:', err);
              });
            }, 10);
          } else {
            // 如果不是 dashboard 视图，也加载统计信息
            loadDashboardStats().catch(err => {
              console.warn('统计信息加载失败（非关键）:', err);
            });
          }
        }, remainingTime);
      });
    });
    
    // 更新加载更多按钮状态
    updateLoadMoreButton('repo', hasMore);
    
    // 如果有更多数据，后台继续加载
    if (hasMore) {
      setTimeout(() => {
        loadItemsFull().catch(err => {
          console.warn('后台加载完整数据失败:', err);
        });
      }, 1000);
    }
    
    repoLoading = false;
    scheduleRender('repoList');

    if (timer && perfMonitor) {
      perfMonitor.end(timer, { success: true, itemCount: newItems.length });
    }
  } catch (error) {
    repoLoading = false;
    scheduleRender('repoList');

    // 错误时也要隐藏骨架屏
    if (elDashboardSkeleton && currentView === 'dashboard') {
      elDashboardSkeleton.classList.add('hidden');
    }
    if (elCardGrid && currentView === 'dashboard') {
      elCardGrid.classList.remove('hidden');
    }

    if (timer && perfMonitor) {
      perfMonitor.end(timer, { success: false, error: error.message });
    }
    console.error('快速加载内容失败:', error);
    if (elDashboardSubtitle) {
      elDashboardSubtitle.textContent = '加载失败，请稍后重试';
    }
    showToast(error.message || '加载内容失败', 'error');
  }
}

// 加载 items（默认排除archived）
// 使用分页加载以提高性能
async function loadItems(reset = true) {
  // 记录开始加载时间，用于计算最小显示时间（仅在重置加载时）
  const startTime = reset ? Date.now() : 0;
  const MIN_DISPLAY_TIME = 800; // 骨架屏最小显示时间（毫秒）
  
  try {
    repoLoading = true;
    scheduleRender('repoList');

    // 如果是重置加载且当前在 dashboard 视图，显示骨架屏
    if (reset && currentView === 'dashboard') {
      if (elDashboardSkeleton) {
        renderSkeleton();
        elDashboardSkeleton.classList.remove('hidden');
      }
      if (elCardGrid) {
        elCardGrid.classList.add('hidden');
        elCardGrid.classList.remove('fade-in');
      }
    }

    // 显示加载状态
    if (elDashboardSubtitle) {
      elDashboardSubtitle.textContent = reset ? '正在加载内容...' : '正在加载更多...';
    }
    
    // 使用合理的分页大小（50条记录）
    const pageSize = 50;
    
    if (reset) {
      repoCurrentPage = 1;
      allItems = [];
      repoLoadedCount = 0;
    }
    
    const res = await itemsAPI.getAll({ type: 'all', page: repoCurrentPage, limit: pageSize });
    
    const newItems = res.data || [];
    allItems = reset ? newItems : [...allItems, ...newItems];
    
    repoTotalCount = res.total || allItems.length;
    repoLoadedCount = allItems.length;
    const hasMore = res.hasMore || (repoLoadedCount < repoTotalCount);
    
    console.log(`加载了 ${newItems.length} 个项目，已加载 ${repoLoadedCount}/${repoTotalCount}`);
    
    // 先渲染内容，然后再切换显示
    scheduleRender(['cards', 'repoList', 'tagsCloud']);
    
    // 如果是重置加载且当前在 dashboard 视图，切换显示状态（使用双重 requestAnimationFrame 确保渲染完成）
    if (reset && currentView === 'dashboard') {
      // 计算已用时间，确保骨架屏至少显示最小时间
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsedTime);
      
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // 延迟隐藏骨架屏，确保最小显示时间
          setTimeout(() => {
            // 隐藏骨架屏
            if (elDashboardSkeleton) {
              elDashboardSkeleton.classList.add('hidden');
            }
            // 显示实际内容容器并添加淡入动画
            if (elCardGrid) {
              elCardGrid.classList.remove('hidden');
              // 使用 setTimeout 确保样式已应用
              setTimeout(() => {
                elCardGrid.classList.add('fade-in');
                
                // 内容显示完成后，更新统计信息
                loadDashboardStats().catch(err => {
                  console.warn('统计信息加载失败（非关键）:', err);
                });
              }, 10);
            }
          }, remainingTime);
        });
      });
    } else {
      // 如果不是重置加载或不在 dashboard 视图，延迟加载统计信息
      setTimeout(() => {
        loadDashboardStats().catch(err => {
          console.warn('统计信息加载失败（非关键）:', err);
        });
      }, 500);
    }
    
    // 更新加载更多按钮状态
    updateLoadMoreButton('repo', hasMore);
  } catch (error) {
    console.error('加载内容失败:', error);
    
    // 错误时也要隐藏骨架屏
    if (reset && elDashboardSkeleton && currentView === 'dashboard') {
      elDashboardSkeleton.classList.add('hidden');
    }
    if (reset && elCardGrid && currentView === 'dashboard') {
      elCardGrid.classList.remove('hidden');
    }
    
    if (elDashboardSubtitle) {
      elDashboardSubtitle.textContent = '加载失败，请稍后重试';
    }
    showToast(error.message || '加载内容失败', 'error');
  } finally {
    repoLoading = false;
    scheduleRender('repoList');
  }
}

// 后台加载完整数据（用于补充快速加载的数据）
async function loadItemsFull() {
  try {
    if (repoLoadedCount >= repoTotalCount) {
      return; // 已经加载完所有数据
    }
    
    repoCurrentPage++;
    const res = await itemsAPI.getAll({ type: 'all', page: repoCurrentPage, limit: 30 });
    
    const newItems = res.data || [];
    allItems = [...allItems, ...newItems];
    
    repoLoadedCount = allItems.length;
    const hasMore = res.hasMore || (repoLoadedCount < repoTotalCount);
    
    console.log(`后台加载了 ${newItems.length} 个项目，总计 ${repoLoadedCount}/${repoTotalCount}`);
    
    scheduleRender(['cards', 'repoList', 'tagsCloud']);
    updateLoadMoreButton('repo', hasMore);
    
    // 如果还有更多，继续加载
    if (hasMore && repoLoadedCount < repoTotalCount) {
      setTimeout(() => {
        loadItemsFull().catch(err => {
          console.warn('继续加载数据失败:', err);
        });
      }, 500);
    }
  } catch (error) {
    console.warn('后台加载数据失败（非关键）:', error);
  }
}

// 文档库上传处理：在当前视图上传PDF并刷新列表
async function handleRepoUpload() {
  const btnRepoUpload = document.getElementById('btn-repo-upload');
  const originalHtml = btnRepoUpload ? btnRepoUpload.innerHTML : '';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      if (btnRepoUpload) {
        btnRepoUpload.disabled = true;
        btnRepoUpload.innerHTML = '上传中...';
      }

      // 复用现有 PDF 上传逻辑
      const { uploadPDF } = await import('./pdf.js');
      const result = await uploadPDF(file, null);

      // 上传成功后清除缓存并刷新文档库列表
      try {
        clearAPICache();
      } catch (err) {
        console.warn('清除API缓存失败（文档库上传后）:', err);
      }

      await loadItems(true);

      // 友好提示
      await showAlert('PDF 上传成功！文档已加入当前知识库，可在智能问答中用于提问。', {
        type: 'success',
        title: '上传成功'
      });
    } catch (error) {
      console.error('文档库上传失败:', error);
      await showAlert('上传失败: ' + (error.message || '请稍后重试'), {
        type: 'error',
        title: '上传失败'
      });
    } finally {
      if (btnRepoUpload) {
        btnRepoUpload.disabled = false;
        btnRepoUpload.innerHTML = originalHtml;
      }
    }
  };

  input.click();
}

// 加载更多知识库项目
async function loadMoreItems() {
  repoCurrentPage++;
  await loadItems(false);
}


// 设置相关
function openSettingsModal() {
  // 打开设置时重新加载设置，确保显示最新的API Key状态
  loadSettings().then(() => {
    elSettingsModal.classList.remove('hidden');
    elSettingsModal.classList.add('flex');
    requestAnimationFrame(() => {
      elSettingsContent.classList.remove('opacity-0', 'scale-95');
      elSettingsContent.classList.add('opacity-100', 'scale-100');
    });
  });
}

function closeSettingsModal() {
  elSettingsContent.classList.remove('opacity-100', 'scale-100');
  elSettingsContent.classList.add('opacity-0', 'scale-95');
  setTimeout(() => {
    elSettingsModal.classList.add('hidden');
    elSettingsModal.classList.remove('flex');
  }, 160);
}

// 打开引导模态框
function openGuideModal() {
  if (!elGuideModal || !elGuideContent) return;
  
  elGuideModal.classList.remove('hidden');
  elGuideModal.classList.add('flex');
  
  // 初始化Lucide图标
  if (typeof lucide !== 'undefined') {
    lucide.createIcons(elGuideModal);
  }
  
  requestAnimationFrame(() => {
    elGuideContent.classList.remove('opacity-0', 'scale-95');
    elGuideContent.classList.add('opacity-100', 'scale-100');
  });
}

// 关闭引导模态框
function closeGuideModal() {
  if (!elGuideContent) return;
  
  elGuideContent.classList.remove('opacity-100', 'scale-100');
  elGuideContent.classList.add('opacity-0', 'scale-95');
  
  setTimeout(() => {
    if (elGuideModal) {
      elGuideModal.classList.add('hidden');
      elGuideModal.classList.remove('flex');
    }
  }, 160);
}

async function loadSettings() {
  try {
    // 加载用户管理模块
    const { getCurrentUser, getCurrentUserApiKey, isCurrentUserApiKeyConfigured } = await import('./user-manager.js');
    
    // 获取当前用户信息
    const currentUser = getCurrentUser();
    const userApiKey = getCurrentUserApiKey();
    const userApiConfigured = isCurrentUserApiKeyConfigured();
    
    // 更新用户信息显示
    const currentUserNameEl = document.getElementById('current-user-name');
    const currentUserApiStatusEl = document.getElementById('current-user-api-status');
    if (currentUserNameEl) {
      currentUserNameEl.textContent = currentUser.name || '用户1';
    }
    if (currentUserApiStatusEl) {
      currentUserApiStatusEl.textContent = userApiConfigured 
        ? 'API Key: 已配置' 
        : 'API Key: 未配置（请配置您的个人API Key）';
      currentUserApiStatusEl.className = userApiConfigured 
        ? 'text-xs text-green-600 mt-1' 
        : 'text-xs text-slate-400 mt-1';
    }
    
    // 在输入框中显示当前用户的API Key（如果有）
    if (elInputApiKey) {
      if (userApiKey) {
        // 显示masked版本
        const masked = userApiKey.substring(0, 4) + '...' + userApiKey.substring(userApiKey.length - 4);
        elInputApiKey.value = masked;
      } else {
        elInputApiKey.value = '';
      }
    }
    
    // 更新全局API配置状态（用于向后兼容）
    apiConfigured = userApiConfigured;
    
    // 更新API状态显示（使用用户API Key状态）
    if (userApiConfigured) {
      elApiStatusText.textContent = 'DeepSeek 已配置';
      elApiPill.classList.remove('hidden');
      elApiPill.querySelector('span.w-2').classList.remove('bg-red-500');
      elApiPill.querySelector('span.w-2').classList.add('bg-green-500');
      elApiPill.lastChild.textContent = ' DeepSeek 已连接';
    } else {
      elApiStatusText.textContent = 'API 未配置';
      elApiPill.classList.remove('hidden');
      elApiPill.querySelector('span.w-2').classList.remove('bg-green-500');
      elApiPill.querySelector('span.w-2').classList.add('bg-red-500');
      elApiPill.lastChild.textContent = ' DeepSeek 未连接';
    }
    
    // 加载其他设置（模型、评估开关等）从服务器
    try {
      const res = await settingsAPI.get();
      const data = res.data || {};
      
      if (data.deepseek_model) {
        elSelectModel.value = data.deepseek_model;
      }

      // 加载评估开关设置
      if (elToggleEvaluation) {
        const evaluationEnabled = data.enable_relevance_evaluation;
        elToggleEvaluation.checked = evaluationEnabled === undefined || evaluationEnabled === 'true' || evaluationEnabled === true;
      }
    } catch (e) {
      console.warn('加载服务器设置失败:', e);
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

async function saveSettings() {
  const apiKeyInput = elInputApiKey.value.trim();
  const model = elSelectModel.value;
  const enableRelevanceEvaluation = elToggleEvaluation ? elToggleEvaluation.checked : true;

  try {
    // 加载用户管理模块
    const { setCurrentUserApiKey, getCurrentUserApiKey } = await import('./user-manager.js');
    
    // 检查输入的是完整API Key还是masked版本
    let apiKeyToSave = apiKeyInput;
    const currentApiKey = getCurrentUserApiKey();
    
    // 如果输入的是masked版本（包含...），说明用户没有修改，保持原值
    if (apiKeyInput.includes('...') && currentApiKey) {
      apiKeyToSave = currentApiKey;
    } else if (apiKeyInput && apiKeyInput.startsWith('sk-')) {
      // 如果是完整的API Key，保存它
      apiKeyToSave = apiKeyInput;
    } else if (!apiKeyInput) {
      // 如果清空了，删除API Key
      apiKeyToSave = null;
    } else {
      // 其他情况，可能是用户输入了新的完整API Key
      apiKeyToSave = apiKeyInput;
    }
    
    // 保存到用户配置（localStorage）
    if (apiKeyToSave) {
      setCurrentUserApiKey(apiKeyToSave);
    } else {
      setCurrentUserApiKey(null);
    }
    
    // 保存其他设置到服务器（向后兼容，保留全局设置）
    await settingsAPI.update({ apiKey: null, model, enableRelevanceEvaluation }); // 不保存API Key到服务器
    
    elSettingsMessage.textContent = '设置已保存';
    elSettingsMessage.className = 'mt-3 text-xs text-green-600';
    apiConfigured = !!apiKeyToSave;
    
    // 重新加载设置，更新显示
    await loadSettings();
  } catch (error) {
    console.error('保存设置失败:', error);
    elSettingsMessage.textContent = error.message || '保存失败';
    elSettingsMessage.className = 'mt-3 text-xs text-red-600';
  }
}

async function testAPI() {
  const apiKeyInput = elInputApiKey.value.trim();
  elSettingsMessage.textContent = '正在测试连接...';
  elSettingsMessage.className = 'mt-3 text-xs text-slate-500';
  
  try {
    // 加载用户管理模块
    const { getCurrentUserApiKey } = await import('./user-manager.js');
    
    // 确定要测试的API Key
    let apiKeyToTest = apiKeyInput;
    const currentApiKey = getCurrentUserApiKey();
    
    // 如果输入的是masked版本，使用当前保存的API Key
    if (apiKeyInput.includes('...') && currentApiKey) {
      apiKeyToTest = currentApiKey;
    } else if (!apiKeyInput || !apiKeyInput.startsWith('sk-')) {
      // 如果输入为空或格式不对，使用当前保存的API Key
      apiKeyToTest = currentApiKey;
    }
    
    if (!apiKeyToTest) {
      elSettingsMessage.textContent = '请先输入API Key';
      elSettingsMessage.className = 'mt-3 text-xs text-red-600';
      return;
    }
    
    const res = await settingsAPI.testAPI(apiKeyToTest);
    elSettingsMessage.textContent = res.message;
    elSettingsMessage.className = `mt-3 text-xs ${
      res.success ? 'text-green-600' : 'text-red-600'
    }`;
  } catch (error) {
    elSettingsMessage.textContent = error.message || '测试失败';
    elSettingsMessage.className = 'mt-3 text-xs text-red-600';
  }
}

// 切换用户
async function handleSwitchUser() {
  try {
    const { getUserList, switchUser, createUser, getCurrentUserId } = await import('./user-manager.js');
    
    const userList = getUserList();
    const currentUserId = getCurrentUserId();
    
    // 创建模态对话框
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.id = 'switch-user-modal';
    
    modal.innerHTML = `
      <div class="glass w-full max-w-md rounded-2xl shadow-2xl p-6 transform transition-all duration-200 scale-95 opacity-0">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-slate-900">切换用户</h2>
          <button
            id="btn-close-switch-user"
            class="text-slate-400 hover:text-slate-600"
          >
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
        
        <div class="mb-4">
          <p class="text-sm text-slate-600 mb-3">选择要切换的用户：</p>
          <div id="user-list-container" class="space-y-2 max-h-64 overflow-y-auto">
            <!-- 用户列表将在这里动态生成 -->
          </div>
        </div>
        
        <div class="border-t pt-4 mt-4">
          <p class="text-sm text-slate-600 mb-3">或创建新用户：</p>
          <div class="flex gap-2">
            <input
              type="text"
              id="new-user-name"
              class="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="输入新用户名"
            />
            <button
              id="btn-create-user"
              class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
            >
              创建
            </button>
          </div>
        </div>
        
        <div class="flex justify-end gap-2 mt-6">
          <button
            id="btn-cancel-switch-user"
            class="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium"
          >
            取消
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // 生成用户列表选项
    const userListContainer = modal.querySelector('#user-list-container');
    userList.forEach(user => {
      const isCurrent = user.id === currentUserId;
      const userItem = document.createElement('label');
      userItem.className = `flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
        isCurrent 
          ? 'border-indigo-500 bg-indigo-50' 
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
      }`;
      
      userItem.innerHTML = `
        <input
          type="radio"
          name="selected-user"
          value="${user.id}"
          class="mr-3 text-indigo-600 focus:ring-indigo-500"
          ${isCurrent ? 'checked' : ''}
        />
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium text-slate-900">${user.name}</span>
            ${isCurrent ? '<span class="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded">当前</span>' : ''}
          </div>
          <div class="text-xs text-slate-500 mt-1">
            ${user.hasApiKey ? '✓ 已配置 API Key' : '未配置 API Key'}
          </div>
        </div>
      `;
      
      userItem.addEventListener('click', () => {
        // 移除其他选中状态
        userListContainer.querySelectorAll('label').forEach(label => {
          label.classList.remove('border-indigo-500', 'bg-indigo-50');
          label.classList.add('border-slate-200');
        });
        // 添加当前选中状态
        userItem.classList.add('border-indigo-500', 'bg-indigo-50');
        userItem.classList.remove('border-slate-200');
      });
      
      userListContainer.appendChild(userItem);
    });
    
    // 关闭按钮
    const closeModal = () => {
      modal.classList.add('opacity-0');
      setTimeout(() => {
        document.body.removeChild(modal);
      }, 200);
    };
    
    modal.querySelector('#btn-close-switch-user').addEventListener('click', closeModal);
    modal.querySelector('#btn-cancel-switch-user').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    
    // 创建新用户按钮
    modal.querySelector('#btn-create-user').addEventListener('click', async () => {
      const newUserName = modal.querySelector('#new-user-name').value.trim();
      if (!newUserName) {
        showToast('请输入用户名', 'error');
        return;
      }
      
      // 检查用户名是否已存在
      if (userList.find(u => u.name === newUserName)) {
        showToast('用户名已存在', 'error');
        return;
      }
      
      const newUserId = createUser(newUserName);
      switchUser(newUserId);
      showToast(`已创建并切换到用户: ${newUserName}`, 'success');
      closeModal();
      await loadSettings();
    });
    
    // 切换用户（双击或点击确认）
    userListContainer.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', async (e) => {
        if (e.target.checked) {
          const selectedUserId = e.target.value;
          const selectedUser = userList.find(u => u.id === selectedUserId);
          if (selectedUser && selectedUser.id !== currentUserId) {
            switchUser(selectedUserId);
            showToast(`已切换到用户: ${selectedUser.name}`, 'success');
            closeModal();
            await loadSettings();
          }
        }
      });
    });
    
    // 双击切换
    userListContainer.querySelectorAll('label').forEach(label => {
      label.addEventListener('dblclick', async () => {
        const radio = label.querySelector('input[type="radio"]');
        if (radio && radio.value !== currentUserId) {
          const selectedUser = userList.find(u => u.id === radio.value);
          if (selectedUser) {
            switchUser(selectedUser.id);
            showToast(`已切换到用户: ${selectedUser.name}`, 'success');
            closeModal();
            await loadSettings();
          }
        }
      });
    });
    
    // 显示动画
    requestAnimationFrame(() => {
      modal.querySelector('.glass').classList.add('opacity-100', 'scale-100');
      modal.querySelector('.glass').classList.remove('opacity-0', 'scale-95');
    });
  } catch (error) {
    console.error('切换用户失败:', error);
    showToast('切换用户失败: ' + (error.message || '未知错误'), 'error');
  }
}

// 事件绑定
function bindEvents() {
  try {
    // 导航
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        switchView(view);
        if (window.innerWidth < 1024) toggleSidebar(false);
      });
    });

  // 过滤
  if (elFilterContainer) {
    elFilterContainer.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });
  }

  // 文档库上传按钮：复用咨询视图的上传逻辑
  const btnRepoUpload = document.getElementById('btn-repo-upload');
  if (btnRepoUpload) {
    btnRepoUpload.addEventListener('click', () => {
      handleRepoUpload();
    });
  }

  // 监听 PDF 上传完成事件，刷新文档库数据
  document.addEventListener('pdfUploaded', async (e) => {
    try {
      // 确保获取最新数据
      clearAPICache();
      await loadItems();
    } catch (err) {
      console.error('PDF 上传后刷新文档库失败:', err);
    }
  });

  // 已删除：快速输入和全局搜索事件监听器
  
  // 卡片点击事件委托（性能优化：单个监听器代替N个）
  if (elCardGrid) {
    elCardGrid.addEventListener('click', async (e) => {
      const card = e.target.closest('article[data-id]');
      if (!card) return;
      const id = card.getAttribute('data-id');
      const item = allItems.find((it) => it.id === id);
      if (item) await openDetail(item);
    });
  }
  
  // 知识库列表事件委托（性能优化：单个监听器代替N个）
  if (elRepoList) {
    elRepoList.addEventListener('click', async (e) => {
      const actionBtn = e.target.closest('[data-action]');
      
      // 如果点击的是按钮，处理按钮操作
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-action');
        const id = actionBtn.getAttribute('data-id');
        const item = allItems.find((it) => it.id === id);
        
        if (!item) return;
        
        if (action === 'extract') {
        // 提取知识
        try {
          // 获取当前知识库ID
          const { getCurrentKnowledgeBaseId } = await import('./knowledge-bases.js');
          const currentKbId = getCurrentKnowledgeBaseId();
          
          // 导入提取模块
          const { extractFromDocument } = await import('./knowledge-extraction.js');
          const { showToast } = await import('./toast.js');
          
          // 不再显示toast，进度信息由底部进度条显示
          
          // 开始提取
          await extractFromDocument(id, currentKbId, async (progress) => {
            if (progress.status === 'completed') {
              // 清除缓存并刷新文档列表以显示更新后的提取状态
              clearAPICache();
              await loadItems();
              // 显示成功提示
              const { showToast } = await import('./toast.js');
              showToast(
                `提取完成！成功生成 ${progress.extractedCount || 0} 个知识点，正在跳转到知识库...`,
                'success',
                3000
              );
              
              // 延迟跳转到知识库视图，让用户看到完成提示
              setTimeout(() => {
                switchView('knowledge-items');
                // 刷新知识库列表以显示新提取的内容
                setTimeout(async () => {
                  try {
                    const { initKnowledgeView } = await import('./knowledge-items.js');
                    await initKnowledgeView();
                  } catch (e) {
                    console.warn('刷新知识库失败:', e);
                  }
                }, 500);
              }, 1500);
            }
            // 进度信息由进度条显示，不再使用toast
          });
        } catch (error) {
          console.error('提取知识失败:', error);
          // 错误信息由进度条显示，不再使用toast
        }
      } else if (action === 'view') {
        await openDetail(item);
      } else if (action === 'archive') {
        const confirmMessage = `确定要将「${item.title}」标记为已贯通吗？\n\n归档后，此知识点将：\n• 不再出现在智能问答中\n• 可在归档页面查看和恢复`;
        try {
          await showConfirm(confirmMessage, {
            title: '确认归档',
            type: 'warning'
          });
        } catch {
          return; // 用户取消
        }
        try {
          const loadingToast = showLoadingToast('正在归档...');
          try {
            await itemsAPI.archive(id);
            // 清除缓存，避免读取到旧数据
            clearAPICache();
            // 关闭详情面板（如果正在查看被归档的项）
            if (currentItem && currentItem.id === id) {
              closeDetail();
            }
            // 重新从服务器加载数据，确保所有视图数据一致
            await loadItems();
            // 更新统计信息
            if (stats) {
              stats.total = (stats.total || 0) - 1;
              updateDashboardStats();
            }
            loadingToast.close();
            showToast('已归档。此知识点将不再出现在智能问答中', 'success');
          } catch (error) {
            loadingToast.close();
            console.error('归档失败:', error);
            showToast(error.message || '归档失败', 'error');
          }
        } catch (error) {
          console.error('归档失败:', error);
          showToast(error.message || '归档失败', 'error');
        }
      } else if (action === 'delete') {
        try {
          await showConfirm(`确定要删除 "${item.title}" 吗？删除后可在归档页面恢复。`, {
            title: '确认删除',
            type: 'warning'
          });
        } catch {
          return; // 用户取消
        }
        try {
          const loadingToast = showLoadingToast('正在删除...');
          try {
            await itemsAPI.delete(id);
            // 清除缓存，避免读取到旧数据
            clearAPICache();
            // 关闭详情面板（如果正在查看被删除的项）
            if (currentItem && currentItem.id === id) {
              closeDetail();
            }
            // 重新从服务器加载数据，确保所有视图数据一致
            await loadItems();
            // 更新统计信息
            if (stats) {
              stats.total = (stats.total || 0) - 1;
              updateDashboardStats();
            }
            loadingToast.close();
            showToast('删除成功', 'success');
          } catch (error) {
            loadingToast.close();
            console.error('删除失败:', error);
            showToast(error.message || '删除失败', 'error');
          }
        } catch (error) {
          console.error('删除失败:', error);
          showToast(error.message || '删除失败', 'error');
        }
      }
      return; // 按钮操作已处理，不再继续
      }
      
      // 如果不是点击按钮，检查是否点击在表格行上
      const row = e.target.closest('tr[data-id]');
      if (row) {
        const id = row.getAttribute('data-id');
        if (id && window.openDetailById) {
          await window.openDetailById(id);
        }
      }
    });
  }
  
  // 归档列表事件委托（性能优化：单个监听器代替N个）
  if (elArchiveList) {
    elArchiveList.addEventListener('click', async (e) => {
      const actionBtn = e.target.closest('[data-action]');
      
      // 如果点击的是按钮，处理按钮操作
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-action');
        const id = actionBtn.getAttribute('data-id');
        const item = archivedItems.find((it) => it.id === id);
        
        if (!item) return;
        
        if (action === 'view') {
        await openDetail(item);
      } else if (action === 'restore') {
        try {
          const loadingToast = showLoadingToast('正在恢复...');
          try {
            await itemsAPI.restore(id);
            // 清除缓存，避免读取到旧数据
            clearAPICache();
            // 重新加载文档库和归档列表，确保数据一致
            await loadItems();
            await loadArchivedItems();
            if (stats) {
              stats.total = (stats.total || 0) + 1;
              stats.archived = (stats.archived || 0) - 1;
              updateDashboardStats();
            }
            loadingToast.close();
            showToast('恢复成功', 'success');
          } catch (error) {
            loadingToast.close();
            console.error('恢复失败:', error);
            showToast(error.message || '恢复失败', 'error');
          }
        } catch (error) {
          console.error('恢复失败:', error);
          showToast(error.message || '恢复失败', 'error');
        }
      } else if (action === 'permanent-delete') {
        try {
          await showConfirm(`确定要永久删除 "${item.title}" 吗？此操作不可恢复！`, {
            title: '确认永久删除',
            type: 'error',
            confirmText: '永久删除'
          });
        } catch {
          return; // 用户取消
        }
        try {
          const loadingToast = showLoadingToast('正在永久删除...');
          try {
            await itemsAPI.permanentDelete(id);
            // 清除缓存，避免读取到旧数据
            clearAPICache();
            // 关闭详情面板（如果正在查看被删除的项）
            if (currentItem && currentItem.id === id) {
              closeDetail();
            }
            // 重新从服务器加载归档列表，确保数据一致
            await loadArchivedItems();
            // 更新统计信息
            if (stats) {
              stats.archived = (stats.archived || 0) - 1;
              updateDashboardStats();
            }
            loadingToast.close();
            showToast('永久删除成功', 'success');
          } catch (error) {
            loadingToast.close();
            console.error('永久删除失败:', error);
            showToast(error.message || '永久删除失败', 'error');
          }
        } catch (error) {
          console.error('永久删除失败:', error);
          showToast(error.message || '永久删除失败', 'error');
        }
      }
      return; // 按钮操作已处理，不再继续
      }
      
      // 如果不是点击按钮，检查是否点击在表格行上
      const row = e.target.closest('tr[data-id]');
      if (row) {
        const id = row.getAttribute('data-id');
        if (id && window.openDetailById) {
          await window.openDetailById(id);
        }
      }
    });
  }

  // 详情关闭
  if (elBtnCloseDetail) {
    elBtnCloseDetail.addEventListener('click', closeDetail);
  }

  // 聊天
  if (elBtnSendChat) elBtnSendChat.addEventListener('click', handleSendChat);
  if (elChatInput) {
    const chatInputContainer = document.getElementById('chat-input-container');
    
    // 自动调整输入框高度
    elChatInput.addEventListener('input', () => {
      elChatInput.style.height = 'auto';
      elChatInput.style.height = `${Math.min(elChatInput.scrollHeight, 200)}px`;
    });

    // 聚焦时优化样式
    elChatInput.addEventListener('focus', () => {
      if (chatInputContainer) {
        chatInputContainer.classList.add('ring-2', 'ring-indigo-500/20', 'border-indigo-300', 'shadow-md');
        chatInputContainer.classList.remove('border-slate-200', 'shadow-sm');
      }
    });

    elChatInput.addEventListener('blur', () => {
      if (chatInputContainer) {
        chatInputContainer.classList.remove('ring-2', 'ring-indigo-500/20', 'border-indigo-300', 'shadow-md');
        chatInputContainer.classList.add('border-slate-200', 'shadow-sm');
      }
    });
    
    elChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSendChat();
      }
    });
  }

  // 摘要
  if (elBtnGenerateSummary) {
    elBtnGenerateSummary.addEventListener('click', handleGenerateSummary);
  }

  // 设置
  if (elBtnOpenSettings) {
    elBtnOpenSettings.addEventListener('click', openSettingsModal);
  }
  if (elBtnCloseSettings) {
    elBtnCloseSettings.addEventListener('click', closeSettingsModal);
  }
  if (elSettingsModal) {
    elSettingsModal.addEventListener('click', (e) => {
      if (e.target === elSettingsModal) closeSettingsModal();
    });
  }

  // 引导模态框
  if (elBtnOpenGuide) {
    elBtnOpenGuide.addEventListener('click', openGuideModal);
  }
  if (elBtnCloseGuide) {
    elBtnCloseGuide.addEventListener('click', closeGuideModal);
  }
  if (elBtnCloseGuideFooter) {
    elBtnCloseGuideFooter.addEventListener('click', closeGuideModal);
  }
  if (elGuideModal) {
    elGuideModal.addEventListener('click', (e) => {
      if (e.target === elGuideModal) closeGuideModal();
    });
  }
  // 引导中打开设置的快捷按钮
  if (elBtnGuideOpenSettings) {
    elBtnGuideOpenSettings.addEventListener('click', () => {
      closeGuideModal();
      setTimeout(() => {
        openSettingsModal();
      }, 200);
    });
  }
  
  // ESC键关闭引导模态框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elGuideModal && !elGuideModal.classList.contains('hidden')) {
      closeGuideModal();
    }
  });
  if (elBtnToggleApiKey) {
    elBtnToggleApiKey.addEventListener('click', () => {
      if (elInputApiKey.type === 'password') {
        elInputApiKey.type = 'text';
        elBtnToggleApiKey.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      } else {
        elInputApiKey.type = 'password';
        elBtnToggleApiKey.innerHTML = '<i class="fa-solid fa-eye"></i>';
      }
    });
  }
  if (elBtnSaveSettings) elBtnSaveSettings.addEventListener('click', saveSettings);
  if (elBtnTestApi) elBtnTestApi.addEventListener('click', testAPI);
  
  // 切换用户按钮
  const elBtnSwitchUser = document.getElementById('btn-switch-user');
  if (elBtnSwitchUser) {
    elBtnSwitchUser.addEventListener('click', handleSwitchUser);
  }

  // 导出
  if (elBtnExportJSON) {
    elBtnExportJSON.addEventListener('click', () => exportAPI.exportJSON());
  }
  if (elBtnExportMD) {
    elBtnExportMD.addEventListener('click', () => exportAPI.exportMarkdown());
  }

  // 搜索
  if (elRepoSearchInput) {
    // 使用防抖优化搜索性能
    elRepoSearchInput.addEventListener('input', debounce(() => {
      renderRepoList();
    }, 300));
  }
  
  // 知识库排序
  document.querySelectorAll('[id^="repo-sort-"]').forEach(th => {
    th.addEventListener('click', () => {
      const sortField = th.dataset.sort;
      if (repoSortBy === sortField) {
        // 同一字段，切换排序方向
        repoSortOrder = repoSortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        // 不同字段，设置为新字段，默认降序
        repoSortBy = sortField;
        repoSortOrder = 'desc';
      }
      updateSortIcons('repo');
      renderRepoList();
    });
  });
  
  // 归档排序
  document.querySelectorAll('[id^="archive-sort-"]').forEach(th => {
    th.addEventListener('click', () => {
      const sortField = th.dataset.sort;
      if (archiveSortBy === sortField) {
        archiveSortOrder = archiveSortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        archiveSortBy = sortField;
        archiveSortOrder = 'desc';
      }
      updateSortIcons('archive');
      renderArchiveList();
    });
  });

  // 归档搜索
  if (elArchiveSearchInput) {
    // 使用防抖优化搜索性能
    elArchiveSearchInput.addEventListener('input', debounce(() => {
      renderArchiveList();
    }, 300));
  }
  
  // 加载更多按钮
  const elBtnLoadMoreRepo = document.getElementById('btn-load-more-repo');
  if (elBtnLoadMoreRepo) {
    elBtnLoadMoreRepo.addEventListener('click', loadMoreItems);
  }
  
  const elBtnLoadMoreArchive = document.getElementById('btn-load-more-archive');
  if (elBtnLoadMoreArchive) {
    elBtnLoadMoreArchive.addEventListener('click', loadMoreArchivedItems);
  }

  // 状态筛选按钮
  const statusFilterButtons = document.querySelectorAll('.status-filter-btn');
  statusFilterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.statusFilter;
      currentStatusFilter = filter;
      
      // 更新按钮样式
      statusFilterButtons.forEach((b) => {
        b.classList.remove('bg-slate-800', 'text-white');
        b.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-200');
      });
      btn.classList.add('bg-slate-800', 'text-white');
      btn.classList.remove('bg-white', 'text-slate-600', 'border', 'border-slate-200');
      
      renderRepoList();
    });
  });

  // 性能监控面板按钮（仅在开发环境显示）
  const elBtnPerformance = document.getElementById('btn-performance-panel');
  if (elBtnPerformance) {
    // 检查是否在开发环境
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' ||
                  window.location.search.includes('perf=1');
    
    if (isDev) {
      elBtnPerformance.classList.remove('hidden');
      elBtnPerformance.addEventListener('click', async () => {
        const { default: performancePanel } = await import('./performance-panel.js');
        performancePanel.toggle();
      });
    }
  }

  // 刷新 - 根据当前视图刷新对应内容
  if (elBtnRefresh) {
    elBtnRefresh.addEventListener('click', async () => {
      // 添加旋转动画
      const icon = elBtnRefresh.querySelector('i');
      if (icon) {
        icon.classList.add('fa-spin');
      }
      elBtnRefresh.disabled = true;
      
      try {
        // 根据当前视图刷新
        if (currentView === 'dashboard') {
          await loadItems();
          showToast('已刷新', 'success');
        } else if (currentView === 'repository') {
          await loadItems();
          renderRepoList();
          showToast('已刷新', 'success');
        } else if (currentView === 'archive') {
          await loadArchivedItems();
          showToast('已刷新', 'success');
        } else if (currentView === 'tags') {
          await loadItems();
          renderTagsCloud();
          showToast('已刷新', 'success');
        }
      } catch (error) {
        console.error('刷新失败:', error);
        showToast('刷新失败', 'error');
      } finally {
        // 移除动画
        if (icon) {
          icon.classList.remove('fa-spin');
        }
        elBtnRefresh.disabled = false;
      }
    });
  }

  // 侧边栏移动端
  if (elMobileMenuBtn) {
    elMobileMenuBtn.addEventListener('click', () => toggleSidebar());
  }
  if (elSidebarOverlay) {
    elSidebarOverlay.addEventListener('click', () => toggleSidebar(false));
  }

  // ESC 关闭详情/设置，F5 刷新
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDetail();
      closeSettingsModal();
    }
    // F5 刷新当前视图
    if (e.key === 'F5' || (e.key === 'r' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (elBtnRefresh && !elBtnRefresh.disabled) {
        elBtnRefresh.click();
      }
    }
  });
  } catch (error) {
    console.error('事件绑定失败:', error);
    console.error('错误堆栈:', error.stack);
  }
}

// 等待 Lucide 加载完成的辅助函数
async function waitForLucide(maxWait = 3000) {
  if (window.lucide) {
    return window.lucide;
  }
  
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (window.lucide) {
        clearInterval(checkInterval);
        resolve(window.lucide);
      } else if (Date.now() - startTime > maxWait) {
        clearInterval(checkInterval);
        reject(new Error('Lucide 加载超时'));
      }
    }, 50);
  });
}

// 初始化图标的辅助函数（带重试机制）
async function initIconsWithRetry() {
  try {
    // 等待 Lucide 加载完成
    await waitForLucide(3000);
    
    if (window.lucide) {
      window.lucide.createIcons();
      console.log('图标初始化完成');
    }
  } catch (e) {
    console.warn('等待 Lucide 加载失败，尝试直接初始化:', e);
    // 如果等待失败，尝试直接初始化（可能 Lucide 已经加载但检测失败）
    if (window.lucide) {
      try {
        window.lucide.createIcons();
        console.log('图标初始化完成（直接初始化）');
      } catch (initError) {
        console.warn('直接初始化图标也失败:', initError);
      }
    } else {
      // 如果 Lucide 确实没加载，延迟重试
      setTimeout(() => {
        if (window.lucide) {
          window.lucide.createIcons();
          console.log('图标初始化完成（延迟重试）');
        }
      }, 500);
    }
  }
}

async function init() {
  try {
    console.log('开始初始化应用...');
    
    // 0. 初始化全局图标（包括左侧导航等静态区域）
    // 使用异步等待，确保 Lucide 加载完成
    initIconsWithRetry();
    
    // 1. 立即显示页面框架（不等待任何数据）
    bindEvents();
    console.log('事件绑定完成');
    
    // 更新问候语（在视图切换之前）
    updateGreeting();
    
    // 从 localStorage 恢复上次的视图，如果没有则默认显示工作台
    const lastView = storage.get('lastView', 'dashboard');
    switchView(lastView); // 这会显示骨架屏
    console.log('视图切换完成:', lastView);
    
    setFilter('all');
    console.log('筛选器设置完成');
    
    // 2. 异步加载数据（不阻塞页面显示）
    // 使用 requestIdleCallback 或 setTimeout 延迟非关键数据加载
    const loadDataAsync = () => {
      // 延迟加载设置（非关键）
      setTimeout(async () => {
        try {
          await loadSettings();
          console.log('设置加载完成');
        } catch (error) {
          console.error('加载设置失败:', error);
        }
      }, 100);
      
      // 延迟加载数据（关键数据，但可以异步）
      setTimeout(async () => {
        try {
          if (lastView === 'knowledge-items') {
            // 知识库视图：快速加载前 20 条
            const { loadKnowledgeItems } = await import('./knowledge-items.js');
            await loadKnowledgeItems({ page: 1, limit: 20 });
          } else if (lastView === 'consultation') {
            // 咨询视图：延迟加载，由咨询模块自己处理
            // 不在这里加载，避免阻塞
          } else {
            // 其他视图：快速加载前 20 条
            await loadItemsFast();
          }
          console.log('数据加载完成');
        } catch (error) {
          console.error('加载数据失败:', error);
          // 即使加载失败，也要显示界面
          if (elDashboardSubtitle) {
            elDashboardSubtitle.textContent = '数据加载失败，请刷新页面重试';
          }
        }
      }, 200);
    };
    
    // 使用 requestIdleCallback（如果支持）或 setTimeout
    if (window.requestIdleCallback) {
      requestIdleCallback(loadDataAsync, { timeout: 500 });
    } else {
      setTimeout(loadDataAsync, 0);
    }
    
    console.log('应用初始化完成（页面框架已显示）');
  } catch (error) {
    console.error('初始化失败:', error);
    console.error('错误堆栈:', error.stack);
    await showAlert('应用初始化失败，请刷新页面重试。错误信息: ' + error.message, {
      type: 'error',
      title: '初始化失败'
    });
  }
}

document.addEventListener('DOMContentLoaded', init);

// 初始化PDF预览器
async function initPDFViewer(itemId, filePath) {
  try {
    const canvas = document.getElementById('pdf-canvas');
    const pageInfo = document.getElementById('pdf-page-info');
    const zoomLevel = document.getElementById('pdf-zoom-level');
    const prevBtn = document.getElementById('pdf-prev-page');
    const nextBtn = document.getElementById('pdf-next-page');
    const zoomInBtn = document.getElementById('pdf-zoom-in');
    const zoomOutBtn = document.getElementById('pdf-zoom-out');
    
    if (!canvas) {
      console.error('PDF canvas元素不存在');
      return;
    }
    
    // 动态加载 PDF.js
    let pdfjsLib;
    try {
      pdfjsLib = await loadPDFJS();
    } catch (error) {
      console.error('PDF.js 加载失败:', error);
      if (pageInfo) {
        pageInfo.textContent = 'PDF.js 加载失败，请刷新页面';
      }
      return;
    }
    
    // 获取PDF文件URL
    const pdfUrl = `/api/files/pdf/${itemId}`;
    
    // 不显示loading toast，因为文档基本信息已经显示
    
    // 加载PDF文档
    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: false
    });
    
    const loadedDoc = await loadingTask.promise;
    if (!loadedDoc) {
      throw new Error('PDF文档为空或加载失败');
    }
    pdfViewerState.pdfDoc = loadedDoc;
    pdfViewerState.totalPages = pdfViewerState.pdfDoc.numPages;
    pdfViewerState.currentPage = 1;
    
    // 不显示成功toast，因为文档已经显示出来了
    
    // 渲染第一页
    await renderPDFPage(pdfViewerState.currentPage);
    
    // 绑定事件（使用节流防止快速连续点击）
    if (prevBtn) {
      prevBtn.addEventListener('click', throttle(() => {
        if (pdfViewerState.isRendering) return; // 如果正在渲染，忽略点击
        if (pdfViewerState.currentPage > 1) {
          pdfViewerState.currentPage--;
          renderPDFPage(pdfViewerState.currentPage);
        }
      }, 300));
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', throttle(() => {
        if (pdfViewerState.isRendering) return; // 如果正在渲染，忽略点击
        if (pdfViewerState.currentPage < pdfViewerState.totalPages) {
          pdfViewerState.currentPage++;
          renderPDFPage(pdfViewerState.currentPage);
        }
      }, 300));
    }
    
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', throttle(() => {
        if (pdfViewerState.isRendering) return; // 如果正在渲染，忽略点击
        pdfViewerState.scale = Math.min(pdfViewerState.scale + 0.25, 3.0);
        renderPDFPage(pdfViewerState.currentPage);
      }, 300));
    }
    
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', throttle(() => {
        if (pdfViewerState.isRendering) return; // 如果正在渲染，忽略点击
        pdfViewerState.scale = Math.max(pdfViewerState.scale - 0.25, 0.5);
        renderPDFPage(pdfViewerState.currentPage);
      }, 300));
    }
    
  } catch (error) {
    console.error('初始化PDF预览器失败:', error);
    showToast('加载PDF失败: ' + (error.message || '未知错误'), 'error');
    const pageInfo = document.getElementById('pdf-page-info');
    if (pageInfo) {
      pageInfo.textContent = '加载失败';
    }
  }
}

// 渲染PDF页面
async function renderPDFPage(pageNum) {
  try {
    // 如果正在渲染，先取消之前的渲染任务
    if (pdfViewerState.isRendering && pdfViewerState.renderTask) {
      try {
        pdfViewerState.renderTask.cancel();
      } catch (e) {
        // 忽略取消错误
      }
    }
    
    const canvas = document.getElementById('pdf-canvas');
    const pageInfo = document.getElementById('pdf-page-info');
    const zoomLevel = document.getElementById('pdf-zoom-level');
    const prevBtn = document.getElementById('pdf-prev-page');
    const nextBtn = document.getElementById('pdf-next-page');
    const zoomInBtn = document.getElementById('pdf-zoom-in');
    const zoomOutBtn = document.getElementById('pdf-zoom-out');
    
    if (!canvas || !pdfViewerState.pdfDoc) {
      return;
    }
    
    // 设置渲染状态
    pdfViewerState.isRendering = true;
    
    // 禁用所有控制按钮
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (zoomInBtn) zoomInBtn.disabled = true;
    if (zoomOutBtn) zoomOutBtn.disabled = true;
    
    // 更新页面信息为加载状态
    if (pageInfo) {
      pageInfo.textContent = `加载中...`;
    }
    
    // 获取页面
    const page = await pdfViewerState.pdfDoc.getPage(pageNum);
    
    // 计算缩放后的尺寸
    const viewport = page.getViewport({ scale: pdfViewerState.scale });
    
    // 设置canvas尺寸
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    // 渲染页面
    const renderContext = {
      canvasContext: canvas.getContext('2d'),
      viewport: viewport
    };
    
    // 创建渲染任务并保存
    pdfViewerState.renderTask = page.render(renderContext);
    await pdfViewerState.renderTask.promise;
    
    // 清除渲染任务
    pdfViewerState.renderTask = null;
    pdfViewerState.isRendering = false;
    
    // 更新页面信息
    if (pageInfo) {
      pageInfo.textContent = `第 ${pageNum} / ${pdfViewerState.totalPages} 页`;
    }
    
    if (zoomLevel) {
      zoomLevel.textContent = `${Math.round(pdfViewerState.scale * 100)}%`;
    }
    
    // 更新按钮状态
    if (prevBtn) {
      prevBtn.disabled = pageNum <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = pageNum >= pdfViewerState.totalPages;
    }
    if (zoomInBtn) {
      zoomInBtn.disabled = pdfViewerState.scale >= 3.0;
    }
    if (zoomOutBtn) {
      zoomOutBtn.disabled = pdfViewerState.scale <= 0.5;
    }
    
  } catch (error) {
    // 清除渲染状态
    pdfViewerState.renderTask = null;
    pdfViewerState.isRendering = false;
    
    // 重新启用按钮
    const prevBtn = document.getElementById('pdf-prev-page');
    const nextBtn = document.getElementById('pdf-next-page');
    const zoomInBtn = document.getElementById('pdf-zoom-in');
    const zoomOutBtn = document.getElementById('pdf-zoom-out');
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = false;
    if (zoomInBtn) zoomInBtn.disabled = false;
    if (zoomOutBtn) zoomOutBtn.disabled = false;
    
    // 检查是否是取消操作（不应该显示错误）
    if (error.name === 'RenderingCancelledException' || error.message && error.message.includes('cancelled')) {
      console.log('渲染已取消');
      return;
    }
    
    console.error('渲染PDF页面失败:', error);
    showToast('渲染PDF页面失败: ' + (error.message || '未知错误'), 'error');
    
    const pageInfo = document.getElementById('pdf-page-info');
    if (pageInfo) {
      pageInfo.textContent = '渲染失败';
    }
  }
}


