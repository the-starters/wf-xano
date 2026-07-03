// Regenerates the "Copy for Webflow" (@webflow/XscpData) payloads embedded in
// prompts/index.html — run with: node prompts/build-xscp.mjs
//
// The format is Webflow's unofficial clipboard payload (verified against
// public implementations: ycode's importer types, Webstudio's webflow
// copy-paste schema, and real Designer clipboard dumps). Custom attributes
// live in data.xattr; children/classes are _id references into the flat
// nodes/styles arrays.
//
// Preferred maintenance path once a real Designer project exists: build the
// structure there, copy it, capture the canonical JSON with
// prompts/inspector.html, and replace these generated payloads.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PAGE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html')

function makeDoc() {
  const nodes = []
  const styles = []
  const styleIds = {}
  let seq = 0
  // deterministic uuid-v4-shaped ids — regenerating produces a stable diff
  const uid = () => `f0e1d2c3-0000-4000-8000-${String(++seq).padStart(12, '0')}`

  const style = (name, css) => {
    if (styleIds[name]) return styleIds[name]
    const _id = uid()
    styles.push({
      _id,
      fake: false,
      type: 'class',
      name,
      namespace: '',
      comb: '',
      styleLess: css,
      variants: {},
      children: [],
      selector: null,
      origin: null,
    })
    styleIds[name] = _id
    return _id
  }

  const xattr = (pairs) => Object.entries(pairs).map(([name, value]) => ({ name, value }))

  const text = (v) => {
    const _id = uid()
    nodes.push({ _id, text: true, v })
    return _id
  }

  const el = (type, tag, { cls, css, children = [], attrs, data = {} } = {}) => {
    const _id = uid()
    nodes.push({
      _id,
      type,
      tag,
      classes: cls ? [style(cls, css || '')] : [],
      children,
      data: { tag, ...data, ...(attrs ? { xattr: xattr(attrs) } : {}) },
    })
    return _id
  }

  // element shorthands
  const div = (o) => el('Block', 'div', o)
  const textBlock = (label, o) => el('Block', 'div', { ...o, children: [text(label)], data: { text: true, ...o.data } })
  const heading = (label, o) => el('Heading', 'h3', { ...o, children: [text(label)] })
  const paragraph = (label, o) => el('Paragraph', 'p', { ...o, children: [text(label)] })
  const linkBlock = (o) =>
    el('Link', 'a', {
      ...o,
      data: { attr: { href: '#' }, link: { url: '#', mode: 'external' }, button: false, block: 'block', ...o.data },
    })

  const wrap = (rootId) => ({
    type: '@webflow/XscpData',
    payload: {
      nodes,
      styles,
      assets: [],
      ix1: [],
      ix2: { interactions: [], events: [], actionLists: [] },
    },
    meta: {
      unlinkedSymbolCount: 0,
      droppedLinks: 0,
      dynBindRemovedCount: 0,
      dynListBindRemovedCount: 0,
      paginationRemovedCount: 0,
    },
  })

  return { div, textBlock, heading, paragraph, linkBlock, el, text, wrap }
}

/* ---- shared card (used by both payloads) ---- */
function card(b, { withMeta }) {
  const metaChildren = [
    b.textBlock('Brand name', {
      cls: 'opps-card-brand',
      css: 'display: inline;',
      attrs: { 'wf-xano-bind': 'brand.company_name' },
    }),
    b.text(' · '),
    ...(withMeta
      ? [
          b.textBlock('Project type', {
            cls: 'opps-card-type',
            css: 'display: inline;',
            attrs: { 'wf-xano-bind': 'project_type' },
          }),
          b.text(' · $'),
          b.textBlock('0', {
            cls: 'opps-card-budget',
            css: 'display: inline;',
            attrs: { 'wf-xano-bind': 'budget' },
          }),
          b.text(' · '),
        ]
      : []),
    b.textBlock('Date', {
      cls: 'opps-card-date',
      css: 'display: inline;',
      attrs: { 'wf-xano-bind': 'published_at', 'wf-xano-format': 'date' },
    }),
  ]

  return b.linkBlock({
    cls: 'opps-card',
    css: 'display: block; margin-bottom: 16px; padding: 20px; border: 1px solid #e4e4df; border-radius: 12px; background-color: #ffffff; color: #23281f; text-decoration: none;',
    attrs: {
      'wf-xano-element': 'template',
      'wf-xano-link': 'id',
      'wf-xano-link-prefix': '{{DETAIL_URL_PREFIX}}',
    },
    children: [
      b.heading('Opportunity title', {
        cls: 'opps-card-title',
        css: 'margin-top: 0px; margin-bottom: 4px; font-size: 18px;',
        attrs: { 'wf-xano-bind': 'title' },
      }),
      b.paragraph('Description', {
        cls: 'opps-card-desc',
        css: 'margin-bottom: 8px; color: #66705e;',
        attrs: { 'wf-xano-bind': 'description' },
      }),
      b.div({
        cls: 'opps-card-meta',
        css: 'font-size: 13px; color: #8a917f;',
        children: metaChildren,
      }),
      b.textBlock('Active', {
        cls: 'opps-card-badge',
        css: 'display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 4px; background-color: #e3efe4; color: #3d7a44; font-size: 12px;',
        attrs: { 'wf-xano-if': "status === 'Active'", 'wf-xano-display': 'inline-block' },
      }),
    ],
  })
}

function stateElements(b) {
  return [
    b.textBlock('Nothing here yet.', {
      cls: 'opps-empty',
      css: 'display: none; padding: 20px; color: #8a917f;',
      attrs: { 'wf-xano-element': 'empty', 'wf-xano-display': 'block' },
    }),
    b.textBlock('Loading…', {
      cls: 'opps-loader',
      css: 'padding: 20px; color: #8a917f;',
      attrs: { 'wf-xano-element': 'loader' },
    }),
    b.textBlock('Something went wrong — try reloading.', {
      cls: 'opps-error',
      css: 'display: none; padding: 20px; color: #a13d34;',
      attrs: { 'wf-xano-element': 'error', 'wf-xano-display': 'block' },
    }),
  ]
}

/* ---- payload 1: basic list (safe node types only) ---- */
function basicList() {
  const b = makeDoc()
  const root = b.div({
    cls: 'opps-wrapper',
    css: 'position: relative;',
    attrs: {
      'wf-xano-element': 'wrapper',
      'wf-xano-source': '{{API_GROUP}}:{{ENDPOINT_PATH}}',
    },
    children: [
      b.div({
        cls: 'opps-list',
        css: '',
        attrs: { 'wf-xano-element': 'list' },
        children: [card(b, { withMeta: false })],
      }),
      ...stateElements(b),
    ],
  })
  return b.wrap(root)
}

/* ---- payload 2: full list — filters, search, sort, counts, tags, pagination.
        Includes native form controls (FormTextInput/FormSelect) — the least
        battle-tested part of the format; the page labels it experimental. ---- */
function fullList() {
  const b = makeDoc()

  // Form controls: every real Designer capture wraps them in
  // FormWrapper > FormForm — standalone controls are unverified, so
  // mirror the captured chain (options live in data.form.opts, no children).
  const searchInput = b.el('FormTextInput', 'input', {
    cls: 'opps-search',
    css: 'width: auto; margin-bottom: 0px; padding: 8px 10px; border: 1px solid #e4e4df; border-radius: 8px;',
    attrs: { 'wf-xano-search': 'q', 'wf-xano-instance': 'opps' },
    data: {
      attr: {
        autofocus: false,
        disabled: false,
        maxlength: 256,
        name: 'q',
        'data-name': 'Search',
        id: 'wfx-search',
        placeholder: 'Search…',
        required: false,
        type: 'text',
      },
      form: { type: 'input', name: 'Search', passwordPage: false },
    },
  })

  const select = (cls, id, name, opts, attrs) =>
    b.el('FormSelect', 'select', {
      cls,
      css: 'width: auto; margin-bottom: 0px; padding: 8px 10px; border: 1px solid #e4e4df; border-radius: 8px;',
      attrs,
      data: {
        attr: { id, name: id, 'data-name': name, multiple: false, required: false },
        form: { type: 'select', name, opts },
      },
    })

  const statusSelect = select(
    'opps-filter-status',
    'wfx-status',
    'Status',
    [
      { v: '*', t: 'All statuses' },
      { v: 'Active', t: 'Active' },
      { v: 'Closed', t: 'Closed' },
      { v: 'Draft', t: 'Draft' },
    ],
    { 'wf-xano-filter': 'status', 'wf-xano-instance': 'opps' }
  )

  const sortSelect = select(
    'opps-sort',
    'wfx-sort',
    'Sort',
    [
      { v: 'newest', t: 'Newest' },
      { v: 'oldest', t: 'Oldest' },
      { v: 'budget_high', t: 'Budget: high → low' },
      { v: 'budget_low', t: 'Budget: low → high' },
    ],
    { 'wf-xano-sort': 'sort', 'wf-xano-instance': 'opps' }
  )

  const form = b.el('FormForm', 'form', {
    cls: 'opps-controls-form',
    css: 'display: flex; grid-column-gap: 8px; flex-wrap: wrap; align-items: center;',
    children: [
      searchInput,
      statusSelect,
      sortSelect,
      b.textBlock('Clear filters', {
        cls: 'opps-clear',
        css: 'padding: 8px 12px; border: 1px solid #434b43; border-radius: 8px; cursor: pointer;',
        attrs: { 'wf-xano-element': 'clear', 'wf-xano-instance': 'opps' },
      }),
    ],
    data: {
      attr: {
        id: 'wfx-filters',
        name: 'wfx-filters',
        'data-name': 'wf-xano filters',
        redirect: '',
        'data-redirect': '',
        action: '',
        method: 'get',
      },
      form: { type: 'form', name: 'wf-xano filters' },
    },
  })

  const controls = b.el('FormWrapper', 'div', {
    cls: 'opps-controls',
    css: 'margin-bottom: 12px;',
    children: [form],
    data: { form: { type: 'wrapper' } },
  })

  const inlineCount = (cls, element) =>
    b.textBlock('0', {
      cls,
      css: 'display: inline;',
      attrs: { 'wf-xano-element': element, 'wf-xano-instance': 'opps' },
    })

  const counts = b.div({
    cls: 'opps-counts',
    css: 'margin-bottom: 12px; font-size: 13px; color: #8a917f;',
    children: [
      b.text('Showing '),
      inlineCount('opps-count-from', 'count-from'),
      b.text('–'),
      inlineCount('opps-count-to', 'count-to'),
      b.text(' of '),
      inlineCount('opps-total', 'total'),
    ],
  })

  const tags = b.div({
    cls: 'opps-tags',
    css: 'margin-bottom: 12px;',
    children: [
      b.div({
        cls: 'opps-tag',
        css: 'display: inline-block; margin-right: 6px; padding: 2px 8px; border-radius: 4px; background-color: #ecece8; font-size: 12px;',
        attrs: { 'wf-xano-element': 'tag', 'wf-xano-instance': 'opps' },
        children: [
          b.textBlock('field', {
            cls: 'opps-tag-field',
            css: 'display: inline;',
            attrs: { 'wf-xano-element': 'tag-field' },
          }),
          b.text(': '),
          b.textBlock('value', {
            cls: 'opps-tag-value',
            css: 'display: inline;',
            attrs: { 'wf-xano-element': 'tag-value' },
          }),
          b.textBlock('×', {
            cls: 'opps-tag-remove',
            css: 'display: inline; margin-left: 4px; cursor: pointer;',
            attrs: { 'wf-xano-element': 'tag-remove' },
          }),
        ],
      }),
    ],
  })

  const pageBtn = (cls, element, label) =>
    b.textBlock(label, {
      cls,
      css: 'display: inline-block; margin-right: 6px; padding: 6px 10px; border: 1px solid #e4e4df; border-radius: 8px; cursor: pointer;',
      attrs: { 'wf-xano-element': element },
    })

  const wrapper = b.div({
    cls: 'opps-wrapper',
    css: 'position: relative;',
    attrs: {
      'wf-xano-element': 'wrapper',
      'wf-xano-instance': 'opps',
      'wf-xano-source': '{{API_GROUP}}:{{ENDPOINT_PATH}}',
      'wf-xano-per-page': '12',
      'wf-xano-url-sync': 'true',
    },
    children: [
      b.div({
        cls: 'opps-list',
        css: '',
        attrs: { 'wf-xano-element': 'list' },
        children: [card(b, { withMeta: true })],
      }),
      ...stateElements(b),
      b.div({
        cls: 'opps-pagination',
        css: 'margin-top: 16px;',
        children: [
          pageBtn('opps-page-prev', 'page-prev', '‹ Prev'),
          pageBtn('opps-page-num', 'page-number', '1'),
          pageBtn('opps-page-next', 'page-next', 'Next ›'),
        ],
      }),
    ],
  })

  const root = b.div({
    cls: 'opps-section',
    css: '',
    children: [controls, counts, tags, wrapper],
  })
  return b.wrap(root)
}

/* ---- inject into prompts/index.html ---- */
const page = fs.readFileSync(PAGE_PATH, 'utf8')
const inject = (html, id, payload) => {
  const re = new RegExp(`(<script type="application/json" class="wf-copy-src" id="${id}">)[\\s\\S]*?(</script>)`)
  if (!re.test(html)) throw new Error(`marker for ${id} not found`)
  return html.replace(re, `$1\n${JSON.stringify(payload)}\n    $2`)
}

let out = page
out = inject(out, 'xscp-basic-list', basicList())
out = inject(out, 'xscp-full-list', fullList())
fs.writeFileSync(PAGE_PATH, out)
console.log('XscpData payloads regenerated into', PAGE_PATH)
