# Attribute reference

Everything wf-xano does is driven by HTML attributes — no code required. This page follows the
element/setting split used by [Finsweet Attributes](https://finsweet.com/attributes): **Elements**
define *what a node is*, **Settings** tune *how it behaves*.

New to wf-xano? Start with the [usage guide](usage.md) for complete public and authenticated
examples, then use this page as the exhaustive reference.

- [Elements](#elements)
- [Settings](#settings)
- [Scoping & instance keys](#scoping--instance-keys)
- [Requests](#requests)

> Setting up a page (or the Xano side) from scratch? The
> [Prompt Library](https://the-starters.github.io/wf-xano/prompts/) has ready-made structures and
> prompts using every attribute below.

## Elements

Structural roles use one key=value attribute: **`wf-xano-element="<name>"`** (like Finsweet's
`fs-list-element`). Key=value is the canonical form because Webflow's Designer strips custom
attributes that have no value. The legacy valueless markers (`wf-xano-list`, `wf-xano-template`, …)
remain supported as aliases.

### List

| Attribute | Required | Applies to | Description |
| --- | --- | --- | --- |
| `wf-xano-element="wrapper"` | ✅ | the outer wrapper | Marks the list root/scope (Finsweet's `wrapper`). Settings live here; everything else is found inside it (or linked by an [instance key](#scoping--instance-keys)). |
| `wf-xano-element="list"` | — | the items container | Optional (Finsweet's `list`): where rendered cards are appended. Defaults to the template's own parent. *(v0.3.0 markup that put `element="list"` + `wf-xano-source` on the root still initializes as a root — deprecated alias.)* |
| `wf-xano-element="template"` | ✅ | the card | The item template. Cloned once per item; the original stays hidden. Rendered clones get `wf-xano-item` and `data-wf-xano-id="<item.id>"`. |
| `wf-xano-element="empty"` | — | any element | Shown when the response has 0 items. |
| `wf-xano-element="loader"` | — | any element | Shown while a request is in flight. |
| `wf-xano-element="error"` | — | any element | Shown when a request fails. |

### Card bindings

These work on any descendant of the template **and on the template root itself**.

| Attribute | Value | Description |
| --- | --- | --- |
| `wf-xano-bind` | field name | Sets the element's text (or `value` for inputs/selects/textareas). Supports dot paths for joined records: `brand.company_name`. |
| `wf-xano-fallback` | field name(s) | On a `wf-xano-bind` element: when the bound field is missing (`null`/`""`), bind the first non-missing field from this comma-separated list instead. For date formats only, Xano's unset epoch `0` is also skipped. E.g. `wf-xano-bind="last_edited_at" wf-xano-fallback="published_at,created_at"` → shows the edit date, or the publish date, or the created date. |
| `wf-xano-default` | literal text | Rendered when the value is still missing after `wf-xano-fallback` fields. Real `0`/`"0"` values render directly and beat fallbacks/defaults. A default is a real display value, so `wf-xano-prefix`/`wf-xano-suffix` still wrap it (v0.16.5+; zero semantics corrected in v0.17.0). |
| `wf-xano-src` | field name(s) | Sets an `<img>`'s `src`. Supports a pipe-separated fallback chain and uses the first non-blank field, e.g. `profile_photo\|profile-photo-xano\|profile-photo`. When a value is bound, any stale `srcset` from Webflow responsive images or a placeholder provider is removed so the browser uses the authoritative Xano image. If every field is blank, the template's placeholder `src`/`srcset` remains unchanged. |
| `wf-xano-if` | expression | Shows/hides the element per item: `status === 'Active'`, `budget >= 100`, `applied` (truthy). Operators: `===` `!==` `>` `>=` `<` `<=`. **Logical combos:** `\|` = OR, `&` = AND (`\|\|`/`&&` also fine), e.g. `last_edited_at \| created_at` (show if either present) or `status === 'Active' & applied === false`. AND binds tighter than OR. |
| `wf-xano-link` | field name | Builds the `href` from the field value. Works when the card root is the `<a>` itself. Unsafe protocols such as `javascript:` and `data:` are rejected. |
| `wf-xano-element="show-more"` | — | A clickable that expands a CSS-clamped text element by removing its clamp class (v0.13.0+). Works both inside list cards **and standalone on any page** — static CMS / detail pages, or content bound by another script such as opportunities-3.0.js (v0.14.0+). `wf-xano-target="<field>"` names the field to expand, matched against **both `wf-xano-bind` and `data-opp-bind`**; if it doesn't resolve (or is omitted) the target falls back to the nearest element carrying the `wf-xano-class` clamp class, then any bound element. `wf-xano-class="<class>"` is the clamp utility class removed while expanded and restored on collapse (e.g. `text-style-5lines`); on standalone pages the clamp class is what identifies the target. It accepts **multiple classes and `*` globs** (space-separated) — e.g. `text-style-*line*` strips every matching clamp on the target, so an element with both a desktop and a `-mob` clamp (`text-style-5lines text-style-2lines-mob`) fully expands on both breakpoints (v0.15.0+). Optional `wf-xano-expanded-text="Show less"` swaps the label while expanded — on composite buttons (label + icon children) mark the label child with `wf-xano-element="show-more-text"` so the swap writes there and icons survive (v0.13.1+). Mark icon children with `wf-xano-element="show-more-icon"` to have `is-wf-xano-expanded` toggled on them too — style the rotated state as a combo class on the icon itself (v0.13.2+). While expanded, `is-wf-xano-expanded` is set on the control and the target. Controls whose target isn't actually clamped (short text) are hidden automatically. Clicks don't bubble, so the control is safe inside `wf-xano-link` card anchors. Call `WfXano.initShowMore(scope?)` to re-wire after async content binding. |
| `wf-xano-element="details-toggle"` | — | A disclosure trigger that opens/closes a details panel by removing/restoring the panel’s closed-state class(es) (v0.30.0+; Finsweet Accordion’s trigger/content/active-class model). The panel is the nearest `wf-xano-element="details-target"` — resolution walks up from the control, bounded by the card in a list (put the panel INSIDE the template so each record clones its own) or by `<body>` standalone. `wf-xano-class="<class>"` names the closed-state class(es) on the target — removed while open, restored on close; defaults to `is-inactive`; accepts multiple space-separated classes and `*` globs like show-more. Panels always start closed: when no class matches, wiring adds only exact class names from the specification; globs can remove authored variants while open but cannot invent a closed-state class. While open, `is-wf-xano-expanded` is set on the control, the target, and any `wf-xano-element="details-toggle-icon"` descendants; optional `wf-xano-expanded-text="Hide details"` swaps the label (mark composite buttons’ label child `wf-xano-element="details-toggle-text"` so icons survive). State mirrors through `aria-expanded` (control) and `aria-hidden` (target). Clicks don’t bubble, so the control is safe inside `wf-xano-link` card anchors. Call `WfXano.initDetailsToggle(scope?)` to re-wire after async content binding. |
| `wf-xano-lazy-details` | — | Optional marker on a `details-target` inside a list template. Its authored child subtree stays detached and unbound while the panel is closed, then hydrates exactly once when that card is opened. Use this for large hidden project, invoice, or audit panels so append pagination does not multiply offscreen DOM work. Later closes preserve the hydrated panel and reopening does not duplicate nested rows. |

### Nested lists (v0.29.0)

A port of Finsweet's list `nest-target`, adapted to data-driven rows: a wf-xano row already carries
its child array (a Xano addon/join or composed response), so there is no second fetch or slug
matching. Mark a container inside the template with `wf-xano-element="nest-target"` +
`wf-xano-field="<array path>"` to render that row's child array as a nested list. A `nest-target` is
its own binding scope — wrapper-level scans (binds, ifs, forms, cards, controls) stop at it, so its
raw nested template is never bound with the outer row's data.

```html
<div wf-xano-element="nest-target" wf-xano-field="invoices">
  <div wf-xano-element="nest-template">
    <span wf-xano-bind="amount" wf-xano-prefix="$"></span>
    <span wf-xano-if="status === 'paid'">Paid</span>
    <a wf-xano-link="payment_link">View invoice</a>
  </div>
  <div wf-xano-element="nest-empty">No invoices yet.</div>
</div>
```

| Attribute | Required | Description |
| --- | --- | --- |
| `wf-xano-element="nest-target"` | ✅ | Container inside a card whose child array is rendered as a nested list. `wf-xano-field="<array path>"` names the array on the row (dot paths allowed). Deeper `nest-target`s belong to their own nested rows and recurse. |
| `wf-xano-element="nest-template"` | — | The row template cloned once per array entry; the original stays hidden. Binds/ifs/links/srcs inside it resolve against each sub-item with full card semantics. Without an explicit marker, the first element child that isn't the empty state is used — mark it explicitly to get the FOUC guard. Re-renders are idempotent (prior clones are swept first). |
| `wf-xano-element="nest-empty"` | — | Shown when the array is empty, hidden otherwise. |

### Counts

| Attribute | Description |
| --- | --- |
| `wf-xano-element="total"` | Total item count from the server. |
| `wf-xano-element="count-from"` / `="count-to"` | Visible range — "Showing **9**–**12** of 45". |

### Reactive state projections

These v0.20 attributes are opt-in, read-only projections of the instance store. They never send a
request or change Xano data. Place them inside the owning wrapper, or anywhere on the page with the
matching `wf-xano-instance` key.

| Attribute | Value | Description |
| --- | --- | --- |
| `wf-xano-state` | store path | Writes a scalar state value as text, e.g. `data.total`, `status`, or `query.page`. Objects and arrays render blank rather than exposing record bodies. Supports `wf-xano-format`, `wf-xano-default`, `wf-xano-prefix`, and `wf-xano-suffix`. |
| `wf-xano-if-state` | safe expression | Shows the element when the expression matches the store and hides it otherwise, e.g. `status === 'loading'`, `data.total > 0`, or `error.status === 503`. Uses the same allowlisted comparison/AND/OR grammar as `wf-xano-if`; no JavaScript is evaluated. Hidden elements receive `aria-hidden="true"`. `wf-xano-display` controls the shown display value. |
| `wf-xano-class-state` | `class:expression` | Toggles one safe CSS class from state, e.g. `is-loading:status === 'loading'`. Separate multiple directives with semicolons. Class names must be a single CSS identifier; selectors, whitespace, and arbitrary code are ignored. |

Projection updates are batched into one microtask pass per synchronous transition group. Existing
`total`, `loader`, `empty`, `error`, and item `wf-xano-if` roles remain supported unchanged.

### Pessimistic actions

These v0.21 attributes opt a control into one Xano-authoritative mutation. The runtime disables the
control, sends exactly one request per active action/item key, records safe lifecycle state, then
refreshes the declared list instances. It never constructs an endpoint from record data.

```html
<button
  wf-xano-action="archive"
  wf-xano-action-source="opp30:opportunities/archive"
  wf-xano-action-method="PATCH"
  wf-xano-action-param-record_id="item:id"
  wf-xano-action-param-status="literal:Archived"
  wf-xano-action-idempotency="item:id"
  wf-xano-action-invalidate="self,counts">
  Archive
</button>
```

| Attribute | Required | Description |
| --- | --- | --- |
| `wf-xano-action` | ✅ | Stable authored action name (`archive`, `approve`, etc.). The active key is action + current item ID when the control is inside a rendered card. |
| `wf-xano-action-source` | ✅ | Literal Xano source in the same grammar as `wf-xano-source`. Record/form values cannot alter it. |
| `wf-xano-action-method` | — | `POST` (default), `PATCH`, `PUT`, or `DELETE`. `GET` is rejected for actions. |
| `wf-xano-action-param-<field>` | — | One allowlisted JSON payload field. Its value must be `item:<path>`, `form:<field>`, or `literal:<text>`. Item values must be scalar. |
| `wf-xano-action-field` | for `form:` | Explicitly marks the input/select/textarea that may supply a named `form:` binding. Only controls in the action's closest form are considered. |
| `wf-xano-action-idempotency` | — | Optional binding in the same grammar; sent as `Idempotency-Key` only when the Xano endpoint supports that key's semantics. |
| `wf-xano-action-invalidate` | — | Comma-separated instance keys to refresh after success. `self` means the owning instance and is the default. Repeated targets are deduplicated. |
| `wf-xano-action-auth="none"` | — | Disables inherited Memberstack/Xano authentication for an explicitly public test endpoint. Actions otherwise inherit their list's auth mode. |

Pending controls receive `disabled` when supported, `aria-busy="true"`, `aria-disabled="true"`, and
`is-wf-xano-mutating`; the wrapper also receives `is-wf-xano-mutating`. Terminal controls receive
`is-wf-xano-action-success` or `is-wf-xano-action-error`. Mutation state is available under
`mutation["<action>:<item-id>"]` through `getState()`/`subscribe()`. Account changes and `destroy()`
abort active actions and clear their state. Xano must always resolve member identity, permission,
record validity, and idempotency server-side; a DOM item ID is never authorization evidence.
Authenticated actions are restricted to the configured `xanoBase` origin. Public actions may opt
out with action auth `none`.

### Keyed reconciliation and optimistic actions (v0.22)

Add `wf-xano-reconcile="keyed"` to a wrapper to update, move, insert, and remove cards by stable
identity instead of replacing every card. `wf-xano-key="uuid"` changes the identity field; the
default is canonical `id`. Every result must have a unique scalar key. Keyed updates preserve
focused or user-edited form values, selection, card-local classes/state, and nested instance
ownership.

Optimistic behavior is action-level opt-in and requires a keyed list plus an exact inverse:

```html
<button
  wf-xano-action="close"
  wf-xano-action-source="opp30:opportunities/close"
  wf-xano-action-optimistic="true"
  wf-xano-action-optimistic-field="status"
  wf-xano-action-optimistic-value="literal:Closed"
  wf-xano-action-optimistic-rollback="item:status"
  wf-xano-action-response="item">
  Close
</button>
```

| Attribute | Meaning |
| --- | --- |
| `wf-xano-action-optimistic="true"` | Enables the overlay. Omission keeps v0.21 pessimistic behavior. |
| `wf-xano-action-optimistic-field` | One top-level scalar record field to overlay. |
| `wf-xano-action-optimistic-value` | Next value using the existing `item:`, `form:`, or `literal:` grammar. |
| `wf-xano-action-optimistic-rollback` | Must be exactly `item:<optimistic-field>` so the runtime can capture and restore the prior value. |
| `wf-xano-action-response="item"` | Declares a complete authoritative record response with the same stable key. Otherwise normal invalidation/refetch runs. |

Do not enable optimistic mode for payments/entitlements, unrecoverable deletes, notifications,
non-idempotent multi-record work, or any action without an exact inverse. Xano remains the mutation
and authorization authority.

### Declarative forms (v0.23)

A wrapper may contain only a form, or a form may live inside a rendered keyed record. Only controls
marked with `wf-xano-field` enter the JSON payload or reactive snapshot.

```html
<div wf-xano-element="wrapper" wf-xano-instance="profile-editor">
  <form wf-xano-form="profile" wf-xano-form-source="member:profile/update"
    wf-xano-form-method="PATCH" wf-xano-form-invalidate="profile-list">
    <input wf-xano-field="display_name" required>
    <span wf-xano-error-for="display_name"></span>
    <textarea wf-xano-field="bio"></textarea>
    <span wf-xano-error-for="form"></span>
    <button type="submit">Save</button>
  </form>
</div>
```

| Attribute | Required | Description |
| --- | --- | --- |
| `wf-xano-form` | ✅ | Stable authored form name. Inside a rendered record, its state key is `<name>:<item-id>`; otherwise it is the name alone. |
| `wf-xano-form-source` | ✅ | Literal Xano source in the same grammar as `wf-xano-source`. Field values cannot alter it. |
| `wf-xano-form-method` | — | `POST` (default), `PATCH`, or `PUT`. Other methods are rejected. |
| `wf-xano-form-auth="none"` | — | Makes an explicitly public form unauthenticated. Forms otherwise inherit their wrapper's auth mode. |
| `wf-xano-form-timeout` | — | Positive request timeout in milliseconds. Defaults to `WfXanoConfig.formTimeout` or 15,000. |
| `wf-xano-form-invalidate` | — | Comma-separated instance keys to refresh after success. `self` means the owning list. |
| `wf-xano-form-reset-on-success="true"` | — | Restore the registration snapshot after success. Otherwise the submitted values become the new clean snapshot. |
| `wf-xano-field` | ✅ per submitted control | Allowlisted JSON field name on an input, select, or textarea. Checkbox groups and multi-selects become arrays. File inputs are rejected. |
| `wf-xano-error-for` | — | Projects one declared field error, or use `form` for the safe form-level message. |
| `wf-xano-element="form-submit"` | — | Marks a non-native submit control (e.g. a Webflow div/link button) so it is disabled while the submit is in flight, alongside any native `[type="submit"]`. |

Form state is available under `form["<name>[:<item-id>]"]` with `initial`, `current`, `dirty`,
`touched`, `status`, `errors`, and safe `error` metadata. Forms receive
`is-wf-xano-form-submitting`, `is-wf-xano-form-success`, `is-wf-xano-form-error`, and
`is-wf-xano-form-dirty`; pending submit controls are disabled and the form receives
`aria-busy="true"`. Duplicate submits share one request.

Native constraint errors are projected before a request. Xano may return allowlisted field errors
as `{ "errors": { "field": "message" } }` or `{ "field_errors": { ... } }`, plus an optional
top-level `message`. Undeclared response fields and success bodies never enter state or events.
Account changes clear member form values; navigation, account changes, and `destroy()` abort active
submits. Xano remains authoritative for identity, permissions, validation, and write idempotency.
Uploads are intentionally outside this contract.

### Favorites

Favorites are authenticated, member-scoped controls that work inside cards rendered by either
wf-xano or wf-algolia. Configure `WfXanoConfig.favoritesSource` once, then use:

```html
<button
  type="button"
  wf-xano-element="favorite"
  wf-xano-favorite-type="starter"
  wf-xano-favorite-label-add="Save Starter"
  wf-xano-favorite-label-remove="Remove saved Starter">
  <span wf-xano-element="favorite-visual">Save</span>
</button>
```

| Attribute | Required | Description |
| --- | --- | --- |
| `wf-xano-element="favorite"` | ✅ | Marks the save/remove control. The legacy `wf-xano-favorite` marker is also accepted. |
| `wf-xano-favorite-type` | ✅ | Server allow-listed namespace such as `starter`. May live on the control or an ancestor. |
| `wf-xano-favorite-id` | — | Explicit item ID. Otherwise resolves from the closest `data-wf-xano-id`, then wf-algolia's `data-wf-algolia-hit-objectid`. |
| `wf-xano-favorite-label-add` | — | Accessible label while unsaved. Defaults to `Save item`. |
| `wf-xano-favorite-label-remove` | — | Accessible label while saved. Defaults to `Remove saved item`. |
| `wf-xano-favorite-class` | — | Active class applied to the control and marked visuals. Accepts multiple space-separated classes. Defaults to `is-active`. |
| `wf-xano-element="favorite-visual"` | — | Marks a descendant that receives the favorite control's active class. Multiple descendants are supported; unmarked descendants are unchanged. |

When saved, the control and every marked `favorite-visual` descendant get `is-active` by default.
Set `wf-xano-favorite-class="custom-active"` on the control to override that visual class. The
control also keeps the stable internal `is-wf-xano-favorited` class for compatibility. It gets
`is-wf-xano-loading`, `aria-pressed`, and `aria-busy` as before.
Toggles are optimistic and roll back on failure; every visible copy of the same type/ID stays in
sync. An authenticated IDs request hydrates state after reload and whenever another renderer adds
cards. A wrapper with `wf-xano-refresh-on="favorite"` automatically refreshes after a successful
toggle; optionally put the same `wf-xano-favorite-type` on the wrapper to scope refreshes.

Required endpoints under the configured base are `POST <base>/ids` with `{ item_type }` returning
`{ ids: [...] }`, and `POST <base>/toggle` with `{ item_type, item_id }` returning
`{ favorited: boolean }`. Both receive the normal Xano bearer token. Authorization, member identity,
item validation, and the type allow-list must be enforced server-side.

### Pagination

| Attribute | Description |
| --- | --- |
| `wf-xano-element="page-prev"` / `="page-next"` | Prev/next controls. Get `is-disabled` at the range edges. |
| `wf-xano-element="page-number"` | Template button, cloned per visible page. Clones get `wf-xano-page-num`; the current page gets `is-active` and `aria-current="page"`. |
| `wf-xano-element="page-dots"` | Optional ellipsis template, cloned into gaps between the boundary pages and the current-page window (e.g. `1 2 … 7 8 9 … 24 25`). Clones get `wf-xano-page-dot`. Omit it and gaps are simply skipped (no ellipsis). |
| `wf-xano-element="pagination-wrapper"` | The element wrapping the whole pagination UI (prev, numbers, dots, next). Hidden automatically whenever the result has only one page, and shown again when a later result has more. |

Mark the container — not the individual controls — with `pagination-wrapper` so a one-page result
hides the surrounding chrome (borders, padding, "Page 1 of 1") instead of leaving an inert pager on
the page. It is optional: leave it off and no rendered element changes — though the
`is-wf-xano-single-page` root class described below is applied either way.

The wrapper is **not** FOUC-guarded, so it stays visible in the Designer and before the first
results land. Hiding sets `display: none`; showing clears the inline style so your class takes over.
If the wrapper's own class supplies the layout, give it `wf-xano-display="flex"` (or `grid`, …) and
that value is restored as the shown value, exactly as on `loader`/`empty`.

Either grammar works: `wf-xano-element="pagination-wrapper"` or the legacy `wf-xano-pagination-wrapper` marker.

The wrapper is only hidden on the **first** page: past page 1 it always stays visible so the prev
button remains reachable — including on the last page of a count-disabled Xano endpoint (one that
returns `curPage`/`nextPage` but no total), where the derived page count collapses to 1.

The root also gets **`is-wf-xano-single-page`** whenever the result fits on one page — with or
without a wrapper element — so you can style the single-page case in Webflow without hiding
anything. Both the class and the wrapper toggle in **both** directions as filters widen or narrow
the result set.

This applies only in the default `pagination` load mode — the append modes (`more`, `infinite`,
`all`) never call the pagination renderer and use `load-more` plus `is-wf-xano-exhausted` instead.

Numbered buttons follow Finsweet's boundary + window model: `wf-xano-page-boundary` pages are pinned at each edge and a `wf-xano-page-window` of pages centers on the current page. **Numbered pagination requires the endpoint to return `itemsTotal`** (or `pageTotal`) so the true last page is known — otherwise wf-xano only knows there's a *next* page and shows `current … next`. If your endpoint emits only `nextPage` (Xano's default paged list), use a **load mode** below instead.

### Load modes

Set on the wrapper via `wf-xano-load` (Finsweet's `load` setting). Append modes only need `nextPage`, so they work when the endpoint returns no total count.

| Value | Behavior |
| --- | --- |
| `pagination` *(default)* | Numbered page buttons (needs a true total; see above). |
| `more` | `wf-xano-element="load-more"` appends the next page on click; the control hides when exhausted. |
| `infinite` | Appends the next page as `load-more` (or an internal tail sentinel) scrolls into view. `wf-xano-threshold` (px) tunes the trigger distance. |
| `all` | Fetches every page up front and accumulates. |

Append modes reset (replace, back to page 1) on any filter/search/sort/clear change. The root gets `is-wf-xano-exhausted` when no more pages remain.

### Filters, search, sort

| Attribute | Value | Description |
| --- | --- | --- |
| `wf-xano-filter` | field name | **Form controls** (input/select): value becomes request param `field`, re-fetching on `change`. **Checkboxes** sharing a field form a group: checked values combine into a comma-separated param. **Radios** send the checked one's value. **Any other element** (tab, button, link…) becomes a click filter: clicking sends its `wf-xano-value` (empty value = the "All" option, clears the param). |
| `wf-xano-value` | filter value | The real value for checkboxes/radios (Webflow submits `on`) and for click filters. **`*` is the match-all sentinel** for "All" options — it clears the field (use it because Webflow's Designer cannot author an empty attribute value); the control shows as active/checked when no value is set. |
| `wf-xano-toggle` | `true` | On a click filter: clicking the active option again clears it (facet-style toggle). Default is tab semantics (re-click is a no-op). |
| `wf-xano-search` | field name | Text input, debounced → param `field`. |
| `wf-xano-sort` | param name (optional) | Select whose value becomes the sort param. Defaults to `sort`; give the attribute a value to rename it (`wf-xano-sort="sort_by"`). |

Active filter state is reflected with an **`is-active`** class — on the click-filter element
itself, and on the closest `<label>` of checked checkbox/radio filters (styleable in Webflow).
Controls are hydrated from the URL on load when [URL sync](#settings) is on.

### Clear & filter tags (Finsweet grammar)

| Attribute | Description |
| --- | --- |
| `wf-xano-element="clear"` | Click clears **all** user filters (static `wf-xano-param-*` values are kept). Add `wf-xano-filter="field"` to clear only that field. |
| `wf-xano-element="tag"` | Template for active-filter chips — cloned once per user-set filter **value** (comma groups render one chip per value). The original stays hidden. |
| `wf-xano-element="tag-field"` / `="tag-value"` | Elements inside the tag showing the field name / the value. |
| `wf-xano-element="tag-remove"` | Click removes that value from its filter group (falls back to the whole tag element if absent). |

## Settings

Add these to the elements above to tune behavior.

### On the wrapper (`wf-xano-element="wrapper"`)

| Attribute | Values | Default | Description |
| --- | --- | --- | --- |
| `wf-xano-source` | `group:path` or full URL | — (required) | Xano endpoint. `opp30:brand/opportunities/list` → `{xanoBase}/api:opp30/brand/opportunities/list`. |
| `wf-xano-instance` | any key | — | Instance key. See [scoping](#scoping--instance-keys). |
| `wf-xano-method` | `POST`, `GET`, `PATCH`… | `POST` | HTTP method. `GET` sends params as a query string. |
| `wf-xano-auth` | `memberstack`, `none` | `memberstack` | `memberstack` trades the Memberstack JWT for a Xano auth token (cached; reset when the member changes). `none` for public endpoints. |
| `wf-xano-per-page` | number | `20` | Page size, sent as `per_page`. |
| `wf-xano-page-window` | number | `5` | Numbered page buttons centered on the current page. |
| `wf-xano-page-boundary` | number | `1` | Pages always shown pinned at each edge (with `page-dots`, gaps become ellipses). |
| `wf-xano-debounce` | ms | `300` | Debounce for search inputs (can be overridden per input). |
| `wf-xano-url-sync` | `true` | — | Write page + declared filter/search/sort state to the query string (`<key>_page`, `<key>_<param>`) and restore it on load. Static `wf-xano-param-*` values are never serialized or overwritten from the URL. |
| `wf-xano-filter-mode` | `remote`, `local` | `remote` | `remote` re-fetches for every filter change. `local` fetches one complete authorized collection, keeps its keyed cards stable, and applies declared `wf-xano-filter` controls in page memory. Search and sort stay remote; reusing a local filter field as a search or sort parameter rejects the wrapper as ambiguous. Use only when one response is the complete collection; local mode intentionally ignores server paging metadata. |
| `wf-xano-revalidate-focus` | seconds | `0` | For `filter-mode="local"`, re-fetch when the tab becomes active after this many seconds since the last successful response. `0` disables focus revalidation. Explicit refreshes, successful invalidations, and auth changes still re-fetch. |
| `wf-xano-param-<name>` | any value | — | Static request param, e.g. `wf-xano-param-status="Active"`. |
| `wf-xano-refresh-on` | `favorite` | — | Re-fetch this list after a successful favorite toggle. Add `wf-xano-favorite-type` to scope it to one type. |
| `wf-xano-defer` | `true` | — | Skip this wrapper during the automatic boot sweep; it never constructs or fetches until page code activates it with `WfXano.init(rootEl)` (root element as scope). For pages where an async gate (e.g. member role) decides which of several feeds should run. |

### On cards / controls

| Attribute | Applies to | Description |
| --- | --- | --- |
| `wf-xano-format` | `wf-xano-bind` and `wf-xano-state` elements | Date/time styles: `date` (visitor-locale short, `5/21/2026`), **`date-medium`** / **`date-long`** (`May 21, 2026` — full/short month, pinned en-US so it's stable & unambiguous, v0.10.0+), `datetime`, `datetime-long`. Unset timestamps (Xano `0`) render blank, not `1/1/1970`. Also `short-name` (v0.7.1+) — abbreviates every word after the first (`John Paul Dionisio` → `John P. D.`). Set `WfXanoConfig.locale` to override the en-US default for the named date styles. |
| `wf-xano-display` | `wf-xano-if`/`wf-xano-if-state` elements, the `empty`/`loader`/`error` state elements, and `pagination-wrapper` | Display value when shown (e.g. `flex`). Default clears the inline style so the element's own class takes over. |
| `wf-xano-link-prefix` / `wf-xano-link-suffix` | `wf-xano-link` elements | Wrap the field value: `prefix + value + suffix`. |
| `wf-xano-value` | checkbox/radio filters | The real filter value — Webflow checkboxes all submit `"on"`. |
| `wf-xano-debounce` | a `wf-xano-search` input | Per-input debounce override. |

### State classes

The list root receives CSS classes you can style in Webflow:

| Class | When |
| --- | --- |
| `is-wf-xano-loading` | a request is in flight |
| `is-wf-xano-error` | the last request failed |
| `is-wf-xano-empty` | the last response had 0 items |
| `is-wf-xano-single-page` | the last result fits on one page (pagination load mode only) |
| `is-wf-xano-favorited` | a favorite control's item is saved |

## Scoping & instance keys

By default, all elements (bindings, counts, controls) are found **inside the list root**, so
multiple lists on one page never clash.

To place counts, filters, search, sort, or pagination **outside** the list wrapper, give the list an
instance key and tag the outside element with the same key:

```html
<span wf-xano-element="total" wf-xano-instance="opps"></span>

<div wf-xano-element="wrapper" wf-xano-instance="opps" wf-xano-source="opp30:brand/opportunities/list">
  …
</div>
```

The key is also the [URL-sync](#settings) prefix and the argument to `WfXano.get(key)`.

## Requests

- Every request is sent with `cache: 'no-store'` — Xano is authoritative and results are never
  served stale.
- Local filter mode is an in-page rendering policy, not an HTTP cache. It still sends a fresh
  `cache: 'no-store'` request on initial load and every revalidation, and the response must contain
  the member's complete authorized collection in one response. Declared local filter fields are
  omitted from that request; search, sort, and static parameters remain server-owned.
- Requests are **sequenced**: when loads overlap (debounced search + a filter click), a stale
  out-of-order response is dropped instead of rendering over the newest one; superseded fetches
  are aborted when supported.
- `POST` (default) sends `{...params, page, per_page}` as a JSON body — matching Xano's standard
  paged list inputs. Responses are normalized from Xano's `{items, itemsTotal, curPage, pageTotal}`
  shape (raw arrays and single objects also work).
- `GET` sends no JSON content-type header, avoiding an unnecessary CORS preflight for public lists.
- Failed append requests keep already-rendered pages and retry the same page on the next attempt.
