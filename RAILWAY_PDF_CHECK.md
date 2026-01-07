# Railway上检查PDF文件状态

## 方法1：通过浏览器访问（最简单）⭐

直接在浏览器中访问以下URL：

```
https://your-app.up.railway.app/api/diagnose/pdfs
```

**将 `your-app` 替换为你的Railway应用名称**

例如，如果你的应用URL是 `https://knowledge-production-d36c.up.railway.app`，那么访问：

```
https://knowledge-production-d36c.up.railway.app/api/diagnose/pdfs
```

### 返回结果示例

```json
{
  "success": true,
  "message": "检查完成：共 10 个PDF，8 个存在，2 个缺失",
  "data": {
    "total": 10,
    "existing": 8,
    "missing": 2,
    "missingFiles": [
      {
        "id": "45b8329a-8828-4e74-9165-f7a8dc5c2703",
        "title": "智能纪要:客户选择、画像与痛点挖掘会议2025年12月29日",
        "file_path": "1735123456789-abc123.pdf",
        "reason": "文件不存在",
        "attemptedPaths": [
          "/data/uploads/1735123456789-abc123.pdf"
        ],
        "created_at": 1735123456789
      }
    ],
    "existingFiles": [...]
  }
}
```

### 美化显示JSON结果

如果浏览器显示的是原始JSON，你可以：

1. **使用浏览器扩展**：安装JSON Viewer扩展
2. **使用在线工具**：复制JSON到 https://jsonformatter.org
3. **使用命令行工具**（如果有）：
   ```bash
   curl https://your-app.up.railway.app/api/diagnose/pdfs | jq
   ```

## 方法2：使用Railway CLI

如果你安装了Railway CLI，可以在命令行中运行：

```bash
# 1. 安装Railway CLI（如果还没有）
npm i -g @railway/cli

# 2. 登录Railway
railway login

# 3. 在项目目录中连接到Railway项目
railway link

# 4. 运行诊断脚本
railway run npm run check-pdfs
```

这会输出格式化的命令行结果，更容易阅读。

## 方法3：查看Railway日志

如果PDF加载失败，Railway的日志中会显示详细错误信息：

1. 登录 [Railway Dashboard](https://railway.app)
2. 进入你的项目
3. 点击服务名称
4. 点击 "Deployments"
5. 选择最新的部署
6. 查看 "Logs" 标签页

查找包含以下关键词的日志：
- `PDF文件未找到`
- `尝试的路径`
- `MissingPDF`

## 常见问题

### Q: 访问 `/api/diagnose/pdfs` 返回404？

A: 确保：
1. 代码已部署到Railway（检查最新部署）
2. URL中的应用名称正确
3. 服务正在运行

### Q: 如何找到我的Railway应用URL？

A: 
1. 登录Railway Dashboard
2. 进入你的项目
3. 点击服务名称
4. 在 "Settings" > "Domains" 中查看

### Q: 检查结果显示文件缺失，怎么办？

A: 参考 `PDF_TROUBLESHOOTING.md` 中的解决方案：
1. 检查Volume是否正确挂载
2. 检查文件是否在其他位置
3. 重新上传缺失的文件
4. 更新数据库中的文件路径

## 相关文档

- `PDF_TROUBLESHOOTING.md` - 详细的PDF问题排查指南
- `RAILWAY_DEPLOY.md` - Railway部署指南

