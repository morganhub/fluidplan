# The `plan.json` format (v2)

The full JSON schema is `engine/schema/plan.schema.json` (for editor completion); `fluidplan check`
also enforces the rules that matter (references, cycles, files). Keys are in English; the
**content** is written in the plan's language.

## The plan

| Field | Required | Role |
|---|---|---|
| `version` | yes | `2` |
| `id` | yes | folder name: `.fluidplan/<id>/` (`a-z`, `0-9`, `_`, `-`) |
| `title`, `subtitle` | `title` | title of the app and of the outputs |
| `lang` | | `en` (default) or `fr`: interface and exports |
| `accent` | | main color: `neutral` (default), `blue`, `green`, `orange`, `rose`, `violet`, `yellow` |
| `source` | | `{ "kind": "md" \| "txt" \| "docx" \| "pdf" \| "request", "path": "docs/X.md" }` |
| `context` | recommended | the request, the scope, what already exists (home page, top of the outputs) |
| `output` | | `{ "plan": "docs/PLAN_x.md", "decisions": "docs/DECISIONS_x.md" }` (default: the plan folder); an existing file that fluidplan did not write is never overwritten |
| `phases` | | `[{ id, title, short?, estimate?, cost?, days? }]` |
| `glossary` | | `[{ term, aliases?, definition }]` |
| `extensions` | | `["visuals/<name>.js"]`: plan-specific visuals (see `visuals.md`) |
| `x` | | free-form settings for extensions |
| `pages` | yes | the pages, in order |

## The page

`{ "id", "section"?, "title", "intro"?, "visual"?, "decisions"? }` — `id` does not start with `_`
(reserved for the home page and the summary page the engine adds). A visual (on a page or a
decision) can carry `prompt`, `aspect`, `transparent`: the illustration to generate (see
`visuals.md`).

## The decision

| Field | Role |
|---|---|
| `id`, `title` | required; `id` unique across the whole plan |
| `importance` | `critical`, `important` (default), `minor` |
| `phase` | id of a phase (its tasks go there) |
| `why` | why it matters; required if `critical` |
| `proposal` | the proposal (can be rewritten in the page) |
| `learn_more` | long explanation, collapsed |
| `question` | open-question number from the source (badge) |
| `facts` | `[{ label, value }]` |
| `visual` | a visual inside the card |
| `items` | a list judged item by item — **or** `control`, not both |
| `control` | `choice`, `multi`, `number`, `order` (see below) |
| `tasks` | tasks kept whichever option is chosen |
| `depends_on` | ids of upstream decisions |
| `source_ref` | where it is in the source |
| `revision` | `{ "round": n, "note": "…" }` — set by the AI on each revision |

## Controls

```json
{ "kind": "choice", "options": [
  { "id": "redis", "label": "Redis", "detail": "…", "recommended": true,
    "pros": ["…"], "cons": ["…"], "effort": "M", "cost": "…", "tasks": [ … ] },
  { "id": "memory", "label": "In-process memory", "pros": ["…"], "cons": ["…"], "effort": "S" } ] }

{ "kind": "multi", "options": [ … ] }          // several options; `recommended` = checked by default

{ "kind": "number", "min": 5, "max": 120, "step": 5, "default": 30, "unit": "min" }

{ "kind": "order", "source": "phases" }        // reorder the phases; at least two phases
```

- "Another option" is added automatically to every `choice`: the person describes it in their
  remark.
- Accepting without touching the control keeps the proposal: the `recommended` option, the
  `default` value, the declared order.
- Beyond five options without explanations, a `choice` is shown as a dropdown.

## The item (`items`)

`{ "id", "title", "tag"?, "detail"?, "icon"?, "tasks"?, "node"? }` — `icon`: a plan file
(`assets/x.png`) or `lucide:<name>`; `node`: free-form settings for an extension.

## The task

| Field | Role |
|---|---|
| `id`, `title` | required; `id` unique within the decision (options and items included) |
| `do` | what to do (Markdown) |
| `phase` | defaults to the decision's phase |
| `files` | `[{ "path": "src/x.ts", "op": "create" \| "modify" \| "delete" }]` |
| `acceptance` | verifiable criteria |
| `verify` | verification commands |
| `after` | `["D2/config", "other-task"]` |

Templates in `title`, `do`, `acceptance`, `verify`: `{{value}}`, `{{unit}}`,
`{{choice.label}}`, `{{choice.id}}`, `{{choices}}`.

## Sibling files (do not write them by hand)

| File | Written by | Content |
|---|---|---|
| `answers.json` | the page (and `next-round`) | one entry per decision: `status` (`ok`, `ko`, `modify`, `explain`), `comment`, `choice` / `choices` / `value` / `order`, `items`, `edits`, `round` |
| `state.json` | the engine | `round`, `status` (`review`, `submitted`, `ready`, `exported`), `history` |
| `rounds/<n>/` | the engine | archive of the round: `plan.json`, `answers.json`, `digest.md` |
| `images.json` | the engine | generated illustrations: usage per service (at most 5 per plan), images, version selected per target |

`edits` holds the person's rewrites, by path: `proposal`, `options/<id>/label`,
`options/<id>/detail`, `items/<id>/detail`, `tasks/<id>/title`, `tasks/<id>/acceptance` (one line
per criterion). The exports already apply them; when revising, carry them over into `plan.json`.

## Minimal example

```json
{
  "version": 2,
  "id": "cache",
  "title": "Session cache",
  "lang": "en",
  "context": "Cache sessions to handle the load.",
  "phases": [{ "id": "p1", "title": "Foundation", "estimate": "≈ 1 d", "days": 1 }],
  "pages": [{
    "id": "storage", "section": "1 · Storage", "title": "Where to keep sessions",
    "decisions": [{
      "id": "D1", "title": "The cache engine", "importance": "critical", "phase": "p1",
      "why": "It sets how far the system scales; switching later means migrating every session.",
      "proposal": "A shared Redis cache.",
      "control": { "kind": "choice", "options": [
        { "id": "redis", "label": "Redis", "recommended": true, "pros": ["Shared"], "cons": ["One more service"],
          "tasks": [{ "id": "client", "title": "Add the Redis client", "files": [{ "path": "src/cache/redis.js", "op": "create" }], "verify": ["npm test"] }] },
        { "id": "memory", "label": "In-process memory", "pros": ["Nothing to run"], "cons": ["Lost on restart"] }
      ] }
    }]
  }]
}
```

Complete plans: `examples/tech-feature/plans/tech-feature/plan.json` (with the small project it
targets), `test/fixtures/plans/mini/plan.json`.
