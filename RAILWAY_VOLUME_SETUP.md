# Railway Volume 持久化存储配置指南

## 问题说明

在Railway部署时，容器的文件系统是临时性的。重新部署后，`backend/uploads`目录中的PDF文件会丢失。为了解决这个问题，需要使用Railway Volume来持久化存储PDF文件。

## 解决方案

使用Railway Volume将PDF文件存储到持久化卷中，即使重新部署，文件也不会丢失。

## 配置步骤

### 重要：Volume配置在服务级别，不是项目级别

**关键区别**：
- **项目（Project）Settings**：在项目设置页面（你现在的位置），这里配置的是项目级别的设置
- **服务（Service）Settings**：在具体服务的设置页面，Volume配置在这里

### 正确的配置步骤

1. **进入服务页面**
   - 在Railway项目页面，你应该看到你的服务列表（比如 "knowledge-manager" 或类似名称）
   - **点击你的Web服务名称**（不是项目名称）
   - 这会带你进入服务详情页面

2. **进入服务的Settings**
   - 在服务页面的顶部导航栏中，点击 **"Settings"** 标签
   - 注意：这是服务级别的Settings，不是项目级别的

3. **找到Volumes部分**
   - 在服务的Settings页面中，向下滚动
   - 找到 **"Volumes"** 部分（通常在页面中下部）
   - 如果看不到Volumes部分，可能是因为：
     - 你的Railway计划不支持Volumes（免费计划支持）
     - 页面需要刷新

4. **创建Volume**
   - 点击 **"+ New Volume"** 按钮
   - 配置Volume：
     - **Mount Path**: `/data/uploads`
     - **Name**: `uploads` (可选，用于标识)
   - 点击 **"Add"** 保存

### 详细步骤图示说明

```
Railway Dashboard
  └─ 你的项目 (generous-enthusiasm)
      └─ 服务列表
          └─ [点击] Web服务 (knowledge-manager 或类似名称)  ← 这里！
              └─ 服务详情页面
                  └─ 顶部导航栏
                      └─ [点击] Settings  ← 服务级别的Settings
                          └─ 向下滚动
                              └─ Volumes 部分
                                  └─ + New Volume
```

### 如果找不到服务页面

如果你只看到项目设置页面，说明你需要：

1. **返回项目主页**
   - 点击页面左上角的项目名称或返回按钮
   - 或者从左侧菜单返回到项目主页

2. **找到服务列表**
   - 在项目主页，你应该能看到所有服务
   - 通常会有：
     - Web服务（你的应用）
     - PostgreSQL服务（数据库）
   - 点击Web服务进入服务详情

3. **然后按照上面的步骤2-4操作**

### 环境变量配置（可选）

如果Volume挂载点不是`/data/uploads`，可以通过环境变量自定义：

1. **在服务页面**（不是项目页面），点击 **"Variables"** 标签
2. 点击 **"+ New Variable"**
3. 添加变量：
   - **Key**: `UPLOADS_PATH`
   - **Value**: `/data/uploads` (或你的Volume挂载路径)
4. 点击 **"Add"** 保存

### 验证配置

部署后，检查日志应该看到：
```
✓ 上传目录已准备: /data/uploads
```

### 迁移现有文件（如果需要）

如果你有现有的PDF文件在临时目录中，需要手动迁移：

1. 通过Railway CLI或临时脚本访问容器
2. 将文件从临时目录复制到Volume目录：
   ```bash
   # 如果文件在 backend/uploads
   cp -r backend/uploads/* /data/uploads/
   ```

或者使用数据库迁移脚本（如果文件路径已存储在数据库中，需要更新路径）。

## 环境变量说明

- `UPLOADS_PATH`: 上传目录路径（可选）
  - 如果不设置，生产环境默认使用 `/data/uploads`
  - 开发环境默认使用 `backend/uploads`
- `NODE_ENV`: 环境类型（production/development）

## 注意事项

1. **Volume大小限制**：Railway免费计划可能有Volume大小限制，请查看Railway文档
2. **备份**：虽然Volume是持久化的，但建议定期备份重要文件
3. **路径一致性**：确保所有服务使用相同的路径配置
4. **服务级别配置**：Volume是服务级别的配置，每个服务需要单独配置

## 故障排查

### 问题：找不到Volumes选项

**可能原因1：在项目设置页面而不是服务设置页面**
- **解决**：确保你点击的是**服务名称**，然后在服务页面的Settings中查找

**可能原因2：Railway计划不支持**
- **解决**：检查你的Railway计划，免费计划应该支持Volumes

**可能原因3：页面需要刷新**
- **解决**：刷新页面或清除浏览器缓存

### 问题：文件仍然丢失

1. 检查Volume是否正确挂载：
   - 在Railway服务日志中查看启动信息
   - 确认看到 `✓ 上传目录已准备: /data/uploads`

2. 检查环境变量：
   - 确认 `UPLOADS_PATH` 环境变量设置正确（如果需要）
   - 确认 `NODE_ENV=production`

3. 检查Volume状态：
   - 在Railway服务设置中查看Volume状态
   - 确认Volume已正确挂载到服务

### 问题：权限错误

如果遇到权限错误，可能需要调整Volume权限。Railway通常会自动处理权限，但如果遇到问题，可以联系Railway支持。

## 相关文件

- `backend/routes/upload.js`: PDF上传路由
- `backend/routes/files.js`: PDF文件服务路由
- `backend/server.js`: 服务器启动文件（包含启动检查）
- `DEPLOY_CHECKLIST.md`: 部署检查清单
