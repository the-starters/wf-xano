# API reference

For complete page setups before reaching for JavaScript, start with the
[usage guide](usage.md).

wf-xano injects a global `window.WfXano` object. Use the callback queue to run code whether your
script executes before **or** after the library loads (the same pattern as
[Finsweet Attributes](https://github.com/finsweet/attributes)):

```html
<script>
  window.WfXano = window.WfXano || []
  window.WfXano.push(function (wfx) {
    // wfx === window.WfXano, fully booted
    var list = wfx.get('opps')
    list.on('results', function (r) { console.log(r.total) })
  })
</script>
```

## `window.WfXano`

| Member | Description |
| --- | --- |
| `version` | Library version string. |
| `instances` | Array of live [`Instance`](#the-instance-object)s. |
| `push(fn)` | Queue (pre-boot) or immediately run (post-boot) `fn(WfXano)`. |
| `get(key)` | The instance whose `wf-xano-instance` equals `key`, or `null`. |
| `init(scope?)` | Scan `scope` (including the scope element itself; default `document`) and initialize new wrappers. |
| `refresh(rootEl?)` | Re-fetch every list, or just the one owning `rootEl`. |
| `destroy(rootEl?)` | Tear down every list, or just the one owning `rootEl`. |
| `audit(rootEl?)` | Compare legacy DOM/query projections with the reactive store using stable IDs and aggregate metadata only. Returns one report or an array. |
| `favorites.init(scope?)` | Wire favorite controls added by another renderer. A MutationObserver normally does this automatically. |
| `favorites.refresh(type?)` | Re-fetch saved IDs for one type or every type present on the page. |
| `favorites.ids(type)` | Return a copy of the in-memory saved IDs for one type. |

## Configuration

Set `window.WfXanoConfig` **before** the library loads:

```html
<script>
  window.WfXanoConfig = {
    xanoBase: 'https://YOUR-ID.xano.io', // required for group:path sources
    authBase: '…',        // required for authenticated lists: trade-token API group URL
    tradeTokenPath: '…',  // optional: trade-token path (default /auth/trade-token/v3)
    tradeTokenMethod: 'POST', // default; temporary legacy GET opt-in is available
    favoritesSource: 'opp30:brand/favorites', // optional: enables <base>/ids + <base>/toggle
    favoriteIdsSource: '…',    // optional full/group:path override
    favoriteToggleSource: '…', // optional full/group:path override
    preAuth: true,        // pre-warm the trade-token handshake at script parse (default true)
    debug: true,          // console logging (default true)
  }
</script>
```

## The `Instance` object

Each `wf-xano-element="wrapper"` gets an instance, reachable via `WfXano.get(key)`,
`WfXano.instances`, or `listElement.__wfXano`.

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `root` | `Element` | The `wf-xano-element="wrapper"` element. |
| `key` | `string \| null` | The `wf-xano-instance` key. |
| `page` | `number` | Current page. |
| `perPage` | `number` | Page size. |
| `params` | `Object` | Current request params (static + filters + search + sort). |

### Methods

| Method | Description |
| --- | --- |
| `refresh()` | Re-fetch with the current state. Returns a promise. |
| `setParam(field, value)` | Set (or clear, when `''`/`null`) a request param; resets to page 1 and reloads. |
| `goToPage(page)` | Jump to a page and reload. |
| `loadNext()` | Append the next page in `more`, `infinite`, or `all` modes. A failed append preserves prior pages and is retryable. |
| `getParams()` | Return a copy of all current request parameters. |
| `clearParams()` | Restore the static `wf-xano-param-*` baseline and reload page 1. |
| `userParams()` | Return only parameters that differ from the static baseline. |
| `getState()` | Return a defensive snapshot of status, data, query, local, mutation, safe error metadata, and revision. |
| `runAction(control)` | Run one configured `wf-xano-action` control. Duplicate calls for the same action/item share one promise. Resolves `true` after mutation success and declared invalidation, otherwise `false`; invalid configuration rejects. |
| `subscribe(handler)` | Subscribe to the complete state; immediately receives the current snapshot. Returns an unsubscribe function. |
| `subscribe(selector, handler)` | Subscribe to a selected state slice. The handler runs only when the selected value changes by identity. Returns an unsubscribe function. |
| `audit()` | Return a privacy-safe comparison of rendered stable IDs/query metadata against the store projection. |
| `on(event, handler)` | Subscribe — see [events](#events). Returns the instance. |
| `off(event, handler)` | Unsubscribe. |
| `destroy()` | Remove listeners and rendered items, unregister the instance. |

### Events

| Event | Payload | Description |
| --- | --- | --- |
| `results` | `{ items, total, page, pages, hasMore }` | After a successful render. Late subscribers immediately receive the last result. |
| `error` | `Error` | After a failed request. |
| `beforeRender` | `(items, result)` | **Transform hook** — runs between fetch and render. Return a replacement items array (sync or async) to filter, augment, or reorder what renders. |
| `stateChange` | `{ reason, previous: { status, revision }, current: { status, revision } }` | Privacy-safe metadata after a store transition. Use `subscribe` when the state value itself is needed. |
| `actionStart` | `{ action, key, itemId }` | One accepted action entered its pending state. |
| `actionSuccess` | `{ action, key, itemId, status }` | Xano accepted the mutation. Response bodies and auth data are excluded. |
| `actionError` | `{ action, key, itemId, error: { name, status? } }` | Mutation failed with safe error metadata; raw messages and response bodies are excluded. |

```js
// Example: client-side augmentation before render
instance.on('beforeRender', async (items) => {
  const applied = await fetchAppliedIds()
  return items.map((item) => ({ ...item, applied: applied.has(item.id) }))
})
// …then use wf-xano-if="applied" in the card template.
```

### Reactive state (v0.19)

The store is an observable projection of Xano-backed list state. Xano remains authoritative; changing
a snapshot returned by `getState()` never changes the instance or sends a request.

```js
var unsubscribe = instance.subscribe(
  function (state) { return state.status },
  function (status) {
    console.log('list status:', status)
  }
)

var snapshot = instance.getState()
console.log(snapshot.data.total, snapshot.query.params)

// Later, for example during page teardown:
unsubscribe()
```

State shape:

```js
{
  status: 'idle' | 'loading' | 'success' | 'error' | 'destroyed',
  data: { items: [], total: 0, page: 1, pages: 1, hasMore: false },
  query: { params: {}, page: 1, perPage: 20 },
  local: {},
  mutation: {},
  error: null | { name: 'Error', status: 500 },
  revision: 0
}
```

The state error intentionally excludes server response bodies, authentication values, and raw error
messages. The existing `error` event still receives the original `Error` for compatibility.

### Read-only DOM projections (v0.20)

State can be projected into Webflow-authored elements without page-specific JavaScript:

```html
<span wf-xano-state="data.total" wf-xano-prefix="Total: ">0</span>
<div wf-xano-if-state="status === 'loading'">Loading…</div>
<section wf-xano-class-state="has-results:data.total > 0"></section>
```

The attributes are opt-in, scoped to their wrapper or `wf-xano-instance`, and updated in one
batched pass per transition group. Expressions reuse the non-evaluating `wf-xano-if` parser. See
the [attribute reference](attributes.md#reactive-state-projections) for the complete grammar.

### Actions and reconciliation (v0.21–v0.22)

`runAction(control)` and `wf-xano-action` provide an opt-in mutation state machine. Payloads are
limited to explicitly declared scalar item fields, marked controls in the closest form, and authored
literals. The endpoint and method are static configuration. While pending, duplicate action/item
calls share one request; after success, `self` or named instances refresh from Xano.

```js
instance.subscribe(
  function (state) { return state.mutation['archive:42'] },
  function (mutation) { console.log(mutation && mutation.status) }
)
```

Mutation entries contain only `{ status, action, itemId, error }`; no response body or credential is
stored. Account switches and teardown abort active requests. See the
[action attribute contract](attributes.md#pessimistic-actions) for payload and invalidation grammar.

In v0.22, wrappers may opt into stable-key DOM reconciliation. Actions on those lists may opt into
a one-field optimistic overlay only when they declare the matching `item:<field>` rollback source.
Full authoritative item responses reconcile directly; partial responses use the existing
invalidation path. Public action events remain metadata-only and never expose response bodies. See
[keyed reconciliation and optimistic actions](attributes.md#keyed-reconciliation-and-optimistic-actions-v022).

### Favorite DOM events

The module dispatches document-level `CustomEvent`s so page analytics or UI code can react without
coupling wf-xano to another SDK:

| Event | `detail` | When |
| --- | --- | --- |
| `wf-xano:favorite` | `{ item_type, item_id, favorited }` | Authoritative toggle success |
| `wf-xano:favorite-error` | `{ item_type, item_id, status }` | Hydration or toggle failure; excludes response bodies and auth data |

## Authentication

With `wf-xano-auth="memberstack"` (the default), the library:

1. Reads the Memberstack JWT via `window.$memberstackDom.getMemberCookie()`.
2. Sends it in a no-store `POST` JSON body to `authBase + tradeTokenPath` and receives a Xano token.
3. Sends `Authorization: Bearer <token>` on every list request.

The token is cached in memory and automatically discarded whenever the live Memberstack session
cookie changes, including account switches and JWT rotation.

When that session changes, every authenticated list immediately clears its rendered rows and
reactive snapshot, cancels any superseded request, and reloads through the new shared token. This
prevents another account's rows from remaining visible or drifting from `getState()`.

The handshake is optimized for cold boot (since v0.5.0):

- The live session cookie fingerprint is the authoritative cache key. No member-profile lookup or
  local-storage identity is required, so neither can gate or mis-key the token trade.
- The trade starts at script-parse time (`preAuth`, default on) instead of at the first list
  request, so its round-trip overlaps DOM-ready work. Set `WfXanoConfig.preAuth = false` on pages
  where every list is `wf-xano-auth="none"`.

Requires the [memberstack-x](https://www.memberstack.com/) script to be loaded first, and a Xano
endpoint that exchanges a Memberstack JWT for a Xano auth token — the
[Prompt Library](https://the-starters.github.io/wf-xano/prompts/#x3) has a prompt and checklist for
building that endpoint.

### Migration from v0.16

Update the trade-token endpoint to accept `{ "token": "…" }` in a POST body and set `authBase`
explicitly. During a staged backend migration only, `tradeTokenMethod: "GET"` retains the legacy
query-string contract. Authenticated HTTP endpoints are rejected; local development can explicitly
set `allowInsecureAuth: true`.
