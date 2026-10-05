# Writing a fluidplan plan

A good fluidplan plan can be settled in fifteen minutes and executed without rereading. It has two
audiences: the person who decides (they read the pages) and the AI, who will execute it (it reads
PLAN.md, built from the `tasks`). The same `plan.json` must serve both.

## 1. Spot what needs deciding

A **decision** is a point the person can settle on its own, without opening another topic.

| In the source or the request | Becomes |
|---|---|
| An open question, two or three possible approaches | `control: choice`, the proposed approach as `recommended` |
| Several approaches that can be combined | `control: multi` |
| A numeric setting (duration, threshold, quota) | `control: number` with `min` / `max` / `default` / `unit` |
| The order of the work | a `control: order` decision, `source: "phases"` |
| A list of sibling proposals (screens, talents, endpoints) | `items`, judged one by one |
| A statement one accepts or not ("we keep X") | a plain decision (OK / Not OK / Change / Explain) |
| What goes without saying and costs nothing to undo | a `minor` decision, or just a task of another decision |

Do not create a decision for:
- an implementation detail with no real alternative (that is a task);
- a question the AI can settle alone by reading the code (settle it, and mention it in
  `learn_more` if the person would care);
- two linked points that cannot be settled separately (make them a single decision with options).

## 2. Split into pages

- **One page = one theme**, 3 to 5 non-minor decisions. Above 6, `check` warns: split.
- `section` groups pages in the sidebar ("1 · Storage", "2 · Interface").
- `intro`: one sentence saying what the page asks the person to decide.
- A page visual when it helps see the whole: the phase timeline (`timeline`), a diagram
  (`diagram`), the files touched (`file_tree`), the risks (`risk_matrix`) — see `visuals.md`.
- The home page (context, figures, outline) and the summary page are added by the engine: do not
  write them.
- Page order: from the most structural to the most local. Critical decisions first, on the first
  pages.

## 3. Calibrate importance

| `importance` | When | On screen |
|---|---|---|
| `critical` | Hard to undo, costly, or commits other decisions (storage, security, data model, public API, recurring cost) | red badge, "Why it matters" always open, "Critical" filter; `why` required |
| `important` (default) | A real choice, reversible with reasonable effort | neutral badge, `why` inline |
| `minor` | Convention, detail, preference; undone in minutes | grouped at the bottom of the page, "Accept all"; `why` in a tooltip |

Aim for 1 to 3 critical decisions per plan. If everything is critical, nothing is.

## 4. Anatomy of a decision

```json
{
  "id": "D4",
  "title": "Where to store sessions",
  "importance": "critical",
  "phase": "p2",
  "why": "This choice sets how the system scales and whether sessions can be revoked remotely. Pick wrong and every active session has to be migrated.",
  "proposal": "Sessions in **Redis**, with a 30-day sliding TTL.",
  "learn_more": "Long explanation, collapsed: alternatives studied, figures, links.",
  "facts": [{ "label": "Active sessions", "value": "≈ 12,000" }],
  "control": { "kind": "choice", "options": [ … ] },
  "tasks": [ … ],
  "depends_on": ["D2"],
  "source_ref": "§3.2 Sessions"
}
```

- `id`: short and stable (`D4`, `C3`, `auth-1`); it shows up everywhere (badges, PLAN.md, digest).
  Never renumber between rounds.
- `title`: what is being decided, not the answer ("Where to store sessions", not "Use Redis").
- `proposal`: the proposal, in plain words, two to four sentences. The person can rewrite it.
- `facts`: two to four figures that help decide. No decorative figures.
- `depends_on`: when one decision conditions another; the digest flags the dependent decisions to
  recheck when the upstream one changes.
- `source_ref`: where it is in the source document, to trace it back.

## 5. Tasks: what makes the output an executable plan

Every accepted decision produces its tasks in PLAN.md. A decision without tasks appears there only
as a "working rule" (useful for a convention, to avoid for real work).

```json
{
  "id": "middleware",
  "title": "Add the session middleware",
  "do": "Read the `sid` cookie, load the session, attach it to `req.session`.",
  "files": [{ "path": "src/middleware/session.ts", "op": "create" }],
  "acceptance": ["A request without a cookie gets a 401", "The TTL is sliding"],
  "verify": ["npm test -- session"],
  "after": ["D2/config"]
}
```

- `title`: a verb and an object, precise enough to be ticked off ("Add the session middleware").
- `do`: what to do, concretely; name the functions, tables, routes.
- `files`: **real** project paths (explore the code first); `op`: `create`, `modify`, `delete`.
  `check` warns when a file to modify exists neither on disk nor among the files a task of the plan
  creates. A file created by one task and then extended by others: `create` in the first, `modify`
  in the following ones (with the first in their `after`). Among decision-level tasks, only one
  creates a given file (`check` flags it otherwise).
- `acceptance`: verifiable criteria, not intentions ("gets a 401", not "is secure").
- `verify`: the commands that prove it is done. PLAN.md gathers them at the end of the plan.
- `after`: dependencies, `"<decision>/<task>"`, or `"<task>"` within the same decision. No cycles.
  A dependency on a task that is not kept (option not chosen, item or decision rejected) is simply
  ignored in PLAN.md.
- Where to put a task:
  - in `decision.tasks`: it applies whichever option is chosen;
  - in `option.tasks`: only if that option is chosen;
  - in `item.tasks`: only if the item is not rejected.
- Templates: `{{value}}` and `{{unit}}` (`number` control), `{{choice.label}}` / `{{choice.id}}`
  (`choice`), `{{choices}}` (`multi`). Example: `"title": "TTL of {{value}} {{unit}}"`.

- **Each task stands on its own**: PLAN.md contains neither the visuals, nor the `facts`, nor the
  text of the other cards. "The table above" makes a task impossible to execute: write the table
  in `do` (a Markdown code block works).
- `{{choice.label}}` inserts the label as is (capital letter, parentheses): put it after a colon
  ("Transport: {{choice.label}}") rather than in the middle of a sentence. If the person picks
  "Another option", no option task is kept and `{{choice.label}}` is empty: that is expected, the
  decision goes into revision in the next round anyway.

Size: one task = half a day at most. Beyond that, split it.

## 6. Phases

`phases` orders the tasks in PLAN.md. Three to five phases, each deliverable on its own, with
`estimate` (text) and `days` (a number, for the visuals). If the order is debatable, add a
`control: order` decision: the person reorders the phases and PLAN.md follows. Such a decision has
no tasks (it orders those of the others); `check` does not complain about it.

## 7. Starting from a document

- Read it in full before breaking it down. Note: themes, open questions, lists, figures, costs,
  implementation notes, order of the work.
- Keep the source's wording in `proposal` when it is clear; rephrase it otherwise.
- Open-question number from the source → `question` (badge "Question #3").
- What the source does not say (files, criteria): fill it in by exploring the code, or leave a
  descriptive `do` if there is no code.

## 8. Starting from a request (the AI designs the plan)

- Explore first: structure, conventions, tests, files involved.
- List the real choices (those where the person has a preference or context the AI lacks).
  Everything else is settled by the AI and shows up as tasks, or as `minor` decisions if it is
  debatable.
- `context`: the request restated in two or three sentences, the scope, what already exists.
- For a medium-sized request: 2 to 4 pages, 6 to 15 decisions, 10 to 30 tasks.

## 9. Before showing: the checklist

- [ ] `check`: zero errors; warnings read (missing whys, decisions without tasks).
- [ ] Every critical decision has a `why` that says what a mistake would cost.
- [ ] Every `choice` has a `recommended` option and honest pros / cons.
- [ ] Tasks cite real files and verifiable criteria.
- [ ] The screenshots (`snap`) are clean in light, in dark and at 390 px.
- [ ] The glossary explains every acronym the person might not know.
