# Usage guide

This guide covers the shortest path from a Xano endpoint to a working Webflow list. For every
available setting, see the [attribute reference](attributes.md); for JavaScript hooks, see the
[API reference](api.md).

## 1. Choose the list type

- Use **public** lists for data anyone may read. Add `wf-xano-auth="none"` and set `preAuth: false`.
- Use **authenticated** lists for member-scoped or private data. Load Memberstack first, configure
  `authBase`, and leave the wrapper's default `wf-xano-auth="memberstack"` behavior in place.

Never place a private Xano token or another service's secret in Webflow code. The browser should
only receive the signed-in member's short-lived Xano auth token.

## 2. Return a paged response from Xano

The most useful response shape is:

```json
{
  "items": [{ "id": 101, "title": "Senior designer", "status": "Active" }],
  "itemsTotal": 27,
  "curPage": 1,
  "pageTotal": 3,
  "nextPage": 2
}
```

`items` is required. Include `itemsTotal` or `pageTotal` for true numbered pagination. Load-more
and infinite lists can work with `nextPage` alone. Raw arrays and a single object are also accepted,
but they cannot describe full pagination state.

## 3. Public list

Load the library once, before `</body>`:

```html
<script>
  window.WfXanoConfig = {
    xanoBase: 'https://YOUR-ID.xano.io',
    preAuth: false
  }
</script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/wf-xano@latest/wf-xano.min.js"></script>
```

Then build the list in Webflow:

```html
<div
  wf-xano-element="wrapper"
  wf-xano-source="public:opportunities/list"
  wf-xano-auth="none"
  wf-xano-per-page="12"
>
  <div wf-xano-element="list">
    <a wf-xano-element="template" wf-xano-link="id" wf-xano-link-prefix="/opportunity?id=">
      <h3 wf-xano-bind="title" wf-xano-default="Untitled"></h3>
      <span wf-xano-bind="status"></span>
    </a>
  </div>
  <div wf-xano-element="loader">Loading…</div>
  <div wf-xano-element="empty">No opportunities found.</div>
  <div wf-xano-element="error">The list could not be loaded.</div>
</div>
```

`public:opportunities/list` resolves to
`https://YOUR-ID.xano.io/api:public/opportunities/list`. A full HTTPS endpoint URL also works.

## 4. Authenticated Memberstack list

Load `memberstack-x` first and configure both bases:

```html
<script src="https://static.memberstack.com/scripts/v1/memberstack.js" data-memberstack-app="YOUR_APP_ID"></script>
<script>
  window.WfXanoConfig = {
    xanoBase: 'https://YOUR-ID.xano.io',
    authBase: 'https://YOUR-ID.xano.io/api:YOUR-AUTH-GROUP'
  }
</script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/wf-xano@latest/wf-xano.min.js"></script>
```

The wrapper needs no auth attribute because `memberstack` is the default:

```html
<div wf-xano-element="wrapper" wf-xano-source="dashboard:member/projects/list">
  <article wf-xano-element="template">
    <h3 wf-xano-bind="name"></h3>
    <time wf-xano-bind="created_at" wf-xano-format="date-medium"></time>
  </article>
  <div wf-xano-element="loader">Loading your projects…</div>
  <div wf-xano-element="empty">You have no projects yet.</div>
  <div wf-xano-element="error">Your projects could not be loaded.</div>
</div>
```

The browser sends `{ "token": "MEMBERSTACK_JWT" }` to
`POST {authBase}/auth/trade-token/v3`. That endpoint should validate the JWT and return a Xano auth
token. wf-xano then sends `Authorization: Bearer …` to the list endpoint. See the runnable
[authenticated example](../examples/authenticated-list.html).

## 5. Filters and loading

Controls may live inside the wrapper. To place them elsewhere, give the wrapper and each outside
control the same `wf-xano-instance` value:

```html
<input wf-xano-search="q" wf-xano-instance="projects" placeholder="Search projects">
<select wf-xano-filter="status" wf-xano-instance="projects">
  <option value="">All statuses</option>
  <option value="Active">Active</option>
</select>

<div
  wf-xano-element="wrapper"
  wf-xano-instance="projects"
  wf-xano-source="dashboard:member/projects/list"
  wf-xano-load="more"
>
  <article wf-xano-element="template"><h3 wf-xano-bind="name"></h3></article>
  <button type="button" wf-xano-element="load-more">Load more</button>
</div>
```

Loading modes are `pagination` (default), `more`, `infinite`, and `all`. Any filter, search, or sort
change resets append modes to page 1 so results cannot mix across different queries.

## 6. Favorites across wf-algolia and wf-xano

Configure the authenticated favorites base:

```html
<script>
  window.WfXanoConfig = {
    xanoBase: 'https://YOUR-ID.xano.io',
    authBase: 'https://YOUR-ID.xano.io/api:YOUR-AUTH-GROUP',
    favoritesSource: 'opp30:brand/favorites'
  }
</script>
```

Add the same favorite control inside either renderer's card. wf-xano cards expose
`data-wf-xano-id`; compatible wf-algolia cards expose `data-wf-algolia-hit-objectid`:

```html
<button type="button" wf-xano-element="favorite" wf-xano-favorite-type="starter"
  wf-xano-favorite-label-add="Save Starter"
  wf-xano-favorite-label-remove="Remove saved Starter">
</button>
```

For a Saved list, return hydrated rows whose `id` is the same canonical identifier used by the
toggle, then add `wf-xano-refresh-on="favorite"`:

```html
<div wf-xano-element="wrapper" wf-xano-instance="saved-starters"
  wf-xano-source="opp30:brand/favorites/starters/list"
  wf-xano-refresh-on="favorite" wf-xano-favorite-type="starter">
  <article wf-xano-element="template">…same favorite button…</article>
</div>
```

The Xano endpoints must derive identity from auth, validate allowed item types/IDs, and enforce a
unique member/type/item constraint. Never accept a member or Brand ID from the browser.

## 7. Production checklist

1. Confirm the endpoint returns the expected paged shape and enforces authorization server-side.
2. Use explicit HTTPS `xanoBase` and, for authenticated pages, `authBase` values.
3. Put secrets and third-party API calls behind Xano; never embed them in Webflow.
4. Add visible loader, empty, and error elements. wf-xano also maintains `aria-busy` and alert state.
5. Test logged out, logged in, account switching, empty results, endpoint failure, and pagination.
6. Pin a version for deterministic deployments, or use `@latest` only with a controlled release
   and cache-purge process.
7. Check the browser console and Network panel for failed requests and accidental secret exposure.

## Troubleshooting

- **`authBase is required`**: configure the trade-token API group, or mark a truly public wrapper
  with `wf-xano-auth="none"`.
- **401/403**: confirm Memberstack is loaded before wf-xano and that the trade endpoint accepts a
  POST JSON body containing `token`.
- **No numbered last page**: return `itemsTotal` or `pageTotal`, or use `more`/`infinite` loading.
- **Controls affect the wrong list**: use distinct `wf-xano-instance` keys on wrappers and outside
  controls.
- **A list added by another script does not start**: call `WfXano.init(container)` after inserting it.
