# 性能优化测试指南

## 测试方法

### 1. 使用 Chrome DevTools Performance 面板

#### 步骤：
1. 打开应用（本地或测试环境）
2. 按 `F12` 或 `Cmd+Option+I` (Mac) 打开开发者工具
3. 切换到 **Performance** 标签
4. 点击录制按钮（圆形图标）开始录制
5. 刷新页面（`Cmd+R` 或 `F5`）
6. 等待页面完全加载
7. 点击停止录制

#### 关键指标查看：
- **LCP (Largest Contentful Paint)**: 应该从 5.99 秒降低到 < 2.5 秒
- **FCP (First Contentful Paint)**: 首次内容绘制时间
- **TTI (Time to Interactive)**: 可交互时间
- **Total Blocking Time**: 总阻塞时间

### 2. 使用 Lighthouse 性能评分

#### 步骤：
1. 打开开发者工具
2. 切换到 **Lighthouse** 标签
3. 选择 **Performance** 类别
4. 选择设备类型（Desktop 或 Mobile）
5. 点击 **Analyze page load**

#### 查看结果：
- **Performance Score**: 应该 > 80 分（之前可能 < 50 分）
- **LCP**: 应该 < 2.5 秒
- **FCP**: 应该 < 1.8 秒
- **CLS**: 应该 < 0.1

### 3. 使用 Network 面板查看资源加载

#### 步骤：
1. 打开开发者工具
2. 切换到 **Network** 标签
3. 刷新页面
4. 查看资源加载情况

#### 检查点：
- ✅ PDF.js 和 D3.js 应该**不在**初始加载中（按需加载）
- ✅ 资源应该有 `preconnect` 和 `dns-prefetch` 提示
- ✅ 非关键资源（FontAwesome、字体）应该异步加载

### 4. 测试 API 性能

#### 使用 Network 面板：
1. 打开 **Network** 标签
2. 筛选 **XHR** 或 **Fetch** 请求
3. 查看以下 API 的响应时间：
   - `/api/items` - 文档列表
   - `/api/knowledge/items` - 知识列表（应该明显更快，因为修复了 N+1 查询）

#### 对比优化前后：
- **知识列表 API**: 之前可能有 N+1 查询问题，现在应该快很多
- **请求缓存**: 相同请求应该从缓存返回（查看响应时间）

### 5. 测试知识提取性能

#### 步骤：
1. 选择一个未提取的文档
2. 点击"提取"按钮
3. 观察提取进度和响应时间

#### 检查点：
- ✅ 进度更新应该更平滑（减少更新频率）
- ✅ 批量保存应该减少数据库操作时间
- ✅ 整体提取时间应该有所改善

## 性能对比测试

### 优化前 vs 优化后对比表

| 指标 | 优化前 | 优化后（目标） | 测试方法 |
|------|--------|----------------|----------|
| LCP | 5.99 秒 | < 2.5 秒 | Performance 面板 |
| 文档列表加载 | 慢 | 快 50%+ | Network 面板 |
| 知识列表加载 | 慢（N+1） | 快很多 | Network 面板 |
| 知识提取响应 | 慢 | 快 30%+ | 实际测试 |
| 资源加载 | 同步阻塞 | 异步/按需 | Network 面板 |

## 快速测试脚本

### 测试 API 响应时间

在浏览器控制台运行：

```javascript
// 测试知识列表 API 性能
async function testKnowledgeAPI() {
  const start = performance.now();
  const response = await fetch('/api/knowledge/items?limit=50');
  const data = await response.json();
  const end = performance.now();
  console.log(`知识列表 API 响应时间: ${(end - start).toFixed(2)}ms`);
  console.log(`返回数据量: ${data.data?.length || 0} 条`);
  return { time: end - start, count: data.data?.length || 0 };
}

// 测试文档列表 API 性能
async function testItemsAPI() {
  const start = performance.now();
  const response = await fetch('/api/items?limit=50');
  const data = await response.json();
  const end = performance.now();
  console.log(`文档列表 API 响应时间: ${(end - start).toFixed(2)}ms`);
  console.log(`返回数据量: ${data.data?.length || 0} 条`);
  return { time: end - start, count: data.data?.length || 0 };
}

// 运行测试
testKnowledgeAPI();
testItemsAPI();
```

### 测试资源加载

在浏览器控制台运行：

```javascript
// 检查 PDF.js 和 D3.js 是否按需加载
console.log('PDF.js 已加载:', typeof pdfjsLib !== 'undefined');
console.log('D3.js 已加载:', typeof d3 !== 'undefined');

// 检查资源预连接
const preconnects = Array.from(document.querySelectorAll('link[rel="preconnect"]'));
console.log('Preconnect 数量:', preconnects.length);
preconnects.forEach(link => console.log('  -', link.href));
```

## 本地测试环境

### 启动本地服务器

```bash
# 1. 启动后端
npm run dev

# 2. 在另一个终端，启动前端服务器（可选，如果直接打开 HTML 文件）
cd frontend
python -m http.server 8080
# 或
npx http-server -p 8080
```

### 测试建议

1. **清除缓存测试**：
   - 使用无痕模式（Incognito）
   - 或清除浏览器缓存后测试

2. **多次测试取平均值**：
   - 性能测试应该运行 3-5 次
   - 取平均值作为最终结果

3. **不同场景测试**：
   - 空数据库（首次加载）
   - 有数据的数据库（正常使用）
   - 大量数据（压力测试）

## 预期改进

### 前端优化
- ✅ 初始页面加载时间减少 40-60%
- ✅ LCP 从 5.99 秒降低到 < 2.5 秒
- ✅ 非关键资源不阻塞渲染

### 后端优化
- ✅ 知识列表查询速度提升 50-80%（修复 N+1 查询）
- ✅ 数据库查询使用索引，速度提升 30-50%
- ✅ API 响应时间减少

### 提取优化
- ✅ 知识提取进度更新更平滑
- ✅ 批量保存减少数据库操作
- ✅ 整体提取时间减少 20-30%

## 注意事项

1. **开发环境 vs 生产环境**：
   - 开发环境可能比生产环境慢
   - 建议在类似生产环境的环境中测试

2. **网络条件**：
   - 本地测试网络条件好，实际用户可能不同
   - 可以使用 Chrome DevTools 的 Network Throttling 模拟慢网络

3. **数据库大小**：
   - 数据量越大，优化效果越明显
   - 建议在有足够测试数据的情况下测试

## 问题排查

如果性能没有明显改善：

1. **检查浏览器缓存**：清除缓存后重新测试
2. **检查数据库索引**：确认索引已创建
3. **检查网络请求**：查看是否有失败的请求
4. **检查控制台错误**：查看是否有 JavaScript 错误
5. **检查数据库连接**：确认数据库连接正常

