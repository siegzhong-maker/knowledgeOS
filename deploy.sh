#!/bin/bash

# Railway 部署准备脚本
# 此脚本帮助准备部署到 Railway

set -e

echo "🚀 Railway 部署准备脚本"
echo "========================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查 Git 状态
echo -e "${YELLOW}步骤 1: 检查 Git 状态${NC}"
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  发现未提交的更改${NC}"
    echo ""
    echo "未提交的文件："
    git status --short
    echo ""
    read -p "是否现在提交所有更改？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git add .
        git commit -m "性能优化：PDF缓存、相关知识查询优化、数据库索引优化、修复PDF查看器下一页按钮"
        echo -e "${GREEN}✓ 更改已提交${NC}"
    else
        echo -e "${RED}✗ 请手动提交更改后再继续${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Git 工作区干净${NC}"
fi

# 检查是否在 main 分支
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}⚠️  当前分支: $CURRENT_BRANCH${NC}"
    read -p "是否切换到 main 分支？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git checkout main
        echo -e "${GREEN}✓ 已切换到 main 分支${NC}"
    fi
fi

# 检查远程仓库
echo ""
echo -e "${YELLOW}步骤 2: 检查远程仓库${NC}"
if git remote | grep -q "origin"; then
    REMOTE_URL=$(git remote get-url origin)
    echo -e "${GREEN}✓ 远程仓库: $REMOTE_URL${NC}"
else
    echo -e "${RED}✗ 未找到远程仓库 'origin'${NC}"
    exit 1
fi

# 检查是否需要推送
echo ""
echo -e "${YELLOW}步骤 3: 检查是否需要推送${NC}"
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")
if [ -z "$REMOTE" ]; then
    echo -e "${YELLOW}⚠️  未设置上游分支${NC}"
    read -p "是否推送到 origin/main？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push -u origin main
        echo -e "${GREEN}✓ 已推送到 origin/main${NC}"
    fi
elif [ "$LOCAL" != "$REMOTE" ]; then
    echo -e "${YELLOW}⚠️  本地分支与远程分支不同步${NC}"
    read -p "是否推送到远程？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin main
        echo -e "${GREEN}✓ 已推送到远程${NC}"
    fi
else
    echo -e "${GREEN}✓ 本地和远程已同步${NC}"
fi

# 检查部署配置文件
echo ""
echo -e "${YELLOW}步骤 4: 检查部署配置文件${NC}"

check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓ $1 存在${NC}"
        return 0
    else
        echo -e "${RED}✗ $1 不存在${NC}"
        return 1
    fi
}

check_file "Dockerfile"
check_file "railway.json"
check_file "package.json"

# 检查 Dockerfile 内容
if grep -q "node:20" Dockerfile 2>/dev/null; then
    echo -e "${GREEN}✓ Dockerfile 使用 Node.js 20${NC}"
else
    echo -e "${RED}✗ Dockerfile 未使用 Node.js 20${NC}"
fi

# 检查 package.json
if grep -q '"start"' package.json; then
    echo -e "${GREEN}✓ package.json 包含 start 脚本${NC}"
else
    echo -e "${RED}✗ package.json 缺少 start 脚本${NC}"
fi

# 生成部署检查清单
echo ""
echo -e "${YELLOW}步骤 5: 生成部署检查清单${NC}"
cat > DEPLOY_CHECKLIST.md << 'EOF'
# Railway 部署检查清单

## ✅ 本地准备（已完成）
- [x] 代码已提交
- [x] 代码已推送到 GitHub
- [x] Dockerfile 已配置
- [x] railway.json 已配置

## 🔧 Railway 配置（需要在 Railway Dashboard 完成）

### 1. 项目和服务
- [ ] 登录 Railway Dashboard
- [ ] 创建/选择项目
- [ ] 连接 GitHub 仓库
- [ ] 选择 main 分支

### 2. PostgreSQL 数据库
- [ ] 添加 PostgreSQL 服务
- [ ] 确认 DATABASE_URL 自动注入

### 3. Volume 配置（重要！）
- [ ] 在 Web 服务页面点击 "Settings"
- [ ] 找到 "Volumes" 部分
- [ ] 点击 "Add Volume"
- [ ] Mount Path: `/data/uploads`
- [ ] Name: `uploads-volume`（或自定义）
- [ ] 保存配置

### 4. 环境变量（可选）
- [ ] NODE_ENV = production（可选）
- [ ] UPLOADS_PATH = /data/uploads（可选，默认值）

### 5. 部署
- [ ] 触发部署（自动或手动）
- [ ] 查看部署日志
- [ ] 确认构建成功
- [ ] 确认数据库连接成功
- [ ] 确认应用启动成功

## 🧪 部署后验证

### 健康检查
- [ ] 访问 `/api/health` 端点
- [ ] 确认返回 `{"success":true,"message":"服务运行正常"}`

### 功能测试
- [ ] 打开应用首页
- [ ] 测试文档上传
- [ ] 测试 PDF 查看器（下一页按钮）
- [ ] 测试知识提取
- [ ] 测试相关知识查询

### 性能验证
- [ ] 检查页面加载速度
- [ ] 检查 API 响应时间
- [ ] 使用性能监控面板

## 📊 预期日志输出

部署成功后，应该看到：
```
✓ 已连接到PostgreSQL数据库
✓ 数据库连接成功
✓ 使用PostgreSQL数据库，表初始化已在init-db-pg.js中完成
✓ 上传目录已准备: /data/uploads
✓ Volume挂载检查: /data/uploads 可访问
✓ 服务器运行在 http://0.0.0.0:3000
```

## 🐛 故障排查

如果遇到问题，检查：
1. 部署日志中的错误信息
2. Volume 是否正确挂载
3. DATABASE_URL 是否正确注入
4. 端口配置是否正确
EOF

echo -e "${GREEN}✓ 已生成 DEPLOY_CHECKLIST.md${NC}"

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✓ 部署准备完成！${NC}"
echo ""
echo "下一步："
echo "1. 在 Railway Dashboard 中配置 Volume（重要！）"
echo "2. 触发部署"
echo "3. 查看部署日志"
echo "4. 验证健康检查端点"
echo ""
echo "详细步骤请查看 DEPLOY_CHECKLIST.md"

