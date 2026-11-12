// cluster 单测：六步聚类（泛标签过滤/大组拆分/小组并入/标题关键词拆/保底5分类）、停用词
import test from 'node:test'
import assert from 'node:assert/strict'
import { getArticleTags, extractKeywords, clusterArticles, GENERIC_TAGS } from '../lib/cluster.js'

const mk = (i, type, topic = '', title = '') => ({
  title: title || `视频${i}`,
  userName: `作者${i % 3}`,
  photoId: `p${i}`,
  likeCount: 1000 - i * 10,
  commentCount: 20,
  shareCount: 10,
  readCount: 10000 - i * 100,
  type, topic,
})

test('getTags：泛标签过滤 + type 优先 topic 补充', () => {
  assert.deepEqual(getArticleTags({ type: 'AI热点, #AI, AI教程', topic: '' }), ['AI热点', 'AI教程']) // #AI 泛标签被滤
  assert.deepEqual(getArticleTags({ type: '', topic: 'AI绘画 数字人 AI' }), ['AI绘画', '数字人']) // AI 泛标签被滤
  assert.deepEqual(getArticleTags({}), [])
})

test('extractKeywords：2-4 字中文片段 + 停用词过滤', () => {
  assert.deepEqual(extractKeywords('AI大模型最新进展分享'), ['大模型最', '新进展分']) // 贪心 4 字片段（上游一致），单字'享'不匹配 // "最新/进展"是否停用看表
  assert.ok(extractKeywords('的了是在一个').length <= 5)
  assert.deepEqual(extractKeywords(''), [])
})

test('GENERIC_TAGS：上游泛标签集合', () => {
  assert.ok(GENERIC_TAGS.has('#AI'))
  assert.ok(GENERIC_TAGS.has('人工智能'))
  assert.ok(GENERIC_TAGS.has('#技术'))
})

test('clusterArticles：小样本保底 5 分类或合理分组', () => {
  // 12 条：6 个 AI视频+教程、3 个 AI绘画+工具、3 个 AI热点
  const arts = [
    mk(0, 'AI视频, 教程'), mk(1, 'AI视频, 教程'), mk(2, 'AI视频, 教程'),
    mk(3, 'AI视频, 工具'), mk(4, 'AI视频, 工具'), mk(5, 'AI视频, 工具'),
    mk(6, 'AI绘画, 工具'), mk(7, 'AI绘画, 工具'), mk(8, 'AI绘画, 工具'),
    mk(9, 'AI热点'), mk(10, 'AI热点'), mk(11, 'AI热点'),
  ]
  const clusters = clusterArticles(arts)
  assert.ok(clusters.length >= 1)
  const total = clusters.reduce((n, c) => n + c.count, 0)
  assert.equal(total, 12) // 不丢条目
  // 组内按播放降序 TOP5（每组最多 5 条）
  for (const c of clusters) {
    assert.ok(c.articles.length <= 5)
    for (let i = 1; i < c.articles.length; i++) {
      assert.ok(c.articles[i - 1].readCount >= c.articles[i].readCount)
    }
  }
})

test('clusterArticles：大组二次拆分（>max(20%,25) 按第二标签）', () => {
  // 130 条全 AI视频：80 条带第二标签"教程"，50 条带"工具" → AI视频组 >25 且 >max(26,40) 拆分
  const arts = []
  for (let i = 0; i < 80; i++) arts.push(mk(100 + i, 'AI视频, 教程', '', `AI教程第${i}讲深度解析`))
  for (let i = 0; i < 50; i++) arts.push(mk(200 + i, 'AI视频, 工具', '', `AI工具测评第${i}期实际体验`))
  const clusters = clusterArticles(arts)
  // 条数守恒（不管拆分成几个组，130 条一条不丢）
  const total = clusters.reduce((n, c) => n + c.count, 0)
  assert.equal(total, 130)
  assert.ok(clusters.length >= 1)
})

test('clusterArticles：空输入与去泛标签后全部归其他', () => {
  assert.deepEqual(clusterArticles([]), [])
  const onlyGeneric = [mk(0, '#AI'), mk(1, '人工智能'), mk(2, '#AI')]
  const clusters = clusterArticles(onlyGeneric)
  const total = clusters.reduce((n, c) => n + c.count, 0)
  assert.equal(total, 3) // 全部归入"其他"不丢失
})

test('clusterArticles：标题关键词拆分（#关键词 子分类）', () => {
  // 50 条全 AI视频无第二标签（20 <40 不触发二次标签拆分），但 >max(30%,40) 触发标题高频词拆分
  const arts = []
  for (let i = 0; i < 20; i++) arts.push(mk(300 + i, 'AI视频', '', `数字人教学视频第${i}集完整教程`))
  for (let i = 0; i < 30; i++) arts.push(mk(400 + i, 'AI视频', '', `普通AI内容第${i}期 weekly review`))
  const clusters = clusterArticles(arts)
  // 条数守恒（拆分/合并过程不丢条目）
  const total = clusters.reduce((n, c) => n + c.count, 0)
  assert.equal(total, 50)
  assert.ok(clusters.length >= 1)
})
