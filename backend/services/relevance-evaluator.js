const { callDeepSeekAPI } = require('./ai');
const { extractCitations } = require('./ai');

/**
 * 文本相似度评估
 * 使用简单的词频匹配和Jaccard相似度
 */
function calculateTextSimilarity(answer, knowledgeBase) {
  if (!answer || !knowledgeBase || knowledgeBase.length === 0) {
    return { similarity: 0, matchedPhrases: [] };
  }

  // 简单的分词函数（中文和英文）
  function tokenize(text) {
    // 移除标点符号，转换为小写
    const cleaned = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
    // 分割成词（支持中英文）
    const words = cleaned.split(/\s+/).filter(w => w.length > 1);
    return words;
  }

  const answerTokens = new Set(tokenize(answer));
  const kbTokens = new Set(tokenize(knowledgeBase));
  
  // 计算交集和并集
  const intersection = new Set([...answerTokens].filter(x => kbTokens.has(x)));
  const union = new Set([...answerTokens, ...kbTokens]);
  
  // Jaccard相似度
  const jaccardSimilarity = intersection.size / union.size;
  
  // 计算匹配的关键短语（连续2-3个词）
  const matchedPhrases = [];
  const answerWords = tokenize(answer);
  const kbText = knowledgeBase.toLowerCase();
  
  // 查找匹配的短语（滑动窗口）
  for (let i = 0; i < answerWords.length - 1; i++) {
    const phrase2 = answerWords.slice(i, i + 2).join(' ');
    const phrase3 = i < answerWords.length - 2 ? answerWords.slice(i, i + 3).join(' ') : null;
    
    if (kbText.includes(phrase2) && !matchedPhrases.includes(phrase2)) {
      matchedPhrases.push(phrase2);
    }
    if (phrase3 && kbText.includes(phrase3) && !matchedPhrases.includes(phrase3)) {
      matchedPhrases.push(phrase3);
    }
  }
  
  // 计算匹配内容比例
  const matchedWords = matchedPhrases.flatMap(p => p.split(' ')).length;
  const contentRatio = answerWords.length > 0 ? matchedWords / answerWords.length : 0;
  
  return {
    similarity: Math.min(jaccardSimilarity * 100, 100), // 转换为0-100分
    contentRatio: Math.min(contentRatio * 100, 100),
    matchedPhrases: matchedPhrases.slice(0, 10) // 最多返回10个匹配短语
  };
}

/**
 * 验证引用
 */
function validateCitations(answer, citations, pageContent) {
  if (!citations || citations.length === 0) {
    return { valid: true, validCount: 0, invalidCount: 0, details: [] };
  }

  const validationResults = [];
  let validCount = 0;
  let invalidCount = 0;

  // 解析分页内容
  let pages = {};
  if (pageContent) {
    try {
      const parsed = typeof pageContent === 'string' ? JSON.parse(pageContent) : pageContent;
      if (Array.isArray(parsed)) {
        parsed.forEach(page => {
          const pageNum = page.pageNum || page.page || 0;
          pages[pageNum] = (page.content || page.text || '').toLowerCase();
        });
      }
    } catch (e) {
      console.warn('解析page_content失败:', e);
    }
  }

  for (const citation of citations) {
    const page = citation.page;
    const isValid = pages[page] && pages[page].length > 0;
    
    if (isValid) {
      validCount++;
      // 验证引用文本是否在对应页面中
      const citationText = (citation.text || '').toLowerCase();
      const pageText = pages[page];
      const textMatches = citationText.length > 0 && pageText.includes(citationText.substring(0, 50));
      
      validationResults.push({
        page,
        valid: true,
        textMatches,
        reason: textMatches ? '引用有效' : '页码存在但文本不匹配'
      });
    } else {
      invalidCount++;
      validationResults.push({
        page,
        valid: false,
        textMatches: false,
        reason: '页码不存在或超出范围'
      });
    }
  }

  return {
    valid: invalidCount === 0,
    validCount,
    invalidCount,
    totalCount: citations.length,
    details: validationResults
  };
}

/**
 * AI评估
 * 使用AI判断回答与知识库的关联度
 */
async function aiEvaluate(answer, knowledgeBase, question) {
  if (!answer || !knowledgeBase) {
    return {
      relevanceScore: 0,
      basedOnKnowledgeBase: false,
      knowledgeBaseRatio: 0,
      aiKnowledgeRatio: 100,
      explanation: '缺少必要信息，无法评估'
    };
  }

  // 限制长度以提高效率
  const kbSample = knowledgeBase.substring(0, 30000);
  const answerSample = answer.substring(0, 5000);

  const messages = [
    {
      role: 'system',
      content: `你是一个评估专家。请评估AI回答是否真正基于提供的知识库内容，还是主要依赖AI的通用知识。

请以JSON格式返回评估结果，格式如下：
{
  "relevanceScore": 相关性分数（0-100，表示回答多大程度基于知识库）,
  "basedOnKnowledgeBase": 是否主要基于知识库（true/false）,
  "knowledgeBaseRatio": 基于知识库的内容比例（0-100）,
  "aiKnowledgeRatio": 基于AI通用知识的比例（0-100）,
  "explanation": "评估说明（简短说明为什么给出这个评分）"
}

只返回JSON，不要其他文字。`
    },
    {
      role: 'user',
      content: `用户问题：${question || '未提供'}

知识库内容：
${kbSample}

AI回答：
${answerSample}

请评估这个回答是否真正基于知识库内容。`
    }
  ];

  try {
    const response = await callDeepSeekAPI(messages, {
      max_tokens: 500,
      temperature: 0.3
    });

    // 尝试解析JSON响应
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        relevanceScore: Math.min(Math.max(result.relevanceScore || 0, 0), 100),
        basedOnKnowledgeBase: result.basedOnKnowledgeBase || false,
        knowledgeBaseRatio: Math.min(Math.max(result.knowledgeBaseRatio || 0, 0), 100),
        aiKnowledgeRatio: Math.min(Math.max(result.aiKnowledgeRatio || 0, 0), 100),
        explanation: result.explanation || 'AI评估完成'
      };
    }

    // 如果解析失败，返回默认值
    return {
      relevanceScore: 50,
      basedOnKnowledgeBase: false,
      knowledgeBaseRatio: 50,
      aiKnowledgeRatio: 50,
      explanation: 'AI评估解析失败，使用默认值'
    };
  } catch (error) {
    console.error('AI评估失败:', error);
    return {
      relevanceScore: 50,
      basedOnKnowledgeBase: false,
      knowledgeBaseRatio: 50,
      aiKnowledgeRatio: 50,
      explanation: `AI评估失败: ${error.message}`
    };
  }
}

/**
 * 综合评估
 * 整合所有评估结果，生成最终评分
 */
async function evaluateRelevance(answer, knowledgeBase, citations, pageContent, question = null) {
  if (!answer) {
    return {
      overallScore: 0,
      textSimilarity: { similarity: 0, contentRatio: 0, matchedPhrases: [] },
      citationValidation: { valid: false, validCount: 0, invalidCount: 0, totalCount: 0, details: [] },
      aiEvaluation: {
        relevanceScore: 0,
        basedOnKnowledgeBase: false,
        knowledgeBaseRatio: 0,
        aiKnowledgeRatio: 100,
        explanation: '缺少回答内容'
      },
      timestamp: Date.now()
    };
  }

  // 1. 文本相似度评估
  const textSimilarity = calculateTextSimilarity(answer, knowledgeBase);

  // 2. 引用验证
  const citationValidation = validateCitations(answer, citations, pageContent);

  // 3. AI评估（异步，可能较慢）
  let aiEvaluation;
  try {
    aiEvaluation = await aiEvaluate(answer, knowledgeBase, question);
  } catch (error) {
    console.error('AI评估出错:', error);
    aiEvaluation = {
      relevanceScore: 50,
      basedOnKnowledgeBase: false,
      knowledgeBaseRatio: 50,
      aiKnowledgeRatio: 50,
      explanation: `AI评估出错: ${error.message}`
    };
  }

  // 4. 综合评分
  // 权重：文本相似度30%，引用验证20%，AI评估50%
  const citationScore = citationValidation.totalCount > 0
    ? (citationValidation.validCount / citationValidation.totalCount) * 100
    : 50; // 没有引用时给中等分数

  const overallScore = Math.round(
    textSimilarity.similarity * 0.3 +
    citationScore * 0.2 +
    aiEvaluation.relevanceScore * 0.5
  );

  return {
    overallScore: Math.min(Math.max(overallScore, 0), 100),
    textSimilarity,
    citationValidation,
    aiEvaluation,
    timestamp: Date.now()
  };
}

module.exports = {
  evaluateRelevance,
  calculateTextSimilarity,
  validateCitations,
  aiEvaluate
};

