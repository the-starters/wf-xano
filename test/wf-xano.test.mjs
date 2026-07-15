// wf-xano test suite — run with: npm test  (requires devDependency jsdom)
import { JSDOM } from 'jsdom'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'wf-xano.js'), 'utf8')
const VERSION = /var VERSION = '([^']+)'/.exec(LIB)[1]

function makeRes(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) })
}
const PAGE = (items, total, page = 1, pages = 1) => ({ items, itemsTotal: total, curPage: page, pageTotal: pages })

async function waitFor(fn, ms = 2000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 15))
  }
  return false
}

const BASIC_MARKUP = `<!doctype html><html><body>
  <div wf-xano-list wf-xano-source="opp30:x/list" wf-xano-auth="none" wf-xano-per-page="10">
    <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
    <div wf-xano-empty style="display:none">none</div>
    <div wf-xano-loader>loading</div>
  </div></body></html>`

const FULL_MARKUP = `<!doctype html><html><body>
  <div wf-xano-list wf-xano-source="opp30:brand/opportunities/list" wf-xano-auth="none" wf-xano-per-page="20" wf-xano-param-status="">
    <select wf-xano-filter="status"><option value="">All</option><option value="Closed">Closed</option></select>
    <span wf-xano-total></span>
    <a wf-xano-template class="opportunity-card" wf-xano-link="id" wf-xano-link-prefix="/opportunities-details---brand-view?opp=">
      <h3 wf-xano-bind="title"></h3>
      <p wf-xano-bind="description"></p>
      <time wf-xano-bind="published_at" wf-xano-format="date"></time>
      <span class="owner" wf-xano-bind="owner" wf-xano-format="short-name"></span>
      <span class="pill-active" wf-xano-if="status === 'Active'">Live</span>
      <span class="pill-closed" wf-xano-if="status === 'Closed'">Closed</span>
    </a>
    <div wf-xano-empty style="display:none">none</div>
    <div wf-xano-loader>loading</div>
    <div class="pager"><button wf-xano-page-prev>prev</button><button wf-xano-page-number>1</button><button wf-xano-page-next>next</button></div>
  </div></body></html>`

const FULL_PAGE1 = {
  items: [
    { id: 345, title: 'Senior Brand Designer', description: 'Lead brand', published_at: '2026-06-30T00:00:00Z', status: 'Active', owner: 'John Paul Dionisio' },
    { id: 346, title: 'Closed Role', description: 'old', published_at: '2026-06-01T00:00:00Z', status: 'Closed', owner: 'Cher' },
  ],
  itemsTotal: 25, curPage: 1, pageTotal: 2,
}

// ---------- Test A: full render (binds, format, root-link, conditionals, states, pagination) ----------
{
  const dom = new JSDOM(FULL_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  w.WfXanoConfig = { xanoBase: 'https://x08a-5ko8-jj1r.n7c.xano.io', debug: false }
  w.fetch = (url, opts) => {
    calls.push({ url, opts })
    return makeRes(FULL_PAGE1)
  }
  w.eval(LIB)
  const list = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2), 'two cards rendered')

  assert.equal(calls[0].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/brand/opportunities/list')
  assert.equal(calls[0].opts.cache, 'no-store', 'no-store for freshness')
  const body = JSON.parse(calls[0].opts.body)
  assert.equal(body.per_page, 20)
  assert.equal(body.page, 1)

  const cards = w.document.querySelectorAll('[wf-xano-item]')
  const c0 = cards[0]
  assert.equal(c0.querySelector('[wf-xano-bind="title"]').textContent, 'Senior Brand Designer')
  assert.notEqual(c0.querySelector('[wf-xano-bind="published_at"]').textContent, '', 'date formatted non-empty')
  assert.equal(c0.querySelector('.owner').textContent, 'John P. D.', 'short-name abbreviates after first word')
  assert.equal(cards[1].querySelector('.owner').textContent, 'Cher', 'short-name leaves single word intact')
  assert.equal(c0.getAttribute('href'), '/opportunities-details---brand-view?opp=345', 'root-anchor link href set')
  assert.notEqual(c0.querySelector('.pill-active').style.display, 'none', 'active pill visible for Active')
  assert.equal(c0.querySelector('.pill-closed').style.display, 'none', 'closed pill hidden for Active')
  assert.equal(cards[1].querySelector('.pill-active').style.display, 'none')
  assert.equal(w.document.querySelector('[wf-xano-total]').textContent, '25')
  assert.equal(w.document.querySelector('[wf-xano-empty]').style.display, 'none', 'empty hidden with items')
  assert.equal(w.document.querySelector('[wf-xano-loader]').style.display, 'none', 'loader hidden after load')
  assert.equal(list.querySelector('[wf-xano-template]').style.display, 'none')
  assert.equal(w.document.querySelectorAll('[wf-xano-page-num]').length, 2, 'two page buttons')
  assert.ok(w.document.querySelector('[wf-xano-page-prev]').classList.contains('is-disabled'), 'prev disabled on page 1')
  console.log('PASS A: render, binds, format, root-link, conditionals, total, states, pagination')
}

// ---------- Test B: setParam/goToPage re-fetch, page reset, empty state ----------
{
  const dom = new JSDOM(FULL_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  w.WfXanoConfig = { debug: false }
  w.fetch = (url, opts) => { calls.push(JSON.parse(opts.body)); return makeRes(PAGE([], 0)) }
  w.eval(LIB)
  await waitFor(() => calls.length === 1)
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  inst.goToPage(2)
  await waitFor(() => calls.length === 2)
  assert.equal(calls[1].page, 2, 'goToPage sends page 2')
  inst.setParam('status', 'Closed')
  await waitFor(() => calls.length === 3)
  assert.equal(calls[2].status, 'Closed', 'setParam adds status filter')
  assert.equal(calls[2].page, 1, 'setParam resets to page 1')
  // empty is hidden while loading and re-shown by render() once the (empty) page lands
  assert.ok(await waitFor(() => w.document.querySelector('[wf-xano-empty]').style.display === ''), 'empty shown when no items (after render)')
  console.log('PASS B: setParam/goToPage re-fetch, page reset, empty state')
}

// ---------- Test B2: replace-mode refetch clears stale items while the new fetch is in flight ----------
{
  const dom = new JSDOM(FULL_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  let releaseSecond
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.fetch = (url, opts) => {
    calls.push(JSON.parse(opts.body))
    if (calls.length === 1) return makeRes(FULL_PAGE1) // initial: 2 items
    // second load (filter change) stays pending until released, so we can
    // inspect the DOM mid-flight
    return new Promise((res) => {
      releaseSecond = () =>
        res({ ok: true, status: 200, json: () => Promise.resolve(PAGE([{ id: 99, title: 'New', description: '', published_at: '2026-06-30T00:00:00Z', status: 'Active', owner: 'X' }], 1)) })
    })
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2), 'initial 2 items')
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  inst.setParam('status', 'Closed') // replace-mode refetch; fetch left pending
  assert.ok(await waitFor(() => calls.length === 2), 'second fetch issued')
  // The whole point: stale items are gone AND the loader is up WHILE the new
  // request is still in flight (previously they lingered until it resolved).
  assert.equal(w.document.querySelectorAll('[wf-xano-item]').length, 0, 'stale items cleared during in-flight replace load')
  assert.notEqual(w.document.querySelector('[wf-xano-loader]').style.display, 'none', 'loader shown during in-flight load')
  releaseSecond()
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'new item renders once fetch resolves')
  assert.equal(w.document.querySelector('[wf-xano-loader]').style.display, 'none', 'loader hidden after render')
  console.log('PASS B2: replace-mode refetch clears stale items while loading')
}

// ---------- Test B3: append-mode load keeps prior items in place ----------
{
  const dom = new JSDOM(FULL_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.fetch = (url, opts) => {
    calls.push(JSON.parse(opts.body))
    return makeRes(PAGE([{ id: 400 + calls.length, title: 'Row ' + calls.length, description: '', published_at: '2026-06-30T00:00:00Z', status: 'Active', owner: 'X' }], 5, calls.length, 5))
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'initial 1 item')
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  inst.load({ append: true }) // append mode must NOT clear existing items
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2), 'append keeps prior item and adds the new one')
  console.log('PASS B3: append-mode load keeps prior items')
}

// ---------- Test B4: replace-mode refetch hides the empty state while loading ----------
{
  const dom = new JSDOM(FULL_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  let releaseSecond
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.fetch = (url, opts) => {
    calls.push(JSON.parse(opts.body))
    if (calls.length === 1) return makeRes(PAGE([], 0)) // initial: 0 items -> "no results" shown
    return new Promise((res) => {
      releaseSecond = () =>
        res({ ok: true, status: 200, json: () => Promise.resolve(PAGE([{ id: 7, title: 'Found', description: '', published_at: '2026-06-30T00:00:00Z', status: 'Active', owner: 'X' }], 1)) })
    })
  }
  w.eval(LIB)
  const emptyEl = w.document.querySelector('[wf-xano-empty]')
  assert.ok(await waitFor(() => emptyEl.style.display === ''), 'empty shown initially (0 items)')
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  inst.setParam('status', 'Closed') // replace-mode refetch; fetch left pending
  assert.ok(await waitFor(() => calls.length === 2), 'second fetch issued')
  // The point: the "no results" block is hidden WHILE the new request is in
  // flight (only the loader shows), instead of lingering under the loader.
  assert.equal(emptyEl.style.display, 'none', 'empty hidden during in-flight replace load')
  assert.notEqual(w.document.querySelector('[wf-xano-loader]').style.display, 'none', 'loader shown during in-flight load')
  releaseSecond()
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'item renders once fetch resolves')
  assert.equal(emptyEl.style.display, 'none', 'empty stays hidden with an item')
  console.log('PASS B4: replace-mode refetch hides empty state while loading')
}

// ---------- Test C: pure helpers ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  const I = w.WfXano._internal
  assert.equal(I.resolveUrl('opp30:brand/opportunities/list'), 'https://h.xano.io/api:opp30/brand/opportunities/list')
  assert.equal(I.resolveUrl('https://x/api:g/p'), 'https://x/api:g/p', 'full url passthrough')
  assert.equal(I.evalIf("status === 'Active'", { status: 'Active' }), true)
  assert.equal(I.evalIf("status === 'Active'", { status: 'Closed' }), false)
  assert.equal(I.evalIf('budget >= 100', { budget: '5000' }), true)
  assert.equal(I.evalIf('applied', { applied: true }), true)
  assert.equal(I.get({ brand: { company_name: 'Acme' } }, 'brand.company_name'), 'Acme', 'dot path')
  assert.deepEqual(I.normalize([{ id: 1 }]).total, 1, 'raw array normalizes')
  assert.equal(I.normalize(FULL_PAGE1).total, 25)
  console.log('PASS C: resolveUrl, evalIf, get(dot), normalize')
}

// ---------- Test D: memberstack auth header, token caching + member-change reset ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.document.querySelector('[wf-xano-list]').setAttribute('wf-xano-auth', 'memberstack')
  let memberId = 'mem_A'
  let tradeCalls = 0
  const authHeaders = []
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', debug: false }
  w.$memberstackDom = {
    getCurrentMember: () => Promise.resolve({ data: { id: memberId } }),
    getMemberCookie: () => Promise.resolve('ms-jwt-' + memberId),
  }
  w.fetch = (url, opts) => {
    if (/\/trade(?:\?|$)/.test(url)) { tradeCalls++; return makeRes('xano-token-' + memberId) }
    authHeaders.push(opts.headers.Authorization)
    return makeRes(PAGE([], 0))
  }
  w.eval(LIB)
  await waitFor(() => authHeaders.length === 1)
  assert.equal(authHeaders[0], 'Bearer xano-token-mem_A', 'traded token used as Bearer')
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  await inst.refresh()
  assert.equal(tradeCalls, 1, 'token cached across refresh for same member')
  memberId = 'mem_B'
  await inst.refresh()
  await waitFor(() => tradeCalls === 2)
  assert.equal(tradeCalls, 2, 'token re-traded after member change')
  assert.equal(authHeaders[authHeaders.length - 1], 'Bearer xano-token-mem_B', 'new member token used')
  console.log('PASS D: memberstack auth header, token caching + member-change reset')
}

// ---------- Test D2: auth never requires a member-profile lookup; cookie switch resets token ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  w.document.querySelector('[wf-xano-list]').setAttribute('wf-xano-auth', 'memberstack')
  let memberId = 'mem_LS_A'
  w.localStorage.setItem('_ms-mid', '"mem_LS_A"') // Memberstack stores the id JSON-quoted
  let getCurrentMemberCalls = 0
  let tradeCalls = 0
  const authHeaders = []
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', debug: false }
  w.$memberstackDom = {
    getCurrentMember: () => { getCurrentMemberCalls++; return Promise.resolve({ data: { id: memberId } }) },
    getMemberCookie: () => Promise.resolve('ms-jwt-' + memberId),
  }
  w.fetch = (url, opts) => {
    if (/\/trade(?:\?|$)/.test(url)) { tradeCalls++; return makeRes('xano-token-' + memberId) }
    authHeaders.push(opts.headers.Authorization)
    return makeRes(PAGE([], 0))
  }
  w.eval(LIB)
  await waitFor(() => authHeaders.length === 1)
  assert.equal(getCurrentMemberCalls, 0, 'auth never calls getCurrentMember')
  assert.equal(authHeaders[0], 'Bearer xano-token-mem_LS_A', 'traded token used as Bearer')
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  await inst.refresh()
  assert.equal(tradeCalls, 1, 'token cached across refresh for same member')
  // An account switch changes the live session cookie -> token dropped.
  memberId = 'mem_LS_B'
  w.localStorage.setItem('_ms-mid', 'mem_LS_B') // unquoted variant must parse too
  await inst.refresh()
  await waitFor(() => tradeCalls === 2)
  assert.equal(authHeaders[authHeaders.length - 1], 'Bearer xano-token-mem_LS_B', 'member switch re-trades')
  assert.equal(getCurrentMemberCalls, 0, 'switch detected without any getCurrentMember call')
  console.log('PASS D2: profile-free auth + live-session switch reset')
}

// ---------- Test D3: getCurrentMember is never consulted and cannot gate first render ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  w.document.querySelector('[wf-xano-list]').setAttribute('wf-xano-auth', 'memberstack')
  // A getCurrentMember that NEVER resolves cannot hang auth because the
  // library does not need a profile lookup to trade the live session cookie.
  w.WfXanoConfig = { authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', preAuth: false, debug: false }
  w.$memberstackDom = {
    getCurrentMember: () => new Promise(() => {}),
    getMemberCookie: () => Promise.resolve('ms-jwt'),
  }
  w.fetch = (url) => {
    if (/\/trade(?:\?|$)/.test(url)) return makeRes('xano-token')
    return makeRes(PAGE([{ id: 1, title: 'Fast' }], 1))
  }
  w.eval(LIB)
  assert.ok(
    await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1),
    'first authed render not gated behind getCurrentMember',
  )
  console.log('PASS D3: member-profile lookup cannot gate auth')
}

// ---------- Test D4: preAuth pre-warms the trade at parse time (and preAuth:false does not) ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  // List stays auth="none": the ONLY possible trade is the parse-time pre-warm.
  let tradeCalls = 0
  const listCalls = []
  w.WfXanoConfig = { authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', debug: false }
  w.$memberstackDom = {
    getCurrentMember: () => Promise.resolve({ data: { id: 'mem_A' } }),
    getMemberCookie: () => Promise.resolve('ms-jwt'),
  }
  w.fetch = (url, opts) => {
    if (/\/trade(?:\?|$)/.test(url)) { tradeCalls++; return makeRes('xano-token') }
    listCalls.push(opts)
    return makeRes(PAGE([], 0))
  }
  w.eval(LIB)
  await waitFor(() => tradeCalls === 1 && listCalls.length === 1)
  assert.equal(tradeCalls, 1, 'trade pre-warmed at parse time even without an authed list')
  assert.equal(listCalls[0].headers.Authorization, undefined, 'auth="none" list stays tokenless')

  const dom2 = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w2 = dom2.window
  let tradeCalls2 = 0
  w2.WfXanoConfig = { authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', preAuth: false, debug: false }
  w2.$memberstackDom = {
    getCurrentMember: () => Promise.resolve({ data: { id: 'mem_A' } }),
    getMemberCookie: () => Promise.resolve('ms-jwt'),
  }
  w2.fetch = (url) => { if (/\/trade(?:\?|$)/.test(url)) tradeCalls2++; return makeRes(PAGE([], 0)) }
  w2.eval(LIB)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(tradeCalls2, 0, 'preAuth:false skips the pre-warm')
  console.log('PASS D4: parse-time token pre-warm (+ preAuth opt-out)')
}

// ---------- Test D5: failed handshake is not cached — retried after login ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  w.document.querySelector('[wf-xano-list]').setAttribute('wf-xano-auth', 'memberstack')
  let cookie = null // logged out at first
  let tradeCalls = 0
  const authHeaders = []
  w.WfXanoConfig = { authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', preAuth: false, debug: false }
  w.$memberstackDom = {
    getCurrentMember: () => Promise.resolve({ data: { id: cookie ? 'mem_A' : null } }),
    getMemberCookie: () => Promise.resolve(cookie),
  }
  w.fetch = (url, opts) => {
    if (/\/trade(?:\?|$)/.test(url)) { tradeCalls++; return makeRes('xano-token') }
    authHeaders.push(opts.headers.Authorization)
    return makeRes(PAGE([], 0))
  }
  w.eval(LIB)
  const listEl = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => listEl.classList.contains('is-wf-xano-error')), 'logged-out load surfaces the auth error')
  assert.equal(tradeCalls, 0, 'no trade request without a session cookie')
  cookie = 'ms-jwt-mem_A' // user logs in
  await listEl.__wfXano.refresh()
  await waitFor(() => authHeaders.length === 1)
  assert.equal(authHeaders[0], 'Bearer xano-token', 'post-login refresh trades a fresh token (failure not cached)')
  assert.ok(!listEl.classList.contains('is-wf-xano-error'), 'error state cleared after successful retry')
  console.log('PASS D5: failed handshake not cached — retried after login')
}

// ---------- Test 1: pre-load callback queue (GA/Finsweet pattern) ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, title: 'A' }], 1))
  let gotApi = null
  w.WfXano = [ (api) => { gotApi = api } ]
  w.eval(LIB)
  await waitFor(() => gotApi)
  assert.ok(gotApi && gotApi.version === VERSION, 'queued callback ran with API after boot')
  let second = null
  w.WfXano.push((api) => { second = api })
  assert.ok(second, 'post-boot push runs immediately')
  console.log('PASS 1: pre-load queue + post-boot push')
}

// ---------- Test 2: race guard — stale slow response must NOT render ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  let call = 0
  let releaseFirst
  const firstGate = new Promise((r) => (releaseFirst = r))
  w.fetch = () => {
    call++
    if (call === 1) {
      return firstGate.then(() => ({ ok: true, status: 200, json: () => Promise.resolve(PAGE([{ id: 1, title: 'STALE' }], 1)) }))
    }
    return makeRes(PAGE([{ id: 2, title: 'FRESH' }], 1))
  }
  w.eval(LIB)
  await waitFor(() => call === 1)
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  inst.setParam('q', 'x')
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1)
  releaseFirst()
  await new Promise((r) => setTimeout(r, 60))
  const titles = [...w.document.querySelectorAll('[wf-xano-item] h3')].map((e) => e.textContent)
  assert.deepEqual(titles, ['FRESH'], 'stale out-of-order response dropped')
  console.log('PASS 2: request race guard')
}

// ---------- Test 3: binds/if on the template ROOT ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="g:p" wf-xano-auth="none">
      <p wf-xano-template wf-xano-bind="title" wf-xano-if="status === 'Active'"></p>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, title: 'RootBind', status: 'Active' }, { id: 2, title: 'Hidden', status: 'Closed' }], 2))
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2)
  const items = [...w.document.querySelectorAll('[wf-xano-item]')]
  assert.equal(items[0].textContent, 'RootBind', 'bind on template root works')
  assert.notEqual(items[0].style.display, 'none', 'root-level if keeps Active visible')
  assert.equal(items[1].style.display, 'none', 'root-level if hides Closed')
  console.log('PASS 3: root-element bind + if')
}

// ---------- Test 4: checkbox filter groups combine via wf-xano-value ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="g:p" wf-xano-auth="none">
      <input type="checkbox" wf-xano-filter="status" wf-xano-value="Active">
      <input type="checkbox" wf-xano-filter="status" wf-xano-value="Closed">
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([], 0)) }
  w.eval(LIB)
  await waitFor(() => bodies.length === 1)
  const boxes = w.document.querySelectorAll('[wf-xano-filter="status"]')
  boxes[0].checked = true
  boxes[0].dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies.length === 2)
  assert.equal(bodies[1].status, 'Active', 'single checkbox -> its wf-xano-value')
  boxes[1].checked = true
  boxes[1].dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies.length === 3)
  assert.equal(bodies[2].status, 'Active,Closed', 'both checked -> comma-joined group')
  boxes[0].checked = false
  boxes[1].checked = false
  boxes[1].dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies.length === 4)
  assert.equal(bodies[3].status, undefined, 'none checked -> param cleared')
  console.log('PASS 4: checkbox filter groups (wf-xano-value)')
}

// ---------- Test 5: instance keys — controls/counts OUTSIDE the root ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <span wf-xano-total wf-xano-instance="opps"></span>
    <span wf-xano-count-from wf-xano-instance="opps"></span>–<span wf-xano-count-to wf-xano-instance="opps"></span>
    <select wf-xano-filter="status" wf-xano-instance="opps"><option value=""></option><option value="Active">Active</option></select>
    <div wf-xano-list wf-xano-instance="opps" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="10">
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([{ id: 1, title: 'T' }, { id: 2, title: 'U' }], 12, 1, 2)) }
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2)
  assert.equal(w.document.querySelector('[wf-xano-total]').textContent, '12', 'outside-root total bound')
  assert.equal(w.document.querySelector('[wf-xano-count-from]').textContent, '1')
  assert.equal(w.document.querySelector('[wf-xano-count-to]').textContent, '2')
  const sel = w.document.querySelector('select[wf-xano-filter]')
  sel.value = 'Active'
  sel.dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies.length === 2)
  assert.equal(bodies[1].status, 'Active', 'outside-root filter drives request')
  assert.ok(w.WfXano.get('opps'), 'WfXano.get(key) resolves the instance')
  console.log('PASS 5: instance keys (outside-root total/counts/filter, WfXano.get)')
}

// ---------- Test 6: beforeRender transform hook + results replay ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, title: 'keep' }, { id: 2, title: 'drop' }], 2))
  w.eval(LIB)
  await waitFor(() => w.document.querySelector('[wf-xano-list]').__wfXano)
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  inst.on('beforeRender', (items) => items.filter((i) => i.title === 'keep'))
  await inst.refresh()
  const titles = [...w.document.querySelectorAll('[wf-xano-item] h3')].map((e) => e.textContent)
  assert.deepEqual(titles, ['keep'], 'beforeRender hook filtered items before render')
  let replayed = null
  inst.on('results', (r) => { replayed = r })
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(replayed && replayed.items.length === 1, 'late on(results) replays last result')
  console.log('PASS 6: beforeRender transform + results replay')
}

// ---------- Test 7: URL sync — restore on init, write after load ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-list wf-xano-instance="opps" wf-xano-url-sync="true" wf-xano-source="g:p" wf-xano-auth="none">
      <select wf-xano-filter="status"><option value=""></option><option value="Active">Active</option></select>
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`,
    { runScripts: 'outside-only', url: 'https://x.test/page?opps_page=3&opps_status=Active&other=1' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([{ id: 1, title: 'T' }], 30, 3, 3)) }
  w.eval(LIB)
  await waitFor(() => bodies.length === 1)
  assert.equal(bodies[0].page, 3, 'page restored from URL')
  assert.equal(bodies[0].status, 'Active', 'param restored from URL')
  assert.equal(w.document.querySelector('select[wf-xano-filter]').value, 'Active', 'control hydrated from URL')
  await waitFor(() => /opps_status=Active/.test(w.location.search))
  assert.ok(/other=1/.test(w.location.search), 'unrelated query params preserved')
  console.log('PASS 7: URL sync restore + write')
}

// ---------- Test 8: destroy() removes listeners + items + registration ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  let calls = 0
  w.fetch = () => { calls++; return makeRes(PAGE([{ id: 1, title: 'A' }], 1)) }
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1)
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  inst.destroy()
  assert.equal(w.document.querySelectorAll('[wf-xano-item]').length, 0, 'items removed')
  assert.equal(w.WfXano.instances.length, 0, 'instance unregistered')
  assert.equal(w.document.querySelector('[wf-xano-list]').__wfXano, undefined, 'root marker cleared')
  const before = calls
  w.WfXano.refresh()
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(calls, before, 'no further loads after destroy')
  console.log('PASS 8: destroy()')
}

// ---------- Test 9: normalize derives pages without pageTotal ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  const N = w.WfXano._internal.normalize
  assert.equal(N({ items: [1, 2], itemsTotal: 45, curPage: 1 }, 20).pages, 3, 'pages = ceil(total/perPage) when pageTotal missing')
  assert.equal(N({ items: [1], curPage: 2, nextPage: 3 }, undefined).pages, 3, 'nextPage bumps pages when nothing else known')
  console.log('PASS 9: normalize page derivation')
}

// ---------- Test 10: wf-xano-display on loader/empty state elements ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="g:p" wf-xano-auth="none">
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
      <div wf-xano-empty wf-xano-display="flex" style="display:none">none</div>
      <div wf-xano-loader wf-xano-display="grid">loading</div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  let release
  const gate = new Promise((r) => (release = r))
  w.fetch = () => gate.then(() => ({ ok: true, status: 200, json: () => Promise.resolve(PAGE([], 0)) }))
  w.eval(LIB)
  await waitFor(() => w.document.querySelector('[wf-xano-list]').__wfXano)
  assert.equal(w.document.querySelector('[wf-xano-loader]').style.display, 'grid', 'loader shown with wf-xano-display value')
  release()
  await waitFor(() => w.document.querySelector('[wf-xano-loader]').style.display === 'none')
  assert.equal(w.document.querySelector('[wf-xano-empty]').style.display, 'flex', 'empty shown with wf-xano-display value')
  console.log('PASS 10: wf-xano-display on loader/empty (wf-algolia parity)')
}

// ---------- Test 11: canonical wf-xano-element="…" grammar (v0.3.0) ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="list" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="10">
      <a wf-xano-element="template" wf-xano-link="id" wf-xano-link-prefix="/d?id="><h3 wf-xano-bind="title"></h3></a>
      <div wf-xano-element="empty" wf-xano-display="flex" style="display:none">none</div>
      <div wf-xano-element="loader">loading</div>
      <div class="pager"><button wf-xano-element="page-prev">prev</button><button wf-xano-element="page-number">1</button><button wf-xano-element="page-next">next</button></div>
      <span wf-xano-element="total"></span>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 7, title: 'Canon' }], 15, 1, 2))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'canonical list rendered')
  const card = w.document.querySelector('[wf-xano-item]')
  assert.equal(card.querySelector('h3').textContent, 'Canon')
  assert.equal(card.getAttribute('href'), '/d?id=7')
  assert.equal(card.getAttribute('wf-xano-element'), null, 'clone drops wf-xano-element="template" role')
  assert.equal(w.document.querySelector('[wf-xano-element="template"]').style.display, 'none', 'template stays hidden')
  assert.equal(w.document.querySelector('[wf-xano-element="total"]').textContent, '15')
  assert.equal(w.document.querySelector('[wf-xano-element="loader"]').style.display, 'none', 'loader hidden after load')
  assert.ok(w.document.querySelector('[wf-xano-element="page-prev"]').classList.contains('is-disabled'), 'prev disabled on page 1')
  assert.equal(w.document.querySelectorAll('[wf-xano-page-num]').length, 2, 'page buttons cloned from canonical template')
  console.log('PASS 11: canonical wf-xano-element grammar')
}

// ---------- Test 12: instance-scoped comma selectors (counts/pagination OUTSIDE root, canonical) ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <span wf-xano-element="total" wf-xano-instance="opps"></span>
    <button wf-xano-element="page-next" wf-xano-instance="opps">next</button>
    <div wf-xano-element="list" wf-xano-instance="opps" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="10">
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([{ id: 1, title: 'T' }], 12, 1, 2)) }
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1)
  assert.equal(w.document.querySelector('[wf-xano-element="total"]').textContent, '12', 'outside-root canonical total bound (comma selector scoped per branch)')
  w.document.querySelector('[wf-xano-element="page-next"]').click()
  await waitFor(() => bodies.length === 2)
  assert.equal(bodies[1].page, 2, 'outside-root canonical page-next drives paging')
  console.log('PASS 12: instance-scoped comma selectors (canonical, outside root)')
}

// ---------- Test 13: v0.4.0 Finsweet-aligned roles — wrapper root + list items container ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none">
      <div class="grid" wf-xano-element="list">
        <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
      </div>
      <div wf-xano-element="empty" style="display:none">none</div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, title: 'W' }], 1))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'wrapper root initializes')
  assert.equal(w.document.querySelector('.grid [wf-xano-item] h3').textContent, 'W', 'card rendered inside element="list" container')
  assert.equal(w.document.querySelector('[wf-xano-element="empty"]').style.display, 'none')
  console.log('PASS 13: wrapper root + list items container (Finsweet role parity)')
}

// ---------- Test 14: v0.3.0 root alias — element="list" WITH source still initializes as root ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="list" wf-xano-source="g:p" wf-xano-auth="none">
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 9, title: 'Alias' }], 1))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'v0.3.0 element="list"+source root still works')
  assert.equal(w.document.querySelector('[wf-xano-item] h3').textContent, 'Alias')
  console.log('PASS 14: v0.3.0 element="list" root alias (with source)')
}

// ---------- Test 15: click filters (tabs) — set, All-clears, is-active management ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-instance="opps" wf-xano-source="g:p" wf-xano-auth="none">
      <a href="#" class="tab" wf-xano-filter="status" wf-xano-value="*">All</a>
      <a href="#" class="tab" wf-xano-filter="status" wf-xano-value="Active">Open</a>
      <a href="#" class="tab" wf-xano-filter="status" wf-xano-value="Closed">Closed</a>
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([{ id: 1, title: 'T' }], 1)) }
  w.eval(LIB)
  await waitFor(() => bodies.length === 1)
  const tabs = [...w.document.querySelectorAll('.tab')]
  await waitFor(() => tabs[0].classList.contains('is-active'))
  assert.ok(tabs[0].classList.contains('is-active'), '"All" tab active when no filter set')
  tabs[2].click()
  await waitFor(() => bodies.length === 2)
  assert.equal(bodies[1].status, 'Closed', 'clicking a tab sets the param')
  assert.equal(bodies[1].page, 1, 'filter click resets page')
  await waitFor(() => tabs[2].classList.contains('is-active'))
  assert.ok(!tabs[0].classList.contains('is-active'), '"All" no longer active')
  tabs[0].click()
  await waitFor(() => bodies.length === 3)
  assert.equal(bodies[2].status, undefined, '"All" (wf-xano-value="*") clears the param')
  await waitFor(() => tabs[0].classList.contains('is-active'))
  assert.ok(tabs[0].classList.contains('is-active'), '"*" tab active again after clearing')
  console.log('PASS 15: click filters (tabs) + is-active + "*" match-all sentinel')
}

// ---------- Test 16: clear element — all filters vs one field; statics preserved ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-param-scope="mine">
      <select wf-xano-filter="status"><option value=""></option><option value="Active">Active</option></select>
      <input type="text" wf-xano-search="q">
      <a href="#" wf-xano-element="clear" wf-xano-filter="status">clear status</a>
      <a href="#" id="clear-all" wf-xano-element="clear">clear all</a>
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([], 0)) }
  w.eval(LIB)
  await waitFor(() => bodies.length === 1)
  const inst = w.document.querySelector('[wf-xano-element="wrapper"]').__wfXano
  inst.setParam('status', 'Active')
  await waitFor(() => bodies.length === 2)
  inst.setParam('q', 'designer')
  await waitFor(() => bodies.length === 3)
  w.document.querySelector('[wf-xano-element="clear"][wf-xano-filter="status"]').click()
  await waitFor(() => bodies.length === 4)
  assert.equal(bodies[3].status, undefined, 'field clear removed status')
  assert.equal(bodies[3].q, 'designer', 'field clear kept other filters')
  w.document.querySelector('#clear-all').click()
  await waitFor(() => bodies.length === 5)
  assert.equal(bodies[4].q, undefined, 'clear-all removed user filters')
  assert.equal(bodies[4].scope, 'mine', 'clear-all preserved static wf-xano-param-*')
  assert.equal(w.document.querySelector('[wf-xano-search]').value, '', 'clear-all rehydrated the search input')
  console.log('PASS 16: clear element (per-field + all, statics preserved)')
}

// ---------- Test 17: filter tags — chip per value, tag-remove drops one value ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none">
      <input type="checkbox" wf-xano-filter="category" wf-xano-value="Design">
      <input type="checkbox" wf-xano-filter="category" wf-xano-value="Finance">
      <div class="tags">
        <div wf-xano-element="tag"><span wf-xano-element="tag-field"></span>:<span wf-xano-element="tag-value"></span><a href="#" wf-xano-element="tag-remove">×</a></div>
      </div>
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([], 0)) }
  w.eval(LIB)
  await waitFor(() => bodies.length === 1)
  const boxes = w.document.querySelectorAll('[wf-xano-filter="category"]')
  boxes[0].checked = true
  boxes[0].dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies.length === 2)
  boxes[1].checked = true
  boxes[1].dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies.length === 3)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-tag-item]').length === 2)
  const tags = [...w.document.querySelectorAll('[wf-xano-tag-item]')]
  assert.equal(tags[0].querySelector('[wf-xano-element="tag-value"]').textContent, 'Design', 'tag shows the value')
  assert.equal(tags[0].querySelector('[wf-xano-element="tag-field"]').textContent, 'category', 'tag shows the field')
  tags[0].querySelector('[wf-xano-element="tag-remove"]').click()
  await waitFor(() => bodies.length === 4)
  assert.equal(bodies[3].category, 'Finance', 'tag-remove dropped one value from the group')
  await waitFor(() => w.document.querySelectorAll('[wf-xano-tag-item]').length === 1)
  assert.ok(!boxes[0].checked, 'tag-remove unchecked the matching checkbox')
  console.log('PASS 17: filter tags (per-value chips, tag-remove)')
}

// ---------- Test 18: URL restore hydrates radios + click-filter is-active ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-instance="opps" wf-xano-url-sync="true" wf-xano-source="g:p" wf-xano-auth="none">
      <label><input type="radio" name="st" wf-xano-filter="status" wf-xano-value="*">All</label>
      <label><input type="radio" name="st" wf-xano-filter="status" wf-xano-value="Active">Open</label>
      <label><input type="radio" name="st" wf-xano-filter="status" wf-xano-value="Closed">Closed</label>
      <a href="#" class="tab" wf-xano-filter="status" wf-xano-value="Active">Open tab</a>
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`,
    { runScripts: 'outside-only', url: 'https://x.test/page?opps_status=Active' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = (url, opts) => makeRes(PAGE([{ id: 1, title: 'T' }], 1))
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1)
  const radios = w.document.querySelectorAll('input[type="radio"]')
  assert.ok(!radios[0].checked, '"*" All radio unchecked while a value is set')
  assert.ok(radios[1].checked, 'radio matching URL param restored checked')
  assert.ok(!radios[2].checked, 'other radio unchecked')
  assert.ok(radios[1].closest('label').classList.contains('is-active'), 'radio label got is-active')
  assert.ok(!radios[0].closest('label').classList.contains('is-active'), '"*" label not active while filtered')
  assert.ok(w.document.querySelector('.tab').classList.contains('is-active'), 'click filter got is-active from URL state')
  console.log('PASS 18: URL restore hydrates radios (incl. "*" All) + click-filter active state')
}

// ---------- Test 19: paginationModel — boundary + window + dots gaps ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  const PM = w.WfXano._internal.paginationModel
  // 12 pages, on page 1, window 5, boundary 1 -> 1 2 3 4 5 … 12
  assert.deepEqual(PM(1, 12, 5, 1), [1, 2, 3, 4, 5, 'dots', 12], 'page 1 of 12: leading window + end boundary')
  // middle page -> dots on both sides
  assert.deepEqual(PM(6, 12, 5, 1), [1, 'dots', 4, 5, 6, 7, 8, 'dots', 12], 'page 6: dots both sides')
  // last page
  assert.deepEqual(PM(12, 12, 5, 1), [1, 'dots', 8, 9, 10, 11, 12], 'page 12: leading boundary + trailing window')
  // boundary 2 -> user example shape 1 2 … 11 12 (window 1)
  assert.deepEqual(PM(1, 12, 1, 2), [1, 2, 'dots', 11, 12], 'boundary 2, window 1: 1 2 … 11 12')
  // no gap -> no dots (few pages)
  assert.deepEqual(PM(1, 3, 5, 1), [1, 2, 3], '3 pages: no dots')
  // adjacent boundaries collapse the gap (no lone dot for a single skipped page is still a dot)
  assert.deepEqual(PM(1, 6, 3, 1), [1, 2, 3, 'dots', 6], '6 pages window 3: single ellipsis')
  console.log('PASS 19: paginationModel (boundary + window + dots)')
}

// ---------- Test 20: renders numbered buttons + ellipsis clones from page-dots template ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="10" wf-xano-page-window="5">
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
      <div class="pager">
        <a wf-xano-element="page-prev">prev</a>
        <a wf-xano-element="page-number">1</a>
        <span wf-xano-element="page-dots">…</span>
        <a wf-xano-element="page-next">next</a>
      </div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  // 120 items / 10 per page = 12 pages, itemsTotal provided
  w.fetch = () => makeRes({ items: [{ id: 1, title: 'A' }], itemsTotal: 120, curPage: 1, pageTotal: 12 })
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-page-num]').length > 0), 'page buttons rendered')
  const nums = [...w.document.querySelectorAll('[wf-xano-page-num]')].map((b) => b.textContent)
  const dots = w.document.querySelectorAll('[wf-xano-page-dot]').length
  assert.deepEqual(nums, ['1', '2', '3', '4', '5', '12'], 'page 1 of 12 shows window + last boundary')
  assert.equal(dots, 1, 'one ellipsis clone between 5 and 12')
  assert.equal(w.document.querySelector('[wf-xano-element="page-dots"]').style.display, 'none', 'dots template stays hidden')
  // navigate to page 6 -> dots on both sides
  const inst = w.document.querySelector('[wf-xano-element="wrapper"]').__wfXano
  w.fetch = () => makeRes({ items: [{ id: 1, title: 'A' }], itemsTotal: 120, curPage: 6, pageTotal: 12 })
  await inst.goToPage(6)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-page-dot]').length === 2)
  assert.equal(w.document.querySelectorAll('[wf-xano-page-dot]').length, 2, 'middle page: two ellipses')
  console.log('PASS 20: numbered + ellipsis pagination render')
}

// ---------- Test 21: no page-dots template -> gaps silently omitted (back-compat) ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="10">
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
      <div class="pager"><a wf-xano-element="page-number">1</a></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes({ items: [{ id: 1, title: 'A' }], itemsTotal: 120, curPage: 1, pageTotal: 12 })
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-page-num]').length === 6), 'buttons render without dots template')
  assert.equal(w.document.querySelectorAll('[wf-xano-page-dot]').length, 0, 'no ellipsis clones when template absent')
  console.log('PASS 21: pagination without page-dots template (back-compat)')
}

// ---------- Test 22: load="more" — appends next page on click, off nextPage only ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="2" wf-xano-load="more">
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
      <a wf-xano-element="load-more">Load more</a>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  let call = 0
  // no itemsTotal/pageTotal — only nextPage, like the real Xano endpoint
  w.fetch = () => { call++; return makeRes({ items: [{ id: call*10+1, title: 'p'+call+'a' }, { id: call*10+2, title: 'p'+call+'b' }], itemsReceived: 2, curPage: call, nextPage: call < 3 ? call+1 : null }) }
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2)
  const loadMore = w.document.querySelector('[wf-xano-element="load-more"]')
  assert.notEqual(loadMore.style.display, 'none', 'load-more visible while more pages remain')
  loadMore.click()
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 4)
  assert.equal(w.document.querySelectorAll('[wf-xano-item]').length, 4, 'second page appended (not replaced)')
  loadMore.click()
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 6)
  assert.equal(loadMore.style.display, 'none', 'load-more hidden when nextPage is null')
  assert.ok(w.document.querySelector('[wf-xano-element="wrapper"]').classList.contains('is-wf-xano-exhausted'), 'exhausted class set')
  console.log('PASS 22: load="more" appends + exhausts off nextPage')
}

// ---------- Test 23: load="all" — pulls every page up front ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="2" wf-xano-load="all">
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  let call = 0
  w.fetch = () => { call++; return makeRes({ items: [{ id: call*10+1, title: 'x' }, { id: call*10+2, title: 'y' }], curPage: call, nextPage: call < 3 ? call+1 : null }) }
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 6, 3000)
  assert.equal(w.document.querySelectorAll('[wf-xano-item]').length, 6, 'all 3 pages loaded and accumulated')
  console.log('PASS 23: load="all" fetches every page')
}

// ---------- Test 24: filter change in append mode resets (replaces, back to page 1) ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-instance="l" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-per-page="2" wf-xano-load="more">
      <select wf-xano-filter="cat"><option value="">all</option><option value="x">x</option></select>
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
      <a wf-xano-element="load-more">more</a>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  w.fetch = (url, opts) => { const b = JSON.parse(opts.body); bodies.push(b); return makeRes({ items: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }], curPage: b.page, nextPage: b.page < 3 ? b.page+1 : null }) }
  w.eval(LIB)
  await waitFor(() => bodies.length === 1)
  w.document.querySelector('[wf-xano-element="load-more"]').click()
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 4)
  const sel = w.document.querySelector('select[wf-xano-filter]')
  sel.value = 'x'; sel.dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies[bodies.length-1].cat === 'x')
  assert.equal(bodies[bodies.length-1].page, 1, 'filter change resets to page 1')
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2)
  assert.equal(w.document.querySelectorAll('[wf-xano-item]').length, 2, 'filter change replaced (did not append)')
  console.log('PASS 24: append-mode filter change resets + replaces')
}

// ---------- Test 25: date format styles + epoch guard ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  const F = w.WfXano._internal.fmt
  const ms = Date.UTC(2026, 4, 21, 12, 0, 0) // 2026-05-21
  assert.equal(F(ms, 'date-long'), 'May 21, 2026', 'date-long -> full month name')
  assert.equal(F(ms, 'date-medium'), 'May 21, 2026', 'date-medium -> short month (May == May)')
  assert.equal(F(Date.UTC(2026, 0, 1, 12), 'date-long'), 'January 1, 2026', 'date-long disambiguates 1/1')
  assert.ok(/2026/.test(F(ms, 'date')), 'bare date still renders (locale short)')
  // seconds-based timestamp (Xano sometimes) auto-scaled
  assert.equal(F(Math.floor(ms / 1000), 'date-long'), 'May 21, 2026', 'seconds timestamp scaled to ms')
  // epoch / unset guards -> empty (no more 1/1/1970)
  assert.equal(F(0, 'date-long'), '', 'timestamp 0 -> empty, not 1/1/1970')
  assert.equal(F('0', 'date'), '', 'string "0" -> empty')
  assert.equal(F(null, 'date-long'), '', 'null -> empty')
  assert.equal(F('', 'date'), '', 'empty string -> empty')
  console.log('PASS 25: date styles (long/medium) + epoch guard')
}

// ---------- Test 26: wf-xano-fallback — bind falls through to another field when blank ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none">
      <div wf-xano-element="template">
        <time wf-xano-bind="last_edited_at" wf-xano-fallback="published_at,created_at" wf-xano-format="date-long"></time>
      </div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const pub = Date.UTC(2026, 4, 21, 12), cre = Date.UTC(2026, 0, 3, 12)
  w.fetch = () => makeRes(PAGE([
    { id: 1, last_edited_at: Date.UTC(2026, 7, 9, 12), published_at: pub, created_at: cre }, // edited present
    { id: 2, last_edited_at: 0, published_at: pub, created_at: cre },                          // edited unset -> published_at
    { id: 3, last_edited_at: 0, published_at: null, created_at: cre },                         // -> created_at
    { id: 4, last_edited_at: 0, published_at: 0, created_at: 0 },                              // all blank -> ""
  ], 4))
  w.eval(LIB)
  await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 4)
  const times = [...w.document.querySelectorAll('[wf-xano-item] time')].map((t) => t.textContent)
  assert.equal(times[0], 'August 9, 2026', 'uses last_edited_at when present')
  assert.equal(times[1], 'May 21, 2026', 'falls back to published_at when last_edited_at is 0')
  assert.equal(times[2], 'January 3, 2026', 'falls through to created_at when published_at also blank')
  assert.equal(times[3], '', 'all-blank -> empty')
  assert.equal(w.WfXano._internal.isBlank(0), false, 'numeric zero is legitimate data outside date formatting')
  assert.equal(w.WfXano._internal.isBlank(1782894318555), false, 'isBlank(real ts) false')
  console.log('PASS 26: wf-xano-fallback chain')
}

// ---------- Test 27: wf-xano-if logical OR (|) / AND (&) ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  const E = w.WfXano._internal.evalIf
  // OR across bare fields — the user's "any date present" case
  assert.equal(E('last_edited_at | created_at', { last_edited_at: 0, created_at: 173e10 }), true, 'OR: second field present')
  assert.equal(E('last_edited_at | created_at', { last_edited_at: 0, created_at: 0 }), false, 'OR: neither present')
  assert.equal(E('last_edited_at | created_at', { last_edited_at: 173e10, created_at: 0 }), true, 'OR: first present')
  // double-pipe accepted
  assert.equal(E('a || b', { a: 0, b: 1 }), true, '|| also works')
  // AND
  assert.equal(E("status === 'Active' & applied === false", { status: 'Active', applied: false }), true, 'AND both true')
  assert.equal(E("status === 'Active' & applied === false", { status: 'Active', applied: true }), false, 'AND one false')
  // precedence: (a AND b) OR c
  assert.equal(E("status === 'Closed' & applied === false | featured", { status: 'Active', applied: false, featured: true }), true, 'AND binds tighter than OR — c rescues')
  assert.equal(E("status === 'Active' & applied === false | featured", { status: 'Active', applied: false, featured: false }), true, 'AND branch true')
  // single expression unchanged
  assert.equal(E("status === 'Active'", { status: 'Active' }), true, 'single expr still works')
  console.log('PASS 27: wf-xano-if OR/AND logical combinators')
}

// ---------- Test 28: show-more expand/collapse (clamped target) ----------
{
  const MARKUP = `<!doctype html><html><body>
  <div wf-xano-list wf-xano-source="opp30:x/list" wf-xano-auth="none">
    <a wf-xano-template href="#">
      <h3 wf-xano-bind="title"></h3>
      <p wf-xano-bind="description" class="clamp2" data-sh="100" data-ch="40"></p>
      <button wf-xano-element="show-more" wf-xano-target="description" wf-xano-class="clamp2" wf-xano-expanded-text="Show less">Show more</button>
      <div><span wf-xano-bind="summary" class="clamp1" data-sh="100" data-ch="40"></span>
        <button class="nearest" wf-xano-element="show-more" wf-xano-class="clamp1">More</button></div>
    </a>
    <div wf-xano-empty style="display:none">none</div>
  </div></body></html>`
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  // jsdom has no layout: fake scroll/client heights via data attributes
  Object.defineProperty(w.Element.prototype, 'scrollHeight', { get() { return parseInt(this.getAttribute('data-sh') || '0', 10) } })
  Object.defineProperty(w.Element.prototype, 'clientHeight', { get() { return parseInt(this.getAttribute('data-ch') || '0', 10) } })
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, title: 'T', description: 'long text', summary: 'also long' }], 1))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('[wf-xano-item]')), 'card rendered')
  await new Promise((r) => setTimeout(r, 30)) // let the prune tick run
  const card = w.document.querySelector('[wf-xano-item]')
  const desc = card.querySelector('[wf-xano-bind="description"]')
  const btn = card.querySelector('[wf-xano-element="show-more"][wf-xano-target]')
  assert.notEqual(btn.style.display, 'none', 'clamped target keeps its show-more visible')
  btn.click()
  assert.ok(!desc.classList.contains('clamp2'), 'clamp class removed on expand')
  assert.ok(desc.classList.contains('is-wf-xano-expanded'), 'target marked expanded')
  assert.ok(btn.classList.contains('is-wf-xano-expanded'), 'control marked expanded')
  assert.equal(btn.textContent, 'Show less', 'label swapped to expanded text')
  btn.click()
  assert.ok(desc.classList.contains('clamp2'), 'clamp class restored on collapse')
  assert.ok(!desc.classList.contains('is-wf-xano-expanded'), 'expanded state cleared')
  assert.equal(btn.textContent, 'Show more', 'label restored')
  // nearest-bind resolution (no wf-xano-target): the wrapper's bind wins
  const near = card.querySelector('button.nearest')
  const summary = card.querySelector('[wf-xano-bind="summary"]')
  near.click()
  assert.ok(!summary.classList.contains('clamp1'), 'nearest bind resolved without wf-xano-target')
  console.log('PASS 28: show-more expand/collapse, label swap, nearest-bind target')
}

// ---------- Test 28b: composite show-more button — label swaps in the text slot, icon survives ----------
{
  const MARKUP = `<!doctype html><html><body>
  <div wf-xano-list wf-xano-source="opp30:x/list" wf-xano-auth="none">
    <div wf-xano-template>
      <p wf-xano-bind="description" class="clamp2" data-sh="100" data-ch="40"></p>
      <div wf-xano-element="show-more" wf-xano-target="description" wf-xano-class="clamp2" wf-xano-expanded-text="Show less">
        <div wf-xano-element="show-more-text">Show more</div>
        <svg class="icon" wf-xano-element="show-more-icon"></svg>
      </div>
    </div>
    <div wf-xano-empty style="display:none">none</div>
  </div></body></html>`
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  Object.defineProperty(w.Element.prototype, 'scrollHeight', { get() { return parseInt(this.getAttribute('data-sh') || '0', 10) } })
  Object.defineProperty(w.Element.prototype, 'clientHeight', { get() { return parseInt(this.getAttribute('data-ch') || '0', 10) } })
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, description: 'long text' }], 1))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('[wf-xano-item]')), 'card rendered')
  const card = w.document.querySelector('[wf-xano-item]')
  const btn = card.querySelector('[wf-xano-element="show-more"]')
  const label = btn.querySelector('[wf-xano-element="show-more-text"]')
  const icon = btn.querySelector('svg.icon')
  btn.click()
  assert.equal(label.textContent, 'Show less', 'label swapped in the text slot')
  assert.ok(btn.querySelector('svg.icon'), 'icon child survives the swap')
  assert.ok(icon.classList.contains('is-wf-xano-expanded'), 'show-more-icon gets the expanded class')
  btn.click()
  assert.equal(label.textContent, 'Show more', 'label restored')
  assert.ok(btn.querySelector('svg.icon'), 'icon still present after collapse')
  assert.ok(!icon.classList.contains('is-wf-xano-expanded'), 'icon expanded class cleared on collapse')
  // clicking the icon itself bubbles to the control
  icon.dispatchEvent(new w.Event('click', { bubbles: true }))
  assert.equal(label.textContent, 'Show less', 'click on icon child toggles too')
  console.log('PASS 28b: composite button — show-more-text slot, show-more-icon class, child clicks bubble')
}

// ---------- Test 29: show-more hidden when target is not clamped ----------
{
  const MARKUP = `<!doctype html><html><body>
  <div wf-xano-list wf-xano-source="opp30:x/list" wf-xano-auth="none">
    <div wf-xano-template>
      <p wf-xano-bind="description" class="clamp2" data-sh="40" data-ch="40"></p>
      <button wf-xano-element="show-more" wf-xano-target="description" wf-xano-class="clamp2">Show more</button>
    </div>
    <div wf-xano-empty style="display:none">none</div>
  </div></body></html>`
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  Object.defineProperty(w.Element.prototype, 'scrollHeight', { get() { return parseInt(this.getAttribute('data-sh') || '0', 10) } })
  Object.defineProperty(w.Element.prototype, 'clientHeight', { get() { return parseInt(this.getAttribute('data-ch') || '0', 10) } })
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, description: 'short' }], 1))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('[wf-xano-item]')), 'card rendered')
  await new Promise((r) => setTimeout(r, 30))
  const btn = w.document.querySelector('[wf-xano-item] [wf-xano-element="show-more"]')
  assert.equal(btn.style.display, 'none', 'unclamped target hides its show-more control')
  console.log('PASS 29: show-more auto-hidden when text is not clamped')
}

// ---------- Test 30: standalone show-more (no wf-xano list; data-opp-bind + clamp-class targets) ----------
{
  // A page with NO wf-xano list: the boot-time initShowMore must still wire
  // these. One target is a data-opp-bind field; the other is resolved purely
  // by its clamp class (no bind at all — the static CMS case).
  const MARKUP = `<!doctype html><html><body>
    <section>
      <p data-opp-bind="description" class="clamp2" data-sh="120" data-ch="40">long description text</p>
      <a wf-xano-element="show-more" wf-xano-target="description" wf-xano-class="clamp2" wf-xano-expanded-text="Show less" href="#">Show more</a>
    </section>
    <section>
      <div class="rte clamp5" data-sh="300" data-ch="100">rich text body</div>
      <a wf-xano-element="show-more" wf-xano-class="clamp5" href="#">Show more</a>
    </section>
    <section>
      <div class="rte clamp5" data-sh="40" data-ch="100">short body</div>
      <a wf-xano-element="show-more" wf-xano-class="clamp5" href="#">Show more</a>
    </section>
  </body></html>`
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  Object.defineProperty(w.Element.prototype, 'scrollHeight', { get() { return parseInt(this.getAttribute('data-sh') || '0', 10) } })
  Object.defineProperty(w.Element.prototype, 'clientHeight', { get() { return parseInt(this.getAttribute('data-ch') || '0', 10) } })
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  await new Promise((r) => setTimeout(r, 40)) // boot + prune passes
  const btns = [...w.document.querySelectorAll('[wf-xano-element="show-more"]')]
  // #0: data-opp-bind target, clamped -> visible, toggles the clamp class
  const desc = w.document.querySelector('[data-opp-bind="description"]')
  assert.notEqual(btns[0].style.display, 'none', 'standalone: data-opp-bind clamped target keeps control visible')
  btns[0].click()
  assert.ok(!desc.classList.contains('clamp2'), 'standalone: clamp class removed on expand (data-opp-bind target)')
  assert.equal(btns[0].textContent, 'Show less', 'standalone: label swap works')
  btns[0].click()
  assert.ok(desc.classList.contains('clamp2'), 'standalone: clamp restored on collapse')
  // #1: clamp-class-only target (no bind), clamped -> visible and toggles
  const rte = w.document.querySelectorAll('.rte')[0]
  assert.notEqual(btns[1].style.display, 'none', 'standalone: clamp-class-only target resolves and shows')
  btns[1].click()
  assert.ok(!rte.classList.contains('clamp5'), 'standalone: clamp-class-only target toggles')
  // #2: clamp-class target but not clamped -> hidden
  assert.equal(btns[2].style.display, 'none', 'standalone: unclamped target hides control')
  // WfXano.initShowMore is exposed for re-runs
  assert.equal(typeof w.WfXano.initShowMore, 'function', 'WfXano.initShowMore exposed')
  console.log('PASS 30: standalone show-more — data-opp-bind + clamp-class targets, prune, API')
}

// ---------- Test 31: show-more glob wf-xano-class strips ALL matching clamp classes ----------
{
  // Target has BOTH a desktop and a -mob clamp class; a glob strips/restores both.
  const MARKUP = `<!doctype html><html><body>
    <section>
      <div class="rte text-style-5lines text-style-2lines-mob" data-sh="200" data-ch="60">long body text here</div>
      <a wf-xano-element="show-more" wf-xano-class="text-style-*line*" wf-xano-expanded-text="Show less" href="#">Show more</a>
    </section>
  </body></html>`
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  Object.defineProperty(w.Element.prototype, 'scrollHeight', { get() { return parseInt(this.getAttribute('data-sh') || '0', 10) } })
  Object.defineProperty(w.Element.prototype, 'clientHeight', { get() { return parseInt(this.getAttribute('data-ch') || '0', 10) } })
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  await new Promise((r) => setTimeout(r, 40))
  const btn = w.document.querySelector('[wf-xano-element="show-more"]')
  const rte = w.document.querySelector('.rte')
  assert.ok(btn.__wfXanoShowMoreTarget === rte, 'glob spec resolves the target by scanning')
  assert.notEqual(btn.style.display, 'none', 'glob: clamped target keeps control visible')
  btn.click()
  assert.ok(!rte.classList.contains('text-style-5lines'), 'glob: desktop clamp stripped on expand')
  assert.ok(!rte.classList.contains('text-style-2lines-mob'), 'glob: -mob clamp ALSO stripped on expand')
  btn.click()
  assert.ok(rte.classList.contains('text-style-5lines'), 'glob: desktop clamp restored on collapse')
  assert.ok(rte.classList.contains('text-style-2lines-mob'), 'glob: -mob clamp restored on collapse')
  console.log('PASS 31: show-more glob wf-xano-class strips + restores every matching clamp class')
}

// ---------- Test 32: scalar response body -> error state, never a phantom row ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes('Brand profile not found') // debug.stop-style HTTP 200 string
  w.eval(LIB)
  const listEl = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => listEl.classList.contains('is-wf-xano-error')), 'scalar body surfaces error state')
  assert.equal(w.document.querySelectorAll('[wf-xano-item]').length, 0, 'no phantom card rendered')
  const N = w.WfXano._internal.normalize
  assert.throws(() => N('oops', 20), /unexpected response shape/, 'normalize throws on string')
  assert.throws(() => N(42, 20), /unexpected response shape/, 'normalize throws on number')
  assert.deepEqual(N({ id: 1 }, 20).total, 1, 'single object still renders one row')
  console.log('PASS 32: scalar 200 body -> error state, no phantom card')
}

// ---------- Test 33: URL-restore hydration fires change on radios (Webflow face sync), without a re-fetch ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <section wf-xano-element="wrapper" wf-xano-instance="opps" wf-xano-url-sync="true" wf-xano-source="g:p" wf-xano-auth="none">
      <label><input type="radio" name="status" wf-xano-filter="status" wf-xano-value="*" checked></label>
      <label><input type="radio" name="status" wf-xano-filter="status" wf-xano-value="Active"></label>
      <label><input type="radio" name="status" wf-xano-filter="status" wf-xano-value="Closed"></label>
      <div wf-xano-element="template"><h3 wf-xano-bind="title"></h3></div>
    </section></body></html>`,
    { runScripts: 'outside-only', url: 'https://x.test/page?opps_status=Closed' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  const bodies = []
  const changed = []
  w.document.addEventListener('change', (e) => changed.push(e.target.getAttribute('wf-xano-value')))
  w.fetch = (url, opts) => { bodies.push(JSON.parse(opts.body)); return makeRes(PAGE([{ id: 1, title: 'T', status: 'Closed' }], 1)) }
  w.eval(LIB)
  await waitFor(() => bodies.length === 1)
  const radios = [...w.document.querySelectorAll('[wf-xano-filter]')]
  assert.equal(radios[2].checked, true, 'Closed radio checked from URL')
  assert.equal(radios[0].checked, false, 'match-all radio unchecked from URL')
  assert.ok(changed.includes('Closed'), 'change event bubbles for the newly checked radio')
  assert.ok(changed.includes('*'), 'change event bubbles for the unchecked Designer-default radio')
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(bodies.length, 1, 'hydration change events do not trigger a second fetch')
  assert.equal(bodies[0].status, 'Closed', 'restored filter sent to the endpoint')
  // A real user change must still re-fetch (skip flag cleared after hydration).
  radios[1].checked = true
  radios[2].checked = false
  radios[1].dispatchEvent(new w.Event('change', { bubbles: true }))
  await waitFor(() => bodies.length === 2)
  assert.equal(bodies[1].status, 'Active', 'user change still re-fetches with the new value')
  console.log('PASS 33: URL-restore hydration dispatches change without re-fetch; user changes still fetch')
}

// ---------- Test 34: single-record image bind replaces stale responsive candidates ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="opp30:starter/profile/match-context" wf-xano-auth="none">
      <img
        wf-xano-element="template"
        wf-xano-src="profile_photo"
        src="https://example.test/memberstack-96.jpg"
        srcset="https://example.test/memberstack-96.jpg 96w"
      >
    </div>
  </body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes({
    starter_id: 643,
    profile_photo: 'https://x.example/vault/profile.jpg?tpl=large',
  })
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('[wf-xano-item]')), 'single profile record rendered')
  const image = w.document.querySelector('[wf-xano-item]')
  assert.equal(image.getAttribute('src'), 'https://x.example/vault/profile.jpg?tpl=large', 'Xano image becomes src')
  assert.equal(image.hasAttribute('srcset'), false, 'stale low-resolution srcset removed')
  console.log('PASS 34: single-record wf-xano-src replaces src and removes stale srcset')
}

// ---------- Test 35: image pipe fallbacks resolve left-to-right and preserve all-empty placeholders ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="opp30:starter/profile/me" wf-xano-auth="none">
      <img
        wf-xano-element="template"
        wf-xano-src="profile_photo|profile-photo-xano|profile-photo"
        src="https://example.test/placeholder.jpg"
        srcset="https://example.test/placeholder-96.jpg 96w"
      >
    </div>
  </body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes([
    { id: 1, profile_photo: 'https://x.example/vault/canonical.jpg?tpl=large', 'profile-photo-xano': 'https://x.example/vault/legacy.jpg' },
    { id: 2, profile_photo: '', 'profile-photo-xano': 'https://x.example/vault/fallback.jpg?tpl=large' },
    { id: 3 },
  ])
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 3), 'three image cases rendered')
  const images = [...w.document.querySelectorAll('[wf-xano-item]')]
  assert.equal(images[0].getAttribute('src'), 'https://x.example/vault/canonical.jpg?tpl=large', 'first non-blank field wins')
  assert.equal(images[0].hasAttribute('srcset'), false, 'primary bind removes stale srcset')
  assert.equal(images[1].getAttribute('src'), 'https://x.example/vault/fallback.jpg?tpl=large', 'blank primary falls through')
  assert.equal(images[1].hasAttribute('srcset'), false, 'fallback bind removes stale srcset')
  assert.equal(images[2].getAttribute('src'), 'https://example.test/placeholder.jpg', 'all-empty chain keeps placeholder src')
  assert.equal(images[2].getAttribute('srcset'), 'https://example.test/placeholder-96.jpg 96w', 'all-empty chain keeps placeholder srcset')
  console.log('PASS 35: wf-xano-src pipe fallbacks + all-empty placeholder preservation')
}

// ---------- Test 36: wf-xano-prefix / wf-xano-suffix wrap non-blank display values ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="opp30:brand/opportunities/list" wf-xano-auth="none" wf-xano-per-page="10">
      <div wf-xano-element="template">
        <span class="budget" wf-xano-bind="budget"></span><span class="freq" wf-xano-bind="budget_frequency" wf-xano-prefix=" / "></span>
        <span class="wrapped" wf-xano-bind="budget" wf-xano-prefix="$" wf-xano-suffix=" USD"></span>
        <input class="filter" wf-xano-bind="budget_frequency" wf-xano-prefix=" / ">
      </div>
      <div wf-xano-element="empty" style="display:none">none</div>
      <div wf-xano-element="loader">loading</div>
    </div>
  </body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([
    { id: 1, budget: '12414', budget_frequency: 'month' },
    { id: 2, budget: '9999', budget_frequency: '' }, // blank frequency -> no dangling " / "
  ], 2))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2), 'two cards rendered')
  const cards = [...w.document.querySelectorAll('[wf-xano-item]')]
  assert.equal(cards[0].querySelector('.freq').textContent, ' / month', 'prefix joins a non-blank frequency')
  assert.equal(cards[0].querySelector('.wrapped').textContent, '$12414 USD', 'prefix + suffix both wrap')
  assert.equal(cards[1].querySelector('.freq').textContent, '', 'blank value gets no prefix (no dangling separator)')
  assert.equal(cards[0].querySelector('input.filter').value, 'month', 'form-value binds ignore prefix/suffix')
  console.log('PASS 36: wf-xano-prefix/suffix wrap non-blank text binds, skip blanks and form values')
}

// ---------- Test 37: wf-xano-format lowercase/uppercase/capitalize (+ prefix compose) ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="opp30:brand/opportunities/list" wf-xano-auth="none" wf-xano-per-page="10">
      <div wf-xano-element="template">
        <span class="lower" wf-xano-bind="budget_frequency" wf-xano-prefix=" / " wf-xano-format="lowercase"></span>
        <span class="upper" wf-xano-bind="budget_frequency" wf-xano-format="uppercase"></span>
        <span class="cap" wf-xano-bind="title" wf-xano-format="capitalize"></span>
      </div>
      <div wf-xano-element="empty" style="display:none">none</div>
      <div wf-xano-element="loader">loading</div>
    </div>
  </body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, budget_frequency: 'Once', title: 'sENIOR gROWTH' }], 1))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'card rendered')
  const card = w.document.querySelector('[wf-xano-item]')
  assert.equal(card.querySelector('.lower').textContent, ' / once', 'lowercase applies before the prefix is prepended')
  assert.equal(card.querySelector('.upper').textContent, 'ONCE', 'uppercase transforms the value')
  assert.equal(card.querySelector('.cap').textContent, 'Senior growth', 'capitalize: first char up, rest lower')
  console.log('PASS 37: wf-xano-format lowercase/uppercase/capitalize compose with prefix')
}

// ---------- Test 38: wf-xano-default — literal shown when missing; real zero stays data ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none">
      <div wf-xano-element="template">
        <span class="count" wf-xano-bind="applicants" wf-xano-default="0"></span>
        <span class="chained" wf-xano-bind="applicants" wf-xano-fallback="applicant_count" wf-xano-default="0"></span>
        <span class="wrapped" wf-xano-bind="applicants" wf-xano-default="0" wf-xano-suffix=" applicants"></span>
        <span class="present" wf-xano-bind="applicants" wf-xano-default="0"></span>
        <input class="field" wf-xano-bind="applicants" wf-xano-default="0" />
      </div>
      <div wf-xano-element="empty" style="display:none">none</div>
      <div wf-xano-element="loader">loading</div>
    </div>
  </body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { debug: false }
  w.fetch = () => makeRes(PAGE([
    { id: 1, applicants: 0, applicant_count: 9 },    // real 0 must beat fallback/default
    { id: 2, applicants: null, applicant_count: 7 }, // fallback field wins over default
    { id: 3, applicants: 12 },                       // real value untouched
  ], 3))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 3), 'cards rendered')
  const cards = [...w.document.querySelectorAll('[wf-xano-item]')]
  assert.equal(cards[0].querySelector('.count').textContent, '0', 'count of 0 renders as real data')
  assert.equal(cards[0].querySelector('.chained').textContent, '0', 'real zero beats fallback and default')
  assert.equal(cards[0].querySelector('.wrapped').textContent, '0 applicants', 'zero composes with suffix')
  assert.equal(cards[0].querySelector('.field').value, '0', 'input preserves numeric zero')
  assert.equal(cards[1].querySelector('.chained').textContent, '7', 'wf-xano-fallback field beats the literal default')
  assert.equal(cards[2].querySelector('.present').textContent, '12', 'non-blank value ignores the default')
  console.log('PASS 38: wf-xano-default for missing values; zero remains data')
}

// ---------- Test 39: append failure preserves accumulated cards and retries the same page ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-load="more">
      <div wf-xano-element="list"><div wf-xano-element="template"><span wf-xano-bind="title"></span></div></div>
      <button wf-xano-element="load-more">More</button><div wf-xano-element="error" style="display:none">error</div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  const requestedPages = []
  let failPage2 = true
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => {
    const page = JSON.parse(opts.body).page
    requestedPages.push(page)
    if (page === 2 && failPage2) {
      failPage2 = false
      return makeRes({ message: 'temporary' }, false, 503)
    }
    return makeRes({ items: [{ id: page, title: 'Page ' + page }], curPage: page, nextPage: page < 2 ? page + 1 : null })
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'page 1 rendered')
  const inst = w.WfXano.instances[0]
  await inst.loadNext()
  assert.equal(w.document.querySelectorAll('[wf-xano-item]').length, 1, 'failed append preserves page 1')
  assert.equal(inst.page, 1, 'failed append rolls page state back')
  await inst.loadNext()
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2), 'retry appends page 2')
  assert.deepEqual(requestedPages, [1, 2, 2], 'retry requests the failed page again')
  console.log('PASS 39: append failure recovery preserves and retries')
}

// ---------- Test 40: URL sync allowlists controls and never serializes static params ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-instance="jobs" wf-xano-source="g:p" wf-xano-auth="none"
      wf-xano-url-sync="true" wf-xano-param-scope="private">
      <input wf-xano-filter="status"><div wf-xano-element="template"></div>
    </div></body></html>`, { runScripts: 'outside-only', url: 'https://x.test/?jobs_status=Open&jobs_scope=attacker&jobs_admin=true' })
  const w = dom.window
  let body
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => { body = JSON.parse(opts.body); return makeRes(PAGE([], 0)) }
  w.eval(LIB)
  assert.ok(await waitFor(() => body), 'request sent')
  assert.equal(body.status, 'Open', 'declared control restores from URL')
  assert.equal(body.scope, 'private', 'URL cannot overwrite static params')
  assert.equal(body.admin, undefined, 'undeclared URL field is ignored')
  assert.ok(!w.location.search.includes('jobs_scope='), 'static params are not serialized')
  assert.ok(!w.location.search.includes('jobs_admin='), 'unknown prefixed params are removed')
  console.log('PASS 40: URL state allowlist + static-param protection')
}

// ---------- Test 41: token trade uses POST body and session-cookie changes invalidate cache ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  w.document.querySelector('[wf-xano-list]').setAttribute('wf-xano-auth', 'memberstack')
  let cookie = 'jwt-a'
  const trades = []
  const authHeaders = []
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', preAuth: false, debug: false }
  w.$memberstackDom = {
    getCurrentMember: () => Promise.resolve({ data: { id: 'same-local-id' } }),
    getMemberCookie: () => Promise.resolve(cookie),
  }
  w.fetch = (url, opts) => {
    if (url.endsWith('/trade')) {
      trades.push({ url, opts })
      return makeRes({ authToken: 'xano-' + JSON.parse(opts.body).token })
    }
    authHeaders.push(opts.headers.Authorization)
    return makeRes(PAGE([], 0))
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => authHeaders.length === 1), 'initial authed request')
  assert.equal(trades[0].opts.method, 'POST')
  assert.equal(trades[0].opts.cache, 'no-store')
  assert.ok(!trades[0].url.includes(cookie), 'JWT is absent from URL')
  cookie = 'jwt-b'
  await w.WfXano.instances[0].refresh()
  assert.equal(trades.length, 2, 'cookie change retrades even when member id is unchanged')
  assert.equal(authHeaders.at(-1), 'Bearer xano-jwt-b')
  console.log('PASS 41: secure token POST + session-fingerprint invalidation')
}

// ---------- Test 42: GET avoids JSON preflight header; unsafe bound protocols are blocked ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="https://x.example/list" wf-xano-method="GET" wf-xano-auth="none">
      <a wf-xano-element="template" wf-xano-link="url"><img wf-xano-src="image"></a>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  let request
  w.WfXanoConfig = { debug: false }
  w.fetch = (url, opts) => {
    request = opts
    return makeRes(PAGE([{ id: 1, url: 'javascript:alert(1)', image: 'data:text/html,bad' }], 1))
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('[wf-xano-item]')), 'card rendered')
  const card = w.document.querySelector('[wf-xano-item]')
  assert.equal(request.headers['Content-Type'], undefined, 'GET omits JSON content type')
  assert.equal(card.hasAttribute('href'), false, 'unsafe href removed')
  assert.equal(card.querySelector('img').hasAttribute('src'), false, 'unsafe image src removed')
  console.log('PASS 42: simple GET headers + URL protocol guard')
}

// ---------- Test 43: lifecycle scoping handles scope roots, descendants, invalid wrappers, nested lists ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="invalid" wf-xano-element="wrapper" wf-xano-source="g:bad"></div>
    <div id="outer" wf-xano-element="wrapper" wf-xano-source="g:outer" wf-xano-auth="none">
      <div class="outer-template" wf-xano-element="template"><span wf-xano-bind="title"></span></div>
      <div id="inner" wf-xano-element="wrapper" wf-xano-source="g:inner" wf-xano-auth="none">
        <div class="inner-template" wf-xano-element="template"><span wf-xano-bind="title"></span></div>
      </div>
    </div>
    <div id="dynamic" wf-xano-element="wrapper" wf-xano-source="g:dynamic" wf-xano-auth="none">
      <div wf-xano-element="template"></div>
    </div>
  </body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => { calls.push(url); return makeRes(PAGE([{ id: 1, title: url.includes('inner') ? 'Inner' : 'Outer' }], 1)) }
  // Hold dynamic out of initial discovery, then initialize the element itself.
  const dynamic = w.document.querySelector('#dynamic')
  dynamic.remove()
  w.eval(LIB)
  assert.ok(await waitFor(() => w.WfXano.instances.length === 2), 'only valid outer/inner instances registered')
  assert.equal(w.document.querySelector('#invalid').__wfXano, undefined, 'invalid wrapper not registered')
  assert.equal(w.document.querySelectorAll('#outer > [wf-xano-item]').length, 1, 'outer owns exactly its direct card')
  assert.equal(w.document.querySelectorAll('#inner > [wf-xano-item]').length, 1, 'inner owns exactly its direct card')
  w.document.body.appendChild(dynamic)
  w.WfXano.init(dynamic)
  assert.ok(dynamic.__wfXano, 'init(scopeRoot) initializes the root itself')
  const before = calls.length
  await w.WfXano.refresh(dynamic.querySelector('[wf-xano-element="template"]'))
  assert.equal(calls.length, before + 1, 'refresh(descendant) targets only its owning instance')
  console.log('PASS 43: lifecycle and nested-instance scoping')
}

// ---------- Test 44: infinite mode observes a dedicated tail sentinel and keeps it after cards ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:p" wf-xano-auth="none" wf-xano-load="infinite">
      <div wf-xano-element="list"><div wf-xano-element="template"><span wf-xano-bind="title"></span></div></div>
    </div></body></html>`, { runScripts: 'outside-only' })
  const w = dom.window
  let observerCallback
  let observed
  w.IntersectionObserver = class {
    constructor(cb) { observerCallback = cb }
    observe(el) { observed = el }
    disconnect() {}
  }
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => {
    const page = JSON.parse(opts.body).page
    return makeRes({ items: [{ id: page, title: 'Page ' + page }], curPage: page, nextPage: page < 2 ? 2 : null })
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1), 'first page rendered')
  assert.ok(observed && observed.hasAttribute('data-wf-xano-sentinel'), 'observer watches dedicated sentinel')
  assert.equal(observed.previousElementSibling.hasAttribute('wf-xano-item'), true, 'sentinel remains after rendered cards')
  observerCallback([{ isIntersecting: true }])
  assert.ok(await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 2), 'intersection appends next page')
  assert.equal(observed.previousElementSibling.getAttribute('data-wf-xano-id'), '2', 'moving tail remains after newest card')
  console.log('PASS 44: infinite tail sentinel')
}

// ---------- Test 45: favorites hydrate/toggle inside wf-algolia cards ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <article data-wf-algolia-hit-objectid="wf-123">
      <button type="button" wf-xano-element="favorite" wf-xano-favorite-type="starter"
        wf-xano-favorite-label-add="Save Starter" wf-xano-favorite-label-remove="Remove saved Starter">
        <span wf-xano-element="favorite-visual"></span>
      </button>
    </article>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  const calls = []
  w.WfXanoConfig = {
    xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth',
    tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false,
  }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('jwt-brand') }
  w.fetch = (url, opts) => {
    calls.push({ url, opts })
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano-brand' })
    if (url.endsWith('/ids')) return makeRes({ ids: ['wf-123'] })
    if (url.endsWith('/toggle')) return makeRes({ favorited: false })
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  const button = w.document.querySelector('[wf-xano-element="favorite"]')
  const visual = w.document.querySelector('[wf-xano-element="favorite-visual"]')
  assert.ok(await waitFor(() => button.classList.contains('is-wf-xano-favorited')), 'initial IDs hydrate Algolia card')
  assert.equal(button.classList.contains('is-active'), true, 'default active class is applied to the control')
  assert.equal(visual.classList.contains('is-active'), true, 'default active class is applied to marked visual descendants')
  assert.equal(button.getAttribute('aria-pressed'), 'true')
  assert.equal(button.getAttribute('aria-label'), 'Remove saved Starter')
  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  assert.ok(await waitFor(() => calls.some((c) => c.url.endsWith('/toggle'))), 'toggle request sent')
  assert.equal(button.classList.contains('is-wf-xano-favorited'), false, 'authoritative unsaved state applied')
  assert.equal(button.classList.contains('is-active'), false, 'default active class is removed from the control')
  assert.equal(visual.classList.contains('is-active'), false, 'default active class is removed from marked visual descendants')
  const toggle = calls.find((c) => c.url.endsWith('/toggle'))
  assert.deepEqual(JSON.parse(toggle.opts.body), { item_type: 'starter', item_id: 'wf-123' })
  assert.equal(toggle.opts.headers.Authorization, 'Bearer xano-brand')
  console.log('PASS 45: favorite hydration/toggle on wf-algolia card')
}

// ---------- Test 46: duplicate controls sync and rapid clicks dedupe ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <article data-wf-algolia-hit-objectid="wf-9"><button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button></article>
    <article data-wf-algolia-hit-objectid="wf-9"><button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button></article>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  let toggleCalls = 0
  let releaseToggle
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('jwt') }
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano' })
    if (url.endsWith('/ids')) return makeRes({ ids: [] })
    if (url.endsWith('/toggle')) {
      toggleCalls += 1
      return new Promise((resolve) => { releaseToggle = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ favorited: true }) }) })
    }
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  const buttons = [...w.document.querySelectorAll('[wf-xano-element="favorite"]')]
  assert.ok(await waitFor(() => buttons.every((b) => b.getAttribute('aria-pressed') === 'false')), 'empty state hydrated')
  buttons[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  buttons[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  assert.ok(await waitFor(() => toggleCalls === 1), 'same item has only one in-flight mutation')
  assert.ok(buttons.every((b) => b.classList.contains('is-wf-xano-favorited')), 'optimistic state syncs every copy')
  assert.ok(buttons.every((b) => b.classList.contains('is-wf-xano-loading')), 'loading state syncs every copy')
  releaseToggle()
  assert.ok(await waitFor(() => buttons.every((b) => !b.classList.contains('is-wf-xano-loading'))), 'both copies settle')
  assert.ok(buttons.every((b) => b.classList.contains('is-wf-xano-favorited')), 'authoritative state stays synchronized')
  console.log('PASS 46: duplicate favorite controls + rapid-click dedupe')
}

// ---------- Test 47: failed optimistic toggle rolls back and emits safe error ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <article data-wf-algolia-hit-objectid="wf-fail"><button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button></article>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  let errorDetail
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('jwt') }
  w.document.addEventListener('wf-xano:favorite-error', (event) => { errorDetail = event.detail })
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano' })
    if (url.endsWith('/ids')) return makeRes({ ids: [] })
    if (url.endsWith('/toggle')) return makeRes({ message: 'private backend detail' }, false, 503)
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  const button = w.document.querySelector('[wf-xano-element="favorite"]')
  assert.ok(await waitFor(() => button.getAttribute('aria-pressed') === 'false'), 'initial state hydrated')
  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  assert.ok(await waitFor(() => errorDetail && errorDetail.item_id === 'wf-fail'), 'failure event emitted')
  assert.equal(button.classList.contains('is-wf-xano-favorited'), false, 'optimistic state rolled back')
  assert.deepEqual(errorDetail, { item_type: 'starter', item_id: 'wf-fail', status: 503 }, 'event excludes response body/auth data')
  console.log('PASS 47: favorite failure rollback + safe error event')
}

// ---------- Test 48: dynamic wf-xano cards hydrate and member switches clear old state ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-source="g:list" wf-xano-auth="none">
      <article wf-xano-element="template"><button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button></article>
    </div>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  let cookie = 'jwt-a'
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve(cookie) }
  w.fetch = (url, opts) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano-' + JSON.parse(opts.body).token })
    if (url.endsWith('/ids')) return makeRes({ ids: cookie === 'jwt-a' ? ['wf-a'] : [] })
    if (url.endsWith('/api:g/list')) return makeRes(PAGE([{ id: 'wf-a' }], 1))
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('[wf-xano-item] button')?.classList.contains('is-wf-xano-favorited')), 'dynamic wf-xano card hydrated')
  cookie = 'jwt-b'
  await w.WfXano.favorites.refresh('starter')
  const button = w.document.querySelector('[wf-xano-item] button')
  assert.equal(button.classList.contains('is-wf-xano-favorited'), false, 'account switch clears previous member state')
  assert.deepEqual(w.WfXano.favorites.ids('starter'), [], 'new member ID set replaces old member set')
  console.log('PASS 48: dynamic wf-xano card + member-switch isolation')
}

// ---------- Test 49: cards injected after boot with zero controls at load still hydrate ----------
{
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('jwt') }
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano' })
    if (url.endsWith('/ids')) return makeRes({ ids: ['wf-late'] })
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  await new Promise((r) => setTimeout(r, 30))
  const card = w.document.createElement('article')
  card.setAttribute('data-wf-algolia-hit-objectid', 'wf-late')
  card.innerHTML = '<button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button>'
  w.document.body.appendChild(card)
  assert.ok(await waitFor(() => card.querySelector('button').classList.contains('is-wf-xano-favorited')), 'card injected after boot hydrates saved state')
  console.log('PASS 49: post-boot injection hydrates when no controls exist at load')
}

// ---------- Test 50: logged-out visitor gets favorite controls hidden ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <article data-wf-algolia-hit-objectid="wf-x"><button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button></article>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  let errorDetail
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve(null) } // logged out
  w.document.addEventListener('wf-xano:favorite-error', (event) => { errorDetail = event.detail })
  w.fetch = (url) => { throw new Error('no network call expected when logged out: ' + url) }
  w.eval(LIB)
  const button = w.document.querySelector('[wf-xano-element="favorite"]')
  assert.ok(await waitFor(() => button.hidden === true), 'logged-out favorite control is hidden')
  assert.ok(errorDetail && errorDetail.item_type === 'starter', 'logged-out hydration surfaces a safe error event')
  console.log('PASS 50: logged-out visitor hides favorite controls without network calls')
}

// ---------- Test 51: logged-out auth failure is cached — later card batches hide without rechecking the session ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <article data-wf-algolia-hit-objectid="wf-1"><button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button></article>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  let cookieCalls = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => { cookieCalls++; return Promise.resolve(null) } } // logged out
  w.fetch = (url) => { throw new Error('no network call expected when logged out: ' + url) }
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('button').hidden === true), 'first logged-out control is hidden')
  const callsAfterBoot = cookieCalls
  assert.ok(callsAfterBoot >= 1, 'first hydration checks the session once')

  const card = w.document.createElement('article')
  card.setAttribute('data-wf-algolia-hit-objectid', 'wf-2')
  card.innerHTML = '<button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button>'
  w.document.body.appendChild(card)
  assert.ok(await waitFor(() => card.querySelector('button').hidden === true), 'later-injected control is hidden too')
  assert.equal(cookieCalls, callsAfterBoot, 'cached auth failure short-circuits — no session recheck per injected batch')
  console.log('PASS 51: cached auth failure hides new cards without rechecking the session')
}

// ---------- Test 52: auth-failed refresh drops the stale set so later batches stay hidden ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <article data-wf-algolia-hit-objectid="wf-1"><button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button></article>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  let authOk = true
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('jwt') }
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano' })
    if (url.endsWith('/ids')) return authOk ? makeRes({ ids: ['wf-1'] }) : makeRes(null, false, 401)
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  const first = w.document.querySelector('button')
  assert.ok(await waitFor(() => first.classList.contains('is-wf-xano-favorited')), 'initial hydration marks the saved card')

  authOk = false
  await w.WfXano.favorites.refresh('starter').catch(() => {})
  assert.ok(await waitFor(() => first.hidden === true), 'auth-failed refresh hides existing control')
  assert.deepEqual(w.WfXano.favorites.ids('starter'), [], 'stale set is dropped on auth failure')

  const card = w.document.createElement('article')
  card.setAttribute('data-wf-algolia-hit-objectid', 'wf-1')
  card.innerHTML = '<button wf-xano-element="favorite" wf-xano-favorite-type="starter"></button>'
  w.document.body.appendChild(card)
  const injected = card.querySelector('button')
  assert.ok(await waitFor(() => injected.hidden === true), 'batch injected after auth failure stays hidden')
  assert.equal(injected.classList.contains('is-wf-xano-favorited'), false, 'no stale favorited state repainted on injected card')
  console.log('PASS 52: auth-failed refresh clears the set so later cards are not un-hidden')
}

// ---------- Test 53: card capture handlers cannot swallow favorite clicks ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <a id="card" href="/profile" data-wf-algolia-hit-objectid="wf-click">
      <button type="button" wf-xano-element="favorite" wf-xano-favorite-type="starter"></button>
    </a>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  let toggleCalls = 0
  let cardClicks = 0
  const card = w.document.querySelector('#card')
  card.addEventListener('click', (event) => {
    cardClicks += 1
    event.stopPropagation()
  }, true)
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('jwt') }
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano' })
    if (url.endsWith('/ids')) return makeRes({ ids: [] })
    if (url.endsWith('/toggle')) {
      toggleCalls += 1
      return makeRes({ favorited: true })
    }
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  const button = w.document.querySelector('[wf-xano-element="favorite"]')
  assert.ok(await waitFor(() => button.getAttribute('aria-pressed') === 'false'), 'empty state hydrated')
  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.ok(await waitFor(() => toggleCalls === 1), 'directly bound favorite sends the toggle')
  assert.equal(cardClicks, 0, 'favorite click does not trigger the surrounding card navigation handler')
  assert.equal(button.getAttribute('aria-pressed'), 'true', 'authoritative saved state applied')
  console.log('PASS 53: document capture favorite listener precedes card interception')
}

// ---------- Test 54: favorite visual active class can be overridden ----------
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <article data-wf-algolia-hit-objectid="wf-visual">
      <button wf-xano-element="favorite" wf-xano-favorite-type="starter" wf-xano-favorite-class="custom-active">
        <svg wf-xano-element="favorite-visual"><path></path></svg>
        <span wf-xano-element="favorite-visual"></span>
        <span class="unmarked"></span>
      </button>
    </article>
  </body></html>`, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://x.example/api:auth', tradeTokenPath: '/trade', favoritesSource: 'opp30:brand/favorites', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('jwt') }
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'xano' })
    if (url.endsWith('/ids')) return makeRes({ ids: ['wf-visual'] })
    throw new Error('unexpected URL ' + url)
  }
  w.eval(LIB)
  const button = w.document.querySelector('[wf-xano-element="favorite"]')
  const visuals = [...w.document.querySelectorAll('[wf-xano-element="favorite-visual"]')]
  assert.ok(await waitFor(() => button.classList.contains('custom-active')), 'configured class hydrates on the control')
  assert.ok(visuals.every((el) => el.classList.contains('custom-active')), 'configured class hydrates on every marked visual')
  assert.equal(button.classList.contains('is-active'), false, 'configured class replaces the default visual class')
  assert.equal(w.document.querySelector('.unmarked').classList.contains('custom-active'), false, 'unmarked descendants are unchanged')
  assert.equal(button.classList.contains('is-wf-xano-favorited'), true, 'internal compatibility class remains')
  console.log('PASS 54: configurable favorite active class targets marked visuals only')
}

// ---------- Test 55: reactive state is observable but cannot be mutated externally ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.fetch = (url, opts) => {
    const payload = JSON.parse(opts.body)
    calls.push(payload)
    return makeRes(PAGE([{ id: calls.length, title: 'Row ' + calls.length }], 2, payload.page, 2))
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano), 'instance initialized')
  const inst = root.__wfXano
  assert.ok(await waitFor(() => inst.getState().status === 'success'), 'initial store reaches success')
  const snapshot = inst.getState()
  assert.equal(snapshot.data.items[0].title, 'Row 1')
  snapshot.data.items[0].title = 'tampered'
  snapshot.query.params.injected = 'nope'
  assert.equal(inst.getState().data.items[0].title, 'Row 1', 'item snapshot is defensive')
  assert.equal(inst.getState().query.params.injected, undefined, 'query snapshot is defensive')

  const statuses = []
  const unsubscribe = inst.subscribe((state) => state.status, (status) => statuses.push(status))
  inst.on('results', (result) => { result.items[0].title = 'legacy listener mutation' })
  await inst.setParam('status', 'Closed')
  assert.deepEqual(statuses, ['success', 'loading', 'success'], 'selector receives only changed values')
  assert.equal(inst.getState().query.params.status, 'Closed')
  assert.equal(inst.getState().query.page, 1)
  assert.equal(inst.getState().data.items[0].title, 'Row 2', 'legacy result listeners cannot mutate store records')
  unsubscribe()
  await inst.refresh()
  assert.deepEqual(statuses, ['success', 'loading', 'success'], 'unsubscribe stops delivery')
  console.log('PASS 55: defensive reactive state and selector subscriptions')
}

// ---------- Test 56: append state accumulates the same stable rows as the DOM ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  let call = 0
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.fetch = () => {
    call += 1
    return makeRes(PAGE([{ id: 'row-' + call, title: 'Row ' + call }], 2, call, 2))
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano), 'instance initialized')
  const inst = root.__wfXano
  assert.ok(await waitFor(() => inst.getState().status === 'success'))
  await inst.load({ append: true })
  assert.deepEqual(inst.getState().data.items.map((item) => item.id), ['row-1', 'row-2'])
  const audit = inst.audit()
  assert.equal(audit.ok, true)
  assert.deepEqual(audit.differences, [])
  assert.deepEqual(w.WfXano.audit()[0], audit, 'global audit delegates to the instance')
  assert.equal(JSON.stringify(audit).includes('title'), false, 'audit excludes response fields')
  console.log('PASS 56: append accumulation and privacy-safe shadow audit')
}

// ---------- Test 57: failed loads expose sanitized state and preserve legacy error events ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.console.error = () => {}
  w.fetch = () => makeRes({ private_detail: 'do not expose' }, false, 503)
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano), 'instance initialized')
  const inst = root.__wfXano
  assert.ok(await waitFor(() => inst.getState().status === 'error'))
  const state = inst.getState()
  assert.deepEqual(state.error, { name: 'Error', status: 503 })
  assert.equal(JSON.stringify(state).includes('private_detail'), false, 'response body is excluded from state')
  assert.deepEqual(state.data.items, [])
  console.log('PASS 57: sanitized error state')
}

// ---------- Test 58: stateChange metadata is privacy-safe and destroy is terminal ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 1, title: 'Private row title' }], 1))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano), 'instance initialized')
  const inst = root.__wfXano
  assert.ok(await waitFor(() => inst.getState().status === 'success'))
  const changes = []
  inst.on('stateChange', (change) => changes.push(change))
  const subscribed = []
  inst.subscribe((state) => state.status, (status) => subscribed.push(status))
  inst.destroy()
  assert.equal(inst.getState().status, 'destroyed')
  assert.equal(subscribed.at(-1), 'destroyed')
  assert.equal(changes.at(-1).reason, 'destroy')
  assert.equal(JSON.stringify(changes).includes('Private row title'), false)
  assert.equal(w.WfXano.instances.length, 0)
  console.log('PASS 58: privacy-safe stateChange and terminal destroy state')
}

// ---------- Test 59: account switches clear member-scoped store data before replacement ----------
{
  const dom = new JSDOM(BASIC_MARKUP.replace('wf-xano-auth="none"', 'wf-xano-auth="memberstack"'), { runScripts: 'outside-only' })
  const w = dom.window
  let session = 'member-a-jwt'
  let listCalls = 0
  let releaseSecond
  w.WfXanoConfig = {
    xanoBase: 'https://h.xano.io',
    authBase: 'https://h.xano.io/api:auth',
    tradeTokenPath: '/trade',
    preAuth: false,
    debug: false,
  }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve(session) }
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'token-for-' + session })
    listCalls += 1
    if (listCalls === 1) return makeRes(PAGE([{ id: 'member-a-row', title: 'A' }], 1))
    return new Promise((resolve) => {
      releaseSecond = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(PAGE([{ id: 'member-b-row', title: 'B' }], 1)) })
    })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().status === 'success'))
  const inst = root.__wfXano
  assert.equal(inst.getState().data.items[0].id, 'member-a-row')
  session = 'member-b-jwt'
  const pending = inst.refresh()
  assert.ok(await waitFor(() => listCalls === 2), 'replacement request is pending')
  assert.deepEqual(inst.getState().data.items, [], 'prior member snapshot cleared before replacement resolves')
  releaseSecond()
  await pending
  assert.equal(inst.getState().data.items[0].id, 'member-b-row')
  console.log('PASS 59: account-switch store isolation')
}

// ---------- Test 60: account switch clears and reloads every authenticated instance ----------
{
  const MARKUP = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-instance="a" wf-xano-source="opp30:a/list" wf-xano-auth="memberstack" wf-xano-per-page="10">
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
      <div wf-xano-empty style="display:none">none</div>
    </div>
    <div wf-xano-list wf-xano-instance="b" wf-xano-source="opp30:b/list" wf-xano-auth="memberstack" wf-xano-per-page="10">
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
      <div wf-xano-empty style="display:none">none</div>
    </div></body></html>`
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  let session = 'member-a-jwt'
  const listCalls = []
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve(session) }
  w.fetch = (url) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'token-for-' + session })
    const key = /a\/list/.test(url) ? 'a' : 'b'
    listCalls.push(key + ':' + session)
    return makeRes(PAGE([{ id: key + '-' + session, title: key.toUpperCase() }], 1))
  }
  w.eval(LIB)
  const lists = w.document.querySelectorAll('[wf-xano-list]')
  assert.ok(await waitFor(() => lists[0].__wfXano && lists[1].__wfXano))
  const instA = lists[0].__wfXano
  const instB = lists[1].__wfXano
  assert.ok(await waitFor(() => instA.getState().status === 'success' && instB.getState().status === 'success'))
  assert.equal(instA.getState().data.items[0].id, 'a-member-a-jwt')
  // Only B explicitly refreshes. The auth reset must clear and reload A too.
  session = 'member-b-jwt'
  await instB.refresh()
  assert.ok(await waitFor(() => instA.getState().data.items[0]?.id === 'a-member-b-jwt'))
  const a = instA.getState()
  assert.equal(a.status, 'success', 'other authenticated instance reloads to success')
  assert.equal(a.data.items[0].id, 'a-member-b-jwt', 'other instance refills with new member data')
  assert.equal(instB.getState().data.items[0].id, 'b-member-b-jwt', 'reloading instance refills with new member data')
  assert.ok(listCalls.includes('a:member-b-jwt'), 'account switch triggers the other authenticated list request')
  assert.equal(instA.audit().ok, true, 'reloaded list DOM and store remain aligned')
  console.log('PASS 60: account switch clears and reloads every authenticated instance')
}

// ---------- Test 61: account switch resets page but preserves active filters ----------
{
  const MARKUP = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-instance="a" wf-xano-source="opp30:a/list" wf-xano-auth="memberstack" wf-xano-per-page="10">
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
      <div wf-xano-empty style="display:none">none</div>
    </div>
    <div wf-xano-list wf-xano-instance="b" wf-xano-source="opp30:b/list" wf-xano-auth="memberstack" wf-xano-per-page="10">
      <div wf-xano-template><h3 wf-xano-bind="title"></h3></div>
      <div wf-xano-empty style="display:none">none</div>
    </div></body></html>`
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  let session = 'member-a-jwt'
  const requests = []
  w.WfXanoConfig = { xanoBase: 'https://h.xano.io', authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', preAuth: false, debug: false }
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve(session) }
  w.fetch = (url, req) => {
    if (url.endsWith('/trade')) return makeRes({ authToken: 'token-for-' + session })
    const key = /a\/list/.test(url) ? 'a' : 'b'
    const body = req && req.body ? JSON.parse(req.body) : {}
    requests.push({ key, session, page: body.page, kind: body.kind })
    // Page 2 for account A only has data on account A; account B has 1 page.
    return makeRes(PAGE([{ id: key + '-' + session, title: key.toUpperCase() }], 30, body.page || 1, 3))
  }
  w.eval(LIB)
  const lists = w.document.querySelectorAll('[wf-xano-list]')
  assert.ok(await waitFor(() => lists[0].__wfXano && lists[1].__wfXano))
  const instA = lists[0].__wfXano
  const instB = lists[1].__wfXano
  assert.ok(await waitFor(() => instA.getState().status === 'success' && instB.getState().status === 'success'))
  // A navigates to page 2 with a member-A filter before the account switch.
  await instA.setParam('kind', 'alpha')
  await instA.goToPage(2)
  assert.ok(await waitFor(() => instA.getState().query.page === 2 && instA.getParams().kind === 'alpha'))
  requests.length = 0
  session = 'member-b-jwt'
  await instB.refresh()
  assert.ok(await waitFor(() => instA.getState().data.items[0]?.id === 'a-member-b-jwt'))
  const reloadA = requests.filter((r) => r.key === 'a' && r.session === 'member-b-jwt').pop()
  assert.ok(reloadA, 'A reloads on the account switch')
  assert.equal(reloadA.page, 1, 'reload requests page 1, not the stale page 2')
  assert.equal(reloadA.kind, 'alpha', 'reload preserves the active filter')
  assert.equal(instA.getState().query.page, 1, 'store query resets to page 1')
  assert.deepEqual(instA.getParams(), { kind: 'alpha' }, 'active params remain intact')
  assert.equal(instA.audit().ok, true, 'reset reload keeps DOM and store aligned')
  console.log('PASS 61: account switch resets page and preserves filters')
}

// ---------- Test 62: opt-in state text/condition/class projections follow lifecycle ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none"
      wf-xano-class-state="is-loading:status === 'loading';has-results:data.total > 0;bad class:status">
      <span wf-xano-state="status"></span>
      <span wf-xano-state="data.total" wf-xano-prefix="Total: "></span>
      <div wf-xano-if-state="status === 'loading'" wf-xano-display="flex">Loading state</div>
      <div wf-xano-if-state="status === 'success'">Ready state</div>
      <div wf-xano-template><span wf-xano-bind="title"></span></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let release
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => new Promise((resolve) => {
    release = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(PAGE([{ id: 1, title: 'One' }], 7)) })
  })
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano && root.classList.contains('is-loading')), 'loading class projects')
  const loading = root.querySelector('[wf-xano-if-state*="loading"]')
  const ready = root.querySelector('[wf-xano-if-state*="success"]')
  assert.equal(root.querySelector('[wf-xano-state="status"]').textContent, 'loading')
  assert.equal(root.querySelector('[wf-xano-state="data.total"]').textContent, 'Total: 0')
  assert.equal(loading.style.display, 'flex')
  assert.equal(loading.hasAttribute('aria-hidden'), false)
  assert.equal(ready.style.display, 'none')
  assert.equal(ready.getAttribute('aria-hidden'), 'true')
  assert.equal(root.classList.contains('bad'), false, 'invalid class directive is ignored')
  release()
  assert.ok(await waitFor(() => root.__wfXano.getState().status === 'success' && root.classList.contains('has-results')))
  assert.equal(root.querySelector('[wf-xano-state="status"]').textContent, 'success')
  assert.equal(root.querySelector('[wf-xano-state="data.total"]').textContent, 'Total: 7')
  assert.equal(loading.style.display, 'none')
  assert.equal(loading.getAttribute('aria-hidden'), 'true')
  assert.equal(ready.style.display, '')
  assert.equal(ready.hasAttribute('aria-hidden'), false)
  assert.equal(root.classList.contains('is-loading'), false)
  console.log('PASS 62: state text/condition/class lifecycle projections')
}

// ---------- Test 63: projections respect wrapper ownership and external instance keys ----------
{
  const markup = `<!doctype html><html><body>
    <span id="a-total" wf-xano-state="data.total" wf-xano-instance="a"></span>
    <span id="b-total" wf-xano-state="data.total" wf-xano-instance="b"></span>
    <div wf-xano-list wf-xano-instance="a" wf-xano-source="api:a" wf-xano-auth="none">
      <span class="inside" wf-xano-state="data.total"></span>
      <div wf-xano-template><span wf-xano-bind="title"></span></div>
    </div>
    <div wf-xano-list wf-xano-instance="b" wf-xano-source="api:b" wf-xano-auth="none">
      <span class="inside" wf-xano-state="data.total"></span>
      <div wf-xano-template><span wf-xano-bind="title"></span></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => makeRes(PAGE([{ id: url.endsWith('/a') ? 'a' : 'b', title: 'Row' }], url.endsWith('/a') ? 3 : 9))
  w.eval(LIB)
  assert.ok(await waitFor(() => w.document.querySelector('#a-total').textContent === '3' && w.document.querySelector('#b-total').textContent === '9'))
  const roots = w.document.querySelectorAll('[wf-xano-list]')
  assert.equal(roots[0].querySelector('.inside').textContent, '3')
  assert.equal(roots[1].querySelector('.inside').textContent, '9')
  console.log('PASS 63: projection wrapper/instance scoping')
}

// ---------- Test 64: synchronous transitions batch into one projection pass ----------
{
  const dom = new JSDOM(BASIC_MARKUP.replace('<div wf-xano-empty', '<span wf-xano-state="revision"></span><div wf-xano-empty'), { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().status === 'success'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const inst = root.__wfXano
  let passes = 0
  const original = inst._projectState
  inst._projectState = function () { passes += 1; return original.call(inst) }
  inst._transition({ local: { selected: [1] } }, 'test:first')
  inst._transition({ local: { selected: [1, 2] } }, 'test:second')
  assert.ok(await waitFor(() => passes === 1))
  assert.equal(root.querySelector('[wf-xano-state="revision"]').textContent, String(inst.getState().revision))
  console.log('PASS 64: one batched projection pass per synchronous transition group')
}

// ---------- Test 65: destroy cancels a queued projection pass ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([], 0))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().status === 'success'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  const inst = root.__wfXano
  let passes = 0
  inst._projectState = () => { passes += 1 }
  inst._transition({ local: { queued: true } }, 'test:queued')
  inst.destroy()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(passes, 0)
  console.log('PASS 65: destroy cancels queued projections')
}

// ---------- Test 66: pessimistic action payload, dedupe, lifecycle, and self invalidation ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none">
      <div wf-xano-template>
        <span wf-xano-bind="title"></span>
        <button wf-xano-action="archive" wf-xano-action-source="api:archive"
          wf-xano-action-method="PATCH" wf-xano-action-param-record_id="item:id"
          wf-xano-action-param-mode="literal:archived" wf-xano-action-idempotency="item:id"
          aria-disabled="false">Archive</button>
      </div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let releaseAction
  let listCalls = 0
  let actionCalls = 0
  let actionRequest
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => {
    if (url.endsWith('/list')) {
      listCalls += 1
      return makeRes(PAGE([{ id: 7, title: listCalls === 1 ? 'Open' : 'Archived' }], 1))
    }
    actionCalls += 1
    actionRequest = opts
    return new Promise((resolve) => {
      releaseAction = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 7, secret: 'not-public' }) })
    })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item] [wf-xano-action]')))
  const inst = root.__wfXano
  const events = []
  inst.on('actionStart', (event) => events.push(event))
  inst.on('actionSuccess', (event) => events.push(event))
  const button = root.querySelector('[wf-xano-item] [wf-xano-action]')
  const first = inst.runAction(button)
  const duplicate = inst.runAction(button)
  assert.equal(first, duplicate, 'same action/item returns the one active mutation promise')
  assert.ok(await waitFor(() => inst.getState().mutation['archive:7']?.status === 'pending'))
  assert.equal(button.disabled, true)
  assert.equal(button.getAttribute('aria-busy'), 'true')
  assert.equal(button.classList.contains('is-wf-xano-mutating'), true)
  assert.equal(root.classList.contains('is-wf-xano-mutating'), true)
  assert.equal(actionCalls, 1, 'duplicate action sends one mutation')
  assert.equal(actionRequest.method, 'PATCH')
  assert.deepEqual(JSON.parse(actionRequest.body), { record_id: 7, mode: 'archived' })
  assert.equal(actionRequest.headers['Idempotency-Key'], '7')
  releaseAction()
  assert.equal(await first, true)
  assert.ok(await waitFor(() => listCalls === 2 && inst.getState().mutation['archive:7']?.status === 'success'))
  const refreshed = root.querySelector('[wf-xano-item] [wf-xano-action]')
  assert.equal(refreshed.disabled, false)
  assert.equal(refreshed.getAttribute('aria-disabled'), 'false', 'authored ARIA state is restored')
  assert.equal(refreshed.classList.contains('is-wf-xano-action-success'), true)
  assert.equal(root.querySelector('[wf-xano-item] [wf-xano-bind="title"]').textContent, 'Archived')
  assert.equal(JSON.stringify(inst.getState()).includes('not-public'), false, 'response body is absent from state')
  assert.equal(JSON.stringify(events).includes('not-public'), false, 'response body is absent from events')
  console.log('PASS 66: pessimistic action lifecycle, dedupe, allowlisted payload, and refresh')
}

// ---------- Test 67: action HTTP failures, timeout, and retry stay safe ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none">
      <div wf-xano-template><button wf-xano-action="archive" wf-xano-action-source="api:archive"
        wf-xano-action-param-record_id="item:id">Archive</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  const failures = [400, 401, 403, 404, 409, 422, 500]
  let actionAttempt = 0
  let listCalls = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => {
    if (url.endsWith('/list')) {
      listCalls += 1
      return makeRes(PAGE([{ id: 8 }], 1))
    }
    const attempt = actionAttempt++
    if (attempt < failures.length) return makeRes({ message: 'private failure body' }, false, failures[attempt])
    if (attempt === failures.length) return Promise.reject(Object.assign(new Error('private timeout detail'), { name: 'TimeoutError' }))
    return makeRes({ id: 8, private: true })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item] [wf-xano-action]')))
  const inst = root.__wfXano
  const errors = []
  inst.on('actionError', (event) => errors.push(event))
  const button = root.querySelector('[wf-xano-item] [wf-xano-action]')
  for (const status of failures) {
    assert.equal(await inst.runAction(button), false)
    assert.equal(inst.getState().mutation['archive:8'].status, 'error')
    assert.equal(inst.getState().mutation['archive:8'].error.status, status)
  }
  assert.equal(await inst.runAction(button), false, 'timeout remains retryable')
  assert.equal(inst.getState().mutation['archive:8'].error.name, 'TimeoutError')
  assert.equal(JSON.stringify(errors).includes('private'), false, 'safe errors omit response bodies/messages')
  assert.equal(await inst.runAction(button), true, 'retry succeeds')
  assert.ok(await waitFor(() => listCalls === 2))
  assert.equal(inst.getState().mutation['archive:8'].status, 'success')
  const refreshed = root.querySelector('[wf-xano-item] [wf-xano-action]')
  refreshed.setAttribute('wf-xano-action-param-record_id', 'item:missing')
  assert.equal(await inst.runAction(refreshed), false, 'invalid binding fails before fetch')
  assert.deepEqual(inst._activeMutations, {}, 'synchronous validation failure releases the action key')
  refreshed.setAttribute('wf-xano-action-param-record_id', 'item:id')
  assert.equal(await inst.runAction(refreshed), true, 'binding can be corrected and retried')
  console.log('PASS 67: action HTTP failures, timeout, safe errors, and retry')
}

// ---------- Test 68: external action form bindings and named invalidation are scoped/deduped ----------
{
  const markup = `<!doctype html><html><body>
    <form>
      <input wf-xano-action-field="reason" value="cleanup">
      <button id="external-action" wf-xano-instance="a" wf-xano-action="archive"
        wf-xano-action-source="api:archive" wf-xano-action-auth="none"
        wf-xano-action-param-reason="form:reason" wf-xano-action-param-mode="literal:archive"
        wf-xano-action-idempotency="literal:operation-1" wf-xano-action-invalidate="a,b,a">Archive</button>
    </form>
    <div wf-xano-list wf-xano-instance="a" wf-xano-source="api:a" wf-xano-auth="none">
      <div wf-xano-template><span wf-xano-bind="title"></span></div>
    </div>
    <div wf-xano-list wf-xano-instance="b" wf-xano-source="api:b" wf-xano-auth="none">
      <div wf-xano-template><span wf-xano-bind="title"></span></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  const calls = []
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => {
    calls.push({ url, opts })
    if (url.endsWith('/archive')) return makeRes({ ok: true })
    return makeRes(PAGE([{ id: url.endsWith('/a') ? 'a1' : 'b1', title: 'Row' }], 1))
  }
  w.eval(LIB)
  assert.ok(await waitFor(() => calls.filter((call) => !call.url.endsWith('/archive')).length === 2))
  const inst = w.WfXano.get('a')
  const button = w.document.querySelector('#external-action')
  await assert.rejects(w.WfXano.get('b').runAction(button), /does not belong to instance/)
  button.click()
  assert.ok(await waitFor(() => inst.getState().mutation.archive?.status === 'success'))
  const mutation = calls.filter((call) => call.url.endsWith('/archive'))[0]
  assert.deepEqual(JSON.parse(mutation.opts.body), { reason: 'cleanup', mode: 'archive' })
  assert.equal(mutation.opts.headers['Idempotency-Key'], 'operation-1')
  assert.equal(calls.filter((call) => call.url.endsWith('/a')).length, 2, 'A invalidated once')
  assert.equal(calls.filter((call) => call.url.endsWith('/b')).length, 2, 'B invalidated once')
  assert.equal(button.classList.contains('is-wf-xano-action-success'), true)
  console.log('PASS 68: external form action and named invalidation scoping')
}

// ---------- Test 69: account switch aborts pending authenticated mutations ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list">
      <div wf-xano-template><button wf-xano-action="archive" wf-xano-action-source="api:archive"
        wf-xano-action-param-record_id="item:id">Archive</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let session = 'member-a'
  let actionAborted = false
  let actionCalls = 0
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve(session) }
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://auth.example', preAuth: false, debug: false }
  w.fetch = (url, opts) => {
    if (url.includes('/auth/trade-token')) {
      const member = JSON.parse(opts.body).token
      return makeRes({ authToken: `xano-${member}` })
    }
    if (url.endsWith('/list')) {
      const member = opts.headers.Authorization.endsWith('member-a') ? 'a' : 'b'
      return makeRes(PAGE([{ id: member, title: member }], 1))
    }
    actionCalls += 1
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        actionAborted = true
        reject(new w.DOMException('Aborted', 'AbortError'))
      })
    })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[data-wf-xano-id="a"] [wf-xano-action]')))
  const inst = root.__wfXano
  const pending = inst.runAction(root.querySelector('[wf-xano-item] [wf-xano-action]'))
  assert.ok(await waitFor(() => actionCalls === 1 && inst.getState().mutation['archive:a']?.status === 'pending'))
  session = 'member-b'
  await inst.load()
  assert.equal(await pending, false)
  assert.equal(actionAborted, true)
  assert.deepEqual(inst.getState().mutation, {}, 'previous-account mutation state is cleared')
  assert.ok(root.querySelector('[data-wf-xano-id="b"]'))
  console.log('PASS 69: account switch aborts and clears pending authenticated actions')
}

// ---------- Test 70: destroy aborts a pending action without terminal events ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none">
      <div wf-xano-template><button wf-xano-action="archive" wf-xano-action-source="api:archive"
        wf-xano-action-param-record_id="item:id">Archive</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let aborted = false
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => {
    if (url.endsWith('/list')) return makeRes(PAGE([{ id: 9 }], 1))
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        aborted = true
        reject(new w.DOMException('Aborted', 'AbortError'))
      })
    })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item] [wf-xano-action]')))
  const inst = root.__wfXano
  const terminal = []
  inst.on('actionSuccess', (event) => terminal.push(event))
  inst.on('actionError', (event) => terminal.push(event))
  const pending = inst.runAction(root.querySelector('[wf-xano-item] [wf-xano-action]'))
  assert.ok(await waitFor(() => inst.getState().mutation['archive:9']?.status === 'pending'))
  inst.destroy()
  assert.equal(await pending, false)
  assert.equal(aborted, true)
  assert.equal(inst.getState().status, 'destroyed')
  assert.deepEqual(inst.getState().mutation, {})
  assert.deepEqual(terminal, [])
  console.log('PASS 70: destroy aborts pending actions without stale terminal events')
}

// ---------- Test 71: action method and authenticated-origin guards block writes ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list">
      <div wf-xano-template><button wf-xano-action="archive" wf-xano-action-source="api:archive"
        wf-xano-action-method="GET" wf-xano-action-param-record_id="item:id">Archive</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let mutationCalls = 0
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('member-a') }
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://auth.example', preAuth: false, debug: false }
  w.fetch = (url) => {
    if (url.includes('/auth/trade-token')) return makeRes({ authToken: 'xano-a' })
    if (url.endsWith('/list')) return makeRes(PAGE([{ id: 10 }], 1))
    mutationCalls += 1
    return makeRes({ ok: true })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item] [wf-xano-action]')))
  const inst = root.__wfXano
  const button = root.querySelector('[wf-xano-item] [wf-xano-action]')
  await assert.rejects(inst.runAction(button), /Invalid wf-xano action configuration/)
  button.setAttribute('wf-xano-action-method', 'POST')
  button.setAttribute('wf-xano-action-source', 'https://outside.example/mutate')
  await assert.rejects(inst.runAction(button), /outside xanoBase origin/)
  assert.equal(mutationCalls, 0)
  assert.deepEqual(inst.getState().mutation, {})
  console.log('PASS 71: action method and authenticated-origin guards')
}

// ---------- Test 72: keyed reconciliation preserves node and interactive state ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none"
      wf-xano-reconcile="keyed" wf-xano-key="uuid">
      <div wf-xano-template>
        <span wf-xano-bind="title"></span><input wf-xano-bind="draft">
        <div class="clamp"><button wf-xano-element="show-more" wf-xano-class="clamp">More</button></div>
        <div wf-xano-list><span wf-xano-bind="title">nested-owned</span></div>
      </div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let rows = [
    { uuid: 'a', title: 'Alpha', draft: 'server-a' },
    { uuid: 'b', title: 'Beta', draft: 'server-b' },
  ]
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE(rows, rows.length))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list][wf-xano-source]')
  assert.ok(await waitFor(() => root.querySelectorAll('[wf-xano-item]').length === 2))
  const first = root.querySelector('[data-wf-xano-id="a"]')
  const input = first.querySelector('input')
  input.value = 'local draft'
  input.focus()
  first.classList.add('is-expanded-local')
  rows = [
    { uuid: 'b', title: 'Beta revised', draft: 'server-b-2' },
    { uuid: 'a', title: 'Alpha revised', draft: 'server-a-2' },
  ]
  await root.__wfXano.refresh()
  const cards = root.querySelectorAll(':scope > [wf-xano-item]')
  assert.equal(cards[1], first, 'same keyed DOM node is moved, not replaced')
  assert.equal(first.querySelector('[wf-xano-bind="title"]').textContent, 'Alpha revised')
  assert.equal(input.value, 'local draft', 'dirty focused input is preserved')
  assert.equal(w.document.activeElement, input, 'focus is preserved')
  assert.equal(first.classList.contains('is-expanded-local'), true, 'local expanded state is preserved')
  assert.equal(first.querySelector('[wf-xano-list]:not([wf-xano-source]) [wf-xano-bind]').textContent, 'nested-owned', 'nested owner is not rebound')
  assert.deepEqual([...cards].map((card) => card.getAttribute('data-wf-xano-id')), ['b', 'a'])
  assert.equal(root.__wfXano.audit().ok, true)
  rows = [{ uuid: 'b', title: 'Duplicate 1' }, { uuid: 'b', title: 'Duplicate 2' }]
  await root.__wfXano.refresh()
  assert.equal(root.__wfXano.getState().status, 'error', 'invalid key sets fail closed')
  assert.deepEqual([...root.querySelectorAll(':scope > [wf-xano-item]')].map((card) => card.getAttribute('data-wf-xano-id')), ['b', 'a'], 'invalid response cannot partially mutate DOM')
  console.log('PASS 72: keyed reconciliation preserves identity, focus, input, expansion, and nested ownership')
}

// ---------- Test 73: optimistic partial response refreshes and converges ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
      <div wf-xano-template><span wf-xano-bind="status"></span><button wf-xano-action="close"
        wf-xano-action-source="api:close" wf-xano-action-param-record_id="item:id"
        wf-xano-action-optimistic="true" wf-xano-action-optimistic-field="status"
        wf-xano-action-optimistic-value="literal:Closed"
        wf-xano-action-optimistic-rollback="item:status">Close</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let listCalls = 0
  let release
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => {
    if (url.endsWith('/list')) return makeRes(PAGE([{ id: 1, status: ++listCalls === 1 ? 'Live' : 'Closed' }], 1))
    return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }) })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item]')))
  const card = root.querySelector('[wf-xano-item]')
  const action = root.__wfXano.runAction(card.querySelector('button'))
  assert.ok(await waitFor(() => card.querySelector('[wf-xano-bind]').textContent === 'Closed'), 'overlay paints before response')
  release()
  assert.equal(await action, true)
  assert.equal(listCalls, 2, 'partial response invalidates the authoritative list')
  assert.equal(root.querySelector('[wf-xano-item]'), card, 'authoritative refresh keeps stable node')
  assert.equal(root.__wfXano.getState().data.items[0].status, 'Closed')
  console.log('PASS 73: optimistic partial response converges through authoritative refresh')
}

// ---------- Test 74: optimistic failure rolls back exactly ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
      <div wf-xano-template><span wf-xano-bind="status"></span><button wf-xano-action="close"
        wf-xano-action-source="api:close" wf-xano-action-optimistic="true"
        wf-xano-action-optimistic-field="status" wf-xano-action-optimistic-value="literal:Closed"
        wf-xano-action-optimistic-rollback="item:status">Close</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let release
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => url.endsWith('/list')
    ? makeRes(PAGE([{ id: 2, status: 'Live' }], 1))
    : new Promise((resolve) => { release = () => resolve({ ok: false, status: 409, json: () => Promise.resolve({ secret: 'hidden' }) }) })
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item]')))
  const card = root.querySelector('[wf-xano-item]')
  const action = root.__wfXano.runAction(card.querySelector('button'))
  assert.ok(await waitFor(() => card.querySelector('[wf-xano-bind]').textContent === 'Closed'))
  release()
  assert.equal(await action, false)
  assert.equal(card.querySelector('[wf-xano-bind]').textContent, 'Live')
  assert.equal(root.__wfXano.getState().data.items[0].status, 'Live')
  assert.equal(root.__wfXano.getState().mutation['close:2'].error.status, 409)
  console.log('PASS 74: optimistic failure restores the exact pre-mutation snapshot')
}

// ---------- Test 75: full authoritative response reconciles without self refetch ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
      <div wf-xano-template><span wf-xano-bind="status"></span><button wf-xano-action="close"
        wf-xano-action-source="api:close" wf-xano-action-optimistic="true"
        wf-xano-action-optimistic-field="status" wf-xano-action-optimistic-value="literal:Closing"
        wf-xano-action-optimistic-rollback="item:status" wf-xano-action-response="item">Close</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let listCalls = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => url.endsWith('/list')
    ? (listCalls += 1, makeRes(PAGE([{ id: 3, status: 'Live' }], 1)))
    : makeRes({ id: 3, status: 'Closed' })
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item]')))
  assert.equal(await root.__wfXano.runAction(root.querySelector('[wf-xano-item] button[wf-xano-action]')), true)
  assert.equal(listCalls, 1)
  assert.equal(root.querySelector('[wf-xano-item] [wf-xano-bind]').textContent, 'Closed')
  assert.equal(root.__wfXano.getState().data.items[0].status, 'Closed')
  console.log('PASS 75: full authoritative response reconciles without redundant self refresh')
}

// ---------- Test 76: focused non-text control survives keyed optimistic reconciliation ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
      <div wf-xano-template><span wf-xano-bind="status"></span><input type="checkbox" class="toggle"><button wf-xano-action="close"
        wf-xano-action-source="api:close" wf-xano-action-optimistic="true"
        wf-xano-action-optimistic-field="status" wf-xano-action-optimistic-value="literal:Closed"
        wf-xano-action-optimistic-rollback="item:status" wf-xano-action-response="item">Close</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => url.endsWith('/list')
    ? makeRes(PAGE([{ id: 7, status: 'Live' }], 1))
    : makeRes({ id: 7, status: 'Closed' })
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item]')))
  const card = root.querySelector('[wf-xano-item]')
  // A non-text control the user focuses (not the action control, which is disabled while pending).
  const toggle = card.querySelector('input.toggle')
  // Mimic Chromium/WebKit: selectionStart/selectionEnd getters throw on non-text inputs.
  Object.defineProperty(toggle, 'selectionStart', { configurable: true, get() { throw new w.DOMException('not applicable', 'InvalidStateError') } })
  Object.defineProperty(toggle, 'selectionEnd', { configurable: true, get() { throw new w.DOMException('not applicable', 'InvalidStateError') } })
  toggle.focus()
  assert.equal(w.document.activeElement, toggle, 'non-text control is focused before reconciliation')
  assert.equal(await root.__wfXano.runAction(card.querySelector('button')), true, 'optimistic reconciliation does not throw while a non-text control is focused')
  assert.equal(root.querySelector('[wf-xano-item] [wf-xano-bind]').textContent, 'Closed')
  assert.equal(root.__wfXano.getState().data.items[0].status, 'Closed')
  assert.notEqual(root.__wfXano.getState().status, 'error', 'list is not wrongly cleared')
  assert.equal(w.document.activeElement, root.querySelector('[wf-xano-item] input.toggle'), 'focus on the non-text control is preserved through reconciliation')
  console.log('PASS 76: focused non-text control survives keyed optimistic reconciliation')
}

// ---------- Test 77: keyed refresh failure preserves existing cards and store ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed" wf-xano-key="uuid">
      <div wf-xano-template><span wf-xano-bind="title"></span></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let fail = false
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => fail
    ? Promise.reject(new w.Error('network down'))
    : makeRes(PAGE([{ uuid: 'a', title: 'Alpha' }, { uuid: 'b', title: 'Beta' }], 2))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelectorAll('[wf-xano-item]').length === 2))
  const cardA = root.querySelector('[data-wf-xano-id="a"]')
  fail = true
  await root.__wfXano.refresh()
  assert.equal(root.__wfXano.getState().status, 'error', 'transient refresh failure surfaces error state')
  assert.equal(root.querySelectorAll('[wf-xano-item]').length, 2, 'keyed cards survive a transient refresh failure')
  assert.equal(root.querySelector('[data-wf-xano-id="a"]'), cardA, 'existing keyed node is not recreated')
  assert.deepEqual(root.__wfXano.getState().data.items.map((i) => i.uuid), ['a', 'b'], 'authoritative store is preserved on refresh error')
  console.log('PASS 77: keyed refresh failure preserves existing cards and authoritative store')
}

// ---------- Test 78: keyed reconcile leaves already-ordered cards in place ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed" wf-xano-key="uuid">
      <div wf-xano-template><span wf-xano-bind="title"></span></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let rows = [
    { uuid: 'a', title: 'Alpha' },
    { uuid: 'b', title: 'Beta' },
    { uuid: 'c', title: 'Gamma' },
  ]
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE(rows, rows.length))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelectorAll('[wf-xano-item]').length === 3))
  const cards = ['a', 'b', 'c'].map((id) => root.querySelector('[data-wf-xano-id="' + id + '"]'))
  // Instrument insertBefore to catch needless reparenting of unchanged cards.
  const list = cards[0].parentNode
  let moves = 0
  const nativeInsert = list.insertBefore.bind(list)
  list.insertBefore = (node, ref) => { moves += 1; return nativeInsert(node, ref) }
  rows = [
    { uuid: 'a', title: 'Alpha revised' },
    { uuid: 'b', title: 'Beta revised' },
    { uuid: 'c', title: 'Gamma revised' },
  ]
  await root.__wfXano.refresh()
  assert.equal(moves, 0, 'unchanged order does not reparent any card')
  assert.deepEqual([...root.querySelectorAll('[wf-xano-item]')].map((c) => c.getAttribute('data-wf-xano-id')), ['a', 'b', 'c'])
  assert.equal(root.querySelector('[data-wf-xano-id="a"] [wf-xano-bind]').textContent, 'Alpha revised', 'cards still rebind in place')
  // A reorder moves only what must move, and the same nodes are reused.
  rows = [
    { uuid: 'c', title: 'Gamma' },
    { uuid: 'a', title: 'Alpha' },
    { uuid: 'b', title: 'Beta' },
  ]
  await root.__wfXano.refresh()
  assert.equal(root.querySelector('[data-wf-xano-id="c"]'), cards[2], 'reused node identity survives reorder')
  assert.deepEqual([...root.querySelectorAll('[wf-xano-item]')].map((c) => c.getAttribute('data-wf-xano-id')), ['c', 'a', 'b'])
  console.log('PASS 78: keyed reconcile leaves already-ordered cards untouched')
}

// ---------- Test 79: optimistic partial refresh converges self even when invalidate omits self ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
      <div wf-xano-template><span wf-xano-bind="status"></span><button wf-xano-action="close"
        wf-xano-action-source="api:close" wf-xano-action-param-record_id="item:id"
        wf-xano-action-optimistic="true" wf-xano-action-optimistic-field="status"
        wf-xano-action-optimistic-value="literal:Closed" wf-xano-action-optimistic-rollback="item:status"
        wf-xano-action-invalidate="ghost">Close</button></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let listCalls = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => url.endsWith('/list')
    ? makeRes(PAGE([{ id: 1, status: ++listCalls === 1 ? 'Live' : 'Closed' }], 1))
    : makeRes({ ok: true })
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item]')))
  const card = root.querySelector('[wf-xano-item]')
  assert.equal(await root.__wfXano.runAction(card.querySelector('button')), true)
  assert.equal(listCalls, 2, 'partial response refreshes the owning instance even when invalidate omits self')
  assert.equal(root.querySelector('[wf-xano-item]'), card, 'authoritative refresh keeps the stable node')
  assert.equal(root.__wfXano.getState().data.items[0].status, 'Closed')
  console.log('PASS 79: optimistic partial refresh converges self even when invalidate omits self')
}

// ---------- Test 80: declarative form state, allowlisted payload, dedupe, reset, invalidation ----------
{
  const markup = `<!doctype html><html><body>
    <div wf-xano-element="wrapper" wf-xano-instance="editor" wf-xano-auth="none">
      <form wf-xano-form="profile" wf-xano-form-source="api:save" wf-xano-form-auth="none"
        wf-xano-form-reset-on-success="true" wf-xano-form-invalidate="rows">
        <input wf-xano-field="name" value="Ada"><input type="checkbox" wf-xano-field="available" checked>
        <input name="unmarked" value="secret"><span wf-xano-error-for="form" style="display:none"></span>
        <button type="submit">Save</button>
      </form>
    </div>
    <div wf-xano-element="wrapper" wf-xano-instance="rows" wf-xano-source="api:list" wf-xano-auth="none">
      <div wf-xano-element="template"><span wf-xano-bind="name"></span></div>
    </div>
  </body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let listCalls = 0
  let saveCalls = 0
  let request
  let release
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => {
    if (url.endsWith('/list')) {
      listCalls += 1
      return makeRes(PAGE([{ id: 1, name: 'Row' }], 1))
    }
    saveCalls += 1
    request = opts
    return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ private: 'not-stored' }) }) })
  }
  w.eval(LIB)
  const editorRoot = w.document.querySelector('[wf-xano-instance="editor"]')
  const form = w.document.querySelector('[wf-xano-form]')
  assert.ok(await waitFor(() => editorRoot.__wfXano && editorRoot.__wfXano.getState().form.profile))
  const editor = editorRoot.__wfXano
  const name = form.querySelector('[wf-xano-field="name"]')
  name.value = 'Grace'
  name.dispatchEvent(new w.Event('input', { bubbles: true }))
  name.dispatchEvent(new w.Event('change', { bubbles: true }))
  assert.equal(editor.getState().form.profile.current.name, 'Grace')
  assert.equal(editor.getState().form.profile.dirty.name, true)
  assert.equal(editor.getState().form.profile.touched.name, true)
  const first = editor.submitForm(form)
  const duplicate = editor.submitForm(form)
  assert.equal(first, duplicate)
  assert.ok(await waitFor(() => saveCalls === 1 && editor.getState().form.profile.status === 'submitting'))
  assert.equal(form.querySelector('[type="submit"]').disabled, true)
  assert.deepEqual(JSON.parse(request.body), { name: 'Grace', available: true })
  release()
  assert.equal(await first, true)
  assert.ok(await waitFor(() => listCalls === 2))
  assert.equal(name.value, 'Ada', 'reset-on-success restores the authoritative initial snapshot')
  assert.equal(editor.getState().form.profile.status, 'success')
  assert.deepEqual(editor.getState().form.profile.dirty, {})
  assert.equal(JSON.stringify(editor.getState()).includes('not-stored'), false)
  console.log('PASS 80: declarative form state, payload allowlist, dedupe, reset, and invalidation')
}

// ---------- Test 81: client and Xano validation errors are scoped and retryable ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper">
    <form wf-xano-form="signup" wf-xano-form-source="api:signup" wf-xano-form-auth="none">
      <input type="email" required wf-xano-field="email"><span wf-xano-error-for="email" style="display:none"></span>
      <span wf-xano-error-for="form" style="display:none"></span><button type="submit">Go</button>
    </form></div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let calls = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => {
    calls += 1
    if (calls === 1) return makeRes({ errors: { email: 'Already used', secret: 'must not leak' }, message: 'Please fix the form', token: 'hidden' }, false, 422)
    return makeRes({ ok: true })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().form.signup))
  const inst = root.__wfXano
  const form = root.querySelector('form')
  assert.equal(await inst.submitForm(form), false, 'native invalid form does not submit')
  assert.equal(calls, 0)
  form.querySelector('input').value = 'ada@example.com'
  assert.equal(await inst.submitForm(form), false)
  let state = inst.getState().form.signup
  assert.equal(state.error.status, 422)
  assert.equal(state.errors.email, 'Already used')
  assert.equal(state.errors.form, 'Please fix the form')
  assert.equal(JSON.stringify(state).includes('must not leak'), false)
  assert.equal(root.querySelector('[wf-xano-error-for="email"]').textContent, 'Already used')
  assert.equal(form.querySelector('input').getAttribute('aria-invalid'), 'true')
  assert.equal(await inst.submitForm(form), true, 'server validation failure remains retryable')
  assert.equal(inst.getState().form.signup.status, 'success')
  console.log('PASS 81: client/Xano validation errors are scoped, sanitized, and retryable')
}

// ---------- Test 82: timeout, conflict, and retry preserve current values ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper" wf-xano-auth="none">
    <form wf-xano-form="edit" wf-xano-form-source="api:edit" wf-xano-form-auth="none" wf-xano-form-timeout="20">
      <input wf-xano-field="title" value="Draft"><span wf-xano-error-for="form"></span><button type="submit">Save</button>
    </form></div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let attempt = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => {
    attempt += 1
    if (attempt === 1) return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    if (attempt === 2) return makeRes({ message: 'Record changed; reload and retry' }, false, 409)
    return makeRes({ ok: true })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().form.edit))
  const inst = root.__wfXano
  const form = root.querySelector('form')
  form.querySelector('input').value = 'Edited'
  form.querySelector('input').dispatchEvent(new w.Event('input', { bubbles: true }))
  assert.equal(await inst.submitForm(form), false)
  assert.equal(inst.getState().form.edit.error.name, 'TimeoutError')
  assert.equal(inst.getState().form.edit.current.title, 'Edited')
  assert.equal(await inst.submitForm(form), false)
  assert.equal(inst.getState().form.edit.error.status, 409)
  assert.equal(inst.getState().form.edit.errors.form, 'Record changed; reload and retry')
  assert.equal(await inst.submitForm(form), true)
  console.log('PASS 82: timeout/conflict preserve values and allow retry')
}

// ---------- Test 83: rendered-record forms capture bound authoritative fields ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper" wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
    <article wf-xano-element="template"><form wf-xano-form="row" wf-xano-form-source="api:update" wf-xano-form-auth="none">
      <input wf-xano-field="record_id" wf-xano-bind="id"><input wf-xano-field="title" wf-xano-bind="title"><button type="submit">Save</button>
    </form></article></div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let payload
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => url.endsWith('/list') ? makeRes(PAGE([{ id: 9, title: 'Authoritative' }], 1)) : (payload = JSON.parse(opts.body), makeRes({ ok: true }))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item] form')))
  const form = root.querySelector('[wf-xano-item] form')
  assert.deepEqual(root.__wfXano.getState().form['row:9'].initial, { record_id: '9', title: 'Authoritative' })
  assert.equal(await root.__wfXano.submitForm(form), true)
  assert.deepEqual(payload, { record_id: '9', title: 'Authoritative' })
  console.log('PASS 83: rendered form snapshots authoritative bound values and stable item identity')
}

// ---------- Test 84: file/method/origin guards reject before writes ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper">
    <form wf-xano-form="guarded" wf-xano-form-source="api:save" wf-xano-form-method="DELETE">
      <input wf-xano-field="attachment"><button type="submit">Save</button>
    </form></div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let writes = 0
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve('member') }
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://auth.example', preAuth: false, debug: false }
  w.fetch = () => { writes += 1; return makeRes({ authToken: 'token' }) }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().form.guarded))
  const form = root.querySelector('form')
  await assert.rejects(root.__wfXano.submitForm(form), /Invalid wf-xano form configuration/)
  form.setAttribute('wf-xano-form-method', 'POST')
  form.setAttribute('wf-xano-form-source', 'https://outside.example/save')
  await assert.rejects(root.__wfXano.submitForm(form), /outside xanoBase origin/)
  form.setAttribute('wf-xano-form-source', 'api:save')
  form.querySelector('[wf-xano-field]').type = 'file'
  assert.equal(await root.__wfXano.submitForm(form), false, 'file fields fail safely inside lifecycle')
  assert.equal(writes, 0)
  console.log('PASS 84: form file, method, and authenticated-origin guards block writes')
}

// ---------- Test 85: account switch clears form snapshots and cancels stale submit ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper">
    <form wf-xano-form="member" wf-xano-form-source="api:save"><input wf-xano-field="bio" value="private bio"><button type="submit">Save</button></form>
  </div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let member = 'member-a'
  let writes = 0
  w.$memberstackDom = { getMemberCookie: () => Promise.resolve(member) }
  w.WfXanoConfig = { xanoBase: 'https://x.example', authBase: 'https://auth.example', preAuth: false, debug: false }
  w.fetch = (url) => {
    if (url.includes('/auth/trade-token')) return makeRes({ authToken: 'token-' + member })
    writes += 1
    return makeRes({ ok: true })
  }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().form.member))
  const form = root.querySelector('form')
  assert.equal(await root.__wfXano.submitForm(form), true)
  form.querySelector('input').value = 'member a value'
  form.querySelector('input').dispatchEvent(new w.Event('input', { bubbles: true }))
  member = 'member-b'
  assert.equal(await root.__wfXano.submitForm(form), false)
  assert.equal(form.querySelector('input').value, '')
  assert.equal(JSON.stringify(root.__wfXano.getState()).includes('member a value'), false)
  assert.equal(writes, 1)
  console.log('PASS 85: account switch clears member form data and cancels stale submit')
}

// ---------- Test 86: navigation-away and destroy abort pending forms ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper" wf-xano-auth="none">
    <form wf-xano-form="leave" wf-xano-form-source="api:save" wf-xano-form-auth="none"><input wf-xano-field="title" value="Draft"><button type="submit">Save</button></form>
  </div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let aborts = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => { aborts += 1; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().form.leave))
  const inst = root.__wfXano
  const first = inst.submitForm(root.querySelector('form'))
  assert.ok(await waitFor(() => inst.getState().form.leave.status === 'submitting'))
  w.dispatchEvent(new w.Event('pagehide'))
  assert.equal(await first, false)
  assert.equal(inst.getState().form.leave.status, 'idle')
  const second = inst.submitForm(root.querySelector('form'))
  assert.ok(await waitFor(() => inst.getState().form.leave.status === 'submitting'))
  inst.destroy()
  assert.equal(await second, false)
  assert.equal(aborts, 2)
  console.log('PASS 86: navigation-away and destroy abort pending forms without stale terminal state')
}

// ---------- Test 87: keyed refresh rebases reused rendered-record form snapshot ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper" wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
    <article wf-xano-element="template"><form wf-xano-form="row" wf-xano-form-source="api:update" wf-xano-form-auth="none">
      <input wf-xano-field="record_id" wf-xano-bind="id"><input wf-xano-field="title" wf-xano-bind="title"><button type="submit">Save</button>
    </form></article></div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let title = 'Authoritative'
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE([{ id: 9, title }], 1))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.querySelector('[wf-xano-item] form')))
  const inst = root.__wfXano
  assert.deepEqual(inst.getState().form['row:9'].initial, { record_id: '9', title: 'Authoritative' })
  // A refresh where Xano returns a normalized value must rebase the snapshot so
  // the store, dirty detection, and DOM stay in sync.
  title = 'Normalized'
  await inst.refresh()
  assert.ok(await waitFor(() => inst.getState().form['row:9'].current.title === 'Normalized'))
  assert.deepEqual(inst.getState().form['row:9'].initial, { record_id: '9', title: 'Normalized' }, 'reused card rebases initial to authoritative value')
  assert.deepEqual(inst.getState().form['row:9'].dirty, {}, 'rebased form is clean, not spuriously dirty')
  assert.equal(root.querySelector('[wf-xano-item] input[wf-xano-field="title"]').value, 'Normalized')
  // An in-flight user edit is preserved and stays dirty across the next refresh.
  const titleInput = root.querySelector('[wf-xano-item] input[wf-xano-field="title"]')
  titleInput.value = 'My Draft'
  titleInput.dispatchEvent(new w.Event('input', { bubbles: true }))
  assert.deepEqual(inst.getState().form['row:9'].dirty, { title: true })
  title = 'Server Wins'
  await inst.refresh()
  assert.equal(root.querySelector('[wf-xano-item] input[wf-xano-field="title"]').value, 'My Draft', 'in-flight edit survives refresh')
  assert.deepEqual(inst.getState().form['row:9'].dirty, { title: true }, 'preserved edit stays dirty after resync')
  console.log('PASS 87: keyed refresh rebases untouched fields and preserves in-flight edits')
}

// ---------- Test 88: cancelling a mid-submit form re-enables its submit control ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper" wf-xano-auth="none">
    <form wf-xano-form="edit" wf-xano-form-source="api:save" wf-xano-form-auth="none"><input wf-xano-field="title" value="Draft"><button type="submit">Save</button></form>
  </div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url, opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().form.edit))
  const inst = root.__wfXano
  const form = root.querySelector('form')
  const button = form.querySelector('button')
  const submit = inst.submitForm(form)
  assert.ok(await waitFor(() => inst.getState().form.edit.status === 'submitting'))
  assert.ok(await waitFor(() => button.disabled))
  assert.equal(form.classList.contains('is-wf-xano-form-submitting'), true)
  assert.equal(form.getAttribute('aria-busy'), 'true')
  // Simulate the account-switch reset path (clearAuthenticatedStoreSnapshots).
  inst._cancelForms('form:auth-change')
  inst._clearFormSnapshots('form:auth-change')
  assert.equal(await submit, false)
  assert.equal(inst.getState().form.edit.status, 'idle')
  assert.equal(button.disabled, false, 'submit re-enabled after cancel reprojects form DOM')
  assert.equal(button.hasAttribute('data-wf-xano-form-disabled'), false)
  assert.equal(form.classList.contains('is-wf-xano-form-submitting'), false)
  assert.equal(form.getAttribute('aria-busy'), 'false')
  console.log('PASS 88: mid-submit form cancel re-enables submit control and clears submitting DOM')
}

// ---------- Test 89: rendered-record form snapshots are pruned when cards leave the DOM ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper" wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
    <article wf-xano-element="template"><form wf-xano-form="row" wf-xano-form-source="api:update" wf-xano-form-auth="none">
      <input wf-xano-field="record_id" wf-xano-bind="id"><input wf-xano-field="title" wf-xano-bind="title"><button type="submit">Save</button>
    </form></article></div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let items = [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }, { id: 3, title: 'Three' }]
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => makeRes(PAGE(items, items.length))
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.querySelectorAll('[wf-xano-item] form').length === 3))
  const inst = root.__wfXano
  assert.deepEqual(Object.keys(inst.getState().form).sort(), ['row:1', 'row:2', 'row:3'])
  // A refresh onto a disjoint id set removes the old cards; their snapshots must go too.
  items = [{ id: 4, title: 'Four' }, { id: 5, title: 'Five' }]
  await inst.refresh()
  assert.ok(await waitFor(() => root.querySelectorAll('[wf-xano-item] form').length === 2))
  assert.deepEqual(Object.keys(inst.getState().form).sort(), ['row:4', 'row:5'], 'stale form snapshots for removed cards are pruned')
  console.log('PASS 89: rendered-record form snapshots are pruned when cards leave the DOM')
}

// ---------- Test 90: late invalid form mutations fail safely in delegated change listeners ----------
{
  const markup = `<!doctype html><html><body><div wf-xano-element="wrapper" wf-xano-auth="none">
    <form wf-xano-form="dynamic" wf-xano-form-source="api:save" wf-xano-form-auth="none">
      <input wf-xano-field="title" value="Draft"><button type="submit">Save</button>
    </form>
  </div></body></html>`
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  let writes = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => { writes += 1; return makeRes({ ok: true }) }
  w.eval(LIB)
  const root = w.document.querySelector('[wf-xano-element="wrapper"]')
  assert.ok(await waitFor(() => root.__wfXano && root.__wfXano.getState().form.dynamic))
  const input = root.querySelector('[wf-xano-field]')
  const before = root.__wfXano.getState().form.dynamic
  // A delegated-listener throw is swallowed by dispatchEvent and re-surfaced as
  // an uncaught error on the window; capture it so the guard is actually
  // exercised (without the try/catch this fires and fails the assertion below).
  let listenerError = null
  w.addEventListener('error', function (e) { listenerError = e.error ? e.error.message : String(e.message) })
  input.type = 'file'
  assert.doesNotThrow(() => input.dispatchEvent(new w.Event('input', { bubbles: true })))
  await new Promise(function (r) { setTimeout(r, 0) })
  assert.equal(listenerError, null, 'delegated change listener does not throw on configuration drift')
  assert.deepEqual(root.__wfXano.getState().form.dynamic, before, 'last valid snapshot survives configuration drift')
  assert.equal(await root.__wfXano.submitForm(root.querySelector('form')), false)
  assert.equal(writes, 0)
  console.log('PASS 90: late invalid form mutations fail safely without writes or event errors')
}

console.log(`\nAll wf-xano v${VERSION} tests passed.`)
