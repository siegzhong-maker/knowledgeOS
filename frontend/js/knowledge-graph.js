// 知识图谱组件（星空风格力导向图）
import { knowledgeAPI } from './api.js';
import { openKnowledgeDetail } from './knowledge-detail.js';
import { loadD3 } from './utils.js';

let svg = null;
let simulation = null;
let nodes = [];
let links = [];
let cores = []; // 核心节点
let width = 0;
let height = 0;
let g = null;

// 分类配置
const CATEGORY_CONFIG = {
  work: {
    name: '工作核心',
    color: '#3b82f6',
    lightColor: '#60a5fa',
    position: { x: 0.25, y: 0.25 } // 左上
  },
  learning: {
    name: '学习核心',
    color: '#f59e0b',
    lightColor: '#fbbf24',
    position: { x: 0.75, y: 0.25 } // 右上
  },
  leisure: {
    name: '娱乐核心',
    color: '#ef4444',
    lightColor: '#f472b6',
    position: { x: 0.25, y: 0.75 } // 左下
  },
  life: {
    name: '生活核心',
    color: '#10b981',
    lightColor: '#34d399',
    position: { x: 0.75, y: 0.75 } // 右下
  },
  other: {
    name: '其他',
    color: '#64748b',
    lightColor: '#94a3b8',
    position: { x: 0.5, y: 0.5 } // 中心
  }
};

/**
 * 初始化知识图谱
 * @param {string} containerId - 容器ID
 */
export async function initKnowledgeGraph(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('知识图谱容器不存在:', containerId);
    return;
  }

  // 显示加载状态
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center h-full text-slate-400">
      <i data-lucide="loader-2" class="animate-spin mb-3" size="32"></i>
      <p>正在加载知识图谱...</p>
    </div>
  `;
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 动态加载 D3.js
  let d3;
  try {
    d3 = await loadD3();
  } catch (error) {
    console.error('D3.js 加载失败:', error);
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-red-400">
        <i data-lucide="alert-circle" size="32" class="mb-3"></i>
        <p>D3.js 加载失败: ${error.message}</p>
      </div>
    `;
    if (window.lucide) {
      window.lucide.createIcons();
    }
    return;
  }

  // 获取容器尺寸
  width = container.clientWidth || 800;
  height = container.clientHeight || 600;

  // 清空容器
  container.innerHTML = '';

  // 创建SVG - 深色星空背景
  svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', '#000000')
    .style('cursor', 'grab');

  // 添加背景星星粒子效果
  addStarParticles(svg, width, height);

  // 添加缩放和平移
  const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  // 创建主组
  g = svg.append('g');

  // 加载数据
  try {
    const response = await knowledgeAPI.getGraphData({ useCache: 'true', maxEdges: 50 });
    if (response.success && response.data) {
      nodes = response.data.nodes || [];
      links = response.data.edges || [];
      const categories = response.data.categories || {};
      
      console.log(`加载知识图谱: ${nodes.length} 个节点, ${links.length} 条边`);
      console.log('分类统计:', categories);
      
      renderGraph(g, nodes, links, categories);
    } else {
      showEmptyState(container);
    }
  } catch (error) {
    console.error('加载知识图谱数据失败:', error);
    showEmptyState(container);
  }
}

/**
 * 添加背景星星粒子
 */
function addStarParticles(svg, width, height) {
  const stars = svg.append('g').attr('class', 'star-particles');
  const starCount = Math.floor((width * height) / 15000); // 根据画布大小调整星星数量
  
  for (let i = 0; i < starCount; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = Math.random() * 1.5 + 0.5;
    const opacity = Math.random() * 0.5 + 0.3;
    
    stars.append('circle')
      .attr('cx', x)
      .attr('cy', y)
      .attr('r', size)
      .attr('fill', '#ffffff')
      .attr('opacity', opacity);
  }
}

/**
 * 渲染图谱
 */
function renderGraph(g, nodesData, linksData, categories) {
  // 清除旧内容
  g.selectAll('*').remove();

  // 创建核心节点
  cores = Object.keys(CATEGORY_CONFIG).map(category => {
    const config = CATEGORY_CONFIG[category];
    return {
      id: `core-${category}`,
      title: config.name,
      category: category,
      isCore: true,
      x: config.position.x * width,
      y: config.position.y * height,
      fx: config.position.x * width,
      fy: config.position.y * height
    };
  });

  // 合并核心节点和知识点节点
  const allNodes = [...cores, ...nodesData];

  // 将边的 ID 转换为节点对象引用
  const linkData = linksData.map(link => {
    const sourceNode = allNodes.find(n => n.id === link.source);
    const targetNode = allNodes.find(n => n.id === link.target);
    if (sourceNode && targetNode) {
      return {
        source: sourceNode,
        target: targetNode,
        similarity: link.similarity
      };
    }
    return null;
  }).filter(link => link !== null);

  console.log(`有效连接: ${linkData.length} 条`);

  // 创建SVG定义（渐变、滤镜等）
  const defs = g.append('defs');

  // 为每个分类创建节点渐变
  Object.keys(CATEGORY_CONFIG).forEach(category => {
    const config = CATEGORY_CONFIG[category];
    const gradient = defs.append('radialGradient')
      .attr('id', `nodeGradient-${category}`)
      .attr('cx', '50%')
      .attr('cy', '50%')
      .attr('r', '50%');
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#ffffff')
      .attr('stop-opacity', 1);
    gradient.append('stop')
      .attr('offset', '70%')
      .attr('stop-color', config.lightColor)
      .attr('stop-opacity', 0.8);
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', config.color)
      .attr('stop-opacity', 0.4);
  });

  // 创建发光滤镜
  Object.keys(CATEGORY_CONFIG).forEach(category => {
    const config = CATEGORY_CONFIG[category];
    const glowFilter = defs.append('filter')
      .attr('id', `glow-${category}`)
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    
    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', category === 'other' ? 2 : 4)
      .attr('result', 'coloredBlur');
    
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');
  });

  // 创建连接线渐变
  const linkGradient = defs.append('linearGradient')
    .attr('id', 'linkGradient')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '0%');
  linkGradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#60a5fa')
    .attr('stop-opacity', 0.6);
  linkGradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', '#3b82f6')
    .attr('stop-opacity', 0.3);

  // 创建连接线（星轨效果）
  const link = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(linkData)
    .enter()
    .append('line')
    .attr('stroke', d => {
      const similarity = d.similarity;
      if (similarity >= 80) return '#60a5fa';
      if (similarity >= 70) return '#93c5fd';
      return '#cbd5e1';
    })
    .attr('stroke-width', d => Math.max(1, Math.min(3, d.similarity / 30)))
    .attr('stroke-opacity', d => Math.max(0.2, d.similarity / 120))
    .style('filter', 'url(#glow-work)')
    .style('cursor', 'pointer');

  // 创建节点组
  const node = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(allNodes)
    .enter()
    .append('g')
    .attr('class', d => `node ${d.isCore ? 'core-node' : 'knowledge-node'}`)
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));

  // 节点半径计算
  const nodeRadius = d => {
    if (d.isCore) return 35; // 核心节点较大
    return Math.max(6, Math.min(18, 6 + (d.confidence / 100) * 12));
  };

  // 绘制节点圆圈
  node.append('circle')
    .attr('r', nodeRadius)
    .attr('fill', d => {
      if (d.isCore) {
        return 'url(#nodeGradient-' + d.category + ')';
      }
      const category = d.category || 'other';
      return CATEGORY_CONFIG[category]?.color || CATEGORY_CONFIG.other.color;
    })
    .attr('stroke', d => {
      if (d.isCore) return '#ffffff';
      const category = d.category || 'other';
      return CATEGORY_CONFIG[category]?.lightColor || CATEGORY_CONFIG.other.lightColor;
    })
    .attr('stroke-width', d => d.isCore ? 2 : 1)
    .attr('filter', d => {
      const category = d.category || 'other';
      return `url(#glow-${category})`;
    })
    .style('cursor', 'pointer')
    .style('opacity', 0.9);

  // 核心节点标签
  const coreLabels = node.filter(d => d.isCore)
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', 50)
    .attr('fill', d => {
      const category = d.category || 'other';
      return CATEGORY_CONFIG[category]?.lightColor || '#94a3b8';
    })
    .attr('font-size', '12px')
    .attr('font-weight', '500')
    .style('pointer-events', 'none')
    .text(d => d.title);

  // 知识点节点标签（悬停时显示）
  const knowledgeLabels = node.filter(d => !d.isCore)
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', d => nodeRadius(d) + 15)
    .attr('fill', '#94a3b8')
    .attr('font-size', '10px')
    .attr('opacity', 0)
    .style('pointer-events', 'none')
    .text(d => d.title.length > 15 ? d.title.substring(0, 15) + '...' : d.title);

  // 节点悬停提示
  node.append('title')
    .text(d => d.isCore 
      ? d.title 
      : `${d.title}\n置信度: ${d.confidence}%\n标签: ${d.tags?.join(', ') || '无'}`);

  // 节点点击事件
  node.on('click', (event, d) => {
    if (!d.isCore) {
      openKnowledgeDetail(d.id);
    }
  });

  // 节点悬停效果
  node.on('mouseover', function(event, d) {
    const nodeGroup = d3.select(this);
    nodeGroup.select('circle')
      .attr('r', nodeRadius(d) + (d.isCore ? 3 : 2))
      .attr('opacity', 1)
      .style('filter', d => {
        const category = d.category || 'other';
        return `url(#glow-${category}) brightness(1.3)`;
      });

    // 显示标签
    if (!d.isCore) {
      nodeGroup.select('text').attr('opacity', 1);
    }

    // 高亮相关连接
    link.attr('stroke-opacity', l => 
      (l.source === d || l.target === d) ? 0.8 : 0.1
    );
  });

  node.on('mouseout', function(event, d) {
    const nodeGroup = d3.select(this);
    nodeGroup.select('circle')
      .attr('r', nodeRadius)
      .attr('opacity', 0.9)
      .style('filter', d => {
        const category = d.category || 'other';
        return `url(#glow-${category})`;
      });

    // 隐藏标签
    if (!d.isCore) {
      nodeGroup.select('text').attr('opacity', 0);
    }

    // 恢复连接线
    link.attr('stroke-opacity', l => Math.max(0.2, l.similarity / 120));
  });

  // 创建力导向图模拟 - 优化参数，快速收敛
  simulation = d3.forceSimulation(allNodes)
    .force('link', d3.forceLink(linkData)
      .id(d => d.id)
      .distance(d => {
        if (d.source.isCore || d.target.isCore) {
          // 核心节点与知识点的距离
          return 150;
        }
        // 知识点之间的距离（根据相似度）
        return 200 - (d.similarity / 100) * 100;
      }))
    .force('charge', d3.forceManyBody()
      .strength(d => {
        if (d.isCore) return 0; // 核心节点不受电荷力影响
        return -300; // 知识点之间的排斥力
      }))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide()
      .radius(d => nodeRadius(d) + 10))
    .force('category', categoryForce()) // 分类聚类力
    .alpha(0.5) // 初始能量
    .alphaDecay(0.1) // 快速衰减
    .alphaMin(0.01); // 最小能量阈值

  // 分类聚类力：同分类节点向核心聚集
  function categoryForce() {
    return function(alpha) {
      allNodes.forEach(node => {
        if (node.isCore) return;
        
        const category = node.category || 'other';
        const core = cores.find(c => c.category === category);
        if (!core) return;

        const dx = core.x - node.x;
        const dy = core.y - node.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
          const strength = alpha * 0.3; // 吸引力强度
          node.vx += (dx / distance) * strength;
          node.vy += (dy / distance) * strength;
        }
      });
    };
  }

  // 更新位置
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // 添加闪烁动画（仅对知识点节点）
  node.filter(d => !d.isCore)
    .select('circle')
    .transition()
    .duration(2000 + Math.random() * 2000)
    .ease(d3.easeSinInOut)
    .attr('opacity', 0.7)
    .transition()
    .duration(2000 + Math.random() * 2000)
    .ease(d3.easeSinInOut)
    .attr('opacity', 0.9)
    .on('end', function repeat() {
      d3.select(this)
        .transition()
        .duration(2000 + Math.random() * 2000)
        .ease(d3.easeSinInOut)
        .attr('opacity', 0.7)
        .transition()
        .duration(2000 + Math.random() * 2000)
        .ease(d3.easeSinInOut)
        .attr('opacity', 0.9)
        .on('end', repeat);
    });
}

/**
 * 拖拽开始
 */
function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  if (!d.isCore) {
    d.fx = d.x;
    d.fy = d.y;
  }
}

/**
 * 拖拽中
 */
function dragged(event, d) {
  if (!d.isCore) {
    d.fx = event.x;
    d.fy = event.y;
  }
}

/**
 * 拖拽结束
 */
function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  if (!d.isCore) {
    d.fx = null;
    d.fy = null;
  }
}

/**
 * 显示空状态
 */
function showEmptyState(container) {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center h-full text-slate-400">
      <div class="bg-slate-900 p-4 rounded-full mb-3">
        <i data-lucide="network" size="32"></i>
      </div>
      <p>暂无知识图谱数据</p>
    </div>
  `;
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

/**
 * 重置视图
 */
export function resetGraphView() {
  if (simulation) {
    simulation.alpha(1).restart();
  }
}

/**
 * 销毁图谱
 */
export function destroyGraph() {
  if (simulation) {
    simulation.stop();
    simulation = null;
  }
  if (svg) {
    svg.remove();
    svg = null;
  }
  nodes = [];
  links = [];
  cores = [];
}
