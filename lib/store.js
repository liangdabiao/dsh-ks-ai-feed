// AI 快手日报 · 数据层。
//   $DSH_HOME/ks-ai-feed/
//   ├── settings.json        api_key / api_base(测试用) / default_keywords
//   ├── reports/index.json   日报索引（新→旧；同关键词组+日期覆盖）
//   └── reports/<rid>/
//       ├── raw.json         原始作品数组
//       ├── meta.json        关键词组/日期/统计/聚类数
//       ├── briefing.json    情报洞察
//       └── report.html      深色主题 HTML 日报
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'ks-ai-feed')
const REPORTS_DIR = join(DATA_DIR, 'reports')
const INDEX_FILE = join(REPORTS_DIR, 'index.json')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')

const nowIso = () => new Date().toISOString()

function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(REPORTS_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function getSettings() {
  return readJson(SETTINGS_FILE, {}) || {}
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch, updated_at: nowIso() }
  writeJson(SETTINGS_FILE, next)
  return next
}

function reportDir(rid) {
  const safe = String(rid).replace(/[^\p{L}\p{N}_-]+/gu, '')
  if (!safe || safe !== String(rid)) throw new Error('非法日报 id')
  const dir = join(REPORTS_DIR, safe)
  if (normalize(dir) !== normalize(join(REPORTS_DIR, safe))) throw new Error('非法日报 id')
  return dir
}

function getReportIndex() {
  return readJson(INDEX_FILE, []) || []
}

export function saveReport({ raw, keywords, date, clusters, briefing, stats }) {
  const kwKey = Array.isArray(keywords) ? keywords.join(',') : String(keywords)
  // 索引里 keywords 存的是数组，比较统一用 keywords_raw 字符串
  const prev = getReportIndex().find((i) => (i.keywords_raw ?? (Array.isArray(i.keywords) ? i.keywords.join(',') : i.keywords)) === kwKey && i.date === date)
  const ts = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const kwSlug = kwKey.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 20) || 'kw'
  const rid = prev ? prev.report_id : `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}${String(ts.getMilliseconds()).padStart(3, '0')}-${kwSlug}-${date}`
  const dir = reportDir(rid)
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'raw.json'), raw)
  const meta = {
    report_id: rid,
    keywords: Array.isArray(keywords) ? keywords : [String(keywords)],
    keywords_raw: kwKey,
    date,
    total: stats.total,
    topic_count: clusters.length,
    total_likes: stats.total_likes,
    avg_reads: stats.avg_reads,
    top_author: stats.top_author,
    created_at: nowIso(),
  }
  writeJson(join(dir, 'meta.json'), meta)
  if (briefing) writeJson(join(dir, 'briefing.json'), briefing)
  const index = getReportIndex().filter((i) => i.report_id !== rid)
  index.unshift({ report_id: rid, keywords: meta.keywords, keywords_raw: kwKey, date, total: meta.total, topic_count: meta.topic_count, created_at: meta.created_at })
  writeJson(INDEX_FILE, index.slice(0, 100))
  return meta
}

export function getReportMeta(rid) {
  return readJson(join(reportDir(rid), 'meta.json'))
}

export function getReportRaw(rid) {
  return readJson(join(reportDir(rid), 'raw.json'))
}

export function getBriefing(rid) {
  return readJson(join(reportDir(rid), 'briefing.json'))
}

export function listReports({ limit = 50 } = {}) {
  return getReportIndex().slice(0, limit)
}

export function saveReportHtml(rid, html) {
  const dir = reportDir(rid)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'report.html')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, html, 'utf8')
  renameSync(tmp, file)
  return file
}

export function readReportHtml(rid) {
  const file = join(reportDir(rid), 'report.html')
  return existsSync(file) ? file : null
}

export function deleteReport(rid) {
  const dir = reportDir(rid)
  if (!existsSync(dir)) return { ok: false, error: `日报不存在: ${rid}` }
  rmSync(dir, { recursive: true, force: true })
  writeJson(INDEX_FILE, getReportIndex().filter((i) => i.report_id !== rid))
  return { ok: true }
}
