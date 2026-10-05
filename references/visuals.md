# Visuals

A visual goes on a page (`page.visual`, in a card at the top) or on a decision
(`decision.visual`, inside the card). It is there only if it helps decide: a diagram that shows the
mechanism, a timeline that shows the sequence, a comparison that shows what is given up. When the
information is a number, use `stats`, not a chart.

All visuals follow the theme (light / dark) and the design tokens: never write a color in a plan.

## Built-in visuals

| `kind` | For | Data |
|---|---|---|
| `timeline` | the phases end to end (follows the chosen order) | nothing (reads `phases`), or `items: [{ label, days, meta }]` |
| `bars` | comparing magnitudes, one series | `bars: [{ label, value }]` or `bars_from_phases: true`; `unit`, `total_label`, `note` |
| `stats` | key figures | `stats: [{ label, value, sub }]` |
| `compare` | options × criteria | `options_from: "<decision>"` (follows the answer), or `columns` + `rows: [{ label, values }]` |
| `diagram` | a mechanism, a flow, an architecture | `nodes: [{ id, label, sub, col, row, tone }]`, `edges: [{ from, to, label, dashed }]` |
| `file_tree` | the files touched | `from_tasks: true` (follows the answers), or `files: [{ path, op, note }]` |
| `risk_matrix` | risks, likelihood × impact | `risks: [{ id, label, likelihood: 1-3, impact: 1-3, mitigation }]` |
| `before_after` | a visible change | `before` / `after`: `{ title, text \| code \| image }` |
| `code` | a code excerpt | `code`, `lang`, `highlight: [lines]`, `start`, `caption` |
| `overview` | tiles linking to pages | `tiles: [{ title, text, icon, page }]` |
| `cards` | illustrated items | `cards: [{ title, text, icon }]` |
| `icons` | an icon sheet | `icons: [{ icon, label }]` |
| `tiers` | tiers | `tiers: [{ icon, label, value }]`, `grow` |
| `matrix` | options side by side | `rows: ["…"]`, `columns: [{ title, icon, cells: [{ title, text, icon }] }]` |
| `image` | a screenshot, a mockup | `src`, `alt`, `caption` |

`icon` (in `overview`, `cards`, `icons`, `tiers`, `matrix`, and on an `items` entry): a plan file
(`assets/…`, copied and downscaled into `.fluidplan/<id>/assets/`) or `lucide:<name>` (list below,
"Icons"; `check` rejects an unknown name).

`tone` of a diagram node: `default`, `primary` (the heart of the matter), `muted` (existing, out of
scope), `success` (new), `warning` (at risk), `danger` (removed).

```json
{ "kind": "diagram", "caption": "The path of a request",
  "nodes": [
    { "id": "client", "label": "Browser", "col": 0, "row": 0, "tone": "muted" },
    { "id": "api", "label": "API", "sub": "session middleware", "col": 1, "row": 0, "tone": "primary" },
    { "id": "cache", "label": "Redis", "col": 2, "row": 0, "tone": "success" },
    { "id": "db", "label": "PostgreSQL", "col": 2, "row": 1, "tone": "muted" } ],
  "edges": [
    { "from": "client", "to": "api", "label": "sid cookie" },
    { "from": "api", "to": "cache" },
    { "from": "api", "to": "db", "label": "if missing", "dashed": true } ] }
```

For a readable diagram:
- 3 columns at most (4 if the labels are short). On a phone, the diagram keeps a readable size and
  scrolls (a shadow on the edge signals it): about two columns are visible at first, so the start
  of the flow goes on the left;
- short edge labels (one to three words): they are truncated to the free space between two boxes,
  and the full text stays available on hover; put the explanation in the card text;
- prefer left-to-right flows, with columns for steps and rows for alternatives.

`caption` is shown under a page visual.

## Writing an extension (plan-specific visual)

When no built-in visual shows the mechanism (a computed progression curve, a talent tree, a
calendar), write a module in `.fluidplan/<id>/visuals/<name>.js` and declare it:
`"extensions": ["visuals/<name>.js"]`.

```js
// An ES module, with no imports: everything comes through `ctx`. It runs only in the page: the
// engine never executes a plan's code in Node. `fluidplan check` reads `kind` from the source text,
// and `validate` runs in the browser, its messages shown as plan errors in the page banner.
export default {
  kind: "my_curve",
  css: `.x-curve { display: grid; gap: .75rem; } .x-curve path { stroke: var(--chart-1); }`,
  validate(v, plan) {
    return Number.isFinite(v.max) ? [] : ['my_curve: "max" is missing'];
  },
  render(v, ctx) {
    const { h, svg, t } = ctx;
    const el = h("div", { class: "x-curve" });
    function update() {
      const decision = ctx.store.decision(v.value_from);
      const value = ctx.model.effectiveValue(decision, ctx.store.answer(v.value_from));
      el.replaceChildren(/* … drawing that depends on the answer … */);
    }
    update();
    return { el, update }; // `update`: called again on every answer
  },
};
```

What `ctx` provides:

| Key | Content |
|---|---|
| `h(tag, attrs, …children)`, `svg(…)` | build DOM (text is always escaped; `html:` only with `md`/`inline`) |
| `md`, `inline`, `plain` | safe Markdown → HTML, and plain text |
| `icon(name)` | a Lucide icon |
| `ui` | components: `button`, `badge`, `alert`, `tabs`, `accordion`, `toggleGroup`, `floating`… |
| `tooltip.show(node, x, y)`, `tooltip.hide()` | the shared tooltip |
| `t(key, vars)`, `t.lang` | interface labels, the plan's language |
| `plan`, `store` | the plan; `store.answer(id)`, `store.decision(id)`, `store.answers` |
| `model` | `effectiveChoice`, `effectiveValue`, `orderedPhases`, `itemVerdict`, `verdict`, `touchedFiles`… |
| `asset(path)` | URL of a plan file |
| `go(pageId, anchor?)` | navigate |

Drawing rules (the same as for the built-in visuals):
- colors through tokens only: `var(--chart-1)` to `var(--chart-5)` (fixed order, checked for color
  blindness), `var(--success)`, `var(--warning)`, `var(--destructive)`, `var(--muted-foreground)`,
  `var(--border)`…;
- thin strokes (2 px), solid gridlines, text in text colors (never a series color); a legend as
  soon as there are two series; a tooltip on hover; a table view of the values;
- prefix your classes (`x-…`) so they do not clash with the engine.

Working example: `test/fixtures/plans/mini/visuals/load_curve.js`, declared in
`test/fixtures/plans/mini/plan.json` with `"extensions": ["visuals/load_curve.js"]` and used on
decision D2 as `{ "kind": "load_curve", "value_from": "D2" }`. It draws a small line chart of the
share of requests reaching the database against the session TTL (5 to 120 min) chosen in D2's
`number` control: it reads the value with `model.effectiveValue`, redraws the curve and moves its
marker on every answer, and shows the resulting percentage in a stat tile above the chart;
`validate` rejects a `value_from` that names no decision of the plan.

## Icons

Names usable with `lucide:<name>` (a subset of [Lucide](https://lucide.dev) bundled in the engine;
to add one: `engine/public/js/icons.js`, see the comment at the end of the file):

`accessibility`, `arrow-down`, `arrow-right`, `arrow-up`, `badge-check`, `ban`, `bell`, `blocks`, `book-open`, `bot`, `box`, `braces`, `bug`, `calendar`, `calendar-clock`, `chart-bar`, `chart-line`, `chart-pie`, `check`, `chevron-down`, `chevron-left`, `chevron-right`, `chevron-up`, `chevrons-up-down`, `circle`, `circle-alert`, `circle-check`, `circle-dashed`, `circle-dot`, `circle-help`, `circle-play`, `circle-small`, `circle-x`, `clock`, `cloud`, `cloud-check`, `cloud-off`, `code`, `coins`, `columns-2`, `copy`, `cpu`, `credit-card`, `database`, `download`, `external-link`, `eye`, `eye-off`, `file`, `file-check`, `file-code`, `file-diff`, `file-minus`, `file-plus`, `file-text`, `files`, `fingerprint`, `flag`, `flask-conical`, `folder`, `folder-open`, `gamepad-2`, `gauge`, `gift`, `git-branch`, `git-compare`, `git-merge`, `git-pull-request`, `globe`, `grip-vertical`, `hard-drive`, `heart`, `history`, `hourglass`, `image`, `inbox`, `info`, `key-round`, `keyboard`, `languages`, `laptop`, `layers`, `layout-dashboard`, `lightbulb`, `link`, `list-checks`, `list-filter`, `list-ordered`, `loader-circle`, `lock`, `lock-open`, `mail`, `map`, `menu`, `message-circle-question`, `message-square`, `minus`, `monitor`, `moon`, `network`, `octagon-alert`, `package`, `palette`, `panel-left`, `pencil`, `plus`, `puzzle`, `refresh-cw`, `repeat`, `rocket`, `scale`, `search`, `send`, `server`, `settings`, `shield`, `shield-alert`, `shield-check`, `smartphone`, `sparkles`, `square-pen`, `star`, `sun`, `sword`, `table`, `target`, `terminal`, `timer`, `trash-2`, `triangle-alert`, `trophy`, `undo-2`, `upload`, `user`, `users`, `webhook`, `wifi-off`, `workflow`, `wrench`, `x`, `zap`

## Generated illustrations

When an image really helps decide (a screen mockup, the mood of a game level, a character concept),
generate it rather than describe it. Never for decoration: a plan stays a plan.

**In the plan**: a `prompt` on the visual to illustrate.

```json
{ "kind": "image", "prompt": "Settings page mockup with an e-mail reminders section: an on/off switch, a delivery time picker and a small preview of the e-mail. Clean web app style, light background, no logos", "aspect": "16:9" }
```

- An `image` visual with no `src` is an image to generate; on any other kind (`diagram`, `cards`…),
  the illustration is shown above the visual.
- `aspect`: `16:9` (default), `4:3`, `1:1`, `3:4`, `9:16`; `transparent: true` for a transparent
  background (OpenAI, Meshy).
- A good `prompt`: the subject, the composition, the style, and what to leave out (text in the
  image, logos). All four services understand English and French.

**Generate**: the person clicks "Illustrate" on the visual and picks the service; or the AI, with
their consent, runs `fluidplan images generate --plan <id> --target page:<id> --provider <service>`
(`--target decision:<id>` for a decision's visual; `--prompt`, `--aspect`, `--transparent` to change
the request). The image goes into `.fluidplan/<id>/assets/generated/` and the latest one is
selected; the other versions stay selectable under the image (`images select` from the CLI).

| Service | Key (`engine/.env`) | Default model | Optional settings |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-image-2.5-flare` | `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY` (`medium`) |
| Google Gemini | `GEMINI_API_KEY` | `gemini-3.1-flash-image` | `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_SIZE` (`1K`) |
| Ludo.ai | `LUDO_API_KEY` | type `art` | `LUDO_IMAGE_TYPE` (`sprite`, `icon`, `ui_asset`…), `LUDO_ART_STYLE` |
| Meshy | `MESHY_API_KEY` | `nano-banana` (3 credits) | `MESHY_IMAGE_MODEL` (`nano-banana-pro`, `gpt-image-2`…) |

Choosing: Gemini or OpenAI for a mockup or an illustrated diagram; Ludo for a game asset (sprite,
icon, background); Meshy for a character or object concept meant for 3D.

**Limit**: at most 5 generations **per service per plan**, counted in
`.fluidplan/<id>/images.json`. An attempt counts as soon as the service has accepted it, even if it
fails afterwards; a request refused outright (invalid key, rejected parameter) is not counted.
`fluidplan.config.json` can lower the limit (`"imagesPerProvider": 2`, `0` to turn generation off),
not raise it. `fluidplan images` shows the usage.

Keys stay on the server side: the page only learns "configured or not". Never read or print
`engine/.env`.
