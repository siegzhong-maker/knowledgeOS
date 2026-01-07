# PDF路径修复指南

## 完整流程

### 步骤1：推送到GitHub并等待部署

代码已经提交到本地，现在需要：

1. **推送到GitHub**（如果还没有）：
   ```bash
   git push origin main
   ```

2. **等待Railway自动部署**：
   - Railway会自动检测到GitHub的更新
   - 在Railway Dashboard中查看部署状态
   - 等待部署完成（通常需要1-3分钟）

3. **验证部署成功**：
   - 访问：`https://knowledge-production-d36c.up.railway.app/api/health`
   - 应该返回：`{"success":true,"message":"服务运行正常"}`

### 步骤2：执行修复

部署完成后，可以通过以下方式修复PDF路径：

#### 方法A：使用curl命令（推荐）⭐

在终端运行：

```bash
curl -X POST https://knowledge-production-d36c.up.railway.app/api/diagnose/fix-pdf-paths
```

**预期响应：**
```json
{
  "success": true,
  "message": "修复完成：共修复 18 个路径，跳过 18 个",
  "data": {
    "total": 36,
    "fixed": 18,
    "skipped": 18,
    "fixedItems": [
      {
        "id": "d4855693-774d-4453-bd01-d741ed09e2e0",
        "title": "智能纪要：以客户为中心的业务提升会议 2025年12月29日",
        "oldPath": "/Users/silas/Desktop/knowledge/backend/uploads/1767284672759-xxx.pdf",
        "newPath": "1767284672759-xxx.pdf"
      },
      ...
    ]
  }
}
```

#### 方法B：使用浏览器工具（Postman/Thunder Client）

1. 打开Postman或VS Code的Thunder Client扩展
2. 创建新的POST请求
3. URL: `https://knowledge-production-d36c.up.railway.app/api/diagnose/fix-pdf-paths`
4. 方法: POST
5. 点击发送

#### 方法C：使用VS Code REST Client扩展

创建文件 `test-api.http`：

```http
POST https://knowledge-production-d36c.up.railway.app/api/diagnose/fix-pdf-paths
Content-Type: application/json
```

然后点击"Send Request"按钮。

#### 方法D：使用浏览器（需要安装扩展）

某些浏览器扩展（如REST Client）可以发送POST请求，但原生浏览器不支持直接发送POST请求。

### 步骤3：验证修复结果

修复完成后，再次检查PDF状态：

```bash
curl https://knowledge-production-d36c.up.railway.app/api/diagnose/pdfs
```

应该会看到：
- `missing` 数量减少或变为 0
- 之前缺失的文件现在显示为 `existing`

## 快速执行命令

如果你已经部署完成，可以直接复制粘贴以下命令：

```bash
# 1. 执行修复
curl -X POST https://knowledge-production-d36c.up.railway.app/api/diagnose/fix-pdf-paths

# 2. 验证结果
curl https://knowledge-production-d36c.up.railway.app/api/diagnose/pdfs
```

## 故障排查

### Q: 返回404错误？

**原因**：代码还没有部署，或者部署失败

**解决**：
1. 检查Railway Dashboard中的部署状态
2. 确认代码已推送到GitHub
3. 等待部署完成后再试

### Q: 返回500错误？

**原因**：可能是数据库连接问题或脚本执行错误

**解决**：
1. 查看Railway的日志（Deployments > Logs）
2. 检查数据库连接是否正常
3. 确认环境变量配置正确

### Q: 修复后文件仍然缺失？

**原因**：文件确实不存在于Volume中

**解决**：
1. 这些文件需要重新上传
2. 或者从备份中恢复文件到 `/data/uploads` 目录

## 注意事项

1. **备份数据**：虽然修复脚本只更新路径，不会删除数据，但建议在修复前备份数据库
2. **一次性操作**：修复脚本会处理所有绝对路径，运行一次即可
3. **幂等性**：可以安全地多次运行，已经修复的路径会被跳过

## 替代方案

如果API端点不可用，可以使用Railway CLI：

```bash
# 安装CLI（如果还没有）
npm i -g @railway/cli

# 登录并连接
railway login
railway link

# 运行修复脚本
railway run npm run fix-pdf-paths
```

