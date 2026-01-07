/**
 * 删除缺失的PDF记录
 * 删除数据库中文件不存在的PDF记录
 */

const db = require('../services/db');
const { checkMissingPDFs } = require('./check-missing-pdfs');

async function deleteMissingPDFs(dryRun = true) {
  try {
    console.log('开始检查缺失的PDF文件...\n');
    
    // 检查缺失的文件
    const result = await checkMissingPDFs();
    
    if (result.missing === 0) {
      console.log('✓ 没有缺失的文件！');
      return { deleted: 0, skipped: 0 };
    }
    
    console.log(`\n找到 ${result.missing} 个缺失的文件\n`);
    
    if (dryRun) {
      console.log('='.repeat(60));
      console.log('【预览模式】以下文件将被删除：');
      console.log('='.repeat(60));
      result.missingFiles.forEach((item, index) => {
        console.log(`${index + 1}. ${item.title}`);
        console.log(`   ID: ${item.id}`);
        console.log(`   路径: ${item.file_path || '(无)'}`);
      });
      console.log('\n⚠️  这是预览模式，实际未删除任何记录');
      console.log('如果要实际删除，请运行：');
      console.log('   node backend/scripts/delete-missing-pdfs.js --execute');
      return { deleted: 0, skipped: result.missing, preview: true };
    }
    
    // 实际删除
    console.log('='.repeat(60));
    console.log('开始删除缺失的PDF记录...');
    console.log('='.repeat(60));
    
    let deletedCount = 0;
    const deletedItems = [];
    
    for (const item of result.missingFiles) {
      try {
        await db.run('DELETE FROM source_items WHERE id = ?', [item.id]);
        deletedItems.push(item);
        deletedCount++;
        console.log(`✓ 已删除: ${item.title} (${item.id})`);
      } catch (error) {
        console.error(`✗ 删除失败: ${item.title}`, error.message);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('删除完成');
    console.log('='.repeat(60));
    console.log(`✓ 已删除: ${deletedCount} 个记录`);
    console.log(`- 保留: ${result.existing} 个有效记录\n`);
    
    return {
      deleted: deletedCount,
      skipped: result.existing,
      deletedItems: deletedItems
    };
  } catch (error) {
    console.error('删除失败:', error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  (async () => {
    try {
      await db.connect();
      
      // 检查是否有 --execute 参数
      const execute = process.argv.includes('--execute') || process.argv.includes('-e');
      
      if (!execute) {
        console.log('⚠️  预览模式：不会实际删除任何记录\n');
      } else {
        console.log('⚠️  警告：将实际删除数据库记录！\n');
        // 可以添加确认提示
      }
      
      const result = await deleteMissingPDFs(!execute);
      
      if (result.preview) {
        process.exit(0);
      }
      
      console.log('\n操作完成！');
      process.exit(0);
    } catch (error) {
      console.error('脚本执行失败:', error);
      process.exit(1);
    }
  })();
}

module.exports = { deleteMissingPDFs };

