const { callDeepSeekAPI } = require('./ai');
const { extractCitations } = require('./ai');

/**
 * 文本相似度评估
 * 使用改进的词频匹配、Jaccard相似度和短语匹配
 */
function calculateTextSimilarity(answer, knowledgeBase) {
  if (!answer || !knowledgeBase || knowledgeBase.length === 0) {
    return { similarity: 0, contentRatio: 0, matchedPhrases: [] };
  }

  // 改进的分词函数（中文和英文）
  function tokenize(text) {
    // 移除标点符号，转换为小写
    const cleaned = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
    
    // 对于中文，按字符分割（因为中文没有空格分隔）
    // 对于英文，按空格分割
    const words = [];
    let currentWord = '';
    
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      const isChinese = /[\u4e00-\u9fa5]/.test(char);
      const isEnglish = /[a-z0-9]/.test(char);
      
      if (isChinese) {
        // 中文：每个字符作为一个词，同时保留2-3字短语
        if (currentWord && !isEnglish) {
          words.push(currentWord);
          currentWord = '';
        }
        words.push(char);
      } else if (isEnglish) {
        currentWord += char;
      } else {
        // 空格或标点
        if (currentWord.length > 0) {
          words.push(currentWord);
          currentWord = '';
        }
      }
    }
    if (currentWord.length > 0) {
      words.push(currentWord);
    }
    
    return words.filter(w => w.length > 0);
  }

  const answerTokens = tokenize(answer);
  const kbTokens = tokenize(knowledgeBase);
  
  const answerTokenSet = new Set(answerTokens);
  const kbTokenSet = new Set(kbTokens);
  
  // 计算交集和并集
  const intersection = new Set([...answerTokens].filter(x => kbTokenSet.has(x)));
  const union = new Set([...answerTokens, ...kbTokens]);
  
  // Jaccard相似度
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;
  
  // 计算匹配的关键短语（连续2-4个词，中文和英文都支持）
  const matchedPhrases = [];
  const kbText = knowledgeBase.toLowerCase();
  const answerText = answer.toLowerCase();
  
  // 查找匹配的短语（滑动窗口，支持2-4词短语）
  for (let phraseLength = 2; phraseLength <= 4; phraseLength++) {
    for (let i = 0; i <= answerTokens.length - phraseLength; i++) {
      const phrase = answerTokens.slice(i, i + phraseLength).join('');
      // 检查短语是否在知识库中（支持中英文）
      if (kbText.includes(phrase) && !matchedPhrases.some(p => p.includes(phrase) || phrase.includes(p))) {
        matchedPhrases.push(phrase);
      }
    }
  }
  
  // 计算匹配内容比例（匹配短语的权重更高）
  const matchedWords = new Set();
  matchedPhrases.forEach(phrase => {
    const phraseTokens = tokenize(phrase);
    phraseTokens.forEach(token => matchedWords.add(token));
  });
  
  // 同时计算单个词的匹配
  answerTokens.forEach(token => {
    if (kbTokenSet.has(token)) {
      matchedWords.add(token);
    }
  });
  
  const contentRatio = answerTokens.length > 0 ? matchedWords.size / answerTokens.length : 0;
  
  // 综合相似度：Jaccard相似度（40%）+ 内容匹配比例（60%），匹配短语多的额外加分
  const phraseBonus = Math.min(matchedPhrases.length * 2, 20); // 最多加20分
  const baseSimilarity = jaccardSimilarity * 0.4 + contentRatio * 0.6;
  const finalSimilarity = Math.min(baseSimilarity * 100 + phraseBonus, 100);
  
  return {
    similarity: Math.round(finalSimilarity),
    contentRatio: Math.round(contentRatio * 100),
    matchedPhrases: matchedPhrases.slice(0, 15) // 最多返回15个匹配短语
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
 * @param {string} answer - AI回答
 * @param {string} knowledgeBase - 知识库内容
 * @param {string} question - 用户问题
 * @param {string} userApiKey - 用户API Key（可选）
 */
async function aiEvaluate(answer, knowledgeBase, question, userApiKey = null) {
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
      content: `你是一个评估专家。请评估AI回答是否基于提供的知识库内容。

评估标准：
1. 如果回答的核心内容、关键信息、具体数据或案例来自知识库，即使包含一些通用解释、总结或补充说明，也应该给高分（70-100分）
2. 如果回答主要基于知识库内容，只是用AI的通用知识进行解释、总结或补充，应该给中高分（60-80分）
3. 如果回答只是泛泛而谈，没有使用知识库中的具体内容，才应该给低分（0-50分）

评分原则：
- 重点关注回答是否使用了知识库中的具体信息，而不是是否完全依赖知识库
- 如果回答引用了知识库中的内容（即使进行了改写或总结），应该给高分
- 只要回答的核心内容来自知识库，就应该给70分以上

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

请评估这个回答是否基于知识库内容。重点关注回答是否使用了知识库中的具体信息、数据或案例，即使包含一些通用解释也应该给高分。`
    }
  ];

  try {
    const response = await callDeepSeekAPI(messages, {
      max_tokens: 500,
      temperature: 0.3,
      userApiKey: userApiKey
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
 * @param {string} answer - AI回答
 * @param {string} knowledgeBase - 知识库内容
 * @param {Array} citations - 引用列表
 * @param {string|Object} pageContent - 分页内容
 * @param {string} question - 用户问题
 * @param {string} userApiKey - 用户API Key（可选）
 */
async function evaluateRelevance(answer, knowledgeBase, citations, pageContent, question = null, userApiKey = null) {
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
  console.log('[相关性评估] 文本相似度:', {
    similarity: textSimilarity.similarity,
    contentRatio: textSimilarity.contentRatio,
    matchedPhrasesCount: textSimilarity.matchedPhrases?.length || 0,
    samplePhrases: textSimilarity.matchedPhrases?.slice(0, 3) || []
  });

  // 2. 引用验证
  const citationValidation = validateCitations(answer, citations, pageContent);
  console.log('[相关性评估] 引用验证:', {
    totalCount: citationValidation.totalCount,
    validCount: citationValidation.validCount,
    invalidCount: citationValidation.invalidCount,
    valid: citationValidation.valid
  });

  // 3. AI评估（异步，可能较慢）
  let aiEvaluation;
  try {
    aiEvaluation = await aiEvaluate(answer, knowledgeBase, question, userApiKey);
    console.log('[相关性评估] AI评估:', {
      relevanceScore: aiEvaluation.relevanceScore,
      basedOnKnowledgeBase: aiEvaluation.basedOnKnowledgeBase,
      knowledgeBaseRatio: aiEvaluation.knowledgeBaseRatio,
      aiKnowledgeRatio: aiEvaluation.aiKnowledgeRatio,
      explanation: aiEvaluation.explanation?.substring(0, 100) // 只记录前100字符
    });
  } catch (error) {
    console.error('[相关性评估] AI评估出错:', error);
    aiEvaluation = {
      relevanceScore: 50,
      basedOnKnowledgeBase: false,
      knowledgeBaseRatio: 50,
      aiKnowledgeRatio: 50,
      explanation: `AI评估出错: ${error.message}`
    };
  }

  // 4. 综合评分
  // 权重：文本相似度40%，引用验证30%，AI评估30%
  // 优化无引用时的处理：如果文本相似度高，即使没有引用也应该给高分
  let citationScore;
  if (citationValidation.totalCount > 0) {
    citationScore = (citationValidation.validCount / citationValidation.totalCount) * 100;
    console.log('[相关性评估] 引用分数计算: 有引用，分数 =', citationScore);
  } else {
    // 没有引用时，如果文本相似度高（>60），说明回答确实基于知识库，给高分
    if (textSimilarity.similarity > 60) {
      citationScore = 80; // 给高分，因为文本相似度高说明确实使用了知识库
      console.log('[相关性评估] 引用分数计算: 无引用但文本相似度高(' + textSimilarity.similarity + ')，给高分 =', citationScore);
    } else {
      citationScore = 50; // 文本相似度也不高，给中等分数
      console.log('[相关性评估] 引用分数计算: 无引用且文本相似度低(' + textSimilarity.similarity + ')，给中等分数 =', citationScore);
    }
  }

  const textScore = textSimilarity.similarity * 0.4;
  const citationScoreWeighted = citationScore * 0.3;
  const aiScoreWeighted = aiEvaluation.relevanceScore * 0.3;
  const overallScore = Math.round(textScore + citationScoreWeighted + aiScoreWeighted);

  console.log('[相关性评估] 综合评分计算:', {
    textSimilarity: textSimilarity.similarity,
    textScoreWeighted: textScore.toFixed(2),
    citationScore: citationScore,
    citationScoreWeighted: citationScoreWeighted.toFixed(2),
    aiScore: aiEvaluation.relevanceScore,
    aiScoreWeighted: aiScoreWeighted.toFixed(2),
    overallScore: overallScore
  });

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


