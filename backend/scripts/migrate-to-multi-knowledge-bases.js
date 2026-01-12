const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 支持环境变量配置数据库路径
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../database/knowledge.db');

// 确保数据库目录存在
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
    process.exit(1);
  }
  console.log('已连接到SQLite数据库');
});

db.serialize(() => {
  console.log('开始多知识库系统迁移...\n');
  
  // 步骤1: 创建知识库表
  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT 'book',
      color TEXT DEFAULT '#6366f1',
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('创建knowledge_bases表失败:', err.message);
      process.exit(1);
    } else {
      console.log('✓ 步骤1: knowledge_bases表已创建');
    }
  });

  // 步骤2: 知识库表已创建（不再自动创建默认知识库）
  console.log('✓ 步骤2: 知识库表结构已准备就绪');

  // 步骤3: 创建新的modules表
  db.run(`
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      knowledge_base_id TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      step_name TEXT NOT NULL,
      checkpoint_number INTEGER,
      checkpoint_name TEXT,
      description TEXT,
      order_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('创建modules表失败:', err.message);
      process.exit(1);
    } else {
      console.log('✓ 步骤3: modules表已创建');
    }
  });

  // 步骤4: 迁移模块数据
  db.get(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='entrepreneurship_modules'
  `, (err, row) => {
    if (err) {
      console.error('检查旧表失败:', err.message);
      process.exit(1);
    }

    if (row) {
      db.all('SELECT * FROM entrepreneurship_modules ORDER BY order_index ASC', (err, modules) => {
        if (err) {
          console.error('读取旧模块数据失败:', err.message);
          process.exit(1);
        }

        if (modules.length === 0) {
          console.log('⚠ 步骤4: 没有需要迁移的模块数据');
          migrateDocuments();
          return;
        }

        const stmt = db.prepare(`
          INSERT OR REPLACE INTO modules 
          (id, knowledge_base_id, step_number, step_name, checkpoint_number, checkpoint_name, description, order_index, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let migrated = 0;
        modules.forEach((module) => {
          stmt.run(
            module.id,
            defaultKbId,
            module.step_number,
            module.step_name,
            module.checkpoint_number,
            module.checkpoint_name,
            module.description,
            module.order_index,
            module.created_at || now
          );
          migrated++;
        });

        stmt.finalize((err) => {
          if (err) {
            console.error('迁移模块数据失败:', err.message);
            process.exit(1);
          } else {
            console.log(`✓ 步骤4: 已迁移 ${migrated} 个模块到modules表`);
            migrateDocuments();
          }
        });
      });
    } else {
      console.log('⚠ 步骤4: 未找到entrepreneurship_modules表，跳过模块迁移');
      migrateDocuments();
    }
  });

  // 步骤5: 为source_items表添加knowledge_base_id字段
  function migrateDocuments() {
    db.run(`ALTER TABLE source_items ADD COLUMN knowledge_base_id TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('添加knowledge_base_id字段失败:', err.message);
        process.exit(1);
      } else {
        console.log('✓ 步骤5: source_items表已添加knowledge_base_id列');
      }
    });

    // 步骤6: 更新文档的knowledge_base_id
    db.all(`
      SELECT DISTINCT module_id 
      FROM source_items 
      WHERE module_id IS NOT NULL AND module_id != ''
    `, (err, rows) => {
      if (err) {
        console.error('查询文档module_id失败:', err.message);
        finishMigration();
        return;
      }

      if (rows.length > 0) {
        const moduleIds = rows.map(r => r.module_id).filter(Boolean);
        const placeholders = moduleIds.map(() => '?').join(',');
        
        db.all(`
          SELECT id, knowledge_base_id 
          FROM modules 
          WHERE id IN (${placeholders})
        `, moduleIds, (err, moduleKbMap) => {
          if (err) {
            // 如果modules表不存在或查询失败，统一设置为默认知识库
            console.warn('查询模块知识库映射失败，统一设置为默认知识库:', err.message);
            updateAllDocumentsToDefault();
            return;
          }

          const kbMap = {};
          moduleKbMap.forEach(m => {
            kbMap[m.id] = m.knowledge_base_id;
          });

          let updated = 0;
          let total = 0;

          moduleIds.forEach(moduleId => {
            const kbId = kbMap[moduleId] || defaultKbId;
            
            db.run(`
              UPDATE source_items 
              SET knowledge_base_id = ? 
              WHERE module_id = ? AND (knowledge_base_id IS NULL OR knowledge_base_id = '')
            `, [kbId, moduleId], function(err) {
              if (err) {
                console.error(`更新文档失败 (module_id: ${moduleId}):`, err.message);
              } else {
                updated += this.changes;
              }
              total++;
              
              if (total === moduleIds.length) {
                updateAllDocumentsToDefault();
              }
            });
          });

          if (moduleIds.length === 0) {
            updateAllDocumentsToDefault();
          }
        });
      } else {
        updateAllDocumentsToDefault();
      }
    });
  }

  function updateAllDocumentsToDefault() {
    db.run(`
      UPDATE source_items 
      SET knowledge_base_id = ? 
      WHERE (knowledge_base_id IS NULL OR knowledge_base_id = '')
    `, [defaultKbId], function(err) {
      if (err) {
        console.error('更新无模块文档失败:', err.message);
      } else {
        console.log(`✓ 步骤6: 已更新 ${this.changes} 个文档的knowledge_base_id`);
      }
      finishMigration();
    });
  }

  function finishMigration() {
    console.log('\n✓ 多知识库系统迁移完成！');
    console.log('\n迁移摘要:');
    console.log(`  - 默认知识库ID: ${defaultKbId}`);
    console.log('  - 所有现有模块和文档已迁移到默认知识库');
    console.log('\n下一步:');
    console.log('  1. 重启后端服务');
    console.log('  2. 刷新前端页面');
    console.log('  3. 可以开始创建新的知识库了！\n');
    
    db.close((err) => {
      if (err) {
        console.error('关闭数据库失败:', err.message);
      }
      process.exit(0);
    });
  }
});

