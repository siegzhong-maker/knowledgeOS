# Railway 数据库初始化检查与修复指南

## 问题说明

本地和云端使用的是**完全独立的数据库**：
- **本地**：SQLite 数据库（`database/knowledge.db`）
- **云端**：PostgreSQL 数据库（Railway Postgres）

数据**不会自动同步**，需要：
1. 确保云端的数据库表结构已初始化
2. 在云端重新上传文档和提取知识

## 快速检查：数据库是否已初始化

### 方法 1：检查应用日志

1. 登录 [Railway Dashboard](https://railway.app)
2. 进入你的项目
3. 点击你的 Web 服务
4. 查看 **"Deployments"** 标签页中的部署日志
5. 查找以下日志：

**✅ 正确的日志应该显示：**
```
检测到PostgreSQL配置，使用PostgreSQL初始化脚本...
✓ 已连接到PostgreSQL数据库
✓ source_items表已创建
✓ personal_knowledge_items表已创建
✓ knowledge_bases表已创建
...（更多表的创建日志）
✓ PostgreSQL数据库初始化完成
```

**❌ 如果看到以下情况，说明数据库未初始化：**
- 没有看到表的创建日志
- 看到 `relation "xxx" does not exist` 错误
- 看到 `SQLITE_ERROR: no such table` 错误

### 方法 2：通过 API 检查

访问你的应用 URL + `/api/health`，应该返回：
```json
{"success":true,"message":"服务运行正常"}
```

如果返回数据库相关错误，说明数据库未初始化。

## 修复方案

### 方案 1：手动运行数据库初始化（推荐）

使用 Railway CLI 手动运行初始化脚本：

```bash
# 安装 Railway CLI（如果还没安装）
npm i -g @railway/cli

# 登录 Railway
railway login

# 进入项目目录
cd /path/to/knowledge

# 连接到你的项目
railway link

# 手动运行数据库初始化
railway run npm run init-db
```

或者在 Railway Dashboard 中：

1. 进入你的 Web 服务
2. 点击 **"Settings"**
3. 找到 **"Command"** 或使用 **"Deployments"** 标签页
4. 在 **"Run Command"** 中输入：`npm run init-db`
5. 点击运行

### 方案 2：触发重新部署（会自动运行 postinstall）

1. 在 Railway Dashboard 中，进入你的项目
2. 点击你的 Web 服务
3. 点击 **"Settings"**
4. 点击 **"Redeploy"** 或 **"Trigger Deploy"**
5. 等待部署完成，查看日志确认数据库已初始化

### 方案 3：修改 Dockerfile 确保初始化（最可靠）

我已经优化了 Dockerfile，会在启动前自动初始化数据库。如果之前的 Dockerfile 没有这个功能，请使用最新的版本。

## 验证数据库初始化成功

初始化成功后，你应该能够：

1. **访问知识库页面**，看到空的知识库（至少能看到界面，不会报错）
2. **上传文档**，文档应该能正常保存
3. **提取知识**，知识点应该能正常创建和显示

## 常见问题

### Q: 为什么部署后数据库还是空的？

A: 数据库初始化只创建**表结构**，不会迁移数据。你需要：
1. 在云端重新上传文档
2. 在云端重新提取知识
3. 或者使用数据迁移脚本（见下方）

### Q: 如何将本地数据迁移到云端？

目前没有自动迁移工具，你可以：

**方法 1：手动迁移（推荐）**
- 在本地导出数据（通过应用的导出功能）
- 在云端手动重新创建（适用于数据量不大的情况）

**方法 2：使用数据库迁移脚本**
- 需要本地安装 Railway CLI
- 需要配置本地到云端的数据库连接
- 比较复杂，不推荐

**方法 3：直接在云端使用**
- 云端是一个全新的环境
- 直接在云端上传和提取知识即可

### Q: 每次重新部署都会清空数据吗？

A: **不会**。Railway Postgres 是持久化存储，数据会保留。只有以下情况会丢失数据：
- 手动删除 PostgreSQL 服务
- Railway 服务被暂停且超出免费额度（免费套餐有数据保留期限）

### Q: 如何确认使用的是 PostgreSQL 而不是 SQLite？

查看部署日志，应该看到：
```
检测到PostgreSQL配置，使用PostgreSQL初始化脚本...
✓ 已连接到PostgreSQL数据库
```

而不是：
```
✓ 已连接到SQLite数据库
```

## 下一步

数据库初始化成功后：

1. ✅ 确认数据库表已创建
2. ✅ 在云端重新上传文档
3. ✅ 在云端重新提取知识
4. ✅ 配置 AI API Key（在应用设置中）

## 需要帮助？

如果以上方法都无法解决问题，请检查：

1. **环境变量**：确认 `DATABASE_URL` 已正确配置
2. **Postgres 服务状态**：确认 PostgreSQL 服务为 "Online"
3. **部署日志**：查看完整的错误信息

