# Attribute reference

Everything wf-xano does is driven by HTML attributes — no code required. This page follows the
element/setting split used by [Finsweet Attributes](https://finsweet.com/attributes): **Elements**
define *what a node is*, **Settings** tune *how it behaves*.

- [Elements](#elements)
- [Settings](#settings)
- [Scoping & instance keys](#scoping--instance-keys)
- [Requests](#requests)

## Elements

Add these to mark what each element is.

### List

| Attribute | Required | Applies to | Description |
| --- | --- | --- | --- |
| `wf-xano-list` | ✅ | the list wrapper | Marks a list root. Everything else lives inside it (or is linked by an [instance key](#scoping--instance-keys)). |
| `wf-xano-template` | ✅ | the card | The item template. Cloned once per item; the original stays hidden. Rendered clones get `wf-xano-item` and `data-wf-xano-id="<item.id>"`. |
| `wf-xano-empty` | — | any element | Shown when the response has 0 items. |
| `wf-xano-loader` | — | any element | Shown while a request is in flight. |
| `wf-xano-error` | — | any element | Shown when a request fails. |

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
| `wf-xano-total` | Total item count from the server. |
| `wf-xano-count-from` / `wf-xano-count-to` | Visible range — "Showing **9**–**12** of 45". |

### Pagination

| Attribute | Description |
| --- | --- |
| `wf-xano-page-prev` / `wf-xano-page-next` | Prev/next controls. Get `is-disabled` at the range edges. |
| `wf-xano-page-number` | Template button, cloned per visible page. Clones get `wf-xano-page-num`; the current page gets `is-active` and `aria-current="page"`. |

### Filters, search, sort

| Attribute | Value | Description |
| --- | --- | --- |
| `wf-xano-filter` | field name | Any input/select whose value becomes request param `field`, re-fetching on `change`. **Checkboxes** sharing a field form a group: checked values combine into a comma-separated param. **Radios** send the checked one's value. |
| `wf-xano-search` | field name | Text input, debounced → param `field`. |
| `wf-xano-sort` | param name (optional) | Select whose value becomes the sort param. Defaults to `sort`; give the attribute a value to rename it (`wf-xano-sort="sort_by"`). |

## Settings

Add these to the elements above to tune behavior.

### On the list (`wf-xano-list`)

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
| `wf-xano-display` | `wf-xano-if` elements | Display value when shown (e.g. `flex`). Default clears the inline style so the element's own class takes over. |
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
<span wf-xano-total wf-xano-instance="opps"></span>

<div wf-xano-list wf-xano-instance="opps" wf-xano-source="opp30:brand/opportunities/list">
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
