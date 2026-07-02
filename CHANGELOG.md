# Changelog

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
