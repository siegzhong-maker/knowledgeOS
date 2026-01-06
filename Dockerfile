# 使用 Node.js 20
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖（跳过 postinstall，因为 DATABASE_URL 在运行时才可用）
RUN npm install --production --ignore-scripts

# 复制所有文件
COPY . .

# 暴露端口
EXPOSE 3000

# 启动脚本：先初始化数据库，再启动应用
CMD sh -c "npm run init-db && npm start"
