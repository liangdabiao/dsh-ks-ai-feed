// 快手爆款日报 · 面板逻辑：概览（关键词组查询+历史）/ 日报页（分类卡片+情报洞察）/ 设置。
// 深度调查与解读走 agent 对话；面板直连 API 查询/看日报/生成 HTML。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')
  const EMBEDDED = (() => { try { return window.parent !== window } catch { return false } })()

  const state = { catalog: null, hasReport: false }
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

  // 报告是否存在：宿主新版在 meta/listReports 带 has_report；宿主未重启时用 HEAD 探测兜底。
  // 桌面端 WebContentsView 把 window.open/target=_blank 全部 deny，日报只能在面板内看，
  // 所以「有没有报告」必须自己判断，不能靠点按钮弹新窗口。
  async function hasReportFile(id) {
    try {
      const res = await fetch(`/ks-ai-feed/api/reports/${encodeURIComponent(id)}/report`, { method: 'HEAD', cache: 'no-store' })
      return res.ok
    } catch { return false }
  }

  const reportById = (id) => (state.catalog?.reports || []).find((r) => r.report_id === id)
  const reportLabel = (id) => {
    const r = reportById(id)
    return r ? `「${(r.keywords || []).join(',')}」· ${r.date}` : '快手爆款日报'
  }

  // 打开外部链接：桌面端 iframe 里 window.open 会被 WebContentsView deny，
  // 先请宿主用系统默认浏览器打开；宿主不支持（网页版/无桌面）时退回新窗口。
  async function openLink(u) {
    if (!u || u === '#' || u === 'about:blank') return
    try {
      const r = await apiPost('/api/open', { url: u })
      if (r?.ok) { toast('已在系统浏览器打开'); return }
      throw new Error(r?.error || '打开失败')
    } catch (e) {
      const win = window.open(u, '_blank', 'noopener')
      if (!win) {
        const hint = /404|not found/i.test(String(e.message))
          ? '宿主还没重启（/api/open 未上线），重启 dsh 后就能用系统浏览器打开'
          : e.message
        toast(`链接打不开：${hint}`, true)
      }
    }
  }

  // ---------- 日报查看器（面板内覆盖层） ----------
  // 桌面端 dsh-app 协议的 WebContentsView 把 window.open / target=_blank 全部 deny，
  // 所以日报不能用新窗口打开：fetch 同源 HTML → iframe.srcdoc 在面板里显示。
  async function openReportView(id, label) {
    document.getElementById('report-view')?.remove()
    const el = document.createElement('div')
    el.id = 'report-view'
    el.className = 'report-view'
    el.innerHTML = `
      <div class="rv-panel" role="dialog" aria-modal="true" aria-label="HTML 日报">
        <div class="rv-bar">
          <div class="rv-title">${ic('file')}<span>${esc(label || reportLabel(id))}</span></div>
          <div class="rv-actions">
            <button class="btn ghost" id="rv-reload">重新载入</button>
            <button class="btn ghost" id="rv-close">关闭</button>
          </div>
        </div>
        <div class="rv-body"><div class="loading">LOADING…</div></div>
      </div>`
    document.body.appendChild(el)
    const body = el.querySelector('.rv-body')
    const onKey = (e) => { if (e.key === 'Escape') close() }
    function close() {
      removeEventListener('keydown', onKey)
      el.remove()
    }
    addEventListener('keydown', onKey)
    el.querySelector('#rv-close').onclick = close
    el.addEventListener('click', (e) => { if (e.target === el) close() })

    const paint = async () => {
      body.innerHTML = '<div class="loading">LOADING…</div>'
      try {
        const res = await fetch(`/ks-ai-feed/api/reports/${encodeURIComponent(id)}/report`, { cache: 'no-store' })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          throw new Error(detail.error || `HTTP ${res.status}`)
        }
        const html = await res.text()
        const frame = document.createElement('iframe')
        frame.className = 'rv-frame'
        frame.title = 'HTML 日报'
        frame.srcdoc = html // 日报自带深色主题；外链补丁已在服务端注入
        body.innerHTML = ''
        body.appendChild(frame)
      } catch (e) {
        body.innerHTML = `<div class="empty"><div class="e-title">日报打不开</div><p>${esc(e.message)}</p><p>先点「生成 HTML 日报」，或在对话里让 agent 跑 ks_ai(action="html")。</p></div>`
      }
    }
    el.querySelector('#rv-reload').onclick = paint
    await paint()
  }

  // 生成（或按已入库数据重生成）日报后立刻在面板里打开
  async function generateReport(id, btn) {
    if (btn) btn.disabled = true
    try {
      await apiPost(`/api/reports/${encodeURIComponent(id)}/report`)
      toast('HTML 日报已生成')
      await openReportView(id)
      bindReportSlots()
    } catch (e) {
      toast(e.message, true)
    } finally {
      if (btn) btn.disabled = false
    }
  }

  // 报告入口槽位：概览卡片 / 报告库共用。有报告 → 「打开日报」，报告库页无报告 → 「生成日报」
  function fillReportSlot(slot, id, exists) {
    slot.innerHTML = ''
    const mk = (cls, text, onClick) => {
      const b = document.createElement('button')
      b.className = cls
      b.type = 'button'
      b.textContent = text
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(b) }
      slot.appendChild(b)
      return b
    }
    if (exists) return mk('chip act', '📄 打开日报', () => openReportView(id))
    if (slot.dataset.reportGen) return mk('chip act gen', '＋ 生成日报', (b) => generateReport(id, b))
    return null
  }

  async function bindReportSlots() {
    const slots = [...document.querySelectorAll('[data-report-slot]')]
    await Promise.all(slots.map(async (slot) => {
      const id = slot.dataset.reportSlot
      const known = typeof reportById(id)?.has_report === 'boolean' ? reportById(id).has_report : await hasReportFile(id)
      fillReportSlot(slot, id, known)
    }))
  }

  // rail 导航图标：index.html 里只放了 <i data-icon> 占位，这里填成 svg（否则导航图标是空的）
  function paintNavIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = ic(el.dataset.icon) })
  }

  // 作品标题的可点绑定：日报页 DOM 是 renderReport 异步填的，填完要再绑一次
  function bindOpenLinks() {
    document.querySelectorAll('[data-open-link]').forEach((el) => {
      if (el.dataset.bound) return
      el.dataset.bound = '1'
      el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openLink(el.dataset.openLink) }
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLink(el.dataset.openLink) } }
    })
  }

  const ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v5H5V6h5"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
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
        <span class="eyebrow">KUAISHOU VIRAL DAILY</span>
        <div class="head-row">
          <h1>快手<strong>爆款日报</strong></h1>
        </div>
        <p>多关键词批量扫描快手热门作品（默认 AI 词表，可换任意关键词），按播放量筛选爆款、六步智能聚类，含情报洞察（热度TOP/起量信号/核心达人/调查方向）。数据每日 15 点更新前一天（最新可查 ${esc(c.latest_available_date?.date || '—')}）。RedFox API Key ${c.has_key ? '已配置' : '未配置'}。</p>
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
          <div class="card" data-report-card="${esc(r.report_id)}" role="button" tabindex="0">
            <div class="c-top">
              <div class="c-title">「${esc((r.keywords || []).join(','))}」</div>
              <span class="chip done">${r.total} 条</span>
            </div>
            <div class="c-sub">${r.topic_count} 个分类 · 数据日期 ${esc(r.date)}</div>
            <div class="c-foot">
              <span>${esc(String(r.created_at).slice(0, 16).replace('T', ' '))}</span>
              <span data-report-slot="${esc(r.report_id)}"></span>
            </div>
          </div>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有日报</div><p>点「生成日报」；或「去对话深度调查」让 agent 抓取并基于情报洞察做深度分析。</p></div>`}
      </section>`
  }

  // ---------- 视图：报告库 ----------
  // 给「生成到磁盘的 report.html」一个固定入口：rail「报告」页 + 每份日报卡片上的槽位
  function viewReports() {
    const reports = state.catalog?.reports || []
    return `
      <header class="head">
        <span class="eyebrow">REPORTS</span>
        <div class="head-row"><h1>报告<strong>库</strong></h1></div>
        <p>对话里生成的深色 HTML 日报都落在这里，点「打开日报」在面板内直接查看（桌面端不支持弹出新窗口；日报里的作品链接会交给系统浏览器）。</p>
      </header>
      <section class="sec" style="margin-top:0">
        <div class="sec-head"><span class="num">01</span><h2>日报报告</h2></div>
        ${reports.length ? `<div class="cards">${reports.map((r) => `
          <div class="card" data-report-card="${esc(r.report_id)}" role="button" tabindex="0">
            <div class="c-top">
              <div class="c-title">「${esc((r.keywords || []).join(','))}」</div>
              <span class="chip done">${r.total} 条</span>
            </div>
            <div class="c-sub">${r.topic_count} 个分类 · 数据日期 ${esc(r.date)}</div>
            <div class="c-foot">
              <span>${esc(String(r.created_at).slice(0, 16).replace('T', ' '))}</span>
              <span data-report-slot="${esc(r.report_id)}" data-report-gen="1" class="slot"></span>
            </div>
          </div>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有日报</div><p>去「概览」点「生成日报」，或在对话里 fetch 一次，报告就有了。</p></div>`}
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
            <div class="d-title">${url ? `<span data-open-link="${esc(url)}" role="button" tabindex="0">${esc(a.title || '无标题')}</span>` : esc(a.title || '无标题')}</div>
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
    // 宿主没重启时 meta.has_report 还不存在 → HEAD 探测兜底，保证「打开日报」入口一定出现
    const hasReport = typeof meta.has_report === 'boolean' ? meta.has_report : await hasReportFile(id)
    holder.innerHTML = `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <div class="detail-head">
        <div>
          <h1>「${esc((meta.keywords || []).join(','))}」</h1>
          <div class="c-sub" style="margin-top:4px">${meta.total} 条视频 · ${meta.topic_count} 个分类 · 数据日期 ${esc(meta.date)} · 总点赞 ${fmt(meta.total_likes)}${meta.avg_reads ? ` · 平均播放 ${fmt(meta.avg_reads)}` : ''} · 头号作者 ${esc(meta.top_author || '—')}</div>
        </div>
        <div class="actions" id="r-actions">${actionsHtml(id, hasReport)}</div>
      </div>
      ${clusters.length ? `<div class="dcards">${clusters.map((c, i) => clusterCard(c, i)).join('')}</div>
      <div class="sec" style="margin-top:var(--sp-8)">
        <div class="sec-head"><span class="num">🧠</span><h2>情报洞察</h2></div>
        ${intelBlocks(data.briefing)}
      </div>`
      : '<div class="empty"><div class="e-title">该日报没有作品</div><p>换关键词或日期重新生成。</p></div>'}`
    state.hasReport = hasReport
    bindReport(id, meta)
  }

  function actionsHtml(id, hasReport) {
    const report = hasReport
      ? `<button class="btn accent" data-open-report="${esc(id)}">${ic('file')}打开 HTML 日报</button>
         <button class="btn ghost" data-gen-report="${esc(id)}">重新生成</button>`
      : `<button class="btn accent" data-gen-report="${esc(id)}">${ic('play')}生成 HTML 日报</button>`
    return `${report}
      <button class="btn ghost" data-analyze="${esc(id)}">${ic('spark')}去对话深度调查</button>
      <button class="btn ghost" data-del-report="${esc(id)}" title="删除日报">${ic('trash')}</button>`
  }

  function bindReport(id, meta) {
    bindOpenLinks()
    const openBtn = document.querySelector('[data-open-report]')
    if (openBtn) openBtn.onclick = () => openReportView(id)
    const genBtn = document.querySelector('[data-gen-report]')
    if (genBtn) genBtn.onclick = async () => {
      await generateReport(id, genBtn)
      state.hasReport = true
      const box = document.getElementById('r-actions')
      if (box) {
        box.innerHTML = actionsHtml(id, true)
        bindReport(id, meta)
      }
    }
    const del = document.querySelector('[data-del-report]')
    if (del) del.onclick = async () => {
      if (!confirm('删除这份日报？')) return
      try { await apiDelete(`/api/reports/${encodeURIComponent(id)}`); toast('已删除'); location.hash = '#/' } catch (e) { toast(e.message, true) }
    }
    const analyze = document.querySelector('[data-analyze]')
    if (analyze) analyze.onclick = () => {
      sendAgentPrompt([
        `请基于 快手爆款日报（${meta.report_id}，关键词「${(meta.keywords || []).join(',')}」，${meta.date}）做深度调查分析：`,
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
    // 日报卡片：点卡片进日报页；卡片内的「打开日报 / 生成日报」按钮不触发跳转
    document.querySelectorAll('[data-report-card]').forEach((card) => {
      const go = () => { location.hash = `#/r/${encodeURIComponent(card.dataset.reportCard)}` }
      card.onclick = (e) => { if (e.target.closest('button, a, [data-open-link]')) return; go() }
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }
    })
    // 面板里的外链一律交给系统浏览器（桌面端 <a target="_blank"> 同样会被 deny）
    document.querySelectorAll('a[target="_blank"]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openLink(a.getAttribute('href')) }
    })
    // 作品标题：点开快手原文（走宿主系统浏览器）
    bindOpenLinks()
    bindReportSlots()
    document.querySelectorAll('[data-newflow]').forEach((b) => {
      b.onclick = () => sendAgentPrompt([
        '请做一次快手 AI 内容深度调查（快手爆款日报）：',
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
    const cur = rid ? '' : hash === '#/' ? 'home' : hash.startsWith('#/settings') ? 'settings' : hash.startsWith('#/reports') ? 'reports' : 'home'
    document.querySelectorAll('.nav a').forEach((a) => {
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (rid && /^[\p{L}\p{N}_-]+$/u.test(rid)) {
      $app.innerHTML = viewReport(rid)
      bindCommon()
      renderReport(rid)
      return
    }
    if (hash.startsWith('#/settings')) { $app.innerHTML = viewSettings(); bindCommon(); bindSettings(); return }
    if (hash.startsWith('#/reports')) { $app.innerHTML = viewReports(); bindCommon(); bindReportSlots(); return }
    $app.innerHTML = viewHome()
    bindCommon()
  }

  async function boot() {
    try { await loadCatalog() } catch {
      state.catalog = { version: '-', has_key: false, key_source: 'none', default_keywords: [], reports: [], settings: {}, latest_available_date: {} }
    }
    paintNavIcons()
    render().catch(() => {})
  }
  // 日报 iframe 里的链接点击会 postMessage 过来，统一交给 openLink 走系统浏览器
  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return
    const m = e.data
    if (m && m.type === 'dsh:open-link' && typeof m.url === 'string') openLink(m.url)
  })
  addEventListener('hashchange', render)
  boot()
  setTimeout(() => { if (!state.catalog?.version || state.catalog.version === '-') boot() }, 2500)
})()
