import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveConfig } from "../../engine/lib/config.mjs";
import { loadPlan, loadAnswers, loadState, saveAnswers } from "../../engine/lib/plans.mjs";
import { buildDigest, finalize, nextRound, submitRound } from "../../engine/lib/rounds.mjs";

async function fixture(t, mode) {
  const root = await mkdtemp(path.join(os.tmpdir(), "fluidplan-approval-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = resolveConfig({ root });
  const file = path.join(root, ".fluidplan", "approval", "plan.json");
  await mkdir(path.dirname(file), { recursive: true });
  const plan = { version: 2, id: "approval", title: "Implement the reader", context: "A local implementation", pages: [{ id: "reader", title: "Reader", decisions: [
    { id: "D1", title: "Render Markdown", proposal: "Add a reader", tasks: [{ id: "reader", title: "Implement the reader", files: [{ path: "reader.js", op: "create" }], acceptance: ["Markdown is readable"], verify: ["node --check reader.js"] }] },
    { id: "D2", title: "Remote sync", proposal: "Add remote sync", tasks: [{ id: "sync", title: "Add sync", files: [{ path: "sync.js", op: "create" }], acceptance: ["Sync is available"], verify: ["node --check sync.js"] }] },
  ] }] };
  if (mode) plan.execution = mode;
  await writeFile(file, JSON.stringify(plan));
  const answers = { D1: { status: "ok" }, D2: { status: "ko" } };
  await saveAnswers(config, plan.id, answers);
  return { config, id: plan.id, file, plan, answers };
}

test("round 1 submission authorizes retained tasks and finalize carries the signal", async (t) => {
  const f = await fixture(t);
  await submitRound(f.config, f.id);
  const digest = await buildDigest(f.config, f.id);
  assert.equal(digest.nextAction, "finalize_and_execute");
  assert.deepEqual(digest.approval, { mode: "auto", approved: true, tasks: 1, autoExecute: true });
  assert.match(digest.markdown, /Do not ask for another chat approval/);
  assert.equal((await finalize(f.config, f.id)).approval.autoExecute, true);
});

test("unsubmitted answers and forced unresolved exports never authorize execution", async (t) => {
  const f = await fixture(t);
  assert.equal((await buildDigest(f.config, f.id)).approval.autoExecute, false);
  await saveAnswers(f.config, f.id, { ...f.answers, D1: { status: "explain", comment: "Why?" } });
  await submitRound(f.config, f.id);
  const written = await finalize(f.config, f.id, { force: true });
  assert.equal(written.draft, true);
  assert.equal(written.approval.autoExecute, false);
});

test("review-only plans finalize without implementation", async (t) => {
  const f = await fixture(t, "review");
  await submitRound(f.config, f.id);
  const digest = await buildDigest(f.config, f.id);
  assert.equal(digest.approval.approved, true);
  assert.equal(digest.approval.autoExecute, false);
  assert.equal(digest.nextAction, "finalize");
  assert.equal((await finalize(f.config, f.id)).approval.autoExecute, false);
});

test("changing either the submitted plan or answers invalidates automatic execution", async (t) => {
  const f = await fixture(t);
  await submitRound(f.config, f.id);
  await writeFile(f.file, JSON.stringify({ ...f.plan, context: "Broader scope" }));
  assert.equal((await buildDigest(f.config, f.id)).approval.autoExecute, false);
  await writeFile(f.file, JSON.stringify(f.plan));
  await saveAnswers(f.config, f.id, { ...f.answers, D1: { status: "ok", comment: "A different constraint" } });
  assert.equal((await buildDigest(f.config, f.id)).approval.autoExecute, false);
});

test("revisions wait for approval and round 3 starts execution without another chat input", async (t) => {
  const f = await fixture(t);
  for (const round of [1, 2]) {
    await saveAnswers(f.config, f.id, { ...f.answers, D1: { status: "modify", comment: `Change ${round}` } });
    await submitRound(f.config, f.id);
    assert.equal((await buildDigest(f.config, f.id)).approval.autoExecute, false);
    const plan = await loadPlan(f.config, f.id);
    plan.pages[0].decisions[0].revision = { round: round + 1, note: `Change ${round} applied` };
    await writeFile(f.file, JSON.stringify(plan));
    await nextRound(f.config, f.id);
    assert.equal((await loadState(f.config, f.id)).round, round + 1);
    assert.equal((await loadAnswers(f.config, f.id)).D1, undefined);
  }
  await saveAnswers(f.config, f.id, f.answers);
  await submitRound(f.config, f.id);
  assert.equal((await buildDigest(f.config, f.id)).nextAction, "finalize_and_execute");
});

test("all rejected decisions leave no work to execute", async (t) => {
  const f = await fixture(t);
  await saveAnswers(f.config, f.id, { D1: { status: "ko" }, D2: { status: "ko" } });
  await submitRound(f.config, f.id);
  const digest = await buildDigest(f.config, f.id);
  assert.equal(digest.approval.approved, true);
  assert.equal(digest.approval.tasks, 0);
  assert.equal(digest.approval.autoExecute, false);
});
