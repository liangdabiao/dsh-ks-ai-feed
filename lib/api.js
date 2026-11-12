// 面板数据面：/ks-ai-feed 前缀路由（日报查询 + 分类 + 情报 + 报告 + 设置；情报解读走 agent 对话）。
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listReports, deleteReport, getSettings, saveSettings, getReportMeta, getReportRaw,
  getBriefing, saveReportHtml, readReportHtml, DATA_DIR,
} from './store.js'
import { fetchArticles, resolveApiKey, resolveApiBase, resolveQueryRange, DEFAULT_KEYWORDS } from './redfox.js'
import { clusterArticles } from './cluster.js'
import { normalizeArticles, dedupeByKey } from './normalize.js'
import { generateIntelligenceBriefing } from './insights.js'
import { generateReport } from './report.js'

const BASE = '/ks-ai-feed'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
}

function json(res, statusCode, value) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false
  return connection.requestRejection({ headers: req.headers })
}

function safeFile(dir, rel) {
  if (!dir || String(rel).split('/').some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(dir) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serveFile(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

function readJson(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > max) req.destroy(); else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

function readVersion() {
  try { return JSON.parse(readFileSync(join(LAB, '..', 'package.json'), 'utf8')).version } catch { return '' }
}

function catalog() {
  const settings = getSettings()
  const kws = settings.default_keywords || DEFAULT_KEYWORDS
  return {
    version: readVersion(),
    dataDir: DATA_DIR,
    has_key: Boolean(settings.api_key || process.env.REDFOX_API_KEY),
    key_source: settings.api_key ? 'settings' : (process.env.REDFOX_API_KEY ? 'env' : 'none'),
    default_keywords: kws,
    latest_available_date: require15Rule(settings),
    reports: listReports({ limit: 50 }),
    settings: { proxy_url: settings.proxy_url || '', api_base: settings.api_base || '' },
  }
}

function require15Rule() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  const back = now.getHours() >= 15 ? 1 : 2
  return { date: fmt(new Date(now.getTime() - back * 86400_000)), rule: now.getHours() >= 15 ? '已过15:00，查昨日' : '未过15:00，查前天' }
}

// 面板/工具共用的抓取链路（抓取→聚类→情报→入库）
async function runFetch(body, hooks) {
  const settings = getSettings()
  const apiKey = resolveApiKey({ settings, config: hooks.config })
  if (!apiKey) throw Object.assign(new Error('未配置 RedFox API Key（设置页或插件配置/环境变量 REDFOX_API_KEY）'), { status: 400 })
  const kws = Array.isArray(body.keywords) && body.keywords.length
    ? body.keywords.map(String).map((k) => k.trim()).filter(Boolean)
    : (settings.default_keywords || DEFAULT_KEYWORDS)
  const targetCount = Math.min(Math.max(Number(body.count) || 200, 10), 200)
  const { date, startTime, endTime } = resolveQueryRange({ date: body.date, now: new Date() })
  const rawArticles = await fetchArticles({
    keywords: kws, targetCount, startTime, endTime, apiKey,
    apiBase: resolveApiBase({ settings }),
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
  const { saveReport } = await import('./store.js')
  const meta = saveReport({ raw: articles, keywords: kws, date, clusters, briefing, stats })
  return { meta, clusters, briefing, stats, articles }
}

export function registerApi(ctx, hooks = {}) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        if (!url.pathname.startsWith(BASE + '/') && url.pathname !== BASE) return json(res, 404, { error: 'not found' })
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        if (path === '/api/catalog' && req.method === 'GET') return json(res, 200, catalog())

        if (path === '/api/reports' && req.method === 'GET') return json(res, 200, { reports: listReports({ limit: 100 }) })

        if (path === '/api/reports' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const result = await runFetch(body, hooks)
            return json(res, 200, { ok: true, report: result.meta, clusters: result.clusters, briefing: result.briefing, stats: result.stats })
          } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
        }

        const rMatch = path.match(/^\/api\/reports\/([^/]+)(\/.*)?$/)
        if (rMatch) {
          const rid = rMatch[1]
          const sub = rMatch[2] || ''
          const meta = getReportMeta(rid)
          if (!meta) return json(res, 404, { error: `日报不存在: ${rid}` })
          if (!sub && req.method === 'GET') {
            const raw = getReportRaw(rid)
            const briefing = getBriefing(rid)
            return json(res, 200, { report: meta, clusters: clusterArticles(raw || []), briefing, raw })
          }
          if (!sub && req.method === 'DELETE') return json(res, 200, deleteReport(rid))
          if (sub === '/report' && (req.method === 'GET' || req.method === 'HEAD')) {
            const file = readReportHtml(rid)
            if (!file) return json(res, 404, { error: '日报还没生成——在对话里让 agent 跑 ks_ai(action="html")' })
            return serveFile(req, res, file)
          }
          if (sub === '/report' && req.method === 'POST') {
            try {
              await readJson(req).catch(() => ({}))
              const raw = getReportRaw(rid)
              const clusters = clusterArticles(raw || [])
              const briefing = getBriefing(rid)
              const html = generateReport(clusters, raw || [], meta.date, briefing)
              const file = saveReportHtml(rid, html)
              return json(res, 200, { ok: true, file })
            } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
          }
          return json(res, 404, { error: 'not found' })
        }

        if (path === '/api/settings' && req.method === 'GET') {
          const settings = getSettings()
          const key = String(settings.api_key || '')
          return json(res, 200, {
            settings: {
              has_key: Boolean(key || process.env.REDFOX_API_KEY),
              key_tail: key ? key.slice(-6) : '',
              from_env: Boolean(process.env.REDFOX_API_KEY),
              default_keywords: settings.default_keywords || DEFAULT_KEYWORDS,
              proxy_url: settings.proxy_url || '',
              api_base: settings.api_base || '',
            },
          })
        }
        if (path === '/api/settings' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const patch = {}
            if (body.api_key !== undefined) {
              const key = String(body.api_key).trim()
              if (key && !key.startsWith('ak_')) return json(res, 400, { ok: false, error: 'RedFox API Key 以 ak_ 开头，请检查' })
              patch.api_key = key
            }
            if (body.default_keywords !== undefined) {
              patch.default_keywords = Array.isArray(body.default_keywords)
                ? body.default_keywords.map(String).map((k) => k.trim()).filter(Boolean)
                : String(body.default_keywords).split(/[,，]/).map((k) => k.trim()).filter(Boolean)
            }
            if (body.proxy_url !== undefined) patch.proxy_url = String(body.proxy_url).trim()
            if (body.api_base !== undefined) patch.api_base = String(body.api_base).trim()
            const next = saveSettings(patch)
            return json(res, 200, { ok: true, has_key: Boolean(next.api_key || process.env.REDFOX_API_KEY) })
          } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
        }
        if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' })

        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' })
        const file = safeFile(LAB, path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
        return file ? serveFile(req, res, file) : json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err?.message || '内部错误' })
      }
    },
  })
}
