import { JSDOM } from 'jsdom'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const builds = ['wf-xano.js', 'wf-xano.min.js']
const markup = `<!doctype html><html><body>
  <div wf-xano-list wf-xano-source="api:list" wf-xano-auth="none" wf-xano-reconcile="keyed">
    <span wf-xano-state="data.total"></span>
    <span wf-xano-if-state="status === 'success'">ready</span>
    <span wf-xano-class-state="has-results:data.total > 0"></span>
    <form wf-xano-form="edit" wf-xano-form-source="api:save" wf-xano-form-auth="none">
      <input wf-xano-field="title" value="Draft"><span wf-xano-error-for="form"></span><button type="submit">Save</button>
    </form>
    <div wf-xano-template><span wf-xano-bind="title"></span><span wf-xano-bind="status"></span><button wf-xano-action="archive"
      wf-xano-action-source="api:archive" wf-xano-action-param-record_id="item:id"
      wf-xano-action-optimistic="true" wf-xano-action-optimistic-field="status"
      wf-xano-action-optimistic-value="literal:Archived" wf-xano-action-optimistic-rollback="item:status"
      wf-xano-action-response="item">Archive</button></div>
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
  let actionCalls = 0
  let formCalls = 0
  w.WfXanoConfig = { xanoBase: 'https://x.example', debug: false }
  w.fetch = (url) => {
    if (url.endsWith('/archive')) actionCalls += 1
    if (url.endsWith('/save')) formCalls += 1
    return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(url.endsWith('/archive')
      ? { id: 'stable-1', title: 'One', status: 'Archived' }
      : url.endsWith('/save')
        ? { ok: true }
        : { items: [{ id: 'stable-1', title: 'One', status: 'Live' }], itemsTotal: 1, curPage: 1, pageTotal: 1 }),
  })
  }
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
  assert.equal(await instance.runAction(list.querySelector('[wf-xano-item] [wf-xano-action]')), true)
  assert.equal(actionCalls, 1)
  assert.equal(instance.getState().data.items[0].status, 'Archived')
  assert.equal(instance.getState().mutation['archive:stable-1'].status, 'success')
  const form = list.querySelector('[wf-xano-form]')
  assert.equal(instance.getState().form.edit.initial.title, 'Draft')
  form.querySelector('[wf-xano-field]').value = 'Edited'
  form.querySelector('[wf-xano-field]').dispatchEvent(new w.Event('input', { bubbles: true }))
  assert.equal(instance.getState().form.edit.dirty.title, true)
  assert.equal(await instance.submitForm(form), true)
  assert.equal(formCalls, 1)
  assert.equal(instance.getState().form.edit.status, 'success')
}

console.log('PASS reactive runtime: source/minified store + projection + action + form parity')
