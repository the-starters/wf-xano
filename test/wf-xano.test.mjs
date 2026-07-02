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
      <span class="pill-active" wf-xano-if="status === 'Active'">Live</span>
      <span class="pill-closed" wf-xano-if="status === 'Closed'">Closed</span>
    </a>
    <div wf-xano-empty style="display:none">none</div>
    <div wf-xano-loader>loading</div>
    <div class="pager"><button wf-xano-page-prev>prev</button><button wf-xano-page-number>1</button><button wf-xano-page-next>next</button></div>
  </div></body></html>`

const FULL_PAGE1 = {
  items: [
    { id: 345, title: 'Senior Brand Designer', description: 'Lead brand', published_at: '2026-06-30T00:00:00Z', status: 'Active' },
    { id: 346, title: 'Closed Role', description: 'old', published_at: '2026-06-01T00:00:00Z', status: 'Closed' },
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

console.log(`\nAll wf-xano v${VERSION} tests passed.`)
