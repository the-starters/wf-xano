# wf-xano

**Declarative Xano list binder for Webflow.** Render lists straight from your
[Xano](https://www.xano.com/) endpoints using HTML attributes — no code, no stale data.

Built for **state-heavy**, authoritative, member-scoped lists: a brand's own posts, applicant
tables, dashboards, admin/back-office queues. The complement to search libraries like
[wf-algolia](https://github.com/the-starters/wf-algolia), which stay the right tool for
**search-heavy** public browse.

```html
<div wf-xano-element="wrapper" wf-xano-source="opp30:brand/opportunities/list">
  <a wf-xano-element="template" wf-xano-link="id" wf-xano-link-prefix="/opportunities/">
    <h3 wf-xano-bind="title"></h3>
    <p wf-xano-bind="description"></p>
    <span wf-xano-if="status === 'Active'">Live</span>
  </a>
  <div wf-xano-element="empty">No opportunities yet.</div>
  <div wf-xano-element="loader">Loading…</div>
</div>
```

Structural roles use `wf-xano-element="<name>"` (key=value, since v0.3.0) because Webflow's
Designer strips valueless custom attributes. Role names follow Finsweet's `fs-list-element`
vocabulary (since v0.4.0): `wrapper` is the scope root, `list` optionally marks the items
container. The legacy `wf-xano-list`/`wf-xano-template`/… markers and v0.3.0's
`element="list"`-as-root (with `wf-xano-source`) still work as aliases.

`wf-xano-element="total"` renders the paged query's `itemsTotal`; add `wf-xano-field="<path>"`
(since v0.25.0) to render any other field from the raw response body instead — for server-computed
stats returned alongside the list (e.g. `available_matching_total`).

`wf-xano-element="delete"` (since v0.24.0) marks Designer placeholder elements for removal: they
are hidden by the FOUC guard and removed from the DOM at boot, anywhere on the page. Use it on the
duplicate static cards kept next to a template for visual editing, instead of deleting them by hand
before every publish.

## When to use which

| | **wf-xano** | search library (e.g. wf-algolia) |
| --- | --- | --- |
| Best for | **state-heavy** lists | **search-heavy** browse |
| Data source | a Xano endpoint (authoritative) | a search index |
| Examples | your own posts, applicants, admin tables, review queues | public browse, typeahead, facets |
| Freshness | always fresh (`no-store`, direct DB read) | eventual (indexing lag + cache) |
| Filtering | server-side (request params) | client-side (index facets) |

They're complementary: reach for wf-xano when correctness, freshness, and member-scoping matter.

## See it live

- **[Examples](https://the-starters.github.io/wf-xano/examples/)** — self-contained demos with a
  mocked backend (no Xano account needed).
- **[Prompt Library](https://the-starters.github.io/wf-xano/prompts/)** — AI prompts, checklists
  & paste-ready Webflow components.
- **In production** — the brand opportunities feed on The Starters' Opportunities 3.0 platform
  ([`/opportunities-brands-view`](https://the-starters-3-0.webflow.io/opportunities-brands-view) —
  auth-scoped list over `brand/opportunities/list` with filters, pagination and status pills;
  behind a site password until 3.0 launches on
  [hirethestarters.com](https://www.hirethestarters.com)). The same page runs
  [wf-algolia](https://github.com/the-starters/wf-algolia) for its navbar search — the two
  libraries coexisting as designed.

## Getting started

Add to your page's custom code, **after** `memberstack-x` (only needed when using auth):

```html
<script>
  window.WfXanoConfig = {
    xanoBase: 'https://YOUR-ID.xano.io',
    authBase: 'https://YOUR-ID.xano.io/api:YOUR-AUTH-GROUP'
  }
</script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/wf-xano@latest/wf-xano.min.js"></script>
```

Then add attributes in the Webflow Designer. That's it — the list renders on load.
Public lists using `wf-xano-auth="none"` do not need `authBase`.

Setting up from scratch? The **[Prompt Library](https://the-starters.github.io/wf-xano/prompts/)**
has copy-paste AI prompts and checklists for the Xano side (tables, paged endpoint, auth) and
ready-made Webflow structures (Embed snippets, native paste-into-Designer components).

- **[Attribute reference →](docs/attributes.md)** every element and setting
- **[Usage guide →](docs/usage.md)** complete public + authenticated setups, response shape,
  loading modes, and a production checklist
- **[API reference →](docs/api.md)** the `window.WfXano` object, events, hooks, auth
- **[Examples →](examples/index.html)** self-contained demos with a mocked backend
  ([live](https://the-starters.github.io/wf-xano/examples/))
- **[Prompt Library →](prompts/index.html)** AI prompts, checklists & Webflow components
  ([live](https://the-starters.github.io/wf-xano/prompts/))

## Highlights

- **Always fresh** — every request uses `cache: 'no-store'`; Xano is the source of truth.
- **Race-safe** — overlapping requests are sequenced; a stale response never renders over a newer one.
- **Auth built in** — Memberstack JWT → Xano trade-token over a no-store POST body, cached and
  reset whenever the live session cookie changes.
- **Full list UI from attributes** — binds (dot paths, date + name formatting), conditionals, links,
  empty/loader/error states, totals + visible ranges, numbered pagination, filters (incl. checkbox
  groups), debounced search, sort.
- **Designer-friendly** — instance keys let counts and controls live anywhere on the page; state
  classes (`is-wf-xano-loading/error/empty`) are styleable in Webflow; opt-in reactive text,
  visibility, and class projections bind the v0.20 store without page scripts; templates are FOUC-guarded.
- **Deep-linkable** — opt-in URL sync keeps page + filters in the query string and restores them.
- **Mutation-safe** — opt-in v0.21 actions use allowlisted payload bindings, pessimistic busy/error
  state, duplicate-write suppression, and Xano-authoritative refresh.
- **React-like where it helps** — v0.22 keyed lists update/move stable cards in place, and explicitly
  reversible actions may apply an optimistic overlay before converging on Xano.
- **Declarative forms** — v0.23 form controllers expose dirty/touched and submit/error state,
  serialize only marked fields, project Xano validation, and protect against duplicate submits.
- **Scriptable** — pre-load callback queue, `results`/`error` events, an async `beforeRender`
  transform hook to filter/augment items before render, and an observable reactive store
  (`getState`/`subscribe`, since v0.19).
- **Zero dependencies** — one small file, plain JS, no build step required.
- **Cross-renderer favorites** — authenticated optimistic save controls work inside both wf-xano
  and wf-algolia cards, with duplicate-card synchronization and authoritative Xano state.

## JavaScript API (quick look)

```html
<script>
  window.WfXano = window.WfXano || []
  window.WfXano.push(function (wfx) {
    var list = wfx.get('opps') // by wf-xano-instance key
    list.on('results', function (r) { console.log(r.total) })
    list.on('beforeRender', function (items) {
      return items.filter(function (i) { return i.status !== 'Draft' })
    })
  })
</script>
```

Full reference: **[docs/api.md](docs/api.md)**.

## Versioning

Releases are tagged (`v0.2.0`, …) and served via jsDelivr:

| URL | Behavior |
| --- | --- |
| `…/gh/the-starters/wf-xano@0.23.0/wf-xano.min.js` | pinned — deterministic released build |
| `…/gh/the-starters/wf-xano@0.23/wf-xano.min.js` | latest released patch of 0.23 |
| `…/gh/the-starters/wf-xano@latest/wf-xano.min.js` | latest release (purge jsDelivr after releasing) |

`wf-xano.js` (readable) and `wf-xano.min.js` (minified) are both published.

## Extending wf-xano

**Design rule: don't invent new conventions — port them.** When a feature is missing, copy the
pattern *and the attribute-naming system* from the established Webflow libraries, in this order:

1. **[Finsweet Attributes](https://github.com/finsweet/attributes)** — the de-facto standard grammar
   Webflow designers already know. Mirror their element/setting split, naming style, state classes,
   value overrides, hooks, and API conventions. Their
   [`list` package constants](https://github.com/finsweet/attributes/blob/master/packages/list/src/utils/constants.ts)
   are the richest catalog of list features worth porting (load-more/infinite modes, page
   siblings/boundary/dots, scroll anchors, filter tags, condition groups…).
2. **[wf-algolia](https://github.com/the-starters/wf-algolia)** — the grammar wf-xano
   already mirrors (The Starters' fork of `@candid-leap/wf-algolia`). Keep feature parity where it
   makes sense, so migrating a feed between the two stays a mechanical attribute rename (see the
   [brand-view example](https://the-starters.github.io/wf-xano/examples/opportunities-brand-view.html)).

Matching known conventions keeps the learning curve at zero and migrations table-driven; a third
dialect helps no one.

## Credits

The attribute-grammar approach — and several API patterns (pre-load callback queue, instance keys,
state classes, item hooks, checkbox `-value` overrides) — follow the conventions popularized by
[Finsweet Attributes](https://finsweet.com/attributes). Extracted from the list binder built for
The Starters' Opportunities 3.0 platform.

## License

[MIT](LICENSE) © The Starters
