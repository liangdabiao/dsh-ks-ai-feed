// 六步智能聚类：type/topic 标签（泛标签过滤）→ 大组>20% 二次拆分 → 小组(<3)并入 →
// 标题关键词拆分（最多 3 轮）→ 保底 5 分类 → 按条数降序输出（组内按播放降序 TOP5）。
// 逐行对齐 ks-ai-feed daily_report.py 的 extract_keywords/get_article_tags/cluster_articles。
import { normalizeArticles, dedupeByKey } from './normalize.js'

export const DEFAULT_KEYWORDS = ['AI', '人工智能', '大模型', 'GPT', 'Agent', 'AI绘画', 'AI教程']

// ─── 停用词与泛标签（上游 STOP_WORDS / GENERIC_TAGS）──────────────────────
const STOP_WORDS = new Set('的了是在和与及或但对于从到被将把让给用有这那个也都还又不没'
  + '就才能会要可以怎么什么为什么怎样如何哪些多少一个一些这些那些'
  + '已经正在可能应该必须需要通过进行使用利用根据关于对于由于因为所以'
  + '虽然但是然而因此所以如果那么只要只有无论不管即使不仅而且'.split(''))

export const GENERIC_TAGS = new Set(['#AI', '#人工智能', '#ai', 'AI', '人工智能', '#科技', '#技术',
  '#人工智能应用', '#智能', '科技', '技术'])

export function extractKeywords(title) {
  if (!title) return []
  const cleaned = String(title).replace(/[^\u4e00-\u9fff\w]/g, ' ')
  const segments = cleaned.match(/[\u4e00-\u9fff]{2,4}/g) || []
  return segments.filter((s) => ![...s].every((c) => STOP_WORDS.has(c))).slice(0, 5)
}

export function getArticleTags(article) {
  const tags = []
  const atype = String(article?.type || '').trim()
  if (atype) {
    for (const t of atype.split(/[,，]+/)) {
      const tag = t.trim()
      if (tag && !GENERIC_TAGS.has(tag)) tags.push(tag)
    }
  }
  const topic = String(article?.topic || '').trim()
  if (topic) {
    for (const t of topic.split(/[,，\s]+/)) {
      const tag = t.trim()
      if (tag && !GENERIC_TAGS.has(tag) && !tags.includes(tag)) tags.push(tag)
    }
  }
  return tags
}

const reads = (a) => a?.readCount || 0

export function clusterArticles(articles) {
  const total = (articles || []).length
  if (!total) return []

  // 第一步：按首个非泛标签分组
  const topicGroups = new Map()
  for (const article of articles) {
    const tags = getArticleTags(article)
    const cat = tags[0] || '其他'
    if (!topicGroups.has(cat)) topicGroups.set(cat, [])
    topicGroups.get(cat).push(article)
  }

  // 第二步：大组 > max(20%, 25) 按第二标签拆分
  const splitThreshold = Math.max(total * 0.2, 25)
  for (const [topic, arts] of [...topicGroups.entries()]) {
    if (arts.length > splitThreshold && topic !== '其他') {
      topicGroups.delete(topic)
      for (const article of arts) {
        const tags = getArticleTags(article)
        const sub = tags.length >= 2 ? tags[1] : topic
        if (!topicGroups.has(sub)) topicGroups.set(sub, [])
        topicGroups.get(sub).push(article)
      }
    }
  }

  // 第三步：合并小组（<3 篇）——小组成视频尝试标签匹配进已有大组
  const finalGroups = new Map()
  let smallArticles = []
  for (const [topic, arts] of topicGroups) {
    if (arts.length >= 3) finalGroups.set(topic, arts)
    else smallArticles.push(...arts)
  }
  const stillOrphan = []
  for (const article of smallArticles) {
    const tags = getArticleTags(article)
    const hit = tags.find((t) => finalGroups.has(t))
    if (hit) finalGroups.get(hit).push(article)
    else stillOrphan.push(article)
  }
  if (stillOrphan.length) {
    const arr = finalGroups.get('其他') || []
    finalGroups.set('其他', [...arr, ...stillOrphan])
  }

  // 第四步：过大组（> max(30%, 40)）用标题高频关键词拆分（最多 3 轮）
  const MAX_GROUP_SIZE = Math.max(total * 0.3, 40)
  const counter = (arr) => {
    const m = new Map()
    for (const v of arr) m.set(v, (m.get(v) || 0) + 1)
    return m
  }
  for (let round = 0; round < 3; round++) {
    const oversized = [...finalGroups.entries()].filter(([t, a]) => a.length > MAX_GROUP_SIZE)
    if (!oversized.length) break
    for (const [topic, arts] of oversized) {
      const kwCounter = new Map()
      const articleKwMap = new Map()
      for (const article of arts) {
        const kws = extractKeywords(article.title)
        articleKwMap.set(article, kws)
        for (const kw of kws) kwCounter.set(kw, (kwCounter.get(kw) || 0) + 1)
      }
      const commonKws = [...kwCounter.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .filter(([kw, cnt]) => cnt >= 5 && !topic.includes(kw)
          && !GENERIC_TAGS.has(`#${kw}`)
          && !['人工智能', '智能', '模型', '技术', '应用'].includes(kw))
        .map(([kw]) => kw)
      if (!commonKws.length) continue
      const splitKw = commonKws[0]
      const newGroup = []
      const remaining = []
      for (const article of arts) {
        (articleKwMap.get(article) || []).includes(splitKw) ? newGroup.push(article) : remaining.push(article)
      }
      if (newGroup.length >= 5) {
        finalGroups.set(`#${splitKw}`, newGroup)
        finalGroups.set(topic, remaining)
      }
    }
  }

  // 第五步：保底 5 分类（对最大组按第二标签继续拆，防死循环）
  let attempts = 0
  while (finalGroups.size < 5 && finalGroups.size && attempts < 10) {
    attempts++
    const largestTopic = [...finalGroups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0]
    const largestArts = finalGroups.get(largestTopic)
    if (largestArts.length < 6) break
    const subGroups = new Map()
    const remain = []
    for (const article of largestArts) {
      const tags = getArticleTags(article)
      const second = tags.find((t) => t !== largestTopic)
      if (second) {
        if (!subGroups.has(second)) subGroups.set(second, [])
        subGroups.get(second).push(article)
      } else remain.push(article)
    }
    if (subGroups.size) {
      const bestSub = [...subGroups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0]
      if (subGroups.get(bestSub).length >= 3 && bestSub !== largestTopic) {
        // 上游 bug 修复：bestSub 撞已有组名时合并（上游 set 直接覆盖丢条目）
        const existing = finalGroups.get(bestSub) || []
        finalGroups.set(bestSub, [...subGroups.get(bestSub), ...existing])
        const newArts = [...remain]
        for (const [k, v] of subGroups) if (k !== bestSub) newArts.push(...v)
        finalGroups.set(largestTopic, newArts)
        continue
      }
    }
    break
  }

  // 第六步：按条数降序输出（组内按播放降序 TOP5，跳过空分类）
  const clusters = []
  for (const [category, arts] of [...finalGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (!arts.length) continue
    const sorted = [...arts].sort((a, b) => reads(b) - reads(a)).slice(0, 5)
    clusters.push({ category, count: arts.length, articles: sorted })
  }
  return clusters
}

export { normalizeArticles, dedupeByKey }
