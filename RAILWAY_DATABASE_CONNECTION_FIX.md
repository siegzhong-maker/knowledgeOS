# Railway 数据库连接错误解决方案

## 当前错误

```
Error: connect ENETUNREACH 2406:dala:6b0:f612:b352:8ee:3c1d:c05d:5432
code: 'ENETUNREACH'
```

**问题分析：**
- 应用尝试连接到 IPv6 地址 `2406:dala:6b0:f612:b352:8ee:3c1d:c05d`
- 这不是 Supabase 的地址
- 很可能是 Railway 自动创建了 PostgreSQL 服务，覆盖了手动设置的 `DATABASE_URL`

## 解决方案

### 方案 1：移除 Railway 自动创建的数据库服务（推荐）

1. **进入 Railway 项目页面**
   - 访问你的 Railway 项目：https://railway.com/project/88699968-0735-4804-b94d-339b573b7c99

2. **检查是否有自动创建的 PostgreSQL 服务**
   - 在项目页面中，查看是否有名为 "PostgreSQL" 或类似名称的服务
   - 如果有，这个服务可能自动提供了 `DATABASE_URL` 环境变量

3. **删除自动创建的数据库服务**
   - 点击该数据库服务
   - 进入 "Settings" 标签
   - 滚动到底部，点击 "Delete Service" 或 "Remove Service"
   - 确认删除

4. **确认环境变量设置**
   - 回到你的应用服务（Web Service）
   - 进入 "Variables" 标签
   - 确认 `DATABASE_URL` 环境变量存在，值为：
     ```
     postgresql://postgres:Zhong%40123ch@db.eibgzxvspsdlkrwwiqjx.supabase.co:5432/postgres
     ```
   - 如果不存在或值不正确，点击 "New Variable" 添加或编辑

5. **重新部署**
   - Railway 会自动重新部署
   - 或者手动触发重新部署

### 方案 2：使用 Railway 的数据库服务（如果必须保留）

如果你需要保留 Railway 的数据库服务，需要：

1. **移除手动的 DATABASE_URL 环境变量**
   - 在应用服务的 "Variables" 标签中
   - 删除或禁用手动设置的 `DATABASE_URL`

2. **使用 Railway 数据库的连接字符串**
   - Railway 会自动提供 `DATABASE_URL` 环境变量
   - 但这样数据会存储在 Railway 的数据库中，不是 Supabase

⚠️ **不推荐**：Railway 的数据库服务是付费的，而且数据不在 Supabase 中。

## 正确的 DATABASE_URL 配置

### 对于 Supabase 数据库：

```
postgresql://postgres:Zhong%40123ch@db.eibgzxvspsdlkrwwiqjx.supabase.co:5432/postgres
```

**重要说明：**
- 用户名：`postgres`
- 密码：`Zhong@123ch`（在 URL 中编码为 `Zhong%40123ch`）
- 主机：`db.eibgzxvspsdlkrwwiqjx.supabase.co`
- 端口：`5432`
- 数据库名：`postgres`

### 在 Railway 中设置步骤：

1. 进入应用服务的 "Variables" 标签
2. 点击 "New Variable" 或编辑现有的 `DATABASE_URL`
3. **Key**: `DATABASE_URL`
4. **Value**: `postgresql://postgres:Zhong%40123ch@db.eibgzxvspsdlkrwwiqjx.supabase.co:5432/postgres`
5. 点击 "Add" 或 "Save"
6. 等待自动重新部署

## 验证步骤

部署完成后，检查日志应该看到：

✅ **成功标志：**
```
✓ 已连接到PostgreSQL数据库
```

❌ **如果仍然失败，会看到：**
```
启动服务器失败: Error: connect ENETUNREACH ...
```
或
```
启动服务器失败: Error: getaddrinfo ENOTFOUND ...
```

## 环境变量优先级

Railway 中环境变量的优先级：

1. **服务级别**（最高优先级）- 在应用服务的 Variables 标签中设置
2. **项目级别** - 在项目设置中设置
3. **自动注入** - Railway 自动服务（如数据库服务）提供的变量

**推荐做法：**
- 在**服务级别**设置 `DATABASE_URL`
- 不要在项目级别设置（除非所有服务共享）
- 不要使用 Railway 自动创建的数据库服务（如果要使用 Supabase）

## 诊断步骤（已添加调试日志）

代码中已添加调试日志，部署后可以在日志中查看实际使用的数据库连接信息。

### 查看调试日志

1. 在 Railway 服务页面，点击 "Logs" 标签
2. 查找包含 `[Database]` 的日志行
3. 检查输出的连接信息，确认：
   - 主机名是否为 `db.eibgzxvspsdlkrwwiqjx.supabase.co`
   - 如果显示其他主机名（如 IPv6 地址），说明环境变量未正确生效

**预期日志输出（正确）：**
```
[Database] 连接信息: postgresql://postgres@db.eibgzxvspsdlkrwwiqjx.supabase.co:5432/postgres
✓ 已连接到PostgreSQL数据库
```

**错误日志输出示例：**
```
[Database] 连接信息: postgresql://postgres@2406:dala:6b0:f612:b352:8ee:3c1d:c05d:5432/postgres
[Database] 警告: 数据库主机 "2406:dala:6b0:f612:b352:8ee:3c1d:c05d" 不是预期的 Supabase 地址
启动服务器失败: Error: connect ENETUNREACH ...
```

### 环境变量配置检查清单

#### 步骤 1: 检查服务级别环境变量

- [ ] 进入 Railway 服务页面（knowledge 服务）
- [ ] 点击 "Variables" 标签
- [ ] 确认 `DATABASE_URL` 变量存在
- [ ] 点击 `DATABASE_URL` 变量，确认值是否为：
  ```
  postgresql://postgres:Zhong%40123ch@db.eibgzxvspsdlkrwwiqjx.supabase.co:5432/postgres
  ```
- [ ] 如果值不正确，点击编辑并修改
- [ ] 点击 "Update Variables" 或保存按钮

#### 步骤 2: 使用 Raw Editor 验证

- [ ] 在 Variables 标签页，点击 "{} Raw Editor" 按钮
- [ ] 在 ENV 标签中，查看所有环境变量
- [ ] 确认 `DATABASE_URL` 的值正确
- [ ] 检查是否有重复的 `DATABASE_URL` 定义
- [ ] 如果有多个 `DATABASE_URL`，删除错误的那个
- [ ] 点击 "Update Variables" 保存

#### 步骤 3: 检查项目级别环境变量

- [ ] 在 Railway 项目页面（不是服务页面）
- [ ] 点击项目名称，进入项目设置
- [ ] 查找 "Variables" 或 "Environment Variables" 选项
- [ ] 检查是否有项目级别的 `DATABASE_URL` 变量
- [ ] 如果有，考虑删除（服务级别优先级更高，但可能存在冲突）
- [ ] 或者确认项目级别的值也是正确的

#### 步骤 4: 检查 Architecture 页面

- [ ] 在 Railway 项目页面，点击 "Architecture" 标签
- [ ] 查看是否有其他服务（如 PostgreSQL、Database、Network 等）
- [ ] 如果有其他数据库服务连接到你的应用，可能需要：
  - 断开连接
  - 或者删除该服务
- [ ] 确认只有你的 "knowledge" 应用服务

#### 步骤 5: 验证环境变量优先级

Railway 环境变量优先级（从高到低）：
1. **服务级别变量**（Service Variables）- 最高优先级
2. **项目级别变量**（Project Variables）
3. **Railway 自动注入的变量**（来自其他服务的链接）

**推荐配置：**
- ✅ 只在服务级别设置 `DATABASE_URL`
- ❌ 不要在项目级别设置（除非所有服务共享同一个数据库）
- ❌ 不要使用 Railway 自动创建的数据库服务（如果使用 Supabase）

#### 步骤 6: 重新部署并查看日志

- [ ] 保存所有环境变量更改
- [ ] 手动触发重新部署（如果 Railway 没有自动部署）
- [ ] 等待部署完成
- [ ] 查看 "Logs" 标签
- [ ] 查找 `[Database] 连接信息` 日志
- [ ] 确认连接的主机名正确
- [ ] 确认看到 `✓ 已连接到PostgreSQL数据库` 消息

## 故障排查清单

- [ ] 检查 Railway 项目是否有自动创建的 PostgreSQL 服务
- [ ] 如果有，删除该服务
- [ ] 在应用服务的 Variables 中设置 `DATABASE_URL`
- [ ] 确认 `DATABASE_URL` 值正确（包含正确的 Supabase 主机）
- [ ] 确认密码中的 `@` 已编码为 `%40`
- [ ] 使用 Raw Editor 验证所有环境变量
- [ ] 检查项目级别是否有冲突的 `DATABASE_URL`
- [ ] 保存环境变量后等待重新部署
- [ ] 查看部署日志中的调试信息
- [ ] 确认连接成功或根据错误信息进一步排查

## 如果问题仍然存在

### 场景 1: 日志显示错误的连接地址

如果日志中的 `[Database] 连接信息` 显示的不是 Supabase 地址：

1. **确认环境变量已保存**
   - 在 Raw Editor 中再次检查 `DATABASE_URL` 的值
   - 确认点击了 "Update Variables" 保存

2. **检查是否有缓存**
   - Railway 可能需要几分钟才能应用新的环境变量
   - 尝试手动触发重新部署
   - 等待 2-3 分钟后再检查日志

3. **尝试删除并重新添加变量**
   - 在 Variables 标签页，删除 `DATABASE_URL` 变量
   - 保存更改，等待部署
   - 重新添加 `DATABASE_URL` 变量，设置正确的值
   - 保存并等待重新部署

### 场景 2: 日志显示正确的地址但连接失败

如果日志显示正确的 Supabase 地址但连接失败：

1. **检查 Supabase 数据库状态**
   - 登录 [Supabase 控制台](https://supabase.com/dashboard)
   - 进入你的项目：`eibgzxvspsdlkrwwiqjx`
   - 确认数据库服务正常运行
   - 检查是否有连接限制或防火墙规则

2. **验证连接字符串**
   - 在 Supabase 控制台，进入 Settings > Database
   - 查看 Connection string > URI
   - 对比 Railway 中设置的 `DATABASE_URL` 是否正确
   - 特别注意密码编码（`@` 需要编码为 `%40`）

3. **测试连接字符串（本地）**
   ```bash
   # 使用 psql 测试连接
   psql "postgresql://postgres:Zhong%40123ch@db.eibgzxvspsdlkrwwiqjx.supabase.co:5432/postgres"
   
   # 或使用 Node.js 测试
   node -e "require('pg').Pool({connectionString:process.env.DATABASE_URL}).query('SELECT NOW()',(e,r)=>console.log(e||r.rows))"
   ```

4. **检查网络连接**
   - Railway 的服务器可能无法访问 Supabase
   - 检查 Supabase 项目的区域设置
   - 确认没有 IP 白名单限制

### 场景 3: 环境变量为空或未定义

如果日志显示 `DATABASE_URL environment variable is required`：

1. **确认变量名称正确**
   - 变量名必须是 `DATABASE_URL`（全大写）
   - 检查是否有拼写错误

2. **确认变量作用域**
   - 在服务级别设置，不是项目级别
   - 确认当前查看的是正确的服务

3. **检查变量格式**
   - 在 Raw Editor 中查看，确认格式为：`DATABASE_URL="value"`
   - 值应该用引号包围（Raw Editor 会自动处理）

### 场景 4: 需要更多调试信息

如果以上步骤都无法解决问题：

1. **查看完整日志**
   - 在 Railway 服务页面的 "Logs" 标签
   - 查看完整的错误堆栈信息
   - 复制错误信息用于进一步排查

2. **联系 Railway 支持**
   - 如果怀疑是 Railway 平台问题
   - 提供详细的错误日志和环境变量配置信息

3. **临时解决方案**
   - 考虑使用 Render 或其他平台部署
   - 参考 [DEPLOY.md](./DEPLOY.md) 中的其他部署方案

## 相关文档

- [Supabase 设置指南](./SUPABASE_SETUP.md)
- [Railway 部署指南](./RAILWAY_DEPLOY.md)
- [完整部署指南](./DEPLOY.md)

