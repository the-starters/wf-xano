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
  assert.equal(w.document.querySelector('[wf-xano-empty]').style.display, '', 'empty shown when no items')
  console.log('PASS B: setParam/goToPage re-fetch, page reset, empty state')
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
    if (/\/trade\?/.test(url)) { tradeCalls++; return makeRes('xano-token-' + memberId) }
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

// ---------- Test D2: localStorage member-id fast path (no getCurrentMember network call) ----------
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
    if (/\/trade\?/.test(url)) { tradeCalls++; return makeRes('xano-token-' + memberId) }
    authHeaders.push(opts.headers.Authorization)
    return makeRes(PAGE([], 0))
  }
  w.eval(LIB)
  await waitFor(() => authHeaders.length === 1)
  assert.equal(getCurrentMemberCalls, 0, 'localStorage id short-circuits the getCurrentMember network call')
  assert.equal(authHeaders[0], 'Bearer xano-token-mem_LS_A', 'traded token used as Bearer')
  const inst = w.document.querySelector('[wf-xano-list]').__wfXano
  await inst.refresh()
  assert.equal(tradeCalls, 1, 'token cached across refresh for same member')
  // An account switch lands in Memberstack's localStorage cache -> token dropped.
  memberId = 'mem_LS_B'
  w.localStorage.setItem('_ms-mid', 'mem_LS_B') // unquoted variant must parse too
  await inst.refresh()
  await waitFor(() => tradeCalls === 2)
  assert.equal(authHeaders[authHeaders.length - 1], 'Bearer xano-token-mem_LS_B', 'member switch re-trades')
  assert.equal(getCurrentMemberCalls, 0, 'switch detected without any getCurrentMember call')
  console.log('PASS D2: localStorage member-id fast path + switch reset')
}

// ---------- Test D3: getCurrentMember fallback runs in PARALLEL — never gates first render ----------
{
  const dom = new JSDOM(BASIC_MARKUP, { runScripts: 'outside-only', url: 'https://x.test/' })
  const w = dom.window
  w.document.querySelector('[wf-xano-list]').setAttribute('wf-xano-auth', 'memberstack')
  // Empty localStorage and a getCurrentMember that NEVER resolves: the old
  // serial chain would hang before trading; the parallel one must render.
  w.WfXanoConfig = { authBase: 'https://h.xano.io/api:auth', tradeTokenPath: '/trade', preAuth: false, debug: false }
  w.$memberstackDom = {
    getCurrentMember: () => new Promise(() => {}),
    getMemberCookie: () => Promise.resolve('ms-jwt'),
  }
  w.fetch = (url) => {
    if (/\/trade\?/.test(url)) return makeRes('xano-token')
    return makeRes(PAGE([{ id: 1, title: 'Fast' }], 1))
  }
  w.eval(LIB)
  assert.ok(
    await waitFor(() => w.document.querySelectorAll('[wf-xano-item]').length === 1),
    'first authed render not gated behind getCurrentMember',
  )
  console.log('PASS D3: member-id fallback concurrent with trade (no serial gate)')
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
    if (/\/trade\?/.test(url)) { tradeCalls++; return makeRes('xano-token') }
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
  w2.fetch = (url) => { if (/\/trade\?/.test(url)) tradeCalls2++; return makeRes(PAGE([], 0)) }
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
    if (/\/trade\?/.test(url)) { tradeCalls++; return makeRes('xano-token') }
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
  assert.equal(w.WfXano._internal.isBlank(0), true, 'isBlank(0)')
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

console.log(`\nAll wf-xano v${VERSION} tests passed.`)
