# Volume 诊断工具使用指南

## 概述

已创建了一个诊断端点，用于检查 Railway Volume 配置和文件系统状态。

## 使用方法

### 1. 访问诊断端点

部署应用后，在浏览器中访问：

```
https://your-app.up.railway.app/api/diagnose/files
```

或者使用 curl：

```bash
curl https://your-app.up.railway.app/api/diagnose/files
```

### 2. 查看诊断结果

诊断端点会返回详细的诊断信息，包括：

- **环境变量**：NODE_ENV、UPLOADS_PATH、PORT、DATABASE_URL 的状态
- **上传目录**：
  - 路径
  - 是否存在
  - 是否可访问
  - 是否可写
  - 文件数量
  - 文件列表（前20个）
- **数据库**：
  - 连接状态
  - PDF 文件记录数量
  - PDF 文件列表（最近10个）
  - 文件是否存在检查
- **建议**：基于诊断结果提供的配置建议

### 3. 诊断结果解读

#### ✅ 正常状态

如果 Volume 配置正确，你会看到：

```json
{
  "success": true,
  "data": {
    "environment": {
      "NODE_ENV": "production",
      "UPLOADS_PATH": "未设置",
      ...
    },
    "uploadsDirectory": {
      "path": "/data/uploads",
      "exists": true,
      "accessible": true,
      "writable": true,
      "fileCount": 5,
      ...
    },
    "database": {
      "connected": true,
      "pdfCount": 3,
      ...
    },
    "recommendations": []
  }
}
```

#### ⚠️ Volume 未配置

如果 Volume 未配置，你会看到：

```json
{
  "uploadsDirectory": {
    "exists": false,
    "error": "目录不存在或不可访问: ...",
    ...
  },
  "recommendations": [
    "🚨 重要：生产环境中需要配置 Railway Volume",
    "   1. 在Railway服务页面点击\"Settings\"",
    "   2. 找到\"Volumes\"部分",
    "   3. 点击\"+ New Volume\"",
    "   4. Mount Path: /data/uploads",
    "   5. 保存并重新部署"
  ]
}
```

#### ⚠️ 文件丢失

如果数据库中有 PDF 记录，但文件不存在：

```json
{
  "database": {
    "pdfCount": 3,
    "pdfFiles": [...]
  },
  "recommendations": [
    "⚠️ 发现 X 个PDF文件记录，但物理文件不存在。可能原因：Volume未配置、文件已删除或路径不匹配"
  ]
}
```

## 配置步骤

根据诊断结果的建议，按照以下步骤配置 Volume：

### 步骤 1：进入服务页面

1. 登录 [Railway](https://railway.app)
2. 打开你的项目
3. **点击你的 Web 服务名称**（不是项目名称）

### 步骤 2：配置 Volume

1. 在服务页面顶部，点击 **"Settings"** 标签
2. 向下滚动找到 **"Volumes"** 部分
3. 点击 **"+ New Volume"** 按钮
4. 配置：
   - **Mount Path**: `/data/uploads`
   - **Name**: `uploads`（可选）
5. 点击 **"Add"** 保存

### 步骤 3：重新部署

1. Volume 配置后，Railway 可能会自动重新部署
2. 如果没有自动部署，可以手动触发一次部署
3. 查看部署日志，确认看到：
   ```
   ✓ 上传目录已准备: /data/uploads
   ✓ Volume挂载检查: /data/uploads 可访问
   ```

### 步骤 4：验证配置

1. 再次访问诊断端点：`/api/diagnose/files`
2. 确认 `uploadsDirectory.exists` 为 `true`
3. 确认 `uploadsDirectory.accessible` 为 `true`
4. 确认 `uploadsDirectory.writable` 为 `true`

## 常见问题

### Q: 诊断端点返回 404

**A**: 检查：
1. 代码是否已部署
2. 路径是否正确：`/api/diagnose/files`
3. 查看部署日志，确认服务器正常启动

### Q: 目录存在但不可写

**A**: 这通常是权限问题。Railway 通常会自动处理权限，如果遇到问题：
1. 检查 Volume 配置
2. 尝试重新部署
3. 如果问题持续，联系 Railway 支持

### Q: 数据库中有文件记录，但文件不存在

**A**: 这通常发生在：
1. Volume 配置之前上传的文件（已丢失）
2. 文件路径不匹配

**解决**：
1. 配置 Volume 后，需要重新上传文件
2. 或者使用数据迁移脚本（如果有）

## 相关文档

- `RAILWAY_VOLUME_SETUP.md` - Railway Volume 详细配置指南
- `DEPLOY_CHECKLIST.md` - 部署检查清单
- `DEPLOY.md` - 完整部署指南

