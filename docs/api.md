# API reference

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
| `init(scope?)` | Scan `scope` (default `document`) and init any new `[wf-xano-list]`s — for dynamically added markup. |
| `refresh(rootEl?)` | Re-fetch every list, or just the one owning `rootEl`. |
| `destroy(rootEl?)` | Tear down every list, or just the one owning `rootEl`. |

## Configuration

Set `window.WfXanoConfig` **before** the library loads:

```html
<script>
  window.WfXanoConfig = {
    xanoBase: 'https://YOUR-ID.xano.io', // Xano host used by group:path sources
    authBase: '…',        // optional: API group URL for the trade-token endpoint
    tradeTokenPath: '…',  // optional: trade-token path (default /auth/trade-token/v3)
    preAuth: true,        // pre-warm the trade-token handshake at script parse (default true)
    debug: true,          // console logging (default true)
  }
</script>
```

## The `Instance` object

Each `[wf-xano-list]` element gets an instance, reachable via `WfXano.get(key)`,
`WfXano.instances`, or `listElement.__wfXano`.

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `root` | `Element` | The `[wf-xano-list]` element. |
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
| `on(event, handler)` | Subscribe — see [events](#events). Returns the instance. |
| `off(event, handler)` | Unsubscribe. |
| `destroy()` | Remove listeners and rendered items, unregister the instance. |

### Events

| Event | Payload | Description |
| --- | --- | --- |
| `results` | `{ items, total, page, pages }` | After a successful render. Late subscribers immediately receive the last result. |
| `error` | `Error` | After a failed request. |
| `beforeRender` | `(items, result)` | **Transform hook** — runs between fetch and render. Return a replacement items array (sync or async) to filter, augment, or reorder what renders. |

```js
// Example: client-side augmentation before render
instance.on('beforeRender', async (items) => {
  const applied = await fetchAppliedIds()
  return items.map((item) => ({ ...item, applied: applied.has(item.id) }))
})
// …then use wf-xano-if="applied" in the card template.
```

## Authentication

With `wf-xano-auth="memberstack"` (the default), the library:

1. Reads the Memberstack JWT via `window.$memberstackDom.getMemberCookie()`.
2. Trades it for a Xano auth token at `authBase + tradeTokenPath`.
3. Sends `Authorization: Bearer <token>` on every list request.

The token is cached for the session and **automatically discarded when the logged-in Memberstack
member changes**, so a switched account can never inherit the previous member's data.

The handshake is optimized for cold boot (since v0.5.0):

- The member id used as the token's cache key is read synchronously from Memberstack's own
  localStorage cache (`_ms-mid` / `_ms-mem`); the `getCurrentMember()` network call is only a
  fallback and runs **in parallel** with the token trade rather than before it. The id is purely
  a cache key — the traded token always derives from the live session cookie, so it can never
  belong to a different member than the current session.
- The trade starts at script-parse time (`preAuth`, default on) instead of at the first list
  request, so its round-trip overlaps DOM-ready work. Set `WfXanoConfig.preAuth = false` on pages
  where every list is `wf-xano-auth="none"`.

Requires the [memberstack-x](https://www.memberstack.com/) script to be loaded first, and a Xano
endpoint that exchanges a Memberstack JWT for a Xano auth token — the
[Prompt Library](https://the-starters.github.io/wf-xano/prompts/#x3) has a prompt and checklist for
building that endpoint.
