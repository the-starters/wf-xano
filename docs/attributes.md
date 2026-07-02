# Attribute reference

Everything wf-xano does is driven by HTML attributes — no code required. This page follows the
element/setting split used by [Finsweet Attributes](https://finsweet.com/attributes): **Elements**
define *what a node is*, **Settings** tune *how it behaves*.

- [Elements](#elements)
- [Settings](#settings)
- [Scoping & instance keys](#scoping--instance-keys)
- [Requests](#requests)

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
| `wf-xano-src` | field name | Sets an `<img>`'s `src`. |
| `wf-xano-if` | expression | Shows/hides the element per item: `status === 'Active'`, `budget >= 100`, `applied` (truthy). Operators: `===` `!==` `>` `>=` `<` `<=`. |
| `wf-xano-link` | field name | Builds the `href` from the field value. Works when the card root is the `<a>` itself. |

### Counts

| Attribute | Description |
| --- | --- |
| `wf-xano-element="total"` | Total item count from the server. |
| `wf-xano-element="count-from"` / `="count-to"` | Visible range — "Showing **9**–**12** of 45". |

### Pagination

| Attribute | Description |
| --- | --- |
| `wf-xano-element="page-prev"` / `="page-next"` | Prev/next controls. Get `is-disabled` at the range edges. |
| `wf-xano-element="page-number"` | Template button, cloned per visible page. Clones get `wf-xano-page-num`; the current page gets `is-active` and `aria-current="page"`. |

### Filters, search, sort

| Attribute | Value | Description |
| --- | --- | --- |
| `wf-xano-filter` | field name | **Form controls** (input/select): value becomes request param `field`, re-fetching on `change`. **Checkboxes** sharing a field form a group: checked values combine into a comma-separated param. **Radios** send the checked one's value. **Any other element** (tab, button, link…) becomes a click filter: clicking sends its `wf-xano-value` (empty value = the "All" option, clears the param). |
| `wf-xano-value` | filter value | The real value for checkboxes/radios (Webflow submits `on`) and for click filters. |
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
| `wf-xano-page-window` | number | `5` | Max numbered page buttons rendered. |
| `wf-xano-debounce` | ms | `300` | Debounce for search inputs (can be overridden per input). |
| `wf-xano-url-sync` | `true` | — | Write page + params to the query string (`<key>_page`, `<key>_<param>`) and restore them on load. |
| `wf-xano-param-<name>` | any value | — | Static request param, e.g. `wf-xano-param-status="Active"`. |

### On cards / controls

| Attribute | Applies to | Description |
| --- | --- | --- |
| `wf-xano-format` | `wf-xano-bind` elements | `date` or `datetime` — formats timestamps with the user's locale. |
| `wf-xano-display` | `wf-xano-if` elements and the `empty`/`loader`/`error` state elements | Display value when shown (e.g. `flex`). Default clears the inline style so the element's own class takes over. |
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
- Requests are **sequenced**: when loads overlap (debounced search + a filter click), a stale
  out-of-order response is dropped instead of rendering over the newest one.
- `POST` (default) sends `{...params, page, per_page}` as a JSON body — matching Xano's standard
  paged list inputs. Responses are normalized from Xano's `{items, itemsTotal, curPage, pageTotal}`
  shape (raw arrays and single objects also work).
