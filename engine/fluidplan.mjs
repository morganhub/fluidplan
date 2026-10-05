#!/usr/bin/env node
// fluidplan — the skill's single CLI. Run it from the project root (or pass --root).
//
//   node <skill>/engine/fluidplan.mjs <command> [--root <project>] [--plan <id>] [--plans <dir>]
//
// See `help` for the list of commands.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planDir, resolveConfig } from "./lib/config.mjs";
import { checkPlan } from "./lib/check.mjs";
import { readJson, toPosix, writeAtomic, writeJson } from "./lib/fsutil.mjs";
import { writeOutputs } from "./lib/outputs.mjs";
import { generateForPlan, imagesState, MAX_PER_PROVIDER, selectImage } from "./lib/images.mjs";
import { listPlans, loadState } from "./lib/plans.mjs";
import { buildDigest, finalize, nextRound } from "./lib/rounds.mjs";
import { serverInfoPath, startServer } from "./server.mjs";

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const HELP = `fluidplan — a plan to decide, presented as a small local app.

Usage: node ${toPosix(path.relative(process.cwd(), path.join(ENGINE, "fluidplan.mjs"))) || "fluidplan.mjs"} <command> [options]

Commands
  serve [--open] [--port n]        serve the page (reuses an instance already running for this project)
  check                            errors (exit code 1) and warnings, for every plan or --plan
  new --plan <id> --title "…"      create .fluidplan/<id>/plan.json from the template [--lang en|fr] [--review-only]
  wait [--timeout seconds]         wait until the person sends the round, then print the digest
  digest                           what the assistant must rework (rounds/<n>/digest.md)
  next-round [--force]             open the next round once plan.json is revised
  finalize [--force]               everything is decided: write PLAN.md and DECISIONS.md
  export                           write PLAN.md and DECISIONS.md (DRAFT if not everything is decided)
  import <file> --out <dir>        .docx → source.md + media (pandoc as a fallback)
  images                           illustrations: configured services, usage (at most ${MAX_PER_PROVIDER} per service and per plan)
  images generate --target <target> --provider <openai|gemini|ludo|meshy> [--prompt "…"] [--aspect 16:9] [--transparent]
                                   generate an illustration (costs credits: get the person's consent first)
  images select --target <target> --image <id>   pick the version shown; target: page:<id> or decision:<id>
  snap --out <dir>                 screenshots of every page [--themes light,dark] [--widths 1400,390] [--pages a,b]

Common options
  --root <dir>        project root (default: current directory)
  --plans <dir>       plans directory (default: fluidplan.config.json, else .fluidplan)
  --plan <id>         target plan (default: the only plan, or the first one)
`;

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "help";

try {
  process.exitCode = (await run(command)) ?? 0;
} catch (error) {
  console.error(`fluidplan ${command}: ${error.message}`);
  process.exitCode = 1;
}

async function run(cmd) {
  if (cmd === "help" || args.help) {
    console.log(HELP);
    return 0;
  }
  if (cmd === "import") return importCommand();
  const config = resolveConfig({ root: args.root, plans: args.plans, port: args.port });
  switch (cmd) {
    case "serve":
      return serve(config);
    case "check":
      return check(config);
    case "new":
      return create(config);
    case "wait":
      return wait(config);
    case "digest": {
      const digest = await buildDigest(config, await pickPlan(config));
      console.log(digest.markdown);
      console.log(`\n(written to ${digest.path})`);
      return 0;
    }
    case "next-round": {
      const id = await pickPlan(config);
      const result = await nextRound(config, id, { force: Boolean(args.force) });
      console.log(`round ${result.round} opened for "${id}": ${result.reset.length} decision(s) to review${result.reset.length ? ` (${result.reset.join(", ")})` : ""}.`);
      if (result.removed.length) console.log(`answers removed (decisions deleted): ${result.removed.join(", ")}`);
      if (result.untouched.length) console.log(`warning, not revised: ${result.untouched.join(", ")}`);
      return 0;
    }
    case "finalize": {
      const result = await finalize(config, await pickPlan(config), { force: Boolean(args.force) });
      console.log(`${result.draft ? "draft written" : "plan finalized"}: ${result.plan.path}, ${result.decisions.path}`);
      if (result.approval.autoExecute) console.log("Codex: implement the accepted tasks now, in the same active turn; no additional chat confirmation is needed.");
      return 0;
    }
    case "export": {
      const result = await writeOutputs(config, await pickPlan(config));
      console.log(`written: ${result.plan.path} (${kb(result.plan.bytes)}), ${result.decisions.path} (${kb(result.decisions.bytes)})`);
      return 0;
    }
    case "snap":
      return snap(config);
    case "images":
      return images(config);
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      return 1;
  }
}

async function pickPlan(config) {
  if (args.plan) return String(args.plan);
  const plans = await listPlans(config);
  if (!plans.length) throw new Error(`no plan in ${config.plansDir}`);
  if (plans.length > 1) console.error(`several plans, "${plans[0].id}" picked by default (--plan to choose)`);
  return plans[0].id;
}

// --- serve ----------------------------------------------------------------------------------------

async function serve(config) {
  const plan = args.plan ? String(args.plan) : undefined;
  const reused = await runningServer(config);
  if (reused) {
    const url = `http://127.0.0.1:${reused.port}/${plan ? `?plan=${encodeURIComponent(plan)}` : ""}`;
    console.log(`fluidplan is already running for this project: ${url}`);
    if (args.open) openBrowser(url);
    return 0;
  }
  const { url } = await startServer(config, { plan });
  if (args.open) openBrowser(url);
  // The process stays alive: it is the server.
  return undefined;
}

async function runningServer(config) {
  const file = serverInfoPath(config);
  if (!existsSync(file)) return null;
  try {
    const info = JSON.parse(await readFile(file, "utf8"));
    process.kill(info.pid, 0);
    const response = await fetch(`http://127.0.0.1:${info.port}/api/config`, { signal: AbortSignal.timeout(1500) });
    return response.ok && path.resolve(info.plansDir) === config.plansDir ? info : null;
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const commandLine = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(commandLine, commandArgs, { detached: true, stdio: "ignore" }).unref();
}

// --- check ----------------------------------------------------------------------------------------

async function check(config) {
  const ids = args.plan ? [String(args.plan)] : (await listPlans(config)).map((p) => p.id);
  if (!ids.length) {
    console.log(`no plan in ${config.plansDir}`);
    return 0;
  }
  let failures = 0;
  for (const id of ids) {
    try {
      const { plan, errors, warnings } = await checkPlan(config, id);
      const decisions = (plan.pages ?? []).reduce((n, page) => n + (page.decisions?.length ?? 0), 0);
      if (errors.length) failures += 1;
      console.log(`${errors.length ? "✗" : "✓"} ${id} — ${plan.pages?.length ?? 0} pages, ${decisions} decisions, ${errors.length} error(s), ${warnings.length} warning(s)`);
      for (const error of errors) console.log(`   ✗ ${error}`);
      for (const warning of groupWarnings(warnings)) console.log(`   ! ${warning}`);
    } catch (error) {
      failures += 1;
      console.log(`✗ ${id} — ${error.message}`);
    }
  }
  return failures ? 1 : 0;
}

// --- new ------------------------------------------------------------------------------------------

async function create(config) {
  const id = String(args.plan ?? args._[1] ?? "");
  if (!args.title) throw new Error("--title is required");
  const dir = planDir(config, id);
  if (existsSync(path.join(dir, "plan.json"))) throw new Error(`the plan already exists: ${toPosix(path.relative(config.root, dir))}`);
  const template = await readJson(path.join(ENGINE, "templates", "plan.json"));
  template.id = id;
  template.title = String(args.title);
  template.execution = args["review-only"] ? "review" : "auto";
  template.lang = args.lang === "en" ? "en" : args.lang === "fr" ? "fr" : config.lang;
  template.$schema = toPosix(path.relative(dir, path.join(ENGINE, "schema", "plan.schema.json")));
  await writeJson(path.join(dir, "plan.json"), template);
  console.log(`created: ${toPosix(path.relative(config.root, path.join(dir, "plan.json")))}`);
  return 0;
}

// --- wait -----------------------------------------------------------------------------------------

// Keep this command attached to the client's tool job: it exits on "Send the plan to AI".
// Claude receives background completion; Codex and Antigravity await the tracked job's digest.
async function wait(config) {
  const id = await pickPlan(config);
  const timeout = args.timeout ? Number(args.timeout) * 1000 : Infinity;
  const started = Date.now();
  for (;;) {
    const state = await loadState(config, id);
    if (state.status === "submitted") {
      const digest = await buildDigest(config, id);
      console.log(`The person sent round ${state.round} of "${id}".\n`);
      console.log(digest.markdown);
      console.log(`\n(written to ${digest.path})`);
      return 0;
    }
    if (state.status === "exported") {
      console.log(`plan "${id}" is already finalized: nothing to wait for`);
      return 2;
    }
    if (Date.now() - started > timeout) {
      console.log(`timed out: still at round ${state.round} (status "${state.status}")`);
      return 3;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// --- import, migrate --------------------------------------------------------------------------------

async function importCommand() {
  const file = args._[1];
  if (!file || !args.out) throw new Error("usage: import <file> --out <dir>");
  const ext = path.extname(file).toLowerCase();
  const out = path.resolve(String(args.out));
  if (ext === ".md" || ext === ".txt") {
    await mkdir(out, { recursive: true });
    await copyFile(file, path.join(out, `source${ext}`));
    console.log(`copied: ${toPosix(path.join(out, `source${ext}`))} (a .md or .txt file is read directly)`);
    return 0;
  }
  if (ext === ".pdf") {
    console.log("a .pdf is read with Claude's Read tool, a range of pages at a time (pages: \"1-20\"): no conversion.");
    return 0;
  }
  if (ext !== ".docx") throw new Error(`unsupported format: ${ext} (.md, .txt, .docx, .pdf)`);
  try {
    const { importDocx } = await import("./lib/import/docx.mjs");
    const result = await importDocx(path.resolve(file), { outDir: out });
    console.log(`converted: ${toPosix(result.mdPath ?? path.join(out, "source.md"))} (${result.media.length} media file(s))`);
    for (const warning of result.warnings) console.log(`   ! ${warning}`);
    return 0;
  } catch (error) {
    console.error(`.docx reader: ${error.message} — trying pandoc`);
    return pandoc(file, out);
  }
}

function pandoc(file, out) {
  return new Promise((resolve) => {
    const child = spawn("pandoc", [file, "-t", "gfm", "--extract-media", out, "-o", path.join(out, "source.md")], { stdio: "inherit" });
    child.on("error", () => {
      console.error("pandoc not found: read the document another way (convert it to .md or .pdf).");
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}


// --- snap -----------------------------------------------------------------------------------------

async function snap(config) {
  const { findBrowser, openBrowser: launch } = await import("./lib/browser.mjs");
  if (!findBrowser()) throw new Error("no Chromium browser found (set FLUIDPLAN_BROWSER to point to one)");
  const id = await pickPlan(config);
  const out = path.resolve(String(args.out ?? "fluidplan-snaps"));
  await mkdir(out, { recursive: true });
  const themes = String(args.themes ?? "light").split(",");
  const widths = String(args.widths ?? "1400").split(",").map(Number);
  config.port = 5900 + Math.floor(Math.random() * 400);
  const { server, port } = await startServer(config, { plan: id, quiet: true, register: false });
  const bundle = await (await fetch(`http://127.0.0.1:${port}/api/bundle?id=${id}`)).json();
  const pages = args.pages ? String(args.pages).split(",") : ["_home", ...bundle.plan.pages.map((p) => p.id), "_summary"];
  const browser = await launch({ width: widths[0], height: 1000 });
  let shots = 0;
  try {
    for (const width of widths) {
      await browser.resize(width, 1000);
      for (const theme of themes) {
        for (const [index, pageId] of pages.entries()) {
          const url = `http://127.0.0.1:${port}/?plan=${encodeURIComponent(id)}&theme=${theme}&snap=${shots}#/${pageId}`;
          await browser.goto(url, 900);
          const file = path.join(out, `${String(index + 1).padStart(2, "0")}_${pageId}_${theme}_${width}.png`);
          await browser.screenshot(file);
          shots += 1;
          if (await browser.eval("document.documentElement.scrollWidth > window.innerWidth + 1")) {
            browser.problems.push(`horizontal scroll: ${pageId} (${theme}, ${width} px)`);
          }
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`${shots} screenshot(s) in ${toPosix(out)}`);
  if (browser.problems.length) {
    console.log(`${browser.problems.length} problem(s) in the page:`);
    for (const problem of browser.problems) console.log(`  - ${problem}`);
    return 1;
  }
  console.log("no console errors");
  return 0;
}

// --- images -----------------------------------------------------------------------------------------

async function images(config) {
  const id = await pickPlan(config);
  const sub = args._[1] ?? "status";
  if (sub === "status") {
    const state = await imagesState(config, id);
    console.log(`illustrations for "${id}" — at most ${state.quota} per service and per plan`);
    for (const p of state.providers) {
      const status = !p.configured ? "no key" : `${p.used} / ${state.quota} used, model ${p.model}`;
      console.log(`  ${p.id.padEnd(7)} ${p.label}: ${status}`);
    }
    for (const item of state.items) console.log(`  - ${item.id} (${item.target}) ${item.file}${state.selected[item.target] === item.id ? " ← selected" : ""}`);
    return 0;
  }
  if (sub === "generate") {
    if (!args.target || !args.provider) throw new Error("--target <page:id|decision:id> and --provider are required");
    const state = await loadState(config, id);
    if (state.status === "exported") throw new Error("the plan is finalized: no more illustrations");
    console.log(`generating (${args.provider}): this can take a few minutes…`);
    const result = await generateForPlan(config, id, {
      provider: String(args.provider),
      target: String(args.target),
      prompt: args.prompt ? String(args.prompt) : undefined,
      aspect: args.aspect ? String(args.aspect) : undefined,
      transparent: args.transparent ? true : undefined,
    });
    const usage = result.state.providers.find((p) => p.id === args.provider);
    console.log(`written: ${result.path} — ${usage.used} / ${result.state.quota} used for ${args.provider}${result.item.credits ? ` (${result.item.credits} credits)` : ""}`);
    return 0;
  }
  if (sub === "select") {
    if (!args.target || !args.image) throw new Error("--target and --image are required");
    await selectImage(config, id, { target: String(args.target), image: String(args.image) });
    console.log(`selected for ${args.target}: ${args.image}`);
    return 0;
  }
  throw new Error(`unknown subcommand: images ${sub} (status, generate, select)`);
}

// --- helpers --------------------------------------------------------------------------------------

// "decision C1: no why", "decision C2: no why"… → one line that lists the decisions.
function groupWarnings(warnings) {
  const groups = new Map();
  const out = [];
  for (const warning of warnings) {
    const match = warning.match(/^decision (\S+): (.+)$/);
    if (!match) {
      out.push(warning);
      continue;
    }
    if (!groups.has(match[2])) groups.set(match[2], []);
    groups.get(match[2]).push(match[1]);
  }
  for (const [message, ids] of groups) out.push(ids.length > 1 ? `${message} — ${ids.length} decisions: ${ids.join(", ")}` : `decision ${ids[0]}: ${message}`);
  return out;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function parseArgs(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i += 1) {
    const arg = list[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = list[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
