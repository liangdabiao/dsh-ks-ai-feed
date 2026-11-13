// 快手爆款日报 · Host 半边（ks_ai 原生工具 + 技能提供方 + 固定输出格式注入 + 面板数据面）。
// 抓取/聚类/情报洞察/HTML 是纯数据操作由工具完成；深度调查与解读由会话模型按技能完成。
import Schema from '@deepseek-ai/schemastery'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { systemSection } from './systemPrompt.js'
import { registerApi } from '../lib/api.js'
import { fetchArticles, resolveApiKey, resolveApiBase, resolveQueryRange, DEFAULT_KEYWORDS, getLatestAvailableDate } from '../lib/redfox.js'
import { clusterArticles } from '../lib/cluster.js'
import { normalizeArticles, dedupeByKey } from '../lib/normalize.js'
import { generateIntelligenceBriefing } from '../lib/insights.js'
import { generateReport, renderCategoryOverview, renderIntelligenceText, formatNumber } from '../lib/report.js'
import { saveReport, getReportMeta, getReportRaw, getBriefing, listReports, deleteReport, saveReportHtml, readReportHtml, getSettings } from '../lib/store.js'

export const name = 'ks-ai-feed' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'systemPrompt', 'webServer', 'connection']

export const Config = Schema.object({
  injectRules: Schema.boolean().default(true).description('注入 快手爆款日报工作流到系统提示'),
  apiKey: Schema.string().default('').description('RedFox API Key（ak_ 开头；留空读面板设置或环境变量 REDFOX_API_KEY）'),
  proxyUrl: Schema.string().default('').description('HTTP(S) 代理（访问 redfox.hk 用），留空直连'),
  defaultKeywords: Schema.string().default('AI,人工智能,大模型,GPT,Agent,AI绘画,AI教程').description('默认关键词（逗号分隔）'),
})

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：固定输出格式（分类概览+情报洞察）' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

const MAX_TEXT = 56000

function parseKeywords(input, fallback) {
  if (!input) return fallback
  const list = String(input).split(/[,，]/).map((k) => k.trim()).filter(Boolean)
  return list.length ? list : fallback
}

function resolveReport(rid) {
  if (rid) {
    const meta = getReportMeta(rid)
    if (!meta) throw new Error(`日报不存在：${rid}。用 history 查看。`)
    return meta
  }
  const [latest] = listReports({ limit: 1 })
  if (!latest) throw new Error('还没有日报。先 fetch。')
  return getReportMeta(latest.report_id)
}

// ---------------------------------------------------------------------------
// 工具：ks_ai —— fetch / clusters / insights / html / history
// ---------------------------------------------------------------------------
export const ksAiTool = {
  name: 'ks_ai',
  description:
    '快手爆款日报：多关键词批量扫描快手 AI 创作内容（默认 7 关键词一次请求，减少 85%+ API 调用），' +
    '按播放量筛选爆款、type/topic 六步智能聚类（泛标签过滤+标题关键词拆分+保底 5 分类），生成深色主题 HTML 日报与情报洞察（热度TOP话题/起量信号/核心达人/推荐调查方向/跨平台对比）。' +
    '每日 15 点更新前一天数据；固定输出格式（分类概览+情报洞察）必须完整输出。需要 RedFox API Key。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('fetch 抓取+聚类+情报；clusters 读分类明细；insights 读情报洞察；html 生成日报；history 历史', {
        enum: ['fetch', 'clusters', 'insights', 'html', 'history'],
      }),
      keywords: str('fetch：关键词逗号分隔（默认 AI,人工智能,大模型,GPT,Agent,AI绘画,AI教程）'),
      count: num('fetch：扫描视频数量，默认 200'),
      date: str('fetch：指定日期 YYYY-MM-DD 或范围 YYYY-MM-DD~YYYY-MM-DD；缺省按 15 点规则自动'),
      reportId: str('clusters/insights/html/history 定位日报；缺省=最新'),
      perCluster: num('clusters：每个分类最多返回几条作品，默认 5'),
    },
  },
  output: OUTPUT,
  async execute(args, ctxConfig) {
    check(args, this.parameters)
    const cfg = ctxConfig || {}

    // ── fetch ────────────────────────────────────────────────────────────
    if (args.action === 'fetch') {
      const settings = getSettings()
      const apiKey = resolveApiKey({ settings, config: cfg })
      if (!apiKey) {
        return result(false, '未配置 RedFox API Key。请用户到面板「快手爆款日报 → 设置」填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://www.redfox.hk/login）。')
      }
      const fallback = parseKeywords(cfg.defaultKeywords, DEFAULT_KEYWORDS)
      const keywords = parseKeywords(args.keywords, fallback)
      const targetCount = Math.min(Math.max(Number(args.count) || 200, 10), 200)
      const { date, startTime, endTime } = resolveQueryRange({ date: args.date })
      const rawArticles = await fetchArticles({
        keywords, targetCount, startTime, endTime, apiKey, apiBase: resolveApiBase({ settings }),
      })
      const articles = normalizeArticles(dedupeByKey(rawArticles))
      const clusters = clusterArticles(articles)
      const briefing = generateIntelligenceBriefing(clusters, articles)
      const readsWithData = articles.map((a) => a.readCount).filter((r) => r !== null && r !== undefined)
      const stats = {
        total: articles.length,
        avg_reads: readsWithData.length ? Math.floor(readsWithData.reduce((a, b) => a + b, 0) / readsWithData.length) : null,
        top_author: '',
        total_likes: articles.reduce((n, a) => n + (a.likeCount || 0), 0),
      }
      const meta = saveReport({ raw: articles, keywords, date, clusters, briefing, stats })
      if (!articles.length) {
        return result(false,
          `未获取到任何作品（关键词组「${keywords.join(',')}」，日期 ${date}）。如实告知用户并建议换关键词或日期，不要编造。`,
          `15 点规则：${date}（${new Date().getHours() >= 15 ? '已过15:00 查昨日' : '未过15:00 查前天'}）`)
      }
      // 固定输出格式（上游强制规范：分类概览 + 情报洞察）
      const overview = renderCategoryOverview(clusters, articles.length)
      const intelText = renderIntelligenceText(briefing)
      const data = [
        `## 快手爆款日报 · ${date} 日报`,
        '',
        `**扫描 ${articles.length} 条热门视频，聚类 ${clusters.length} 个分类**`,
        '',
        '### 分类概览',
        '',
        overview,
        '',
        '### 情报洞察报告',
        '',
        intelText,
      ].join('\n')
      return result(true,
        `日报已入库（reportId=${meta.report_id}，关键词组 ${keywords.length} 个，数据日期 ${date}，${articles.length} 条 / ${clusters.length} 分类）。把上面的固定输出格式完整输出给用户（强制规范不可省略），再问是否生成 HTML 日报（action="html"）或订阅每日推送（dsh 定时任务，先确认频率）。`,
        data.slice(0, MAX_TEXT))
    }

    // ── clusters ─────────────────────────────────────────────────────────
    if (args.action === 'clusters') {
      const meta = resolveReport(args.reportId)
      const raw = getReportRaw(meta.report_id)
      const clusters = clusterArticles(raw || [])
      const per = Math.min(Number(args.perCluster) || 5, 50)
      const lines = [`「${meta.keywords_raw}」${meta.date}：${meta.total} 条 / ${clusters.length} 分类（每分类最多 ${per} 条）`]
      clusters.forEach((c, i) => {
        lines.push(`【${c.category}】${c.count} 条`)
        c.articles.slice(0, per).forEach((a, j) => {
          lines.push(`  ${j + 1}. ${a.title} ｜ ${a.userName || '-'} ｜ 👍${formatNumber(a.likeCount)} 🔄${formatNumber(a.shareCount)} 💬${formatNumber(a.commentCount)} ｜ ${a.photoId ? `https://www.kuaishou.com/short-video/${a.photoId}` : '无链接'}`)
        })
      })
      return result(true, '分类作品明细。', lines.join('\n').slice(0, MAX_TEXT))
    }

    // ── insights ─────────────────────────────────────────────────────────
    if (args.action === 'insights') {
      const meta = resolveReport(args.reportId)
      const raw = getReportRaw(meta.report_id)
      const clusters = clusterArticles(raw || [])
      const briefing = getBriefing(meta.report_id) || generateIntelligenceBriefing(clusters, raw || [])
      const intelText = renderIntelligenceText(briefing)
      return result(true,
        `「${meta.keywords_raw}」${meta.date} 情报洞察（热度TOP/起量信号/核心达人/调查方向/跨平台对比）。`,
        intelText.slice(0, MAX_TEXT))
    }

    // ── html ─────────────────────────────────────────────────────────────
    if (args.action === 'html') {
      const meta = resolveReport(args.reportId)
      const raw = getReportRaw(meta.report_id)
      const clusters = clusterArticles(raw || [])
      const briefing = getBriefing(meta.report_id) || generateIntelligenceBriefing(clusters, raw || [])
      const html = generateReport(clusters, raw || [], meta.date, briefing)
      const file = saveReportHtml(meta.report_id, html)
      return result(true,
        `HTML 日报已生成：${file}。` +
        '桌面端 WebContentsView 会 deny window.open/target=_blank，日报只能在面板内查看——' +
        '告诉用户点侧栏「快手爆款日报」→「报告」页（或该日报页）的「打开 HTML 日报」，' +
        '不要把磁盘路径当成可点开的入口。',
        `报告文件: ${file}\n面板入口: 侧栏「快手爆款日报」→「报告」→「打开日报」`)
    }

    // ── history ──────────────────────────────────────────────────────────
    if (args.action === 'history') {
      const list = listReports({ limit: 20 })
      if (!list.length) return result(false, '还没有日报。先 fetch。')
      const lines = list.map((r) => `${r.report_id}｜「${(r.keywords || []).join(',')}」${r.date}｜${r.total} 条 / ${r.topic_count} 分类${r.has_report ? '｜有报告' : ''}`)
      return result(true, `共 ${list.length} 份日报（新→旧，标「有报告」的可直接打开；入口：面板「报告」页）。对旧日报补 HTML/读明细传 reportId。`, lines.join('\n'))
    }

    throw new Error(`未知 action：${args.action}`)
  },
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  const toolWithConfig = { ...ksAiTool, execute(args) { return ksAiTool.execute(args, config) } }

  ctx.effect(() => ctx.tools.register(toolWithConfig), `${name}: tool`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  if (config.injectRules !== false) {
    ctx.effect(() => ctx.systemPrompt.section(systemSection()), `${name}: workflow`)
  }
  ctx.effect(() => registerApi(ctx, { config }), `${name}: routes`)
}
