# 使用 Node.js 20
FROM node:20-alpine

# 安装构建工具（sqlite3 需要编译原生模块）
# 注意：即使使用 PostgreSQL，sqlite3 仍会被安装（因为它在 dependencies 中）
# 但通过 --ignore-scripts 可以跳过编译，因为生产环境不会使用它
RUN apk add --no-cache python3 make g++

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
# 使用 --ignore-scripts 跳过 postinstall 和 sqlite3 的编译
# 如果 DATABASE_URL 已设置，应用会使用 PostgreSQL，不会加载 sqlite3
# 代码已经修复，确保在 PostgreSQL 环境下不会尝试加载 sqlite3
RUN npm install --production --ignore-scripts

# 复制所有文件
COPY . .

# 暴露端口
EXPOSE 3000

# 启动脚本：先初始化数据库，再启动应用
# 注意：如果 DATABASE_URL 已设置，init-db 会使用 PostgreSQL，不会加载 sqlite3
CMD sh -c "npm run init-db && npm start"
