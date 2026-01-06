// 批量更新知识点状态为待审核
// 运行方式: node backend/scripts/update-knowledge-status.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 支持环境变量配置数据库路径（Railway部署时使用）
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../database/knowledge.db');

// 确保数据库目录存在
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 创建数据库连接
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
    process.exit(1);
  }
  console.log('✓ 已连接到SQLite数据库');
});

function updateKnowledgeStatus() {
  return new Promise((resolve, reject) => {
    console.log('开始更新知识点状态...');
    
    // 将所有状态为 'confirmed' 的知识点改为 'pending'
    db.run(
      `UPDATE personal_knowledge_items 
       SET status = 'pending', updated_at = ? 
       WHERE status = 'confirmed'`,
      [Date.now()],
      function(err) {
        if (err) {
          reject(err);
          return;
        }

        console.log(`✓ 成功更新 ${this.changes} 个知识点状态为"待审核"`);
        
        // 查询更新后的统计
        db.all(
          `SELECT status, COUNT(*) as count 
           FROM personal_knowledge_items 
           GROUP BY status`,
          [],
          (err, stats) => {
            if (err) {
              reject(err);
              return;
            }
            
            console.log('\n当前知识点状态统计:');
            stats.forEach(stat => {
              const statusMap = {
                'pending': '待审核',
                'confirmed': '已确认',
                'archived': '已归档'
              };
              console.log(`  ${statusMap[stat.status] || stat.status}: ${stat.count} 个`);
            });
            
            console.log('\n✓ 更新完成！');
            resolve();
          }
        );
      }
    );
  });
}

// 运行更新
updateKnowledgeStatus()
  .then(() => {
    db.close((err) => {
      if (err) {
        console.error('关闭数据库失败:', err);
        process.exit(1);
      }
      process.exit(0);
    });
  })
  .catch((error) => {
    console.error('更新失败:', error);
    db.close((err) => {
      process.exit(1);
    });
  });
