// RedFox API · 快手 AI 信息源（POST queryKsAiMsgs/batch 多关键词批量）。
// 移植自 daily_report.py 的 fetch_batch/fetch_articles：3108 退避 5s 重试一次、
// photoId 去重、分页循环（本页无新数据/不足一页即停，最多 10 页）。
import http from 'node:http'
import https from 'node:https'
import { DEFAULT_API_BASE_TOKENS } from './common.js'

export const API_PATH = '/story/api/parseWork/queryKsAiMsgs/batch'
export const SOURCE = '快手爆款日报-dsh'
export const DEFAULT_KEYWORDS = ['AI', '人工智能', '大模型', 'GPT', 'Agent', 'AI绘画', 'AI教程']
export const PAGE_SIZE = 200
export const MAX_PAGES = 10

export function resolveApiKey({ settings = {}, config = {} } = {}) {
  return String(config.apiKey || settings.api_key || process.env.REDFOX_API_KEY || '').trim()
}

export function resolveApiBase({ settings = {} } = {}) {
  const base = String(settings.api_base || process.env.REDFOX_API_BASE || '').trim()
  return (base || DEFAULT_API_BASE_TOKENS).replace(/\/+$/, '')
}

export function httpPostJson(url, body, { timeout = 30_000, headers = {} } = {}) {
  const u = new URL(url)
  const transport = u.protocol === 'http:' ? http : https
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = transport.request({
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'http:' ? 80 : 443),
      method: 'POST',
      path: `${u.pathname}${u.search}`,
      headers: { 'content-type': 'application/json', 'content-length': payload.length, ...headers },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }) }
        catch { reject(new Error(`响应不是合法 JSON（HTTP ${res.statusCode}）：${text.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => req.destroy(new Error(`请求超时（${timeout}ms）`)))
    req.end(payload)
  })
}

export function friendlyApiError(json) {
  const code = json?.code
  const msg = String(json?.msg || json?.message || '')
  if (code === 3106 || code === 3107) return new Error(`RedFox API Key 错误（${code}）：请检查面板「设置」页的 Key。${msg}`)
  if (code === 3201 || msg.includes('积分不足')) return new Error('RedFox 账户积分不足（3201）：请到 https://redfox.hk/dashboard/recharge 充值后重试。')
  if (code === 3203 || msg.includes('付费调用')) return new Error(`RedFox 接口返回 3203（上游原话：${msg || '无'}）：常见原因 ①该接口需单独开通或积分不足 ②同一 Key 请求过密被拦截 ③参数（关键词/日期/翻页）未被接受。已自动重试一次；仍失败请到 https://redfox.hk/dashboard/recharge 核对积分与接口授权，或等 1-2 分钟再试。`)
  if (code === 3108) return new Error('RedFox 限频（3108），稍等片刻再试。')
  if (code === 401 || code === 403) return new Error(`RedFox 鉴权失败（${code}）：请检查 API Key。`)
  return new Error(`API 错误（code=${code ?? '?'}）：${msg || JSON.stringify(json).slice(0, 200)}`)
}

// 15 点日期规则（上游 get_latest_available_date）：≥15 点查昨天，<15 点查前天
export function getLatestAvailableDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  const back = now.getHours() >= 15 ? 1 : 2
  return fmt(new Date(now.getTime() - back * 86400_000))
}

// date 支持 YYYY-MM-DD 或范围 YYYY-MM-DD~YYYY-MM-DD（拆成 startTime/endTime，开始含、结束不含）
export function resolveQueryRange({ date, startTime, endTime, now = new Date() } = {}) {
  if (startTime && endTime) return { date: String(date || startTime), startTime, endTime }
  const target = date || getLatestAvailableDate(now)
  if (target.includes('~')) {
    const [s, e] = target.split('~').map((x) => x.trim())
    const endExclusive = fmtPlus1(e)
    return { date: target, startTime: `${s} 00:00:00`, endTime: `${endExclusive} 00:00:00` }
  }
  return { date: target, startTime: `${target} 00:00:00`, endTime: `${fmtPlus1(target)} 00:00:00` }
}

function fmtPlus1(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  const pad = (n) => String(n).padStart(2, '0')
  const next = new Date(d.getTime() + 86400_000)
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
}

// 单页批量请求（3108 退避重试一次）
export async function fetchBatch({ keywords, pageNum = 1, startTime, endTime, apiKey, apiBase, timeout = 30_000 } = {}) {
  if (!apiKey) {
    throw new Error('未配置 RedFox API Key。请到面板「设置」页填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://www.redfox.hk/login）。')
  }
  const payload = { keywords, pageNum, pageSize: PAGE_SIZE, source: SOURCE }
  if (startTime) payload.startTime = startTime
  if (endTime) payload.endTime = endTime
  const requestOnce = async () => {
    const { json } = await httpPostJson(`${apiBase}${API_PATH}`, payload, {
      timeout, headers: { 'X-API-KEY': apiKey },
    })
    return json
  }
  let result = await requestOnce()
  if (result?.code === 3108 || result?.code === 3203) {
    await new Promise((r) => setTimeout(r, result?.code === 3108 ? 5000 : 2500))
    result = await requestOnce()
  }
  if (result?.code !== 200 && result?.code !== 2000) throw friendlyApiError(result)
  return result?.data?.list || []
}

// 多关键词批量分页抓取（去重、最多 10 页，对齐上游 fetch_articles）
export async function fetchArticles({ keywords, targetCount = 200, startTime, endTime, apiKey, apiBase, timeout } = {}) {
  const kws = (Array.isArray(keywords) ? keywords : DEFAULT_KEYWORDS).map((k) => String(k).trim()).filter(Boolean)
  if (!kws.length) throw new Error('keywords 为空。')
  const articles = []
  const seenIds = new Set()
  let pageNum = 1
  for (;;) {
    const pageArticles = await fetchBatch({ keywords: kws, pageNum, startTime, endTime, apiKey, apiBase, timeout })
    if (!pageArticles.length) break
    let newCount = 0
    for (const article of pageArticles) {
      const pid = String(article?.photoId || '')
      if (pid && seenIds.has(pid)) continue
      if (pid) seenIds.add(pid)
      articles.push(article)
      newCount++
    }
    if (newCount === 0 || pageArticles.length < PAGE_SIZE) break
    if (articles.length >= targetCount) break
    pageNum++
    if (pageNum > MAX_PAGES) break
  }
  return articles
}
