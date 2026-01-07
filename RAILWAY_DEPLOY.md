# Railway 部署指南

## 快速开始

### 1. 运行部署准备脚本

```bash
./deploy.sh
```

这个脚本会：
- 检查 Git 状态
- 提示提交未提交的更改
- 检查部署配置文件
- 生成部署检查清单

### 2. Railway Dashboard 配置

#### 步骤 1：创建/选择项目
1. 登录 [Railway Dashboard](https://railway.app)
2. 点击 "New Project" 或选择现有项目
3. 选择 "Deploy from GitHub repo"
4. 选择你的仓库和 `main` 分支

#### 步骤 2：添加 PostgreSQL 数据库
1. 在项目页面，点击 "+ New"
2. 选择 "Database" > "Add PostgreSQL"
3. Railway 会自动创建并注入 `DATABASE_URL`

#### 步骤 3：配置 Volume（必须！）
**重要：如果不配置 Volume，上传的文件会在容器重启后丢失！**

1. 在 Web 服务页面，点击 "Settings"
2. 找到 "Volumes" 部分
3. 点击 "Add Volume"
4. 配置：
   - **Mount Path**: `/data/uploads`
   - **Name**: `uploads-volume`（或自定义名称）
5. 点击 "Add" 保存

#### 步骤 4：检查环境变量
在 Web 服务页面，点击 "Variables"，确认：
- `DATABASE_URL` - 自动从 PostgreSQL 服务注入
- `PORT` - Railway 自动设置
- `NODE_ENV` - 可选，Railway 会自动设置为 `production`

可选添加：
- `UPLOADS_PATH` = `/data/uploads`（如果与默认值不同）

### 3. 部署

Railway 会在代码推送到 GitHub 后自动部署。也可以手动触发：
1. 在服务页面，点击 "Deployments"
2. 点击 "Deploy Now"

### 4. 监控部署

在 "Deployments" 页面查看部署日志，确认：
- ✅ 构建成功
- ✅ 依赖安装成功
- ✅ 数据库连接成功
- ✅ 数据库表初始化成功
- ✅ 应用启动成功
- ✅ 上传目录创建成功

**预期日志输出：**
```
✓ 已连接到PostgreSQL数据库
✓ 数据库连接成功
✓ 使用PostgreSQL数据库，表初始化已在init-db-pg.js中完成
✓ 上传目录已准备: /data/uploads
✓ Volume挂载检查: /data/uploads 可访问
✓ 服务器运行在 http://0.0.0.0:3000
```

### 5. 验证部署

#### 健康检查
访问：`https://your-app.up.railway.app/api/health`

应该返回：
```json
{"success":true,"message":"服务运行正常"}
```

#### 功能测试
1. 打开应用首页
2. 测试文档上传功能
3. 测试 PDF 查看器（下一页按钮）
4. 测试知识提取功能
5. 测试相关知识查询

#### 性能验证
- 检查页面加载速度（应该 < 2.5 秒 LCP）
- 检查 API 响应时间
- 使用性能监控面板查看指标

## 故障排查

### 问题 1：部署失败
**检查：**
- 查看部署日志中的错误信息
- 确认 Node.js 版本 >= 20
- 确认 Dockerfile 语法正确

### 问题 2：数据库连接失败
**检查：**
- PostgreSQL 服务状态是否为 "Online"
- `DATABASE_URL` 环境变量是否正确注入
- 查看应用日志中的连接错误

### 问题 3：文件上传失败
**检查：**
- Volume 是否正确挂载到 `/data/uploads`
- 查看应用日志中的错误信息
- 使用诊断端点检查：`/api/diagnose`

### 问题 4：页面无法访问
**检查：**
- 服务状态是否为 "Running"
- 端口配置是否正确
- Railway 提供的域名是否正确

## 诊断工具

应用提供了诊断端点，可以帮助排查问题：

访问：`https://your-app.up.railway.app/api/diagnose`

这会返回：
- 环境变量状态
- 数据库连接状态
- 上传目录状态
- 文件完整性检查
- 修复建议

## 性能优化验证

部署后，验证以下优化是否生效：

1. **PDF 缓存**
   - 打开 Network 面板
   - 多次访问同一个 PDF
   - 应该看到 304 Not Modified 响应

2. **相关知识查询**
   - 打开知识详情页
   - 查看相关知识加载时间
   - 应该 < 5 秒（之前是 30 秒）

3. **数据库查询**
   - 使用性能监控面板
   - 检查 settings 查询时间
   - 应该 < 10ms（之前是 135ms）

4. **页面加载**
   - 使用 Chrome DevTools Performance 面板
   - 检查 LCP（Largest Contentful Paint）
   - 应该 < 2.5 秒

## 后续优化建议

1. **监控和告警**
   - 设置 Railway 的监控告警
   - 监控错误率和响应时间

2. **CDN 配置**
   - 考虑使用 CDN 加速静态资源
   - 配置缓存策略

3. **数据库优化**
   - 定期分析慢查询
   - 根据实际使用情况调整索引

4. **缓存策略**
   - 考虑添加 Redis 缓存
   - 优化 API 响应缓存

## 支持

如果遇到问题：
1. 查看部署日志
2. 使用诊断端点检查
3. 查看 Railway 文档：https://docs.railway.app

