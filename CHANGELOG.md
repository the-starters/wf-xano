# Changelog

## v0.8.0 — 2026-07-06

### Added — boundary + ellipsis pagination

- **`wf-xano-element="page-dots"`** — optional ellipsis template, cloned into the gaps between
  the pinned boundary pages and the current-page window (`1 2 … 7 8 9 … 24 25`). Clones get
  `wf-xano-page-dot`. Absent template = gaps are skipped (unchanged behavior for existing markup).
- **`wf-xano-page-boundary`** (default `1`) — pages pinned at each edge; pairs with the existing
  `wf-xano-page-window` (Finsweet boundary/siblings/dots model).
- Numbered pagination is now a pure `paginationModel(current, total, window, boundary)` helper
  (exposed on `_internal` for testing).

**Note:** the true last page is only known when the endpoint returns `itemsTotal`/`pageTotal`.
Xano paged lists that only emit `nextPage` limit the display to `current … next`.

## v0.7.1 — 2026-07-06

### Added

- **`wf-xano-format="short-name"`** — abbreviates every word after the first:
  `John Paul Dionisio` → `John P. D.`. Part of the shared format vocabulary with
  the wf-algolia fork and quiz-results.js (v1.3.29), so the same value works on
  every renderer.

## v0.7.0 — 2026-07-03

### Added — Prompt Library

- **[Prompt Library](https://the-starters.github.io/wf-xano/prompts/)** (`prompts/index.html`) —
  a copy-paste library for standing up both halves of a wf-xano list:
  - **Xano backend** (X1–X3): AI prompts (for Xano's AI builder / ChatGPT / Claude) *and* manual
    checklists for the tables, the paged list endpoint (the
    `items / itemsTotal / curPage / pageTotal / nextPage` contract), and the Memberstack
    trade-token auth endpoint with `$auth` member scoping.
  - **Webflow markup** (W1–W3): attribute-complete HTML snippets for Embed elements, AI prompts
    for building native Designer elements, and **experimental "Copy for Webflow" buttons** that
    put native elements (with classes and `wf-xano-*` attributes) on the clipboard as
    `@webflow/XscpData` for direct pasting into the Designer.
  - **Recipes** (R1–R2): member-scoped job board end-to-end (with a combined Xano mega-prompt)
    and a public read-only variant.
  - A "Your project" bar substitutes your Xano base URL / API group / auth group into everything
    you copy (stored in localStorage; unfilled fields copy through as `{{TOKEN}}` placeholders).
- `prompts/inspector.html` — maintainer tool that dumps the Designer's `application/json`
  clipboard payload, for re-capturing the Copy-for-Webflow structures from a real project.
- Test suite for the library's assets (`test/prompt-library.test.mjs`): XscpData payload validity
  (envelope, id/reference integrity, required `wf-xano-*` xattrs), snippet grammar, button wiring,
  token whitelist, and copy behavior.

## v0.6.1 — 2026-07-03

### Added

- **`wf-xano-value="*"` match-all sentinel** — "All" filter options use `*` instead of an empty
  value, because Webflow's Designer cannot author an empty attribute value. `*` clears the field
  everywhere a value is read (click filters, radios, checkboxes, selects, `setParam`), and the
  control shows as active/checked exactly when no value is set.

## v0.6.0 — 2026-07-03

### Added — filtering parity with Finsweet / wf-algolia

- **Click filters** — `wf-xano-filter="field"` + `wf-xano-value` on any non-form element
  (tabs, buttons, links). Empty value = the "All" option (clears the param);
  `wf-xano-toggle="true"` opts into click-again-to-clear.
- **`is-active` state class** on click filters and on checked checkbox/radio filter labels.
- **`wf-xano-element="clear"`** — clears all user filters (static `wf-xano-param-*` kept), or
  one field when combined with `wf-xano-filter="field"` (Finsweet's `clear`).
- **Filter tags** — `wf-xano-element="tag"` template with `tag-field`/`tag-value`/`tag-remove`
  children (Finsweet's tag grammar); one chip per active filter value, removal updates the group.
- **Full control hydration** — URL restore and clears now also (un)check checkbox/radio filters
  and refresh `is-active` state, so controls never drift from param state.
- **JS API** — `instance.getParams()` and `instance.clearParams()` (wf-algolia's
  `getFilterState`/`clearAllFilters` equivalents).

## v0.5.0 — 2026-07-03

### Changed

- **Parallel cold-boot auth** — the Memberstack → Xano handshake no longer serializes
  `getCurrentMember()` (~500ms network) → `getMemberCookie()` + trade-token (~240ms) → first list
  request. Benchmarked 2026-07-03: this chain made wf-xano first render ~1.5s vs wf-algolia's
  ~250–400ms. Now:
  - The member id is read **synchronously from Memberstack's localStorage cache**
    (`_ms-mid` / `_ms-mem`); `getCurrentMember()` is only a fallback and runs **concurrently**
    with the cookie → token trade instead of gating it.
  - The trade-token handshake is **pre-warmed at script-parse time** (when memberstack-x has
    already loaded, per the documented script order), so the round-trip overlaps DOM-ready work
    instead of the first list request. Opt out with `WfXanoConfig.preAuth = false`.
  - **Account-switch semantics unchanged**: the cached token is still dropped whenever the member
    id no longer matches the one it was traded under; the id is only a cache key — the token
    always derives from the live session cookie. A failed trade no longer needs a page reload to
    retry (the rejected handshake is not cached).

### Added

- `WfXanoConfig.preAuth` (default `true`) — disable the parse-time token pre-warm on pages where
  every list is `wf-xano-auth="none"`.

## v0.4.0 — 2026-07-03

### Changed

- **Finsweet-aligned role names** — the scope root is now `wf-xano-element="wrapper"`
  (Finsweet's `wrapper`), and `wf-xano-element="list"` becomes what Finsweet means by `list`:
  the optional items container where rendered cards are appended (defaults to the template's
  parent, as before). v0.3.0 briefly used `list` for the root, which clashed with the Finsweet
  grammar (their `list` ≈ wf-algolia's `results`).
- **Aliases kept, no breaking change** — the bare `wf-xano-list` marker and v0.3.0's
  `element="list"` + `wf-xano-source` on the same element still initialize as a root
  (a debug-log deprecation notice is emitted).

## v0.3.0 — 2026-07-02

### Changed

- **Canonical key=value role markers** — structural roles are now declared with
  `wf-xano-element="<name>"` (`list`, `template`, `empty`, `loader`, `error`, `page-prev`,
  `page-number`, `page-next`, `total`, `count-from`, `count-to`), matching Finsweet's
  `fs-list-element` / wf-algolia's `wf-algolia-element` grammar. Motivation: Webflow's Designer
  strips custom attributes that have no value, which silently broke valueless markers.
  **Legacy valueless markers remain supported as aliases** — no breaking change.

### Fixed

- **Instance-scoped comma selectors** — with an instance key, scoping is now applied to every
  branch of a comma-separated selector (previously only the last branch was scoped, so e.g.
  URL-sync control hydration could match another instance's controls outside the root).

## v0.2.1 — 2026-07-02

### Added

- **`wf-xano-display` on state elements** — `wf-xano-empty`, `wf-xano-loader`, and `wf-xano-error`
  now honor `wf-xano-display` for their shown value (wf-algolia parity: markup like
  `<div wf-xano-loader wf-xano-display="flex">` works unchanged when the element's own class hides
  it). Default still clears the inline style.
- **Test suite in-repo** — `npm test` runs the full jsdom suite (`test/wf-xano.test.mjs`, 14 groups).

## v0.2.0 — 2026-07-02

API patterns aligned with [Finsweet Attributes](https://github.com/finsweet/attributes) conventions.

### Added

- **Pre-load callback queue** — `window.WfXano = window.WfXano || []; WfXano.push(fn)` runs code
  whether it loads before or after the library.
- **Instance keys** — `wf-xano-instance="key"` lets counts, filters, search, sort, and pagination
  live outside the list wrapper; `WfXano.get(key)` resolves an instance by key.
- **Checkbox filter groups** — checkboxes sharing a `wf-xano-filter` field combine checked values
  into a comma-separated param; `wf-xano-value` supplies real values (Webflow checkboxes submit `on`).
- **URL sync** — `wf-xano-url-sync="true"` writes page + params to the query string
  (`<key>_page`, `<key>_<param>`), restores them on load, and hydrates simple controls.
- **`beforeRender` hook** — async transform hook that can filter/augment/reorder items before render.
- **State CSS classes** — `is-wf-xano-loading` / `is-wf-xano-error` / `is-wf-xano-empty` on the root.
- **Visible-range counts** — `wf-xano-count-from` / `wf-xano-count-to` ("Showing 9–12 of 45").
- `wf-xano-debounce` (root or per-input), renameable sort param (`wf-xano-sort="sort_by"`),
  `aria-current="page"` on the active page button, results replay for late `on('results')`
  subscribers, `off()`, per-instance and global `destroy()`.

### Fixed

- **Request race** — overlapping loads (debounced search + filter clicks) are sequenced; a stale
  out-of-order response can no longer render over the newest one.
- **Root-element binds** — `wf-xano-bind` / `wf-xano-if` / `wf-xano-src` now work on the template
  root element, not only descendants.
- A list with missing template no longer registers a broken instance.
- Trade-token responses with an empty body no longer throw.
- FOUC guard: raw templates are hidden by injected CSS before boot.
- `normalize` derives total pages when Xano omits `pageTotal` (and honors `nextPage`).

## v0.1.0 — 2026-07-02

Initial release, extracted from the binder proven in The Starters' Opportunities 3.0 build:
attribute-driven list rendering from Xano endpoints (`wf-xano-list/-source/-template/-bind/-if/
-link/-empty/-loader/-error/-total`, pagination, filters/search/sort, static params), Memberstack →
Xano trade-token auth with member-change reset, `cache: 'no-store'` freshness.
