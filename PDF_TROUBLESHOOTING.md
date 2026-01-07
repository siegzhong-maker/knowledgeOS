# PDF文件加载问题排查指南

## 问题描述

某些PDF文件可以正常查看，但有些PDF文件无法加载，显示"Missing PDF"错误。

## 可能的原因

1. **文件实际不存在**：数据库中有记录，但文件已被删除或从未成功上传
2. **文件路径不匹配**：数据库中的路径与实际文件位置不一致
3. **Volume挂载问题**：生产环境中Volume未正确挂载
4. **环境变量配置错误**：`UPLOADS_PATH` 或 `NODE_ENV` 配置不正确

## 诊断工具

### 方法1：通过浏览器访问（推荐，适合Railway部署）

在浏览器中访问以下URL：

```
https://knowledge-production-d36c.up.railway.app/api/diagnose/pdfs
```

这会返回JSON格式的检查结果，包括：
- 总PDF数量
- 存在的文件数量
- 缺失的文件列表
- 每个缺失文件的详细信息

**示例响应：**
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
        "title": "文档标题",
        "file_path": "1735123456789-abc123.pdf",
        "reason": "文件不存在",
        "attemptedPaths": ["/data/uploads/..."]
      }
    ]
  }
}
```

### 方法2：使用Railway CLI（需要安装CLI工具）

如果你安装了Railway CLI，可以连接到容器运行命令：

```bash
# 1. 安装Railway CLI（如果还没有）
npm i -g @railway/cli

# 2. 登录Railway
railway login

# 3. 连接到你的项目
railway link

# 4. 运行诊断脚本
railway run npm run check-pdfs
```

### 方法3：本地运行（如果有数据库访问权限）

如果你有数据库访问权限，可以在本地运行：

```bash
npm run check-pdfs
```

**注意**：需要设置正确的环境变量（`DATABASE_URL`等）

### 脚本功能

这些工具会：
- 扫描数据库中的所有PDF记录
- 检查每个文件是否实际存在
- 列出所有缺失的文件及其详细信息
- 提供修复建议

### 输出示例

```
开始检查缺失的PDF文件...

上传目录: /data/uploads
环境: production
---

找到 10 个PDF记录

============================================================
检查结果汇总
============================================================
✓ 文件存在: 8 个
✗ 文件缺失: 2 个

缺失的文件列表:
------------------------------------------------------------

1. 智能纪要:客户选择、画像与痛点挖掘会议2025年12月29日
   ID: 45b8329a-8828-4e74-9165-f7a8dc5c2703
   数据库路径: 1735123456789-abc123.pdf
   原因: 文件不存在
   尝试的路径:
     - /data/uploads/1735123456789-abc123.pdf
     - /data/uploads/1735123456789-abc123.pdf
   创建时间: 2025/1/3 10:30:00
```

## 解决方案

### 1. 文件已丢失

如果文件确实已丢失，可以：

**选项A：重新上传文件**
- 删除数据库中的无效记录
- 重新上传PDF文件

**选项B：从备份恢复**
- 从备份中恢复文件到正确的位置
- 确保文件路径与数据库记录一致

### 2. 文件路径不匹配

如果文件存在但路径不匹配：

1. 检查文件实际位置
2. 更新数据库中的 `file_path` 字段
3. 或移动文件到数据库记录的位置

### 3. Volume挂载问题（生产环境）

在Railway等平台部署时：

1. 确认Volume已正确挂载到 `/data/uploads`
2. 检查环境变量 `UPLOADS_PATH` 是否正确设置
3. 确认 `NODE_ENV=production` 已设置

### 4. 环境变量配置

检查以下环境变量：

```bash
# 生产环境
NODE_ENV=production
UPLOADS_PATH=/data/uploads  # 可选，默认使用 /data/uploads

# 开发环境
NODE_ENV=development
# UPLOADS_PATH 未设置时，使用 backend/uploads
```

## 前端错误提示改进

现在当PDF加载失败时，前端会显示：

1. **更友好的错误标题和图标**
2. **详细的错误信息**（可展开查看）
3. **尝试的路径列表**（帮助诊断）
4. **修复建议**

## 后端错误响应改进

后端现在会返回更详细的错误信息：

```json
{
  "success": false,
  "error": "MissingPDF",
  "message": "PDF文件未找到",
  "details": {
    "itemId": "45b8329a-8828-4e74-9165-f7a8dc5c2703",
    "itemTitle": "文档标题",
    "file_path": "数据库中的路径",
    "attemptedPaths": [
      {"path": "/data/uploads/file.pdf", "reason": "相对路径"}
    ],
    "suggestion": "修复建议..."
  }
}
```

## 预防措施

1. **定期检查**：定期运行 `npm run check-pdfs` 检查文件状态
2. **备份策略**：确保重要文件有备份
3. **监控**：监控文件上传是否成功
4. **日志**：查看服务器日志了解文件访问情况

## Railway部署使用说明

### 快速检查PDF文件状态

**最简单的方法：直接在浏览器中访问**

```
https://your-app.up.railway.app/api/diagnose/pdfs
```

将 `your-app` 替换为你的Railway应用名称。

这会返回JSON格式的检查结果，你可以：
1. 直接在浏览器中查看
2. 使用JSON格式化工具美化显示
3. 复制结果进行分析

### 使用Railway CLI（可选）

如果你需要更详细的命令行输出：

```bash
# 1. 安装Railway CLI
npm i -g @railway/cli

# 2. 登录
railway login

# 3. 连接到项目（在项目目录中运行）
railway link

# 4. 运行诊断
railway run npm run check-pdfs
```

### 查看实时日志

在Railway Dashboard中：
1. 进入你的服务页面
2. 点击 "Deployments"
3. 选择最新的部署
4. 查看 "Logs" 标签页

如果PDF加载失败，日志中会显示详细的错误信息，包括尝试的所有路径。

## 相关文件

- `backend/routes/files.js` - PDF文件服务路由
- `backend/routes/upload.js` - PDF上传路由
- `backend/server.js` - 添加了 `/api/diagnose/pdfs` 端点
- `backend/scripts/check-missing-pdfs.js` - 诊断脚本
- `frontend/js/pdf-viewer.js` - PDF查看器
- `frontend/js/pdf.js` - PDF内容渲染

