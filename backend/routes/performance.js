/**
 * 性能数据 API 路由
 */

const express = require('express');
const router = express.Router();
const { getSummary, getPerformanceData, clearPerformanceData } = require('../middleware/performance');
const db = require('../services/db');

/**
 * 获取性能数据摘要
 */
router.get('/summary', (req, res) => {
  try {
    const apiSummary = getSummary();
    const dbPerformance = db.getQueryPerformance ? db.getQueryPerformance() : null;
    
    res.json({
      success: true,
      data: {
        api: apiSummary,
        database: dbPerformance
      }
    });
  } catch (error) {
    console.error('获取性能摘要失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取性能摘要失败'
    });
  }
});

/**
 * 获取性能数据
 */
router.get('/data', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const apiData = getPerformanceData(limit);
    const dbPerformance = db.getQueryPerformance ? db.getQueryPerformance() : null;
    
    res.json({
      success: true,
      data: {
        api: apiData,
        database: dbPerformance
      }
    });
  } catch (error) {
    console.error('获取性能数据失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取性能数据失败'
    });
  }
});

/**
 * 清除性能数据
 */
router.post('/clear', (req, res) => {
  try {
    clearPerformanceData();
    res.json({
      success: true,
      message: '性能数据已清除'
    });
  } catch (error) {
    console.error('清除性能数据失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '清除性能数据失败'
    });
  }
});

module.exports = router;

