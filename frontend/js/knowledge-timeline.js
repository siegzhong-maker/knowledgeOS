// 时间线视图组件
import { formatTime } from './utils.js';

/**
 * 按时间分组知识卡片
 * @param {Array} items - 知识项数组
 * @returns {Object} 分组后的对象
 */
export function groupItemsByTime(items) {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;
  const oneMonth = 30 * oneDay;

  const groups = {
    today: [],
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    older: []
  };

  items.forEach(item => {
    const itemTime = item.created_at || item.updated_at;
    const diff = now - itemTime;

    if (diff < oneDay) {
      groups.today.push(item);
    } else if (diff < 2 * oneDay) {
      groups.yesterday.push(item);
    } else if (diff < oneWeek) {
      groups.thisWeek.push(item);
    } else if (diff < oneMonth) {
      groups.thisMonth.push(item);
    } else {
      groups.older.push(item);
    }
  });

  return groups;
}

/**
 * 获取时间组标签
 * @param {string} groupKey - 组键
 * @returns {string} 标签文本
 */
export function getTimeGroupLabel(groupKey) {
  const labels = {
    today: '今天',
    yesterday: '昨天',
    thisWeek: '本周',
    thisMonth: '本月',
    older: '更早'
  };
  return labels[groupKey] || groupKey;
}

/**
 * 渲染时间线视图
 * @param {Array} items - 知识项数组
 * @param {Function} createCardFn - 创建卡片HTML的函数
 * @returns {string} HTML字符串
 */
export function renderTimelineView(items, createCardFn) {
  if (!items || items.length === 0) {
    return '<div class="text-center py-16 text-slate-400">暂无知识</div>';
  }

  const groups = groupItemsByTime(items);
  const groupOrder = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'];

  let html = '<div class="timeline-container">';

  groupOrder.forEach((groupKey, index) => {
    const groupItems = groups[groupKey];
    if (groupItems.length === 0) return;

    const label = getTimeGroupLabel(groupKey);
    const isLast = index === groupOrder.length - 1 || 
                   groupOrder.slice(index + 1).every(key => groups[key].length === 0);

    html += `
      <div class="timeline-group mb-8" data-group="${groupKey}">
        <div class="flex items-start">
          <!-- 时间轴 -->
          <div class="timeline-axis flex-shrink-0 mr-6 relative">
            <div class="flex flex-col items-center">
              <div class="w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-md z-10"></div>
              ${!isLast ? '<div class="w-0.5 h-full bg-slate-200 mt-2 min-h-[40px]"></div>' : ''}
            </div>
          </div>
          
          <!-- 内容区域 -->
          <div class="flex-1 min-w-0">
            <div class="mb-4">
              <h3 class="text-sm font-bold text-slate-700 mb-1">${label}</h3>
              <span class="text-xs text-slate-400">${groupItems.length} 条</span>
            </div>
            <div class="space-y-4">
              ${groupItems.map((item, idx) => `
                <div data-item-id="${item.id}" class="cursor-pointer">
                  ${createCardFn(item)}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

