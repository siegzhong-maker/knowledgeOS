const { callDeepSeekAPI } = require('./ai');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

/**
 * 将长内容分块（智能分块，尽量在段落边界分割）
 * @param {string} content - 原始内容
 * @param {number} chunkSize - 每块的大小（字符数）
 * @param {number} overlap - 块之间的重叠大小（字符数）
 * @returns {Array<{text: string, startIndex: number, endIndex: number}>} 分块数组
 */
function splitContentIntoChunks(content, chunkSize = 20000, overlap = 1000) {
  if (content.length <= chunkSize) {
    return [{ text: content, startIndex: 0, endIndex: content.length }];
  }
  
  const chunks = [];
  let startIndex = 0;
  
  while (startIndex < content.length) {
    let endIndex = Math.min(startIndex + chunkSize, content.length);
    
    // 如果不在文档末尾，尝试在段落边界处分割
    if (endIndex < content.length) {
      // 向前查找段落分隔符（双换行、标题标记等）
      const searchStart = Math.max(endIndex - 500, startIndex);
      const segment = content.substring(searchStart, endIndex);
      
      // 查找段落分隔符
      const paragraphBreak = segment.lastIndexOf('\n\n');
      const titleBreak = segment.lastIndexOf('\n#');
      const listBreak = segment.lastIndexOf('\n-');
      const numBreak = segment.lastIndexOf('\n1.');
      
      // 找到最合适的分割点
      let bestBreak = -1;
      if (paragraphBreak > segment.length - 200) bestBreak = searchStart + paragraphBreak;
      else if (titleBreak > segment.length - 200) bestBreak = searchStart + titleBreak;
      else if (listBreak > segment.length - 200) bestBreak = searchStart + listBreak;
      else if (numBreak > segment.length - 200) bestBreak = searchStart + numBreak;
      
      if (bestBreak > searchStart) {
        endIndex = bestBreak + 2; // 包含分隔符
      }
    }
    
    chunks.push({
      text: content.substring(startIndex, endIndex),
      startIndex,
      endIndex
    });
    
    // 下一次从当前块结束位置减去重叠部分开始
    startIndex = Math.max(endIndex - overlap, startIndex + 1);
    
    // 避免无限循环
    if (startIndex >= endIndex) {
      startIndex = endIndex;
    }
  }
  
  return chunks;
}

/**
 * 从文档内容中提取知识点（主函数，处理分块逻辑）
 * @param {string} content - 文档内容
 * @param {string} sourceItemId - 来源文档ID
 * @param {number} sourcePage - 来源页码（可选）
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<Array>} 提取的知识点数组
 */
async function extractKnowledgeFromContent(content, sourceItemId, sourcePage = null, userApiKey = null) {
  console.log('[提取] extractKnowledgeFromContent 开始', {
    sourceItemId,
    sourcePage,
    contentLength: content ? content.length : 0,
    hasUserApiKey: !!userApiKey,
    userApiKeyPreview: userApiKey ? `${userApiKey.substring(0, 8)}...` : 'none',
    contentPreview: content ? content.substring(0, 500) : 'null'
  });
  
  if (!content || content.trim().length === 0) {
    console.warn('[提取] ⚠️ 内容为空，返回空数组', { sourceItemId });
    return [];
  }

  // 内容预处理：清理智能纪要中的格式干扰
  let cleanedContent = content;
  const originalLength = content.length;
  let preprocessingLog = {
    removedPatterns: [],
    removedLength: 0,
    finalLength: originalLength
  };
  
  // 移除智能纪要中常见的非内容部分
  const patternsToRemove = [
    {
      pattern: /智能纪要权益介绍[^]*?该内容不支持导出查看[^]*?/g,
      description: '智能纪要权益介绍部分'
    },
    {
      pattern: /智能纪要由AI生成[^]*?请谨慎甄别后使用[^]*?/g,
      description: 'AI生成免责声明'
    },
    {
      pattern: /\[该内容不支持导出查看\]/g,
      description: '不支持导出标记'
    },
    {
      pattern: /权益介绍[^]*?不支持导出/g,
      description: '权益介绍段落'
    },
    {
      pattern: /^[\s\n]*智能纪要[^\n]*\n+/gm,
      description: '文档头部标题重复'
    },
    {
      pattern: /\n{3,}/g,
      description: '多余空行'
    }
  ];
  
  patternsToRemove.forEach(({ pattern, description }) => {
    const beforeLength = cleanedContent.length;
    cleanedContent = cleanedContent.replace(pattern, '');
    const removedLength = beforeLength - cleanedContent.length;
    if (removedLength > 0) {
      preprocessingLog.removedPatterns.push({
        description,
        removedLength
      });
      preprocessingLog.removedLength += removedLength;
      console.log('[提取] 清理格式干扰', {
        sourceItemId,
        description,
        removedLength,
        remainingLength: cleanedContent.length
      });
    }
  });
  
  // 清理首尾空白
  cleanedContent = cleanedContent.trim();
  preprocessingLog.finalLength = cleanedContent.length;
  
  // 记录预处理结果
  console.log('[提取] 内容预处理完成', {
    sourceItemId,
    originalLength,
    cleanedLength: cleanedContent.length,
    removedLength: preprocessingLog.removedLength,
    removedPatterns: preprocessingLog.removedPatterns,
    reductionPercent: originalLength > 0 
      ? ((preprocessingLog.removedLength / originalLength) * 100).toFixed(2) + '%'
      : '0%'
  });
  
  // 检查清理后的内容是否仍然有效
  const minContentLength = 100;
  if (cleanedContent.length < minContentLength) {
    console.warn('[提取] ⚠️ 清理后内容过短，可能不适合提取', {
      sourceItemId,
      originalLength,
      cleanedLength: cleanedContent.length,
      minRequiredLength: minContentLength,
      removedLength: preprocessingLog.removedLength,
      contentPreview: cleanedContent.substring(0, 300),
      recommendation: '文档内容可能主要是格式信息，缺少实际内容。建议检查原始文档。'
    });
    // 如果清理后内容过短，但原始内容足够，说明清理过度，使用原始内容
    if (originalLength >= minContentLength) {
      console.warn('[提取] ⚠️ 检测到清理过度，使用原始内容', {
        sourceItemId,
        originalLength,
        cleanedLength: cleanedContent.length
      });
      cleanedContent = content.trim();
      preprocessingLog = {
        removedPatterns: [],
        removedLength: 0,
        finalLength: cleanedContent.length
      };
    }
  }

  // 检查是否需要分块处理（内容超过20000字符时）
  const CHUNK_SIZE = 20000; // 每块大小，留出API响应空间
  const CHUNK_OVERLAP = 1000; // 块之间重叠，避免知识点被截断
  
  let allKnowledgeItems = [];
  
  if (cleanedContent.length <= CHUNK_SIZE) {
    // 内容不长，直接提取
    allKnowledgeItems = await extractKnowledgeFromChunk(
      cleanedContent,
      sourceItemId,
      0,
      userApiKey,
      sourcePage
    );
  } else {
    // 内容过长，分块提取
    console.log('[提取] 内容过长，开始分块提取', {
      sourceItemId,
      originalContentLength: content.length,
      cleanedContentLength: cleanedContent.length,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
      estimatedChunks: Math.ceil(cleanedContent.length / (CHUNK_SIZE - CHUNK_OVERLAP))
    });
    
    const chunks = splitContentIntoChunks(cleanedContent, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log('[提取] 内容分块完成', {
      sourceItemId,
      totalChunks: chunks.length,
      chunks: chunks.map((chunk, index) => ({
        index,
        length: chunk.text.length,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
        preview: chunk.text.substring(0, 100)
      }))
    });
    
    // 逐个处理每个块
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log('[提取] 处理内容块', {
        sourceItemId,
        chunkIndex: i + 1,
        totalChunks: chunks.length,
        chunkLength: chunk.text.length,
        chunkStart: chunk.startIndex,
        chunkEnd: chunk.endIndex,
        progress: `${i + 1}/${chunks.length}`
      });
      
      try {
        const chunkKnowledgeItems = await extractKnowledgeFromChunk(
          chunk.text,
          sourceItemId,
          i,
          userApiKey,
          sourcePage
        );
        
        console.log('[提取] 块提取完成', {
          sourceItemId,
          chunkIndex: i + 1,
          totalChunks: chunks.length,
          extractedCount: chunkKnowledgeItems.length,
          totalExtractedSoFar: allKnowledgeItems.length + chunkKnowledgeItems.length,
          progress: `${i + 1}/${chunks.length}`
        });
        
        allKnowledgeItems = allKnowledgeItems.concat(chunkKnowledgeItems);
        
        // 块之间稍作延迟，避免API频率限制
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (chunkError) {
        console.error('[提取] ❌ 块提取失败', {
          sourceItemId,
          chunkIndex: i + 1,
          totalChunks: chunks.length,
          error: chunkError.message,
          errorName: chunkError.name,
          chunkLength: chunk.text.length,
          isTimeout: chunkError.message.includes('timeout') || chunkError.message.includes('超时')
        });
        // 某个块失败，继续处理其他块
        // 不中断整个提取过程
      }
    }
    
    console.log('[提取] 所有块处理完成', {
      sourceItemId,
      totalChunks: chunks.length,
      totalExtractedCount: allKnowledgeItems.length,
      averagePerChunk: chunks.length > 0 ? (allKnowledgeItems.length / chunks.length).toFixed(1) : 0,
      recommendation: allKnowledgeItems.length === 0 
        ? '所有块提取都未生成知识点，请检查文档内容或查看详细日志' 
        : `成功从 ${chunks.length} 个块中提取 ${allKnowledgeItems.length} 个知识点`
    });
  }
  
  return allKnowledgeItems;
}

/**
 * 从单个内容块提取知识点（内部函数，只处理单个块）
 * @param {string} contentChunk - 内容块（已经过预处理）
 * @param {string} sourceItemId - 来源文档ID
 * @param {number} chunkIndex - 块索引
 * @param {string} userApiKey - 用户API Key（可选）
 * @param {number} sourcePage - 来源页码（可选）
 * @returns {Promise<Array>} 提取的知识点数组
 */
async function extractKnowledgeFromChunk(contentChunk, sourceItemId, chunkIndex, userApiKey = null, sourcePage = null) {
  const chunkId = chunkIndex > 0 ? `${sourceItemId}-chunk${chunkIndex}` : sourceItemId;
  
  console.log('[提取] extractKnowledgeFromChunk 开始', {
    sourceItemId,
    chunkIndex,
    chunkId,
    chunkLength: contentChunk ? contentChunk.length : 0,
    hasUserApiKey: !!userApiKey,
    chunkPreview: contentChunk ? contentChunk.substring(0, 200) : 'null'
  });
  
  if (!contentChunk || contentChunk.trim().length === 0) {
    console.warn('[提取] ⚠️ 内容块为空，返回空数组', { sourceItemId, chunkIndex });
    return [];
  }

  // 清理首尾空白（预处理应该已经完成，但再做一次确保）
  let cleanedChunk = contentChunk.trim();
  
  // 限制单个块的长度（双重保险，避免超出API限制）
  const maxLength = 25000; // 单个块的最大长度，留出API响应空间
  const contentSample = cleanedChunk.length > maxLength 
    ? cleanedChunk.substring(0, maxLength) + '\n\n[内容已截断...]'
    : cleanedChunk;
  
  if (cleanedChunk.length > maxLength) {
    console.warn('[提取] ⚠️ 内容块过长，需要截断', {
      sourceItemId,
      chunkIndex,
      originalLength: cleanedChunk.length,
      truncatedLength: maxLength
    });
  }

  console.log('[提取] 准备调用AI API（块）', {
    sourceItemId,
    chunkIndex,
    chunkLength: cleanedChunk.length,
    sampleLength: contentSample.length,
    isTruncated: cleanedChunk.length > maxLength
  });

  const messages = [
    {
      role: 'system',
      content: `你是一个知识提取专家。请从以下文档内容中提取关键知识点。

提取要求：
1. 提取核心概念、要点、规则、方法等关键信息
2. 每个知识点应该独立、完整、有意义
3. 为每个知识点生成简洁的标题和详细描述
4. 评估每个知识点的置信度（0-100分）
5. 从内容中提取关键结论（2-5个）
6. 为每个知识点生成相关标签（2-5个）

输出格式（JSON数组）：
[
  {
    "title": "知识点标题",
    "content": "知识点详细内容",
    "summary": "简短摘要（可选）",
    "keyConclusions": ["关键结论1", "关键结论2"],
    "confidence": 85,
    "tags": ["标签1", "标签2"],
    "sourceExcerpt": "原文片段"
  }
]

只返回JSON数组，不要其他文字。`
    },
    {
      role: 'user',
      content: `请从以下文档内容中提取关键知识点：\n\n${contentSample}`
    }
  ];

  try {
    console.log('[提取] 调用 DeepSeek API（块）', { 
      sourceItemId,
      chunkIndex,
      maxTokens: 4000,
      contentLength: cleanedChunk.length,
      sampleLength: contentSample.length,
      timeout: 180000,
      hasUserApiKey: !!userApiKey
    });
    
    let response;
    try {
      response = await callDeepSeekAPI(messages, {
        max_tokens: 4000,
        temperature: 0.3,
        userApiKey,
        timeout: 180000 // 知识提取任务使用180秒（3分钟）超时，处理大型文档
      });
    } catch (apiError) {
      // 详细记录API调用错误
      console.error('[提取] ❌ DeepSeek API调用失败（块）', {
        sourceItemId,
        chunkIndex,
        error: apiError.message,
        errorName: apiError.name,
        hasUserApiKey: !!userApiKey,
        chunkLength: cleanedChunk.length,
        sampleLength: contentSample.length,
        possibleCauses: {
          apiKey: apiError.message.includes('API Key') ? 'API Key未配置或无效' : null,
          network: apiError.message.includes('网络') || apiError.message.includes('timeout') || apiError.message.includes('超时') ? '网络连接问题或超时' : null,
          rateLimit: apiError.message.includes('频率') || apiError.message.includes('429') ? 'API请求频率过高' : null,
          contentSize: cleanedChunk.length > 20000 ? '内容块过大，可能需要进一步分块' : null
        }
      });
      throw apiError; // 重新抛出，让上层处理
    }
    
    if (!response || response.trim().length === 0) {
      console.error('[提取] ❌ AI API返回空响应', {
        sourceItemId,
        responseType: typeof response,
        responseLength: response ? response.length : 0
      });
      throw new Error('AI API返回空响应');
    }
    
    console.log('[提取] AI API 调用成功（块）', {
      sourceItemId,
      chunkIndex,
      responseLength: response ? response.length : 0,
      responsePreview: response ? response.substring(0, 500) : 'null',
      fullResponse: response ? response.substring(0, 3000) : 'null' // 记录前3000字符用于调试
    });

    // 尝试解析JSON响应
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let jsonString = jsonMatch[0];
      console.log('[提取] 找到JSON数组（块）', {
        sourceItemId,
        chunkIndex,
        jsonStringLength: jsonString.length,
        jsonPreview: jsonString.substring(0, 300)
      });
      
      // 尝试解析JSON，如果失败则尝试修复
      let knowledgeItems;
      try {
        knowledgeItems = JSON.parse(jsonString);
        console.log('[提取] ✅ JSON解析成功（块）', {
          sourceItemId,
          chunkIndex,
          knowledgeItemsCount: Array.isArray(knowledgeItems) ? knowledgeItems.length : 0,
          isArray: Array.isArray(knowledgeItems)
        });
      } catch (parseError) {
        console.warn('[提取] ⚠️ 首次JSON解析失败，尝试修复', {
          sourceItemId,
          error: parseError.message,
          jsonStringLength: jsonString.length
        });
        // 如果解析失败，尝试修复常见的JSON问题
        try {
          // 方法1：清理字符串值外的控制字符（在JSON结构中的换行、制表等）
          // 使用更保守的方法：只清理明显不在字符串值中的控制字符
          jsonString = jsonString
            // 移除对象/数组结束前的换行和空格
            .replace(/\n\s*(?=[}\]])/g, '')
            // 移除对象/数组开始后的换行和空格
            .replace(/(?<=[{\[])\s*\n/g, '')
            // 将逗号后的换行和空格替换为单个空格
            .replace(/,\s*\n\s*/g, ', ')
            // 将冒号后的换行和空格替换为单个空格
            .replace(/:\s*\n\s*/g, ': ');
          
          knowledgeItems = JSON.parse(jsonString);
        } catch (secondError) {
          // 如果还是失败，尝试使用eval（不推荐但作为最后手段）
          // 或者尝试手动修复字符串值中的控制字符
          try {
            // 使用更安全的方法：逐字符处理，识别字符串边界
            let fixedJson = '';
            let inString = false;
            let escapeNext = false;
            
            for (let i = 0; i < jsonString.length; i++) {
              const char = jsonString[i];
              
              if (escapeNext) {
                fixedJson += char;
                escapeNext = false;
                continue;
              }
              
              if (char === '\\') {
                escapeNext = true;
                fixedJson += char;
                continue;
              }
              
              if (char === '"') {
                inString = !inString;
                fixedJson += char;
                continue;
              }
              
              if (inString) {
                // 在字符串值中，转义控制字符
                if (char === '\n') fixedJson += '\\n';
                else if (char === '\r') fixedJson += '\\r';
                else if (char === '\t') fixedJson += '\\t';
                else if (char === '\f') fixedJson += '\\f';
                else if (char === '\b') fixedJson += '\\b';
                else fixedJson += char;
              } else {
                // 在JSON结构中，移除控制字符
                if (!/[\n\r\t\f\b]/.test(char)) {
                  fixedJson += char;
                }
              }
            }
            
            knowledgeItems = JSON.parse(fixedJson);
          } catch (thirdError) {
            // 最后尝试：使用更宽松的JSON清理
            try {
              // 移除所有未转义的控制字符（除了在已转义的序列中）
              let cleanedJson = jsonString
                .replace(/(?<!\\)\n/g, '\\n')  // 转义未转义的换行
                .replace(/(?<!\\)\r/g, '\\r')  // 转义未转义的回车
                .replace(/(?<!\\)\t/g, '\\t')  // 转义未转义的制表符
                .replace(/(?<!\\)\f/g, '\\f')  // 转义未转义的换页
                .replace(/(?<!\\)\b/g, '\\b'); // 转义未转义的退格
              
              knowledgeItems = JSON.parse(cleanedJson);
            } catch (finalError) {
              console.error('[提取] ❌ JSON解析完全失败', {
                sourceItemId,
                originalResponsePreview: response.substring(0, 1000),
                jsonStringPreview: jsonString.substring(0, 1000),
                errors: {
                  first: parseError.message,
                  second: secondError.message,
                  third: thirdError.message,
                  final: finalError.message
                }
              });
              // 返回空数组而不是抛出错误，让提取流程继续
              return [];
            }
          }
        }
      }
      
      // 验证和清洗数据
      if (!Array.isArray(knowledgeItems)) {
        console.error('[提取] ❌ 解析结果不是数组（块）', {
          sourceItemId,
          chunkIndex,
          knowledgeItemsType: typeof knowledgeItems,
          knowledgeItems,
          responsePreview: response ? response.substring(0, 1000) : 'null'
        });
        return [];
      }
      
      const beforeFilter = knowledgeItems.length;
      
      // 详细记录每个知识点验证过程
      const validationDetails = knowledgeItems.map((item, index) => {
        const hasTitle = !!item.title && item.title.trim().length > 0;
        const hasContent = !!item.content && item.content.trim().length > 0;
        const titleLength = item.title ? item.title.length : 0;
        const contentLength = item.content ? item.content.length : 0;
        const isValid = hasTitle && hasContent;
        
        if (!isValid) {
          console.warn('[提取] ⚠️ 知识点验证失败（块）', {
            sourceItemId,
            chunkIndex,
            index,
            hasTitle,
            hasContent,
            titleLength,
            contentLength,
            itemPreview: {
              title: item.title ? item.title.substring(0, 50) : 'null',
              content: item.content ? item.content.substring(0, 100) : 'null'
            }
          });
        }
        
        return {
          index,
          hasTitle,
          hasContent,
          titleLength,
          contentLength,
          isValid
        };
      });
      
      const filtered = knowledgeItems.filter(item => item.title && item.content);
      const afterFilter = filtered.length;
      
      console.log('[提取] 数据验证和清洗（块）', {
        sourceItemId,
        chunkIndex,
        beforeFilter,
        afterFilter,
        filteredOut: beforeFilter - afterFilter,
        validationDetails,
        invalidItems: validationDetails.filter(v => !v.isValid).map(v => ({
          index: v.index,
          reason: !v.hasTitle ? '缺少标题' : !v.hasContent ? '缺少内容' : '未知'
        }))
      });
      
      if (afterFilter === 0 && beforeFilter > 0) {
        console.error('[提取] ❌ 所有知识点都被过滤掉', {
          sourceItemId,
          originalCount: beforeFilter,
          filteredCount: afterFilter,
          reasons: validationDetails.map(v => ({
            index: v.index,
            hasTitle: v.hasTitle,
            hasContent: v.hasContent
          }))
        });
      }
      
      const cleaned = filtered.map(item => ({
        title: item.title.trim(),
        content: item.content.trim(),
        summary: item.summary ? item.summary.trim() : null,
        keyConclusions: Array.isArray(item.keyConclusions) ? item.keyConclusions : [],
        confidence: Math.min(Math.max(item.confidence || 70, 0), 100),
        tags: Array.isArray(item.tags) ? item.tags.slice(0, 5) : [],
        sourceExcerpt: item.sourceExcerpt ? item.sourceExcerpt.trim() : null,
        sourceItemId,
        sourcePage
      }));
      
      console.log('[提取] ✅ 提取完成', {
        sourceItemId,
        extractedCount: cleaned.length,
        sampleTitles: cleaned.slice(0, 3).map(item => item.title),
        allTitles: cleaned.map(item => item.title?.substring(0, 50))
      });
      
      // 如果清理后没有知识点，记录诊断信息
      if (cleaned.length === 0) {
        console.warn('[提取] ⚠️ 提取完成但未生成任何知识点（块）', {
          sourceItemId,
          chunkIndex,
          chunkLength: cleanedChunk.length,
          sampleLength: contentSample.length,
          contentPreview: cleanedChunk.substring(0, 500),
          possibleReasons: [
            '当前块内容可能主要是格式信息或免责声明',
            '内容块可能太短或质量不高',
            'AI可能判断当前块不适合提取知识点',
            '内容块可能不包含可提取的知识点'
          ],
          recommendation: '继续处理其他块，或检查原始文档内容'
        });
      }
      
      console.log('[提取] ✅ 块提取完成', {
        sourceItemId,
        chunkIndex,
        extractedCount: cleaned.length,
        sampleTitles: cleaned.slice(0, 3).map(item => item.title)
      });
      
      return cleaned;
    }

    // 如果解析失败，返回空数组并记录详细诊断信息
    const diagnosticInfo = {
      sourceItemId,
      responseLength: response.length,
      responsePreview: response.substring(0, 500),
      fullResponse: response.substring(0, 3000), // 记录前3000字符以便调试
      hasJsonArray: /\[[\s\S]*\]/.test(response),
      hasJsonObject: /\{[\s\S]*\}/.test(response),
      containsErrorKeywords: {
        error: response.includes('错误') || response.includes('error') || response.includes('Error'),
        apiKey: response.includes('API Key') || response.includes('unauthorized') || response.includes('401'),
        quota: response.includes('quota') || response.includes('额度') || response.includes('limit'),
        rateLimit: response.includes('429') || response.includes('rate limit') || response.includes('频率')
      },
      possibleReasons: []
    };
    
    // 分析可能的原因
    if (diagnosticInfo.containsErrorKeywords.apiKey) {
      diagnosticInfo.possibleReasons.push('API Key无效或未配置');
      console.error('[提取] ❌ 检测到API Key错误', {
        sourceItemId,
        responsePreview: response.substring(0, 500)
      });
      throw new Error('API Key无效或未配置，请检查设置');
    }
    
    if (diagnosticInfo.containsErrorKeywords.quota || diagnosticInfo.containsErrorKeywords.rateLimit) {
      diagnosticInfo.possibleReasons.push('API配额用尽或请求频率过高');
      console.error('[提取] ❌ 检测到API配额或频率限制错误', {
        sourceItemId,
        responsePreview: response.substring(0, 500)
      });
      throw new Error('API配额用尽或请求频率过高，请稍后重试');
    }
    
    if (diagnosticInfo.containsErrorKeywords.error) {
      diagnosticInfo.possibleReasons.push('AI返回了错误信息');
      console.error('[提取] ❌ AI 返回了错误信息', {
        sourceItemId,
        errorMessage: response.substring(0, 1000)
      });
    }
    
    if (!diagnosticInfo.hasJsonArray && !diagnosticInfo.hasJsonObject) {
      diagnosticInfo.possibleReasons.push('AI响应不包含JSON格式数据');
      console.warn('[提取] ⚠️ 响应中没有找到JSON数组或对象', diagnosticInfo);
    } else if (diagnosticInfo.hasJsonObject && !diagnosticInfo.hasJsonArray) {
      diagnosticInfo.possibleReasons.push('AI返回了单个JSON对象而不是数组');
      console.warn('[提取] ⚠️ AI返回了单个对象而不是数组', {
        sourceItemId,
        responsePreview: response.substring(0, 500)
      });
      // 尝试将单个对象转换为数组
      try {
        const jsonObjectMatch = response.match(/\{[\s\S]*\}/);
        if (jsonObjectMatch) {
          const jsonObject = JSON.parse(jsonObjectMatch[0]);
          console.log('[提取] 尝试将单个对象转换为数组', {
            sourceItemId,
            objectKeys: Object.keys(jsonObject)
          });
          // 如果对象包含知识点相关字段，尝试转换
          if (jsonObject.title || jsonObject.content) {
            return [jsonObject];
          }
        }
      } catch (e) {
        console.warn('[提取] 转换对象失败', { sourceItemId, error: e.message });
      }
    }
    
    // 检查响应是否包含非JSON文本说明
    if (response.length > 0 && !diagnosticInfo.hasJsonArray && !diagnosticInfo.hasJsonObject) {
      diagnosticInfo.possibleReasons.push('AI返回了纯文本说明而非JSON格式');
      console.warn('[提取] ⚠️ 响应中没有找到JSON数组', diagnosticInfo);
    }
    
    // 如果没有识别出原因，添加通用原因
    if (diagnosticInfo.possibleReasons.length === 0) {
      diagnosticInfo.possibleReasons.push('AI响应格式不符合预期，无法解析知识点');
    }
    
    console.warn('[提取] ⚠️ 无法从AI响应中提取知识点', {
      ...diagnosticInfo,
      recommendation: '请查看Railway日志中的完整AI响应以获取更多信息'
    });
    
    return [];
  } catch (error) {
    // 增强错误日志，特别针对Railway环境
    const errorDetails = {
      sourceItemId,
      chunkIndex,
      error: error.message,
      errorName: error.name,
      stack: error.stack,
      chunkLength: cleanedChunk ? cleanedChunk.length : 0,
      sampleLength: contentSample ? contentSample.length : 0,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        isRailway: !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID
      },
      errorType: 'unknown',
      possibleCauses: [],
      recommendations: []
    };
    
    // 分类错误类型
    if (error.message.includes('API Key') || error.message.includes('未配置')) {
      errorDetails.errorType = 'apiKey';
      errorDetails.possibleCauses.push('API Key 未配置或无效');
      errorDetails.recommendations.push('请在设置中配置DeepSeek API Key');
      errorDetails.recommendations.push('或在前端设置中配置个人API Key');
    } else if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('timeout')) {
      errorDetails.errorType = 'network';
      errorDetails.possibleCauses.push('网络连接问题');
      errorDetails.possibleCauses.push('Railway可能无法访问api.deepseek.com');
      errorDetails.recommendations.push('检查网络连接');
      errorDetails.recommendations.push('如果是Railway部署，检查服务网络配置');
    } else if (error.message.includes('429') || error.message.includes('频率') || error.message.includes('quota')) {
      errorDetails.errorType = 'rateLimit';
      errorDetails.possibleCauses.push('API 请求频率过高');
      errorDetails.possibleCauses.push('API配额可能已用尽');
      errorDetails.recommendations.push('请稍后重试');
      errorDetails.recommendations.push('检查API配额使用情况');
    } else if (error.message.includes('内容') || error.message.includes('空响应')) {
      errorDetails.errorType = 'content';
      errorDetails.possibleCauses.push('文档内容问题');
      errorDetails.possibleCauses.push('AI返回了空响应或无效响应');
      errorDetails.recommendations.push('检查文档内容是否包含实际知识点');
      errorDetails.recommendations.push('查看Railway日志中的AI完整响应');
    } else {
      errorDetails.possibleCauses.push('未知错误');
      errorDetails.recommendations.push('查看Railway日志中的完整错误堆栈');
      errorDetails.recommendations.push('访问 /api/diagnose/extraction 进行诊断');
    }
    
    console.error('[提取] ❌ 知识提取失败', errorDetails);
    
    // 根据错误类型提供更明确的错误信息
    let errorMessage = `知识提取失败: ${error.message}`;
    if (errorDetails.errorType === 'apiKey') {
      errorMessage = '知识提取失败：API Key未配置或无效。请在设置中配置DeepSeek API Key，或在前端设置中配置个人API Key。';
    } else if (errorDetails.errorType === 'network') {
      errorMessage = '知识提取失败：网络连接问题。请检查网络连接或稍后重试。';
    } else if (errorDetails.errorType === 'rateLimit') {
      errorMessage = '知识提取失败：API请求频率过高或配额用尽。请稍后重试或检查API配额。';
    } else if (errorDetails.errorType === 'content') {
      errorMessage = `知识提取失败：${error.message}。请检查文档内容或查看日志获取更多信息。`;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * 保存知识点到数据库
 * @param {Object} knowledgeItem - 知识点对象
 * @param {string} knowledgeBaseId - 知识库ID
 * @returns {Promise<string>} 保存的知识点ID
 */
async function saveKnowledgeItem(knowledgeItem, knowledgeBaseId) {
  const id = `ki-${uuidv4().split('-')[0]}`;
  const now = Date.now();
  
  console.log('[保存] 开始保存知识点', {
    id,
    title: knowledgeItem.title?.substring(0, 50),
    knowledgeBaseId,
    hasTitle: !!knowledgeItem.title,
    hasContent: !!knowledgeItem.content,
    contentLength: knowledgeItem.content?.length || 0
  });
  
  // 验证数据完整性
  if (!knowledgeItem.title || !knowledgeItem.content) {
    const error = new Error('知识点数据不完整：缺少title或content');
    console.error('[保存] ❌ 数据验证失败', {
      id,
      hasTitle: !!knowledgeItem.title,
      hasContent: !!knowledgeItem.content,
      knowledgeItem
    });
    throw error;
  }
  
  // 所有提取的知识点都需要人工确认，不自动确认
  // 但根据置信度标记不同级别的提示信息
  const status = 'pending';
  const metadata = {};
  
  if (knowledgeItem.confidence >= 90) {
    // 高置信度标记，但仍需人工确认
    metadata.highConfidence = true;
    metadata.confidenceLevel = 'high';
  } else if (knowledgeItem.confidence >= 85) {
    // 中高置信度标记
    metadata.highConfidence = true;
    metadata.confidenceLevel = 'medium-high';
  } else {
    // 普通置信度
    metadata.highConfidence = false;
    metadata.confidenceLevel = 'normal';
  }

  // 使用新的子分类词向量距离分类算法
  let category = 'work';
  let subcategory_id = null;
  
  if (knowledgeItem.tags && Array.isArray(knowledgeItem.tags) && knowledgeItem.tags.length > 0) {
    try {
      // 获取所有子分类
      const subcategories = await db.all(
        `SELECT id, category, name, keywords FROM category_subcategories 
         ORDER BY category, order_index ASC`
      );
      
      if (subcategories.length > 0) {
        // 计算相似度
        let bestMatch = null;
        let bestSimilarity = 0;
        
        for (const subcat of subcategories) {
          const keywords = JSON.parse(subcat.keywords || '[]');
          let totalWeight = 0;
          
          knowledgeItem.tags.forEach(tag => {
            keywords.forEach(keyword => {
              if (tag === keyword) {
                totalWeight += 2; // 完全匹配权重2
              } else if (tag.includes(keyword) || keyword.includes(tag)) {
                totalWeight += 1; // 部分匹配权重1
              }
            });
          });
          
          const similarity = totalWeight / (keywords.length + knowledgeItem.tags.length);
          
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = subcat;
          }
        }
        
        // 如果相似度太低，使用默认分类的第一个子分类
        if (bestMatch && bestSimilarity >= 0.1) {
          category = bestMatch.category;
          subcategory_id = bestMatch.id;
        } else {
          // 使用work分类的第一个子分类
          const defaultSubcat = await db.get(
            `SELECT id, category FROM category_subcategories 
             WHERE category = 'work' 
             ORDER BY order_index ASC LIMIT 1`
          );
          if (defaultSubcat) {
            category = defaultSubcat.category;
            subcategory_id = defaultSubcat.id;
          }
        }
      } else {
        // 没有子分类，使用简单的标签映射
        const TAG_TO_CATEGORY_MAP = {
          '工作': 'work', '职场': 'work', '职业': 'work', '业务': 'work', '项目': 'work',
          '管理': 'work', '团队': 'work', '领导': 'work', '会议': 'work', '报告': 'work',
          '学习': 'learning', '教育': 'learning', '课程': 'learning', '培训': 'learning',
          '知识': 'learning', '技能': 'learning', '阅读': 'learning', '研究': 'learning',
          '学术': 'learning', '考试': 'learning', '笔记': 'learning',
          '娱乐': 'leisure', '游戏': 'leisure', '电影': 'leisure', '音乐': 'leisure',
          '旅行': 'leisure', '旅游': 'leisure', '运动': 'leisure', '健身': 'leisure',
          '美食': 'leisure', '购物': 'leisure', '兴趣': 'leisure', '爱好': 'leisure',
          '生活': 'life', '家庭': 'life', '健康': 'life', '医疗': 'life', '养生': 'life',
          '理财': 'life', '投资': 'life', '房产': 'life', '装修': 'life', '育儿': 'life',
          '情感': 'life', '人际关系': 'life', '社交': 'life'
        };
        const categoryCounts = { work: 0, learning: 0, leisure: 0, life: 0 };
        knowledgeItem.tags.forEach(tag => {
          const cat = TAG_TO_CATEGORY_MAP[tag];
          if (cat) categoryCounts[cat]++;
        });
        const maxCategory = Object.keys(categoryCounts).reduce((a, b) => 
          categoryCounts[a] > categoryCounts[b] ? a : b
        );
        category = categoryCounts[maxCategory] > 0 ? maxCategory : 'work';
      }
    } catch (error) {
      console.warn('分类失败，使用默认分类:', error.message);
      category = 'work';
    }
  }

  try {
    const insertParams = [
      id,
      knowledgeItem.title,
      knowledgeItem.content,
      knowledgeItem.summary || null,
      JSON.stringify(knowledgeItem.keyConclusions || []),
      knowledgeItem.sourceItemId,
      knowledgeItem.sourcePage || null,
      knowledgeItem.sourceExcerpt || null,
      knowledgeItem.confidence,
      status,
      category,
      subcategory_id,
      JSON.stringify(knowledgeItem.tags || []),
      knowledgeBaseId,
      now,
      now,
      JSON.stringify(metadata)
    ];
    
    console.log('[保存] 准备插入数据库', {
      id,
      title: knowledgeItem.title?.substring(0, 50),
      knowledgeBaseId,
      category,
      subcategory_id,
      paramsCount: insertParams.length
    });
    
    await db.run(
      `INSERT INTO personal_knowledge_items 
       (id, title, content, summary, key_conclusions, source_item_id, source_page, 
        source_excerpt, confidence_score, status, category, subcategory_id, tags, knowledge_base_id, 
        created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      insertParams
    );
    
    console.log('[保存] ✅ 数据库插入成功', {
      id,
      title: knowledgeItem.title?.substring(0, 50)
    });
  } catch (dbError) {
    // 增强数据库错误日志，特别针对PostgreSQL和Railway环境
    const errorDetails = {
      id,
      title: knowledgeItem.title?.substring(0, 50),
      error: dbError.message,
      errorCode: dbError.code,
      errorName: dbError.name,
      stack: dbError.stack,
      knowledgeBaseId,
      category,
      subcategory_id,
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        isPostgreSQL: !!process.env.DATABASE_URL || process.env.DB_TYPE === 'postgres',
        isRailway: !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID
      },
      // 记录可能导致错误的参数
      titleLength: knowledgeItem.title?.length,
      contentLength: knowledgeItem.content?.length,
      hasSummary: !!knowledgeItem.summary,
      confidence: knowledgeItem.confidence,
      possibleCauses: {
        connection: dbError.message.includes('connection') || dbError.message.includes('ECONNREFUSED') ? '数据库连接失败（Railway PostgreSQL可能未启动）' : null,
        tableMissing: dbError.message.includes('does not exist') || dbError.message.includes('no such table') ? '数据库表不存在（需要运行初始化脚本）' : null,
        constraint: dbError.message.includes('constraint') || dbError.message.includes('UNIQUE') ? '数据库约束冲突' : null,
        dataType: dbError.message.includes('type') || dbError.message.includes('format') ? '数据类型错误' : null
      }
    };
    
    console.error('[保存] ❌ 数据库插入失败', errorDetails);
    
    // 如果是表不存在错误，提供更明确的提示
    if (dbError.message.includes('does not exist') || dbError.message.includes('no such table')) {
      throw new Error(`保存知识点失败: 数据库表不存在。请在Railway上运行数据库初始化脚本。`);
    }
    
    throw new Error(`保存知识点失败: ${dbError.message}`);
  }

  // 如果知识点有关联的文档，标记文档为已提取
  if (knowledgeItem.sourceItemId) {
    try {
      console.log('[保存] 标记文档为已提取', {
        knowledgeItemId: id,
        sourceItemId: knowledgeItem.sourceItemId
      });
      
      // 使用兼容SQLite和PostgreSQL的语法
      // SQLite使用INTEGER，PostgreSQL使用BOOLEAN，但在db层会自动转换
      const DATABASE_URL = process.env.DATABASE_URL;
      const DB_TYPE = process.env.DB_TYPE;
      const isPostgreSQL = DATABASE_URL || DB_TYPE === 'postgres';
      
      if (isPostgreSQL) {
        await db.run(
          `UPDATE source_items SET knowledge_extracted = TRUE, updated_at = ? WHERE id = ?`,
          [now, knowledgeItem.sourceItemId]
        );
      } else {
        await db.run(
          `UPDATE source_items SET knowledge_extracted = 1, updated_at = ? WHERE id = ?`,
          [now, knowledgeItem.sourceItemId]
        );
      }
      
      console.log('[保存] ✅ 文档标记成功', {
        knowledgeItemId: id,
        sourceItemId: knowledgeItem.sourceItemId
      });
    } catch (error) {
      // 如果字段不存在或更新失败，只记录警告，不影响知识点保存
      console.warn('[保存] ⚠️ 标记文档为已提取失败', {
        knowledgeItemId: id,
        sourceItemId: knowledgeItem.sourceItemId,
        error: error.message,
        errorCode: error.code
      });
    }
  }

  console.log('[保存] ✅ 知识点保存完成', {
    id,
    title: knowledgeItem.title?.substring(0, 50)
  });
  
  return id;
}

/**
 * 计算两个知识点之间的相似度
 * @param {Object} item1 - 知识点1
 * @param {Object} item2 - 知识点2
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<number>} 相似度分数（0-100）
 */
async function calculateSimilarity(item1, item2, userApiKey = null) {
  // 标签匹配（权重20%）
  const tags1 = new Set(Array.isArray(item1.tags) ? item1.tags : JSON.parse(item1.tags || '[]'));
  const tags2 = new Set(Array.isArray(item2.tags) ? item2.tags : JSON.parse(item2.tags || '[]'));
  const commonTags = [...tags1].filter(tag => tags2.has(tag));
  const tagSimilarity = tags1.size > 0 || tags2.size > 0
    ? (commonTags.length / Math.max(tags1.size, tags2.size)) * 100
    : 0;

  // 分类匹配（权重10%）
  const categorySimilarity = item1.category === item2.category && item1.category
    ? 100
    : 0;

  // 快速路径：如果标签和分类相似度已经很高，跳过 AI 调用
  const fastScore = tagSimilarity * 0.2 + categorySimilarity * 0.1;
  if (fastScore >= 70) {
    // 如果快速评分已经达到70以上，直接返回，不调用 AI（更激进的优化）
    // 加上一些语义相似度估计（基于标签和分类的相似度）
    const estimatedSemantic = Math.min(100, fastScore * 1.2);
    return Math.round(estimatedSemantic * 0.7 + tagSimilarity * 0.2 + categorySimilarity * 0.1);
  }

  // 语义相似度（权重70%）- 只在必要时调用 AI
  let semanticSimilarity = 0;
  try {
    const content1 = `${item1.title} ${item1.content}`.substring(0, 2000);
    const content2 = `${item2.title} ${item2.content}`.substring(0, 2000);

    const messages = [
      {
        role: 'system',
        content: '你是一个相似度评估专家。请评估两个知识点之间的语义相似度，返回0-100的分数。只返回数字，不要其他文字。'
      },
      {
        role: 'user',
        content: `知识点1：${content1}\n\n知识点2：${content2}\n\n请评估这两个知识点的语义相似度（0-100分）：`
      }
    ];

    const response = await callDeepSeekAPI(messages, {
      max_tokens: 50,
      temperature: 0.1,
      userApiKey
    });

    const scoreMatch = response.match(/\d+/);
    if (scoreMatch) {
      semanticSimilarity = Math.min(Math.max(parseInt(scoreMatch[0]), 0), 100);
    }
  } catch (error) {
    // 如果错误是因为未配置API Key，使用基于文本相似度的简单计算
    if (error.message && error.message.includes('未配置DeepSeek API Key')) {
      // 使用简单的文本匹配作为后备方案
      const text1 = `${item1.title} ${item1.content}`.toLowerCase();
      const text2 = `${item2.title} ${item2.content}`.toLowerCase();
      const words1 = text1.split(/\s+/).filter(w => w.length > 1);
      const words2 = text2.split(/\s+/).filter(w => w.length > 1);
      const commonWords = words1.filter(w => words2.includes(w));
      const similarity = words1.length > 0 && words2.length > 0
        ? (commonWords.length / Math.max(words1.length, words2.length)) * 100
        : 0;
      semanticSimilarity = Math.min(Math.max(similarity, 0), 100);
    } else {
      console.warn('语义相似度计算失败，使用默认值:', error.message);
      semanticSimilarity = 50; // 默认中等相似度
    }
  }

  // 综合评分
  const finalScore = Math.round(
    semanticSimilarity * 0.7 +
    tagSimilarity * 0.2 +
    categorySimilarity * 0.1
  );

  return finalScore;
}

/**
 * 获取相关知识推荐
 * @param {string} knowledgeItemId - 当前知识点ID
 * @param {number} limit - 返回数量（默认5）
 * @param {number} minSimilarity - 最低相似度（默认60）
 * @param {string} userApiKey - 用户API Key（可选）
 * @returns {Promise<Array>} 相关知识列表
 */
async function getRelatedKnowledge(knowledgeItemId, limit = 5, minSimilarity = 60, userApiKey = null) {
  // 获取当前知识点
  const currentItem = await db.get(
    'SELECT * FROM personal_knowledge_items WHERE id = ?',
    [knowledgeItemId]
  );

  if (!currentItem) {
    return [];
  }

  // 获取同一知识库中的其他知识点（限制数量以提高性能，从10减少到5）
  const otherItems = await db.all(
    `SELECT * FROM personal_knowledge_items 
     WHERE id != ? AND knowledge_base_id = ? AND status = 'confirmed'
     ORDER BY created_at DESC
     LIMIT 5`,
    [knowledgeItemId, currentItem.knowledge_base_id]
  );

  if (otherItems.length === 0) {
    return [];
  }

  // 并行计算相似度（而不是串行，大幅提升性能）
  const similarityPromises = otherItems.map(item => 
    calculateSimilarity(currentItem, item, userApiKey)
      .then(similarity => ({ item, similarity }))
      .catch(error => {
        console.warn(`计算相似度失败 (${item.id}):`, error.message);
        return { item, similarity: 0 };
      })
  );
  
  const results = await Promise.all(similarityPromises);
  const similarities = results
    .filter(({ similarity }) => similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity);
  
  // 按相似度排序并返回Top N
  return similarities.slice(0, limit).map(({ item, similarity }) => ({
    id: item.id,
    title: item.title,
    contentPreview: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
    summary: item.summary,
    knowledgeBaseId: item.knowledge_base_id,
    similarityScore: similarity
  }));
}

/**
 * 阶段权重定义
 */
const STAGE_WEIGHTS = {
  parsing: 0.20,      // 20%
  extracting: 0.40,   // 40%
  summarizing: 0.20,  // 20%
  saving: 0.20        // 20%
};

/**
 * 计算当前阶段的进度百分比（0-1）
 * @param {string} stage - 当前阶段
 * @param {number} stageProgress - 阶段内进度（0-1）
 * @returns {number} 该阶段在整个流程中的进度百分比（0-1）
 */
function calculateStageProgress(stage, stageProgress = 0) {
  const stageOrder = ['parsing', 'extracting', 'summarizing', 'saving'];
  const currentStageIndex = stageOrder.indexOf(stage);
  
  if (currentStageIndex === -1) return 0;
  
  // 计算已完成阶段的权重总和
  let completedWeight = 0;
  for (let i = 0; i < currentStageIndex; i++) {
    completedWeight += STAGE_WEIGHTS[stageOrder[i]] || 0;
  }
  
  // 当前阶段的进度
  const currentStageWeight = (STAGE_WEIGHTS[stage] || 0) * stageProgress;
  
  return completedWeight + currentStageWeight;
}

/**
 * 批量提取文档知识
 * @param {Array<string>} itemIds - 文档ID数组
 * @param {string} knowledgeBaseId - 目标知识库ID
 * @param {Object} options - 提取选项
 * @param {string} options.userApiKey - 用户API Key（可选）
 * @returns {Promise<Object>} 提取结果
 */
async function extractFromDocuments(itemIds, knowledgeBaseId, options = {}) {
  const extractionId = options.extractionId || `ext-${uuidv4().split('-')[0]}`;
  const updateProgress = options.updateProgress || (() => {});
  
  // 进度历史记录（用于ETA计算）
  const progressHistory = [];
  const startTime = Date.now();
  
  const results = {
    extractionId,
    totalItems: itemIds.length,
    processedItems: 0,
    extractedCount: 0,
    knowledgeItemIds: [],
    knowledgeItems: [] // 添加已提取的知识点列表
  };

  // 初始化进度（从5%开始，避免一开始就是0%）
  updateProgress({
    extractionId,
    stage: 'parsing',
    processedItems: 0,
    totalItems: itemIds.length,
    extractedCount: 0,
    currentDocIndex: 0,
    progress: 5,
    knowledgeItems: [],
    knowledgeItemIds: []
  });

  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i];
    const currentDocIndex = i + 1; // 当前处理的文档序号（从1开始）
    
    try {
      // 阶段1: 解析文档
      const parsingStageProgress = 0.5; // 解析中，假设50%完成
      const docStageProgress = calculateStageProgress('parsing', parsingStageProgress);
      const baseProgress = (results.processedItems / itemIds.length) * 100;
      const currentDocProgress = (docStageProgress / itemIds.length) * 100;
      const totalProgress = Math.min(100, Math.max(5, Math.round(baseProgress + currentDocProgress)));
      
      updateProgress({
        extractionId,
        stage: 'parsing',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex,
        progress: totalProgress,
        knowledgeItems: results.knowledgeItems.slice(-5),
        knowledgeItemIds: results.knowledgeItemIds
      });

      // 获取文档内容
      const item = await db.get(
        'SELECT * FROM source_items WHERE id = ?',
        [itemId]
      );

      if (!item) {
        console.warn(`文档不存在: ${itemId}`);
        results.processedItems++;
        continue;
      }

      // 获取文档内容
      let content = '';
      if (item.type === 'pdf' && item.raw_content) {
        content = item.raw_content;
      } else if (item.raw_content) {
        content = item.raw_content;
      } else {
        console.warn(`文档无内容: ${itemId}`);
        results.processedItems++;
        continue;
      }

      // 阶段2: 提取知识
      const extractingStageProgress = 0.3; // 提取开始，假设30%完成
      const extractingDocProgress = calculateStageProgress('extracting', extractingStageProgress);
      const extractingBaseProgress = (results.processedItems / itemIds.length) * 100;
      const extractingCurrentDocProgress = (extractingDocProgress / itemIds.length) * 100;
      const extractingTotalProgress = Math.min(100, Math.round(extractingBaseProgress + extractingCurrentDocProgress));
      
      updateProgress({
        extractionId,
        stage: 'extracting',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex,
        progress: extractingTotalProgress,
        knowledgeItems: results.knowledgeItems.slice(-5),
        knowledgeItemIds: results.knowledgeItemIds
      });

      // 提取知识点
      console.log('[提取] 开始从文档提取知识点', {
        extractionId,
        itemId,
        contentLength: content.length
      });
      
      const knowledgeItems = await extractKnowledgeFromContent(
        content,
        itemId,
        null,
        options.userApiKey
      );
      
      console.log('[提取] 知识点提取完成', {
        extractionId,
        itemId,
        extractedCount: knowledgeItems.length,
        knowledgeItems: knowledgeItems.map(ki => ({
          title: ki.title?.substring(0, 50),
          confidence: ki.confidence,
          tagsCount: ki.tags?.length || 0
        }))
      });
      
      if (knowledgeItems.length === 0) {
        // 增强空知识点检测和诊断
        const diagnosticInfo = {
          extractionId,
          itemId,
          contentLength: content.length,
          contentPreview: content.substring(0, 500),
          contentEnd: content.length > 500 ? content.substring(content.length - 500) : null,
          hasNonWhitespace: content.trim().length > 0,
          wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
          lineCount: content.split('\n').length,
          possibleReasons: [],
          recommendations: []
        };
        
        // 分析可能的原因
        if (content.length < 100) {
          diagnosticInfo.possibleReasons.push('文档内容过短（少于100字符）');
          diagnosticInfo.recommendations.push('检查文档是否包含实际内容');
        } else if (content.trim().length === 0) {
          diagnosticInfo.possibleReasons.push('文档内容只包含空白字符');
          diagnosticInfo.recommendations.push('检查文档内容是否正确解析');
        } else if (content.split(/\s+/).filter(w => w.length > 0).length < 20) {
          diagnosticInfo.possibleReasons.push('文档内容词汇量太少（少于20个词）');
          diagnosticInfo.recommendations.push('文档可能只包含格式信息或标题');
        } else {
          diagnosticInfo.possibleReasons.push('AI未返回知识点数据');
          diagnosticInfo.possibleReasons.push('AI返回的格式可能不正确');
          diagnosticInfo.possibleReasons.push('文档内容可能不包含可提取的知识点');
          diagnosticInfo.recommendations.push('查看Railway日志中的AI完整响应');
          diagnosticInfo.recommendations.push('检查API Key是否有效');
          diagnosticInfo.recommendations.push('尝试提取其他文档');
        }
        
        console.warn('[提取] ⚠️ 未提取到任何知识点', diagnosticInfo);
        
        // 检查内容是否太短
        if (content.length < 100) {
          console.warn('[提取] ⚠️ 文档内容过短，可能无法提取知识点', {
            itemId,
            contentLength: content.length,
            contentPreview: content.substring(0, 200)
          });
        }
      }

      // 阶段3: 生成摘要
      const summarizingStageProgress = 0.5; // 摘要生成中
      const summarizingDocProgress = calculateStageProgress('summarizing', summarizingStageProgress);
      const summarizingBaseProgress = (results.processedItems / itemIds.length) * 100;
      const summarizingCurrentDocProgress = (summarizingDocProgress / itemIds.length) * 100;
      const summarizingTotalProgress = Math.min(100, Math.round(summarizingBaseProgress + summarizingCurrentDocProgress));
      
      updateProgress({
        extractionId,
        stage: 'summarizing',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex,
        progress: summarizingTotalProgress,
        knowledgeItems: knowledgeItems.map(ki => ({
          id: null, // 尚未保存，ID为null
          title: ki.title,
          content: ki.content.substring(0, 100) + '...'
        })),
        knowledgeItemIds: results.knowledgeItemIds
      });

      // 批量保存知识点（优化：减少数据库操作和进度更新频率）
      const BATCH_SIZE = 5; // 每批保存 5 个知识点
      const PROGRESS_UPDATE_INTERVAL = 3; // 每保存 3 个知识点更新一次进度
      
      console.log('[提取] 开始批量保存知识点', {
        extractionId,
        itemId,
        knowledgeItemsCount: knowledgeItems.length,
        batchSize: BATCH_SIZE
      });
      
      for (let j = 0; j < knowledgeItems.length; j += BATCH_SIZE) {
        const batch = knowledgeItems.slice(j, j + BATCH_SIZE);
        console.log('[提取] 处理批次', {
          extractionId,
          itemId,
          batchIndex: Math.floor(j / BATCH_SIZE) + 1,
          batchSize: batch.length,
          batchTitles: batch.map(ki => ki.title?.substring(0, 30))
        });
        
        // 批量保存知识点 - 使用 Promise.allSettled 避免一个失败导致全部失败
        const batchPromises = batch.map((knowledgeItem, index) => {
          // 验证知识点数据完整性
          const validationErrors = [];
          if (!knowledgeItem.title || knowledgeItem.title.trim().length === 0) {
            validationErrors.push('title为空');
          }
          if (!knowledgeItem.content || knowledgeItem.content.trim().length === 0) {
            validationErrors.push('content为空');
          }
          if (validationErrors.length > 0) {
            console.error('[提取] ❌ 知识点数据验证失败', {
              extractionId,
              itemId,
              index,
              errors: validationErrors,
              knowledgeItem: {
                hasTitle: !!knowledgeItem.title,
                titleLength: knowledgeItem.title?.length,
                hasContent: !!knowledgeItem.content,
                contentLength: knowledgeItem.content?.length
              }
            });
            return Promise.resolve({ 
              success: false, 
              error: `数据验证失败: ${validationErrors.join(', ')}`, 
              index, 
              knowledgeItem: { title: knowledgeItem.title?.substring(0, 50) }
            });
          }
          
          return saveKnowledgeItem(knowledgeItem, knowledgeBaseId)
            .then(id => ({ success: true, id, index, knowledgeItem }))
            .catch(error => ({ 
              success: false, 
              error: error.message, 
              index, 
              knowledgeItem: { title: knowledgeItem.title?.substring(0, 50) }
            }));
        });
        
        const saveResults = await Promise.allSettled(batchPromises);
        
        // 收集成功保存的ID和失败的记录
        const savedIds = [];
        const failedItems = [];
        
        saveResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            const itemResult = result.value;
            if (itemResult.success) {
              savedIds.push(itemResult.id);
              console.log('[提取] ✅ 知识点保存成功', {
                extractionId,
                itemId,
                knowledgeItemId: itemResult.id,
                title: itemResult.knowledgeItem.title?.substring(0, 50)
              });
            } else {
              failedItems.push(itemResult);
              console.error('[提取] ❌ 知识点保存失败', {
                extractionId,
                itemId,
                index: itemResult.index,
                error: itemResult.error,
                title: itemResult.knowledgeItem.title
              });
            }
          } else {
            failedItems.push({ index, error: result.reason?.message || 'Unknown error' });
            console.error('[提取] ❌ Promise rejected', {
              extractionId,
              itemId,
              index,
              error: result.reason
            });
          }
        });
        
        console.log('[提取] 批次保存结果', {
          extractionId,
          itemId,
          batchIndex: Math.floor(j / BATCH_SIZE) + 1,
          total: batch.length,
          success: savedIds.length,
          failed: failedItems.length,
          savedIds: savedIds.slice(0, 5) // 只显示前5个
        });
        
        // 批量获取保存的知识点详情（减少数据库查询）
        if (savedIds.length > 0) {
          const placeholders = savedIds.map(() => '?').join(',');
          const savedItems = await db.all(
            `SELECT id, title, content FROM personal_knowledge_items WHERE id IN (${placeholders})`,
            savedIds
          );
          
          console.log('[提取] 从数据库获取保存的知识点', {
            extractionId,
            itemId,
            requestedIds: savedIds.length,
            foundItems: savedItems.length,
            foundIds: savedItems.map(item => item.id)
          });
          
          // 添加到结果
          savedIds.forEach(id => results.knowledgeItemIds.push(id));
          results.extractedCount += savedIds.length;
          
          console.log('[提取] 更新结果中的 knowledgeItemIds', {
            extractionId,
            itemId,
            batchIndex: Math.floor(j / BATCH_SIZE) + 1,
            savedIdsCount: savedIds.length,
            totalKnowledgeItemIdsCount: results.knowledgeItemIds.length,
            extractedCount: results.extractedCount
          });
          
          savedItems.forEach(item => {
            results.knowledgeItems.push({
              id: item.id,
              title: item.title,
              content: item.content.substring(0, 100) + '...'
            });
          });
        } else {
          console.warn('[提取] ⚠️ 批次中没有成功保存的知识点', {
            extractionId,
            itemId,
            batchIndex: Math.floor(j / BATCH_SIZE) + 1,
            failedCount: failedItems.length
          });
        }
        
        // 减少进度更新频率：每保存 PROGRESS_UPDATE_INTERVAL 个知识点或批次结束时更新
        const shouldUpdateProgress = (j + batch.length) % PROGRESS_UPDATE_INTERVAL === 0 || 
                                      (j + batch.length) >= knowledgeItems.length;
        
        if (shouldUpdateProgress) {
          const savingStageProgress = Math.min(1, (j + batch.length) / knowledgeItems.length);
          const savingDocProgress = calculateStageProgress('saving', savingStageProgress);
          const savingBaseProgress = (results.processedItems / itemIds.length) * 100;
          const savingCurrentDocProgress = (savingDocProgress / itemIds.length) * 100;
          const savingTotalProgress = Math.min(100, Math.round(savingBaseProgress + savingCurrentDocProgress));
          
          // 记录进度历史（用于ETA计算）
          progressHistory.push({
            progress: savingTotalProgress,
            timestamp: Date.now()
          });
          // 只保留最近10条记录
          if (progressHistory.length > 10) {
            progressHistory.shift();
          }
          
          console.log('[提取] 更新进度：保存阶段', {
            extractionId,
            itemId,
            stage: 'saving',
            progress: savingTotalProgress,
            knowledgeItemIdsCount: results.knowledgeItemIds.length,
            extractedCount: results.extractedCount
          });
          
          updateProgress({
            extractionId,
            stage: 'saving',
            processedItems: results.processedItems,
            totalItems: itemIds.length,
            extractedCount: results.extractedCount,
            currentDocIndex,
            progress: savingTotalProgress,
            knowledgeItems: results.knowledgeItems.slice(-5),
            knowledgeItemIds: results.knowledgeItemIds
          });
        }
      }

      // 文档处理完成
      results.processedItems++;
      
      // 如果还有文档，进入下一个文档的解析阶段
      if (results.processedItems < itemIds.length) {
        const nextDocBaseProgress = (results.processedItems / itemIds.length) * 100;
        const nextDocStageProgress = calculateStageProgress('parsing', 0.1);
        const nextDocCurrentProgress = (nextDocStageProgress / itemIds.length) * 100;
        const nextDocTotalProgress = Math.min(100, Math.round(nextDocBaseProgress + nextDocCurrentProgress));
        
        updateProgress({
          extractionId,
          stage: 'parsing',
          processedItems: results.processedItems,
          totalItems: itemIds.length,
          extractedCount: results.extractedCount,
          currentDocIndex: results.processedItems + 1,
          progress: nextDocTotalProgress,
          knowledgeItems: results.knowledgeItems.slice(-5),
          knowledgeItemIds: results.knowledgeItemIds
        });
      } else {
        // 所有文档处理完成
        console.log('[提取] 所有文档处理完成，最终更新进度', {
          extractionId,
          processedItems: results.processedItems,
          totalItems: itemIds.length,
          extractedCount: results.extractedCount,
          knowledgeItemIdsCount: results.knowledgeItemIds.length,
          knowledgeItemsCount: results.knowledgeItems.length
        });
        
        updateProgress({
          extractionId,
          stage: 'saving',
          processedItems: results.processedItems,
          totalItems: itemIds.length,
          extractedCount: results.extractedCount,
          currentDocIndex: results.processedItems,
          progress: 100,
          knowledgeItems: results.knowledgeItems.slice(-5),
          knowledgeItemIds: results.knowledgeItemIds
        });
      }
    } catch (error) {
      console.error('[提取] ❌ 提取文档失败', {
        extractionId,
        itemId,
        error: error.message,
        errorStack: error.stack,
        errorName: error.name,
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount
      });
      
      results.processedItems++;
      
      // 即使失败也要更新进度
      const errorBaseProgress = (results.processedItems / itemIds.length) * 100;
      updateProgress({
        extractionId,
        stage: 'extracting',
        processedItems: results.processedItems,
        totalItems: itemIds.length,
        extractedCount: results.extractedCount,
        currentDocIndex: results.processedItems,
        progress: Math.min(100, Math.round(errorBaseProgress)),
        knowledgeItems: results.knowledgeItems.slice(-5),
        knowledgeItemIds: results.knowledgeItemIds
      });
      
      // 继续处理下一个文档，不中断整个提取流程
      console.log('[提取] 继续处理下一个文档', {
        extractionId,
        nextItemIndex: results.processedItems,
        remainingItems: itemIds.length - results.processedItems
      });
    }
  }

  console.log('[提取] extractFromDocuments 完成', {
    extractionId,
    totalItems: results.totalItems,
    processedItems: results.processedItems,
    extractedCount: results.extractedCount,
    knowledgeItemIds: results.knowledgeItemIds,
    knowledgeItemIdsLength: results.knowledgeItemIds.length,
    knowledgeItemsLength: results.knowledgeItems.length,
    knowledgeItemIdsSample: results.knowledgeItemIds.slice(0, 5) // 显示前5个ID作为样本
  });
  
  // 验证最终结果
  if (results.knowledgeItemIds.length === 0 && results.extractedCount > 0) {
    console.error('[提取] ❌ 警告：extractedCount > 0 但 knowledgeItemIds 为空', {
      extractionId,
      extractedCount: results.extractedCount,
      knowledgeItemsLength: results.knowledgeItems.length
    });
  }
  
  if (results.knowledgeItemIds.length === 0) {
    // 增强最终结果的诊断信息
    const finalDiagnostic = {
      extractionId,
      totalItems: results.totalItems,
      processedItems: results.processedItems,
      extractedCount: results.extractedCount,
      knowledgeItemsLength: results.knowledgeItems.length,
      possibleCauses: [],
      recommendations: []
    };
    
    if (results.extractedCount === 0) {
      finalDiagnostic.possibleCauses.push('所有文档都未提取到知识点');
      finalDiagnostic.possibleCauses.push('可能原因：文档内容不适合提取、AI返回格式错误、API Key问题等');
      finalDiagnostic.recommendations.push('查看Railway日志中每个文档的提取详情');
      finalDiagnostic.recommendations.push('检查文档内容是否包含实际知识点');
      finalDiagnostic.recommendations.push('确认API Key已正确配置');
    } else if (results.extractedCount > 0 && results.knowledgeItemIds.length === 0) {
      finalDiagnostic.possibleCauses.push('提取到知识点但保存失败');
      finalDiagnostic.possibleCauses.push('可能原因：数据库插入失败、数据验证失败、ID收集逻辑问题');
      finalDiagnostic.recommendations.push('查看Railway日志中的[保存]相关错误');
      finalDiagnostic.recommendations.push('检查数据库表结构是否正确');
      finalDiagnostic.recommendations.push('检查知识点数据验证逻辑');
    }
    
    console.warn('[提取] ⚠️ 最终结果：没有保存任何知识点ID', finalDiagnostic);
  }

  return results;
}

module.exports = {
  extractKnowledgeFromContent,
  saveKnowledgeItem,
  calculateSimilarity,
  getRelatedKnowledge,
  extractFromDocuments
};

