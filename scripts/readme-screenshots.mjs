// Publishable screenshots from an isolated copy of the bundled example.
// The script plays a demonstration review, simulates the assistant's two revisions,
// and submits/finalizes both rounds. It never executes the example's implementation tasks.
//   npm run screenshots
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "../engine/lib/browser.mjs";
import { resolveConfig } from "../engine/lib/config.mjs";
import { startServer } from "../engine/server.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "engine", "fluidplan.mjs");
const OUT = path.join(REPO, "docs", "images");
const ID = "tech-feature";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-shots-"));
cpSync(path.join(REPO, "examples", "tech-feature"), root, { recursive: true, filter: (file) => path.basename(file) !== "node_modules" });
const planDir = path.join(root, "plans", ID);
for (const entry of ["answers.json", "state.json", "images.json", "rounds", "PLAN.md", "DECISIONS.md", "assets/generated"]) {
  rmSync(path.join(planDir, entry), { recursive: true, force: true });
}
const planFile = path.join(planDir, "plan.json");
process.env.FLUIDPLAN_ENV_FILE = "none";
const cli = (...args) => execFileSync(process.execPath, [CLI, ...args, "--root", root], { encoding: "utf8", env: process.env });
const config = resolveConfig({ root, port: 6300 + Math.floor(Math.random() * 200) });
const { server, port } = await startServer(config, { plan: ID, quiet: true, register: false });
const base = `http://127.0.0.1:${port}`;
mkdirSync(OUT, { recursive: true });
let browser;
let visit = 0;
let shots = 0;
const manifest = [];
const api = async (route, options) => {
  const response = await fetch(`${base}${route}`, options);
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
};
const waitFor = async (predicate, label, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new Error(`timed out: ${label}`);
};
const js = (code) => browser.eval(`(async () => { ${code} })()`);
const click = (selector) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing: " + ${JSON.stringify(selector)}); el.click(); return true;`);
const type = (selector, text) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing field"); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
const go = (page, theme = "light") => browser.goto(`${base}/?plan=${ID}&theme=${theme}&shot=${visit++}#/${page}`, 900);
const scrollTo = (selector, offset = null) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing frame"); const offset = ${JSON.stringify(offset)} ?? document.querySelector(".topbar").getBoundingClientRect().height + 24; window.scrollTo(0, el.getBoundingClientRect().top + scrollY - offset); return true;`);
const shot = async (name) => {
  await sleep(250);
  assert.equal(await js("return document.documentElement.scrollWidth > innerWidth + 1;"), false, `${name}: horizontal overflow`);
  assert.deepEqual(browser.problems.filter((p) => !p.includes("ERR_ABORTED")), [], `${name}: browser errors`);
  await browser.screenshot(path.join(OUT, `${name}.png`), { fullPage: false });
  manifest.push(`${name}.png`);
  shots++;
  console.log(`docs/images/${name}.png`);
};
const send = async () => {
  await click("dialog.dialog .dialog-footer .btn:last-child");
  await waitFor(async () => (await api(`/api/state?id=${ID}`)).status === "submitted", "submitted round");
};

try {
  browser = await openBrowser({ width: 1400, height: 1000 });
  await go("_home");
  assert.match(await js('return document.querySelector(".home-synthesis").textContent;'), /Risks and limitations/);
  await shot("01-home");

  await go("trigger");
  const height = await js('return Math.ceil(document.querySelector("#d-D1").getBoundingClientRect().height + 150);');
  await browser.resize(1400, Math.min(1800, Math.max(1000, height)));
  await scrollTo("#d-D1");
  await shot("02-decision");

  await click(".density-button");
  assert.equal(await js('return document.documentElement.dataset.density;'), "detailed");
  await browser.resize(1400, 1000);
  await scrollTo("#d-D1");
  await shot("11-detailed");
  await click(".density-button");

  await click('#d-D1 input[value="in-process"]');
  await waitFor(async () => (await api(`/api/answers?id=${ID}`)).D1?.status === "ok", "choice saved");
  await go("trigger");
  assert.equal(await js('return document.querySelector("#d-D1 .decision-details").open;'), false);
  assert.equal(await js('return document.querySelector("#d-D1 .alert-warning").getBoundingClientRect().height > 0;'), true);
  await scrollTo("#d-D1");
  await shot("12-accepted");

  await click("#d-D2 .card-footer .toggle.tone-modify");
  await type("#d-D2 .card-footer textarea.comment", "Use the user's time zone, but fall back to UTC when it is unknown.");
  await click("#d-D3 .card-footer .toggle.tone-explain");
  await type("#d-D3 .card-footer textarea.comment", "Why a separate table rather than a column on tasks?");
  await waitFor(async () => Boolean((await api(`/api/answers?id=${ID}`)).D3?.comment), "remarks saved");
  await browser.resize(1400, 1150);
  await scrollTo("#d-D2");
  await shot("03-answer");

  await browser.resize(1400, 1000);
  await go("sending", "dark");
  await scrollTo("#d-D5");
  await shot("09-dark");
  await browser.resize(390, 1000);
  await go("trigger");
  await scrollTo("#d-D4");
  assert.equal(await js('return getComputedStyle(document.querySelector("#d-D4 .toggle-label")).display !== "none";'), true);
  await shot("10-mobile");
  await browser.resize(1400, 1000);

  // Fill the remaining demo cards through the same HTTP API used by the page.
  // This is the temporary example only, never a person's real plan or answers.
  const bundle = await api(`/api/bundle?id=${ID}`);
  const answers = bundle.answers;
  for (const page of bundle.plan.pages) for (const decision of page.decisions ?? []) {
    if (answers[decision.id]?.status) continue;
    answers[decision.id] = decision.items?.length
      ? { items: Object.fromEntries(decision.items.map((item) => [item.id, { status: "ok" }])) }
      : { status: "ok" };
  }
  await api(`/api/answers?id=${ID}&round=1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(answers) });
  await go("_summary");
  await click(".submit-button");
  await shot("04-send");
  await send();
  assert.match(cli("digest", "--plan", ID), /Revise the 2 decision/);

  // Simulated assistant revision, preserving the proposal except where the remark asks for a change.
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const find = (id) => plan.pages.flatMap((p) => p.decisions ?? []).find((d) => d.id === id);
  const d2 = find("D2");
  d2.proposal = "A task is overdue the day after its due date, **from 8 am in the user's time zone**. When the time zone is unknown, UTC is used and the settings page asks the user to confirm it.";
  d2.revision = { round: 2, note: "UTC fallback added, as you asked, with a prompt to confirm the time zone." };
  const d3 = find("D3");
  d3.why = `${d3.why} A column only remembers the last reminder: it cannot tell a daily digest from a weekly one, nor prove that a reminder was sent twice.`;
  d3.revision = { round: 2, note: "Explained: the table keeps one row per reminder, which a column cannot do." };
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
  cli("check", "--plan", ID);
  cli("next-round", "--plan", ID);
  await go("trigger");
  assert.equal(await js('return document.querySelector("#d-D1").hidden;'), true, "accepted decision stays out of the next-round todo filter");
  await shot("05-round-2");
  await click("#d-D2 .revision .btn");
  await browser.resize(1400, 1150);
  await scrollTo("#d-D2");
  assert.equal(await js('return document.querySelector("#d-D2 .diff ins") !== null;'), true);
  await shot("06-revised");

  await click("#d-D2 .card-footer .toggle.tone-ok");
  await click("#d-D3 .card-footer .toggle.tone-ok");
  await waitFor(async () => {
    const a = await api(`/api/answers?id=${ID}`);
    return a.D2?.status === "ok" && a.D3?.status === "ok";
  }, "round 2 accepted");
  await browser.resize(1400, 1000);
  await go("_summary");
  await click(".submit-button");
  await shot("15-approved-send");
  await send();
  assert.match(cli("digest", "--plan", ID), /continue immediately with the accepted tasks/);
  assert.match(cli("finalize", "--plan", ID), /Codex: implement the accepted tasks now/);

  await go("_summary");
  assert.equal((await api(`/api/state?id=${ID}`)).status, "exported");
  await shot("07-summary");
  await scrollTo(".summary-preview");
  await click(".document-reader details > summary");
  await shot("08-plan-md");

  await click(".document-reader details > summary");
  const taskSelector = await js('return [...document.querySelectorAll(".md-document h4")].find(h => h.textContent.includes("1.1"))?.id;');
  assert.ok(taskSelector, "rendered first task");
  await scrollTo(`#${taskSelector}`, 140);
  assert.equal(await js('return document.querySelectorAll(".md-document input[type=checkbox][disabled]").length > 0;'), true);
  await shot("13-plan-task");
  await click("#tab-plan-doc-source");
  await scrollTo(".summary-preview");
  assert.match(await js('return document.querySelector(".md-preview").textContent;'), /^# Email reminders/);
  await shot("14-source");

  const generated = [...readFileSync(path.join(REPO, "README.md"), "utf8").matchAll(/docs\/images\/([^\s)"<>]+\.png)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(generated)].sort(), [...manifest].sort(), "README references every generated screenshot, and only those screenshots");
  console.log(`${shots} screenshots; no overflow or console errors; round 2 approval verified.`);
} finally {
  await browser?.close();
  await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  rmSync(root, { recursive: true, force: true });
}
