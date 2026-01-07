const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const db = require('../services/db');

/**
 * 获取PDF文件
 * GET /api/files/pdf/:id
 */
router.get('/pdf/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('请求PDF文件，ID:', id);
    
    // 从数据库获取文件信息
    const item = await db.get(
      'SELECT file_path, type FROM source_items WHERE id = ?',
      [id]
    );
    
    if (!item) {
      console.error('PDF文件请求失败：文档不存在，ID:', id);
      return res.status(404).json({ 
        success: false, 
        message: '文档不存在' 
      });
    }
    
    console.log('找到文档:', { id, type: item.type, file_path: item.file_path });
    
    if (item.type !== 'pdf') {
      return res.status(400).json({ 
        success: false, 
        message: '该文档不是PDF类型' 
      });
    }
    
    if (!item.file_path) {
      console.error('PDF文件请求失败：文件路径为空，ID:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'PDF文件不存在' 
      });
    }
    
    // 验证文件路径安全性（防止路径遍历攻击）
    // 获取上传目录路径（与upload.js保持一致）
    const uploadsDir = process.env.UPLOADS_PATH || 
                       (process.env.NODE_ENV === 'production' ? '/data/uploads' : path.resolve(__dirname, '../../backend/uploads'));
    
    console.log('PDF文件请求 - 环境信息:', {
      'NODE_ENV': process.env.NODE_ENV || '未设置',
      'UPLOADS_PATH': process.env.UPLOADS_PATH || '未设置',
      '数据库中的file_path': item.file_path,
      '计算的上传目录': uploadsDir
    });
    
    // 尝试多个可能的文件路径
    const possiblePaths = [];
    
    // 提取文件名（用于从旧路径迁移）
    const fileName = path.basename(item.file_path);
    
    // 1. 如果file_path是绝对路径
    if (path.isAbsolute(item.file_path)) {
      // 先尝试直接使用（可能是有效的绝对路径）
      possiblePaths.push({
        path: item.file_path,
        reason: '绝对路径（数据库存储）'
      });
      
      // 如果绝对路径指向旧的临时目录，尝试提取文件名在Volume中查找
      if (item.file_path.includes('/app/backend/uploads/') || 
          item.file_path.includes('/backend/uploads/')) {
        possiblePaths.push({
          path: path.join(uploadsDir, fileName),
          reason: '从旧路径提取文件名（迁移场景）'
        });
      }
    }
    
    // 2. 作为相对路径，相对于uploadsDir
    possiblePaths.push({
      path: path.join(uploadsDir, item.file_path),
      reason: '相对路径（相对于上传目录）'
    });
    
    // 3. 如果file_path看起来像文件名（只有文件名，没有目录），尝试直接在上传目录中查找
    if (!item.file_path.includes('/') && !item.file_path.includes('\\')) {
      possiblePaths.push({
        path: path.join(uploadsDir, item.file_path),
        reason: '仅文件名（在上传目录中查找）'
      });
    }
    
    // 4. 尝试使用文件名（从任何路径中提取）
    if (fileName !== item.file_path) {
      possiblePaths.push({
        path: path.join(uploadsDir, fileName),
        reason: '提取文件名（兼容旧路径）'
      });
    }
    
    // 5. 尝试生产环境路径（如果当前不是生产环境）
    if (process.env.NODE_ENV !== 'production' && !process.env.UPLOADS_PATH) {
      possiblePaths.push({
        path: path.join('/data/uploads', item.file_path),
        reason: '生产环境路径（回退尝试）'
      });
    }
    
    // 尝试每个可能的路径
    let resolvedFilePath = null;
    let foundPath = null;
    
    for (const attempt of possiblePaths) {
      try {
        const normalizedPath = path.normalize(attempt.path);
        const resolvedPath = path.resolve(normalizedPath);
        const resolvedUploadsDir = path.resolve(uploadsDir);
        
        // 安全检查：确保路径在uploads目录内
        if (!resolvedPath.startsWith(resolvedUploadsDir)) {
          console.warn(`路径安全检查失败 (${attempt.reason}):`, {
            resolvedPath,
            resolvedUploadsDir
          });
          continue;
        }
        
        // 检查文件是否存在
        await fs.access(resolvedPath);
        resolvedFilePath = resolvedPath;
        foundPath = attempt;
        console.log(`✓ 找到文件 (${attempt.reason}):`, resolvedPath);
        break;
      } catch (error) {
        console.log(`✗ 文件不存在 (${attempt.reason}):`, attempt.path, error.message);
        continue;
      }
    }
    
    // 如果所有路径都失败
    if (!resolvedFilePath) {
      console.error('PDF文件未找到，尝试的路径:', possiblePaths.map(p => p.path));
      console.error('请检查:');
      console.error('1. Volume是否正确挂载到 /data/uploads');
      console.error('2. NODE_ENV是否设置为 production');
      console.error('3. 文件是否存在于Volume中');
      console.error('4. 数据库中的file_path是否正确');
      
      // 返回更详细的错误信息，帮助前端显示友好的错误提示
      return res.status(404).json({ 
        success: false, 
        error: 'MissingPDF',
        message: 'PDF文件未找到',
        details: {
          itemId: id,
          itemTitle: item.title || '未知文档',
          attemptedPaths: possiblePaths.map(p => ({ path: p.path, reason: p.reason })),
          uploadsDir,
          file_path: item.file_path,
          nodeEnv: process.env.NODE_ENV || '未设置',
          suggestion: '文件可能已被删除、路径不正确，或Volume未正确挂载。请运行 npm run check-pdfs 检查所有PDF文件状态。'
        }
      });
    }
    
    // 获取文件统计信息
    const stat = await fs.stat(resolvedFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    // 添加 HTTP 缓存头（减少重复请求）
    const etag = `"${id}-${stat.mtime.getTime()}-${fileSize}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1小时缓存
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    
    // 检查条件请求（If-None-Match）
    if (req.headers['if-none-match'] === etag) {
      console.log('PDF文件未修改，返回304:', id);
      return res.status(304).end();
    }
    
    // 检查条件请求（If-Modified-Since）
    if (req.headers['if-modified-since']) {
      const ifModifiedSince = new Date(req.headers['if-modified-since']);
      if (stat.mtime <= ifModifiedSince) {
        console.log('PDF文件未修改（基于时间），返回304:', id);
        return res.status(304).end();
      }
    }
    
    // 设置响应头
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(resolvedFilePath)}"`);
    
    console.log('返回PDF文件:', {
      id,
      filePath: resolvedFilePath,
      foundVia: foundPath?.reason,
      fileSize,
      hasRange: !!range,
      etag
    });
    
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = await fs.open(resolvedFilePath, 'r');
      const stream = file.createReadStream({ start, end });
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      
      stream.pipe(res);
    } else {
      // 完整文件传输
      res.setHeader('Content-Length', fileSize);
      res.sendFile(resolvedFilePath, (err) => {
        if (err) {
          console.error('发送PDF文件失败:', err);
          if (!res.headersSent) {
            res.status(500).json({ 
              success: false, 
              message: '发送PDF文件失败' 
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('获取PDF文件失败:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || '获取PDF文件失败' 
    });
  }
});

module.exports = router;

