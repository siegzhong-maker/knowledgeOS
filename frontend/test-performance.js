/**
 * 性能测试脚本
 * 在浏览器控制台运行此脚本来测试优化效果
 */

// 测试 API 响应时间
async function testAPIPerformance() {
  console.log('🚀 开始测试 API 性能...\n');
  
  // 测试知识列表 API（修复了 N+1 查询）
  console.log('📊 测试知识列表 API...');
  const knowledgeStart = performance.now();
  try {
    const knowledgeRes = await fetch('/api/knowledge/items?limit=50');
    const knowledgeData = await knowledgeRes.json();
    const knowledgeTime = performance.now() - knowledgeStart;
    console.log(`  ✅ 响应时间: ${knowledgeTime.toFixed(2)}ms`);
    console.log(`  📦 返回数据: ${knowledgeData.data?.length || 0} 条`);
    console.log(`  💾 数据大小: ${(JSON.stringify(knowledgeData).length / 1024).toFixed(2)} KB\n`);
  } catch (error) {
    console.error('  ❌ 测试失败:', error);
  }
  
  // 测试文档列表 API
  console.log('📄 测试文档列表 API...');
  const itemsStart = performance.now();
  try {
    const itemsRes = await fetch('/api/items?limit=50');
    const itemsData = await itemsRes.json();
    const itemsTime = performance.now() - itemsStart;
    console.log(`  ✅ 响应时间: ${itemsTime.toFixed(2)}ms`);
    console.log(`  📦 返回数据: ${itemsData.data?.length || 0} 条`);
    console.log(`  💾 数据大小: ${(JSON.stringify(itemsData).length / 1024).toFixed(2)} KB\n`);
  } catch (error) {
    console.error('  ❌ 测试失败:', error);
  }
}

// 测试资源加载情况
function testResourceLoading() {
  console.log('📦 检查资源加载情况...\n');
  
  // 检查 PDF.js 和 D3.js（应该按需加载）
  console.log('🔍 检查按需加载的库:');
  console.log(`  PDF.js: ${typeof pdfjsLib !== 'undefined' ? '✅ 已加载' : '⏳ 未加载（按需加载）'}`);
  console.log(`  D3.js: ${typeof d3 !== 'undefined' ? '✅ 已加载' : '⏳ 未加载（按需加载）'}\n`);
  
  // 检查预连接
  console.log('🔗 检查资源预连接:');
  const preconnects = Array.from(document.querySelectorAll('link[rel="preconnect"]'));
  const dnsPrefetches = Array.from(document.querySelectorAll('link[rel="dns-prefetch"]'));
  console.log(`  Preconnect: ${preconnects.length} 个`);
  preconnects.forEach(link => console.log(`    - ${link.href}`));
  console.log(`  DNS Prefetch: ${dnsPrefetches.length} 个`);
  dnsPrefetches.forEach(link => console.log(`    - ${link.href}\n`));
  
  // 检查异步加载的资源
  console.log('⚡ 检查异步加载的资源:');
  const asyncScripts = Array.from(document.querySelectorAll('script[async], script[defer]'));
  console.log(`  异步脚本: ${asyncScripts.length} 个`);
  asyncScripts.forEach(script => {
    console.log(`    - ${script.src || 'inline'} (${script.async ? 'async' : 'defer'})`);
  });
  console.log('');
}

// 测试页面加载性能
function testPageLoadPerformance() {
  console.log('⏱️  页面加载性能指标:\n');
  
  if (window.performance && window.performance.timing) {
    const timing = window.performance.timing;
    const navigation = window.performance.navigation;
    
    // 计算关键指标
    const domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart;
    const loadComplete = timing.loadEventEnd - timing.navigationStart;
    const firstPaint = timing.responseEnd - timing.navigationStart;
    
    console.log(`  DOM Content Loaded: ${domContentLoaded}ms`);
    console.log(`  Load Complete: ${loadComplete}ms`);
    console.log(`  First Paint: ${firstPaint}ms`);
    console.log(`  页面类型: ${navigation.type === 0 ? '正常导航' : navigation.type === 1 ? '重新加载' : '前进/后退'}\n`);
  }
  
  // 使用 Performance Observer（如果可用）
  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'largest-contentful-paint') {
            console.log(`  🎯 LCP (Largest Contentful Paint): ${entry.renderTime.toFixed(2)}ms`);
          } else if (entry.entryType === 'first-contentful-paint') {
            console.log(`  🎨 FCP (First Contentful Paint): ${entry.startTime.toFixed(2)}ms`);
          }
        }
      });
      observer.observe({ entryTypes: ['largest-contentful-paint', 'first-contentful-paint'] });
      console.log('  ✅ Performance Observer 已启动，等待指标...\n');
    } catch (e) {
      console.log('  ⚠️  Performance Observer 不可用\n');
    }
  }
}

// 测试 API 缓存
async function testAPICache() {
  console.log('💾 测试 API 缓存功能...\n');
  
  console.log('第一次请求（应该从服务器获取）:');
  const firstStart = performance.now();
  const firstRes = await fetch('/api/items/stats');
  const firstTime = performance.now() - firstStart;
  console.log(`  响应时间: ${firstTime.toFixed(2)}ms\n`);
  
  // 等待一小段时间
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('第二次请求（应该从缓存获取，更快）:');
  const secondStart = performance.now();
  const secondRes = await fetch('/api/items/stats');
  const secondTime = performance.now() - secondStart;
  console.log(`  响应时间: ${secondTime.toFixed(2)}ms`);
  
  if (secondTime < firstTime * 0.5) {
    console.log('  ✅ 缓存工作正常（第二次请求明显更快）\n');
  } else {
    console.log('  ⚠️  缓存可能未生效\n');
  }
}

// 主测试函数
async function runAllTests() {
  console.log('═══════════════════════════════════════');
  console.log('  性能优化测试套件');
  console.log('═══════════════════════════════════════\n');
  
  // 1. 资源加载测试
  testResourceLoading();
  
  // 2. 页面加载性能
  testPageLoadPerformance();
  
  // 3. API 性能测试
  await testAPIPerformance();
  
  // 4. API 缓存测试
  await testAPICache();
  
  console.log('═══════════════════════════════════════');
  console.log('  测试完成！');
  console.log('═══════════════════════════════════════');
  console.log('\n💡 提示:');
  console.log('  - 使用 Chrome DevTools Performance 面板查看详细性能数据');
  console.log('  - 使用 Lighthouse 获取性能评分');
  console.log('  - 查看 Network 面板检查资源加载情况');
}

// 导出测试函数（如果作为模块）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    testAPIPerformance,
    testResourceLoading,
    testPageLoadPerformance,
    testAPICache,
    runAllTests
  };
}

// 如果在浏览器中直接运行
if (typeof window !== 'undefined') {
  window.testPerformance = {
    testAPIPerformance,
    testResourceLoading,
    testPageLoadPerformance,
    testAPICache,
    runAllTests
  };
  
  console.log('✅ 性能测试脚本已加载！');
  console.log('运行 window.testPerformance.runAllTests() 开始测试');
}

