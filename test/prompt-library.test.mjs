// Prompt-library asset tests — run with: npm test  (requires devDependency jsdom)
// Validates prompts/index.html: XscpData clipboard payloads, HTML snippet
// grammar, copy-button wiring, token whitelist, and copy behavior.
import { JSDOM } from 'jsdom'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = fs.readFileSync(path.join(ROOT, 'prompts', 'index.html'), 'utf8')

const TOKENS = ['XANO_BASE', 'API_GROUP', 'AUTH_GROUP', 'ENDPOINT_PATH', 'TABLE', 'DETAIL_URL_PREFIX']

const dom = new JSDOM(PAGE)
const doc = dom.window.document

/* ===== A: XscpData payload validity ===== */
{
  const blocks = [...doc.querySelectorAll('script[type="application/json"].wf-copy-src')]
  assert.strictEqual(blocks.length, 2, 'two XscpData payload blocks')

  const xattrsOf = (payload) =>
    payload.nodes.flatMap((n) => (n.data && n.data.xattr) || []).map((a) => `${a.name}=${a.value}`)

  for (const block of blocks) {
    const parsed = JSON.parse(block.textContent)
    assert.strictEqual(parsed.type, '@webflow/XscpData', `${block.id}: envelope type`)
    const p = parsed.payload
    assert.ok(Array.isArray(p.nodes) && p.nodes.length > 0, `${block.id}: nodes non-empty`)
    assert.ok(Array.isArray(p.styles), `${block.id}: styles array`)

    // id uniqueness + reference integrity
    const nodeIds = new Set(p.nodes.map((n) => n._id))
    const styleIds = new Set(p.styles.map((s) => s._id))
    assert.strictEqual(nodeIds.size, p.nodes.length, `${block.id}: node _ids unique`)
    assert.strictEqual(styleIds.size, p.styles.length, `${block.id}: style _ids unique`)
    for (const n of p.nodes) {
      for (const c of n.children || []) assert.ok(nodeIds.has(c), `${block.id}: child ref ${c} resolves`)
      for (const c of n.classes || []) assert.ok(styleIds.has(c), `${block.id}: class ref ${c} resolves`)
    }
    for (const s of p.styles) {
      assert.ok(typeof s.name === 'string' && s.name, `${block.id}: style has name`)
      assert.ok(typeof s.styleLess === 'string', `${block.id}: style has styleLess`)
    }

    // every non-text node reachable exactly once from a single root (a tree, not a forest)
    const referenced = new Set(p.nodes.flatMap((n) => n.children || []))
    const roots = p.nodes.filter((n) => !referenced.has(n._id))
    assert.strictEqual(roots.length, 1, `${block.id}: exactly one root node`)

    // required wf-xano structure
    const xa = xattrsOf(p)
    assert.ok(xa.includes('wf-xano-element=wrapper'), `${block.id}: wrapper xattr`)
    assert.ok(xa.some((a) => a.startsWith('wf-xano-source=')), `${block.id}: source xattr`)
    assert.ok(xa.includes('wf-xano-element=template'), `${block.id}: template xattr`)
    assert.ok(xa.includes('wf-xano-element=empty'), `${block.id}: empty xattr`)
    assert.ok(xa.includes('wf-xano-element=loader'), `${block.id}: loader xattr`)
  }

  // full-list payload additionally carries controls + pagination
  const full = JSON.parse(doc.getElementById('xscp-full-list').textContent)
  const xa = full.payload.nodes.flatMap((n) => (n.data && n.data.xattr) || []).map((a) => `${a.name}=${a.value}`)
  for (const need of [
    'wf-xano-search=q',
    'wf-xano-filter=status',
    'wf-xano-sort=sort',
    'wf-xano-element=clear',
    'wf-xano-element=total',
    'wf-xano-element=count-from',
    'wf-xano-element=count-to',
    'wf-xano-element=page-prev',
    'wf-xano-element=page-number',
    'wf-xano-element=page-next',
    'wf-xano-element=tag',
    'wf-xano-element=tag-remove',
    'wf-xano-url-sync=true',
  ]) {
    assert.ok(xa.includes(need), `full-list payload has ${need}`)
  }
  // the "*" match-all All option lives in the status select's opts (v/t pairs)
  const selects = full.payload.nodes.filter((n) => n.type === 'FormSelect')
  assert.ok(
    selects.some((n) => (n.data.form.opts || []).some((o) => o.v === '*')),
    'full-list status select has the "*" All option'
  )
  // real Designer captures always wrap form controls in FormWrapper > FormForm
  assert.ok(full.payload.nodes.some((n) => n.type === 'FormWrapper'), 'full-list has FormWrapper')
  assert.ok(full.payload.nodes.some((n) => n.type === 'FormForm'), 'full-list has FormForm')
  assert.ok(full.payload.nodes.some((n) => n.type === 'FormTextInput'), 'full-list has search input')
  console.log('PASS A: XscpData payloads valid (envelope, ids, refs, wf-xano xattrs)')
}

/* ===== B: HTML snippet grammar ===== */
{
  const frag = (id) => JSDOM.fragment(doc.getElementById(id).textContent)

  const w1 = frag('src-w1-html')
  assert.ok(w1.querySelector('[wf-xano-element="wrapper"][wf-xano-source]'), 'W1 wrapper+source')
  assert.ok(w1.querySelector('[wf-xano-element="template"][wf-xano-link]'), 'W1 template+link')
  assert.ok(w1.querySelector('[wf-xano-bind="brand.company_name"]'), 'W1 dot-path bind')
  assert.ok(w1.querySelector('[wf-xano-format="date"]'), 'W1 date format')
  for (const s of ['empty', 'loader', 'error']) {
    assert.ok(w1.querySelector(`[wf-xano-element="${s}"]`), `W1 ${s} state`)
  }

  const w2 = frag('src-w2-html')
  assert.ok(w2.querySelector('[wf-xano-element="wrapper"][wf-xano-instance][wf-xano-url-sync="true"]'), 'W2 wrapper')
  assert.ok(w2.querySelector('[wf-xano-search="q"]'), 'W2 search input')
  assert.ok(w2.querySelector('select[wf-xano-filter="status"] option[value="*"]'), 'W2 * All option')
  assert.ok(w2.querySelector('select[wf-xano-sort]'), 'W2 sort select')
  for (const s of ['clear', 'total', 'count-from', 'count-to', 'tag', 'tag-field', 'tag-value', 'tag-remove', 'page-prev', 'page-number', 'page-next']) {
    assert.ok(w2.querySelector(`[wf-xano-element="${s}"]`), `W2 ${s} element`)
  }
  // control field names match the X2 endpoint inputs
  const x2 = doc.getElementById('src-x2-prompt').textContent
  for (const input of ['status', 'q', 'sort', 'page', 'per_page']) {
    assert.ok(new RegExp(`\\b${input}\\b`).test(x2), `X2 prompt declares input ${input}`)
  }
  assert.ok(/items \/ itemsTotal \/ curPage \/ pageTotal \/ nextPage|"itemsTotal"/.test(x2), 'X2 prompt states the response contract')

  const w3 = doc.getElementById('src-w3-html').textContent
  assert.ok(w3.includes('window.WfXanoConfig'), 'W3 has WfXanoConfig')
  assert.ok(w3.includes('cdn.jsdelivr.net/gh/the-starters/wf-xano@'), 'W3 has jsDelivr URL')
  assert.ok(w3.includes('{{XANO_BASE}}'), 'W3 has XANO_BASE token')
  console.log('PASS B: HTML snippets carry the required wf-xano grammar')
}

/* ===== C: wiring & tokens ===== */
{
  assert.ok(!PAGE.startsWith('---'), 'no YAML front matter (Jekyll must copy the page verbatim)')

  const buttons = [...doc.querySelectorAll('button[data-src]')]
  assert.ok(buttons.length >= 10, 'copy buttons present')
  const used = new Set()
  for (const b of buttons) {
    for (const id of b.getAttribute('data-src').split(',')) {
      const el = doc.getElementById(id.trim())
      assert.ok(el, `data-src "${id.trim()}" resolves to an element`)
      used.add(id.trim())
    }
    if (b.getAttribute('data-wf') === 'true') {
      assert.ok(
        doc.getElementById(b.getAttribute('data-src')).matches('script[type="application/json"]'),
        'webflow button points at a JSON payload'
      )
    }
  }
  for (const src of doc.querySelectorAll('.copy-src, .wf-copy-src')) {
    assert.ok(used.has(src.id), `source "${src.id}" has a copy button`)
  }

  // all {{...}} tokens on the page belong to the documented set
  const found = new Set([...PAGE.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]))
  for (const t of found) assert.ok(TOKENS.includes(t), `token {{${t}}} is documented`)
  for (const t of ['XANO_BASE', 'API_GROUP', 'AUTH_GROUP']) assert.ok(found.has(t), `settings token {{${t}}} used`)
  console.log('PASS C: button wiring + token whitelist')
}

/* ===== D: copy behavior (scripts on) ===== */
{
  const d = new JSDOM(PAGE, { runScripts: 'dangerously', url: 'https://localhost/prompts/' })
  const win = d.window
  const wdoc = win.document

  let plainCopied = null
  Object.defineProperty(win.navigator, 'clipboard', {
    value: { writeText: (t) => ((plainCopied = t), Promise.resolve()) },
    configurable: true,
  })
  // jsdom lacks execCommand — stub it to synchronously fire a 'copy' event
  const slots = {}
  win.document.execCommand = (cmd) => {
    if (cmd !== 'copy') return false
    const ev = new win.Event('copy')
    ev.clipboardData = { setData: (mime, v) => (slots[mime] = v) }
    win.document.dispatchEvent(ev)
    return true
  }

  // simulate a filled settings field, then copy the X2 prompt
  const input = wdoc.getElementById('set-api-group')
  input.value = 'opp30'
  input.dispatchEvent(new win.Event('input', { bubbles: true }))
  wdoc.querySelector('button[data-src="src-x2-prompt"]').click()
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(plainCopied, 'prompt copied via navigator.clipboard')
  assert.ok(plainCopied.includes('opp30'), 'API_GROUP substituted into copied text')
  assert.ok(!plainCopied.includes('{{API_GROUP}}'), 'no leftover API_GROUP token')
  assert.ok(plainCopied.includes('{{ENDPOINT_PATH}}'), 'unfilled tokens copy through')

  // mega-prompt concatenates preamble + X1 + X2 + X3
  plainCopied = null
  wdoc.querySelector('button[data-src^="src-r1-preamble"]').click()
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(plainCopied.indexOf('hard contracts') < plainCopied.indexOf('brands'), 'mega-prompt starts with preamble')
  assert.ok(plainCopied.includes('trade-token'), 'mega-prompt includes X3')

  // webflow button fills the application/json slot with the JSON payload
  wdoc.querySelector('button[data-wf="true"]').click()
  assert.ok(slots['application/json'], 'application/json slot set')
  assert.ok(slots['text/plain'], 'text/plain slot set')
  const parsed = JSON.parse(slots['application/json'])
  assert.strictEqual(parsed.type, '@webflow/XscpData', 'clipboard JSON is an XscpData payload')

  console.log('PASS D: copy behavior (substitution, mega-prompt, Webflow clipboard slots)')
}

console.log('All prompt-library tests passed.')
