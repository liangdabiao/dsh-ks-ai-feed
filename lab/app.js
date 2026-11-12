// AI 快手日报 · 面板逻辑：概览（关键词组查询+历史）/ 日报页（分类卡片+情报洞察）/ 设置。
// 深度调查与解读走 agent 对话；面板直连 API 查询/看日报/生成 HTML。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')
  const EMBEDDED = (() => { try { return window.parent !== window } catch { return false } })()

  const state = { catalog: null }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmt = (n) => {
    if (n === null || n === undefined) return '0'
    if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  async function api(path) {
    const res = await fetch(`/ks-ai-feed${path}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return body
  }
  async function apiPost(path, payload) {
    const res = await fetch(`/ks-ai-feed${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }
  async function apiDelete(path) {
    const res = await fetch(`/ks-ai-feed${path}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  let toastTimer = null
  function toast(msg, isErr) {
    $toast.textContent = msg
    $toast.className = `toast show${isErr ? ' err' : ''}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { $toast.className = 'toast' }, 2600)
  }
  function copyFallback(prompt, reason) {
    navigator.clipboard?.writeText(prompt).then(
      () => toast(`${reason}，草稿已复制到剪贴板——请粘贴到 dsh 对话`, true),
      () => toast(`${reason}，复制也失败了`, true))
  }

  const ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v5H5V6h5"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
  }
  const ic = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`

  async function loadCatalog() {
    state.catalog = await api('/api/catalog')
    renderRailFoot()
    return state.catalog
  }
  function renderRailFoot() {
    const c = state.catalog
    if (!c) return
    const latest = (c.reports || [])[0]
    document.getElementById('rail-foot').innerHTML =
      `<div class="v-head">KS AI DAILY v${esc(c.version)}</div>` +
      `<div class="v-row"><span>API Key</span><span>${c.has_key ? '已配置' : '未配置'}</span></div>` +
      `<div class="v-row"><span>日报数</span><span>${(c.reports || []).length}</span></div>` +
      `<div class="v-row"><span>最新可查</span><span>${esc(c.latest_available_date?.date || '—')}</span></div>`
  }

  function sendAgentPrompt(prompt, okMsg = '已在宿主开新对话——agent 处理中') {
    if (!EMBEDDED) {
      navigator.clipboard?.writeText(prompt).then(
        () => toast('草稿已复制——粘贴到 dsh 对话即可开始'),
        () => copyFallback(prompt, '复制失败'))
      return
    }
    let done = false
    const cleanup = () => { done = true; clearTimeout(timer); removeEventListener('message', onMsg) }
    const onMsg = (e) => {
      if (e.origin !== location.origin) return
      if (e.data?.type === 'ks-ai-feed:start-ok') { if (!done) { cleanup(); toast(okMsg) } }
      else if (e.data?.type === 'ks-ai-feed:start-failed') { if (!done) { cleanup(); toast(`没能开新对话：${e.data.message || ''}`, true) } }
    }
    const timer = setTimeout(() => { if (!done) { cleanup(); copyFallback(prompt, '未收到宿主确认') } }, 1500)
    addEventListener('message', onMsg)
    parent.postMessage({ type: 'ks-ai-feed:refresh', prompt }, location.origin)
  }

  // ---------- 视图：概览 ----------
  function viewHome() {
    const c = state.catalog
    const reports = c.reports || []
    const kws = c.default_keywords || []
    return `
      <header class="head">
        <span class="eyebrow">KUAISHOU AI DAILY</span>
        <div class="head-row">
          <h1>AI 快手<strong>日报</strong></h1>
        </div>
        <p>多关键词批量扫描快手 AI 创作内容，按播放量筛选爆款、六步智能聚类，含情报洞察（热度TOP/起量信号/核心达人/调查方向）。数据每日 15 点更新前一天（最新可查 ${esc(c.latest_available_date?.date || '—')}）。RedFox API Key ${c.has_key ? '已配置' : '未配置'}。</p>
      </header>
      ${!c.has_key ? `<div class="empty" style="margin-bottom:var(--sp-6);padding:var(--sp-4) var(--sp-5);text-align:left"><div class="e-title">🔑 还没有配置 RedFox API Key</div><p>到<a href="#/settings">「设置」</a>页填写（ak_ 开头，<a href="https://www.redfox.hk/login" target="_blank" rel="noreferrer">红狐 hub 获取 ↗</a>）。</p></div>` : ''}
      <section class="sec" style="margin-top:0">
        <div class="sec-head"><span class="num">01</span><h2>生成日报</h2></div>
        <div class="form" style="max-width:860px">
          <div class="field"><label>KEYWORDS · 关注方向（逗号分隔，多词一次批量请求）</label>
            <input id="f-kw" value="${esc(kws.join(','))}">
            <div class="hint">默认 7 关键词一次批量请求（减少 85%+ API 调用）；深度调查方向会基于这些关键词的聚类结果生成。</div>
          </div>
          <div class="form-row">
            <div class="field"><label>COUNT · 扫描视频数量</label>
              <select id="f-count"><option value="100">100</option><option value="200" selected>200</option></select></div>
            <div class="field"><label>DATE · 数据日期（YYYY-MM-DD 或 起~止，留空按 15 点规则）</label>
              <input id="f-date" placeholder="${esc(c.latest_available_date?.date || '自动')}" style="font-family:var(--font-mono);font-size:12px"></div>
          </div>
          <div style="display:flex;gap:var(--sp-3);flex-wrap:wrap">
            <button class="btn accent" id="f-fetch">${ic('play')}生成日报</button>
            <button class="btn ghost" data-newflow>${ic('spark')}去对话深度调查</button>
          </div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><span class="num">02</span><h2>日报历史</h2></div>
        ${reports.length ? `<div class="cards">${reports.map((r) => `
          <a class="card" href="#/r/${encodeURIComponent(r.report_id)}">
            <div class="c-top">
              <div class="c-title">「${esc((r.keywords || []).join(','))}」</div>
              <span class="chip done">${r.total} 条</span>
            </div>
            <div class="c-sub">${r.topic_count} 个分类 · 数据日期 ${esc(r.date)}</div>
            <div class="c-foot"><span>${esc(String(r.created_at).slice(0, 16).replace('T', ' '))}</span></div>
          </a>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有日报</div><p>点「生成日报」；或「去对话深度调查」让 agent 抓取并基于情报洞察做深度分析。</p></div>`}
      </section>`
  }

  // ---------- 视图：日报 ----------
  function clusterCard(cluster, i) {
    const items = (cluster.articles || []).map((a) => {
      const url = a.photoId ? `https://www.kuaishou.com/short-video/${a.photoId}` : ''
      const cover = a.coverUrl
        ? `<img class="d-cover" src="${esc(a.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : '<div class="d-cover-ph">无封面</div>'
      return `
        <div class="ditem">
          ${cover}
          <div class="d-info">
            <div class="d-title">${url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(a.title || '无标题')}</a>` : esc(a.title || '无标题')}</div>
            <div class="d-meta">
              <span>${esc(a.userName || '-')}</span>
              <span class="d-metrics"><span>👍 ${fmt(a.likeCount)}</span><span>🔄 ${fmt(a.shareCount)}</span><span>💬 ${fmt(a.commentCount)}</span></span>
            </div>
          </div>
        </div>`
    }).join('')
    return `
      <div class="dcard">
        <div class="d-head"><span class="d-num">${String(i + 1).padStart(2, '0')}</span><span class="d-cat">${esc(cluster.category)}</span><span class="d-count">${cluster.count} 条</span></div>
        <div class="d-body">${items}</div>
      </div>`
  }

  function intelBlocks(briefing) {
    if (!briefing) return ''
    const sec = (title, body) => `<div class="intel-sub"><h4>${title}</h4>${body}</div>`
    const top = (briefing.top_topics || []).map((t) => `
      <div class="intel-row"><span class="topic">${esc(t.topic)}</span><span class="detail">占比 ${t.ratio}% · ${t.count}条</span></div>`).join('')
    const emerging = (briefing.emerging_topics || []).map((t) => `
      <div class="intel-row"><span class="badge">起量</span><span class="topic">${esc(t.topic)}</span><span class="detail">${t.count}条 · 均互动${t.avg_engagement}+</span></div>`).join('')
    const authors = (briefing.top_authors || []).map((a) => `
      <div class="intel-row"><span class="name">@${esc(a.name)}</span><span class="detail">${a.article_count}条 · 总赞${fmt(a.total_likes)}${a.total_reads ? ` · 总播${fmt(a.total_reads)}` : ''}</span></div>`).join('')
    const hints = (briefing.investigation_hints || []).map((g) => (g.hints || []).map((h) => `
      <div class="intel-row"><span class="topic">${esc(g.topic)}</span><span class="detail">${esc(h.scenario)}：${esc(h.engines.join('+'))}</span></div>`)).flat().join('')
    const tips = (briefing.cross_platform_tips || []).map((t) => `
      <div class="intel-row"><span>${esc(t)}</span></div>`).join('')
    return `<div class="intel-blocks">
      ${sec('🔥 热度TOP话题', top || '<div class="intel-row">暂无</div>')}
      ${emerging ? sec('📈 新兴起量信号', emerging) : ''}
      ${authors ? sec('⭐ 核心达人', authors) : ''}
      ${hints ? sec('🔍 推荐调查方向', hints) : ''}
      ${tips ? sec('🌐 跨平台对比建议', tips) : ''}
    </div>`
  }

  function viewReport(id) {
    return `<div id="r-view" data-rid="${esc(id)}"><div class="loading">LOADING…</div></div>`
  }

  async function renderReport(id) {
    const holder = document.getElementById('r-view')
    let data
    try {
      data = await api(`/api/reports/${encodeURIComponent(id)}`)
    } catch (e) {
      const netDown = !e.status
      holder.innerHTML = `<a class="back" href="#/">${ic('back')} 概览</a><div class="empty"><div class="e-title">${netDown ? '面板服务连接失败' : '日报不存在'}</div><p>${netDown ? '开发预览：DSH_HOME=<数据目录> node scripts/devserver.mjs 5185' : esc(e.message)}</p></div>`
      return
    }
    const meta = data.report
    const clusters = data.clusters || []
    holder.innerHTML = `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <div class="detail-head">
        <div>
          <h1>「${esc((meta.keywords || []).join(','))}」</h1>
          <div class="c-sub" style="margin-top:4px">${meta.total} 条视频 · ${meta.topic_count} 个分类 · 数据日期 ${esc(meta.date)} · 总点赞 ${fmt(meta.total_likes)}${meta.avg_reads ? ` · 平均播放 ${fmt(meta.avg_reads)}` : ''} · 头号作者 ${esc(meta.top_author || '—')}</div>
        </div>
        <div class="actions">
          <button class="btn accent" id="r-html">${ic('ext')}生成 HTML 日报</button>
          <button class="btn ghost" data-analyze="${esc(id)}">${ic('spark')}去对话深度调查</button>
          <button class="btn ghost" data-del-report="${esc(id)}" title="删除日报">${ic('trash')}</button>
        </div>
      </div>
      ${clusters.length ? `<div class="dcards">${clusters.map((c, i) => clusterCard(c, i)).join('')}</div>
      <div class="sec" style="margin-top:var(--sp-8)">
        <div class="sec-head"><span class="num">🧠</span><h2>AI 情报洞察</h2></div>
        ${intelBlocks(data.briefing)}
      </div>`
      : '<div class="empty"><div class="e-title">该日报没有作品</div><p>换关键词或日期重新生成。</p></div>'}`
    bindReport(id, meta)
  }

  function bindReport(id, meta) {
    const htmlBtn = document.getElementById('r-html')
    if (htmlBtn) htmlBtn.onclick = async () => {
      htmlBtn.disabled = true
      try {
        await apiPost(`/api/reports/${encodeURIComponent(id)}/report`)
        toast('HTML 日报已生成')
        window.open(`/ks-ai-feed/api/reports/${encodeURIComponent(id)}/report`, '_blank')
      } catch (e) { toast(e.message, true) }
      htmlBtn.disabled = false
    }
    const del = document.querySelector('[data-del-report]')
    if (del) del.onclick = async () => {
      if (!confirm('删除这份日报？')) return
      try { await apiDelete(`/api/reports/${encodeURIComponent(id)}`); toast('已删除'); location.hash = '#/' } catch (e) { toast(e.message, true) }
    }
    const analyze = document.querySelector('[data-analyze]')
    if (analyze) analyze.onclick = () => {
      sendAgentPrompt([
        `请基于 AI 快手日报（${meta.report_id}，关键词「${(meta.keywords || []).join(',')}」，${meta.date}）做深度调查分析：`,
        `1. ks_ai(action="clusters", reportId="${meta.report_id}", perCluster=10) 读全部分类作品`,
        '2. 按 ks-ai-feed 技能输出：分类概览表 + 情报洞察 4 模块（完整输出不可省略），并对热度TOP话题做深度调查（用推荐调查方向里的场景+引擎组合+关键词）',
        `3. ks_ai(action="html", reportId="${meta.report_id}") 生成深色 HTML 日报给我文件路径。`,
      ].join('\n'), '已在宿主开新对话——agent 调查完回来看')
    }
  }

  // ---------- 视图：设置 ----------
  function viewSettings() {
    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <header class="head">
        <span class="eyebrow">SETTINGS</span>
        <h1>设<strong>置</strong></h1>
        <p>RedFox API Key 是日报抓取的唯一凭证。这里保存的 Key 优先于环境变量，低于插件配置。</p>
      </header>
      <div class="form">
        <div class="field"><label>API KEY · RedFox API Key（ak_ 开头）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-key" placeholder="ak_…" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-key-save">保存 Key</button>
          </div>
          <div class="hint" id="s-key-hint">…</div>
          <div class="hint">获取：<a href="https://www.redfox.hk/login" target="_blank" rel="noreferrer">redfox.hk/login ↗</a>。保存在本机 dsh 数据目录，不上传。</div>
        </div>
        <div class="field"><label>DEFAULT KEYWORDS · 默认关键词组（逗号分隔）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-kw" style="flex:1;min-width:220px">
            <button class="btn" id="s-kw-save">保存关键词组</button>
          </div>
        </div>
        <div class="field"><label>PROXY · HTTP(S) 代理（清空 = 直连）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-proxy" placeholder="http://127.0.0.1:7890" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-proxy-save">保存代理</button>
          </div>
        </div>
        <div class="field"><label>API BASE · 接口地址（测试用，默认 https://redfox.hk）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-base" placeholder="https://redfox.hk" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-base-save">保存地址</button>
          </div>
        </div>
      </div>`
  }

  async function bindSettings() {
    try {
      const { settings } = await api('/api/settings')
      const keyHint = document.getElementById('s-key-hint')
      if (keyHint) keyHint.textContent = settings.has_key
        ? `已配置（…${settings.key_tail || '******'}${settings.from_env ? '，其中环境变量可用' : ''}）。重新输入会覆盖。`
        : '未配置。'
      const inp = document.getElementById('s-key')
      if (inp && document.activeElement !== inp) inp.placeholder = settings.has_key ? `已配置（…${settings.key_tail}），输入新值覆盖` : 'ak_…'
      const kw = document.getElementById('s-kw')
      if (kw && document.activeElement !== kw) kw.value = (settings.default_keywords || []).join(',')
      const proxy = document.getElementById('s-proxy')
      if (proxy && document.activeElement !== proxy) proxy.value = settings.proxy_url || ''
      const base = document.getElementById('s-base')
      if (base && document.activeElement !== base) base.value = settings.api_base || ''
    } catch { /* 宿主未就绪 */ }
    const bind = (id, payload) => {
      const btn = document.getElementById(id)
      if (!btn) return
      btn.onclick = async () => {
        try {
          const input = btn.parentElement.querySelector('input')
          await apiPost('/api/settings', payload(input.value.trim()))
          toast('设置已保存')
          loadCatalog().catch(() => {})
        } catch (e) { toast(e.message, true) }
      }
    }
    bind('s-key-save', (v) => ({ api_key: v }))
    bind('s-kw-save', (v) => ({ default_keywords: v }))
    bind('s-proxy-save', (v) => ({ proxy_url: v }))
    bind('s-base-save', (v) => ({ api_base: v }))
  }

  // ---------- 渲染辅助 ----------
  function bindCommon() {
    document.querySelectorAll('[data-newflow]').forEach((b) => {
      b.onclick = () => sendAgentPrompt([
        '请做一次快手 AI 内容深度调查（AI 快手日报）：',
        `1. ks_ai(action="fetch", keywords="${esc((state.catalog?.default_keywords || []).join(','))}", count=200) 生成今日日报（15 点规则自动判断日期）`,
        '2. 按 ks-ai-feed 技能输出固定格式：分类概览表 + 情报洞察 4 模块（完整输出不可省略）',
        '3. 对热度TOP话题做深度调查（用情报洞察里的推荐调查方向：场景+引擎组合+关键词）',
        `4. ks_ai(action="html") 生成深色 HTML 日报给我文件路径；我要每日推送时用 dsh 定时任务（每天 15 点，先跟我确认）。`,
      ].join('\n'), '已在宿主开新对话——agent 会抓取并深度调查')
    })
    const fetchBtn = document.getElementById('f-fetch')
    if (fetchBtn) fetchBtn.onclick = async () => {
      fetchBtn.disabled = true; fetchBtn.textContent = '抓取中…'
      try {
        const r = await apiPost('/api/reports', {
          keywords: document.getElementById('f-kw').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          count: Number(document.getElementById('f-count')?.value) || 200,
          date: document.getElementById('f-date').value.trim() || undefined,
        })
        toast(`日报已生成：${r.report.total} 条 / ${r.report.topic_count} 分类`)
        location.hash = `#/r/${encodeURIComponent(r.report.report_id)}`
      } catch (e) { toast(e.message, true) }
      fetchBtn.disabled = false; fetchBtn.innerHTML = `${ic('play')}生成日报`
    }
  }

  // ---------- 路由 ----------
  async function render() {
    try { await loadCatalog() } catch {}
    const hash = location.hash || '#/'
    const mr = hash.match(/^#\/r\/(.+)$/)
    const rid = mr ? decodeURIComponent(mr[1]) : null
    document.querySelectorAll('.nav a').forEach((a) => {
      const cur = rid ? '' : hash === '#/' ? 'home' : hash.startsWith('#/settings') ? 'settings' : 'home'
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (rid && /^[\p{L}\p{N}_-]+$/u.test(rid)) {
      $app.innerHTML = viewReport(rid)
      bindCommon()
      renderReport(rid)
      return
    }
    if (hash.startsWith('#/settings')) { $app.innerHTML = viewSettings(); bindCommon(); bindSettings(); return }
    $app.innerHTML = viewHome()
    bindCommon()
  }

  async function boot() {
    try { await loadCatalog() } catch {
      state.catalog = { version: '-', has_key: false, key_source: 'none', default_keywords: [], reports: [], settings: {}, latest_available_date: {} }
    }
    render().catch(() => {})
  }
  addEventListener('hashchange', render)
  boot()
  setTimeout(() => { if (!state.catalog?.version || state.catalog.version === '-') boot() }, 2500)
})()
