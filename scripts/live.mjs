// 真实网络冒烟：默认关键词组生成今日日报（15 点日期规则），打印分类概览并生成 HTML。
//   DSH_HOME=<目录> node scripts/live.mjs [keywords逗号分隔] [ak_xxx]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , kwArg, keyArg] = process.argv
const keywords = kwArg || 'AI,AI教程'
const home = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE, '.dsh')

if (keyArg) {
  mkdirSync(join(home, 'ks-ai-feed'), { recursive: true })
  writeFileSync(join(home, 'ks-ai-feed', 'settings.json'), JSON.stringify({ api_key: keyArg }, null, 2))
  console.log('API key 已写入 settings.json')
}
const { getSettings } = await import('../lib/store.js')
if (!getSettings().api_key && !process.env.REDFOX_API_KEY) {
  console.error('缺少 RedFox API Key：node scripts/live.mjs <keywords> ak_xxx')
  process.exit(1)
}

const { ksAiTool } = await import('../src/host.js')
const call = (args) => ksAiTool.execute(args, {})

console.log(`真实抓取：「${keywords}」今日日报（count=100）`)
const t0 = Date.now()
const r = await call({ action: 'fetch', keywords, count: 100 })
console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] ${r.summary}`)
if (r.data) console.log('\n' + r.data.split('\n').slice(0, 20).join('\n') + '\n…')
if (r.ok) {
  const rid = r.summary.match(/reportId=([\p{L}\p{N}-]+)/u)?.[1]
  const rep = await call({ action: 'html', reportId: rid })
  console.log(`\n${rep.summary}`)
}
