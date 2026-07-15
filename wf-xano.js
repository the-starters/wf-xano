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
 *   - Parallel cold-boot auth — the live Memberstack session fingerprints
 *     the cached token and the trade pre-warms at script parse, so first
 *     render has no member-profile lookup or serial auth gate.
 *   - Root-element attribute handling — the card root is often the <a> (or
 *     carries binds) itself, so every per-card scan includes the root, not
 *     just descendants.
 *   - Request sequencing — overlapping loads (debounced search + filter
 *     clicks) resolve out of order; only the latest request may render.
 *
 * Load AFTER memberstack-x (when using auth) in the page footer:
 *   <script>window.WfXanoConfig = {
 *     xanoBase: 'https://<id>.xano.io',
 *     authBase: 'https://<id>.xano.io/api:<auth-group>'
 *   }</script>
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

  var VERSION = '0.19.0'
  var CFG = window.WfXanoConfig || {}
  // Never silently send another project's requests to The Starters' Xano
  // workspace. A missing xanoBase falls back to the page origin so relative
  // paths remain useful; group:path sources log a configuration warning.
  var XANO_HOST = (CFG.xanoBase || window.location.origin).replace(/\/$/, '')
  var AUTH_BASE = CFG.authBase || null
  var TRADE_PATH = CFG.tradeTokenPath || '/auth/trade-token/v3'
  var DEBUG = CFG.debug !== false
  var ROOT_SEL =
    '[wf-xano-element="wrapper"], [wf-xano-wrapper], [wf-xano-list], [wf-xano-element="list"][wf-xano-source]'

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

  /** Clone JSON-shaped runtime state so page code cannot mutate the store. */
  function cloneStateValue(value) {
    if (Array.isArray(value)) return value.map(cloneStateValue)
    if (value && typeof value === 'object') {
      var copy = {}
      Object.keys(value).forEach(function (key) {
        copy[key] = cloneStateValue(value[key])
      })
      return copy
    }
    return value
  }

  /** Freeze the private store so selectors cannot mutate it by reference. */
  function freezeStateValue(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
    Object.keys(value).forEach(function (key) {
      freezeStateValue(value[key])
    })
    return Object.freeze(value)
  }

  /** Errors exposed through state deliberately exclude response bodies/tokens. */
  function publicError(err) {
    if (!err) return null
    var out = { name: err.name || 'Error' }
    if (err.status != null) out.status = err.status
    return out
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

  /** Escape a string for use inside a quoted CSS attribute selector. */
  function cssAttr(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\0-\x1f\x7f]/g, function (ch) {
        return '\\' + ch.charCodeAt(0).toString(16) + ' '
      })
  }

  /** Nearest list wrapper, used to keep nested instances isolated. */
  function ownerRoot(el) {
    return el && el.closest ? el.closest(ROOT_SEL) : null
  }

  function positiveInt(value, fallback, allowZero) {
    var n = parseInt(value, 10)
    return isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : fallback
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
   *  Zero is data, not absence; epoch rejection belongs to date formatting. */
  function isBlank(v) {
    return v == null || v === ''
  }

  function isBindBlank(v, kind) {
    return isBlank(v) || (!!DATE_KINDS[kind] && (v === 0 || v === '0'))
  }

  /** Optional value formatting via wf-xano-format. Date styles:
   *  `date` (locale short, e.g. 5/21/2026), `date-medium` / `date-long`
   *  ("May 21, 2026"), `datetime`, `datetime-long`. Also `short-name`,
   *  `lowercase`, `uppercase`, `capitalize` (first letter up, rest lower),
   *  else the raw value. */
  function fmt(value, kind) {
    if (isBlank(value)) return ''
    if (kind && DATE_KINDS[kind]) {
      // Xano commonly stores an unset timestamp as 0. Keep that special case
      // local to date formatting so legitimate numeric zero values still bind.
      if (value === 0 || value === '0') return ''
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
    if (kind === 'lowercase') return String(value).toLowerCase()
    if (kind === 'uppercase') return String(value).toUpperCase()
    if (kind === 'capitalize') {
      var s = String(value)
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
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
      if (!CFG.xanoBase) console.warn('[wf-xano] WfXanoConfig.xanoBase is required for group:path sources')
      var group = source.slice(0, i)
      var path = source.slice(i + 1).replace(/^\//, '')
      return XANO_HOST + '/api:' + group + '/' + path
    }
    return XANO_HOST + '/' + source.replace(/^\//, '')
  }

  function safeBoundUrl(value, kind) {
    var raw = String(value == null ? '' : value).trim()
    if (!raw) return null
    // Relative URLs and fragment/query links are safe to preserve.
    if (/^(?:[/.?#]|\.\.?\/)/.test(raw)) return raw
    var m = /^([a-z][a-z0-9+.-]*):/i.exec(raw)
    if (!m) return raw
    var protocol = m[1].toLowerCase()
    var allowed = kind === 'src' ? ['http', 'https', 'blob'] : ['http', 'https', 'mailto', 'tel']
    if (allowed.indexOf(protocol) > -1) return raw
    if (kind === 'src' && protocol === 'data' && /^data:image\/(?:avif|gif|jpeg|png|webp);/i.test(raw)) return raw
    return null
  }

  /* ============================ AUTH BRIDGE =========================== */
  // Memberstack JWT -> Xano auth token, cached and reset on member change.
  //
  // This handshake is the cold-boot critical path, so nothing here waits
  // that doesn't have to (measured 2026-07: a serial getCurrentMember ->
  // trade-token -> list chain cost ~1.2s before first render):
  //   - The live session cookie fingerprints the cached token. No member
  //     profile lookup is needed: the traded token derives from that cookie.
  //   - The trade is pre-warmed at script-parse time (see below), so the
  //     round-trip overlaps DOM-ready instead of the first list request.
  //   - A cached token is dropped whenever the live session cookie changes,
  //     covering account switches and JWT rotation even if localStorage lags.
  var _auth = null // { session, token: Promise<string> }

  function sessionFingerprint(token) {
    // Non-cryptographic, in-memory equality key. The JWT itself is never put
    // into a URL, storage, logs, or the public API.
    var h = 2166136261
    for (var i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return String(h >>> 0) + ':' + token.length
  }

  function memberstackSession() {
    var ms = window.$memberstackDom
    if (!ms) return Promise.reject(Object.assign(new Error('Memberstack not available'), { auth: true }))
    return Promise.resolve(ms.getMemberCookie()).then(function (token) {
      if (!token) throw Object.assign(new Error('No Memberstack session (member not logged in)'), { auth: true })
      return String(token)
    })
  }

  /** Memberstack cookie -> Xano token, one round-trip, no caching here.
   *  POST keeps the JWT out of URLs and infrastructure access logs. Legacy
   *  bridges can temporarily opt into GET with tradeTokenMethod: 'GET'. */
  function tradeToken(msToken) {
    if (!AUTH_BASE) return Promise.reject(new Error('WfXanoConfig.authBase is required for Memberstack auth'))
    if (/^http:\/\//i.test(AUTH_BASE) && CFG.allowInsecureAuth !== true) {
      return Promise.reject(new Error('Refusing token trade over insecure HTTP'))
    }
    var method = String(CFG.tradeTokenMethod || 'POST').toUpperCase()
    var url = AUTH_BASE + TRADE_PATH
    var request = { method: method, cache: 'no-store' }
    if (method === 'GET') url += '?token=' + encodeURIComponent(msToken)
    else {
      request.headers = { 'Content-Type': 'application/json' }
      request.body = JSON.stringify({ token: msToken })
    }
    return fetch(url, request).then(function (res) {
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
  }

  /** Kick off member-id resolution and the token trade IN PARALLEL. */
  function startAuth() {
    var session = memberstackSession()
    var auth = {
      session: session.then(sessionFingerprint, function () {
        return null
      }),
      token: null,
    }
    auth.token = session.then(tradeToken).catch(function (err) {
      // A failed trade (logged out, endpoint down) must not poison the
      // cache — the next authed load retries a fresh handshake.
      if (_auth === auth) _auth = null
      throw err
    })
    return auth
  }

  async function xanoToken() {
    if (_auth) {
      // The live session cookie is the authoritative owner key. A cookie
      // change (account switch or JWT rotation) always forces a fresh trade;
      // no Memberstack profile/localStorage metadata is trusted as identity.
      var ownerSession = await _auth.session
      var liveSession = await memberstackSession().then(sessionFingerprint)
      if (liveSession !== ownerSession) {
        _auth = null
        clearAuthenticatedStoreSnapshots()
      }
    }
    if (!_auth) _auth = startAuth()
    return _auth.token
  }

  // Pre-warm the handshake at script-parse time — well before the DOM-ready
  // boot fires the first list request — so the trade round-trip overlaps
  // page work it used to serialize behind. Requires memberstack-x to have
  // loaded first (the documented script order); disable with
  // WfXanoConfig.preAuth = false on pages where every list is auth="none".
  if (CFG.preAuth !== false && AUTH_BASE && window.$memberstackDom) {
    _auth = startAuth()
    _auth.token.catch(function () {
      /* logged out / trade failure — surfaced by the first authed load */
    })
  }

  /* ============================ FAVORITES ============================ */
  // Generic member-scoped favorite toggles that can live inside cards
  // rendered by either wf-xano or wf-algolia. The libraries stay independent:
  // this module reads only stable DOM identifiers (`data-wf-xano-id` or
  // wf-algolia's `data-wf-algolia-hit-objectid`) and persists through Xano.
  var FAVORITE_SEL = '[wf-xano-element="favorite"], [wf-xano-favorite]'
  var _favoriteSets = {} // item type -> Set<string>
  var _favoriteLoads = {} // item type -> Promise<Set<string>>
  var _favoriteToggles = {} // "type:id" -> Promise
  var _favoriteAuthFailed = {} // item type -> true once hydration hit an auth failure
  var _favoriteSession = null
  var _favoriteObserver = null

  function favoriteControls(scope) {
    var root = scope || document
    var controls = qa(root, FAVORITE_SEL)
    if (root.matches && root.matches(FAVORITE_SEL)) controls.unshift(root)
    return controls
  }

  function favoriteType(el) {
    var owner = el.closest ? el.closest('[wf-xano-favorite-type]') : null
    return String((owner && owner.getAttribute('wf-xano-favorite-type')) || '').trim()
  }

  function favoriteId(el) {
    var explicit = el.getAttribute('wf-xano-favorite-id')
    if (explicit != null && String(explicit).trim()) return String(explicit).trim()
    var xanoCard = el.closest ? el.closest('[data-wf-xano-id]') : null
    if (xanoCard) return String(xanoCard.getAttribute('data-wf-xano-id') || '').trim()
    var algoliaCard = el.closest ? el.closest('[data-wf-algolia-hit-objectid]') : null
    return algoliaCard ? String(algoliaCard.getAttribute('data-wf-algolia-hit-objectid') || '').trim() : ''
  }

  function favoriteEndpoint(action) {
    var override = action === 'ids' ? CFG.favoriteIdsSource : CFG.favoriteToggleSource
    if (override) return resolveUrl(override)
    var base = String(CFG.favoritesSource || '').replace(/\/$/, '')
    return base ? resolveUrl(base + '/' + action) : null
  }

  function favoriteLabels(el, favorited) {
    var add = el.getAttribute('wf-xano-favorite-label-add') || 'Save item'
    var remove = el.getAttribute('wf-xano-favorite-label-remove') || 'Remove saved item'
    el.setAttribute('aria-label', favorited ? remove : add)
    el.setAttribute('aria-pressed', favorited ? 'true' : 'false')
  }

  function favoriteActiveClasses(el) {
    var value = String(el.getAttribute('wf-xano-favorite-class') || '').trim() || 'is-active'
    return value.split(/\s+/).filter(Boolean)
  }

  function setFavoriteActiveClasses(el, favorited) {
    var targets = [el].concat(qa(el, '[wf-xano-element="favorite-visual"]'))
    favoriteActiveClasses(el).forEach(function (className) {
      targets.forEach(function (target) {
        target.classList.toggle(className, !!favorited)
      })
    })
  }

  function setFavoriteControl(el, favorited, loading) {
    el.hidden = false
    el.classList.toggle('is-wf-xano-favorited', !!favorited)
    setFavoriteActiveClasses(el, favorited)
    el.classList.toggle('is-wf-xano-loading', !!loading)
    el.setAttribute('aria-busy', loading ? 'true' : 'false')
    if ('disabled' in el) el.disabled = !!loading
    favoriteLabels(el, !!favorited)
  }

  function hideFavoriteControls(type, scope) {
    favoriteControls(scope || document).forEach(function (el) {
      if (!type || favoriteType(el) === type) el.hidden = true
    })
  }

  function isFavoriteAuthFailure(err) {
    return !!(err && (err.auth || err.status === 401 || err.status === 403))
  }

  function syncFavoriteControls(type, id, favorited, loading) {
    favoriteControls(document).forEach(function (el) {
      if (favoriteType(el) !== type || favoriteId(el) !== id) return
      setFavoriteControl(el, favorited, loading)
    })
  }

  function paintFavoriteControls(scope) {
    favoriteControls(scope).forEach(function (el) {
      var type = favoriteType(el)
      var id = favoriteId(el)
      if (!type || !id) return
      var set = _favoriteSets[type]
      if (set) setFavoriteControl(el, set.has(id), !!_favoriteToggles[type + ':' + id])
    })
  }

  function resetFavoriteState() {
    _favoriteSets = {}
    _favoriteLoads = {}
    _favoriteToggles = {}
    _favoriteAuthFailed = {}
    favoriteControls(document).forEach(function (el) {
      var type = favoriteType(el)
      var id = favoriteId(el)
      if (type && id) setFavoriteControl(el, false, false)
    })
  }

  async function syncFavoriteSession() {
    var current = await memberstackSession().then(sessionFingerprint)
    if (_favoriteSession != null && current !== _favoriteSession) resetFavoriteState()
    _favoriteSession = current
    return current
  }

  async function favoriteRequest(action, body) {
    var url = favoriteEndpoint(action)
    if (!url) throw new Error('WfXanoConfig.favoritesSource is required for favorite controls')
    await syncFavoriteSession()
    var res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + (await xanoToken()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    })
    var data = await res.json().catch(function () {
      return null
    })
    if (!res.ok) throw Object.assign(new Error('wf-xano favorite ' + res.status), { status: res.status })
    return data
  }

  function favoriteEvent(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }))
  }

  function refreshFavoriteLists(type) {
    instances.slice().forEach(function (instance) {
      var events = String(instance.root.getAttribute('wf-xano-refresh-on') || '')
        .split(',')
        .map(function (s) { return s.trim() })
      var listType = instance.root.getAttribute('wf-xano-favorite-type')
      if (events.indexOf('favorite') > -1 && (!listType || listType === type)) instance.refresh()
    })
  }

  function ensureFavoriteType(type, force) {
    if (!type) return Promise.resolve(new Set())
    if (!force && _favoriteLoads[type]) return _favoriteLoads[type]
    _favoriteLoads[type] = favoriteRequest('ids', { item_type: type })
      .then(function (data) {
        var ids = Array.isArray(data) ? data : data && data.ids
        if (!Array.isArray(ids)) throw new Error('wf-xano favorite ids returned an invalid response')
        var set = new Set(ids.map(String))
        _favoriteSets[type] = set
        delete _favoriteAuthFailed[type]
        paintFavoriteControls(document)
        return set
      })
      .catch(function (err) {
        delete _favoriteLoads[type]
        if (isFavoriteAuthFailure(err)) {
          _favoriteAuthFailed[type] = true
          delete _favoriteSets[type]
          hideFavoriteControls(type)
        }
        favoriteEvent('wf-xano:favorite-error', { item_type: type, item_id: null, status: err && err.status })
        throw err
      })
    return _favoriteLoads[type]
  }

  function toggleFavorite(el) {
    var type = favoriteType(el)
    var id = favoriteId(el)
    if (!type || !id) {
      console.warn('[wf-xano] favorite control is missing item type or id')
      return Promise.resolve()
    }
    var key = type + ':' + id
    if (_favoriteToggles[key]) return _favoriteToggles[key]
    var set = _favoriteSets[type] || (_favoriteSets[type] = new Set())
    var previous = set.has(id)
    var optimistic = !previous
    if (optimistic) set.add(id)
    else set.delete(id)
    syncFavoriteControls(type, id, optimistic, true)
    var request = favoriteRequest('toggle', { item_type: type, item_id: id })
      .then(function (data) {
        var favorited = !!(data && data.favorited)
        if (favorited) set.add(id)
        else set.delete(id)
        syncFavoriteControls(type, id, favorited, false)
        favoriteEvent('wf-xano:favorite', { item_type: type, item_id: id, favorited: favorited })
        refreshFavoriteLists(type)
        return favorited
      })
      .catch(function (err) {
        if (previous) set.add(id)
        else set.delete(id)
        syncFavoriteControls(type, id, previous, false)
        favoriteEvent('wf-xano:favorite-error', { item_type: type, item_id: id, status: err && err.status })
        throw err
      })
      .finally(function () {
        delete _favoriteToggles[key]
      })
    _favoriteToggles[key] = request
    return request
  }

  function ensureFavoriteObserver() {
    if (_favoriteObserver || !document.body || typeof MutationObserver !== 'function') return
    _favoriteObserver = new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes || [], function (node) {
          if (!node || node.nodeType !== 1) return
          initFavorites(node)
        })
      })
    })
    _favoriteObserver.observe(document.body, { childList: true, subtree: true })
  }

  function initFavorites(scope) {
    if (!favoriteEndpoint('ids') || !favoriteEndpoint('toggle')) {
      if (favoriteControls(scope).length) {
        console.warn('[wf-xano] favorite controls found but WfXanoConfig.favoritesSource is missing')
        hideFavoriteControls()
      }
      return
    }
    ensureFavoriteObserver()
    var controls = favoriteControls(scope)
    if (!controls.length) return
    var types = {}
    controls.forEach(function (el) {
      var type = favoriteType(el)
      if (type) types[type] = true
    })
    Object.keys(types).forEach(function (type) {
      if (_favoriteAuthFailed[type]) {
        hideFavoriteControls(type, scope)
        return
      }
      ensureFavoriteType(type).catch(function () {
        /* surfaced through the DOM event; keep page boot non-fatal */
      })
    })
    paintFavoriteControls(scope)
  }

  // Capture at document level so Webflow/wf-algolia card handlers cannot
  // intercept the click on an ancestor before the favorite toggle runs.
  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest(FAVORITE_SEL) : null
    if (!el) return
    event.preventDefault()
    event.stopPropagation()
    toggleFavorite(el).catch(function () {
      /* UI rollback + event already handled */
    })
  }, true)

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
    // Scalar bodies (a bare string/number/bool with HTTP 200 — e.g. a
    // backend debug message) are not data: rendering them would produce a
    // phantom card with every bind empty. Surface as an error instead.
    if (data != null && typeof data !== 'object') {
      throw new Error('wf-xano unexpected response shape (' + typeof data + '): ' + String(data).slice(0, 120))
    }
    // Single object: render as one row.
    return { items: data ? [data] : [], total: data ? 1 : 0, page: 1, pages: 1, hasMore: false }
  }

  /* ============================ CARD RENDER =========================== */
  // Every scan includes the card root (root-element lesson: the template
  // root is often the <a> or carries binds itself).
  function fillCard(card, item) {
    // text / form-value binds (dot paths + optional wf-xano-format). Missing
    // values fall back through the comma-separated fields in order; epoch 0
    // is treated as missing only when a date format is active, e.g.
    // wf-xano-bind="last_edited_at" wf-xano-fallback="published_at,created_at".
    qaWithRoot(card, '[wf-xano-bind]').forEach(function (el) {
      var raw = get(item, el.getAttribute('wf-xano-bind'))
      var fb = el.getAttribute('wf-xano-fallback')
      var kind = el.getAttribute('wf-xano-format')
      if (fb && isBindBlank(raw, kind)) {
        var fields = fb.split(',')
        for (var i = 0; i < fields.length && isBindBlank(raw, kind); i++) {
          raw = get(item, fields[i].trim())
        }
      }
      var value = fmt(raw, kind)
      // wf-xano-default: literal text rendered when the value is still blank
      // after field fallbacks. A real numeric/string zero remains real data.
      // A default is a real display value, so prefix/suffix still wrap it.
      if (value === '') {
        var def = el.getAttribute('wf-xano-default')
        if (def != null) value = def
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        // Form-value binds take the raw formatted value — prefix/suffix are a
        // display affordance and would corrupt a submitted/filter value.
        el.value = value
      } else {
        // wf-xano-prefix / wf-xano-suffix wrap a non-blank display value with
        // literal text (e.g. wf-xano-prefix=" / " to join an adjacent bind
        // without relying on fragile source whitespace). Skipped when blank so
        // an empty field never leaves a dangling separator.
        if (value !== '') {
          var pre = el.getAttribute('wf-xano-prefix')
          var suf = el.getAttribute('wf-xano-suffix')
          if (pre) value = pre + value
          if (suf) value = value + suf
        }
        el.textContent = value
      }
    })
    // image src binds
    qaWithRoot(card, '[wf-xano-src]').forEach(function (el) {
      // Pipe-separated field fallbacks mirror wf-algolia's image grammar:
      // wf-xano-src="profile_photo|profile-photo-xano|profile-photo".
      // Resolve left-to-right and use the first non-blank value.
      var fields = (el.getAttribute('wf-xano-src') || '').split('|')
      var v
      for (var i = 0; i < fields.length && isBlank(v); i++) {
        v = get(item, fields[i].trim())
      }
      if (v != null && v !== '') {
        var src = safeBoundUrl(v, 'src')
        if (!src) {
          el.removeAttribute('src')
          el.removeAttribute('srcset')
          console.warn('[wf-xano] blocked unsafe image URL')
          return
        }
        // Webflow responsive images and Memberstack avatars can leave a
        // low-resolution srcset on the template. Once Xano supplies the
        // authoritative image, remove that stale candidate so the browser
        // cannot choose it instead of the newly-bound src.
        el.removeAttribute('srcset')
        el.setAttribute('src', src)
      }
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
      if (v != null) {
        var href = safeBoundUrl(pre + v + suf, 'href')
        if (href) a.setAttribute('href', href)
        else {
          a.removeAttribute('href')
          console.warn('[wf-xano] blocked unsafe link URL')
        }
      }
    })
  }

  /** "Show more" toggle: a clickable that expands a clamped text element (a
   *  CSS line-clamp utility class) by removing the clamp class. Webflow
   *  interactions can't do this on wf-xano list cards (IX2 never binds to
   *  runtime clones), and the same control is useful on static / other-binder
   *  pages (a CMS detail page's rich text) — so the library owns it and works
   *  in both places:
   *
   *    <div wf-xano-element="show-more"
   *         wf-xano-target="description"       (optional: a wf-xano-bind OR
   *                                             data-opp-bind field to expand)
   *         wf-xano-class="text-style-2lines"  (clamp class(es) removed while
   *                                             expanded, restored on collapse;
   *                                             space-separated, and `*` globs
   *                                             allowed e.g. text-style-*line*
   *                                             to strip desktop + -mob at once)
   *         wf-xano-expanded-text="Show less"> (optional label swap)
   *      Show more</div>
   *
   *  Target resolution (resolveShowMoreTarget) walks up from the control and,
   *  at each ancestor, picks the first match of: the wf-xano-target field
   *  (matched against BOTH wf-xano-bind and data-opp-bind, so opportunities-3.0
   *  data-bound pages work), then an element carrying the wf-xano-class clamp
   *  class (the class IS the target marker on static pages that have no bind),
   *  then any bound element. In a list card the walk is bounded by the card;
   *  standalone it walks to <body>.
   *
   *  Composite buttons (label + icon children): the label swap writes to the
   *  descendant marked wf-xano-element="show-more-text" when present, so
   *  sibling icons survive (wf-validate's error/message split, same dialect).
   *  Without the marker it writes to the control itself — fine for text-only
   *  buttons, but it would erase element children.
   *
   *  While expanded, `is-wf-xano-expanded` is set on the control, the target,
   *  and any descendants marked wf-xano-element="show-more-icon" — the icon
   *  marker exists because Webflow's Designer styles combo classes on the
   *  element itself (no descendant selectors), so a chevron can get its
   *  rotated state as a combo class directly on the icon. Controls whose
   *  target isn't actually clamped are hidden (short text needs no toggle) —
   *  see pruneShowMoreButton. Clicks never bubble: cards are commonly wrapped
   *  in wf-xano-link anchors. */
  /** Parse a wf-xano-class spec — space-separated exact class names and/or `*`
   *  globs — into a predicate. A glob (e.g. `text-style-*line*`) matches every
   *  clamp variant on a target, desktop AND `-mob`, so expand can strip them
   *  all; a single named class can only strip itself. */
  function clampMatcher(spec) {
    var exact = {}
    var patterns = []
    spec.trim().split(/\s+/).forEach(function (tok) {
      if (!tok) return
      if (tok.indexOf('*') > -1) {
        patterns.push(new RegExp('^' + tok.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'))
      } else {
        exact[tok] = true
      }
    })
    return function (cls) {
      if (exact[cls]) return true
      for (var i = 0; i < patterns.length; i++) if (patterns[i].test(cls)) return true
      return false
    }
  }

  /** A plain CSS selector (OR of the spec's classes) for target resolution, or
   *  null when the spec uses a `*` glob — callers then scan with the matcher. */
  function clampSelector(spec) {
    var tokens = spec.trim().split(/\s+/)
    if (
      tokens.some(function (t) {
        return t.indexOf('*') > -1
      })
    )
      return null
    return tokens
      .filter(Boolean)
      .map(function (t) {
        return '.' + t
      })
      .join(', ')
  }

  /** @param {Element} el @param {(c:string)=>boolean} fn */
  function someClass(el, fn) {
    return Array.prototype.some.call(el.classList, fn)
  }

  /** Of several candidate targets in a scope, pick the one nearest the control
   *  in document order — the closest element BEFORE it (the common "text then
   *  Show-more" layout), else the closest AFTER. Keeps sibling controls from
   *  all resolving to the first match when a scope holds several. */
  function nearestToButton(list, btn) {
    var before = null
    var after = null
    list.forEach(function (el) {
      if (el === btn || btn.contains(el) || el.contains(btn)) return
      var pos = btn.compareDocumentPosition(el)
      if (pos & 2 /* PRECEDING */) before = el // last preceding = closest before
      else if (pos & 4 /* FOLLOWING */ && !after) after = el // first following = closest after
    })
    return before || after
  }

  function resolveShowMoreTarget(btn, boundary) {
    var field = btn.getAttribute('wf-xano-target')
    var clamp = btn.getAttribute('wf-xano-class')
    var clampSel = clamp ? clampSelector(clamp) : null
    var matchClamp = clamp ? clampMatcher(clamp) : null
    var scope = btn.parentElement
    while (scope) {
      var matches = field ? qa(scope, '[wf-xano-bind="' + field + '"], [data-opp-bind="' + field + '"]') : []
      if (!matches.length && clamp) {
        // exact classes → fast selector; glob → scan and test with the matcher
        matches = clampSel
          ? qa(scope, clampSel)
          : qa(scope, '[class]').filter(function (el) {
              return someClass(el, matchClamp)
            })
      }
      if (!matches.length) matches = qa(scope, '[wf-xano-bind], [data-opp-bind]')
      var t = nearestToButton(matches, btn)
      if (t) return t
      if (scope === boundary || scope === document.body) break
      scope = scope.parentElement
    }
    return null
  }

  /** Attach the toggle behavior once. @param {Element} btn @param {Element} target */
  function wireShowMoreButton(btn, target) {
    if (btn.__wfXanoShowMore) return
    btn.__wfXanoShowMore = true
    btn.__wfXanoShowMoreTarget = target
    var clamp = btn.getAttribute('wf-xano-class')
    var matchClamp = clamp ? clampMatcher(clamp) : null
    var labelEl = q(btn, '[wf-xano-element="show-more-text"]') || btn
    var icons = qa(btn, '[wf-xano-element="show-more-icon"]')
    var moreText = labelEl.textContent
    var lessText = btn.getAttribute('wf-xano-expanded-text')
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      var expanded = btn.classList.toggle('is-wf-xano-expanded')
      target.classList.toggle('is-wf-xano-expanded', expanded)
      icons.forEach(function (icon) {
        icon.classList.toggle('is-wf-xano-expanded', expanded)
      })
      // On expand, remove EVERY class on the target matching the spec (so a
      // desktop + `-mob` clamp pair both come off), remembering them; on
      // collapse, restore exactly those. A single exact class behaves as before.
      if (matchClamp) {
        if (expanded) {
          var stripped = Array.prototype.filter.call(target.classList, matchClamp)
          stripped.forEach(function (c) {
            target.classList.remove(c)
          })
          target.__wfXanoStripped = stripped
        } else {
          ;(target.__wfXanoStripped || []).forEach(function (c) {
            target.classList.add(c)
          })
          target.__wfXanoStripped = null
        }
      }
      if (lessText) labelEl.textContent = expanded ? lessText : moreText
    })
  }

  /** Wire every show-more inside a rendered list card (target search bounded
   *  by the card). @param {Element} card */
  function wireShowMore(card) {
    qaWithRoot(card, '[wf-xano-element="show-more"]').forEach(function (btn) {
      var target = resolveShowMoreTarget(btn, card)
      if (!target) {
        log('show-more: no target found', btn)
        return
      }
      wireShowMoreButton(btn, target)
    })
  }

  /** Show/hide one control by whether its target is actually clamped. Two-way
   *  (un-hides too) so late-bound content that becomes clamped re-shows the
   *  control on a later pass; never touches an expanded control. +1 tolerates
   *  sub-pixel rounding. @param {Element} btn */
  function pruneShowMoreButton(btn) {
    var target = btn.__wfXanoShowMoreTarget
    if (!target || btn.classList.contains('is-wf-xano-expanded')) return
    btn.style.display = target.scrollHeight > target.clientHeight + 1 ? '' : 'none'
  }

  /** Prune every show-more in a set of cards. @param {Element[]} cards */
  function pruneShowMore(cards) {
    cards.forEach(function (card) {
      qaWithRoot(card, '[wf-xano-element="show-more"]').forEach(pruneShowMoreButton)
    })
  }

  /** Standalone show-more for pages with no wf-xano list (static CMS / detail
   *  pages, or content bound by another script such as opportunities-3.0.js).
   *  Wires controls NOT inside a list card/template — those are handled by
   *  render(). Content on such pages may be bound async, so prune now, after
   *  layout, and once more shortly after; expose WfXano.initShowMore for an
   *  explicit re-run after a known bind. @param {ParentNode} [scope] */
  function initShowMore(scope) {
    var root = scope || document
    var buttons = qa(root, '[wf-xano-element="show-more"]').filter(function (btn) {
      return !btn.closest('[wf-xano-item], [wf-xano-element="template"], [wf-xano-template]')
    })
    buttons.forEach(function (btn) {
      var target = resolveShowMoreTarget(btn, null)
      if (!target) {
        log('show-more (standalone): no target found', btn)
        return
      }
      wireShowMoreButton(btn, target)
    })
    var prune = function () {
      buttons.forEach(pruneShowMoreButton)
    }
    setTimeout(prune, 0)
    setTimeout(prune, 600)
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

  /** A changed Memberstack session invalidates every member-scoped client
   *  projection before a fresh token can return another account's data. */
  function clearAuthenticatedStoreSnapshots() {
    ;(instances || []).forEach(function (instance) {
      if (!instance.auth || !instance._state) return
      instance._lastResult = null
      instance._transition(
        { data: { items: [], total: 0, page: 1, pages: 1, hasMore: false }, error: null },
        'auth:change',
      )
    })
  }

  function Instance(root) {
    this.ok = false
    this.root = root
    this.key = root.getAttribute('wf-xano-instance') || null
    this.source = root.getAttribute('wf-xano-source')
    this.url = resolveUrl(this.source)
    this.method = (root.getAttribute('wf-xano-method') || 'POST').toUpperCase()
    this.auth = root.getAttribute('wf-xano-auth') !== 'none'
    this.perPage = positiveInt(root.getAttribute('wf-xano-per-page'), 20)
    this.pageWindow = positiveInt(root.getAttribute('wf-xano-page-window'), 5)
    // Boundary pages always shown at each edge (Finsweet page-boundary). With
    // a wf-xano-element="page-dots" template present, gaps between the window
    // and the boundaries render as ellipses -> e.g. 1 2 … 7 8 9 … 24 25.
    this.pageBoundary = positiveInt(root.getAttribute('wf-xano-page-boundary'), 1, true)
    // How pages are consumed (Finsweet's `load` setting): 'pagination' =
    // numbered buttons (needs a true total); 'more' = append on load-more
    // click; 'infinite' = append on scroll; 'all' = fetch every page up front.
    // The append modes need only nextPage, so they work when the endpoint
    // omits a total count.
    this.loadMode = (root.getAttribute('wf-xano-load') || 'pagination').toLowerCase()
    if (['pagination', 'more', 'infinite', 'all'].indexOf(this.loadMode) === -1) this.loadMode = 'pagination'
    this.appendMode = this.loadMode === 'more' || this.loadMode === 'infinite' || this.loadMode === 'all'
    this.threshold = positiveInt(root.getAttribute('wf-xano-threshold'), 0, true)
    this.debounce = positiveInt(root.getAttribute('wf-xano-debounce'), 300, true)
    this.urlSync = root.getAttribute('wf-xano-url-sync') === 'true'
    this.page = 1
    this.params = this.readStaticParams()
    // Baseline for clearParams()/tag chips: static wf-xano-param-* values
    // are configuration, not user filters.
    this.baseParams = Object.assign({}, this.params)
    var owned = function (sel) {
      return qa(root, sel).filter(function (el) {
        return ownerRoot(el) === root
      })[0] || null
    }
    this.template = owned(elSel('template'))
    this.emptyEl = owned(elSel('empty'))
    this.loaderEl = owned(elSel('loader'))
    this.errorEl = owned(elSel('error'))
    // Optional items container (Finsweet's `list` role). Cards render here;
    // default is the template's own parent. The root itself never counts
    // (v0.3.0 markup used element="list" + source on the root).
    this.listEl =
      qa(root, '[wf-xano-element="list"]').filter(function (el) {
        return el !== root && ownerRoot(el) === root
      })[0] || null
    this.listeners = {}
    this._searchTimer = null
    this._hydrating = false
    this._seq = 0
    this._pages = 1
    this._lastResult = null
    this._subscribers = []
    this._state = {
      status: 'idle',
      data: { items: [], total: 0, page: 1, pages: 1, hasMore: false },
      query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage },
      local: {},
      mutation: {},
      error: null,
      revision: 0,
    }
    this._ac = typeof AbortController === 'function' ? new AbortController() : null
    this._fetchAc = null

    if (!this.url) {
      console.error('[wf-xano] missing wf-xano-source on', root)
      return
    }
    if (!this.template) {
      console.error('[wf-xano] missing template (wf-xano-element="template") inside', root)
      return
    }
    if (this.auth && !AUTH_BASE) {
      console.error('[wf-xano] WfXanoConfig.authBase is required when auth is enabled')
      return
    }
    if (this.auth && /^http:\/\//i.test(this.url) && CFG.allowInsecureAuth !== true) {
      console.error('[wf-xano] refusing authenticated request over insecure HTTP', this.url)
      return
    }
    this.ok = true
    this.template.style.display = 'none'
    root.__wfXano = this
    root.setAttribute('aria-busy', 'false')
    if (this.errorEl) {
      if (!this.errorEl.hasAttribute('role')) this.errorEl.setAttribute('role', 'alert')
      if (!this.errorEl.hasAttribute('aria-live')) this.errorEl.setAttribute('aria-live', 'polite')
    }
    this.tagTemplate = this.q(elSel('tag'))
    if (this.tagTemplate) this.tagTemplate.style.display = 'none'
    if (this.urlSync) this.restoreFromUrl()
    this._transition(
      { query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage } },
      'init',
    )
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
      return ownerRoot(el) === self.root && (!declared || declared === self.key)
    })
    if (!this.key) return inside
    // Append the instance scope to EVERY branch of a comma-separated
    // selector — naive concatenation would scope only the last branch.
    var scoped = sel
      .split(',')
      .map(function (part) {
        return part.trim() + '[wf-xano-instance="' + cssAttr(self.key) + '"]'
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

  /** One transition path owns the immutable runtime store. Legacy instance
   *  fields remain the request/render authority during the compatibility
   *  phase; this store is their observable shadow projection. */
  Instance.prototype._transition = function (patch, reason) {
    var previous = this._state
    var next = Object.assign({}, previous, patch || {})
    ;['data', 'query', 'local', 'mutation'].forEach(function (key) {
      if (patch && patch[key]) next[key] = Object.assign({}, previous[key], patch[key])
    })
    next.revision = previous.revision + 1
    this._state = freezeStateValue(next)
    this._subscribers.slice().forEach(function (sub) {
      var selected
      try {
        selected = sub.selector(next)
        if (Object.is(selected, sub.last)) return
        var prior = sub.last
        sub.last = selected
        sub.handler(cloneStateValue(selected), cloneStateValue(prior))
      } catch (e) {
        /* subscriber error — non-fatal */
      }
    })
    this.emit('stateChange', {
      reason: reason || 'transition',
      previous: { status: previous.status, revision: previous.revision },
      current: { status: next.status, revision: next.revision },
    })
    return next
  }

  /** Defensive snapshot of the reactive runtime state. */
  Instance.prototype.getState = function () {
    return cloneStateValue(this._state)
  }

  /** Subscribe to the whole state, or to a selected slice. Returns an
   *  unsubscribe function and immediately delivers the current value. */
  Instance.prototype.subscribe = function (selector, handler) {
    if (typeof selector === 'function' && typeof handler !== 'function') {
      handler = selector
      selector = function (state) { return state }
    }
    if (typeof selector !== 'function' || typeof handler !== 'function') return function () {}
    var sub = { selector: selector, handler: handler, last: selector(this._state) }
    this._subscribers.push(sub)
    try {
      handler(cloneStateValue(sub.last), undefined)
    } catch (e) {
      /* subscriber error — non-fatal */
    }
    var self = this
    return function () {
      var index = self._subscribers.indexOf(sub)
      if (index > -1) self._subscribers.splice(index, 1)
    }
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

  /** URL state is limited to fields declared by filter/search/sort controls.
   *  This prevents arbitrary query-string keys from becoming API inputs. */
  Instance.prototype.urlFields = function () {
    var fields = {}
    this.qa('[wf-xano-filter], [wf-xano-search], [wf-xano-sort]').forEach(function (el) {
      if (el.matches('[wf-xano-element="clear"], [wf-xano-clear]')) return
      var field = el.getAttribute('wf-xano-filter') || el.getAttribute('wf-xano-search')
      if (!field && el.hasAttribute('wf-xano-sort')) field = el.getAttribute('wf-xano-sort') || 'sort'
      if (field) fields[field] = true
    })
    return fields
  }

  /** Read `<prefix>page` / `<prefix><param>` from the query string into state. */
  Instance.prototype.restoreFromUrl = function () {
    var prefix = this.urlPrefix()
    var sp = new URLSearchParams(location.search)
    var self = this
    var allowed = this.urlFields()
    sp.forEach(function (value, name) {
      if (name.indexOf(prefix) !== 0) return
      var field = name.slice(prefix.length)
      if (field === 'page') {
        var p = parseInt(value, 10)
        if (p > 1) self.page = p
      } else if (allowed[field] && value !== '') {
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
    var user = this.userParams()
    var allowed = this.urlFields()
    Object.keys(user).forEach(function (k) {
      if (allowed[k]) sp.set(prefix + k, user[k])
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
    this._hydrating = true
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
        var want = v === '*' ? values.length === 0 : values.indexOf(v) > -1
        if (el.checked !== want) {
          el.checked = want
          // Programmatic checks fire no events, so Webflow's forms JS and
          // page tab scripts never repaint their custom control faces (the
          // Designer-default option keeps w--redirected-checked after a URL
          // restore). Announce the change; our own listener sees _hydrating
          // and skips, so hydration never triggers a re-fetch.
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        return
      }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.value = raw
    })
    this._hydrating = false
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
          if (self._hydrating) return // our own hydrateControls dispatch — state already matches params
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
    var sentinel = this.q(elSel('load-more'))
    if (!sentinel) {
      sentinel = document.createElement('span')
      sentinel.setAttribute('data-wf-xano-sentinel', '')
      sentinel.setAttribute('aria-hidden', 'true')
      sentinel.style.cssText = 'display:block;width:1px;height:1px;pointer-events:none'
      ;(this.listEl || this.template.parentNode).appendChild(sentinel)
      this._infiniteSentinel = sentinel
    }
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
        if (r.top <= window.innerHeight + (self.threshold || 0) && r.bottom >= 0) self.loadNext()
      }
      window.addEventListener('scroll', onScroll, this._ac ? { signal: this._ac.signal } : false)
    }
  }

  /** Append the next page (load-more / infinite). No-op while a load is in
   *  flight or when the last response reported no further pages. */
  Instance.prototype.loadNext = function () {
    if (this._loading || (this._lastResult && !this._lastResult.hasMore)) return
    var previousPage = this.page
    this.page += 1
    this._transition({ query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage } }, 'query:page')
    return this.load({ append: true, previousPage: previousPage })
  }

  /** Set/clear a request param, reset to page 1, reload. */
  Instance.prototype.setParam = function (field, value) {
    // `*` is the match-all sentinel (Webflow's Designer cannot author an
    // EMPTY attribute value, so "All" options carry wf-xano-value="*").
    if (value == null || value === '' || value === '*') delete this.params[field]
    else this.params[field] = value
    this.page = 1
    this._transition({ query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage } }, 'query:param')
    return this.load()
  }

  Instance.prototype.goToPage = function (page) {
    this.page = page
    this._transition({ query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage } }, 'query:page')
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
    this._transition({ query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage } }, 'query:clear')
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
    this.root.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false')
    // is-wf-xano-empty is decided in render()
  }

  Instance.prototype.load = async function (opts) {
    if (!this.ok) return
    var append = !!(opts && opts.append)
    var previousPage = opts && opts.previousPage
    var self = this
    var seq = ++this._seq
    if (this._fetchAc) this._fetchAc.abort()
    this._fetchAc = typeof AbortController === 'function' ? new AbortController() : null
    this._loading = true
    this.setState('loading')
    this._transition(
      {
        status: 'loading',
        query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage },
        error: null,
      },
      'load:start',
    )
    // Replace-mode loads (filter/tab/page change, refresh) clear the previous
    // items AND the empty state NOW, so only the loader shows while the new
    // query is in flight — instead of leaving stale cards (or a resolved "no
    // results" block) visible under the loader until the fetch resolves and
    // render() re-decides. render() re-shows the empty state accurately once
    // the new page lands. Append loads (load-more / infinite / all) keep prior
    // items by design.
    if (!append) {
      var listNow = this.listEl || this.template.parentNode
      qa(listNow, '[wf-xano-item]').forEach(function (c) {
        c.remove()
      })
      showStateEl(this.emptyEl, false)
      this.root.classList.remove('is-wf-xano-empty')
    }
    try {
      var headers = {}
      if (this.auth) headers.Authorization = 'Bearer ' + (await xanoToken())
      var payload = {}
      Object.keys(this.params).forEach(function (k) {
        payload[k] = self.params[k]
      })
      payload.page = this.page
      payload.per_page = this.perPage

      var url = this.url
      var request = { method: this.method, headers: headers, cache: 'no-store' }
      if (this._fetchAc) request.signal = this._fetchAc.signal
      if (this.method === 'GET') {
        var qs = toQuery(payload)
        if (qs) url += (url.indexOf('?') > -1 ? '&' : '?') + qs
      } else {
        headers['Content-Type'] = 'application/json'
        request.body = JSON.stringify(payload)
      }

      var res = await fetch(url, request)
      var data = await res.json().catch(function () {
        return null
      })
      // A newer request started while this one was in flight — drop it.
      if (seq !== this._seq) return
      if (!res.ok) throw Object.assign(new Error('wf-xano ' + res.status), { status: res.status, data: data })

      var result = normalize(data, this.perPage)
      this.page = result.page
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
      var resultItems = cloneStateValue(result.items)
      var storedItems = append ? this._state.data.items.concat(resultItems) : resultItems
      this._transition(
        {
          status: 'success',
          data: {
            items: storedItems,
            total: result.total,
            page: result.page,
            pages: result.pages,
            hasMore: result.hasMore,
          },
          query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage },
          error: null,
        },
        'load:success',
      )
      if (this.urlSync && !append) this.syncUrl()
      this.emit('results', result)
      // `all` mode: keep pulling pages until the source is exhausted.
      if (this.loadMode === 'all' && result.hasMore) this.loadNext()
    } catch (err) {
      if (seq !== this._seq) return
      this._loading = false
      console.error('[wf-xano] load failed', this.source, err)
      this.setState('error')
      if (append) {
        // Keep already-rendered pages and make the failed page retryable.
        this.page = previousPage != null ? previousPage : Math.max(1, this.page - 1)
      } else {
        this.render({ items: [], total: 0, page: 1, pages: 1, hasMore: false })
      }
      this._transition(
        {
          status: 'error',
          data: append ? this._state.data : { items: [], total: 0, page: 1, pages: 1, hasMore: false },
          query: { params: Object.assign({}, this.params), page: this.page, perPage: this.perPage },
          error: publicError(err),
        },
        'load:error',
      )
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
    var appended = []
    result.items.forEach(function (item) {
      var card = self.template.cloneNode(true)
      clearRole(card, 'template')
      card.setAttribute('wf-xano-item', '')
      card.style.display = ''
      if (item && item.id != null) card.setAttribute('data-wf-xano-id', item.id)
      fillCard(card, item)
      wireShowMore(card)
      if (self._infiniteSentinel && self._infiniteSentinel.parentNode === list) {
        list.insertBefore(card, self._infiniteSentinel)
      } else list.appendChild(card)
      appended.push(card)
    })
    // Clamp detection needs layout, so measure a tick after the cards land.
    if (appended.length && q(list, '[wf-xano-element="show-more"]')) {
      setTimeout(function () {
        pruneShowMore(appended)
      }, 0)
    }
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
      el.setAttribute('aria-disabled', more ? 'false' : 'true')
    })
    this.root.classList.toggle('is-wf-xano-exhausted', !more)
  }

  Instance.prototype.renderPagination = function (result) {
    var self = this
    this.qa(elSel('page-prev')).forEach(function (el) {
      var disabled = result.page <= 1
      el.classList.toggle('is-disabled', disabled)
      el.setAttribute('aria-disabled', disabled ? 'true' : 'false')
    })
    this.qa(elSel('page-next')).forEach(function (el) {
      var disabled = result.page >= result.pages
      el.classList.toggle('is-disabled', disabled)
      el.setAttribute('aria-disabled', disabled ? 'true' : 'false')
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

  /** Privacy-safe shadow comparison: stable IDs and aggregate metadata only. */
  Instance.prototype.audit = function () {
    var list = this.template ? this.listEl || this.template.parentNode : this.root
    var domIds = qa(list, '[wf-xano-item]').map(function (el) {
      return String(el.getAttribute('data-wf-xano-id') || '')
    })
    var storeIds = this._state.data.items.map(function (item) {
      return item && item.id != null ? String(item.id) : ''
    })
    var differences = []
    if (JSON.stringify(domIds) !== JSON.stringify(storeIds)) differences.push('item_ids')
    if (this.page !== this._state.query.page) differences.push('page')
    if (JSON.stringify(this.params) !== JSON.stringify(this._state.query.params)) differences.push('params')
    return {
      key: this.key,
      ok: differences.length === 0,
      differences: differences,
      legacy: { itemIds: domIds, page: this.page, paramFields: Object.keys(this.params).sort() },
      store: {
        itemIds: storeIds,
        page: this._state.query.page,
        paramFields: Object.keys(this._state.query.params).sort(),
        status: this._state.status,
        revision: this._state.revision,
      },
    }
  }

  /** Tear down: abort listeners, drop rendered items, unregister. */
  Instance.prototype.destroy = function () {
    this._seq++ // invalidate any in-flight load
    if (this._ac) this._ac.abort()
    if (this._fetchAc) this._fetchAc.abort()
    if (this._io) this._io.disconnect()
    window.clearTimeout(this._searchTimer)
    if (this.template) {
      qa(this.listEl || this.template.parentNode, '[wf-xano-item]').forEach(function (c) {
        c.remove()
      })
    }
    if (this._infiniteSentinel) this._infiniteSentinel.remove()
    this.root.classList.remove('is-wf-xano-loading', 'is-wf-xano-error', 'is-wf-xano-empty')
    this.root.removeAttribute('aria-busy')
    delete this.root.__wfXano
    var i = instances.indexOf(this)
    if (i > -1) instances.splice(i, 1)
    this._transition({ status: 'destroyed' }, 'destroy')
    this._subscribers = []
    this.listeners = {}
  }

  /* ============================ BOOTSTRAP ============================= */
  function init(scope) {
    var root = scope || document
    // Roots: canonical `wrapper`, plus legacy aliases — the bare
    // wf-xano-list marker and v0.3.0's element="list" WITH wf-xano-source
    // (source disambiguates a root from Finsweet-style items containers).
    var sel = ROOT_SEL
    var roots = qa(root, sel)
    if (root.matches && root.matches(sel)) roots.unshift(root)
    roots.forEach(function (el) {
      if (el.__wfXano) return
      if (!el.matches('[wf-xano-element="wrapper"], [wf-xano-wrapper]')) {
        log('deprecated root marker on', el, '— use wf-xano-element="wrapper"')
      }
      var instance = new Instance(el)
      if (instance.ok) instances.push(instance)
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
    initShowMore(document)
    initFavorites(document)
    _pendingCallbacks.splice(0).forEach(runCallback)
  }

  /** Resolve a root, descendant, or instance-keyed external control. */
  function instanceForElement(el) {
    if (!el) return null
    if (el.__wfXano) return el.__wfXano
    var wrapper = el.closest ? el.closest(ROOT_SEL) : null
    if (wrapper && wrapper.__wfXano) return wrapper.__wfXano
    var key = el.getAttribute && el.getAttribute('wf-xano-instance')
    if (!key) return null
    return (
      instances.filter(function (instance) {
        return instance.key === key
      })[0] || null
    )
  }

  // Public API. Replaces the pre-load queue array (GA/Finsweet pattern):
  // callbacks queued before load run after boot; push() after boot runs
  // the callback immediately.
  window.WfXano = {
    version: VERSION,
    instances: instances,
    init: init,
    /** (Re)wire standalone show-more controls (non-list pages, or after another
     *  script binds content). Optional scope; defaults to the whole document. */
    initShowMore: initShowMore,
    favorites: {
      /** Wire favorite controls added by another renderer. */
      init: initFavorites,
      /** Re-fetch one item type (or every type currently on the page). */
      refresh: function (type) {
        if (type) return ensureFavoriteType(type, true)
        var types = {}
        favoriteControls(document).forEach(function (el) {
          var t = favoriteType(el)
          if (t) types[t] = true
        })
        return Promise.all(Object.keys(types).map(function (t) { return ensureFavoriteType(t, true) }))
      },
      /** Read the in-memory IDs for one item type. */
      ids: function (type) {
        return Array.from(_favoriteSets[type] || [])
      },
    },
    /** Queue (pre-boot) or immediately run (post-boot) a callback with the API. */
    push: function (fn) {
      if (typeof fn !== 'function') return
      if (_booted) runCallback(fn)
      else _pendingCallbacks.push(fn)
    },
    /** Refresh all lists, or a specific list root element. */
    refresh: function (root) {
      if (root) {
        var instance = instanceForElement(root)
        return instance ? instance.refresh() : undefined
      }
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
    /** Compare legacy DOM/query projections with the shadow runtime store. */
    audit: function (root) {
      if (root) {
        var instance = instanceForElement(root)
        return instance ? instance.audit() : null
      }
      return instances.map(function (instance) { return instance.audit() })
    },
    /** Destroy all instances (or one root element's instance). */
    destroy: function (root) {
      if (root) {
        var instance = instanceForElement(root)
        return instance ? instance.destroy() : undefined
      }
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
      favoriteId: favoriteId,
      favoriteType: favoriteType,
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
