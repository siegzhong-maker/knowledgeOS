# 性能报告查看指南

## 快速开始

性能监控系统已经集成到应用中，可以通过多种方式查看性能报告。

## 查看方式

### 1. 浏览器控制台（最简单）

打开浏览器开发者工具（F12），在控制台中运行：

```javascript
// 查看完整性能报告
window.performanceMonitor.showReport()

// 或者直接查看摘要
window.performanceMonitor.getSummary()
```

### 2. 性能监控面板（可视化）

#### 打开方式：
- **快捷键**：按 `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (Mac)
- **按钮**：在开发环境下，点击顶部工具栏的性能监控图标（⚡）

#### 面板功能：
- **实时摘要**：显示总记录数、平均耗时、严重程度统计
- **最慢操作**：显示耗时最长的 5 个操作
- **所有操作**：显示最近 20 条性能记录
- **自动刷新**：每 2 秒自动更新数据

#### 面板操作：
- **刷新**：手动刷新性能数据
- **导出**：导出为 JSON、CSV 或 HTML 格式
- **清除**：清除所有性能数据

### 3. 导出性能报告

#### 在性能面板中导出：
1. 打开性能监控面板
2. 点击导出按钮（下载图标）
3. 选择格式：1=JSON, 2=CSV, 3=HTML

#### 在控制台中导出：
```javascript
// 导出为 JSON
window.performanceMonitor.exportJSON()

// 导出为 CSV
window.performanceMonitor.exportCSV()

// 导出为 HTML
window.performanceMonitor.exportHTML()
```

### 4. 后端性能数据（API）

访问以下 API 端点获取后端性能数据：

```bash
# 获取性能摘要
GET /api/performance/summary

# 获取详细性能数据
GET /api/performance/data?limit=100

# 清除性能数据
POST /api/performance/clear
```

## 性能指标说明

### 严重程度分级

- **🔴 极慢 (Critical)**: ≥ 5000ms
- **🟠 严重 (Severe)**: ≥ 2000ms
- **🟡 警告 (Warning)**: ≥ 500ms
- **✅ 正常 (Normal)**: < 500ms

### 监控的操作

#### 前端操作：
- `page-init` - 页面初始化
- `bind-events` - 事件绑定
- `switch-view` - 视图切换
- `load-items-fast` - 快速加载数据
- `load-knowledge-items` - 加载知识库
- `render-cards` - 渲染卡片
- `render-knowledge-view` - 渲染知识库视图
- `api-GET` / `api-POST` - API 调用

#### 后端操作：
- 所有 API 请求的响应时间
- 数据库查询的执行时间

## 使用场景

### 开发环境
性能监控**自动启用**，无需额外配置。

### 生产环境
通过 URL 参数启用：
```
https://your-domain.com?perf=1
```

或设置环境变量：
```bash
ENABLE_PERF=1
```

## 性能优化建议

1. **查看最慢操作**：优先优化耗时最长的操作
2. **分析重复操作**：检查是否有重复的慢操作
3. **对比优化前后**：清除数据后重新测试，对比优化效果
4. **关注警告项**：优先处理警告和严重级别的操作

## 常见问题

### Q: 为什么看不到性能监控按钮？
A: 性能监控按钮只在开发环境显示。确保：
- 在 localhost 或 127.0.0.1 访问
- 或 URL 中包含 `?perf=1` 参数

### Q: 如何清除性能数据？
A: 
- 在控制台：`window.performanceMonitor.clear()`
- 在性能面板：点击清除按钮
- 后端 API：`POST /api/performance/clear`

### Q: 性能数据会保存多久？
A: 
- 前端：保存在浏览器本地存储，最多保留最近 1 小时的数据
- 后端：最多保存 1000 条 API 请求记录和 500 条数据库查询记录

### Q: 如何查看特定操作的性能？
A: 在控制台中筛选：
```javascript
const records = window.performanceMonitor.getRecords();
const filtered = records.filter(r => r.label.includes('load'));
console.table(filtered);
```

## 示例输出

### 控制台报告示例：
```
📊 性能监控报告
总记录数: 25
总耗时: 12345.67ms
平均耗时: 493.83ms

严重程度统计:
🔴 极慢 (≥5000ms): 0
🟠 严重 (≥2000ms): 1
🟡 警告 (≥500ms): 5
✅ 正常 (<500ms): 19

🐌 最慢的 10 个操作:
1. 🟠 load-knowledge-items: 2345.67ms
2. 🟡 render-knowledge-view: 678.90ms
3. 🟡 api-GET: 567.89ms
...
```

## 更多信息

查看代码文件了解详细实现：
- `frontend/js/performance-monitor.js` - 前端监控核心
- `frontend/js/performance-panel.js` - 可视化面板
- `backend/middleware/performance.js` - 后端监控中间件
- `backend/routes/performance.js` - 性能数据 API

