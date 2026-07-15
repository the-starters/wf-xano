import { JSDOM } from 'jsdom'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const builds = ['wf-xano.js', 'wf-xano.min.js']
const markup = `<!doctype html><html><body>
  <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none">
    <span wf-xano-state="data.total"></span>
    <span wf-xano-if-state="status === 'success'">ready</span>
    <span wf-xano-class-state="has-results:data.total > 0"></span>
    <div wf-xano-template><span wf-xano-bind="title"></span></div>
  </div>
</body></html>`

async function waitFor(fn, ms = 2000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (fn()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

for (const build of builds) {
  const lib = fs.readFileSync(path.join(root, build), 'utf8')
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  const w = dom.window
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items: [{ id: 'stable-1', title: 'One' }], itemsTotal: 1, curPage: 1, pageTotal: 1 }),
  })
  w.eval(lib)
  const list = w.document.querySelector('[wf-xano-list]')
  assert.ok(await waitFor(() => list.__wfXano), `${build} initializes`)
  const instance = list.__wfXano
  assert.ok(await waitFor(() => instance.getState().status === 'success'), `${build} reaches success`)
  assert.equal(instance.getState().data.items[0].id, 'stable-1')
  assert.equal(instance.audit().ok, true)
  assert.equal(list.querySelector('[wf-xano-state]').textContent, '1')
  assert.equal(list.querySelector('[wf-xano-if-state]').style.display, '')
  assert.equal(list.querySelector('[wf-xano-class-state]').classList.contains('has-results'), true)
}

console.log('PASS reactive runtime: source/minified store + projection parity')
