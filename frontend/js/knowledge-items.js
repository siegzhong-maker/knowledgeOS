// 知识库视图模块
import { knowledgeAPI } from './api.js';
import { formatTime } from './utils.js';
import { openKnowledgeDetail } from './knowledge-detail.js';
import { renderTimelineView } from './knowledge-timeline.js';

// 分类配置
const CATEGORY_CONFIG = {
  work: { name: '工作', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: 'briefcase' },
  learning: { name: '学习', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: 'book-open' },
  leisure: { name: '娱乐', color: 'bg-red-100 text-red-700 border-red-200', icon: 'gamepad-2' },
  life: { name: '生活', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: 'heart' },
  other: { name: '其他', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: 'circle' }
};

// 状态管理
const knowledgeState = {
  items: [],
  filteredItems: [],
  currentFilter: 'all',
  currentCategoryFilter: 'all', // 新增：分类筛选
  highlightIds: [], // 本次提取需要高亮的知识点ID列表
  searchQuery: '',
  selectedItemId: null,
  loading: false,
  currentPage: 1,
  hasMore: false,
  viewMode: 'grid' // 'grid' | 'timeline'
};

/**
 * 更新状态并重新渲染
 */
function updateState(updates) {
  Object.assign(knowledgeState, updates);
  renderKnowledgeView();
}

/**
 * 加载知识列表
 */
export async function loadKnowledgeItems(filters = {}) {
  try {
    knowledgeState.loading = true;
    renderKnowledgeView(); // 显示加载状态

    // 获取当前知识库ID
    let currentKnowledgeBaseId = null;
    try {
      const { getCurrentKnowledgeBaseId } = await import('./knowledge-bases.js');
      currentKnowledgeBaseId = getCurrentKnowledgeBaseId();
    } catch (e) {
      console.warn('无法获取当前知识库ID:', e);
    }

    const params = {
      page: knowledgeState.currentPage,
      limit: 50,
      ...filters
    };

    // 如果指定了知识库ID，使用指定的；否则使用当前知识库ID
    if (!params.knowledgeBaseId && currentKnowledgeBaseId) {
      params.knowledgeBaseId = currentKnowledgeBaseId;
    }

    if (knowledgeState.currentFilter !== 'all') {
      params.status = knowledgeState.currentFilter;
    }

    if (knowledgeState.searchQuery) {
      params.search = knowledgeState.searchQuery;
    }

    console.log('[知识库] 加载知识列表，参数:', params);

    const response = await knowledgeAPI.getItems(params);
    
    if (!response.success) {
      throw new Error(response.message || '加载失败');
    }

    const { data, total, hasMore } = response;
    
    console.log('[知识库] 获取到知识列表:', {
      count: data?.length || 0,
      total,
      hasMore,
      currentKnowledgeBaseId,
      filters: params
    });
    
    // 调试：检查子分类数据
    if (data && data.length > 0) {
      console.log('[知识库] 知识列表数据示例:', {
        firstItem: {
          id: data[0].id,
          category: data[0].category,
          subcategory_id: data[0].subcategory_id,
          subcategory: data[0].subcategory,
          knowledge_base_id: data[0].knowledge_base_id
        }
      });
    } else {
      console.warn('[知识库] 未获取到知识点数据，可能原因：', {
        currentKnowledgeBaseId,
        filters: params,
        suggestion: '请检查：1) 是否已提取知识 2) 知识是否保存到了当前知识库'
      });
    }
    
    if (knowledgeState.currentPage === 1) {
      knowledgeState.items = data;
    } else {
      knowledgeState.items = [...knowledgeState.items, ...data];
    }

    knowledgeState.hasMore = hasMore;
    knowledgeState.loading = false;

    applyFilters();
    renderKnowledgeView();
  } catch (error) {
    console.error('加载知识列表失败:', error);
    knowledgeState.loading = false;
    renderKnowledgeView();
    // 错误提示会在调用处处理
    throw error;
  }
}

/**
 * 根据标签获取分类（与后端逻辑一致）
 */
function getCategoryFromTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return 'other';
  }
  
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
  
  const categoryCounts = { work: 0, learning: 0, leisure: 0, life: 0, other: 0 };
  
  tags.forEach(tag => {
    const category = TAG_TO_CATEGORY_MAP[tag] || 'other';
    categoryCounts[category]++;
  });
  
  const maxCategory = Object.keys(categoryCounts).reduce((a, b) => 
    categoryCounts[a] > categoryCounts[b] ? a : b
  );
  
  return maxCategory === 'other' && categoryCounts.other === tags.length ? 'other' : maxCategory;
}

/**
 * 应用筛选
 */
function applyFilters() {
  let filtered = [...knowledgeState.items];

  // 状态筛选
  if (knowledgeState.currentFilter !== 'all') {
    filtered = filtered.filter(item => item.status === knowledgeState.currentFilter);
  }

  // 分类筛选
  if (knowledgeState.currentCategoryFilter !== 'all') {
    filtered = filtered.filter(item => {
      const category = item.category || getCategoryFromTags(item.tags || []);
      return category === knowledgeState.currentCategoryFilter;
    });
  }

  // 搜索筛选
  if (knowledgeState.searchQuery) {
    const query = knowledgeState.searchQuery.toLowerCase();
    filtered = filtered.filter(item => 
      item.title.toLowerCase().includes(query) ||
      item.content.toLowerCase().includes(query)
    );
  }

  knowledgeState.filteredItems = filtered;
}

/**
 * 创建置信度徽章
 */
function createConfidenceBadge(score) {
  const isHigh = score >= 80;
  return `
    <div class="flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
      isHigh ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
    }">
      <i data-lucide="${isHigh ? 'check-circle' : 'alert-circle'}" size="12"></i>
      <span>${score}% 置信度</span>
    </div>
  `;
}

/**
 * 创建状态徽章
 */
function createStatusBadge(status) {
  const config = {
    confirmed: { color: 'bg-blue-50 text-blue-600 border-blue-100', label: '已确认', icon: 'check-circle' },
    pending: { color: 'bg-amber-50 text-amber-600 border-amber-100', label: '待审核', icon: 'alert-circle' },
    archived: { color: 'bg-gray-100 text-gray-500 border-gray-200', label: '已归档', icon: 'archive' }
  };
  
  const { color, label, icon } = config[status] || config.confirmed;
  
  return `
    <span class="px-2 py-0.5 rounded-md text-xs font-medium border flex items-center gap-1 ${color}">
      <i data-lucide="${icon}" size="10"></i>
      ${label}
    </span>
  `;
}

/**
 * 创建知识卡片
 */
function createKnowledgeCard(item) {
  // 调试：检查单个item的子分类数据
  if (item.id && (!item.subcategory || !item.subcategory.name)) {
    console.log('知识点缺少子分类:', {
      id: item.id,
      title: item.title?.substring(0, 30),
      category: item.category,
      subcategory_id: item.subcategory_id,
      subcategory: item.subcategory
    });
  }
  
  const card = document.createElement('div');
  card.className = 'group bg-white rounded-xl border border-slate-200 p-5 cursor-pointer hover:shadow-xl hover:border-blue-200 transition-all duration-300 flex flex-col h-full relative overflow-hidden';
  card.setAttribute('data-item-id', item.id);
  
  // 顶部装饰条
  const topBar = document.createElement('div');
  topBar.className = `absolute top-0 left-0 w-full h-1 ${item.confidence_score >= 80 ? 'bg-emerald-500' : 'bg-amber-500'}`;
  card.appendChild(topBar);

  // 卡片内容
  const content = document.createElement('div');
  content.className = 'flex flex-col h-full mt-1';
  
  // 状态和时间
  const header = document.createElement('div');
  header.className = 'flex justify-between items-start mb-3';
  header.innerHTML = `
    <div class="flex gap-2">
      ${createStatusBadge(item.status)}
      <span class="text-xs text-slate-400 flex items-center">
        <i data-lucide="calendar" size="12" class="mr-1"></i>
        ${formatTime(item.created_at)}
      </span>
    </div>
    ${createConfidenceBadge(item.confidence_score)}
  `;
  content.appendChild(header);

  // 标题
  const title = document.createElement('h3');
  title.className = 'font-bold text-slate-800 text-lg mb-2 group-hover:text-blue-600 transition-colors line-clamp-2';
  title.textContent = item.title;
  content.appendChild(title);

  // 内容预览
  const preview = document.createElement('p');
  preview.className = 'text-slate-500 text-sm mb-4 line-clamp-3 flex-grow leading-relaxed';
  preview.textContent = item.content.substring(0, 150) + (item.content.length > 150 ? '...' : '');
  content.appendChild(preview);

  // 分类和子分类标签容器（并排显示）
  const categorySubcategoryContainer = document.createElement('div');
  categorySubcategoryContainer.className = 'flex items-center gap-2 mb-4 flex-wrap';
  
  // 分类标签
  const category = item.category || getCategoryFromTags(item.tags || []);
  const categoryConfig = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.other;
  const categoryBadge = document.createElement('div');
  categoryBadge.className = `inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border ${categoryConfig.color}`;
  categoryBadge.innerHTML = `
    <i data-lucide="${categoryConfig.icon}" size="12"></i>
    <span>${categoryConfig.name}</span>
  `;
  categorySubcategoryContainer.appendChild(categoryBadge);

  // 子分类标签（显示在分类标签旁边）
  if (item.subcategory && item.subcategory.name) {
    const subcategoryBadge = document.createElement('div');
    subcategoryBadge.className = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-slate-600 bg-slate-50 border border-slate-200';
    subcategoryBadge.innerHTML = `
      <i data-lucide="tag" size="10"></i>
      <span>${item.subcategory.name}</span>
    `;
    categorySubcategoryContainer.appendChild(subcategoryBadge);
  }
  
  content.appendChild(categorySubcategoryContainer);

  // 标签
  if (item.tags && item.tags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'flex flex-wrap gap-2 mb-4';
    item.tags.slice(0, 3).forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'text-xs bg-slate-50 text-slate-500 px-2 py-1 rounded border border-slate-100 group-hover:bg-white group-hover:border-blue-100 transition-colors';
      tagEl.textContent = `#${tag}`;
      tagsContainer.appendChild(tagEl);
    });
    content.appendChild(tagsContainer);
  }

  // 底部：来源信息
  const footer = document.createElement('div');
  footer.className = 'pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500';
  const sourceInfo = item.source_item_id ? '来源文档' : '手动创建';
  footer.innerHTML = `
    <div class="flex items-center space-x-1 hover:text-blue-600 transition-colors">
      <i data-lucide="${item.source_item_id ? 'file-text' : 'edit'}" size="14"></i>
      <span>${sourceInfo}</span>
    </div>
    <i data-lucide="chevron-right" size="14" class="text-slate-300 group-hover:text-blue-500 transform group-hover:translate-x-1 transition-transform"></i>
  `;
  content.appendChild(footer);

  card.appendChild(content);

  // 点击事件
  card.addEventListener('click', () => {
    openKnowledgeDetail(item.id);
  });

  // 初始化卡片内的 Lucide 图标
  if (window.lucide) {
    window.lucide.createIcons(card);
  }

  return card;
}

/**
 * 渲染知识视图
 */
export function renderKnowledgeView() {
  const container = document.getElementById('view-knowledge-items-content');
  if (!container) {
    console.warn('知识库视图内容容器不存在');
    return;
  }
  
  // 更新计数
  const countElement = document.getElementById('knowledge-items-count');
  if (countElement) {
    countElement.textContent = `${knowledgeState.filteredItems.length} 条目`;
  }

  // 清空容器
  container.innerHTML = '';

  // 如果正在加载
  if (knowledgeState.loading && knowledgeState.items.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-64 text-slate-400">
        <i data-lucide="loader-2" class="animate-spin mb-3" size="32"></i>
        <p>加载中...</p>
      </div>
    `;
    if (window.lucide) {
      window.lucide.createIcons();
    }
    return;
  }

  // 如果没有数据
  if (knowledgeState.filteredItems.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-64 text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl">
        <div class="bg-slate-50 p-4 rounded-full mb-3">
          <i data-lucide="search" size="32"></i>
        </div>
        <p>没有找到相关知识点</p>
        <button 
          id="btn-go-to-repository"
          class="mt-4 text-blue-600 font-medium text-sm hover:underline"
        >
          去文档库提取新知识
        </button>
      </div>
    `;
    
    // 绑定"去文档库"按钮事件
    const goToRepoBtn = container.querySelector('#btn-go-to-repository');
    if (goToRepoBtn) {
      goToRepoBtn.addEventListener('click', () => {
        if (window.switchView) {
          window.switchView('repository');
        } else {
          console.error('switchView函数未定义');
        }
      });
    }
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
    return;
  }

  // 根据视图模式渲染
  if (knowledgeState.viewMode === 'timeline') {
    // 时间线视图
    const timelineHTML = renderTimelineView(
      knowledgeState.filteredItems,
      (item) => {
        const card = createKnowledgeCard(item);
        // 移除点击事件监听器（时间线视图会统一处理）
        const newCard = card.cloneNode(true);
        return newCard.outerHTML;
      }
    );
    container.innerHTML = timelineHTML;
    
    // 重新绑定卡片点击事件
    container.querySelectorAll('[data-item-id]').forEach(cardEl => {
      const itemId = cardEl.getAttribute('data-item-id');
      if (itemId) {
        cardEl.addEventListener('click', () => {
          openKnowledgeDetail(itemId);
        });
      }
    });
  } else {
    // 网格视图（默认）
    const highlightIds = Array.isArray(knowledgeState.highlightIds) ? knowledgeState.highlightIds : [];
    let latestItems = [];
    let otherItems = [...knowledgeState.filteredItems];

    if (highlightIds.length > 0) {
      const highlightSet = new Set(highlightIds);
      latestItems = knowledgeState.filteredItems.filter(item => highlightSet.has(item.id));
      otherItems = knowledgeState.filteredItems.filter(item => !highlightSet.has(item.id));

      // 按照highlightIds的顺序排序最新列表
      const orderMap = new Map(highlightIds.map((id, index) => [id, index]));
      latestItems.sort((a, b) => {
        const orderA = orderMap.get(a.id) ?? 0;
        const orderB = orderMap.get(b.id) ?? 0;
        return orderA - orderB;
      });
    }

    // 顶部「本次新提取」区域
    if (latestItems.length > 0) {
      const latestSection = document.createElement('div');
      latestSection.className = 'mb-8';

      // 带背景的标题区域
      latestSection.innerHTML = `
        <div class="bg-gradient-to-r from-emerald-50 via-green-50 to-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 text-white shadow-md">
                <i data-lucide="sparkles" size="16"></i>
              </div>
              <div>
                <h3 class="text-base font-bold text-emerald-900">本次新提取</h3>
                <p class="text-xs text-emerald-600 mt-0.5">共 ${latestItems.length} 条知识点</p>
              </div>
            </div>
            <button
              id="btn-clear-latest-highlight"
              class="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 hover:border-emerald-300 transition-colors shadow-sm"
            >
              清除高亮
            </button>
          </div>
        </div>
      `;

      const latestGrid = document.createElement('div');
      latestGrid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';

      latestItems.forEach(item => {
        // 本次新提取区域内，使用与普通列表相同的知识卡片样式
        const card = createKnowledgeCard(item);
        latestGrid.appendChild(card);
      });

      latestSection.appendChild(latestGrid);
      container.appendChild(latestSection);

      // 添加分隔线
      const divider = document.createElement('div');
      divider.className = 'my-6 flex items-center gap-4';
      divider.innerHTML = `
        <div class="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
        <span class="text-xs text-slate-400 font-medium">全部知识</span>
        <div class="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
      `;
      container.appendChild(divider);

      // 初始化最新提取区域的图标
      if (window.lucide) {
        window.lucide.createIcons(latestSection);
      }

      // 绑定清除高亮按钮
      const clearBtn = latestSection.querySelector('#btn-clear-latest-highlight');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          knowledgeState.highlightIds = [];
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.removeItem('latestExtractionHighlightIds');
            }
          } catch (e) {
            console.warn('清除本次提取高亮ID失败:', e);
          }
          renderKnowledgeView();
        });
      }
    }

    // 下面是常规知识列表
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20';
    
    (otherItems.length > 0 ? otherItems : knowledgeState.filteredItems).forEach(item => {
      const card = createKnowledgeCard(item);
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  // 绑定"去文档库"按钮事件
  const goToRepoBtn = container.querySelector('#btn-go-to-repository');
  if (goToRepoBtn) {
    goToRepoBtn.addEventListener('click', () => {
      if (window.switchView) {
        window.switchView('repository');
      } else {
        console.error('switchView函数未定义');
      }
    });
  }

  // 初始化Lucide图标
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 处理筛选变化
 */
export function handleFilterChange(filter) {
  knowledgeState.currentFilter = filter;
  knowledgeState.currentPage = 1;
  loadKnowledgeItems();
}

/**
 * 处理搜索
 */
export function handleSearch(query) {
  knowledgeState.searchQuery = query;
  knowledgeState.currentPage = 1;
  applyFilters();
  renderKnowledgeView();
}

/**
 * 初始化筛选按钮
 */
function initFilterButtons() {
  const container = document.getElementById('knowledge-status-filters');
  if (!container) return;

  container.querySelectorAll('.knowledge-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      handleFilterChange(filter);
      
      // 更新按钮状态
      container.querySelectorAll('.knowledge-filter-btn').forEach(b => {
        if (b.dataset.filter === filter) {
          b.classList.add('bg-slate-800', 'text-white');
          b.classList.remove('bg-white', 'text-slate-600', 'border', 'border-slate-200');
        } else {
          b.classList.remove('bg-slate-800', 'text-white');
          b.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-200');
        }
      });
    });
  });
}

/**
 * 初始化搜索
 */
function initSearch() {
  const searchInput = document.getElementById('knowledge-search-input');
  if (!searchInput) return;

  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch(e.target.value);
    }, 300);
  });
}

/**
 * 初始化知识库视图
 */
export async function initKnowledgeView() {
  // 从 localStorage 中读取本次提取需要高亮的知识点ID
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem('latestExtractionHighlightIds');
      if (stored) {
        const ids = JSON.parse(stored);
        if (Array.isArray(ids)) {
          knowledgeState.highlightIds = ids;
        }
        // 读取一次后清除，避免旧的高亮长期残留
        window.localStorage.removeItem('latestExtractionHighlightIds');
      }
    }
  } catch (e) {
    console.warn('读取本次提取高亮ID失败:', e);
  }

  await loadKnowledgeItems();
  
  // 初始化视图切换器
  initViewSwitcher();
  
  // 初始化筛选按钮
  initFilterButtons();
  
  // 初始化搜索
  initSearch();
  
  // 渲染分类筛选（数据加载完成后）
  renderCategoryFilters();

  // 监听知识库切换事件，重新加载知识列表
  document.addEventListener('knowledgeBaseChanged', async (event) => {
    console.log('[知识库] 知识库已切换，重新加载知识列表');
    knowledgeState.currentPage = 1;
    await loadKnowledgeItems();
  });
}

/**
 * 初始化视图切换器
 */
function initViewSwitcher() {
  const viewModeButtons = document.querySelectorAll('.view-mode-btn');
  viewModeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.viewMode;
      switchViewMode(mode);
    });
  });
  
  // 设置默认视图模式
  if (viewModeButtons.length > 0) {
    const currentMode = knowledgeState.viewMode || 'grid';
    switchViewMode(currentMode);
  }
}

/**
 * 切换视图模式
 */
export function switchViewMode(mode) {
  knowledgeState.viewMode = mode;
  renderKnowledgeView();
  
  // 更新视图切换按钮状态
  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    if (btn.dataset.viewMode === mode) {
      btn.classList.add('bg-white', 'text-slate-700', 'shadow-sm');
      btn.classList.remove('text-slate-500');
    } else {
      btn.classList.remove('bg-white', 'text-slate-700', 'shadow-sm');
      btn.classList.add('text-slate-500');
    }
  });
  
  // 重新初始化Lucide图标
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 切换分类筛选
 */
export function switchCategoryFilter(category) {
  knowledgeState.currentCategoryFilter = category;
  applyFilters();
  renderKnowledgeView();
  renderCategoryFilters();
  
  // 重新初始化Lucide图标
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 渲染分类筛选按钮
 */
function renderCategoryFilters() {
  const container = document.getElementById('knowledge-category-filters');
  if (!container) return;

  // 统计各分类数量
  const categoryCounts = { all: knowledgeState.items.length };
  knowledgeState.items.forEach(item => {
    const category = item.category || getCategoryFromTags(item.tags || []);
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    categoryCounts.all = knowledgeState.items.length;
  });

  const filtersHTML = Object.keys(CATEGORY_CONFIG).map(category => {
    const config = CATEGORY_CONFIG[category];
    const count = categoryCounts[category] || 0;
    const isActive = knowledgeState.currentCategoryFilter === category;
    
    return `
      <button
        data-category="${category}"
        class="category-filter-btn px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
          isActive 
            ? `${config.color} shadow-sm` 
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
        }"
      >
        <div class="flex items-center gap-2">
          <i data-lucide="${config.icon}" size="16"></i>
          <span>${config.name}</span>
          <span class="text-xs opacity-70">(${count})</span>
        </div>
      </button>
    `;
  }).join('');

  // 添加"全部"按钮
  const allCount = categoryCounts.all || 0;
  const isAllActive = knowledgeState.currentCategoryFilter === 'all';
  const allButton = `
    <button
      data-category="all"
      class="category-filter-btn px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        isAllActive 
          ? 'bg-slate-100 text-slate-700 border border-slate-300 shadow-sm' 
          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
      }"
    >
      <div class="flex items-center gap-2">
        <i data-lucide="grid-3x3" size="16"></i>
        <span>全部</span>
        <span class="text-xs opacity-70">(${allCount})</span>
      </div>
    </button>
  `;

  container.innerHTML = allButton + filtersHTML;

  // 绑定点击事件
  container.querySelectorAll('.category-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.dataset.category;
      switchCategoryFilter(category);
    });
  });

  // 初始化Lucide图标
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// 导出状态（供其他模块使用）
export function getKnowledgeState() {
  return knowledgeState;
}

