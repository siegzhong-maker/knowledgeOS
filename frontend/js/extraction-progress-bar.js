// 提取进度通知栏组件
// 在页面底部显示知识提取任务的进度

// 任务状态管理
const progressTasks = new Map();

// 通知栏容器
let progressBarContainer = null;

// 提取阶段定义（按顺序）
const EXTRACTION_STAGES = [
  { id: 'parsing', label: '解析文档', icon: 'file-text', color: 'blue' },
  { id: 'extracting', label: '提取知识', icon: 'sparkles', color: 'blue' },
  { id: 'summarizing', label: '生成摘要', icon: 'file-edit', color: 'blue' },
  { id: 'saving', label: '保存结果', icon: 'save', color: 'blue' }
];

// 任务开始时间记录
const taskStartTimes = new Map();

// 进度历史记录（用于防止回退）
const progressHistory = new Map();

/**
 * 初始化进度通知栏
 */
function initProgressBar() {
  if (progressBarContainer) return;

  progressBarContainer = document.createElement('div');
  progressBarContainer.id = 'extraction-progress-bar';
  // 改为固定在右上角，不遮挡主要内容区域
  progressBarContainer.className = 'fixed top-20 right-4 z-50 pointer-events-none max-w-md';
  document.body.appendChild(progressBarContainer);
}

/**
 * 添加或更新提取任务
 * @param {string} extractionId - 提取任务ID
 * @param {Object} taskInfo - 任务信息
 */
export function updateExtractionProgress(extractionId, taskInfo) {
  initProgressBar();

  const {
    docName = '文档',
    status = 'processing',
    progress = 0,
    totalItems = 0,
    processedItems = 0,
    extractedCount = 0,
    error = null,
    stage = 'parsing',
    knowledgeItems = [],
    currentDocIndex = 0,
    etaSeconds = null
  } = taskInfo;

  // 记录任务开始时间
  if (!taskStartTimes.has(extractionId)) {
    taskStartTimes.set(extractionId, Date.now());
    progressHistory.set(extractionId, []);
  }

  // 防止进度回退：使用历史最大值
  const history = progressHistory.get(extractionId) || [];
  const maxProgress = history.length > 0 ? Math.max(...history) : 0;
  const finalProgress = Math.max(maxProgress, progress);
  
  // 更新历史记录
  if (finalProgress > maxProgress) {
    history.push(finalProgress);
    // 只保留最近50条记录
    if (history.length > 50) {
      history.shift();
    }
    progressHistory.set(extractionId, history);
  }

  progressTasks.set(extractionId, {
    extractionId,
    docName,
    status,
    progress: finalProgress,
    totalItems,
    processedItems,
    extractedCount,
    error,
    stage,
    currentDocIndex,
    etaSeconds,
    knowledgeItems: knowledgeItems || [],
    timestamp: Date.now()
  });

  renderProgressBar();
}

/**
 * 移除提取任务
 * @param {string} extractionId - 提取任务ID
 */
export function removeExtractionTask(extractionId) {
  progressTasks.delete(extractionId);
  taskStartTimes.delete(extractionId);
  progressHistory.delete(extractionId);
  renderProgressBar();
}

/**
 * 渲染进度通知栏
 */
function renderProgressBar() {
  if (!progressBarContainer) return;

  const tasks = Array.from(progressTasks.values());
  
  if (tasks.length === 0) {
    progressBarContainer.innerHTML = '';
    return;
  }

  const tasksHTML = tasks.map(task => createTaskCard(task)).join('');
  
  progressBarContainer.innerHTML = `
    <div class="pointer-events-auto space-y-2">
      ${tasksHTML}
    </div>
  `;

  // 初始化Lucide图标
  if (window.lucide) {
    window.lucide.createIcons(progressBarContainer);
  }
}

/**
 * 格式化剩余时间
 * @param {number|null} etaSeconds - 预估剩余秒数
 * @returns {string|null} 格式化的剩余时间文本
 */
function formatRemainingTime(etaSeconds) {
  if (etaSeconds === null || etaSeconds === undefined || etaSeconds < 0) {
    return null;
  }
  
  if (etaSeconds < 60) {
    return `约 ${etaSeconds} 秒`;
  } else if (etaSeconds < 3600) {
    const minutes = Math.round(etaSeconds / 60);
    return `约 ${minutes} 分钟`;
  } else {
    return '预估中...';
  }
}

/**
 * 渲染阶段指示器
 * @param {string} currentStage - 当前阶段
 * @param {string} status - 任务状态
 * @returns {string} HTML字符串
 */
function renderStageProgress(currentStage, status = 'processing') {
  const currentStageIndex = EXTRACTION_STAGES.findIndex(s => s.id === currentStage);
  const isCompleted = status === 'completed';
  
  return `
    <div class="flex items-center gap-2 mt-2 mb-2">
      ${EXTRACTION_STAGES.map((stage, index) => {
        let stageClass = '';
        let iconClass = '';
        let lineClass = '';
        
        if (isCompleted || index < currentStageIndex) {
          // 已完成阶段：绿色实心圆
          stageClass = 'text-green-600';
          iconClass = 'check-circle';
        } else if (index === currentStageIndex) {
          // 当前阶段：蓝色实心圆 + 动画
          stageClass = 'text-blue-600';
          iconClass = status === 'processing' ? 'loader-2 animate-spin' : 'circle';
        } else {
          // 未开始阶段：灰色空心圆
          stageClass = 'text-slate-300';
          iconClass = 'circle';
        }
        
        // 连接线（最后一个不显示）
        const showLine = index < EXTRACTION_STAGES.length - 1;
        if (showLine) {
          if (isCompleted || index < currentStageIndex) {
            lineClass = 'bg-green-500';
          } else if (index === currentStageIndex && status === 'processing') {
            lineClass = 'bg-blue-500';
          } else {
            lineClass = 'bg-slate-200';
          }
        }
        
        return `
          <div class="flex items-center">
            <div class="flex items-center ${stageClass}" title="${stage.label}">
              <i data-lucide="${iconClass}" size="12" class="${index === currentStageIndex && status === 'processing' ? 'animate-pulse' : ''}"></i>
            </div>
            ${showLine ? `<div class="w-4 h-0.5 ${lineClass} mx-0.5"></div>` : ''}
          </div>
        `;
      }).join('')}
      <span class="text-[11px] text-slate-600 ml-1 font-medium">${EXTRACTION_STAGES[currentStageIndex]?.label || ''}</span>
    </div>
  `;
}

/**
 * 创建任务卡片
 * @param {Object} task - 任务信息
 */
function createTaskCard(task) {
  const { 
    extractionId, 
    docName, 
    status, 
    progress, 
    totalItems, 
    processedItems, 
    extractedCount, 
    error, 
    stage, 
    knowledgeItems,
    currentDocIndex,
    etaSeconds
  } = task;

  let statusIcon = '';
  let statusText = '';
  let statusColor = '';

  if (status === 'processing') {
    statusIcon = '<i data-lucide="loader-2" class="animate-spin" size="16"></i>';
    statusText = '提取中';
    statusColor = 'text-blue-600';
  } else if (status === 'completed') {
    statusIcon = '<i data-lucide="check-circle" size="16"></i>';
    statusText = '提取完成';
    statusColor = 'text-green-600';
  } else if (status === 'failed') {
    statusIcon = '<i data-lucide="x-circle" size="16"></i>';
    statusText = '提取失败';
    statusColor = 'text-red-600';
  }

  // 格式化剩余时间
  const remainingTime = status === 'processing' ? formatRemainingTime(etaSeconds) : null;

  // 主进度条（0-100%）
  const progressBar = status === 'processing' || status === 'completed' ? `
    <div class="w-full bg-slate-200 rounded-full h-2 overflow-hidden mb-2">
      <div 
        class="${status === 'completed' ? 'bg-gradient-to-r from-green-500 to-green-600' : 'bg-gradient-to-r from-blue-500 via-blue-600 to-green-500'} h-full transition-all duration-300 ease-out rounded-full"
        style="width: ${Math.min(100, Math.max(0, progress))}%"
      ></div>
    </div>
  ` : '';

  // 文档进度文案
  let docProgressText = '';
  if (totalItems === 1) {
    docProgressText = `1 个文档`;
  } else {
    docProgressText = `第 ${currentDocIndex || processedItems || 0}/${totalItems} 个文档`;
  }
  
  const progressText = status === 'processing' 
    ? `${docProgressText} · 已提取 ${extractedCount} 条知识${remainingTime ? ` · ${remainingTime}` : ''}`
    : status === 'completed'
    ? `成功生成 ${extractedCount} 个知识点`
    : error || '提取失败';

  // 预览已提取的知识点（紧凑版，仅在空间允许时显示）
  const previewSection = status === 'processing' && knowledgeItems && knowledgeItems.length > 0 && knowledgeItems.length <= 2 ? `
    <div class="mt-1.5 pt-1.5 border-t border-slate-100">
      <div class="text-[10px] text-slate-500 mb-1">已提取 (${knowledgeItems.length}):</div>
      <div class="flex flex-wrap gap-1">
        ${knowledgeItems.slice(0, 2).map(item => `
          <span class="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded border border-blue-200 truncate max-w-[150px]" title="${escapeHtml(item.title)}">
            ${escapeHtml(item.title.length > 15 ? item.title.substring(0, 15) + '...' : item.title)}
          </span>
        `).join('')}
      </div>
    </div>
  ` : '';

  // 优化后的卡片设计
  return `
    <div class="bg-white rounded-lg border ${status === 'completed' ? 'border-green-200' : status === 'failed' ? 'border-red-200' : 'border-slate-200'} shadow-lg p-3 hover:shadow-xl transition-all">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <!-- 标题栏 -->
          <div class="flex items-center gap-2 mb-2">
            <div class="${statusColor}">
              ${statusIcon}
            </div>
            <span class="text-sm font-semibold text-slate-800 truncate max-w-[220px]">${escapeHtml(docName)}</span>
            <span class="text-xs ${statusColor} font-medium whitespace-nowrap">${statusText}</span>
          </div>
          
          <!-- 阶段指示器 -->
          ${status === 'processing' || status === 'completed' ? renderStageProgress(stage || 'parsing', status) : ''}
          
          <!-- 主进度条 -->
          ${progressBar}
          
          <!-- 进度信息 -->
          <div class="flex items-center justify-between mt-2">
            <div class="text-xs text-slate-600 font-medium">${progressText}</div>
            ${status === 'processing' ? `<div class="text-xs font-semibold text-blue-600">${Math.min(100, Math.max(0, progress))}%</div>` : ''}
          </div>
          
          ${previewSection}
        </div>
        
        <!-- 操作按钮 -->
        <div class="flex items-center gap-1 flex-shrink-0">
          ${status === 'processing' ? `
            <button
              onclick="window.cancelExtraction && window.cancelExtraction('${extractionId}')"
              class="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="取消提取"
            >
              <i data-lucide="x" size="14"></i>
            </button>
          ` : status === 'completed' ? `
            <button
              onclick="window.switchView && window.switchView('knowledge-items')"
              class="px-2 py-1 text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors"
              title="查看本次新提取"
            >
              <span>查看本次新提取</span>
            </button>
            <button
              onclick="window.removeExtractionTask && window.removeExtractionTask('${extractionId}')"
              class="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
              title="关闭"
            >
              <i data-lucide="x" size="14"></i>
            </button>
          ` : status === 'failed' ? `
            <button
              onclick="window.removeExtractionTask && window.removeExtractionTask('${extractionId}')"
              class="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="关闭"
            >
              <i data-lucide="x" size="14"></i>
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 取消提取任务
 * @param {string} extractionId - 提取任务ID
 */
function cancelExtraction(extractionId) {
  // TODO: 实现取消提取的API调用
  console.log('取消提取任务:', extractionId);
  // 这里可以调用API取消任务，或者只是从UI中移除
  removeExtractionTask(extractionId);
}

// 暴露全局函数
window.removeExtractionTask = removeExtractionTask;
window.cancelExtraction = cancelExtraction;

