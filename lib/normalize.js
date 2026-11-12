// 条目归一化（快手 AI 信息源）：字段对齐上游 daily_report.py 使用的原始形态
// （readCount/likeCount/commentCount/shareCount/photoId/coverUrl/userName/type/topic），photoId 去重。
export function normalizeArticle(art, idx) {
  const photoId = String(art?.photoId || '')
  return {
    id: `KS${idx + 1}`,
    title: String(art?.title || '无标题') || '无标题',
    userName: String(art?.userName || ''),
    photoId,
    url: photoId ? `https://www.kuaishou.com/short-video/${photoId}` : '#',
    coverUrl: String(art?.coverUrl || ''),
    likeCount: Number(art?.likeCount) || 0,
    commentCount: Number(art?.commentCount) || 0,
    shareCount: Number(art?.shareCount) || 0,
    readCount: art?.readCount === null || art?.readCount === undefined ? null : (Number(art.readCount) || 0),
    type: String(art?.type || ''),
    topic: String(art?.topic || ''),
  }
}

export function normalizeArticles(articles) {
  return (articles || []).map((a, i) => normalizeArticle(a, i))
}

// 去重：photoId 主键（无 photoId 不去重）
export function dedupeByKey(articles) {
  const seen = new Set()
  const out = []
  for (const a of articles || []) {
    const key = String(a?.photoId || '')
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(a)
  }
  return out
}
