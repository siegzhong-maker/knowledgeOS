// 知识详情抽屉组件
import { knowledgeAPI } from './api.js';
import { showToast, showLoadingToast } from './toast.js';
import { formatTime } from './utils.js';
import { showConfirm } from './dialog.js';

let currentItem = null;
let isEditMode = false;
let drawerElement = null;
let overlayElement = null;

// 分类配置（与 knowledge-items.js 保持一致）
const CATEGORY_CONFIG = {
  work: { name: '工作', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: 'briefcase' },
  learning: { name: '学习', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: 'book-open' },
  leisure: { name: '娱乐', color: 'bg-red-100 text-red-700 border-red-200', icon: 'gamepad-2' },
  life: { name: '生活', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: 'heart' },
  other: { name: '其他', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: 'circle' }
};

// 分类名称映射
function getCategoryName(category) {
  const config = CATEGORY_CONFIG[category];
  return config ? config.name : '工作';
}

/**
 * 打开知识详情
 */
export async function openKnowledgeDetail(itemId) {
  try {
    const response = await knowledgeAPI.getItemById(itemId);
    
    if (!response.success) {
      throw new Error(response.message || '加载失败');
    }

    currentItem = response.data;
    
    // 调试：检查子分类数据
    console.log('知识详情数据:', {
      id: currentItem.id,
      category: currentItem.category,
      subcategory_id: currentItem.subcategory_id,
      subcategory: currentItem.subcategory
    });
    
    // 立即渲染详情页面，不显示loading
    renderDetailDrawer();
    
    // 异步加载相关知识（不阻塞页面显示）
    if (!currentItem.relatedKnowledge || currentItem.relatedKnowledge.length === 0) {
      loadRelatedKnowledgeAsync(itemId);
    }
  } catch (error) {
    console.error('加载知识详情失败:', error);
    showToast(error.message || '加载失败', 'error');
  }
}

/**
 * 关闭知识详情
 */
export function closeKnowledgeDetail() {
  // 移除遮罩层
  if (overlayElement) {
    overlayElement.style.opacity = '0';
    setTimeout(() => {
      if (overlayElement && overlayElement.parentNode) {
        overlayElement.parentNode.removeChild(overlayElement);
      }
      overlayElement = null;
    }, 300);
  }
  
  // 关闭抽屉
  if (drawerElement) {
    drawerElement.classList.remove('translate-x-0');
    drawerElement.classList.add('translate-x-full');
    
    setTimeout(() => {
      if (drawerElement && drawerElement.parentNode) {
        drawerElement.parentNode.removeChild(drawerElement);
      }
      drawerElement = null;
      currentItem = null;
      isEditMode = false;
    }, 300);
  }
}

/**
 * 渲染详情抽屉
 */
function renderDetailDrawer() {
  if (!currentItem) return;

  // 移除旧的抽屉
  if (drawerElement) {
    drawerElement.remove();
  }

  // 创建抽屉元素
  drawerElement = document.createElement('div');
  drawerElement.className = 'fixed right-0 top-0 h-full w-[600px] bg-white shadow-2xl z-50 transform transition-transform duration-300 translate-x-0 flex flex-col';
  
  // 移除旧的遮罩层（如果存在）
  if (overlayElement) {
    overlayElement.remove();
  }
  
  // 创建遮罩层
  overlayElement = document.createElement('div');
  overlayElement.className = 'fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40 transition-opacity duration-300 opacity-100';
  overlayElement.addEventListener('click', closeKnowledgeDetail);
  document.body.appendChild(overlayElement);

  // 抽屉内容
  drawerElement.innerHTML = `
    <!-- Header -->
    <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
      <div class="flex items-center space-x-3">
        <button onclick="closeKnowledgeDetail()" class="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors">
          <i data-lucide="x" size="20"></i>
        </button>
        <div class="flex flex-col">
          <span class="text-xs text-slate-400 font-medium uppercase tracking-wider">知识详情</span>
          <div class="flex items-center gap-2">
            ${createStatusBadge(currentItem.status, currentItem)}
            ${currentItem.status === 'pending' ? `
              <span class="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded animate-pulse">需人工确认</span>
            ` : ''}
          </div>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <button onclick="toggleEditMode()" class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="编辑">
          <i data-lucide="edit-3" size="18"></i>
        </button>
        <button onclick="deleteKnowledgeItem('${currentItem.id}')" class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="删除">
          <i data-lucide="trash-2" size="18"></i>
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-6 py-6 relative">
      ${renderContent()}
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-slate-100 bg-white flex justify-end gap-3 flex-shrink-0">
      ${renderFooter()}
    </div>
  `;

  document.body.appendChild(drawerElement);

  // 初始化Lucide图标
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 暴露全局函数
  window.closeKnowledgeDetail = closeKnowledgeDetail;
  window.toggleEditMode = toggleEditMode;
  window.deleteKnowledgeItem = deleteKnowledgeItem;
  window.approveKnowledgeItem = approveKnowledgeItem;
  window.addKeyConclusion = addKeyConclusion;
  window.removeKeyConclusion = removeKeyConclusion;
  window.saveKnowledgeItem = saveKnowledgeItem;
  window.cancelEdit = cancelEdit;
}

/**
 * 异步加载相关知识（不阻塞页面显示）
 */
async function loadRelatedKnowledgeAsync(itemId) {
  // 如果详情已关闭或切换到其它文档，直接忽略异步结果
  if (!currentItem || currentItem.id !== itemId) {
    return;
  }
  // 设置加载状态
  currentItem._loadingRelated = true;
  
  // 更新UI显示加载状态
  const relatedList = document.getElementById('related-knowledge-list');
  if (relatedList) {
    relatedList.innerHTML = renderRelatedKnowledge();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
  
  try {
    const relatedResponse = await knowledgeAPI.getRelatedKnowledge(itemId, 5, 60);
    // 再次校验，防止请求返回时详情已关闭
    if (!currentItem || currentItem.id !== itemId) return;

    if (relatedResponse.success && relatedResponse.data) {
      currentItem.relatedKnowledge = relatedResponse.data || [];
    }
    currentItem._loadingRelated = false;
    
    // 更新相关知识部分
    if (relatedList) {
      relatedList.innerHTML = renderRelatedKnowledge();
      if (window.lucide) {
        window.lucide.createIcons();
      }
    }
  } catch (err) {
    console.warn('加载相关知识失败:', err);
    if (currentItem && currentItem.id === itemId) {
      currentItem._loadingRelated = false;
      // 更新UI显示错误状态
      if (relatedList) {
        relatedList.innerHTML = renderRelatedKnowledge();
      }
    }
  }
}

/**
 * 渲染内容区域
 */
function renderContent() {
  if (!currentItem) return '';

  // 待审核提醒（仅当置信度低于80%时显示）
  const confidence = currentItem.confidence_score || 0;
  const pendingAlert = currentItem.status === 'pending' && confidence < 80 ? `
    <div class="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
      <i data-lucide="alert-circle" class="text-amber-600 flex-shrink-0 mt-0.5" size="22"></i>
      <div class="flex-1 min-w-0">
        <h4 class="text-sm font-bold text-amber-900 mb-2">低置信度提醒 (${currentItem.confidence_score}%)</h4>
        <p class="text-xs text-amber-800 mb-3 leading-relaxed break-words">
          AI 对该内容的提取准确度未达到自动确认标准 (80%)。请检查内容是否准确，确认无误后点击"确认通过"。
        </p>
        <div class="text-xs text-amber-700 bg-amber-100/50 rounded-lg p-3 mb-4">
          <p class="font-medium mb-1">置信度说明：</p>
          <ul class="list-disc list-inside space-y-0.5 text-amber-700/90">
            <li><strong>≥85%</strong>：高置信度，可快速批量确认</li>
            <li><strong>80-84%</strong>：中等置信度，建议简单检查后确认</li>
            <li><strong>&lt;80%</strong>：低置信度，需要仔细审查内容准确性</li>
          </ul>
        </div>
        ${!isEditMode ? `
          <div class="flex flex-wrap gap-2">
            <button 
              onclick="approveKnowledgeItem('${currentItem.id}')"
              class="bg-amber-600 hover:bg-amber-700 text-white text-xs px-4 py-2 rounded-lg font-medium transition-colors shadow-sm flex items-center gap-1.5"
            >
              <i data-lucide="check-circle" size="14"></i>
              <span>确认并入库</span>
            </button>
            <button 
              onclick="toggleEditMode()"
              class="bg-white border border-amber-300 text-amber-700 text-xs px-4 py-2 rounded-lg font-medium hover:bg-amber-100 transition-colors"
            >
              修正内容
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  return `
    ${pendingAlert}
    
    <!-- Title Area -->
    <div class="mb-6">
      <input 
        type="text" 
        id="knowledge-title-input"
        value="${escapeHtml(currentItem.title)}"
        ${!isEditMode ? 'readonly' : ''}
        class="w-full text-2xl font-bold text-slate-800 border-none focus:ring-0 p-0 bg-transparent placeholder-slate-300 break-words ${isEditMode ? 'border-b-2 border-blue-500 pb-2' : ''}"
      />
      <div class="flex flex-wrap items-center gap-3 mt-4 text-sm text-slate-500">
        <div class="flex items-center space-x-1.5">
          <i data-lucide="calendar" size="14"></i>
          <span>${formatTime(currentItem.created_at)}</span>
        </div>
        ${currentItem.sourceItem ? `
          <div class="flex items-center space-x-1.5 text-blue-600 cursor-pointer hover:underline max-w-xs truncate">
            <i data-lucide="file-text" size="14"></i>
            <span class="truncate" title="${escapeHtml(currentItem.sourceItem.title)} ${currentItem.source_page ? `(Page ${currentItem.source_page})` : ''}">
              ${escapeHtml(currentItem.sourceItem.title)} ${currentItem.source_page ? `(Page ${currentItem.source_page})` : ''}
            </span>
          </div>
        ` : ''}
        ${createConfidenceBadge(currentItem.confidence_score)}
      </div>
    </div>

    <!-- Core Content -->
    <div class="mb-6">
      <h4 class="text-sm font-bold text-slate-900 mb-3">详细内容</h4>
      <textarea 
        id="knowledge-content-input"
        ${!isEditMode ? 'readonly' : ''}
        class="w-full text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100 min-h-[200px] resize-none ${isEditMode ? 'border-blue-500 focus:ring-2 focus:ring-blue-500' : ''}"
        style="white-space: pre-wrap; word-wrap: break-word;"
      >${escapeHtml(currentItem.content)}</textarea>
      ${!isEditMode ? `
        <div class="mt-2 text-xs text-slate-400">
          <i data-lucide="info" size="12" class="inline mr-1"></i>
          点击"修正内容"按钮可编辑
        </div>
      ` : ''}
    </div>

    <!-- Category and Subcategory -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-bold text-slate-900">分类</h4>
        ${!isEditMode ? `
          <button 
            onclick="toggleEditMode()"
            class="text-xs text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
            title="调整分类"
          >
            <i data-lucide="edit-2" size="12"></i>
            <span>调整</span>
          </button>
        ` : ''}
      </div>
      <div class="flex gap-3 items-center">
        <div class="flex-1">
          <label class="block text-xs text-slate-500 mb-1">主分类</label>
          ${isEditMode ? `
            <div class="relative">
              <!-- 隐藏的原始 select 用于表单提交 -->
              <select id="knowledge-category-select" class="hidden">
                <option value="work" ${currentItem.category === 'work' ? 'selected' : ''}>工作</option>
                <option value="learning" ${currentItem.category === 'learning' ? 'selected' : ''}>学习</option>
                <option value="leisure" ${currentItem.category === 'leisure' ? 'selected' : ''}>娱乐</option>
                <option value="life" ${currentItem.category === 'life' ? 'selected' : ''}>生活</option>
              </select>
              <!-- 自定义选择框按钮 -->
              <button 
                type="button"
                id="knowledge-category-select-btn"
                class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-left flex items-center justify-between hover:bg-slate-50 hover:border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <span class="flex items-center gap-2">
                  ${(() => {
                    const category = currentItem.category || 'work';
                    const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.other;
                    return `<i data-lucide="${config.icon}" size="14" class="text-slate-600"></i><span>${config.name}</span>`;
                  })()}
                </span>
                <i data-lucide="chevron-down" size="16" class="text-slate-400 custom-select-arrow" id="knowledge-category-select-arrow"></i>
              </button>
              <!-- 下拉菜单 -->
              <div 
                id="knowledge-category-select-menu"
                class="hidden absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto custom-select-menu"
              >
                ${Object.keys(CATEGORY_CONFIG).filter(key => key !== 'other').map(category => {
                  const config = CATEGORY_CONFIG[category];
                  const isSelected = (currentItem.category || 'work') === category;
                  return `
                    <button
                      type="button"
                      data-value="${category}"
                      class="w-full px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-indigo-50 hover:text-indigo-700 transition-colors ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700'}"
                    >
                      <span class="flex items-center gap-2">
                        <i data-lucide="${config.icon}" size="14"></i>
                        <span>${config.name}</span>
                      </span>
                      ${isSelected ? '<i data-lucide="check" size="16" class="text-indigo-600"></i>' : ''}
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : `
            <div class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm flex items-center gap-2">
              ${(() => {
                const category = currentItem.category || 'work';
                const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.other;
                return `<i data-lucide="${config.icon}" size="14" class="text-slate-600"></i><span>${config.name}</span>`;
              })()}
            </div>
          `}
        </div>
        <div class="flex-1">
          <label class="block text-xs text-slate-500 mb-1">子分类</label>
          ${isEditMode ? `
            <div class="relative">
              <!-- 隐藏的原始 select 用于表单提交 -->
              <select id="knowledge-subcategory-select" class="hidden">
                <option value="">请选择子分类</option>
              </select>
              <!-- 自定义选择框按钮 -->
              <button 
                type="button"
                id="knowledge-subcategory-select-btn"
                class="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-left flex items-center justify-between hover:bg-slate-50 hover:border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <span class="flex items-center gap-2 ${!currentItem.subcategory || !currentItem.subcategory.name ? 'text-slate-400 italic' : 'text-slate-700'}">
                  ${(currentItem.subcategory && currentItem.subcategory.name) ? `<i data-lucide="tag" size="14" class="text-slate-600"></i><span>${currentItem.subcategory.name}</span>` : '请选择子分类'}
                </span>
                <i data-lucide="chevron-down" size="16" class="text-slate-400 custom-select-arrow" id="knowledge-subcategory-select-arrow"></i>
              </button>
              <!-- 下拉菜单 -->
              <div 
                id="knowledge-subcategory-select-menu"
                class="hidden absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto custom-select-menu"
              >
                <button
                  type="button"
                  data-value=""
                  class="w-full px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-slate-50 hover:text-slate-700 transition-colors ${!currentItem.subcategory_id ? 'bg-slate-50 text-slate-700 font-medium' : 'text-slate-500 italic'}"
                >
                  <span>请选择子分类</span>
                  ${!currentItem.subcategory_id ? '<i data-lucide="check" size="16" class="text-indigo-600"></i>' : ''}
                </button>
                <!-- 子分类选项将通过 JavaScript 动态填充 -->
                <div id="knowledge-subcategory-select-options"></div>
              </div>
            </div>
          ` : `
            <div class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm ${!currentItem.subcategory || !currentItem.subcategory.name ? 'text-slate-400 italic' : ''} flex items-center gap-2">
              ${(currentItem.subcategory && currentItem.subcategory.name) ? `<i data-lucide="tag" size="14" class="text-slate-600"></i><span>${currentItem.subcategory.name}</span>` : '未设置子分类（点击上方"调整"按钮可设置）'}
            </div>
          `}
        </div>
      </div>
    </div>

    <!-- Key Conclusions -->
    <div class="mb-6">
      <h4 class="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
        <span>关键结论</span>
        ${isEditMode ? `
          <button onclick="addKeyConclusion()" class="text-xs text-blue-600 font-normal hover:underline flex items-center">
            <i data-lucide="plus" size="12" class="mr-1"></i> 添加结论
          </button>
        ` : ''}
      </h4>
      <div id="key-conclusions-list" class="space-y-2">
        ${renderKeyConclusions()}
      </div>
    </div>
    
    <!-- Related Knowledge -->
    <div class="mb-4">
      <h4 class="text-sm font-bold text-slate-900 mb-3">相关知识推荐</h4>
      <div id="related-knowledge-list" class="space-y-3">
        ${renderRelatedKnowledge()}
      </div>
    </div>
  `;
}

/**
 * 渲染关键结论
 */
function renderKeyConclusions() {
  if (!currentItem.keyConclusions || currentItem.keyConclusions.length === 0) {
    return '<div class="text-slate-400 text-sm italic py-2">暂无关键结论</div>';
  }

  return currentItem.keyConclusions.map((conc, idx) => `
    <div class="flex items-start group gap-3" data-conclusion-index="${idx}">
      <div class="mt-2 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"></div>
      <div class="flex-1 min-w-0">
        ${isEditMode ? `
          <div class="flex items-start gap-2">
            <input 
              type="text" 
              value="${escapeHtml(conc)}"
              data-conclusion-index="${idx}"
              class="flex-1 p-2 rounded hover:bg-slate-50 transition-colors cursor-text text-slate-700 text-sm border border-transparent focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              style="word-wrap: break-word;"
            />
            <button onclick="removeKeyConclusion(${idx})" class="mt-2 p-1.5 text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <i data-lucide="x" size="14"></i>
            </button>
          </div>
        ` : `
          <div class="p-2 rounded hover:bg-slate-50 transition-colors text-slate-700 text-sm leading-relaxed break-words">
            ${escapeHtml(conc)}
          </div>
        `}
      </div>
    </div>
  `).join('');
}

/**
 * 渲染相关知识
 */
function renderRelatedKnowledge() {
  // 如果正在加载，显示加载提示
  if (currentItem._loadingRelated) {
    return '<div class="text-slate-400 text-sm italic py-2 flex items-center gap-2"><i data-lucide="loader-2" size="14" class="animate-spin text-indigo-600"></i> 正在加载相关知识...</div>';
  }
  
  if (!currentItem.relatedKnowledge || currentItem.relatedKnowledge.length === 0) {
    return '<div class="text-slate-400 text-sm italic py-2">暂无直接关联的知识点</div>';
  }

  return currentItem.relatedKnowledge.map(related => `
    <div 
      onclick="openKnowledgeDetail('${related.id}')"
      class="border border-slate-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all group"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <h5 class="font-medium text-slate-800 text-sm group-hover:text-blue-600 mb-1.5 break-words">${escapeHtml(related.title)}</h5>
          <p class="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">${escapeHtml(related.contentPreview || related.summary || '')}</p>
        </div>
        <div class="bg-blue-50 text-blue-600 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0">
          ${Math.round(related.similarityScore)}%
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * 渲染底部操作按钮
 */
function renderFooter() {
  if (isEditMode) {
    // 编辑模式：显示保存和取消按钮
    return `
      <button 
        onclick="cancelEdit()"
        class="px-4 py-2.5 text-slate-600 font-medium text-sm hover:bg-slate-50 rounded-lg transition-colors border border-slate-200 hover:border-slate-300"
      >
        取消
      </button>
      <button 
        onclick="saveKnowledgeItem('${currentItem.id}')"
        class="px-6 py-2.5 bg-blue-600 text-white font-medium text-sm rounded-lg shadow-sm hover:bg-blue-700 hover:shadow-md transition-all flex items-center gap-2"
      >
        <i data-lucide="save" size="16"></i>
        <span>保存</span>
      </button>
    `;
  } else if (currentItem.status === 'pending') {
    // 待审核状态：显示拒绝和确认按钮
    return `
      <button 
        onclick="deleteKnowledgeItem('${currentItem.id}')"
        class="px-4 py-2.5 text-red-600 font-medium text-sm hover:bg-red-50 rounded-lg transition-colors border border-red-200 hover:border-red-300"
      >
        拒绝并删除
      </button>
      <button 
        onclick="approveKnowledgeItem('${currentItem.id}')"
        class="px-6 py-2.5 bg-blue-600 text-white font-medium text-sm rounded-lg shadow-sm hover:bg-blue-700 hover:shadow-md transition-all flex items-center gap-2"
      >
        <i data-lucide="check" size="16"></i>
        <span>确认通过</span>
      </button>
    `;
  } else {
    // 已确认状态：显示关闭按钮
    return `
      <button 
        onclick="closeKnowledgeDetail()"
        class="px-6 py-2 bg-slate-900 text-white font-medium text-sm rounded-lg shadow-sm hover:bg-slate-800 transition-all"
      >
        关闭
      </button>
    `;
  }
}

// 保存编辑前的原始内容
let originalItem = null;

/**
 * 切换编辑模式
 */
function toggleEditMode() {
  if (!isEditMode) {
    // 进入编辑模式：保存原始内容
    originalItem = JSON.parse(JSON.stringify(currentItem));
  }
  isEditMode = !isEditMode;
  renderDetailDrawer();
  
  // 添加键盘快捷键监听
  if (isEditMode) {
    document.addEventListener('keydown', handleEditKeyboard);
    // 初始化自定义选择框
    initCustomSelects();
    // 加载子分类选项
    loadSubcategoriesForCategory(currentItem.category || 'work');
  } else {
    document.removeEventListener('keydown', handleEditKeyboard);
    // 关闭所有打开的下拉菜单
    closeAllSelectMenus();
  }
}

/**
 * 加载子分类选项
 */
async function loadSubcategoriesForCategory(category) {
  try {
    const response = await knowledgeAPI.getSubcategories(category);
    if (response.success) {
      // 更新隐藏的 select
      const subcategorySelect = document.getElementById('knowledge-subcategory-select');
      if (subcategorySelect) {
        subcategorySelect.innerHTML = '<option value="">请选择子分类</option>';
        response.data.forEach(subcat => {
          const option = document.createElement('option');
          option.value = subcat.id;
          option.textContent = subcat.name;
          if (currentItem.subcategory_id === subcat.id) {
            option.selected = true;
          }
          subcategorySelect.appendChild(option);
        });
      }
      
      // 更新自定义选择框的菜单选项（单选：确保只有一个选项被选中）
      const menuOptions = document.getElementById('knowledge-subcategory-select-options');
      if (menuOptions) {
        // 确保只有一个子分类被选中
        const selectedSubcategoryId = currentItem.subcategory_id || null;
        menuOptions.innerHTML = response.data.map(subcat => {
          const isSelected = selectedSubcategoryId === subcat.id;
          return `
            <button
              type="button"
              data-value="${subcat.id}"
              class="w-full px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-indigo-50 hover:text-indigo-700 transition-colors ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700'}"
            >
              <span class="flex items-center gap-2">
                <i data-lucide="tag" size="14"></i>
                <span>${subcat.name}</span>
              </span>
              ${isSelected ? '<i data-lucide="check" size="16" class="text-indigo-600"></i>' : ''}
            </button>
          `;
        }).join('');
        
        // 重新初始化图标
        if (window.lucide) {
          window.lucide.createIcons(menuOptions);
        }
        
        // 为新的选项按钮绑定点击事件
        menuOptions.querySelectorAll('button[data-value]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            handleSubcategorySelect(e.currentTarget.dataset.value);
          });
        });
      }
      
      // 更新按钮显示
      const btn = document.getElementById('knowledge-subcategory-select-btn');
      if (btn && currentItem.subcategory_id) {
        const selectedSubcat = response.data.find(sc => sc.id === currentItem.subcategory_id);
        if (selectedSubcat) {
          const btnSpan = btn.querySelector('span');
          if (btnSpan) {
            btnSpan.className = 'flex items-center gap-2 text-slate-700';
            btnSpan.innerHTML = `<i data-lucide="tag" size="14" class="text-slate-600"></i><span>${selectedSubcat.name}</span>`;
            if (window.lucide) {
              window.lucide.createIcons(btnSpan);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('加载子分类失败:', error);
  }
}

/**
 * 外部点击处理函数（用于关闭下拉菜单）
 */
function handleSelectOutsideClick(e) {
  const categoryBtn = document.getElementById('knowledge-category-select-btn');
  const categoryMenu = document.getElementById('knowledge-category-select-menu');
  const subcategoryBtn = document.getElementById('knowledge-subcategory-select-btn');
  const subcategoryMenu = document.getElementById('knowledge-subcategory-select-menu');
  
  if (!categoryBtn?.contains(e.target) && !categoryMenu?.contains(e.target) &&
      !subcategoryBtn?.contains(e.target) && !subcategoryMenu?.contains(e.target)) {
    closeAllSelectMenus();
    // 移除监听器
    document.removeEventListener('click', handleSelectOutsideClick, true);
  }
}

/**
 * 初始化自定义选择框
 */
function initCustomSelects() {
  // 初始化图标
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    // 安全地初始化图标：使用 drawerElement 变量或查找实际存在的元素
    const drawerEl = drawerElement || document.getElementById('knowledge-detail-drawer');
    if (drawerEl) {
      try {
        window.lucide.createIcons(drawerEl);
      } catch (error) {
        console.warn('初始化 Lucide 图标失败:', error);
        // 降级方案：在整个文档中初始化（可能较慢，但至少不会出错）
        try {
          window.lucide.createIcons();
        } catch (fallbackError) {
          console.error('Lucide 图标初始化完全失败:', fallbackError);
        }
      }
    } else {
      // 如果找不到抽屉元素，在整个文档中初始化
      try {
        window.lucide.createIcons();
      } catch (error) {
        console.error('Lucide 图标初始化失败:', error);
      }
    }
  }
  
  // 主分类选择框
  const categoryBtn = document.getElementById('knowledge-category-select-btn');
  const categoryMenu = document.getElementById('knowledge-category-select-menu');
  const categorySelect = document.getElementById('knowledge-category-select');
  const categoryArrow = document.getElementById('knowledge-category-select-arrow');
  
  if (categoryBtn && categoryMenu) {
    // 点击按钮展开/收起菜单
    categoryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !categoryMenu.classList.contains('hidden');
      
      // 关闭所有其他菜单
      closeAllSelectMenus();
      document.removeEventListener('click', handleSelectOutsideClick, true);
      
      if (!isOpen) {
        categoryMenu.classList.remove('hidden');
        if (categoryArrow) {
          categoryArrow.style.transform = 'rotate(180deg)';
        }
        categoryBtn.classList.add('ring-2', 'ring-indigo-500', 'border-indigo-500');
        // 添加外部点击监听器（延迟绑定，避免立即触发）
        setTimeout(() => {
          document.addEventListener('click', handleSelectOutsideClick, true);
        }, 0);
      } else {
        categoryMenu.classList.add('hidden');
        if (categoryArrow) {
          categoryArrow.style.transform = 'rotate(0deg)';
        }
        categoryBtn.classList.remove('ring-2', 'ring-indigo-500', 'border-indigo-500');
      }
    });
    
    // 点击菜单选项
    categoryMenu.querySelectorAll('button[data-value]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCategorySelect(e.currentTarget.dataset.value);
        document.removeEventListener('click', handleSelectOutsideClick, true);
      });
    });
  }
  
  // 子分类选择框
  const subcategoryBtn = document.getElementById('knowledge-subcategory-select-btn');
  const subcategoryMenu = document.getElementById('knowledge-subcategory-select-menu');
  const subcategoryArrow = document.getElementById('knowledge-subcategory-select-arrow');
  
  if (subcategoryBtn && subcategoryMenu) {
    // 点击按钮展开/收起菜单
    subcategoryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !subcategoryMenu.classList.contains('hidden');
      
      // 关闭所有其他菜单
      closeAllSelectMenus();
      document.removeEventListener('click', handleSelectOutsideClick, true);
      
      if (!isOpen) {
        subcategoryMenu.classList.remove('hidden');
        if (subcategoryArrow) {
          subcategoryArrow.style.transform = 'rotate(180deg)';
        }
        subcategoryBtn.classList.add('ring-2', 'ring-indigo-500', 'border-indigo-500');
        // 添加外部点击监听器（延迟绑定，避免立即触发）
        setTimeout(() => {
          document.addEventListener('click', handleSelectOutsideClick, true);
        }, 0);
      } else {
        subcategoryMenu.classList.add('hidden');
        if (subcategoryArrow) {
          subcategoryArrow.style.transform = 'rotate(0deg)';
        }
        subcategoryBtn.classList.remove('ring-2', 'ring-indigo-500', 'border-indigo-500');
      }
    });
    
    // 点击"请选择子分类"选项
    const emptyOption = subcategoryMenu.querySelector('button[data-value=""]');
    if (emptyOption) {
      emptyOption.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSubcategorySelect('');
        document.removeEventListener('click', handleSelectOutsideClick, true);
      });
    }
  }
}

/**
 * 关闭所有选择框菜单
 */
function closeAllSelectMenus() {
  const categoryMenu = document.getElementById('knowledge-category-select-menu');
  const categoryBtn = document.getElementById('knowledge-category-select-btn');
  const categoryArrow = document.getElementById('knowledge-category-select-arrow');
  
  const subcategoryMenu = document.getElementById('knowledge-subcategory-select-menu');
  const subcategoryBtn = document.getElementById('knowledge-subcategory-select-btn');
  const subcategoryArrow = document.getElementById('knowledge-subcategory-select-arrow');
  
  if (categoryMenu) {
    categoryMenu.classList.add('hidden');
  }
  if (categoryBtn) {
    categoryBtn.classList.remove('ring-2', 'ring-indigo-500', 'border-indigo-500');
  }
  if (categoryArrow) {
    categoryArrow.style.transform = 'rotate(0deg)';
  }
  
  if (subcategoryMenu) {
    subcategoryMenu.classList.add('hidden');
  }
  if (subcategoryBtn) {
    subcategoryBtn.classList.remove('ring-2', 'ring-indigo-500', 'border-indigo-500');
  }
  if (subcategoryArrow) {
    subcategoryArrow.style.transform = 'rotate(0deg)';
  }
  
  // 移除外部点击监听器
  document.removeEventListener('click', handleSelectOutsideClick, true);
}

/**
 * 处理分类选择
 */
function handleCategorySelect(category) {
  // 更新隐藏的 select
  const categorySelect = document.getElementById('knowledge-category-select');
  if (categorySelect) {
    categorySelect.value = category;
    // 触发 change 事件
    categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  
  // 更新按钮显示
  const categoryBtn = document.getElementById('knowledge-category-select-btn');
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.other;
  if (categoryBtn) {
    const btnSpan = categoryBtn.querySelector('span.flex.items-center.gap-2');
    if (btnSpan) {
      btnSpan.innerHTML = `<i data-lucide="${config.icon}" size="14" class="text-slate-600"></i><span>${config.name}</span>`;
      if (window.lucide) {
        window.lucide.createIcons(btnSpan);
      }
    }
  }
  
  // 更新菜单中的选中状态（单选：确保只有一个选项被选中）
  const categoryMenu = document.getElementById('knowledge-category-select-menu');
  if (categoryMenu) {
    // 先清除所有选项的选中状态
    categoryMenu.querySelectorAll('button[data-value]').forEach(btn => {
      // 清除所有可能的选中样式
      btn.classList.remove('bg-indigo-50', 'text-indigo-700', 'font-medium', 'text-slate-700');
      btn.classList.add('text-slate-700');
      
      // 移除所有勾选图标
      const checkIcon = btn.querySelector('i[data-lucide="check"]');
      if (checkIcon) {
        checkIcon.remove();
      }
    });
    
    // 然后只选中当前选项
    const selectedBtn = categoryMenu.querySelector(`button[data-value="${category}"]`);
    if (selectedBtn) {
      selectedBtn.classList.remove('text-slate-700');
      selectedBtn.classList.add('bg-indigo-50', 'text-indigo-700', 'font-medium');
      
      // 添加勾选图标（使用更安全的方式）
      const buttonContainer = selectedBtn.querySelector('span.flex.items-center.justify-between');
      if (buttonContainer && !buttonContainer.querySelector('i[data-lucide="check"]')) {
        const checkIcon = document.createElement('i');
        checkIcon.setAttribute('data-lucide', 'check');
        checkIcon.setAttribute('size', '16');
        checkIcon.className = 'text-indigo-600';
        buttonContainer.appendChild(checkIcon);
      }
      
      // 重新初始化图标（确保新添加的勾选图标能正确显示）
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try {
          window.lucide.createIcons(categoryMenu);
        } catch (e) {
          console.warn('初始化 Lucide 图标失败:', e);
        }
      }
    }
  }
  
  // 关闭菜单
  closeAllSelectMenus();
  
  // 加载子分类
  loadSubcategoriesForCategory(category);
}

/**
 * 处理子分类选择
 */
function handleSubcategorySelect(subcategoryId) {
  // 更新隐藏的 select
  const subcategorySelect = document.getElementById('knowledge-subcategory-select');
  if (subcategorySelect) {
    subcategorySelect.value = subcategoryId || '';
  }
  
  // 更新按钮显示
  const subcategoryBtn = document.getElementById('knowledge-subcategory-select-btn');
  if (subcategoryBtn) {
    if (subcategoryId) {
      const selectedOption = subcategorySelect?.querySelector(`option[value="${subcategoryId}"]`);
      const subcategoryName = selectedOption ? selectedOption.textContent : '';
      if (subcategoryName) {
        const btnSpan = subcategoryBtn.querySelector('span');
        if (btnSpan) {
          btnSpan.className = 'flex items-center gap-2 text-slate-700';
          btnSpan.innerHTML = `<i data-lucide="tag" size="14" class="text-slate-600"></i><span>${subcategoryName}</span>`;
          if (window.lucide) {
            window.lucide.createIcons(btnSpan);
          }
        }
      }
    } else {
      const btnSpan = subcategoryBtn.querySelector('span');
      if (btnSpan) {
        btnSpan.className = 'flex items-center gap-2 text-slate-400 italic';
        btnSpan.textContent = '请选择子分类';
      }
    }
  }
  
  // 更新菜单中的选中状态（单选：确保只有一个选项被选中）
  const subcategoryMenu = document.getElementById('knowledge-subcategory-select-menu');
  if (subcategoryMenu) {
    // 先清除所有选项的选中状态
    subcategoryMenu.querySelectorAll('button[data-value]').forEach(btn => {
      // 清除所有可能的选中样式
      btn.classList.remove('bg-indigo-50', 'text-indigo-700', 'font-medium', 'text-slate-700', 'text-slate-500', 'italic');
      
      // 移除所有勾选图标
      const checkIcon = btn.querySelector('i[data-lucide="check"]');
      if (checkIcon) {
        checkIcon.remove();
      }
      
      // 恢复默认样式
      if (btn.dataset.value === '') {
        btn.classList.add('text-slate-500', 'italic');
      } else {
        btn.classList.add('text-slate-700');
      }
    });
    
    // 然后只选中当前选项
    const selectedBtn = subcategoryMenu.querySelector(`button[data-value="${subcategoryId || ''}"]`);
    if (selectedBtn) {
      selectedBtn.classList.remove('text-slate-700', 'text-slate-500', 'italic');
      selectedBtn.classList.add('bg-indigo-50', 'text-indigo-700', 'font-medium');
      
      // 添加勾选图标（使用更安全的方式）
      const buttonContainer = selectedBtn.querySelector('span.flex.items-center.justify-between');
      if (buttonContainer && !buttonContainer.querySelector('i[data-lucide="check"]')) {
        const checkIcon = document.createElement('i');
        checkIcon.setAttribute('data-lucide', 'check');
        checkIcon.setAttribute('size', '16');
        checkIcon.className = 'text-indigo-600';
        buttonContainer.appendChild(checkIcon);
      }
      
      // 重新初始化图标（确保新添加的勾选图标能正确显示）
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try {
          window.lucide.createIcons(subcategoryMenu);
        } catch (e) {
          console.warn('初始化 Lucide 图标失败:', e);
        }
      }
    }
  }
  
  // 关闭菜单
  closeAllSelectMenus();
}

/**
 * 取消编辑
 */
function cancelEdit() {
  if (originalItem) {
    currentItem = originalItem;
    originalItem = null;
  }
  isEditMode = false;
  document.removeEventListener('keydown', handleEditKeyboard);
  renderDetailDrawer();
}

/**
 * 处理编辑模式的键盘快捷键
 */
function handleEditKeyboard(e) {
  // Ctrl+S 或 Cmd+S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveKnowledgeItem();
  }
  // Esc 取消
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
}

/**
 * 保存知识点
 */
async function saveKnowledgeItem(itemId = null) {
  const titleInput = document.getElementById('knowledge-title-input');
  const contentInput = document.getElementById('knowledge-content-input');
  const conclusionInputs = document.querySelectorAll('[data-conclusion-index]');
  
  // 安全获取值，处理 undefined 和 null
  const title = titleInput?.value?.trim() || '';
  const content = contentInput?.value?.trim() || '';
  const keyConclusions = Array.from(conclusionInputs)
    .map(input => {
      const value = input?.value;
      return value && typeof value === 'string' ? value.trim() : '';
    })
    .filter(v => v);

  if (!title || !content) {
    showToast('标题和内容不能为空', 'error');
    return;
  }

  const loadingToast = showLoadingToast('保存中...');

  try {
    // 获取分类和子分类
    const categorySelect = document.getElementById('knowledge-category-select');
    const subcategorySelect = document.getElementById('knowledge-subcategory-select');
    const category = categorySelect?.value || currentItem.category;
    const subcategory_id = subcategorySelect?.value || currentItem.subcategory_id || null;

    const response = await knowledgeAPI.updateItem(currentItem.id, {
      title,
      content,
      keyConclusions,
      category,
      subcategory_id
    });

    if (!response.success) {
      throw new Error(response.message || '保存失败');
    }

    currentItem = response.data;
    originalItem = null;
    isEditMode = false;
    document.removeEventListener('keydown', handleEditKeyboard);
    
    loadingToast.close();
    renderDetailDrawer();
    showToast('保存成功', 'success');
    
    // 刷新列表 - 更新当前项的分类等信息并刷新视图
    setTimeout(async () => {
      try {
        // 清除 API 缓存，确保获取最新数据
        const { clearAPICache } = await import('./api.js');
        clearAPICache();
        
        const { loadKnowledgeItems, getKnowledgeState } = await import('./knowledge-items.js');
        const state = getKnowledgeState();
        
        // 更新列表中对应项的数据（立即更新UI，避免闪烁）
        const itemIndex = state.items.findIndex(item => item.id === currentItem.id);
        if (itemIndex !== -1) {
          // 合并更新后的数据
          state.items[itemIndex] = { 
            ...state.items[itemIndex], 
            ...response.data,
            category: response.data.category || state.items[itemIndex].category,
            subcategory_id: response.data.subcategory_id !== undefined ? response.data.subcategory_id : state.items[itemIndex].subcategory_id,
            subcategory: response.data.subcategory || state.items[itemIndex].subcategory,
            title: response.data.title || state.items[itemIndex].title
          };
        }
        
        // 重置到第一页并重新加载数据，这会：
        // 1. 重新从服务器获取最新数据
        // 2. 重新应用所有筛选条件（状态、分类、搜索）
        // 3. 更新 filteredItems
        // 4. 调用 renderKnowledgeView() 刷新卡片视图
        // 5. 调用 renderCategoryFilters() 更新分类筛选器计数
        state.currentPage = 1;
        await loadKnowledgeItems();
      } catch (error) {
        console.error('刷新列表失败:', error);
        // 降级方案：如果 loadKnowledgeItems 失败，尝试重新初始化视图
        try {
          const { initKnowledgeView } = await import('./knowledge-items.js');
          await initKnowledgeView();
        } catch (fallbackError) {
          console.error('重新初始化视图也失败:', fallbackError);
          if (window.refreshKnowledgeList) {
            window.refreshKnowledgeList();
          }
        }
      }
    }, 100);
  } catch (error) {
    loadingToast.close();
    console.error('保存失败:', error);
    showToast(error.message || '保存失败', 'error');
  }
}

/**
 * 确认知识点
 */
async function approveKnowledgeItem(itemId) {
  const loadingToast = showLoadingToast('确认中...');

  try {
    const response = await knowledgeAPI.updateItem(itemId, {
      status: 'confirmed'
    });

    if (!response.success) {
      throw new Error(response.message || '确认失败');
    }

    loadingToast.close();

    currentItem = response.data;
    renderDetailDrawer();
    showToast('知识点已确认，现在可以在智能问答中使用', 'success');
    
    // 刷新列表 - 更新当前项的状态并刷新视图
    setTimeout(async () => {
      try {
        // 清除 API 缓存，确保获取最新数据
        const { clearAPICache } = await import('./api.js');
        clearAPICache();
        
        const { loadKnowledgeItems, getKnowledgeState, renderKnowledgeView } = await import('./knowledge-items.js');
        const state = getKnowledgeState();
        
        // 更新列表中对应项的状态（立即更新UI）
        const itemIndex = state.items.findIndex(item => item.id === itemId);
        if (itemIndex !== -1) {
          state.items[itemIndex] = { ...state.items[itemIndex], status: 'confirmed' };
        }
        const filteredIndex = state.filteredItems.findIndex(item => item.id === itemId);
        if (filteredIndex !== -1) {
          state.filteredItems[filteredIndex] = { ...state.filteredItems[filteredIndex], status: 'confirmed' };
        }
        
        // 立即更新视图
        renderKnowledgeView();
        
        // 重新加载数据，这会自动应用筛选和渲染
        await loadKnowledgeItems();
      } catch (error) {
        console.error('刷新列表失败:', error);
        // 降级方案
        if (window.refreshKnowledgeList) {
          window.refreshKnowledgeList();
        }
      }
    }, 100);
  } catch (error) {
    loadingToast.close();
    console.error('确认失败:', error);
    showToast(error.message || '确认失败', 'error');
  }
}

/**
 * 删除知识点
 */
async function deleteKnowledgeItem(itemId) {
  try {
    await showConfirm('确定要删除这个知识点吗？\n\n删除后无法恢复，该知识点将从智能问答中移除。', {
      title: '确认删除',
      type: 'warning'
    });
  } catch {
    return; // 用户取消
  }

  const loadingToast = showLoadingToast('删除中...');

  try {
    const response = await knowledgeAPI.deleteItem(itemId);

    if (!response.success) {
      throw new Error(response.message || '删除失败');
    }

    loadingToast.close();
    
    showToast('知识点已删除', 'success');
    closeKnowledgeDetail();
    
    // 刷新列表 - 清除缓存并重新加载数据
    setTimeout(async () => {
      try {
        // 清除 API 缓存，确保获取最新数据
        const { clearAPICache } = await import('./api.js');
        clearAPICache();
        
        const { loadKnowledgeItems, getKnowledgeState } = await import('./knowledge-items.js');
        const state = getKnowledgeState();
        
        // 从状态中移除已删除的项（立即更新UI）
        state.items = state.items.filter(item => item.id !== itemId);
        state.filteredItems = state.filteredItems.filter(item => item.id !== itemId);
        
        // 立即更新视图
        const { renderKnowledgeView } = await import('./knowledge-items.js');
        renderKnowledgeView();
        
        // 重置到第一页并重新加载，确保获取最新数据
        state.currentPage = 1;
        await loadKnowledgeItems();
      } catch (error) {
        console.error('刷新列表失败:', error);
        // 降级方案：如果上面的方法失败，使用完整的初始化
        if (window.refreshKnowledgeList) {
          window.refreshKnowledgeList();
        } else {
          import('./knowledge-items.js').then(({ initKnowledgeView }) => {
            initKnowledgeView();
          });
        }
      }
    }, 300);
  } catch (error) {
    loadingToast.close();
    console.error('删除失败:', error);
    showToast(error.message || '删除失败', 'error');
  }
}

/**
 * 添加关键结论
 */
function addKeyConclusion() {
  if (!currentItem.keyConclusions) {
    currentItem.keyConclusions = [];
  }
  currentItem.keyConclusions.push('');
  renderDetailDrawer();
}

/**
 * 删除关键结论
 */
function removeKeyConclusion(index) {
  if (currentItem.keyConclusions && currentItem.keyConclusions.length > index) {
    currentItem.keyConclusions.splice(index, 1);
    renderDetailDrawer();
  }
}

/**
 * 创建状态徽章
 */
function createStatusBadge(status, item = {}) {
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
    // 所有pending状态统一显示为"待确认"
    // 但根据置信度区分显示，帮助用户识别哪些可以快速批量确认
    let pendingLabel = '待确认';
    if (confidence >= 85) {
      // 高置信度：可以快速批量确认
      pendingLabel = `待确认 (${confidence}%)`;
    } else if (confidence >= 80) {
      // 中等置信度
      pendingLabel = `待确认 (${confidence}%)`;
    } else {
      // 低置信度：需要仔细审查
      pendingLabel = `待确认 (${confidence}%，需审查)`;
    }
    
    config = {
      color: confidence >= 85 
        ? 'bg-amber-50 text-amber-700 border-amber-200' // 高置信度用稍微明显的颜色
        : confidence >= 80
        ? 'bg-slate-100 text-slate-500 border-slate-200'
        : 'bg-orange-50 text-orange-600 border-orange-200', // 低置信度用橙色提醒
      label: pendingLabel,
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
    <span class="px-2 py-0.5 rounded-md text-xs font-medium border flex items-center gap-1 ${color}">
      <i data-lucide="${icon}" size="10"></i>
      ${label}
      ${showManual ? '<span class="ml-1 text-[10px] opacity-75">(人工确认)</span>' : ''}
    </span>
  `;
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
 * HTML转义
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 暴露全局函数
window.openKnowledgeDetail = openKnowledgeDetail;
window.closeKnowledgeDetail = closeKnowledgeDetail;

