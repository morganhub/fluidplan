// End-to-end test, never touching real answers: the test plan is copied to a temporary project,
// served by the CLI, driven in a headless browser, then a full round is played (send, digest,
// simulated revision of plan.json, next round reloaded by the page, finalize).
//
//   node test/smoke.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, openBrowser } from "../engine/lib/browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "engine", "fluidplan.mjs");
const ID = "mini";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.stack ?? error}`);
  }
}

if (!findBrowser()) {
  console.log("skip  browser run: no Chromium-based browser found (set FLUIDPLAN_BROWSER)");
  process.exit(0);
}

const root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-smoke-"));
const planDir = path.join(root, ".fluidplan", ID);
cpSync(path.join(HERE, "fixtures", "plans", ID), planDir, { recursive: true });
// One page gets an illustration to generate; the image service is simulated (no call, no credit).
{
  const file = path.join(planDir, "plan.json");
  const plan = JSON.parse(readFileSync(file, "utf8"));
  plan.summary = { goal: "Cache sessions while keeping expiry predictable.", changes: ["Add a cache and expiry notices."], risks: ["Expired sessions must never stay valid."] };
  plan.pages[0].decisions[0].tradeoff = "Memory is limited to a single process.";
  plan.pages.find((p) => p.id === "interface").visual = { kind: "image", prompt: "Session expiry banner in a web app, flat style", aspect: "16:9" };
  writeFileSync(file, JSON.stringify(plan, null, 2));
}
const cli = (...args) => execFileSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8" });
const port = 5600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [CLI, "serve", "--root", root, "--port", String(port)], {
  stdio: "ignore",
  env: { ...process.env, FLUIDPLAN_ENV_FILE: "none", FLUIDPLAN_FAKE_IMAGES: "1", GEMINI_API_KEY: "simulated" },
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i += 1) {
  try {
    await fetch(`${base}/api/config`);
    break;
  } catch {
    await sleep(100);
  }
}

const browser = await openBrowser({ width: 1280, height: 900 });
const js = (code) => browser.eval(`(async () => { ${code} })()`);
const click = (selector) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing: " + ${JSON.stringify(selector)}); el.click(); return true;`);
const type = (selector, text) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing: " + ${JSON.stringify(selector)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
const text = (selector) => js(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? null;`);
const api = async (route, options) => (await fetch(`${base}${route}`, options)).json();
const waitFor = async (predicate, what, timeout = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate().catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`timed out: ${what}`);
};

try {
  await check("reading densities preserve drafts, preferences, choices and critical warnings", async () => {
    await browser.goto(`${base}/?reading=home#/_home`, 900);
    assert.match(await text(".home-synthesis"), /Cache sessions/);
    assert.equal(await js('return document.querySelector(".reading-detail").open;'), false);
    await browser.goto(`${base}/?reading=decision#/storage`, 900);
    assert.equal(await js('return document.documentElement.dataset.density;'), "summary");
    assert.match(await text("#d-D1 .alert-warning"), /./, "critical context stays visible");
    assert.match(await text("#d-D1 .decision-tradeoff"), /single process/);
    assert.equal(await js('return document.querySelector("#d-D1 input[value=memory]").getClientRects().length > 0;'), true);
    await click("#d-D1 .editable-trigger");
    await type("#d-D1 .editable-editor textarea", "Unsaved proposal");
    await click(".density-button");
    assert.equal(await js('return document.querySelector("#d-D1 .editable-editor textarea").value;'), "Unsaved proposal");
    assert.equal(await js('return [...document.querySelectorAll(".reading-detail")].every(d => d.open);'), true);
    await click("#d-D1 .editable-buttons .btn:nth-child(2)");
    await browser.goto(`${base}/?reading=persist#/storage`, 900);
    assert.equal(await js('return document.documentElement.dataset.density;'), "detailed");
    await click(".density-button");
    await browser.resize(390, 844);
    assert.equal(await js('return document.documentElement.scrollWidth <= innerWidth;'), true);
    assert.equal(await js('return getComputedStyle(document.querySelector(".toggle-label")).display !== "none";'), true);
    assert.equal(await js('const footer = document.querySelector("#d-D1 .card-footer").getBoundingClientRect(); return [...document.querySelectorAll("#d-D1 .card-footer .toggle")].every(b => { const r = b.getBoundingClientRect(); return r.left >= footer.left && r.right <= footer.right; });'), true, "named mobile verdicts fit inside the card");
    assert.equal(await js('return getComputedStyle(document.querySelector(".submit-button span")).display !== "none";'), true);
    await browser.resize(1280, 900);
  });

  await check("round 1: choice, slider driving an extension, minor points, rewrite, change", async () => {
    await browser.goto(`${base}/#/storage`, 900);
    await click('#d-D1 input[value="memory"]');
    await click(".density-button");
    await click(".density-button");
    assert.equal(await js('return document.querySelector("#d-D1 .decision-details").open;'), false, "accepted card folds in summary mode");
    assert.match(await text("#d-D1 .retained-choice"), /In-process memory/);
    assert.match(await text("#d-D1 .alert-warning"), /./);
    await click("#d-D1 .decision-details > summary");
    assert.equal(await js('return document.querySelector("#d-D1 input[value=memory]").checked;'), true, "folding preserves the choice");
    await click("#d-D1 .editable-trigger");
    await type("#d-D1 .editable-editor textarea", "An in-process cache first, Redis later if we scale out.");
    await click("#d-D1 .editable-editor .btn");
    await js(`const r = document.querySelector("#d-D2 input[type=range]"); r.value = "45"; r.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
    assert.equal(await text("#d-D2 .x-load .stat-value"), "10 %", "the extension follows the slider");
    await click("#d-D2 .card-footer .toggle.tone-modify");
    await type("#d-D2 .card-footer textarea.comment", "Make it configurable per environment.");
    await click(".minor-block .minor-intro .btn");
    await sleep(700);
  });

  await check("round 1: list item by item, question, multi select, phase order", async () => {
    await browser.goto(`${base}/?r=1#/interface`, 900);
    await click("#item-D4-login .toggle.tone-ok");
    await click("#item-D4-profile .toggle.tone-ko");
    await click("#d-D4 .card-footer .toggle.tone-explain");
    await type("#d-D4 .card-footer textarea.comment", "Why not show the expiry time on every screen?");
    await click('#d-D6 input[value="email"]');
    await click("#d-D5 .order li:first-child .order-moves .btn:last-child");
    await sleep(900);

    const saved = await api(`/api/answers?id=${ID}`);
    assert.equal(saved.D1.choice, "memory");
    assert.equal(saved.D1.status, "modify", "a rewrite counts as a change");
    assert.equal(saved.D1.edits.proposal, "An in-process cache first, Redis later if we scale out.");
    assert.equal(saved.D2.value, 45);
    assert.equal(saved.D2.status, "modify");
    assert.equal(saved.D3.status, "ok");
    assert.deepEqual(saved.D4.items, { login: { status: "ok" }, profile: { status: "ko" } });
    assert.equal(saved.D4.status, "explain");
    assert.deepEqual(saved.D6.choices, ["email"]);
    assert.deepEqual(saved.D5.order, ["p2", "p1"]);
  });

  await check("illustration: generate from the page, per-plan counter", async () => {
    await click(".page-visual .illustration-empty .btn");
    await sleep(300);
    assert.equal(await js(`return document.querySelector('dialog.dialog input[value="gemini"]').checked;`), true, "the only configured service is preselected");
    assert.equal(await js(`return document.querySelector('dialog.dialog input[value="openai"]').disabled;`), true, "no key: not selectable");
    await click("dialog.dialog .dialog-footer .btn:last-child");
    await waitFor(async () => js(`return Boolean(document.querySelector(".page-visual .illustration-figure img"));`), "image shown");
    const state = await api(`/api/images?id=${ID}`);
    assert.equal(state.providers.find((p) => p.id === "gemini").used, 1);
    assert.equal(state.items[0].target, "page:interface");
    assert.ok(existsSync(path.join(planDir, state.items[0].file)));
  });

  await check("send the round from the page: read-only, answers frozen", async () => {
    await click(".submit-button");
    await sleep(300);
    await click("dialog.dialog .dialog-footer .btn:last-child");
    await waitFor(async () => (await api(`/api/state?id=${ID}`)).status === "submitted", "status submitted");
    await waitFor(async () => (await text(".banners"))?.includes("Round 1 sent"), "banner after reload");
    const refused = await fetch(`${base}/api/answers?id=${ID}&round=1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(refused.status, 409);
  });

  await check("digest, simulated revision by Claude, round 2 reloaded by the page", async () => {
    const digest = cli("digest", "--plan", ID);
    for (const id of ["D1", "D2", "D4"]) assert.match(digest, new RegExp(`### ${id} · `));
    assert.match(digest, /An in-process cache first, Redis later/);
    assert.match(digest, /Why not show the expiry time on every screen\?/);
    const file = path.join(planDir, "plan.json");
    const plan = JSON.parse(readFileSync(file, "utf8"));
    const d = (id) => plan.pages.flatMap((p) => p.decisions ?? []).find((x) => x.id === id);
    d("D1").proposal = "An in-process cache first, Redis later if we scale out.";
    // The option the person picked becomes the recommended one: validating it again keeps it.
    for (const option of d("D1").control.options) option.recommended = option.id === "memory";
    d("D1").revision = { round: 2, note: "Your rewrite, taken as is." };
    d("D2").proposal = "A sliding TTL, 30 minutes by default, set per environment.";
    d("D2").revision = { round: 2, note: "The TTL is now read from the environment." };
    d("D4").why += " Showing it everywhere adds noise: only the sign-in and profile screens need it.";
    d("D4").revision = { round: 2, note: "Explained why only two screens show the state." };
    writeFileSync(file, JSON.stringify(plan, null, 2));
    cli("next-round", "--plan", ID);
    await waitFor(async () => (await text(".banners"))?.includes("Round 2"), "reload into round 2");
    await browser.goto(`${base}/?r=5#/storage`, 900);
    assert.equal(await js(`return document.querySelector("#d-D1 .d-meta")?.textContent.includes("Revised");`), true);
    assert.equal(await js(`return document.querySelector("#d-D1").hidden;`), false, "\"To do\" by default: D1 is back to review");
    await click("#d-D2 .revision .btn");
    assert.match(await text("#d-D2 .diff-panel"), /set per environment/);
  });

  await check("settle everything, send, finalize: PLAN.md and DECISIONS.md", async () => {
    const bundle = await api(`/api/bundle?id=${ID}`);
    const current = bundle.answers;
    for (const page of bundle.plan.pages) {
      for (const decision of page.decisions ?? []) {
        const a = current[decision.id] ?? {};
        if (decision.items?.length) {
          const items = { ...(a.items ?? {}) };
          for (const item of decision.items) if (!items[item.id]?.status) items[item.id] = { status: "ok" };
          current[decision.id] = { ...a, items };
        } else if (!a.status) {
          current[decision.id] = { ...a, status: "ok" };
        }
      }
    }
    const put = await fetch(`${base}/api/answers?id=${ID}&round=2`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current) });
    assert.equal(put.status, 200);
    await api(`/api/submit?id=${ID}`, { method: "POST" });
    assert.match(cli("digest", "--plan", ID), /continue immediately with the accepted tasks/, "round 2 starts automatic execution");
    cli("finalize", "--plan", ID);
    const planMd = readFileSync(path.join(planDir, "PLAN.md"), "utf8");
    const decisionsMd = readFileSync(path.join(planDir, "DECISIONS.md"), "utf8");
    assert.doesNotMatch(planMd, /DRAFT/);
    assert.ok(planMd.indexOf("## Phase 1 — Interface") > 0, "the chosen phase order");
    assert.match(planMd, /In-memory LRU cache · D1/, "the task of the chosen option");
    assert.doesNotMatch(planMd, /Add the Redis client/);
    assert.match(planMd, /Expiry e-mail · D6/);
    assert.match(planMd, /## Out of scope[\s\S]*\*\*D4\*\* \/ Profile — rejected/);
    assert.match(decisionsMd, /### D2 · The time to live[\s\S]*?- \*\*History:\*\* round 1: to change → round 2: accepted/);
    assert.equal((await api(`/api/state?id=${ID}`)).status, "exported");
    await waitFor(async () => (await text(".banners"))?.includes("Plan finalized"), "final banner");
  });

  await check("exports render headings and readonly criteria, with contents and raw source views", async () => {
    await browser.goto(`${base}/?reading=export#/_summary`, 900);
    assert.match(await text(".md-document h2"), /Session cache/);
    assert.equal(await js('return [...document.querySelectorAll(".md-document input[type=checkbox]")].every(i => i.disabled);'), true);
    assert.equal(await js('return document.querySelectorAll(".md-document input[type=checkbox]").length > 0;'), true);
    await click(".document-reader details summary");
    const hash = await js("return location.hash;");
    await click(".md-outline .btn");
    assert.equal(await js("return location.hash;"), hash, "contents navigation does not interfere with routing");
    await click("#tab-plan-doc-source");
    assert.match(await text(".md-preview"), /^# Session cache/);
    await click("#tab-plan-doc-read");
    await browser.resize(390, 844);
    assert.equal(await js('return document.documentElement.scrollWidth <= innerWidth;'), true);
  });

  await check("no console error", async () => {
    assert.deepEqual(browser.problems.filter((p) => !p.includes("ERR_ABORTED")), []);
  });
} finally {
  await browser.close();
  server.kill();
  await sleep(300);
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failure(s)` : "\nall green");
process.exitCode = failures ? 1 : 0;
