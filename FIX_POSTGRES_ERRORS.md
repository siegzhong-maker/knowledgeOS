# PostgreSQL 错误修复说明

## 已修复的问题

### 1. ✅ 布尔值类型不匹配错误
**错误信息**: `operator does not exist: boolean = integer`

**原因**: PostgreSQL 中布尔字段 (`is_default`, `is_active`) 不能直接与整数 (`1`, `0`) 比较

**修复方案**:
- 在 `db-pg.js` 中添加了 `fixBooleanQueries()` 函数，自动将 `= 1` 转换为 `= true`，`= 0` 转换为 `= false`
- 修复了所有使用布尔字段的路由文件

### 2. ✅ 缺失数据库表错误  
**错误信息**: `relation "personal_knowledge_items" does not exist`

**原因**: 数据库表未正确初始化

**修复方案**:
- 确保 `server.js` 中的 `ensureDatabaseInitialized()` 包含所有必需的表
- 确保 Dockerfile 在启动时运行数据库初始化

## 修复的文件

1. **backend/services/db-pg.js**
   - 添加 `fixBooleanQueries()` 方法自动修复布尔值查询
   - 在 `get()`, `all()`, `run()` 方法中自动应用修复

2. **backend/routes/knowledge-bases.js**
   - 修复 `is_default` 字段的查询和插入

3. **backend/routes/context.js**
   - 修复 `is_active` 字段的查询和插入

4. **backend/server.js**
   - 确保包含 `personal_knowledge_items` 表的创建逻辑

## 部署步骤

1. **提交代码**:
   ```bash
   git add .
   git commit -m "fix: 修复PostgreSQL布尔值类型不匹配错误"
   git push
   ```

2. **等待 Railway 自动部署**

3. **验证修复**:
   - 查看部署日志，确认看到：
     ```
     ✓ personal_knowledge_items表已创建
     ✓ PostgreSQL数据库初始化完成
     ```
   - 访问应用，尝试：
     - 查看知识库页面（不应该再报错）
     - 提取知识（不应该再出现类型不匹配错误）

## 如果还有问题

### 手动运行数据库初始化

如果表仍然不存在，可以手动运行初始化：

```bash
railway run npm run init-db
```

### 检查数据库表

可以通过 PostgreSQL 客户端连接数据库，检查表是否存在：

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'personal_knowledge_items';
```

## 测试建议

修复后，请测试以下功能：

1. ✅ 查看知识库列表（之前报 `is_default` 错误）
2. ✅ 创建/更新知识库
3. ✅ 查看知识列表（之前报 `personal_knowledge_items` 不存在）
4. ✅ 提取知识（之前报布尔值类型不匹配）
5. ✅ 查看 Context 设置（之前报 `is_active` 错误）

## 注意事项

- PostgreSQL 对类型要求比 SQLite 更严格
- 布尔字段必须使用 `true/false`，不能使用 `1/0`
- 数据库初始化会自动运行，但如果失败需要手动检查日志

