#!/usr/bin/env node
/**
 * 检查部署环境的知识提取配置
 * 这个脚本帮助诊断为什么在部署环境中提取不到知识点
 */

console.log('=== 部署环境知识提取诊断 ===\n');
console.log('这个脚本检查可能导致提取失败的原因：\n');

console.log('1. API Key 配置检查：');
console.log('   - 如果在前端设置中配置了个人 API Key，前端会自动传递给后端');
console.log('   - 如果使用全局 API Key，需要保存在数据库的 settings 表中');
console.log('   - 检查方法：在部署环境的前端打开浏览器控制台，查看提取请求的日志\n');

console.log('2. 前端是否正确传递 API Key：');
console.log('   - 打开浏览器开发者工具（F12）');
console.log('   - 切换到 Network 标签');
console.log('   - 触发知识提取');
console.log('   - 查看 POST /api/knowledge/extract 请求');
console.log('   - 检查请求体中的 userApiKey 字段是否存在\n');

console.log('3. 后端日志检查：');
console.log('   - 查看部署环境的日志输出');
console.log('   - 查找 [提取API] 和 [提取] 开头的日志');
console.log('   - 确认是否有错误信息\n');

console.log('4. 常见问题：');
console.log('   - API Key 格式错误（应以 sk- 开头）');
console.log('   - API Key 已过期或无效');
console.log('   - 网络连接问题（无法访问 api.deepseek.com）');
console.log('   - 文档内容为空或格式不正确');
console.log('   - AI 返回的 JSON 格式不正确\n');

console.log('5. 调试建议：');
console.log('   - 在部署环境的前端控制台查看提取请求的完整响应');
console.log('   - 检查后端日志中的详细错误信息');
console.log('   - 确认文档是否有内容（raw_content 不为空）');
console.log('   - 尝试提取一个简单的文档进行测试\n');

console.log('=== 诊断完成 ===\n');
console.log('如果问题仍然存在，请提供：');
console.log('1. 浏览器控制台中的错误信息');
console.log('2. 后端日志中的 [提取] 相关日志');
console.log('3. 提取请求的响应内容\n');

