// 情报洞察：热度TOP话题 / 新兴起量信号 / 核心达人 / 推荐调查方向 / 跨平台对比建议。
// 移植自 daily_report.py 的 generate_intelligence_briefing（含调查引擎配置与场景映射）。
import { DEFAULT_KEYWORDS } from './redfox.js'

// 调查引擎配置（来自上游智能情报调查员 skill）
export const SCENARIO_ENGINES = {
  产品竞品分析: ['Baidu', 'Google', 'WeChat', 'DuckDuckGo'],
  热点事件追踪: ['Baidu', 'Toutiao', 'Google', 'WeChat'],
  人物背景验证: ['Baidu', 'Google', 'DuckDuckGo'],
  用户口碑收集: ['WeChat', 'Toutiao', 'DuckDuckGo', 'Brave'],
  技术趋势调查: ['DuckDuckGo', 'Google', 'Brave'],
  市场数据验证: ['Google', 'Baidu', 'Bing INT'],
}

export function generateIntelligenceBriefing(clusters, articles) {
  if (!clusters?.length) return null
  const total = (articles || []).length

  // 1. 热度 TOP 话题（前 5 分类）
  const topTopics = clusters.slice(0, 5).map((cluster) => ({
    topic: cluster.category,
    count: cluster.count,
    ratio: total > 0 ? Math.round((cluster.count / total) * 1000) / 10 : 0,
    top_article: cluster.articles[0] || null,
  }))

  // 2. 新兴起量话题（占比 <10% 且均互动 >1000）
  const emergingTopics = []
  for (const cluster of clusters) {
    if (cluster.count < total * 0.1 && cluster.articles.length) {
      const avg = cluster.articles.reduce((n, a) => n + (a.likeCount || 0) + (a.commentCount || 0), 0) / Math.max(cluster.articles.length, 1)
      if (avg > 1000) {
        emergingTopics.push({ topic: cluster.category, count: cluster.count, avg_engagement: Math.round(avg) })
      }
    }
  }

  // 3. 核心达人（高产 TOP5）
  const authorCounter = new Map()
  const authorArticles = new Map()
  for (const article of articles || []) {
    const author = article.userName || '未知'
    authorCounter.set(author, (authorCounter.get(author) || 0) + 1)
    if (!authorArticles.has(author)) authorArticles.set(author, [])
    authorArticles.get(author).push(article)
  }
  const topAuthors = [...authorCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([author, count]) => {
      const arts = authorArticles.get(author)
      const totalLikes = arts.reduce((n, a) => n + (a.likeCount || 0), 0)
      const readsWithData = arts.map((a) => a.readCount).filter((r) => r !== null && r !== undefined)
      const totalReads = readsWithData.length ? readsWithData.reduce((a, b) => a + b, 0) : null
      return { name: author, article_count: count, total_likes: totalLikes, total_reads: totalReads }
    })

  // 4. TOP 话题的推荐调查方向（按话题名关键词映射场景）
  const investigationHints = []
  for (const topicInfo of topTopics.slice(0, 3)) {
    const topicName = topicInfo.topic.replace(/^#/, '')
    const hints = []
    if (['大模型', 'GPT', 'ChatGPT'].some((kw) => topicName.includes(kw))) {
      hints.push({ scenario: '技术趋势调查', engines: SCENARIO_ENGINES['技术趋势调查'], keywords: [`${topicName} 最新进展`, `${topicName} 技术对比`, `${topicName} 开源项目`] })
      hints.push({ scenario: '产品竞品分析', engines: SCENARIO_ENGINES['产品竞品分析'], keywords: [`${topicName} 产品对比`, `${topicName} 用户评价`] })
    } else if (['绘画', '创作', '动画'].some((kw) => topicName.includes(kw))) {
      hints.push({ scenario: '用户口碑收集', engines: SCENARIO_ENGINES['用户口碑收集'], keywords: [`${topicName} 工具测评`, `${topicName} 教程推荐`, `AI${topicName} 最新工具`] })
    } else if (['教程', '教学'].some((kw) => topicName.includes(kw))) {
      hints.push({ scenario: '技术趋势调查', engines: SCENARIO_ENGINES['技术趋势调查'], keywords: [`AI${topicName} 学习路线`, `${topicName} 变现方法`] })
    } else {
      hints.push({ scenario: '热点事件追踪', engines: SCENARIO_ENGINES['热点事件追踪'], keywords: [`${topicName} 最新动态`, `${topicName} 行业趋势`] })
    }
    investigationHints.push({ topic: topicInfo.topic, hints })
  }

  // 5. 跨平台对比建议
  const crossPlatformTips = topTopics.slice(0, 3).map((topicInfo) => {
    const topicName = topicInfo.topic.replace(/^#/, '')
    return `「${topicName}」— 建议同步关注抖音、B站、小红书同话题热度，用 Baidu+WeChat+Toutiao 三引擎追踪国内全平台动态`
  })

  return { top_topics: topTopics, emerging_topics: emergingTopics, top_authors: topAuthors, investigation_hints: investigationHints, cross_platform_tips: crossPlatformTips, default_keywords: DEFAULT_KEYWORDS }
}
