/*!
 * wf-xano — declarative Xano list binder for Webflow
 * ------------------------------------------------------------------
 * A small, standalone library that renders Webflow markup from a Xano
 * endpoint using a wf-algolia-style attribute grammar. Built for
 * STATE-heavy, authoritative, member-scoped lists (a brand's own posts,
 * applicants, admin/back-office tables) — the complement to wf-algolia,
 * which stays the tool for SEARCH-heavy public browse.
 *
 * Why not extend wf-algolia: that bundle is a closed, Algolia-coupled
 * build with no data-source plugin point. wf-xano deliberately MIRRORS
 * its attribute grammar (familiar to designers) under its own `wf-xano-*`
 * namespace so the two never collide and neither depends on the other.
 * Several API patterns (pre-load callback queue, instance keys, state
 * CSS classes, item lifecycle hooks) follow Finsweet Attributes' lead —
 * the de-facto grammar Webflow designers already know.
 *
 * Design lessons baked in (from the Opportunities 3.0 feed work):
 *   - `cache: 'no-store'` on every fetch — Xano is authoritative; never
 *     show stale data (the whole reason state-heavy feeds move off Algolia).
 *   - Member-change token reset — dropping the cached Xano token when the
 *     Memberstack member changes, so a switched account can't inherit the
 *     previous member's data.
 *   - Root-element attribute handling — the card root is often the <a> (or
 *     carries binds) itself, so every per-card scan includes the root, not
 *     just descendants.
 *   - Request sequencing — overlapping loads (debounced search + filter
 *     clicks) resolve out of order; only the latest request may render.
 *
 * Load AFTER memberstack-x (when using auth) in the page footer:
 *   <script>window.WfXanoConfig = { xanoBase: 'https://<id>.xano.io' }</script>
 *   <script defer src=".../wf-xano.js"></script>
 *
 * Run code before/after the library loads (Finsweet-style queue):
 *   window.WfXano = window.WfXano || []
 *   window.WfXano.push(function (wfx) {
 *     wfx.instances[0].on('results', console.log)
 *   })
 *
 * Minimal markup:
 *   <div wf-xano-list wf-xano-source="opp30:brand/opportunities/list">
 *     <div wf-xano-template>
 *       <h3 wf-xano-bind="title"></h3>
 *       <span wf-xano-if="status === 'Active'">Live</span>
 *       <a wf-xano-link="id" wf-xano-link-prefix="/detail?id=">View</a>
 *     </div>
 *     <div wf-xano-empty>No results yet.</div>
 *     <div wf-xano-loader></div>
 *   </div>
 * ------------------------------------------------------------------
 */
;(function () {
  'use strict'

  // Run-once guard — but a pre-existing ARRAY is the pre-load callback
  // queue (window.WfXano = window.WfXano || []), not a previous init.
  if (window.WfXano && !Array.isArray(window.WfXano)) return
  var _queued = Array.isArray(window.WfXano) ? window.WfXano.slice() : []

  var VERSION = '0.2.1'
  var CFG = window.WfXanoConfig || {}
  var XANO_HOST = (CFG.xanoBase || 'https://x08a-5ko8-jj1r.n7c.xano.io').replace(/\/$/, '')
  var AUTH_BASE = CFG.authBase || XANO_HOST + '/api:g1vmSLWh'
  var TRADE_PATH = CFG.tradeTokenPath || '/auth/trade-token/v3'
  var DEBUG = CFG.debug !== false

  /** @param {...unknown} a */
  function log() {
    if (DEBUG) console.info.apply(console, ['[wf-xano]'].concat([].slice.call(arguments)))
  }

  // FOUC guard: hide raw templates before boot. Clones drop the attribute,
  // so `!important` never affects rendered items.
  try {
    var foucStyle = document.createElement('style')
    foucStyle.textContent = '[wf-xano-template]{display:none!important}'
    ;(document.head || document.documentElement).appendChild(foucStyle)
  } catch (e) {
    /* non-fatal */
  }

  /* ============================ DOM HELPERS ============================ */
  /** @param {ParentNode} root @param {string} sel */
  function q(root, sel) {
    return root.querySelector(sel)
  }
  /** @param {ParentNode} root @param {string} sel @returns {Element[]} */
  function qa(root, sel) {
    return Array.prototype.slice.call(root.querySelectorAll(sel))
  }
  /** Elements matching `sel` in a card, INCLUDING the card root itself. */
  function qaWithRoot(card, sel) {
    var list = qa(card, sel)
    if (card.matches && card.matches(sel)) list.unshift(card)
    return list
  }

  /* ============================ VALUE HELPERS ========================== */
  /** Resolve a possibly-dotted path against an object (Xano joins nest data). */
  function get(obj, path) {
    if (obj == null || !path) return undefined
    if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path]
    return path.split('.').reduce(function (o, k) {
      return o == null ? undefined : o[k]
    }, obj)
  }

  var IF_OPS = ['===', '!==', '>=', '<=', '>', '<']
  /** Evaluate a `field === 'value'` style expression against a data row. */
  function evalIf(expr, data) {
    var op = null
    for (var i = 0; i < IF_OPS.length; i++) {
      if (expr.indexOf(IF_OPS[i]) > -1) {
        op = IF_OPS[i]
        break
      }
    }
    if (!op) return Boolean(get(data, expr.trim()))
    var parts = expr.split(op)
    var left = get(data, parts[0].trim())
    var right = (parts[1] || '').trim().replace(/^["']|["']$/g, '')
    var ln = parseFloat(left)
    var rn = parseFloat(right)
    var numeric = !isNaN(ln) && !isNaN(rn)
    switch (op) {
      case '===':
        return String(left) === right
      case '!==':
        return String(left) !== right
      case '>':
        return numeric && ln > rn
      case '>=':
        return numeric && ln >= rn
      case '<':
        return numeric && ln < rn
      case '<=':
        return numeric && ln <= rn
      default:
        return false
    }
  }

  /** Optional value formatting via wf-xano-format ("date" | "datetime" | else raw). */
  function fmt(value, kind) {
    if (value == null || value === '') return ''
    if (kind === 'date' || kind === 'datetime') {
      var ms = typeof value === 'number' && value < 1e12 ? value * 1000 : value
      var d = new Date(ms)
      if (isNaN(d.getTime())) return String(value)
      return kind === 'datetime' ? d.toLocaleString() : d.toLocaleDateString()
    }
    return String(value)
  }

  function toQuery(obj) {
    return Object.keys(obj)
      .filter(function (k) {
        return obj[k] != null && obj[k] !== ''
      })
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])
      })
      .join('&')
  }

  /* ============================ SOURCE URL ============================= */
  /** "group:path" -> host/api:group/path ; or a full https URL passes through. */
  function resolveUrl(source) {
    if (!source) return null
    if (/^https?:\/\//.test(source)) return source
    var i = source.indexOf(':')
    if (i > 0) {
      var group = source.slice(0, i)
      var path = source.slice(i + 1).replace(/^\//, '')
      return XANO_HOST + '/api:' + group + '/' + path
    }
    return XANO_HOST + '/' + source.replace(/^\//, '')
  }

  /* ============================ AUTH BRIDGE =========================== */
  // Memberstack JWT -> Xano auth token, cached and reset on member change.
  var _token = null
  var _tokenMemberId = null

  async function currentMemberId() {
    try {
      var ms = window.$memberstackDom
      if (!ms) return null
      var r = await ms.getCurrentMember()
      return r && r.data ? r.data.id : null
    } catch (e) {
      return null
    }
  }

  async function xanoToken() {
    var mid = await currentMemberId()
    if (mid !== _tokenMemberId) {
      // Account switch (or first call): drop any stale token.
      _token = null
      _tokenMemberId = mid
    }
    if (_token) return _token
    var ms = window.$memberstackDom
    if (!ms) throw new Error('Memberstack not available')
    var msToken = await ms.getMemberCookie()
    if (!msToken) throw new Error('No Memberstack session (member not logged in)')
    var res = await fetch(AUTH_BASE + TRADE_PATH + '?token=' + encodeURIComponent(msToken))
    var data = await res.json().catch(function () {
      return null
    })
    if (!res.ok) throw Object.assign(new Error('trade-token failed'), { status: res.status, data: data })
    _token = typeof data === 'string' ? data : data && (data.authToken || data.token)
    if (!_token) throw new Error('trade-token returned no token')
    return _token
  }

  /* ============================ RESPONSE SHAPE ======================== */
  // Xano paged list -> { items, total, page, pages }. Also tolerates a raw array.
  function normalize(data, perPage) {
    if (Array.isArray(data)) return { items: data, total: data.length, page: 1, pages: 1 }
    if (data && Array.isArray(data.items)) {
      var total = data.itemsTotal != null ? data.itemsTotal : data.items.length
      var page = data.curPage || 1
      var pages = data.pageTotal
      // pageTotal is absent unless the endpoint enables include_count-style
      // metadata — derive from total/perPage, or at least trust nextPage.
      if (!pages) pages = perPage ? Math.max(1, Math.ceil(total / perPage)) : 1
      if (data.nextPage && pages <= page) pages = page + 1
      return { items: data.items, total: total, page: page, pages: pages }
    }
    // Single object or unknown shape: render as one row.
    return { items: data ? [data] : [], total: data ? 1 : 0, page: 1, pages: 1 }
  }

  /* ============================ CARD RENDER =========================== */
  // Every scan includes the card root (root-element lesson: the template
  // root is often the <a> or carries binds itself).
  function fillCard(card, item) {
    // text / form-value binds (dot paths + optional wf-xano-format)
    qaWithRoot(card, '[wf-xano-bind]').forEach(function (el) {
      var value = fmt(get(item, el.getAttribute('wf-xano-bind')), el.getAttribute('wf-xano-format'))
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.value = value
      else el.textContent = value
    })
    // image src binds
    qaWithRoot(card, '[wf-xano-src]').forEach(function (el) {
      var v = get(item, el.getAttribute('wf-xano-src'))
      if (v != null && v !== '') el.setAttribute('src', String(v))
    })
    // conditionals (wf-xano-display mirrors wf-algolia-display; default clears inline style)
    qaWithRoot(card, '[wf-xano-if]').forEach(function (el) {
      var visible = evalIf(el.getAttribute('wf-xano-if'), item)
      el.style.display = visible ? el.getAttribute('wf-xano-display') || '' : 'none'
    })
    // links
    qaWithRoot(card, '[wf-xano-link]').forEach(function (a) {
      var field = a.getAttribute('wf-xano-link')
      var pre = a.getAttribute('wf-xano-link-prefix') || ''
      var suf = a.getAttribute('wf-xano-link-suffix') || ''
      var v = get(item, field)
      if (v != null) a.setAttribute('href', pre + v + suf)
    })
  }

  /** Read a filter control's effective value. Checkbox GROUPS combine all
   *  checked values for the same field (Webflow checkboxes default to "on",
   *  so wf-xano-value provides the real value — Finsweet's fs-list-value). */
  function readFilterValue(field, controls) {
    var boxes = controls.filter(function (el) {
      return el instanceof HTMLInputElement && el.type === 'checkbox'
    })
    if (boxes.length) {
      var values = boxes
        .filter(function (el) {
          return el.checked
        })
        .map(function (el) {
          var v = el.getAttribute('wf-xano-value')
          if (v == null) v = el.value !== 'on' ? el.value : ''
          if (!v) console.warn('[wf-xano] checkbox filter for "' + field + '" has no wf-xano-value')
          return v
        })
        .filter(Boolean)
      return values.join(',')
    }
    var radios = controls.filter(function (el) {
      return el instanceof HTMLInputElement && el.type === 'radio'
    })
    if (radios.length) {
      var checked = radios.filter(function (el) {
        return el.checked
      })[0]
      if (!checked) return ''
      return checked.getAttribute('wf-xano-value') || (checked.value !== 'on' ? checked.value : '')
    }
    var el = controls[0]
    return el ? el.value : ''
  }

  /* ============================ INSTANCE ============================== */
  var instances = []

  function Instance(root) {
    this.ok = false
    this.root = root
    this.key = root.getAttribute('wf-xano-instance') || null
    this.source = root.getAttribute('wf-xano-source')
    this.url = resolveUrl(this.source)
    this.method = (root.getAttribute('wf-xano-method') || 'POST').toUpperCase()
    this.auth = root.getAttribute('wf-xano-auth') !== 'none'
    this.perPage = parseInt(root.getAttribute('wf-xano-per-page') || '20', 10)
    this.pageWindow = parseInt(root.getAttribute('wf-xano-page-window') || '5', 10)
    this.debounce = parseInt(root.getAttribute('wf-xano-debounce') || '300', 10)
    this.urlSync = root.getAttribute('wf-xano-url-sync') === 'true'
    this.page = 1
    this.params = this.readStaticParams()
    this.template = q(root, '[wf-xano-template]')
    this.emptyEl = q(root, '[wf-xano-empty]')
    this.loaderEl = q(root, '[wf-xano-loader]')
    this.errorEl = q(root, '[wf-xano-error]')
    this.listeners = {}
    this._searchTimer = null
    this._seq = 0
    this._pages = 1
    this._lastResult = null
    this._ac = typeof AbortController === 'function' ? new AbortController() : null

    if (!this.url) {
      console.error('[wf-xano] missing wf-xano-source on', root)
      return
    }
    if (!this.template) {
      console.error('[wf-xano] missing [wf-xano-template] inside', root)
      return
    }
    this.ok = true
    this.template.style.display = 'none'
    root.__wfXano = this
    if (this.urlSync) this.restoreFromUrl()
    this.bindControls()
    this.load()
  }

  /** Scoped query: elements inside the root (that don't opt into another
   *  instance) PLUS, when this list has an instance key, elements anywhere
   *  in the document tagged wf-xano-instance="<key>". Lets designers place
   *  counts/filters/pagination outside the list wrapper (Finsweet-style). */
  Instance.prototype.qa = function (sel) {
    var self = this
    var inside = qa(this.root, sel).filter(function (el) {
      var declared = el.getAttribute('wf-xano-instance')
      return !declared || declared === self.key
    })
    if (!this.key) return inside
    var outside = qa(document, sel + '[wf-xano-instance="' + this.key + '"]').filter(function (el) {
      return !self.root.contains(el)
    })
    return inside.concat(outside)
  }
  Instance.prototype.q = function (sel) {
    return this.qa(sel)[0] || null
  }

  /** wf-xano-param-<name>="value" -> static request params (empties skipped). */
  Instance.prototype.readStaticParams = function () {
    var params = {}
    Array.prototype.forEach.call(this.root.attributes, function (attr) {
      var m = /^wf-xano-param-(.+)$/.exec(attr.name)
      if (m && attr.value !== '') params[m[1]] = attr.value
    })
    return params
  }

  /* ------------------------- URL STATE SYNC ------------------------- */
  Instance.prototype.urlPrefix = function () {
    return (this.key || 'wfx') + '_'
  }

  /** Read `<prefix>page` / `<prefix><param>` from the query string into state. */
  Instance.prototype.restoreFromUrl = function () {
    var prefix = this.urlPrefix()
    var sp = new URLSearchParams(location.search)
    var self = this
    sp.forEach(function (value, name) {
      if (name.indexOf(prefix) !== 0) return
      var field = name.slice(prefix.length)
      if (field === 'page') {
        var p = parseInt(value, 10)
        if (p > 1) self.page = p
      } else if (value !== '') {
        self.params[field] = value
      }
    })
  }

  /** Reflect current params/page into the query string (replaceState). */
  Instance.prototype.syncUrl = function () {
    var prefix = this.urlPrefix()
    var sp = new URLSearchParams(location.search)
    var stale = []
    sp.forEach(function (value, name) {
      if (name.indexOf(prefix) === 0) stale.push(name)
    })
    stale.forEach(function (name) {
      sp.delete(name)
    })
    var self = this
    Object.keys(this.params).forEach(function (k) {
      sp.set(prefix + k, self.params[k])
    })
    if (this.page > 1) sp.set(prefix + 'page', String(this.page))
    var qs = sp.toString()
    try {
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash)
    } catch (e) {
      /* non-fatal (sandboxed iframes) */
    }
  }

  /** Reflect restored params back into simple (non-checkbox) controls. */
  Instance.prototype.hydrateControls = function () {
    var self = this
    Object.keys(this.params).forEach(function (field) {
      self.qa('[wf-xano-filter="' + field + '"], [wf-xano-search="' + field + '"]').forEach(function (el) {
        if (el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)) return
        if ('value' in el) el.value = self.params[field]
      })
    })
  }

  /* --------------------------- CONTROLS ----------------------------- */
  Instance.prototype.bindControls = function () {
    var self = this
    var signal = this._ac ? { signal: this._ac.signal } : false

    // Filters: [wf-xano-filter="field"] — re-fetch on change. Checkbox groups
    // for the same field combine into a comma-separated param.
    var filterEls = this.qa('[wf-xano-filter]')
    filterEls.forEach(function (el) {
      var field = el.getAttribute('wf-xano-filter')
      el.addEventListener(
        'change',
        function () {
          var group = filterEls.filter(function (other) {
            return other.getAttribute('wf-xano-filter') === field
          })
          self.setParam(field, readFilterValue(field, group))
        },
        signal,
      )
    })
    // Search: [wf-xano-search="field"] — debounced input -> param.
    this.qa('[wf-xano-search]').forEach(function (el) {
      var field = el.getAttribute('wf-xano-search')
      var wait = parseInt(el.getAttribute('wf-xano-debounce') || '', 10) || self.debounce
      el.addEventListener(
        'input',
        function () {
          window.clearTimeout(self._searchTimer)
          self._searchTimer = window.setTimeout(function () {
            self.setParam(field, el.value)
          }, wait)
        },
        signal,
      )
    })
    // Sort: [wf-xano-sort] select; attribute value names the param (default "sort").
    this.qa('[wf-xano-sort]').forEach(function (el) {
      var param = el.getAttribute('wf-xano-sort') || 'sort'
      el.addEventListener(
        'change',
        function () {
          self.setParam(param, el.value)
        },
        signal,
      )
    })
    // Pagination prev / next.
    this.qa('[wf-xano-page-prev]').forEach(function (el) {
      el.addEventListener(
        'click',
        function (e) {
          e.preventDefault()
          if (self.page > 1) self.goToPage(self.page - 1)
        },
        signal,
      )
    })
    this.qa('[wf-xano-page-next]').forEach(function (el) {
      el.addEventListener(
        'click',
        function (e) {
          e.preventDefault()
          if (self.page < self._pages) self.goToPage(self.page + 1)
        },
        signal,
      )
    })

    if (this.urlSync) this.hydrateControls()
  }

  /** Set/clear a request param, reset to page 1, reload. */
  Instance.prototype.setParam = function (field, value) {
    if (value == null || value === '') delete this.params[field]
    else this.params[field] = value
    this.page = 1
    return this.load()
  }

  Instance.prototype.goToPage = function (page) {
    this.page = page
    return this.load()
  }

  /** Show a state element. `wf-xano-display` (mirroring wf-algolia-display)
   *  supplies the shown value for elements whose own class hides them —
   *  e.g. <div wf-xano-loader wf-xano-display="flex">. Default clears the
   *  inline style so the element's class takes over. */
  function showStateEl(el, visible) {
    if (!el) return
    el.style.display = visible ? el.getAttribute('wf-xano-display') || '' : 'none'
  }

  /** Toggle loader/error elements + is-wf-xano-* classes on the root so
   *  designers can style states from Webflow (Finsweet-style state classes). */
  Instance.prototype.setState = function (state) {
    showStateEl(this.loaderEl, state === 'loading')
    showStateEl(this.errorEl, state === 'error')
    this.root.classList.toggle('is-wf-xano-loading', state === 'loading')
    this.root.classList.toggle('is-wf-xano-error', state === 'error')
    // is-wf-xano-empty is decided in render()
  }

  Instance.prototype.load = async function () {
    if (!this.ok) return
    var self = this
    var seq = ++this._seq
    this.setState('loading')
    try {
      var headers = { 'Content-Type': 'application/json' }
      if (this.auth) headers.Authorization = 'Bearer ' + (await xanoToken())
      var payload = {}
      Object.keys(this.params).forEach(function (k) {
        payload[k] = self.params[k]
      })
      payload.page = this.page
      payload.per_page = this.perPage

      var url = this.url
      var opts = { method: this.method, headers: headers, cache: 'no-store' }
      if (this.method === 'GET') {
        var qs = toQuery(payload)
        if (qs) url += (url.indexOf('?') > -1 ? '&' : '?') + qs
      } else {
        opts.body = JSON.stringify(payload)
      }

      var res = await fetch(url, opts)
      var data = await res.json().catch(function () {
        return null
      })
      // A newer request started while this one was in flight — drop it.
      if (seq !== this._seq) return
      if (!res.ok) throw Object.assign(new Error('wf-xano ' + res.status), { status: res.status, data: data })

      var result = normalize(data, this.perPage)
      // beforeRender hooks may transform (filter/augment/reorder) the items.
      var hooks = this.listeners['beforeRender'] || []
      for (var i = 0; i < hooks.length; i++) {
        var out = await hooks[i](result.items, result)
        if (seq !== this._seq) return
        if (Array.isArray(out)) result.items = out
      }
      this.render(result)
      this.setState('idle')
      this._lastResult = result
      if (this.urlSync) this.syncUrl()
      this.emit('results', result)
    } catch (err) {
      if (seq !== this._seq) return
      console.error('[wf-xano] load failed', this.source, err)
      this.setState('error')
      this.render({ items: [], total: 0, page: 1, pages: 1 })
      this.emit('error', err)
    }
  }

  Instance.prototype.render = function (result) {
    this._pages = result.pages
    var list = this.template.parentNode
    // Remove previously injected clones (keep the hidden template).
    qa(list, '[wf-xano-item]').forEach(function (c) {
      c.remove()
    })
    // Empty state
    showStateEl(this.emptyEl, !result.items.length)
    this.root.classList.toggle('is-wf-xano-empty', !result.items.length)
    var self = this
    result.items.forEach(function (item) {
      var card = self.template.cloneNode(true)
      card.removeAttribute('wf-xano-template')
      card.setAttribute('wf-xano-item', '')
      card.style.display = ''
      if (item && item.id != null) card.setAttribute('data-wf-xano-id', item.id)
      fillCard(card, item)
      list.appendChild(card)
    })
    // Counts: total + visible range ("Showing X–Y of Z").
    var from = result.items.length ? (result.page - 1) * this.perPage + 1 : 0
    var to = result.items.length ? from + result.items.length - 1 : 0
    this.qa('[wf-xano-total]').forEach(function (el) {
      el.textContent = String(result.total)
    })
    this.qa('[wf-xano-count-from]').forEach(function (el) {
      el.textContent = String(from)
    })
    this.qa('[wf-xano-count-to]').forEach(function (el) {
      el.textContent = String(to)
    })
    this.renderPagination(result)
  }

  Instance.prototype.renderPagination = function (result) {
    var self = this
    this.qa('[wf-xano-page-prev]').forEach(function (el) {
      el.classList.toggle('is-disabled', result.page <= 1)
    })
    this.qa('[wf-xano-page-next]').forEach(function (el) {
      el.classList.toggle('is-disabled', result.page >= result.pages)
    })

    var tmpl = this.q('[wf-xano-page-number]')
    if (!tmpl) return
    var parent = tmpl.parentNode
    // Clear old page buttons (keep hidden template).
    qa(parent, '[wf-xano-page-num]').forEach(function (b) {
      b.remove()
    })
    tmpl.style.display = 'none'
    var half = Math.floor(this.pageWindow / 2)
    var start = Math.max(1, result.page - half)
    var end = Math.min(result.pages, start + this.pageWindow - 1)
    start = Math.max(1, end - this.pageWindow + 1)
    for (var p = start; p <= end; p++) {
      ;(function (page) {
        var btn = tmpl.cloneNode(true)
        btn.removeAttribute('wf-xano-page-number')
        btn.setAttribute('wf-xano-page-num', '')
        btn.style.display = ''
        btn.textContent = String(page)
        var active = page === result.page
        btn.classList.toggle('is-active', active)
        if (active) btn.setAttribute('aria-current', 'page')
        else btn.removeAttribute('aria-current')
        btn.addEventListener('click', function (e) {
          e.preventDefault()
          self.goToPage(page)
        })
        parent.appendChild(btn)
      })(p)
    }
  }

  /* ============================ EVENTS ================================ */
  // Events: 'results' (after render; replays the last result to late
  // subscribers), 'error', and the 'beforeRender' transform hook — a
  // callback that receives (items, result) and may return a replacement
  // items array (sync or async), Finsweet addHook-style.
  Instance.prototype.on = function (event, handler) {
    ;(this.listeners[event] = this.listeners[event] || []).push(handler)
    if (event === 'results' && this._lastResult) {
      var last = this._lastResult
      Promise.resolve().then(function () {
        handler(last)
      })
    }
    return this
  }
  Instance.prototype.off = function (event, handler) {
    var list = this.listeners[event] || []
    var i = list.indexOf(handler)
    if (i > -1) list.splice(i, 1)
    return this
  }
  Instance.prototype.emit = function (event, payload) {
    ;(this.listeners[event] || []).slice().forEach(function (h) {
      try {
        h(payload)
      } catch (e) {
        /* listener error — non-fatal */
      }
    })
  }
  Instance.prototype.refresh = function () {
    return this.load()
  }

  /** Tear down: abort listeners, drop rendered items, unregister. */
  Instance.prototype.destroy = function () {
    this._seq++ // invalidate any in-flight load
    if (this._ac) this._ac.abort()
    window.clearTimeout(this._searchTimer)
    if (this.template) {
      qa(this.template.parentNode, '[wf-xano-item]').forEach(function (c) {
        c.remove()
      })
    }
    this.root.classList.remove('is-wf-xano-loading', 'is-wf-xano-error', 'is-wf-xano-empty')
    delete this.root.__wfXano
    var i = instances.indexOf(this)
    if (i > -1) instances.splice(i, 1)
    this.listeners = {}
  }

  /* ============================ BOOTSTRAP ============================= */
  function init(scope) {
    var root = scope || document
    qa(root, '[wf-xano-list]').forEach(function (el) {
      if (el.__wfXano) return
      instances.push(new Instance(el))
    })
    log('initialized', instances.length, 'list(s)')
  }

  var _booted = false
  var _pendingCallbacks = []

  function runCallback(fn) {
    try {
      fn(window.WfXano)
    } catch (e) {
      console.error('[wf-xano] queued callback failed', e)
    }
  }

  function boot() {
    if (_booted) return
    _booted = true
    init(document)
    _pendingCallbacks.splice(0).forEach(runCallback)
  }

  // Public API. Replaces the pre-load queue array (GA/Finsweet pattern):
  // callbacks queued before load run after boot; push() after boot runs
  // the callback immediately.
  window.WfXano = {
    version: VERSION,
    instances: instances,
    init: init,
    /** Queue (pre-boot) or immediately run (post-boot) a callback with the API. */
    push: function (fn) {
      if (typeof fn !== 'function') return
      if (_booted) runCallback(fn)
      else _pendingCallbacks.push(fn)
    },
    /** Refresh all lists, or a specific list root element. */
    refresh: function (root) {
      if (root && root.__wfXano) return root.__wfXano.refresh()
      instances.slice().forEach(function (i) {
        i.refresh()
      })
    },
    /** Get an instance by its wf-xano-instance key. */
    get: function (key) {
      return (
        instances.filter(function (i) {
          return i.key === key
        })[0] || null
      )
    },
    /** Destroy all instances (or one root element's instance). */
    destroy: function (root) {
      if (root && root.__wfXano) return root.__wfXano.destroy()
      instances.slice().forEach(function (i) {
        i.destroy()
      })
    },
    // Exposed for reuse/testing.
    _internal: {
      resolveUrl: resolveUrl,
      evalIf: evalIf,
      get: get,
      fmt: fmt,
      normalize: normalize,
      readFilterValue: readFilterValue,
    },
  }

  // Drain callbacks that were queued on the pre-load array.
  _queued.forEach(function (fn) {
    window.WfXano.push(fn)
  })

  // Init once the DOM is ready. Drain through Webflow.push when available so we
  // run after Webflow's own init (mirrors wf-algolia's boot timing).
  if (window.Webflow && typeof window.Webflow.push === 'function') {
    window.Webflow.push(boot)
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
