import { itemsAPI, parseAPI, aiAPI, settingsAPI, tagsAPI, exportAPI } from './api.js';
import { storage } from './storage.js';
import { formatTime, truncate, isURL } from './utils.js';

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
let currentStatusFilter = 'all'; // 用于知识库页面的状态筛选
let currentItem = null;
let apiConfigured = false;
let globalSearchTerm = '';
let stats = null;

// 元素获取
const $ = (id) => document.getElementById(id);

const elQuickInput = $('quick-input');
const elGlobalSearch = $('global-search');
const elCardGrid = $('card-grid');
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
const elViewDetail = $('view-detail');
const elArchiveList = $('archive-list');
const elArchiveSearchInput = $('archive-search-input');
const elDetailContent = $('detail-content-container');
const elChatHistory = $('chat-history');
const elChatInput = $('chat-input');
const elBtnSendChat = $('btn-send-chat');
const elBtnGenerateSummary = $('btn-generate-summary');
const elBtnBatchSummary = $('btn-batch-summary');
const elBtnCloseDetail = $('btn-close-detail');
const elRepoSearchInput = $('repo-search-input');
const elTagsContainer = $('tags-container');
const elToastContainer = $('toast-container');

// 简单 Toast
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className =
    'glass px-4 py-3 rounded-lg shadow-xl border border-slate-200 flex items-center space-x-3 transform translate-y-10 opacity-0 transition-all duration-300 pointer-events-auto min-w-[260px]';

  let icon = '<i class="fa-solid fa-check-circle text-green-500"></i>';
  if (type === 'error') icon = '<i class="fa-solid fa-circle-xmark text-red-500"></i>';
  if (type === 'info') icon = '<i class="fa-solid fa-info-circle text-blue-500"></i>';
  if (type === 'loading') icon = '<i class="fa-solid fa-circle-notch fa-spin text-indigo-500"></i>';

  toast.innerHTML = `
    ${icon}
    <span class="text-sm font-medium text-slate-700">${message}</span>
  `;

  elToastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-10', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-10', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// 视图切换
function switchView(view) {
  currentView = view;
  // 保存当前视图到 localStorage
  storage.set('lastView', view);
  
  [elViewConsultation, elViewDashboard, elViewRepository, elViewArchive, elViewTags].forEach((el) => {
    if (!el) return;
    el.classList.add('hidden');
  });

  // 控制全局搜索框的显示/隐藏
  if (elGlobalSearch) {
    const searchContainer = elGlobalSearch.closest('.relative.group');
    if (view === 'consultation') {
      // 咨询工作台视图时隐藏搜索框
      if (searchContainer) {
        searchContainer.classList.add('hidden');
      }
    } else {
      // 其他视图时显示搜索框
      if (searchContainer) {
        searchContainer.classList.remove('hidden');
      }
    }
  }

  if (view === 'consultation' && elViewConsultation) {
    elViewConsultation.classList.remove('hidden');
    // 初始化Lucide图标
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    // 初始化咨询工作台
    import('./consultation.js').then(({ initConsultation, loadHistory }) => {
      initConsultation();
      loadHistory();
    });
    import('./context.js').then(({ loadContext, formatContextLabel }) => {
      loadContext().then(() => {
        const labelEl = document.getElementById('context-label-text');
        if (labelEl) {
          const labelText = formatContextLabel();
          labelEl.textContent = labelText || '未设置';
        }
        // 重新初始化图标
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
    });
  }
  if (view === 'dashboard') {
    elViewDashboard.classList.remove('hidden');
    // 切换到工作台时重新加载数据
    loadItems();
  }
  if (view === 'repository') {
    elViewRepository.classList.remove('hidden');
    // 切换到知识库时重新加载数据
    loadItems();
  }
  if (view === 'archive') {
    elViewArchive.classList.remove('hidden');
    loadArchivedItems();
  }
  if (view === 'tags') elViewTags.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.remove('bg-slate-800', 'text-white');
    btn.classList.add('text-slate-300');
    if (btn.dataset.view === view) {
      btn.classList.add('bg-slate-800', 'text-white');
      btn.classList.remove('text-slate-300');
    }
  });
}

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
  if (elGlobalSearch) elGlobalSearch.value = '';
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.remove('bg-slate-800', 'text-white');
    btn.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-200');
    if (btn.dataset.filter === filter) {
      btn.classList.add('bg-slate-800', 'text-white');
      btn.classList.remove('bg-white', 'text-slate-600', 'border', 'border-slate-200');
    }
  });
  renderCards();
  renderRepoList();
}

// 渲染卡片
function renderCards() {
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

  // 绑定点击事件
  elCardGrid.querySelectorAll('article[data-id]').forEach((card) => {
    card.addEventListener('click', async () => {
      const id = card.getAttribute('data-id');
      const item = allItems.find((it) => it.id === id);
      if (item) await openDetail(item);
    });
  });
}

// 渲染知识库列表
function renderRepoList() {
  const search = (elRepoSearchInput?.value || '').trim();
  let data = allItems;
  
  // 状态筛选
  if (currentStatusFilter !== 'all') {
    data = data.filter(item => item.status === currentStatusFilter);
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

  if (data.length === 0) {
    elRepoList.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-12 text-center text-slate-400">
          <i class="fa-solid fa-inbox text-3xl mb-2"></i>
          <p>暂无内容</p>
        </td>
      </tr>
    `;
    return;
  }

  elRepoList.innerHTML = data
    .map(
      (item) => {
        // 状态徽章
        let statusBadge = '';
        if (item.status === 'pending') {
          statusBadge = '<span class="px-2 inline-flex text-[11px] leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">待处理</span>';
        } else if (item.status === 'processed') {
          statusBadge = '<span class="px-2 inline-flex text-[11px] leading-5 font-semibold rounded-full bg-green-100 text-green-800">已处理</span>';
        } else {
          statusBadge = '<span class="px-2 inline-flex text-[11px] leading-5 font-semibold rounded-full bg-slate-100 text-slate-600">已归档</span>';
        }
        
        return `
    <tr class="hover:bg-slate-50 transition-colors" data-id="${item.id}">
      <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-slate-900 cursor-pointer" onclick="window.openDetailById && window.openDetailById('${item.id}')">
        ${escapeHtml(truncate(item.title || '无标题', 28))}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        文本
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        ${formatTime(item.created_at)}
      </td>
      <td class="px-6 py-3 whitespace-nowrap">
        ${statusBadge}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-sm">
        <div class="flex items-center gap-2">
          <button
            data-action="view"
            data-id="${item.id}"
            class="text-indigo-600 hover:text-indigo-800 transition-colors"
            title="查看"
          >
            <i class="fa-solid fa-eye"></i>
          </button>
          <button
            data-action="archive"
            data-id="${item.id}"
            class="text-slate-600 hover:text-slate-800 transition-colors"
            title="归档"
          >
            <i class="fa-solid fa-archive"></i>
          </button>
          <button
            data-action="delete"
            data-id="${item.id}"
            class="text-red-600 hover:text-red-800 transition-colors"
            title="删除"
          >
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
      }
    )
    .join('');

  // 绑定查看按钮
  elRepoList.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const item = allItems.find((it) => it.id === id);
      if (item) await openDetail(item);
    });
  });

  // 绑定归档按钮
  elRepoList.querySelectorAll('[data-action="archive"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const item = allItems.find((it) => it.id === id);
      if (!item) return;

      if (!confirm(`确定要归档 "${item.title}" 吗？归档后可在归档页面恢复。`)) {
        return;
      }

      try {
        showToast('正在归档...', 'loading');
        await itemsAPI.archive(id);
        allItems = allItems.filter((it) => it.id !== id);
        renderCards();
        renderRepoList();
        renderTagsCloud();
        if (stats) {
          stats.total = (stats.total || 0) - 1;
          updateDashboardStats();
        }
        showToast('归档成功', 'success');
      } catch (error) {
        console.error('归档失败:', error);
        showToast(error.message || '归档失败', 'error');
      }
    });
  });

  // 绑定删除按钮（软删除，实际是归档）
  elRepoList.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const item = allItems.find((it) => it.id === id);
      if (!item) return;

      if (!confirm(`确定要删除 "${item.title}" 吗？删除后可在归档页面恢复。`)) {
        return;
      }

      try {
        showToast('正在删除...', 'loading');
        await itemsAPI.delete(id);
        allItems = allItems.filter((it) => it.id !== id);
        renderCards();
        renderRepoList();
        renderTagsCloud();
        if (stats) {
          stats.total = (stats.total || 0) - 1;
          updateDashboardStats();
        }
        showToast('删除成功', 'success');
      } catch (error) {
        console.error('删除失败:', error);
        showToast(error.message || '删除失败', 'error');
      }
    });
  });
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

  if (data.length === 0) {
    elArchiveList.innerHTML = `
      <tr>
        <td colspan="4" class="px-6 py-12 text-center text-slate-400">
          <i class="fa-solid fa-archive text-3xl mb-2"></i>
          <p>归档为空，整理你的知识库吧</p>
        </td>
      </tr>
    `;
    return;
  }

  elArchiveList.innerHTML = data
    .map(
      (item) => {
        return `
    <tr class="hover:bg-slate-50 transition-colors" data-id="${item.id}">
      <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-slate-900 cursor-pointer" onclick="window.openDetailById && window.openDetailById('${item.id}')">
        ${escapeHtml(truncate(item.title || '无标题', 28))}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        文本
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-xs text-slate-500">
        ${formatTime(item.updated_at || item.created_at)}
      </td>
      <td class="px-6 py-3 whitespace-nowrap text-sm">
        <div class="flex items-center gap-2">
          <button
            data-action="view"
            data-id="${item.id}"
            class="text-indigo-600 hover:text-indigo-800 transition-colors"
            title="查看"
          >
            <i class="fa-solid fa-eye"></i>
          </button>
          <button
            data-action="restore"
            data-id="${item.id}"
            class="text-green-600 hover:text-green-800 transition-colors"
            title="恢复"
          >
            <i class="fa-solid fa-rotate-left"></i>
          </button>
          <button
            data-action="permanent-delete"
            data-id="${item.id}"
            class="text-red-600 hover:text-red-800 transition-colors"
            title="永久删除"
          >
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
      }
    )
    .join('');

  // 绑定查看按钮
  elArchiveList.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const item = archivedItems.find((it) => it.id === id);
      if (item) await openDetail(item);
    });
  });

  // 绑定恢复按钮
  elArchiveList.querySelectorAll('[data-action="restore"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const item = archivedItems.find((it) => it.id === id);
      if (!item) return;

      try {
        showToast('正在恢复...', 'loading');
        await itemsAPI.restore(id);
        archivedItems = archivedItems.filter((it) => it.id !== id);
        await loadItems(); // 重新加载活跃内容
        renderArchiveList();
        if (stats) {
          stats.total = (stats.total || 0) + 1;
          stats.archived = (stats.archived || 0) - 1;
          updateDashboardStats();
        }
        showToast('恢复成功', 'success');
      } catch (error) {
        console.error('恢复失败:', error);
        showToast(error.message || '恢复失败', 'error');
      }
    });
  });

  // 绑定永久删除按钮
  elArchiveList.querySelectorAll('[data-action="permanent-delete"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const item = archivedItems.find((it) => it.id === id);
      if (!item) return;

      if (!confirm(`确定要永久删除 "${item.title}" 吗？此操作不可恢复！`)) {
        return;
      }

      try {
        showToast('正在永久删除...', 'loading');
        await itemsAPI.permanentDelete(id);
        archivedItems = archivedItems.filter((it) => it.id !== id);
        renderArchiveList();
        if (stats) {
          stats.archived = (stats.archived || 0) - 1;
          updateDashboardStats();
        }
        showToast('永久删除成功', 'success');
      } catch (error) {
        console.error('永久删除失败:', error);
        showToast(error.message || '永久删除失败', 'error');
      }
    });
  });
}

// 加载归档内容
async function loadArchivedItems() {
  try {
    const res = await itemsAPI.getAll({ status: 'archived', page: 1, limit: 200 });
    archivedItems = res.data || [];
    renderArchiveList();
  } catch (error) {
    console.error('加载归档内容失败:', error);
    showToast(error.message || '加载归档内容失败', 'error');
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
  renderCards();
  renderRepoList();
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
  if (elGlobalSearch) elGlobalSearch.value = '';
  switchView('dashboard');
  renderCards();
  renderRepoList();
  showToast(`已筛选标签: #${tag}`, 'info');
}

// 显示编辑标签模态框
function showEditTagModal(oldTag) {
  const newTagName = prompt('请输入新标签名称:', oldTag);
  if (!newTagName || !newTagName.trim() || newTagName === oldTag) return;

  handleRenameTag(oldTag, newTagName.trim());
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

    showToast('正在更新标签...', 'loading');

    for (const item of itemsToUpdate) {
      const newTags = (item.tags || []).map((t) => (t === oldTag ? newTag : t));
      await itemsAPI.update(item.id, { tags: newTags });
    }

    // 重新加载数据
    await loadItems();
    renderTagsCloud();
    showToast('标签重命名成功', 'success');
  } catch (error) {
    console.error('重命名标签失败:', error);
    showToast(error.message || '重命名标签失败', 'error');
  }
}

// 删除标签
async function handleDeleteTag(tag) {
  if (!confirm(`确定要删除标签 "#${tag}" 吗？这将从所有使用该标签的内容中移除。`)) {
    return;
  }

  try {
    // 从所有包含该标签的知识项中移除
    const itemsToUpdate = allItems.filter((item) => (item.tags || []).includes(tag));

    if (itemsToUpdate.length === 0) {
      showToast('没有找到使用该标签的内容', 'info');
      return;
    }

    showToast('正在删除标签...', 'loading');

    for (const item of itemsToUpdate) {
      const newTags = (item.tags || []).filter((t) => t !== tag);
      await itemsAPI.update(item.id, { tags: newTags });
    }

    // 重新加载数据
    await loadItems();
    renderTagsCloud();
    showToast('标签删除成功', 'success');
  } catch (error) {
    console.error('删除标签失败:', error);
    showToast(error.message || '删除标签失败', 'error');
  }
}

// 更新Context状态显示

// 打开详情
let isEditing = false;
async function openDetail(item) {
  // 如果item没有raw_content（列表查询不返回），需要从API获取完整数据
  // 注意：对于PDF类型，即使没有raw_content也不从API获取，因为PDF内容很大
  if (!item.raw_content && item.type !== 'pdf' && item.type !== 'link') {
    try {
      const res = await itemsAPI.getById(item.id);
      if (res.success && res.data) {
        item = res.data;
        // 更新allItems中的对应项
        const index = allItems.findIndex(it => it.id === item.id);
        if (index !== -1) {
          allItems[index] = item;
        }
      }
    } catch (error) {
      console.error('加载详情失败:', error);
      // 如果加载失败，仍然显示基本信息，只是没有raw_content
    }
  }
  
  currentItem = item;
  isEditing = false;
  elViewDetail.classList.remove('hidden');

  const tagsStr =
    (item.tags && item.tags.length > 0
      ? item.tags.map((t) => `#${t}`).join(' ')
      : '') || '无';

  elDetailContent.innerHTML = `
    <header class="mb-8 border-b border-slate-100 pb-5">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center text-xs text-slate-500">
          <span class="inline-flex items-center mr-3 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">
            TEXT
          </span>
          <span>${formatTime(item.created_at)}</span>
          ${
            item.original_url
              ? `<a href="${item.original_url}" target="_blank" class="ml-4 text-indigo-600 hover:underline text-xs">原始链接 ↗</a>`
              : ''
          }
        </div>
        <button
          id="btn-edit-item"
          class="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
        >
          <i class="fa-solid fa-pen mr-1"></i> 编辑
        </button>
      </div>
      <h1 id="detail-title" class="text-2xl md:text-3xl font-bold text-slate-900 leading-tight mb-3">
        ${item.title}
      </h1>
      <div class="flex flex-wrap items-center text-xs text-slate-500 gap-2">
        <span>来源：${item.source || '手动添加'}</span>
        <span class="mx-1 text-slate-300">·</span>
        <span id="detail-tags">标签：${tagsStr}</span>
        <button
          id="btn-suggest-tags"
          class="ml-2 px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          title="AI 建议标签"
        >
          <i class="fa-solid fa-tags mr-1"></i> 建议标签
        </button>
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
          ${(item.raw_content || '').trim() || '（暂无正文内容）'}
        </div>
      </article>
    </section>
  `;

  // 绑定编辑按钮
  const btnEdit = elDetailContent.querySelector('#btn-edit-item');
  if (btnEdit) {
    btnEdit.addEventListener('click', () => toggleEditMode());
  }

  // 绑定建议标签按钮
  const btnSuggestTags = elDetailContent.querySelector('#btn-suggest-tags');
  if (btnSuggestTags) {
    btnSuggestTags.addEventListener('click', () => {
      if (!apiConfigured) {
        showToast('请先在设置中配置 DeepSeek API Key', 'info');
        openSettingsModal();
        return;
      }
      if (item.raw_content) {
        showTagSuggestions(item.id, item.raw_content);
      } else {
        showToast('当前内容没有正文可供分析', 'info');
      }
    });
  }

  // 重置聊天区
  elChatHistory.innerHTML = `
    <div class="text-xs text-slate-500">
      <p>你可以直接问这篇内容相关的问题，例如：</p>
      <ul class="mt-2 space-y-1 list-disc list-inside">
        <li>帮我总结这篇内容的三个要点？</li>
        <li>如果要做行动计划，可以怎么拆解？</li>
      </ul>
    </div>
  `;
  elChatInput.value = '';
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
    showToast('正在保存...', 'loading');
    await itemsAPI.update(currentItem.id, {
      title: newTitle,
      raw_content: newContent
    });

    // 更新本地数据
    currentItem.title = newTitle;
    currentItem.raw_content = newContent;
    allItems = allItems.map((it) =>
      it.id === currentItem.id ? { ...it, title: newTitle, raw_content: newContent } : it
    );

    isEditing = false;
    await openDetail(currentItem); // 重新渲染
    renderCards();
    renderRepoList();

    showToast('保存成功', 'success');
  } catch (error) {
    console.error('保存失败:', error);
    showToast(error.message || '保存失败', 'error');
  }
}

function closeDetail() {
  elViewDetail.classList.add('hidden');
  currentItem = null;
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

  showToast('正在生成摘要...', 'loading');
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

    showToast('摘要已生成', 'success');
    
    // 自动建议标签
    if (currentItem.raw_content) {
      setTimeout(() => {
        showTagSuggestions(currentItem.id, currentItem.raw_content);
      }, 500); // 延迟500ms，让用户看到摘要生成成功的提示
    }
  } catch (error) {
    console.error('生成摘要失败:', error);
    showToast(error.message || '生成摘要失败', 'error');
  }
}

// 显示标签建议
async function showTagSuggestions(itemId, content) {
  if (!apiConfigured) return;
  
  try {
    showToast('正在生成标签建议...', 'loading');
    const res = await aiAPI.suggestTags(content);
    const suggestedTags = res.data.tags || [];
    
    if (suggestedTags.length === 0) {
      showToast('未生成标签建议', 'info');
      return;
    }
    
    // 显示标签选择界面
    showTagSelectionModal(itemId, suggestedTags);
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
      
      // 更新本地数据
      allItems = allItems.map((it) =>
        it.id === itemId ? { ...it, tags: newTags } : it
      );
      
      if (currentItem && currentItem.id === itemId) {
        currentItem.tags = newTags;
        await openDetail(currentItem);
      }
      
      renderCards();
      renderRepoList();
      renderTagsCloud();
      
      closeModal();
      showToast(`已添加 ${tagsToAdd.length} 个标签`, 'success');
    } catch (error) {
      console.error('添加标签失败:', error);
      showToast(error.message || '添加标签失败', 'error');
    }
  });
}

// 批量生成摘要
async function handleBatchSummary() {
  if (!apiConfigured) {
    showToast('请先在设置中配置 DeepSeek API Key', 'info');
    openSettingsModal();
    return;
  }

  // 找出所有没有摘要且有内容的知识项
  const itemsToSummarize = allItems.filter(
    (item) => !item.summary_ai && item.raw_content && item.raw_content.trim().length > 0
  );

  if (itemsToSummarize.length === 0) {
    showToast('所有内容都已生成摘要', 'info');
    return;
  }

  const btn = elBtnBatchSummary;
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> 生成中...';

  showToast(`正在为 ${itemsToSummarize.length} 条内容生成摘要...`, 'loading');

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < itemsToSummarize.length; i++) {
    const item = itemsToSummarize[i];
    try {
      const res = await aiAPI.generateSummary(item.raw_content, item.id);
      const summary = res.data.summary;

      // 更新 allItems
      allItems = allItems.map((it) =>
        it.id === item.id ? { ...it, summary_ai: summary } : it
      );

      successCount++;

      // 每5个更新一次UI
      if ((i + 1) % 5 === 0 || i === itemsToSummarize.length - 1) {
        renderCards();
        renderRepoList();
      }
    } catch (error) {
      console.error(`为 ${item.title} 生成摘要失败:`, error);
      failCount++;
    }

    // 避免请求过快
    if (i < itemsToSummarize.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  btn.disabled = false;
  btn.innerHTML = originalText;

  // 重新加载数据确保同步
  await loadItems();

  if (failCount === 0) {
    showToast(`成功为 ${successCount} 条内容生成摘要`, 'success');
  } else {
    showToast(`完成：成功 ${successCount} 条，失败 ${failCount} 条`, failCount > successCount ? 'error' : 'info');
  }
}

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
      
      renderCards();
      renderRepoList();
    }
  } catch (error) {
    console.error('刷新数据失败:', error);
  }
}

// 快速导入
async function handleQuickInputKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const value = elQuickInput.value.trim();
    if (!value) return;

    if (isURL(value)) {
      showToast('正在解析链接...', 'loading');
      try {
        const res = await parseAPI.parseURL(value);
        const data = res.data;
        const now = Date.now();

        const item = await itemsAPI.create({
          // 统一为文本类型
          type: 'text',
          title: data.title || '未命名链接',
          raw_content: data.content || '',
          original_url: data.url,
          source: 'Web',
          tags: []
        });

        allItems.unshift(item.data);
        // 重新加载确保数据同步
        await loadItems();
        elQuickInput.value = '';
        showToast('链接已解析并保存', 'success');
      } catch (error) {
        console.error('解析失败:', error);
        showToast(error.message || '解析URL失败', 'error');
      }
    } else {
      // 作为 memo
      const now = Date.now();
      try {
        const item = await itemsAPI.create({
          // 统一为文本类型
          type: 'text',
          title: value.length > 32 ? value.slice(0, 32) + '...' : value,
          raw_content: value,
          original_url: '',
          source: 'Memo',
          tags: []
        });
        allItems.unshift(item.data);
        // 重新加载确保数据同步
        await loadItems();
        elQuickInput.value = '';
        showToast('已保存为 Memo', 'success');
      } catch (error) {
        console.error('保存Memo失败:', error);
        showToast(error.message || '保存失败', 'error');
      }
    }
  }
}

// 加载 items（默认排除archived）
async function loadItems() {
  try {
    // 不传status参数，后端默认排除archived
    // 不传knowledge_base_id，显示所有知识库的内容
    // 增加limit以确保加载所有项目
    const res = await itemsAPI.getAll({ type: 'all', page: 1, limit: 1000 });
    allItems = res.data || [];
    console.log(`加载了 ${allItems.length} 个项目`);
    renderCards();
    renderRepoList();
    renderTagsCloud();
    await loadDashboardStats();
  } catch (error) {
    console.error('加载内容失败:', error);
    elDashboardSubtitle.textContent = '加载失败，请稍后重试';
    showToast(error.message || '加载内容失败', 'error');
  }
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

async function loadSettings() {
  try {
    const res = await settingsAPI.get();
    const data = res.data || {};
    const configured = !!data.deepseek_api_key_configured;
    apiConfigured = configured;

    if (configured) {
      elApiStatusText.textContent = 'DeepSeek 已配置';
      elApiPill.classList.remove('hidden');
      elApiPill.querySelector('span.w-2').classList.remove('bg-red-500');
      elApiPill.querySelector('span.w-2').classList.add('bg-green-500');
      elApiPill.lastChild.textContent = ' DeepSeek 已连接';
      
      // 如果API Key已配置，在输入框中显示masked版本
      if (data.deepseek_api_key && elInputApiKey) {
        elInputApiKey.value = data.deepseek_api_key; // 显示masked版本，如 "sk-1...abcd"
      }
    } else {
      elApiStatusText.textContent = 'API 未配置';
      elApiPill.classList.remove('hidden');
      elApiPill.querySelector('span.w-2').classList.remove('bg-green-500');
      elApiPill.querySelector('span.w-2').classList.add('bg-red-500');
      elApiPill.lastChild.textContent = ' DeepSeek 未连接';
      
      // 如果未配置，清空输入框
      if (elInputApiKey) {
        elInputApiKey.value = '';
      }
    }

    if (data.deepseek_model) {
      elSelectModel.value = data.deepseek_model;
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

async function saveSettings() {
  const apiKey = elInputApiKey.value.trim();
  const model = elSelectModel.value;

  try {
    await settingsAPI.update({ apiKey, model });
    elSettingsMessage.textContent = '设置已保存';
    elSettingsMessage.className = 'mt-3 text-xs text-green-600';
    apiConfigured = !!apiKey;
    
    // 重新加载设置，更新API Key显示
    await loadSettings();
    
    // 如果保存的是完整API Key，保存后应该显示masked版本
    // loadSettings 会自动处理这个
  } catch (error) {
    console.error('保存设置失败:', error);
    elSettingsMessage.textContent = error.message || '保存失败';
    elSettingsMessage.className = 'mt-3 text-xs text-red-600';
  }
}

async function testAPI() {
  const apiKey = elInputApiKey.value.trim();
  elSettingsMessage.textContent = '正在测试连接...';
  elSettingsMessage.className = 'mt-3 text-xs text-slate-500';
  try {
    const res = await settingsAPI.testAPI(apiKey || undefined);
    elSettingsMessage.textContent = res.message;
    elSettingsMessage.className = `mt-3 text-xs ${
      res.success ? 'text-green-600' : 'text-red-600'
    }`;
  } catch (error) {
    elSettingsMessage.textContent = error.message || '测试失败';
    elSettingsMessage.className = 'mt-3 text-xs text-red-600';
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

  // 快速输入
  if (elQuickInput) {
    elQuickInput.addEventListener('keydown', handleQuickInputKeydown);
  }

  // 全局搜索
  if (elGlobalSearch) {
    elGlobalSearch.addEventListener('input', (e) => {
      globalSearchTerm = e.target.value.trim();
      renderCards();
      renderRepoList();
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
  if (elBtnBatchSummary) {
    elBtnBatchSummary.addEventListener('click', handleBatchSummary);
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

  // 导出
  if (elBtnExportJSON) {
    elBtnExportJSON.addEventListener('click', () => exportAPI.exportJSON());
  }
  if (elBtnExportMD) {
    elBtnExportMD.addEventListener('click', () => exportAPI.exportMarkdown());
  }

  // 搜索
  if (elRepoSearchInput) {
    elRepoSearchInput.addEventListener('input', () => {
      renderRepoList();
    });
  }

  // 归档搜索
  if (elArchiveSearchInput) {
    elArchiveSearchInput.addEventListener('input', () => {
      renderArchiveList();
    });
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

async function init() {
  try {
    console.log('开始初始化应用...');
    bindEvents();
    console.log('事件绑定完成');
    
    // 从 localStorage 恢复上次的视图，如果没有则默认显示工作台
    const lastView = storage.get('lastView', 'dashboard');
    switchView(lastView);
    console.log('视图切换完成:', lastView);
    
    setFilter('all');
    console.log('筛选器设置完成');
    
    // 初始化时设置为未加载
    try {
      await loadSettings();
      console.log('设置加载完成');
    } catch (error) {
      console.error('加载设置失败:', error);
    }
    
    try {
      await loadItems();
      console.log('数据加载完成');
    } catch (error) {
      console.error('加载数据失败:', error);
      // 即使加载失败，也要显示界面
      if (elDashboardSubtitle) {
        elDashboardSubtitle.textContent = '数据加载失败，请刷新页面重试';
      }
    }
    
    console.log('应用初始化完成');
  } catch (error) {
    console.error('初始化失败:', error);
    console.error('错误堆栈:', error.stack);
    alert('应用初始化失败，请刷新页面重试。错误信息: ' + error.message);
  }
}

document.addEventListener('DOMContentLoaded', init);


