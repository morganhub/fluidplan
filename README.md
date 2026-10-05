# fluidplan

A skill for Claude Code, Codex, and Gemini in Antigravity that turns a plan into a small web app you
**decide** instead of a long Markdown file you read.

## Version 1.1.0 — Codex and Antigravity compatibility

This update extends the original Claude Code skill to Codex and Gemini in Antigravity. It adds
client-specific instructions for automatic round listening, so submitting a round in the web
app continues the review without requiring a message in the chat. Codex and Antigravity keep
their agent turn active during review; Claude Code retains its existing background wait and
completion notifications. The interface now uses assistant-neutral labels in English and French:
**Send the plan to AI** / **Envoyer le plan à l'IA**.

![A decision card: why it matters, options with pros and cons](docs/images/02-decision.png)

## What it does

1. The AI turns a plan into a local web app: one page per theme, one card per decision. The plan
   can be a proposal document you already have, or the plan the AI designs for your request.
2. You answer each card: **OK**, **Not OK**, **Change** or **Explain**. You can also rewrite any
   text in place.
3. You click **Send the plan to AI**. The AI revises what you changed or questioned, and the page opens
   **round 2**: you only see what changed, with the AI's note and a diff.
4. When everything is settled, the AI writes two files:
   - **PLAN.md**: the tasks, phase by phase, with the files to touch, acceptance criteria and
     verify commands. It is ready to execute.
   - **DECISIONS.md**: every choice, why it was made, and what was ruled out.

## Requirements

- Claude Code, Codex, or Gemini in Antigravity, with terminal execution tools
- Node.js 20 or later
- Any modern browser

## Install

Install the complete skill folder in your client's global skills directory:

| Client | Directory | Explicit invocation |
|---|---|---|
| Claude Code | `~/.claude/skills/fluidplan` | `/fluidplan` |
| Codex | `~/.codex/skills/fluidplan` | `$fluidplan` |
| Antigravity IDE / 2.0 | `~/.gemini/config/skills/fluidplan` | `/fluidplan` |
| Antigravity CLI | `~/.gemini/antigravity-cli/skills/fluidplan` | `/fluidplan` |

For example, for Claude Code (use the matching directory above for another client):

```bash
git clone https://github.com/morganhub/fluidplan.git ~/.claude/skills/fluidplan
```

On Windows (PowerShell):

```powershell
git clone https://github.com/morganhub/fluidplan.git "$HOME\.claude\skills\fluidplan"
```

Start a new assistant session. The skill is available in every project; there is nothing to
install in the projects themselves.

## Use

Open your assistant in your project (outside a read-only plan mode) and ask, for example:

- *"Present `docs/proposal.md` with fluidplan."* — a `.md`, `.txt`, `.docx` or `.pdf` document
- *"Design the plan to add e-mail reminders and present it with fluidplan."*
- or invoke the skill using the command for your client above, followed by your request

Then:

1. The AI writes the plan in `.fluidplan/<id>/`, checks it, and opens it in your browser.
2. You answer the cards. Answers are saved as you go: you can close the page and come back.
3. You click **Send the plan to AI**. The AI revises the plan and the page reloads into the next round.
4. You repeat until everything is settled. The AI then writes `PLAN.md` and `DECISIONS.md`.
5. You say *"execute the plan"*.

Keep the assistant session active during review. Claude Code uses its existing background wait
and completion notifications. Codex and Antigravity keep an active turn awaiting the tracked wait
command. No chat message is needed between rounds. See [`references/assistants.md`](references/assistants.md).
After an interrupted session, *"sent"* in the conversation is a recovery option.

## A plan, step by step

The screenshots come from the example project in [`examples/tech-feature`](examples/tech-feature):
a plan to add e-mail reminders to a small task app.

**The overview.** The request, the numbers, how to answer, the outline and the phases.

![Home page](docs/images/01-home.png)

**Answering.** Here, one decision is accepted, one gets a change and another a question.

![A change and a question](docs/images/03-answer.png)

**Sending the round.**

![Send the plan to AI](docs/images/04-send.png)

**Round 2.** The page reloads by itself. The AI revised the two decisions you questioned, and only
those are shown by default.

![Round 2](docs/images/05-round-2.png)

Each revised card carries the AI's note and a word-level diff with the previous version.

![A revised decision](docs/images/06-revised.png)

**The final plan.** When everything is settled, the summary shows the tally and a preview of the
two files.

![Summary](docs/images/07-summary.png)

![PLAN.md preview](docs/images/08-plan-md.png)

**Dark theme and phone.**

<p>
  <img src="docs/images/09-dark.png" alt="Dark theme" width="62%">
  <img src="docs/images/10-mobile.png" alt="Phone width" width="30%">
</p>

## Features

- **Decision cards.** Four answers per card: OK, Not OK, Change (with a remark or a rewrite) and
  Explain (a question). Each card shows why the decision matters, and what it involves as tasks.
- **Controls.** Single choice (options with pros, cons and effort, plus a side-by-side compare
  view), multiple choice, a number slider, lists judged item by item, and phase ordering.
- **Importance.** Critical decisions stand out; minor ones are grouped and can be accepted in one
  click; a filter shows only what is left to do.
- **Glossary.** Terms are explained on hover.
- **Rounds.** Only revised decisions come back. Answers you already gave are kept.
- **Visuals.** 15 built-in visuals: timeline, diagram, compare table, file tree, risk matrix,
  before/after, code, stats and more. A plan can also bring its own visual as a small JS module.
- **Illustrations (optional).** An image can be generated for a visual with OpenAI, Google Gemini,
  Ludo.ai or Meshy, with a limit of 5 per service and per plan.
- **Inputs.** Markdown, text, Word (`.docx`, read by a built-in converter) and PDF, or a plan the AI
  designs from your request.
- **Languages.** English (default) or French, set per plan.
- **Local.** A small Node server on `127.0.0.1` with no dependencies. Nothing leaves your machine
  unless you generate an illustration.

## Configuration (optional)

A `fluidplan.config.json` at the root of a project:

| Key | Default | Meaning |
|---|---|---|
| `plansDir` | `.fluidplan` | where plans are stored |
| `outputDir` | `{plansDir}/{id}` | where `PLAN.md` and `DECISIONS.md` are written |
| `lang` | `en` | language of new plans (`en` or `fr`) |
| `accent` | `neutral` | main color: `neutral`, `blue`, `green`, `orange`, `rose`, `violet`, `yellow` |
| `port` | `5178` | server port (the next free one is used if taken) |
| `imagesPerProvider` | `5` | illustration limit per service and per plan (can be lowered, not raised) |

Illustration services read their keys from `engine/.env` in the skill folder (see
[`engine/.env.example`](engine/.env.example)).

---

## Technical overview

### How a round works

```
the AI writes plan.json ──► fluidplan serve ──► the page (you answer; answers.json)
        ▲                                               │
        │                                     "Send the plan to AI" (state.json: submitted)
        │                                               │
   plan.json revised  ◄── digest ◄── fluidplan wait ◄───┘
   ("revision": { "round": n+1, "note" })
        │
        └──► fluidplan next-round ──► the page reloads into round n+1 ──► … ──► fluidplan finalize
                                                                                  PLAN.md, DECISIONS.md
```

- The AI keeps `serve` running and listens through `wait`. Claude Code uses background task
  completion; Codex and Antigravity await the tracked job in an active turn. `wait` exits when
  you send the round and returns a **digest** of what to rework.
- Each file has a single writer. The AI writes `plan.json`. The page writes `answers.json`. The
  engine writes `state.json` and `images.json`.
- `next-round` refuses to run if a decision to rework has no `revision` for the next round. It
  resets only the answers of revised decisions and archives each round in `rounds/<n>/`.

### Files in a project

```
.fluidplan/<id>/
  plan.json          the plan (written by the AI)
  answers.json       your answers (written by the page)
  state.json         round and status
  images.json        generated illustrations and usage per service
  rounds/<n>/        each round as sent, with its digest
  assets/  visuals/  images and visual extensions of the plan
  PLAN.md  DECISIONS.md
```

### CLI

The AI drives the engine through one command, run from the project root:
`node ~/.claude/skills/fluidplan/engine/fluidplan.mjs <command>`.

| Command | What it does |
|---|---|
| `new --plan <id> --title "…"` | creates a plan from the template |
| `check` | validates plans: errors block, warnings point at weak spots (a missing "why", a decision without tasks) |
| `serve [--open]` | serves the page (reuses a running instance) |
| `wait [--timeout seconds]` | blocks until the round is sent, then prints the digest; a bounded timeout returns exit code 3 |
| `digest` | what the AI has to rework in this round |
| `next-round` | opens the next round after `plan.json` was revised |
| `finalize` | writes `PLAN.md` and `DECISIONS.md` once everything is settled |
| `export` | writes both files at any time (marked DRAFT if not settled) |
| `import <file.docx> --out <dir>` | converts a Word document to Markdown |
| `images`, `images generate`, `images select` | illustration usage, generation and version choice |
| `snap --out <dir>` | screenshots of every page, in light and dark themes, at several widths |

### Plan format

A plan is a JSON file: pages, decisions, options, tasks, phases and a glossary. The format is
described in [`references/schema.md`](references/schema.md) and
[`engine/schema/plan.schema.json`](engine/schema/plan.schema.json). A complete example is in
[`examples/tech-feature/plans/tech-feature/plan.json`](examples/tech-feature/plans/tech-feature/plan.json).
The AI follows [`SKILL.md`](SKILL.md) and the guides in [`references/`](references) to write
it.

### Stack

- **Engine.** Node.js 20+, no dependencies and no build: an HTTP server, a CLI, a small `.docx`
  reader and a headless-browser driver for screenshots.
- **Page.** Vanilla JavaScript modules. The components follow the look of
  [shadcn/ui](https://ui.shadcn.com) (Button, Card, Badge, Tabs, Accordion, Dialog, Sheet,
  Toggle group…) and use its oklch design tokens, in light and dark themes.
- **Assets.** [Lucide](https://lucide.dev) icons and the [Geist](https://vercel.com/font) fonts are
  bundled, so the page makes no external request.
- **Charts.** Colors come from a categorical palette validated for color-vision deficiency.
- **Shared code.** The model and the exports (`engine/public/js/model.js`, `export_*.js`) are pure
  modules, used by both the page and the server.

### Security

- The server listens on `127.0.0.1` only, and rejects foreign `Host` headers (DNS rebinding) and
  cross-origin writes.
- It serves only a plan's `assets/` and `visuals/` folders, and writes only `.md` files inside the
  project. An existing file that fluidplan did not write (a README, say) is never overwritten.
- A plan's visual extensions run only in the browser page, never in Node: presenting a plan that
  comes from someone else's repository does not execute its code on your machine.
- The server's own bookkeeping (port, process, paths) lives in the system temp folder, not in the
  project, so versioning `.fluidplan/` publishes no local path.
- The `.docx` reader caps the file size and the decompressed size of each entry (no zip bombs).
- Illustration keys stay on the server side: the page only learns whether a service is configured.

### Repository layout

| Path | Content |
|---|---|
| `SKILL.md`, `references/` | the skill, as read by the AI |
| `engine/fluidplan.mjs`, `engine/server.mjs` | CLI and server |
| `engine/lib/` | configuration, plans, rounds, validation, exports, illustrations, `.docx` reader, browser driver |
| `engine/public/` | the page: `css/`, `js/`, `i18n/` (en, fr), `fonts/` |
| `engine/schema/plan.schema.json` | JSON schema of a plan |
| `examples/tech-feature/` | example project: a small app and its plan |
| `test/` | unit tests, the end-to-end test and fixtures |
| `scripts/readme-screenshots.mjs` | regenerates the screenshots above |

### Development

```bash
npm run unit          # unit tests (node --test)
npm run smoke         # end-to-end run in headless Edge or Chrome (FLUIDPLAN_BROWSER to point at one)
npm run check         # validates the example and the fixtures
npm run screenshots   # regenerates docs/images
```

Third-party licenses: [`engine/public/THIRD_PARTY.md`](engine/public/THIRD_PARTY.md).

## License

[MIT](LICENSE)
