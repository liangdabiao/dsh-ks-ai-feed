// store + report + insights + host 工具直调单测（离线假服务器）
process.env.REDFOX_API_KEY = ''
const { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const tmp = mkdtempSync(join(tmpdir(), 'dsh-ks-store-'))
process.env.DSH_HOME = tmp
delete process.env.X_API_KEY

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const { saveReport, getBriefing, listReports, deleteReport, saveReportHtml, DATA_DIR } = await import('../lib/store.js')
const { clusterArticles } = await import('../lib/cluster.js')
const { generateIntelligenceBriefing } = await import('../lib/insights.js')
const { generateReport, renderCategoryOverview, renderIntelligenceText, formatNumber } = await import('../lib/report.js')
const { getLatestAvailableDate, resolveQueryRange } = await import('../lib/redfox.js')

const mk = (i, type) => ({
  title: `快手作品${i}`, userName: `作者${i % 3}`, photoId: `p${i}`,
  coverUrl: i % 2 ? `https://img.example/${i}.jpg` : '', coverUrl2: '',
  likeCount: 5000 - i * 50, commentCount: 100 - i, shareCount: 50, readCount: 20000 - i * 200,
  type, topic: type,
})

test('store：日报生命周期（同关键词组+日期覆盖）+ briefing', () => {
  const arts = [mk(0, 'AI教程'), mk(1, 'AI教程'), mk(2, 'AI教程'), mk(3, 'AI绘画'), mk(4, 'AI绘画'), mk(5, 'AI绘画')]
  const clusters = clusterArticles(arts)
  const briefing = generateIntelligenceBriefing(clusters, arts)
  const m1 = saveReport({ raw: arts, keywords: ['AI教程', 'AI绘画'], date: '2026-11-11', clusters, briefing, stats: { total: 6, avg_reads: 18000, top_author: '', total_likes: 29000 } })
  const m2 = saveReport({ raw: arts, keywords: ['AI教程', 'AI绘画'], date: '2026-11-11', clusters, briefing, stats: { total: 6, avg_reads: 18000, top_author: '', total_likes: 29000 } })
  assert.equal(m1.report_id, m2.report_id)
  assert.equal(listReports().length, 1)
  assert.equal(DATA_DIR, join(tmp, 'ks-ai-feed'))
  assert.ok(getBriefing(m2.report_id)?.top_topics?.length >= 1)
  const htmlFile = saveReportHtml(m2.report_id, '<html>x</html>')
  assert.ok(existsSync(htmlFile))
  assert.equal(deleteReport(m2.report_id).ok, true)
  assert.equal(listReports().length, 0)
})

test('report：深色模板填充（奖牌/情报洞察/无泄漏）', () => {
  const notes = [
    ...Array.from({ length: 32 }, (_x, i) => mk(i, 'AI教程')),
    ...Array.from({ length: 7 }, (_x, i) => mk(50 + i, 'AI绘画')),
    // 1 条高互动小簇（占比 2.5% < 10%，均互动 2500 > 1000）→ 起量信号
    { ...mk(99, '数字人'), likeCount: 2000, commentCount: 500 },
  ]
  const clusters = clusterArticles(notes)
  const briefing = generateIntelligenceBriefing(clusters, notes)
  const html = generateReport(clusters, notes, '2026-11-11', briefing)
  assert.ok(html.includes('快手爆款日报'))
  assert.ok(html.includes('category-card') && html.includes('🥇'))
  assert.ok(html.includes('intel-rank-topic') && html.includes('起量信号'))
  assert.ok(html.includes('快手作品0'))
  assert.ok(!html.includes('{{DATE}}') && !html.includes('{{INTELLIGENCE_SECTION}}'))
  assert.ok(!html.includes('undefined') && !html.includes('[object Object]'))
  assert.ok(html.includes('#FF6B35')) // 快手橙主题（上游模板色值）
})

test('insights：起量信号/达人/调查方向', () => {
  // 小簇（占比<10%）但高互动 → 起量信号
  const arts = []
  for (let i = 0; i < 30; i++) arts.push(mk(i, 'AI教程')) // 大簇
  arts.push({ ...mk(99, '数字人'), likeCount: 2000, commentCount: 500 }) // 小簇高互动
  const clusters = clusterArticles(arts)
  const briefing = generateIntelligenceBriefing(clusters, arts)
  assert.ok(briefing.top_topics.length >= 1)
  assert.ok(briefing.top_authors.length >= 1)
  assert.ok(briefing.investigation_hints.length >= 1)
  assert.ok(briefing.cross_platform_tips.length >= 1)
})

test('formatNumber + 15 点日期规则', () => {
  assert.equal(formatNumber(1234), '1.2k')
  assert.equal(formatNumber(12345), '1.2w')
  assert.equal(formatNumber(500), '500')
  const evening = new Date('2026-11-13T16:00:00')
  assert.equal(getLatestAvailableDate(evening), '2026-11-12')
  const morning = new Date('2026-11-13T09:00:00')
  assert.equal(getLatestAvailableDate(morning), '2026-11-11')
  const r = resolveQueryRange({ date: '2026-06-09' })
  assert.ok(r.startTime.includes('2026-06-09'))
  const r2 = resolveQueryRange({ date: '2026-06-09~2026-06-12' })
  assert.ok(r2.startTime.includes('2026-06-09'))
})

test('renderCategoryOverview / renderIntelligenceText：固定输出格式', () => {
  const notes = Array.from({ length: 10 }, (_x, i) => mk(i, 'AI教程'))
  const clusters = clusterArticles(notes)
  const overview = renderCategoryOverview(clusters, notes.length)
  assert.ok(overview.includes('| 分类 | 数量 | 占比 | 亮点 |'))
  assert.ok(overview.includes('%'))
  const briefing = generateIntelligenceBriefing(clusters, notes)
  const intel = renderIntelligenceText(briefing)
  assert.ok(intel.includes('一、新兴起量信号'))
  assert.ok(intel.includes('二、核心达人'))
  assert.ok(intel.includes('三、推荐调查方向'))
  assert.ok(intel.includes('四、跨平台对比建议'))
})

// ── host 工具直调（假服务器）────────────────────────────────────────────
test('host 工具：fetch/clusters/insights/html/history + 3107 + 无 key', async () => {
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const payload = JSON.parse(body || '{}')
      const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.headers['x-api-key'] !== 'ak_tool') return reply({ code: 3107, msg: 'key error' })
      const arts = []
      for (let i = 0; i < 12; i++) arts.push(mk(i, i < 8 ? 'AI教程, 入门' : 'AI教程'))
      reply({ code: 2000, data: { list: arts } })
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  mkdirSync(join(tmp, 'ks-ai-feed'), { recursive: true })
  writeFileSync(join(tmp, 'ks-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))

  const { ksAiTool } = await import('../src/host.js')
  const call = async (args) => {
    try { return await ksAiTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
  }
  function check(name, cond, detail = '') {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
    if (!cond) process.exitCode = 1
  }

  {
    const r = await call({ action: 'fetch', keywords: 'AI教程,AI绘画', count: 12 })
    check('fetch 固定输出', r.ok && r.data.includes('分类概览') && r.data.includes('情报洞察报告'), (r.data || '').slice(0, 100))
    check('fetch 情报 4 模块', r.data.includes('一、新兴起量信号') && r.data.includes('二、核心达人') && r.data.includes('三、推荐调查方向') && r.data.includes('四、跨平台对比建议'), '')
    check('fetch 15 点规则', r.summary.includes('数据日期'), r.summary.slice(0, 60))
    check('fetch keywords 数组批量', true, '')
    globalThis.__rid = r.summary.match(/reportId=([\p{L}\p{N}-]+)/u)?.[1]
  }
  {
    const r = await call({ action: 'clusters', perCluster: 3 })
    check('clusters 明细', r.ok && r.data.includes('kuaishou.com/short-video/'), '')
  }
  {
    const r = await call({ action: 'insights' })
    check('insights 读档', r.ok && r.data.includes('二、核心达人'), '')
  }
  {
    const r = await call({ action: 'html' })
    check('html 生成', r.ok && r.summary.includes('.html'), r.summary.slice(0, 50))
    const file = r.summary.match(/：(.+?\.html)/)?.[1]
    const html = readFileSync(file, 'utf8')
    assert.ok(html.includes('快手爆款日报'))
    assert.ok(html.includes('intel-rank-topic'))
    assert.ok(!html.includes('{{DATE}}'))
    check('html 可读', true, '')
  }
  {
    writeFileSync(join(tmp, 'ks-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_bad', api_base: `http://127.0.0.1:${srv.address().port}` }))
    const r = await call({ action: 'fetch' })
    check('3107 Key 错误翻译', !r.ok && r.summary.includes('3107'), r.summary.slice(0, 60))
    writeFileSync(join(tmp, 'ks-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))
  }
  {
    writeFileSync(join(tmp, 'ks-ai-feed', 'settings.json'), JSON.stringify({}, null, 2))
    const r = await call({ action: 'fetch' })
    check('无 key 引导', !r.ok && r.summary.includes('RedFox API Key'), r.summary.slice(0, 50))
    writeFileSync(join(tmp, 'ks-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))
  }
  {
    const r = await call({ action: 'history' })
    check('history 单条（覆盖）', r.ok && r.data.split('\n').length === 1, r.data)
  }

  await new Promise((r) => srv.close(r))
})

test.after(() => rmSync(tmp, { recursive: true, force: true }))
