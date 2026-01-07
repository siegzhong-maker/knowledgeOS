/**
 * 检查缺失的PDF文件
 * 扫描数据库中的所有PDF记录，检查对应的文件是否存在
 */

const db = require('../services/db');
const fs = require('fs').promises;
const path = require('path');

// 获取上传目录路径
const uploadsDir = process.env.UPLOADS_PATH || 
                   (process.env.NODE_ENV === 'production' ? '/data/uploads' : path.join(__dirname, '../../backend/uploads'));

async function checkFileExists(filePath) {
  const possiblePaths = [];
  
  // 提取文件名
  const fileName = path.basename(filePath);
  
  // 1. 如果file_path是绝对路径
  if (path.isAbsolute(filePath)) {
    possiblePaths.push({
      path: filePath,
      reason: '绝对路径（数据库存储）'
    });
    
    // 如果绝对路径指向旧的临时目录，尝试提取文件名在Volume中查找
    if (filePath.includes('/app/backend/uploads/') || 
        filePath.includes('/backend/uploads/')) {
      possiblePaths.push({
        path: path.join(uploadsDir, fileName),
        reason: '从旧路径提取文件名（迁移场景）'
      });
    }
  }
  
  // 2. 作为相对路径，相对于uploadsDir
  possiblePaths.push({
    path: path.join(uploadsDir, filePath),
    reason: '相对路径（相对于上传目录）'
  });
  
  // 3. 如果file_path看起来像文件名（只有文件名，没有目录），尝试直接在上传目录中查找
  if (!filePath.includes('/') && !filePath.includes('\\')) {
    possiblePaths.push({
      path: path.join(uploadsDir, filePath),
      reason: '仅文件名（在上传目录中查找）'
    });
  }
  
  // 4. 尝试使用文件名（从任何路径中提取）
  if (fileName !== filePath) {
    possiblePaths.push({
      path: path.join(uploadsDir, fileName),
      reason: '提取文件名（兼容旧路径）'
    });
  }
  
  // 尝试每个可能的路径
  for (const attempt of possiblePaths) {
    try {
      const normalizedPath = path.normalize(attempt.path);
      const resolvedPath = path.resolve(normalizedPath);
      const resolvedUploadsDir = path.resolve(uploadsDir);
      
      // 安全检查：确保路径在uploads目录内
      if (!resolvedPath.startsWith(resolvedUploadsDir)) {
        continue;
      }
      
      // 检查文件是否存在
      await fs.access(resolvedPath);
      return {
        exists: true,
        foundPath: resolvedPath,
        reason: attempt.reason
      };
    } catch (error) {
      continue;
    }
  }
  
  return {
    exists: false,
    attemptedPaths: possiblePaths.map(p => p.path)
  };
}

async function checkMissingPDFs() {
  try {
    console.log('开始检查缺失的PDF文件...\n');
    console.log('上传目录:', uploadsDir);
    console.log('环境:', process.env.NODE_ENV || 'development');
    console.log('---\n');
    
    // 获取所有PDF记录
    const pdfItems = await db.all(
      'SELECT id, title, file_path, created_at FROM source_items WHERE type = ? ORDER BY created_at DESC',
      ['pdf']
    );
    
    console.log(`找到 ${pdfItems.length} 个PDF记录\n`);
    
    const missingFiles = [];
    const existingFiles = [];
    
    for (const item of pdfItems) {
      if (!item.file_path) {
        missingFiles.push({
          id: item.id,
          title: item.title,
          file_path: null,
          reason: '数据库中没有文件路径',
          created_at: item.created_at
        });
        continue;
      }
      
      const checkResult = await checkFileExists(item.file_path);
      
      if (checkResult.exists) {
        existingFiles.push({
          id: item.id,
          title: item.title,
          file_path: item.file_path,
          foundPath: checkResult.foundPath,
          reason: checkResult.reason
        });
      } else {
        missingFiles.push({
          id: item.id,
          title: item.title,
          file_path: item.file_path,
          reason: '文件不存在',
          attemptedPaths: checkResult.attemptedPaths,
          created_at: item.created_at
        });
      }
    }
    
    // 输出结果
    console.log('='.repeat(60));
    console.log('检查结果汇总');
    console.log('='.repeat(60));
    console.log(`✓ 文件存在: ${existingFiles.length} 个`);
    console.log(`✗ 文件缺失: ${missingFiles.length} 个\n`);
    
    if (missingFiles.length > 0) {
      console.log('缺失的文件列表:');
      console.log('-'.repeat(60));
      missingFiles.forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.title}`);
        console.log(`   ID: ${item.id}`);
        console.log(`   数据库路径: ${item.file_path || '(无)'}`);
        console.log(`   原因: ${item.reason}`);
        if (item.attemptedPaths) {
          console.log(`   尝试的路径:`);
          item.attemptedPaths.forEach(p => {
            console.log(`     - ${p}`);
          });
        }
        console.log(`   创建时间: ${new Date(item.created_at).toLocaleString()}`);
      });
    }
    
    if (existingFiles.length > 0 && missingFiles.length === 0) {
      console.log('\n✓ 所有PDF文件都存在！');
    }
    
    // 生成修复建议
    if (missingFiles.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('修复建议');
      console.log('='.repeat(60));
      console.log('1. 检查文件是否在其他位置');
      console.log('2. 如果文件已丢失，可以考虑：');
      console.log('   - 重新上传文件');
      console.log('   - 从备份恢复文件');
      console.log('   - 删除数据库中的无效记录');
      console.log('3. 检查Volume挂载是否正确（生产环境）');
      console.log('4. 检查UPLOADS_PATH环境变量是否正确设置');
    }
    
    return {
      total: pdfItems.length,
      existing: existingFiles.length,
      missing: missingFiles.length,
      missingFiles: missingFiles,
      existingFiles: existingFiles
    };
  } catch (error) {
    console.error('检查失败:', error);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  (async () => {
    try {
      await db.connect();
      const result = await checkMissingPDFs();
      process.exit(0);
    } catch (error) {
      console.error('脚本执行失败:', error);
      process.exit(1);
    }
  })();
}

module.exports = { checkMissingPDFs, checkFileExists };

