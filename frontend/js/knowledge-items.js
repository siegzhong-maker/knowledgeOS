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
  highlightFilterActive: false, // 是否只显示本次新提取的卡片
  searchQuery: '',
  selectedItemId: null,
  loading: false,
  currentPage: 1,
  hasMore: false,
  viewMode: 'grid' // 'grid' | 'timeline'
};

// 监听器绑定标志，防止重复绑定
let knowledgeBaseChangedListenerBound = false;

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
  const perfMonitor = window.performanceMonitor;
  const timer = perfMonitor ? perfMonitor.start('load-knowledge-items', filters) : null;
  
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
      limit: 20, // 减少初始加载量，从 50 改为 20
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

    const response = await knowledgeAPI.getItems(params);
    
    if (!response.success) {
      throw new Error(response.message || '加载失败');
    }

    const { data, total, hasMore } = response;
    
    if (knowledgeState.currentPage === 1) {
      knowledgeState.items = data;
    } else {
      knowledgeState.items = [...knowledgeState.items, ...data];
    }

    knowledgeState.hasMore = hasMore;
    knowledgeState.loading = false;

    applyFilters();
    renderKnowledgeView();
    
    if (timer && perfMonitor) {
      perfMonitor.end(timer, { success: true, itemCount: data?.length || 0 });
    }
  } catch (error) {
    if (timer && perfMonitor) {
      perfMonitor.end(timer, { success: false, error: error.message });
    }
    console.error('加载知识列表失败:', error);
    knowledgeState.loading = false;
    renderKnowledgeView();
    // 错误提示会在调用处处理
    throw error;
  }
}

/**
 * 批量确认所有待确认的知识点
 */
async function handleBatchConfirm() {
  try {
    // 获取当前列表中所有 pending 状态的知识点ID
    const pendingItems = knowledgeState.filteredItems.filter(item => item.status === 'pending');
    
    if (pendingItems.length === 0) {
      if (window.showToast) {
        window.showToast('没有待确认的知识点', 'info');
      }
      return;
    }

    const ids = pendingItems.map(item => item.id);
    
    // 显示确认对话框
    const confirmed = confirm(`确定要批量确认 ${ids.length} 个待确认的知识点吗？`);
    if (!confirmed) {
      return;
    }

    // 显示加载状态
    const batchConfirmBtn = document.getElementById('btn-batch-confirm-all');
    if (batchConfirmBtn) {
      batchConfirmBtn.disabled = true;
      batchConfirmBtn.innerHTML = `
        <i data-lucide="loader-2" size="16" class="animate-spin"></i>
        <span>确认中...</span>
      `;
      if (window.lucide) {
        window.lucide.createIcons(batchConfirmBtn);
      }
    }

    // 调用批量确认API
    const response = await knowledgeAPI.batchConfirm(ids);
    
    if (response.success) {
      // 显示成功提示
      if (window.showToast) {
        window.showToast(`成功确认 ${response.count || ids.length} 个知识点`, 'success');
      }
      
      // 重新加载知识列表
      await loadKnowledgeItems();
    } else {
      // 显示失败提示
      if (window.showToast) {
        window.showToast(response.message || '批量确认失败', 'error');
      }
      
      // 恢复按钮状态
      if (batchConfirmBtn) {
        batchConfirmBtn.disabled = false;
        batchConfirmBtn.innerHTML = `
          <i data-lucide="check-circle-2" size="16"></i>
          <span>批量确认全部 (${ids.length})</span>
        `;
        if (window.lucide) {
          window.lucide.createIcons(batchConfirmBtn);
        }
      }
    }
  } catch (error) {
    console.error('批量确认失败:', error);
    if (window.showToast) {
      window.showToast('批量确认失败: ' + (error.message || '未知错误'), 'error');
    }
    
    // 恢复按钮状态
    const batchConfirmBtn = document.getElementById('btn-batch-confirm-all');
    if (batchConfirmBtn) {
      batchConfirmBtn.disabled = false;
      const pendingCount = knowledgeState.filteredItems.filter(item => item.status === 'pending').length;
      batchConfirmBtn.innerHTML = `
        <i data-lucide="check-circle-2" size="16"></i>
        <span>批量确认全部 (${pendingCount})</span>
      `;
      if (window.lucide) {
        window.lucide.createIcons(batchConfirmBtn);
      }
    }
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

  // 防御：如果开启了“只看这些卡片”但没有高亮ID，自动关闭过滤
  if (knowledgeState.highlightFilterActive && (!knowledgeState.highlightIds || knowledgeState.highlightIds.length === 0)) {
    knowledgeState.highlightFilterActive = false;
  }

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

  // 本次新提取筛选（K2）
  if (knowledgeState.highlightFilterActive && knowledgeState.highlightIds.length > 0) {
    // 确保类型一致：将 highlightIds 和 item.id 都转换为字符串
    const highlightSet = new Set(knowledgeState.highlightIds.map(id => String(id)));
    filtered = filtered.filter(item => {
      const itemId = String(item.id);
      return highlightSet.has(itemId);
    });

    // 如果过滤后没有任何卡片，自动退出高亮过滤，恢复全部
    if (filtered.length === 0) {
      knowledgeState.highlightFilterActive = false;
      // 重新应用筛选（此时 highlightFilterActive 已关闭，需要重新过滤）
      // 重新从 items 开始过滤，但跳过 highlightFilterActive 检查
      filtered = [...knowledgeState.items];
      
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
    }
  }

  knowledgeState.filteredItems = filtered;
}

/**
 * 创建置信度徽章
 */
function createConfidenceBadge(score) {
  // 根据置信度确定颜色档位（简化版本，只显示数字）
  let colorClasses;
  if (score >= 90) {
    colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  } else if (score >= 85) {
    colorClasses = 'bg-blue-50 text-blue-700 border-blue-200';
  } else if (score >= 80) {
    colorClasses = 'bg-slate-50 text-slate-600 border-slate-200';
  } else if (score >= 70) {
    colorClasses = 'bg-amber-50 text-amber-600 border-amber-200';
  } else {
    colorClasses = 'bg-orange-50 text-orange-600 border-orange-200';
  }
  
  return `
    <div class="px-2 py-0.5 rounded text-[10px] font-medium border ${colorClasses}">
      ${score}%
    </div>
  `;
}

/**
 * 创建状态徽章
 */
function createStatusBadge(status, item) {
  // 检查metadata以确定是否自动确认或高置信度
  let metadata = {};
  try {
    if (item.metadata) {
      metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
    }
  } catch (e) {
    // 忽略解析错误
  }
  
  const confidence = item.confidence_score || 0;
  const isHighConfidence = confidence >= 85;
  const isAutoConfirmed = metadata.autoConfirmed === true;
  
  let config;
  if (status === 'confirmed') {
    config = {
      color: 'bg-blue-50 text-blue-600 border-blue-100',
      label: isAutoConfirmed ? '已确认（自动）' : '已确认',
      icon: 'check-circle',
      showManual: !isAutoConfirmed
    };
  } else if (status === 'pending') {
    // 所有pending状态统一显示为"待确认"，无论置信度高低
    // 置信度信息通过置信度徽章和顶部装饰条来体现
    config = {
      color: 'bg-slate-100 text-slate-500 border-slate-200',
      label: '待确认',
      icon: 'circle',
      showManual: false
    };
  } else {
    // archived
    config = {
      color: 'bg-gray-100 text-gray-500 border-gray-200',
      label: '已归档',
      icon: 'archive',
      showManual: false
    };
  }
  
  const { color, label, icon, showManual } = config;
  
  return `
    <span class="px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1 ${color}">
      <i data-lucide="${icon}" size="9"></i>
      ${label}
      ${showManual ? '<span class="ml-0.5 text-[9px] opacity-70">(人工)</span>' : ''}
    </span>
  `;
}

/**
 * 创建知识卡片
 */
function createKnowledgeCard(item) {
  const card = document.createElement('div');
  card.className = 'group bg-white rounded-xl border border-slate-200 p-5 cursor-pointer hover:shadow-xl hover:border-blue-200 transition-all duration-300 flex flex-col h-full relative overflow-hidden';
  card.setAttribute('data-item-id', item.id);
  
  // 顶部装饰条 - 根据置信度档位使用不同颜色
  const confidence = item.confidence_score || 0;
  let topBarColor;
  if (confidence >= 90) {
    topBarColor = 'bg-emerald-500'; // 高度可信
  } else if (confidence >= 85) {
    topBarColor = 'bg-cyan-500'; // 可信
  } else if (confidence >= 80) {
    topBarColor = 'bg-blue-500'; // 基本可信
  } else if (confidence >= 70) {
    topBarColor = 'bg-amber-500'; // 一般
  } else {
    topBarColor = 'bg-orange-500'; // 需验证
  }
  
  const topBar = document.createElement('div');
  topBar.className = `absolute top-0 left-0 w-full h-1 ${topBarColor}`;
  card.appendChild(topBar);

  // 卡片内容
  const content = document.createElement('div');
  content.className = 'flex flex-col h-full mt-1';
  
  // 状态和时间
  const header = document.createElement('div');
  header.className = 'flex justify-between items-start mb-3';
  header.innerHTML = `
    <div class="flex gap-2">
      ${createStatusBadge(item.status, item)}
      <span class="text-xs text-slate-400 flex items-center">
        <i data-lucide="calendar" size="12" class="mr-1"></i>
        ${formatTime(item.created_at)}
      </span>
    </div>
    ${createConfidenceBadge(item.confidence_score || 0)}
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

  // 不在这里初始化图标，统一在渲染完成后批量初始化
  // 这样可以提高性能，避免每个卡片都单独初始化

  return card;
}

/**
 * 渲染知识视图
 */
export function renderKnowledgeView() {
  const container = document.getElementById('view-knowledge-items-content');
  if (!container) {
    return;
  }
  
  // 性能监控
  const perfMonitor = window.performanceMonitor;
  const timer = perfMonitor ? perfMonitor.start('render-knowledge-view', { 
    itemCount: knowledgeState.filteredItems.length 
  }) : null;
  
  // 定义 endTimer 辅助函数（确保在所有渲染路径中可访问）
  const endTimer = (metadata = {}) => {
    if (timer && perfMonitor) {
      perfMonitor.end(timer, metadata);
    }
  };
  
  // 更新计数
  const countElement = document.getElementById('knowledge-items-count');
  if (countElement) {
    countElement.textContent = `${knowledgeState.filteredItems.length} 条目`;
  }

  // 清空容器
  container.innerHTML = '';

  // K1: 如果当前筛选是"待确认"，显示提示信息
  if (knowledgeState.currentFilter === 'pending') {
    const pendingCount = knowledgeState.filteredItems.filter(item => item.status === 'pending').length;
    const pendingNotice = document.createElement('div');
    pendingNotice.className = 'mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4';
    pendingNotice.innerHTML = `
      <div class="flex items-start gap-3 mb-3">
        <i data-lucide="alert-circle" size="20" class="text-amber-600 flex-shrink-0 mt-0.5"></i>
        <div class="flex-1">
          <p class="text-sm text-amber-800 font-medium">当前仅显示待人工确认的知识卡片</p>
          <p class="text-xs text-amber-600 mt-1">这些卡片需要您检查并确认后才能用于智能问答</p>
          ${pendingCount > 0 ? `<p class="text-xs text-amber-700 mt-1 font-medium">共有 ${pendingCount} 条待确认的知识点</p>` : ''}
        </div>
      </div>
      ${pendingCount > 0 ? `
        <div class="flex justify-end">
          <button
            id="btn-batch-confirm-all"
            class="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors shadow-sm hover:shadow-md flex items-center gap-2"
          >
            <i data-lucide="check-circle-2" size="16"></i>
            <span>批量确认全部 (${pendingCount})</span>
          </button>
        </div>
      ` : ''}
    `;
    container.appendChild(pendingNotice);
    
    // 初始化图标
    if (window.lucide) {
      window.lucide.createIcons(pendingNotice);
    }

    // 绑定批量确认按钮
    if (pendingCount > 0) {
      const batchConfirmBtn = pendingNotice.querySelector('#btn-batch-confirm-all');
      if (batchConfirmBtn) {
        batchConfirmBtn.addEventListener('click', handleBatchConfirm);
      }
    }
  }

  // 如果正在加载
  if (knowledgeState.loading && knowledgeState.items.length === 0) {
    // 使用骨架屏提供更好的加载体验
    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
        ${Array.from({ length: 6 }).map(() => `
          <div class="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
            <div class="flex justify-between items-start mb-3">
              <div class="flex gap-2">
                <div class="h-5 w-16 bg-slate-200 rounded"></div>
                <div class="h-4 w-20 bg-slate-200 rounded"></div>
              </div>
              <div class="h-5 w-20 bg-slate-200 rounded"></div>
            </div>
            <div class="h-6 w-3/4 bg-slate-200 rounded mb-2"></div>
            <div class="h-4 w-full bg-slate-200 rounded mb-1"></div>
            <div class="h-4 w-5/6 bg-slate-200 rounded mb-4"></div>
            <div class="flex gap-2 mb-4">
              <div class="h-6 w-16 bg-slate-200 rounded"></div>
              <div class="h-6 w-20 bg-slate-200 rounded"></div>
            </div>
            <div class="h-4 w-24 bg-slate-200 rounded"></div>
          </div>
        `).join('')}
      </div>
    `;
    return;
  }

  // 如果没有数据
  if (knowledgeState.filteredItems.length === 0) {
    const isFiltered = knowledgeState.searchQuery || knowledgeState.currentFilter !== 'all' || knowledgeState.currentCategoryFilter !== 'all';
    const isEmpty = knowledgeState.items.length === 0;
    
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center min-h-[400px] bg-white border border-dashed border-slate-200 rounded-xl p-8">
        <div class="w-24 h-24 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-full flex items-center justify-center mb-6 shadow-sm">
          <i data-lucide="${isFiltered ? 'search-x' : 'sparkles'}" size="40" class="text-slate-400"></i>
        </div>
        <h3 class="text-lg font-semibold text-slate-700 mb-2">
          ${isFiltered ? '没有找到匹配的知识点' : isEmpty ? '知识库还是空的' : '暂无知识点'}
        </h3>
        <p class="text-sm text-slate-500 mb-6 text-center max-w-md">
          ${isFiltered 
            ? '尝试调整搜索条件或筛选器，或清除筛选查看全部内容' 
            : isEmpty
              ? '从文档库提取知识卡片，或手动创建知识点开始构建你的知识库'
              : '当前筛选条件下没有知识点'}
        </p>
        <div class="flex items-center gap-3">
          ${isEmpty ? `
            <button 
              id="btn-go-to-repository"
              class="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm hover:shadow-md flex items-center gap-2"
            >
              <i data-lucide="file-text" size="16"></i>
              <span>去文档库提取知识</span>
            </button>
            <button 
              id="btn-create-knowledge"
              class="px-6 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <i data-lucide="plus-circle" size="16"></i>
              <span>手动创建</span>
            </button>
          ` : `
            <button 
              onclick="document.getElementById('knowledge-search-input').value = ''; document.getElementById('knowledge-search-input').dispatchEvent(new Event('input')); document.querySelectorAll('.knowledge-filter-btn, .category-filter-btn').forEach(btn => { if(btn.dataset.filter === 'all' || btn.dataset.category === 'all') btn.click(); });"
              class="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2"
            >
              <i data-lucide="x" size="14"></i>
              <span>清除筛选</span>
            </button>
          `}
        </div>
      </div>
    `;
    
    // 绑定按钮事件
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
    
    const createBtn = container.querySelector('#btn-create-knowledge');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        // TODO: 实现手动创建知识点功能
        if (window.showToast) {
          window.showToast('手动创建功能开发中', 'info');
        }
      });
    }
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
    // 空状态渲染完成
    endTimer({ success: true, viewMode: 'empty' });
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
    
    // 时间线视图渲染完成
    endTimer({ success: true, viewMode: 'timeline', itemCount: knowledgeState.filteredItems.length });
    return;
  } else {
    // 网格视图（默认）- 使用 DocumentFragment 优化 DOM 操作
    const highlightIds = Array.isArray(knowledgeState.highlightIds) ? knowledgeState.highlightIds : [];
    let latestItems = [];
    let otherItems = [...knowledgeState.filteredItems];

    // 如果 highlightFilterActive 为 true，说明已经过滤过了，直接使用 filteredItems
    if (knowledgeState.highlightFilterActive) {
      // 当只显示本次新提取时，直接使用 filteredItems（已经过滤过了）
      latestItems = [...knowledgeState.filteredItems];
      // 按照highlightIds的顺序排序（确保类型一致）
      if (highlightIds.length > 0) {
        const orderMap = new Map(highlightIds.map((id, index) => [String(id), index]));
        latestItems.sort((a, b) => {
          const orderA = orderMap.get(String(a.id)) ?? 0;
          const orderB = orderMap.get(String(b.id)) ?? 0;
          return orderA - orderB;
        });
      }
      otherItems = []; // 不显示其他项目
    } else if (highlightIds.length > 0) {
      // 正常模式：分离出本次新提取和其他项目
      // 确保 highlightIds 和 item.id 都是字符串类型进行比较
      const highlightSet = new Set(highlightIds);
      
      latestItems = knowledgeState.filteredItems.filter(item => {
        const itemId = String(item.id);
        return highlightSet.has(itemId);
      });
      otherItems = knowledgeState.filteredItems.filter(item => {
        const itemId = String(item.id);
        return !highlightSet.has(itemId);
      });

      // 按照highlightIds的顺序排序最新列表
      const orderMap = new Map(highlightIds.map((id, index) => [String(id), index]));
      latestItems.sort((a, b) => {
        const orderA = orderMap.get(String(a.id)) ?? 0;
        const orderB = orderMap.get(String(b.id)) ?? 0;
        return orderA - orderB;
      });
    }

    // 使用 DocumentFragment 批量操作 DOM
    const fragment = document.createDocumentFragment();

    // 顶部「本次新提取」区域（当有 latestItems 时显示）
    if (latestItems.length > 0) {
      const latestSection = document.createElement('div');
      latestSection.className = 'mb-8';

      // 带背景的标题区域（K2: 增加"只看这些卡片"和"返回全部"按钮）
      latestSection.innerHTML = `
        <div class="bg-gradient-to-r from-emerald-50 via-green-50 to-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 shadow-sm">
          <div class="flex items-center justify-between mb-3">
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
          <div class="flex items-center gap-2 flex-wrap">
            ${!knowledgeState.highlightFilterActive ? `
              <button
                id="btn-filter-highlight-only"
                class="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 hover:border-emerald-400 transition-colors shadow-sm flex items-center gap-1.5"
              >
                <i data-lucide="filter" size="14"></i>
                <span>只看这些卡片</span>
              </button>
            ` : `
              <button
                id="btn-filter-highlight-only"
                class="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 border border-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-1.5"
              >
                <i data-lucide="filter" size="14"></i>
                <span>只看这些卡片</span>
              </button>
              <button
                id="btn-filter-all"
                class="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 hover:border-emerald-300 transition-colors shadow-sm flex items-center gap-1.5"
              >
                <i data-lucide="x" size="14"></i>
                <span>返回全部</span>
              </button>
            `}
          </div>
          <p class="text-xs text-emerald-600 mt-2 opacity-75">点击"只看这些卡片"可仅查看本次新提取的知识点</p>
        </div>
      `;

      const latestGrid = document.createElement('div');
      latestGrid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';

      // 分批渲染卡片（每次 10 个，避免阻塞 UI）
      const BATCH_SIZE = 10;
      let latestIndex = 0;
      
      const renderLatestBatch = () => {
        const batch = latestItems.slice(latestIndex, latestIndex + BATCH_SIZE);
        const batchFragment = document.createDocumentFragment();
        
        batch.forEach(item => {
          const card = createKnowledgeCard(item);
          batchFragment.appendChild(card);
        });
        
        latestGrid.appendChild(batchFragment);
        latestIndex += BATCH_SIZE;
        
        if (latestIndex < latestItems.length) {
          requestAnimationFrame(renderLatestBatch);
        }
      };
      
      // 开始渲染
      renderLatestBatch();

      latestSection.appendChild(latestGrid);
      fragment.appendChild(latestSection);

      // 只有当 highlightFilterActive 为 false 时才显示分隔线和"全部知识"区域
      if (!knowledgeState.highlightFilterActive) {
        // 添加分隔线
        const divider = document.createElement('div');
        divider.className = 'my-6 flex items-center gap-4';
        divider.innerHTML = `
          <div class="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
          <span class="text-xs text-slate-400 font-medium">全部知识</span>
          <div class="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>
        `;
        fragment.appendChild(divider);
      }

      // 绑定清除高亮按钮（在添加到 DOM 之前）
      const clearBtn = latestSection.querySelector('#btn-clear-latest-highlight');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          knowledgeState.highlightIds = [];
          knowledgeState.highlightFilterActive = false;
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.removeItem('latestExtractionHighlightIds');
            }
          } catch (e) {
            console.error('清除本次提取高亮ID失败:', e);
          }
          applyFilters();
          renderKnowledgeView();
        });
      }

      // K2: 绑定"只看这些卡片"按钮
      const filterHighlightBtn = latestSection.querySelector('#btn-filter-highlight-only');
      if (filterHighlightBtn) {
        filterHighlightBtn.addEventListener('click', () => {
          knowledgeState.highlightFilterActive = true;
          applyFilters();
          renderKnowledgeView();
        });
      }

      // K2: 绑定"返回全部"按钮
      const filterAllBtn = latestSection.querySelector('#btn-filter-all');
      if (filterAllBtn) {
        filterAllBtn.addEventListener('click', () => {
          knowledgeState.highlightFilterActive = false;
          applyFilters();
          renderKnowledgeView();
        });
      }
    }

    // 下面是常规知识列表（只有当 highlightFilterActive 为 false 时才显示）
    if (!knowledgeState.highlightFilterActive) {
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20';
      fragment.appendChild(grid);
      
      // 一次性添加到 DOM（先添加容器，再分批填充内容）
      container.appendChild(fragment);

      // 分批渲染常规知识列表卡片（每次 10 个）
      const allItemsToRender = otherItems.length > 0 ? otherItems : knowledgeState.filteredItems;
      const BATCH_SIZE = 10;
      let gridIndex = 0;
      
      const renderGridBatch = () => {
        const batch = allItemsToRender.slice(gridIndex, gridIndex + BATCH_SIZE);
        
        batch.forEach(item => {
          const card = createKnowledgeCard(item);
          grid.appendChild(card);
        });
        
        gridIndex += BATCH_SIZE;
        
        if (gridIndex < allItemsToRender.length) {
          requestAnimationFrame(renderGridBatch);
        } else {
          // 所有卡片渲染完成后，批量初始化所有图标
          if (window.lucide) {
            window.lucide.createIcons(container);
          }
          // 渲染完成后结束性能计时
          setTimeout(() => {
            endTimer({ 
              success: true, 
              itemCount: allItemsToRender.length,
              viewMode: 'grid'
            });
          }, 100);
        }
      };
      
      // 开始渲染
      requestAnimationFrame(renderGridBatch);
    } else {
      // 当 highlightFilterActive 为 true 时，只显示本次新提取区域，不需要渲染其他内容
      // 但需要确保 fragment 已经添加到 DOM
      if (fragment.children.length > 0) {
        container.appendChild(fragment);
      }
      
      // 初始化图标
      if (window.lucide) {
        window.lucide.createIcons(container);
      }
      
      // 渲染完成后结束性能计时
      setTimeout(() => {
        endTimer({ 
          success: true, 
          itemCount: latestItems.length,
          viewMode: 'grid',
          highlightFilterActive: true
        });
      }, 100);
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

    // 批量初始化图标（只初始化一次，避免重复）
    if (window.lucide) {
      window.lucide.createIcons(container);
    }
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
 * 初始化筛选区域切换按钮
 */
function initFilterToggleButton() {
  const filterBtn = document.getElementById('knowledge-filter-btn');
  const filtersContainer = document.getElementById('knowledge-filters-container');
  
  if (!filterBtn || !filtersContainer) return;
  
  // 从localStorage读取用户偏好（默认展开）
  const savedState = localStorage.getItem('knowledge-filters-visible');
  const isInitiallyVisible = savedState === null || savedState === 'true';
  
  // 设置初始状态
  if (!isInitiallyVisible) {
    filtersContainer.classList.add('hidden');
    updateFilterButtonIcon(filterBtn, false);
  } else {
    filtersContainer.classList.remove('hidden');
    updateFilterButtonIcon(filterBtn, true);
  }
  
  // 绑定点击事件
  filterBtn.addEventListener('click', () => {
    const isVisible = !filtersContainer.classList.contains('hidden');
    
    if (isVisible) {
      // 隐藏筛选区域
      filtersContainer.classList.add('hidden');
      updateFilterButtonIcon(filterBtn, false);
      localStorage.setItem('knowledge-filters-visible', 'false');
    } else {
      // 显示筛选区域
      filtersContainer.classList.remove('hidden');
      updateFilterButtonIcon(filterBtn, true);
      localStorage.setItem('knowledge-filters-visible', 'true');
    }
  });
}

/**
 * 更新筛选按钮图标
 */
function updateFilterButtonIcon(button, isVisible) {
  const iconElement = button.querySelector('i');
  if (!iconElement) return;
  
  // 更新图标名称
  iconElement.setAttribute('data-lucide', isVisible ? 'filter' : 'filter-x');
  
  // 重新初始化图标（如果lucide已加载）
  if (window.lucide) {
    lucide.createIcons(button);
  }
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
 * 刷新本次提取的高亮ID（从 localStorage 读取）
 * @returns {boolean} 是否有新的高亮ID
 */
export function refreshHighlightIds() {
  const storageKey = 'latestExtractionHighlightIds';
  
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(storageKey);
      
      if (stored) {
        try {
          const ids = JSON.parse(stored);
          
          if (Array.isArray(ids) && ids.length > 0) {
            // 统一将 ID 转换为字符串，确保类型一致
            knowledgeState.highlightIds = ids.map(id => String(id));
            return true; // 表示有新的高亮ID
          }
        } catch (parseError) {
          console.error('解析高亮ID失败:', parseError);
          return false;
        }
      }
    }
  } catch (e) {
    console.error('读取本次提取高亮ID失败:', e);
  }
  return false; // 没有新的高亮ID
}

/**
 * 刷新知识库视图（用于提取完成后更新显示）
 */
export async function refreshKnowledgeView() {
  // 先读取 highlightIds（确保在加载知识列表之前设置）
  const hasNewIds = refreshHighlightIds();
  
  if (hasNewIds) {
    // 重新加载知识列表并渲染（loadKnowledgeItems 会调用 applyFilters 和 renderKnowledgeView）
    await loadKnowledgeItems();
  } else {
    // 即使没有新的高亮ID，也重新渲染一次（以防数据有更新）
    renderKnowledgeView();
  }
}

/**
 * 初始化知识库视图
 */
export async function initKnowledgeView() {
  // 从 localStorage 中读取本次提取需要高亮的知识点ID
  refreshHighlightIds();

  await loadKnowledgeItems();
  
  // 初始化视图切换器
  initViewSwitcher();
  
  // 初始化筛选按钮
  initFilterButtons();
  
  // 初始化筛选区域切换按钮
  initFilterToggleButton();
  
  // 初始化搜索
  initSearch();
  
  // 渲染分类筛选（数据加载完成后）
  renderCategoryFilters();

  // 监听知识库切换事件，重新加载知识列表（只绑定一次，防止重复刷新）
  if (!knowledgeBaseChangedListenerBound) {
    const handleKnowledgeBaseChanged = async (event) => {
      // 重置筛选和搜索状态，避免沿用上一个知识库的条件造成空列表误判
      knowledgeState.currentPage = 1;
      knowledgeState.currentFilter = 'all';
      knowledgeState.currentCategoryFilter = 'all';
      knowledgeState.searchQuery = '';
      
      // 清除本次提取的高亮ID（切换知识库后，之前的提取结果不再相关）
      knowledgeState.highlightIds = [];
      knowledgeState.highlightFilterActive = false;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem('latestExtractionHighlightIds');
        }
      } catch (e) {
        console.error('清除高亮ID失败:', e);
      }
      
      // 重置筛选按钮和搜索输入框的UI状态
      try {
        const filterContainer = document.getElementById('knowledge-status-filters');
        if (filterContainer) {
          filterContainer.querySelectorAll('.knowledge-filter-btn').forEach(btn => {
            const isAll = btn.dataset.filter === 'all';
            btn.classList.toggle('bg-slate-800', isAll);
            btn.classList.toggle('text-white', isAll);
            btn.classList.toggle('bg-white', !isAll);
            btn.classList.toggle('text-slate-600', !isAll);
            btn.classList.toggle('border', !isAll);
            btn.classList.toggle('border-slate-200', !isAll);
          });
        }
        const searchInput = document.getElementById('knowledge-search-input');
        if (searchInput) {
          searchInput.value = '';
        }
      } catch (e) {
        console.warn('[知识库] 重置筛选/搜索状态时出现问题:', e);
      }
      
      await loadKnowledgeItems();
    };
    
    document.addEventListener('knowledgeBaseChanged', handleKnowledgeBaseChanged);
    knowledgeBaseChangedListenerBound = true;
  }
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

