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
 *   - Parallel cold-boot auth — the member id comes from Memberstack's
 *     localStorage cache (network fallback runs concurrently with the
 *     token trade), and the trade pre-warms at script parse, so first
 *     render is not gated behind a serial auth chain.
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
 * Minimal markup (canonical since v0.3.0 — role markers are key=value,
 * `wf-xano-element="<name>"`, because Webflow's Designer strips custom
 * attributes that have no value; role names follow Finsweet's
 * `fs-list-element` vocabulary: `wrapper` is the scope root, `list` is
 * the optional items container — cards default to the template's parent):
 *   <div wf-xano-element="wrapper" wf-xano-source="opp30:brand/opportunities/list">
 *     <div wf-xano-element="list">
 *       <div wf-xano-element="template">
 *         <h3 wf-xano-bind="title"></h3>
 *         <span wf-xano-if="status === 'Active'">Live</span>
 *         <a wf-xano-link="id" wf-xano-link-prefix="/detail?id=">View</a>
 *       </div>
 *     </div>
 *     <div wf-xano-element="empty">No results yet.</div>
 *     <div wf-xano-element="loader"></div>
 *   </div>
 * Aliases kept for markup already in the wild: the valueless markers
 * (wf-xano-list, wf-xano-template, …) and v0.3.0's `element="list"` AS
 * THE ROOT when it also carries wf-xano-source.
 * ------------------------------------------------------------------
 */
;(function () {
  'use strict'

  // Run-once guard — but a pre-existing ARRAY is the pre-load callback
  // queue (window.WfXano = window.WfXano || []), not a previous init.
  if (window.WfXano && !Array.isArray(window.WfXano)) return
  var _queued = Array.isArray(window.WfXano) ? window.WfXano.slice() : []

  var VERSION = '0.12.0'
  var CFG = window.WfXanoConfig || {}
  var XANO_HOST = (CFG.xanoBase || 'https://x08a-5ko8-jj1r.n7c.xano.io').replace(/\/$/, '')
  var AUTH_BASE = CFG.authBase || XANO_HOST + '/api:g1vmSLWh'
  var TRADE_PATH = CFG.tradeTokenPath || '/auth/trade-token/v3'
  var DEBUG = CFG.debug !== false

  /** @param {...unknown} a */
  function log() {
    if (DEBUG) console.info.apply(console, ['[wf-xano]'].concat([].slice.call(arguments)))
  }

  // FOUC guard: hide raw templates before boot. Clones drop the marker
  // attributes, so `!important` never affects rendered items.
  try {
    var foucStyle = document.createElement('style')
    foucStyle.textContent =
      '[wf-xano-element="template"],[wf-xano-template],[wf-xano-element="tag"],[wf-xano-element="page-dots"]{display:none!important}'
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

  /** Selector for a structural role in BOTH grammars: the canonical
   *  key=value form `wf-xano-element="<name>"` (Webflow's Designer strips
   *  valueless custom attributes) and the legacy `wf-xano-<name>` marker. */
  function elSel(name) {
    return '[wf-xano-element="' + name + '"], [wf-xano-' + name + ']'
  }

  /** Which page numbers (and where the ellipsis gaps fall) to render:
   *  `boundary` pages pinned at each edge + a `window` of pages centered on
   *  the current page, de-duped and sorted; a `'dots'` marker is inserted
   *  wherever consecutive shown pages skip a number. Finsweet's
   *  boundary/siblings/dots model. Returns a mixed array of numbers + 'dots'. */
  function paginationModel(current, total, windowSize, boundary) {
    var shown = {}
    var add = function (n) {
      if (n >= 1 && n <= total) shown[n] = true
    }
    for (var b = 1; b <= boundary; b++) {
      add(b)
      add(total - b + 1)
    }
    var half = Math.floor(windowSize / 2)
    var start = Math.max(1, current - half)
    var end = Math.min(total, start + windowSize - 1)
    start = Math.max(1, end - windowSize + 1)
    for (var w = start; w <= end; w++) add(w)
    var sorted = Object.keys(shown)
      .map(Number)
      .sort(function (a, b2) {
        return a - b2
      })
    var out = []
    for (var i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('dots')
      out.push(sorted[i])
    }
    return out
  }

  /** Remove a structural role marker (both grammars) from a cloned node. */
  function clearRole(el, name) {
    el.removeAttribute('wf-xano-' + name)
    if (el.getAttribute('wf-xano-element') === name) el.removeAttribute('wf-xano-element')
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
  /** Evaluate a `wf-xano-if` expression against a data row. Supports logical
   *  combos: `|` = OR, `&` = AND (`&&`/`||` also accepted). AND binds tighter
   *  than OR, so `a & b | c` = (a AND b) OR c. Each segment is a comparison
   *  (`field === 'x'`, `>=` etc.) or a bare field name (truthy test). Values
   *  containing `|`/`&` aren't supported (field names never do). */
  function evalIf(expr, data) {
    // OR (lowest precedence) — split first so each segment can carry AND.
    if (expr.indexOf('|') > -1) {
      return expr.split('|').some(function (part) {
        return part.trim() ? evalIf(part.trim(), data) : false
      })
    }
    if (expr.indexOf('&') > -1) {
      var segs = expr.split('&').filter(function (p) {
        return p.trim()
      })
      return segs.every(function (part) {
        return evalIf(part.trim(), data)
      })
    }
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

  // Explicit named date styles (Intl options), pinned to en-US so month
  // names are deterministic across visitors — e.g. "May 21, 2026". Bare
  // `date`/`datetime` are NOT here; they keep the visitor-locale toLocale*
  // output for back-compat.
  var DATE_STYLES = {
    'date-medium': { year: 'numeric', month: 'short', day: 'numeric' }, // May 21, 2026
    'date-long': { year: 'numeric', month: 'long', day: 'numeric' }, // September 3, 2026
    'datetime-long': { dateStyle: 'long', timeStyle: 'short' },
  }
  var DATE_KINDS = { date: 1, datetime: 1, 'date-medium': 1, 'date-long': 1, 'datetime-long': 1 }

  /** A value that should render as nothing / trigger a wf-xano-fallback.
   *  Includes the Unix epoch (0 / "0") since Xano stores unset timestamps as 0. */
  function isBlank(v) {
    return v == null || v === '' || v === 0 || v === '0'
  }

  /** Optional value formatting via wf-xano-format. Date styles:
   *  `date` (locale short, e.g. 5/21/2026), `date-medium` / `date-long`
   *  ("May 21, 2026"), `datetime`, `datetime-long`. Also `short-name`, else
   *  the raw value. */
  function fmt(value, kind) {
    // Guard empties AND the Unix epoch (0 / "0") — Xano stores unset
    // timestamps as 0, which would otherwise render as "1/1/1970".
    if (isBlank(value)) return ''
    if (kind && DATE_KINDS[kind]) {
      var ms = typeof value === 'number' && value < 1e12 ? value * 1000 : value
      var d = new Date(ms)
      if (isNaN(d.getTime()) || d.getTime() <= 0) return ''
      if (kind === 'date') return d.toLocaleDateString()
      if (kind === 'datetime') return d.toLocaleString()
      try {
        return new Intl.DateTimeFormat(CFG.locale || 'en-US', DATE_STYLES[kind]).format(d)
      } catch (e) {
        return d.toLocaleDateString()
      }
    }
    if (kind === 'short-name') {
      var parts = String(value).trim().split(/\s+/).filter(Boolean)
      if (!parts.length) return ''
      return [parts[0]]
        .concat(
          parts.slice(1).map(function (word) {
            return word.charAt(0).toUpperCase() + '.'
          }),
        )
        .join(' ')
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
  //
  // This handshake is the cold-boot critical path, so nothing here waits
  // that doesn't have to (measured 2026-07: a serial getCurrentMember ->
  // trade-token -> list chain cost ~1.2s before first render):
  //   - The member id is read synchronously from Memberstack's own
  //     localStorage cache (_ms-mid / _ms-mem); ms.getCurrentMember() — a
  //     ~500ms network round-trip — is only the fallback, and it runs
  //     CONCURRENTLY with the cookie -> token trade instead of gating it.
  //     The member id is only a CACHE KEY: the traded token always derives
  //     from the live session cookie, so trading before the id resolves
  //     can never mint a token for the wrong member.
  //   - The trade is pre-warmed at script-parse time (see below), so the
  //     round-trip overlaps DOM-ready instead of the first list request.
  //   - Account-switch semantics are unchanged: a cached token is dropped
  //     whenever the member id no longer matches the one it was traded
  //     under (docs/api.md, Authentication), so a switched account can
  //     never inherit the previous member's data.
  var _auth = null // { memberId: Promise<string|null>, token: Promise<string> }

  /** Synchronous member id from Memberstack's localStorage cache, or null. */
  function cachedMemberId() {
    try {
      var mid = window.localStorage.getItem('_ms-mid')
      if (mid) return mid.replace(/^"+|"+$/g, '')
      var mem = window.localStorage.getItem('_ms-mem')
      if (mem) {
        var parsed = JSON.parse(mem)
        if (parsed && parsed.id) return parsed.id
      }
    } catch (e) {
      /* storage blocked/absent — fall through to the network */
    }
    return null
  }

  /** Member id: localStorage fast path, else the getCurrentMember() network
   *  call. Never rejects — an unknown member resolves null. */
  function currentMemberId() {
    var cached = cachedMemberId()
    if (cached != null) return Promise.resolve(cached)
    try {
      var ms = window.$memberstackDom
      if (!ms) return Promise.resolve(null)
      return Promise.resolve(ms.getCurrentMember()).then(
        function (r) {
          return r && r.data ? r.data.id : null
        },
        function () {
          return null
        },
      )
    } catch (e) {
      return Promise.resolve(null)
    }
  }

  /** Memberstack cookie -> Xano token, one round-trip, no caching here. */
  function tradeToken() {
    var ms = window.$memberstackDom
    if (!ms) return Promise.reject(new Error('Memberstack not available'))
    return Promise.resolve(ms.getMemberCookie()).then(function (msToken) {
      if (!msToken) throw new Error('No Memberstack session (member not logged in)')
      return fetch(AUTH_BASE + TRADE_PATH + '?token=' + encodeURIComponent(msToken)).then(function (res) {
        return res
          .json()
          .catch(function () {
            return null
          })
          .then(function (data) {
            if (!res.ok) throw Object.assign(new Error('trade-token failed'), { status: res.status, data: data })
            var token = typeof data === 'string' ? data : data && (data.authToken || data.token)
            if (!token) throw new Error('trade-token returned no token')
            return token
          })
      })
    })
  }

  /** Kick off member-id resolution and the token trade IN PARALLEL. */
  function startAuth() {
    var auth = { memberId: currentMemberId(), token: null }
    auth.token = tradeToken().catch(function (err) {
      // A failed trade (logged out, endpoint down) must not poison the
      // cache — the next authed load retries a fresh handshake.
      if (_auth === auth) _auth = null
      throw err
    })
    return auth
  }

  async function xanoToken() {
    if (_auth) {
      // Cached (or in-flight) token: reconcile the member id — instant on
      // the localStorage path — and drop the token on an account switch.
      var owner = await _auth.memberId
      var mid = await currentMemberId()
      if (mid !== owner) _auth = null
    }
    if (!_auth) _auth = startAuth()
    return _auth.token
  }

  // Pre-warm the handshake at script-parse time — well before the DOM-ready
  // boot fires the first list request — so the trade round-trip overlaps
  // page work it used to serialize behind. Requires memberstack-x to have
  // loaded first (the documented script order); disable with
  // WfXanoConfig.preAuth = false on pages where every list is auth="none".
  if (CFG.preAuth !== false && window.$memberstackDom) {
    _auth = startAuth()
    _auth.token.catch(function () {
      /* logged out / trade failure — surfaced by the first authed load */
    })
  }

  /* ============================ RESPONSE SHAPE ======================== */
  // Xano paged list -> { items, total, page, pages, hasMore }. Also tolerates
  // a raw array. `hasMore` is authoritative for load-more/infinite modes even
  // when the endpoint omits a total (Xano emits only nextPage) — numbered
  // pagination still needs itemsTotal/pageTotal to know the true last page.
  function normalize(data, perPage) {
    if (Array.isArray(data)) return { items: data, total: data.length, page: 1, pages: 1, hasMore: false }
    if (data && Array.isArray(data.items)) {
      var total = data.itemsTotal != null ? data.itemsTotal : data.items.length
      var page = data.curPage || 1
      var pages = data.pageTotal
      // pageTotal is absent unless the endpoint enables include_count-style
      // metadata — derive from total/perPage, or at least trust nextPage.
      if (!pages) pages = perPage ? Math.max(1, Math.ceil(total / perPage)) : 1
      if (data.nextPage && pages <= page) pages = page + 1
      var hasMore = data.nextPage != null ? true : page < pages
      return { items: data.items, total: total, page: page, pages: pages, hasMore: hasMore }
    }
    // Single object or unknown shape: render as one row.
    return { items: data ? [data] : [], total: data ? 1 : 0, page: 1, pages: 1, hasMore: false }
  }

  /* ============================ CARD RENDER =========================== */
  // Every scan includes the card root (root-element lesson: the template
  // root is often the <a> or carries binds itself).
  function fillCard(card, item) {
    // text / form-value binds (dot paths + optional wf-xano-format). When the
    // primary field is blank (null/''/0/"0" — same rule fmt uses), fall back
    // through the comma-separated wf-xano-fallback fields in order, e.g.
    // wf-xano-bind="last_edited_at" wf-xano-fallback="published_at,created_at".
    qaWithRoot(card, '[wf-xano-bind]').forEach(function (el) {
      var raw = get(item, el.getAttribute('wf-xano-bind'))
      var fb = el.getAttribute('wf-xano-fallback')
      if (fb && isBlank(raw)) {
        var fields = fb.split(',')
        for (var i = 0; i < fields.length && isBlank(raw); i++) {
          raw = get(item, fields[i].trim())
        }
      }
      var value = fmt(raw, el.getAttribute('wf-xano-format'))
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
          return v === '*' ? '' : v // match-all sentinel contributes nothing
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
      var rv = checked.getAttribute('wf-xano-value') || (checked.value !== 'on' ? checked.value : '')
      return rv === '*' ? '' : rv
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
    // Boundary pages always shown at each edge (Finsweet page-boundary). With
    // a wf-xano-element="page-dots" template present, gaps between the window
    // and the boundaries render as ellipses -> e.g. 1 2 … 7 8 9 … 24 25.
    this.pageBoundary = parseInt(root.getAttribute('wf-xano-page-boundary') || '1', 10)
    // How pages are consumed (Finsweet's `load` setting): 'pagination' =
    // numbered buttons (needs a true total); 'more' = append on load-more
    // click; 'infinite' = append on scroll; 'all' = fetch every page up front.
    // The append modes need only nextPage, so they work when the endpoint
    // omits a total count.
    this.loadMode = (root.getAttribute('wf-xano-load') || 'pagination').toLowerCase()
    this.appendMode = this.loadMode === 'more' || this.loadMode === 'infinite' || this.loadMode === 'all'
    this.threshold = parseInt(root.getAttribute('wf-xano-threshold') || '0', 10)
    this.debounce = parseInt(root.getAttribute('wf-xano-debounce') || '300', 10)
    this.urlSync = root.getAttribute('wf-xano-url-sync') === 'true'
    this.page = 1
    this.params = this.readStaticParams()
    // Baseline for clearParams()/tag chips: static wf-xano-param-* values
    // are configuration, not user filters.
    this.baseParams = Object.assign({}, this.params)
    this.template = q(root, elSel('template'))
    this.emptyEl = q(root, elSel('empty'))
    this.loaderEl = q(root, elSel('loader'))
    this.errorEl = q(root, elSel('error'))
    // Optional items container (Finsweet's `list` role). Cards render here;
    // default is the template's own parent. The root itself never counts
    // (v0.3.0 markup used element="list" + source on the root).
    this.listEl =
      qa(root, '[wf-xano-element="list"]').filter(function (el) {
        return el !== root
      })[0] || null
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
      console.error('[wf-xano] missing template (wf-xano-element="template") inside', root)
      return
    }
    this.ok = true
    this.template.style.display = 'none'
    root.__wfXano = this
    this.tagTemplate = this.q(elSel('tag'))
    if (this.tagTemplate) this.tagTemplate.style.display = 'none'
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
    // Append the instance scope to EVERY branch of a comma-separated
    // selector — naive concatenation would scope only the last branch.
    var scoped = sel
      .split(',')
      .map(function (part) {
        return part.trim() + '[wf-xano-instance="' + self.key + '"]'
      })
      .join(', ')
    var outside = qa(document, scoped).filter(function (el) {
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

  /** Reflect current params into every filter/search control — text inputs
   *  and selects get the value (or ''), checkboxes/radios get (un)checked by
   *  whether their effective value is part of the param. Runs on URL restore
   *  and after clearParams()/tag removal, so controls never drift from state.
   *  Click filters are handled by the is-active pass in updateFilterUI. */
  Instance.prototype.hydrateControls = function () {
    var self = this
    this.qa('[wf-xano-filter], [wf-xano-search]').forEach(function (el) {
      if (el.matches('[wf-xano-element="clear"], [wf-xano-clear]')) return
      var field = el.getAttribute('wf-xano-filter') || el.getAttribute('wf-xano-search')
      var raw = self.params[field] != null ? String(self.params[field]) : ''
      if (el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)) {
        var values = raw
          .split(',')
          .map(function (s) {
            return s.trim()
          })
          .filter(Boolean)
        var v = el.getAttribute('wf-xano-value') || (el.value !== 'on' ? el.value : '')
        // `*` = the match-all option: checked exactly when no value is set.
        el.checked = v === '*' ? values.length === 0 : values.indexOf(v) > -1
        return
      }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.value = raw
    })
    this.updateFilterUI()
  }

  /* --------------------------- CONTROLS ----------------------------- */
  Instance.prototype.bindControls = function () {
    var self = this
    var signal = this._ac ? { signal: this._ac.signal } : false

    // Filters: [wf-xano-filter="field"] — re-fetch on change. Checkbox groups
    // for the same field combine into a comma-separated param.
    var filterEls = this.qa('[wf-xano-filter]').filter(function (el) {
      return !el.matches('[wf-xano-element="clear"], [wf-xano-clear]')
    })
    var formFilterEls = filterEls.filter(function (el) {
      return /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)
    })
    formFilterEls.forEach(function (el) {
      var field = el.getAttribute('wf-xano-filter')
      el.addEventListener(
        'change',
        function () {
          var group = formFilterEls.filter(function (other) {
            return other.getAttribute('wf-xano-filter') === field
          })
          self.setParam(field, readFilterValue(field, group))
        },
        signal,
      )
    })
    // Click filters: any NON-form element (tab, button, link, label span…)
    // with wf-xano-filter + wf-xano-value — wf-algolia's filter-item.
    // Empty wf-xano-value = the "All" option (clears the param). Opt into
    // click-again-to-clear with wf-xano-toggle="true".
    filterEls
      .filter(function (el) {
        return !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)
      })
      .forEach(function (el) {
        el.addEventListener(
          'click',
          function (e) {
            e.preventDefault()
            var field = el.getAttribute('wf-xano-filter')
            var value = el.getAttribute('wf-xano-value') || ''
            if (value === '*') value = '' // match-all sentinel
            var toggle = el.getAttribute('wf-xano-toggle') === 'true'
            var current = String(self.params[field] != null ? self.params[field] : '')
            self.setParam(field, toggle && current === value ? '' : value)
          },
          signal,
        )
      })
    // Clear: wf-xano-element="clear" — all user filters, or one field when
    // the element also carries wf-xano-filter="field" (Finsweet's `clear`).
    this.qa(elSel('clear')).forEach(function (el) {
      el.addEventListener(
        'click',
        function (e) {
          e.preventDefault()
          var field = el.getAttribute('wf-xano-filter')
          if (field) self.setParam(field, '')
          else self.clearParams()
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
    this.qa(elSel('page-prev')).forEach(function (el) {
      el.addEventListener(
        'click',
        function (e) {
          e.preventDefault()
          if (self.page > 1) self.goToPage(self.page - 1)
        },
        signal,
      )
    })
    this.qa(elSel('page-next')).forEach(function (el) {
      el.addEventListener(
        'click',
        function (e) {
          e.preventDefault()
          if (self.page < self._pages) self.goToPage(self.page + 1)
        },
        signal,
      )
    })
    // Load-more (Finsweet `load="more"`): click appends the next page. Also
    // the scroll sentinel for `infinite`. Works off nextPage alone.
    this.qa(elSel('load-more')).forEach(function (el) {
      el.addEventListener(
        'click',
        function (e) {
          e.preventDefault()
          self.loadNext()
        },
        signal,
      )
    })
    if (this.loadMode === 'infinite') this.bindInfinite()

    if (this.urlSync) this.hydrateControls()
  }

  /** IntersectionObserver on the load-more element (or the list tail) that
   *  appends the next page as it scrolls into view. Falls back to a scroll
   *  listener where IntersectionObserver is unavailable. */
  Instance.prototype.bindInfinite = function () {
    var self = this
    var sentinel = this.q(elSel('load-more')) || this.listEl || this.template.parentNode
    if (!sentinel) return
    if (typeof IntersectionObserver === 'function') {
      this._io = new IntersectionObserver(
        function (entries) {
          if (entries.some(function (en) { return en.isIntersecting })) self.loadNext()
        },
        { rootMargin: (this.threshold || 0) + 'px' },
      )
      this._io.observe(sentinel)
    } else {
      var onScroll = function () {
        var r = sentinel.getBoundingClientRect()
        if (r.top - (self.threshold || 0) <= window.innerHeight) self.loadNext()
      }
      window.addEventListener('scroll', onScroll, this._ac ? { signal: this._ac.signal } : false)
    }
  }

  /** Append the next page (load-more / infinite). No-op while a load is in
   *  flight or when the last response reported no further pages. */
  Instance.prototype.loadNext = function () {
    if (this._loading || (this._lastResult && !this._lastResult.hasMore)) return
    this.page += 1
    return this.load({ append: true })
  }

  /** Set/clear a request param, reset to page 1, reload. */
  Instance.prototype.setParam = function (field, value) {
    // `*` is the match-all sentinel (Webflow's Designer cannot author an
    // EMPTY attribute value, so "All" options carry wf-xano-value="*").
    if (value == null || value === '' || value === '*') delete this.params[field]
    else this.params[field] = value
    this.page = 1
    return this.load()
  }

  Instance.prototype.goToPage = function (page) {
    this.page = page
    return this.load()
  }

  /** Current request params (copy) — wf-algolia's getFilterState equivalent. */
  Instance.prototype.getParams = function () {
    return Object.assign({}, this.params)
  }

  /** Reset every user filter back to the static wf-xano-param-* baseline —
   *  wf-algolia's clearAllFilters equivalent. */
  Instance.prototype.clearParams = function () {
    this.params = Object.assign({}, this.baseParams)
    this.page = 1
    this.hydrateControls()
    return this.load()
  }

  /** The params a user actively set (excludes the static baseline). */
  Instance.prototype.userParams = function () {
    var self = this
    var out = {}
    Object.keys(this.params).forEach(function (field) {
      if (self.params[field] !== self.baseParams[field]) out[field] = self.params[field]
    })
    return out
  }

  /** Reflect filter state into the UI: `is-active` on click filters and on
   *  checkbox/radio labels (Finsweet-style state class), then filter tags. */
  Instance.prototype.updateFilterUI = function () {
    var self = this
    this.qa('[wf-xano-filter]').forEach(function (el) {
      if (el.matches('[wf-xano-element="clear"], [wf-xano-clear]')) return
      var field = el.getAttribute('wf-xano-filter')
      var values = String(self.params[field] != null ? self.params[field] : '')
        .split(',')
        .map(function (s) {
          return s.trim()
        })
        .filter(Boolean)
      if (el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)) {
        var v = el.getAttribute('wf-xano-value') || (el.value !== 'on' ? el.value : '')
        var label = el.closest('label') || el
        label.classList.toggle('is-active', v === '*' ? values.length === 0 : values.indexOf(v) > -1)
        return
      }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
      var value = el.getAttribute('wf-xano-value') || ''
      var active = value === '' || value === '*' ? values.length === 0 : values.indexOf(value) > -1
      el.classList.toggle('is-active', active)
    })
    this.renderTags()
  }

  /** Active-filter chips: clone the wf-xano-element="tag" template once per
   *  user-set filter value; tag-field / tag-value / tag-remove children
   *  (Finsweet's tag grammar). Removing a value drops it from its group. */
  Instance.prototype.renderTags = function () {
    var tmpl = this.tagTemplate
    if (!tmpl) return
    var self = this
    var parent = tmpl.parentNode
    qa(parent, '[wf-xano-tag-item]').forEach(function (c) {
      c.remove()
    })
    tmpl.style.display = 'none'
    var user = this.userParams()
    Object.keys(user).forEach(function (field) {
      String(user[field])
        .split(',')
        .map(function (s) {
          return s.trim()
        })
        .filter(Boolean)
        .forEach(function (value) {
          var tag = tmpl.cloneNode(true)
          clearRole(tag, 'tag')
          tag.setAttribute('wf-xano-tag-item', '')
          tag.style.display = ''
          var f = q(tag, elSel('tag-field'))
          if (f) f.textContent = field
          var v = q(tag, elSel('tag-value'))
          if (v) v.textContent = value
          var remove = q(tag, elSel('tag-remove')) || tag
          remove.addEventListener('click', function (e) {
            e.preventDefault()
            var rest = String(self.params[field] || '')
              .split(',')
              .map(function (s) {
                return s.trim()
              })
              .filter(function (x) {
                return x && x !== value
              })
            self.setParam(field, rest.join(','))
            self.hydrateControls()
          })
          parent.appendChild(tag)
        })
    })
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

  Instance.prototype.load = async function (opts) {
    if (!this.ok) return
    var append = !!(opts && opts.append)
    var self = this
    var seq = ++this._seq
    this._loading = true
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
      this.render(result, append)
      this.setState('idle')
      this._loading = false
      this._lastResult = result
      if (this.urlSync && !append) this.syncUrl()
      this.emit('results', result)
      // `all` mode: keep pulling pages until the source is exhausted.
      if (this.loadMode === 'all' && result.hasMore) this.loadNext()
    } catch (err) {
      if (seq !== this._seq) return
      this._loading = false
      console.error('[wf-xano] load failed', this.source, err)
      this.setState('error')
      this.render({ items: [], total: 0, page: 1, pages: 1, hasMore: false })
      this.emit('error', err)
    }
  }

  Instance.prototype.render = function (result, append) {
    this._pages = result.pages
    var list = this.listEl || this.template.parentNode
    // Replace mode clears prior clones; append mode (load-more/infinite/all)
    // keeps them and adds the new page below.
    if (!append) {
      qa(list, '[wf-xano-item]').forEach(function (c) {
        c.remove()
      })
    }
    // Empty state reflects the accumulated list, not just this page.
    var rendered = append ? qa(list, '[wf-xano-item]').length + result.items.length : result.items.length
    showStateEl(this.emptyEl, !rendered)
    this.root.classList.toggle('is-wf-xano-empty', !rendered)
    var self = this
    result.items.forEach(function (item) {
      var card = self.template.cloneNode(true)
      clearRole(card, 'template')
      card.setAttribute('wf-xano-item', '')
      card.style.display = ''
      if (item && item.id != null) card.setAttribute('data-wf-xano-id', item.id)
      fillCard(card, item)
      list.appendChild(card)
    })
    // Counts: total + visible range. In append modes the visible range runs
    // from 1 to the accumulated count; in pagination mode it's this page.
    var shownTotal = qa(list, '[wf-xano-item]').length
    var from, to
    if (this.appendMode) {
      from = shownTotal ? 1 : 0
      to = shownTotal
    } else {
      from = result.items.length ? (result.page - 1) * this.perPage + 1 : 0
      to = result.items.length ? from + result.items.length - 1 : 0
    }
    this.qa(elSel('total')).forEach(function (el) {
      el.textContent = String(result.total)
    })
    this.qa(elSel('count-from')).forEach(function (el) {
      el.textContent = String(from)
    })
    this.qa(elSel('count-to')).forEach(function (el) {
      el.textContent = String(to)
    })
    if (this.appendMode) this.updateLoadMore(result)
    else this.renderPagination(result)
    this.updateFilterUI()
  }

  /** Show/hide the load-more control by whether more pages remain, and mirror
   *  the state onto the root (is-wf-xano-exhausted) for styling. */
  Instance.prototype.updateLoadMore = function (result) {
    var more = !!result.hasMore
    this.qa(elSel('load-more')).forEach(function (el) {
      showStateEl(el, more)
      el.classList.toggle('is-disabled', !more)
    })
    this.root.classList.toggle('is-wf-xano-exhausted', !more)
  }

  Instance.prototype.renderPagination = function (result) {
    var self = this
    this.qa(elSel('page-prev')).forEach(function (el) {
      el.classList.toggle('is-disabled', result.page <= 1)
    })
    this.qa(elSel('page-next')).forEach(function (el) {
      el.classList.toggle('is-disabled', result.page >= result.pages)
    })

    var tmpl = this.q(elSel('page-number'))
    if (!tmpl) return
    var parent = tmpl.parentNode
    var dotsTmpl = this.q(elSel('page-dots'))
    // Clear old clones (numbered buttons + ellipses); keep hidden templates.
    qa(parent, '[wf-xano-page-num], [wf-xano-page-dot]').forEach(function (b) {
      b.remove()
    })
    tmpl.style.display = 'none'
    if (dotsTmpl) dotsTmpl.style.display = 'none'

    paginationModel(result.page, result.pages, this.pageWindow, this.pageBoundary).forEach(function (entry) {
      if (entry === 'dots') {
        // No page-dots template -> silently omit the ellipsis (still valid).
        if (!dotsTmpl) return
        var dot = dotsTmpl.cloneNode(true)
        clearRole(dot, 'page-dots')
        dot.setAttribute('wf-xano-page-dot', '')
        dot.style.display = ''
        dot.removeAttribute('aria-current')
        parent.appendChild(dot)
        return
      }
      var btn = tmpl.cloneNode(true)
      clearRole(btn, 'page-number')
      btn.setAttribute('wf-xano-page-num', '')
      btn.style.display = ''
      btn.textContent = String(entry)
      var active = entry === result.page
      btn.classList.toggle('is-active', active)
      if (active) btn.setAttribute('aria-current', 'page')
      else btn.removeAttribute('aria-current')
      btn.addEventListener('click', function (e) {
        e.preventDefault()
        self.goToPage(entry)
      })
      parent.appendChild(btn)
    })
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
    if (this._io) this._io.disconnect()
    window.clearTimeout(this._searchTimer)
    if (this.template) {
      qa(this.listEl || this.template.parentNode, '[wf-xano-item]').forEach(function (c) {
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
    // Roots: canonical `wrapper`, plus legacy aliases — the bare
    // wf-xano-list marker and v0.3.0's element="list" WITH wf-xano-source
    // (source disambiguates a root from Finsweet-style items containers).
    var sel = elSel('wrapper') + ', [wf-xano-list], [wf-xano-element="list"][wf-xano-source]'
    qa(root, sel).forEach(function (el) {
      if (el.__wfXano) return
      if (!el.matches('[wf-xano-element="wrapper"], [wf-xano-wrapper]')) {
        log('deprecated root marker on', el, '— use wf-xano-element="wrapper"')
      }
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
      paginationModel: paginationModel,
      isBlank: isBlank,
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
