// HTML 日报生成：复用上游 assets/report_template.html（深色快手橙主题），占位符填充。
// 移植自 daily_report.py 的 generate_report/generate_category_cards/generate_intelligence_html/format_number。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'report_template.html')

const esc = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function formatNumber(n) {
  if (n === null || n === undefined) return '0'
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// 分区卡片（每分类 TOP5，封面图 + 互动 + 直链）
const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'] // 🥇🥈🥉 组内排名前三

function generateCategoryCards(clusters) {
  let cardsHtml = ''
  clusters.forEach((cluster, i) => {
    let articlesHtml = ''
    for (const [rank, article] of (cluster.articles || []).entries()) {
      const title = esc(article.title || '无标题')
      const medal = MEDALS[rank] || ''
      const url = article.photoId ? `https://www.kuaishou.com/short-video/${article.photoId}` : '#'
      const author = esc(article.userName || '')
      const cover = article.coverUrl || ''
      const likes = formatNumber(article.likeCount)
      const shares = formatNumber(article.shareCount)
      const comments = formatNumber(article.commentCount)
      const coverHtml = cover
        ? `<img class="article-cover" src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : ''
      articlesHtml += `
                <div class="article-item">
                    ${coverHtml}
                    <div class="article-info">
                        <a href="${esc(url)}" target="_blank" rel="noreferrer" class="article-title">${medal ? `${medal} ` : ''}${title}</a>
                        <div class="article-meta">
                            <span class="author">${author}</span>
                            <span class="metrics">
                                <span class="metric">&#x1f44d; ${likes}</span>
                                <span class="metric">&#x1f501; ${shares}</span>
                                <span class="metric">&#x1f4ac; ${comments}</span>
                            </span>
                        </div>
                    </div>
                </div>`
    }
    cardsHtml += `
        <div class="category-card reveal">
            <div class="card-header">
                <span class="card-number">${String(i + 1).padStart(2, '0')}</span>
                <h3 class="card-category">${esc(cluster.category)}</h3>
                <span class="card-count">${cluster.count} 条</span>
            </div>
            <div class="card-body">${articlesHtml}
            </div>
        </div>`
  })
  return cardsHtml
}

// 情报洞察板块（INTELLIGENCE_SECTION）
function generateIntelligenceHtml(briefing) {
  if (!briefing) return ''

  let topicsHtml = ''
  briefing.top_topics.forEach((topic, i) => {
    const topArt = topic.top_article
    const topTitle = topArt ? esc(String(topArt.title || '-').slice(0, 50)) : '-'
    const topReads = topArt?.readCount
    const topReadsMetric = topReads ? `${formatNumber(topReads)} 播放` : ''
    topicsHtml += `
                <div class="intel-rank-item">
                    <span class="intel-rank-num">${i + 1}</span>
                    <div class="intel-rank-info">
                        <span class="intel-rank-topic">${esc(topic.topic)}</span>
                        <span class="intel-rank-detail">占比 ${topic.ratio}% · ${topic.count}条 · 头部: ${topTitle}</span>
                    </div>
                    <span class="intel-rank-metric">${topReadsMetric}</span>
                </div>`
  })

  let emergingHtml = ''
  for (const topic of briefing.emerging_topics || []) {
    emergingHtml += `
                <div class="intel-emerging-item">
                    <span class="intel-emerging-badge">起量信号</span>
                    <span class="intel-emerging-topic">${esc(topic.topic)}</span>
                    <span class="intel-emerging-detail">${topic.count}条 · 均互动${topic.avg_engagement}+</span>
                </div>`
  }
  const emergingSection = emergingHtml
    ? `
        <div class="intel-subsection">
            <h4 class="intel-subtitle">新兴起量信号</h4>
            <div class="intel-emerging-list">${emergingHtml}
            </div>
        </div>`
    : ''

  let authorsHtml = ''
  for (const author of briefing.top_authors || []) {
    const readsPart = author.total_reads ? ` · 总播${formatNumber(author.total_reads)}` : ''
    authorsHtml += `
                <div class="intel-author-item">
                    <span class="intel-author-name">@${esc(author.name)}</span>
                    <span class="intel-author-stats">${author.article_count}条 · 总赞${formatNumber(author.total_likes)}${readsPart}</span>
                </div>`
  }
  const authorsSection = authorsHtml
    ? `
        <div class="intel-subsection">
            <h4 class="intel-subtitle">核心达人</h4>
            <div class="intel-author-list">${authorsHtml}
            </div>
        </div>`
    : ''

  let hintsHtml = ''
  for (const hintGroup of briefing.investigation_hints || []) {
    let hintItems = ''
    for (const hint of hintGroup.hints) {
      const enginesStr = hint.engines.join(' + ')
      const kwList = hint.keywords.slice(0, 2).join(' | ')
      hintItems += `
                    <div class="intel-hint-item">
                        <span class="intel-hint-scenario">${esc(hint.scenario)}</span>
                        <span class="intel-hint-engines">${esc(enginesStr)}</span>
                        <span class="intel-hint-kw">${esc(kwList)}</span>
                    </div>`
    }
    hintsHtml += `
            <div class="intel-hint-group">
                <div class="intel-hint-topic">${esc(hintGroup.topic)}</div>${hintItems}
            </div>`
  }
  const hintsSection = hintsHtml
    ? `
        <div class="intel-subsection">
            <h4 class="intel-subtitle">推荐调查方向</h4>
            <div class="intel-hint-list">${hintsHtml}
            </div>
        </div>`
    : ''

  let tipsHtml = ''
  for (const tip of briefing.cross_platform_tips || []) {
    tipsHtml += `• ${esc(tip)}<br>`
  }
  const tipsSection = tipsHtml
    ? `
        <div class="intel-subsection">
            <h4 class="intel-subtitle">跨平台对比建议</h4>
            <div class="intel-tips">${tipsHtml}</div>
        </div>`
    : ''

  return `
        <div class="intel-subsection">
            <h4 class="intel-subtitle">热度TOP话题</h4>
            <div class="intel-rank-list">${topicsHtml}
            </div>
        </div>${emergingSection}${authorsSection}${hintsSection}${tipsSection}`
}

function dateCn(dateStr) {
  try {
    const dt = new Date(`${dateStr.split('~')[0].trim()}T00:00:00`)
    if (Number.isNaN(dt.getTime())) return dateStr
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 星期${weekdays[dt.getDay()]}`
  } catch {
    return dateStr
  }
}

/**
 * 生成完整 HTML 日报。
 * @param clusters clusterArticles() 输出（每分类 TOP5 articles）
 * @param articles 全部作品（统计口径）
 * @param dateStr 数据日期
 * @param briefing generateIntelligenceBriefing() 输出
 * @param opts { templateHtml }
 */
export function generateReport(clusters, articles, dateStr, briefing = null, opts = {}) {
  let template = opts.templateHtml
  if (!template) {
    try { template = readFileSync(TEMPLATE_PATH, 'utf8') } catch { template = FALLBACK_TEMPLATE }
  }

  const total = (articles || []).length
  const readsWithData = (articles || []).map((a) => a.readCount).filter((r) => r !== null && r !== undefined)
  const avgReads = readsWithData.length ? Math.floor(readsWithData.reduce((a, b) => a + b, 0) / readsWithData.length) : null
  const authorCounter = new Map()
  for (const a of articles || []) {
    const name = a.userName || '未知'
    authorCounter.set(name, (authorCounter.get(name) || 0) + 1)
  }
  const topAuthor = [...authorCounter.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
  const totalLikes = (articles || []).reduce((n, a) => n + (a.likeCount || 0), 0)

  const categoryCards = generateCategoryCards(clusters)
  const intelligenceHtml = generateIntelligenceHtml(briefing)
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')

  return template
    .replace(/\{\{DATE\}\}/g, esc(dateStr))
    .replace(/\{\{DATE_CN\}\}/g, esc(dateCn(dateStr)))
    .replace(/\{\{TOTAL_COUNT\}\}/g, String(total))
    .replace(/\{\{TOPIC_COUNT\}\}/g, String(clusters.length))
    .replace(/\{\{TOTAL_LIKES\}\}/g, formatNumber(totalLikes))
    .replace(/\{\{AVG_READS\}\}/g, avgReads !== null ? formatNumber(avgReads) : '—')
    .replace(/\{\{CATEGORY_CARDS\}\}/g, categoryCards)
    .replace(/\{\{INTELLIGENCE_SECTION\}\}/g, intelligenceHtml)
    .replace(/\{\{TIMESTAMP\}\}/g, esc(timestamp))
    .replace(/\{\{[A-Z_]+\}\}/g, '') // 残留占位符兜底
}

// 对话用分类概览表（固定输出格式第一块）
export function renderCategoryOverview(clusters, total) {
  const lines = ['| 分类 | 数量 | 占比 | 亮点 |', '|------|------|------|------|']
  for (const c of clusters) {
    const ratio = total > 0 ? Math.round((c.count / total) * 100) : 0
    const top = c.articles[0]
    const highlight = top ? esc(String(top.title || '').slice(0, 30)) : '暂无'
    lines.push(`| ${esc(c.category)} | ${c.count}条 | ${ratio}% | ${highlight} |`)
  }
  return lines.join('\n')
}

// 情报洞察对话文本（固定输出格式第二块）
export function renderIntelligenceText(briefing) {
  if (!briefing) return '暂无情报数据'
  const out = []
  out.push('**一、新兴起量信号**')
  if (briefing.emerging_topics?.length) {
    for (const t of briefing.emerging_topics) {
      out.push(`- 🔥 **${t.topic}** — 仅${t.count}条但均互动${t.avg_engagement}+，值得深挖`)
    }
  } else {
    out.push('- 暂无')
  }
  out.push('')
  out.push('**二、核心达人**')
  if (briefing.top_authors?.length) {
    out.push('| 达人 | 作品数 | 总赞 | 亮点 |')
    out.push('|------|--------|------|------|')
    for (const a of briefing.top_authors) {
      out.push(`| @${esc(a.name)} | ${a.article_count}条 | ${formatNumber(a.total_likes)} | 高产创作者 |`)
    }
  } else {
    out.push('- 暂无')
  }
  out.push('')
  out.push('**三、推荐调查方向**')
  out.push('| 话题 | 调查场景 | 推荐引擎 | 搜索关键词 |')
  out.push('|------|---------|---------|-----------|')
  for (const hintGroup of briefing.investigation_hints || []) {
    for (const hint of hintGroup.hints.slice(0, 1)) {
      out.push(`| ${esc(hintGroup.topic)} | ${esc(hint.scenario)} | ${esc(hint.engines.join(' + '))} | ${esc(hint.keywords.slice(0, 2).join(' / '))} |`)
    }
  }
  out.push('')
  out.push('**四、跨平台对比建议**')
  for (const tip of briefing.cross_platform_tips || []) {
    out.push(`- **${esc(tip)}**`)
  }
  return out.join('\n')
}

// 内置兜底模板（assets 缺失时）
const FALLBACK_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>快手爆款日报 - {{DATE}}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, sans-serif; background: #1a1a1a; color: #e8e4df; padding: 2rem; }
.header { text-align: center; padding: 2rem 0; }
.header h1 { font-size: 2rem; color: #ff5000; }
.stats { display: flex; justify-content: center; gap: 2rem; padding: 1rem; margin: 1rem 0; }
.stat-item { text-align: center; }
.stat-value { font-size: 1.5rem; font-weight: bold; color: #ff5000; }
.stat-label { font-size: 0.8rem; color: #9a9590; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1.5rem; max-width: 1200px; margin: 2rem auto; }
.category-card { background: #2d2d2d; border-radius: 12px; overflow: hidden; }
.card-header { display: flex; align-items: center; gap: 0.8rem; padding: 1rem 1.2rem; background: linear-gradient(135deg, #ff5000, #ffbe00); }
.card-number { font-size: 1.5rem; font-weight: bold; color: rgba(0,0,0,0.3); }
.card-category { flex: 1; font-size: 1.1rem; font-weight: 700; color: #fff; }
.card-count { font-size: 0.8rem; color: rgba(255,255,255,0.8); background: rgba(0,0,0,0.2); padding: 0.2rem 0.6rem; border-radius: 10px; }
.card-body { padding: 0.8rem 1.2rem; max-height: 520px; overflow-y: auto; }
.article-item { padding: 0.6rem 0; border-bottom: 1px solid #3d3d3d; display: flex; gap: 0.8rem; }
.article-cover { width: 72px; height: 72px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.article-title { color: #e8e4df; text-decoration: none; font-size: 0.9rem; }
.article-title:hover { color: #ff5000; }
.article-meta { display: flex; justify-content: space-between; margin-top: 0.3rem; font-size: 0.75rem; color: #9a9590; }
.metrics { display: flex; gap: 0.8rem; }
.intel-subsection { margin: 1.5rem 0; }
.intel-subtitle { color: #ffbe00; margin-bottom: 0.5rem; }
.intel-author-name { color: #ffbe00; font-weight: 600; }
.intel-author-stats { color: #9a9590; margin-left: 0.5rem; }
.intel-author-item { padding: 0.3rem 0; }
.footer { text-align: center; padding: 2rem; color: #666; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="header">
    <h1>快手爆款日报</h1>
    <p>{{DATE_CN}} | 共 {{TOTAL_COUNT}} 条热门视频</p>
</div>
<div class="stats">
    <div class="stat-item"><div class="stat-value">{{TOPIC_COUNT}}</div><div class="stat-label">分类</div></div>
    <div class="stat-item"><div class="stat-value">{{TOTAL_COUNT}}</div><div class="stat-label">视频</div></div>
    <div class="stat-item"><div class="stat-value">{{TOTAL_LIKES}}</div><div class="stat-label">总点赞</div></div>
    <div class="stat-item"><div class="stat-value">{{AVG_READS}}</div><div class="stat-label">平均播放</div></div>
</div>
<div class="cards">{{CATEGORY_CARDS}}</div>
{{INTELLIGENCE_SECTION}}
<div class="footer">Generated at {{TIMESTAMP}} by 快手爆款日报 Skill</div>
</body>
</html>`
