# 快速诊断步骤：API Key已配置但提取失败

## 问题描述
- ✅ API Key已配置并测试成功
- ✅ 智能问答可以正常工作（证明API Key有效）
- ❌ 知识提取时 `extractedCount: 0`，`knowledgeItemIds: []`

## 立即检查步骤

### 步骤1：查看前端控制台日志

1. 打开浏览器开发者工具（F12）
2. 切换到 "Console" 标签
3. 过滤日志：输入 `[提取]`
4. 点击"提取知识"按钮
5. 观察以下关键日志：

**关键日志检查点：**
- `[提取] 开始提取知识` - 应该显示 `hasUserApiKey: true`
- `[提取] 提取API响应` - 检查是否成功
- `[提取] 轮询状态响应` - 查看返回的数据
- `[提取] ⚠️ 提取完成但未生成知识点` - 如果有这个警告，会显示可能原因

### 步骤2：查看Railway日志

1. 登录 [Railway Dashboard](https://railway.app)
2. 进入你的项目
3. 点击Web服务名称
4. 点击 "Deployments" > 最新部署 > "Logs"
5. 使用搜索功能查找以下关键词：

**关键日志搜索：**
- `[提取API]` - 查看是否接收到提取请求和userApiKey
- `[提取]` - 查看提取过程的详细日志
- `[AI]` - 查看AI调用是否成功
- `[保存]` - 查看数据库保存是否成功

**重点关注：**
- `[提取API] 接收提取请求` - 应该显示 `hasUserApiKey: true`
- `[AI] 准备调用DeepSeek API` - 应该显示 `hasApiKey: true`
- `[AI] ✅ DeepSeek API调用成功` 或 `[AI] ❌ DeepSeek API调用失败`
- `[提取] ✅ 提取完成` 或 `[提取] ⚠️ 未提取到任何知识点`
- `[保存] ✅ 数据库插入成功` 或 `[保存] ❌ 数据库插入失败`

### 步骤3：检查诊断端点

访问：
```
https://knowledge-production-d36c.up.railway.app/api/diagnose/extraction
```

确认：
- `apiKey.configured: true`
- `apiKey.valid: true`
- `database.connected: true`
- `database.tablesExist: true`

## 常见问题排查

### 问题1：前端未传递userApiKey

**检查：**
- 前端控制台：`[提取] 开始提取知识` 中 `hasUserApiKey` 应该是 `true`
- Railway日志：`[提取API] 接收提取请求` 中 `hasUserApiKey` 应该是 `true`

**如果为false：**
- 确认API Key已在前端设置中配置并保存
- 刷新页面后重试
- 检查浏览器控制台是否有错误

### 问题2：AI调用失败

**检查Railway日志：**
- 查找 `[AI] ❌ DeepSeek API调用失败`
- 查看错误详情

**可能原因：**
- 网络连接问题（Railway无法访问api.deepseek.com）
- API Key无效（但测试连接成功，不太可能）
- 请求超时（60秒超时）
- API配额已用完

### 问题3：AI返回空数据

**检查Railway日志：**
- 查找 `[提取] ⚠️ 未提取到任何知识点`
- 查看 `[提取] ✅ 提取完成` 中的 `extractedCount`

**可能原因：**
- AI未返回知识点数据
- JSON解析失败
- 数据验证失败（title或content为空）

### 问题4：数据库保存失败

**检查Railway日志：**
- 查找 `[保存] ❌ 数据库插入失败`
- 查看错误详情

**可能原因：**
- 数据库表不存在
- 数据类型错误
- 约束冲突

## 快速测试

### 测试1：提取简单文档

1. 创建一个简单的文本文档（100-200字）
2. 包含明确的知识点（如"什么是XXX"、"XXX的步骤是..."）
3. 尝试提取
4. 查看是否成功

### 测试2：查看完整日志链

在Railway日志中，应该看到完整的日志链：

```
[提取API] 接收提取请求
[提取] extractKnowledgeFromContent 开始
[提取] 准备调用AI API
[AI] 准备调用DeepSeek API
[AI] ✅ DeepSeek API调用成功
[提取] ✅ JSON解析成功
[提取] ✅ 提取完成 (extractedCount: X)
[保存] 开始保存知识点
[保存] ✅ 数据库插入成功
[提取] ✅ 知识点保存成功
```

**如果日志链中断：**
- 找到最后一个成功的日志
- 查看下一个日志，那就是失败的地方
- 根据错误信息查找原因

## 需要的信息

如果问题仍然存在，请收集以下信息：

1. **前端控制台日志**（过滤 `[提取]`）
   - 特别是 `[提取] ⚠️ 提取完成但未生成知识点` 的详细信息

2. **Railway日志**（搜索 `[提取]`、`[AI]`、`[保存]`）
   - 完整的提取流程日志
   - 任何错误信息

3. **诊断端点结果**
   - `https://knowledge-production-d36c.up.railway.app/api/diagnose/extraction`

4. **测试文档内容**
   - 你尝试提取的文档类型和长度
   - 是否包含明确的知识点

## 下一步

根据收集到的信息：
- 如果AI调用失败 → 检查网络连接和API配置
- 如果AI返回空数据 → 检查文档内容是否适合提取
- 如果保存失败 → 检查数据库配置和表结构

