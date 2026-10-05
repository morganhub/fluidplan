// Revision rounds. The page sends a round (submit); Claude reads the digest and revises plan.json,
// setting `revision.round = n + 1` on every decision it reworks; next-round resets those answers
// and reopens the page; finalize writes the outputs once everything is decided.
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { httpError, readJson, toPosix, writeAtomic, writeJson } from "./fsutil.mjs";
import { loadAnswers, loadPlan, loadState, planFiles, saveAnswers, saveState } from "./plans.mjs";
import { checkPlan } from "./check.mjs";
import { langOf, translator, writeOutputs } from "./outputs.mjs";
import { approvalFor } from "./approval.mjs";
import { allDecisions, controlSummary, counts, dependents, importanceOf, itemVerdict, needsRevision, readiness, verdict } from "../public/js/model.js";

// Freezes the round: the archive keeps what the person saw and answered.
export async function submitRound(config, id) {
  const state = await loadState(config, id);
  if (state.status !== "review") throw httpError(409, `this round was already sent (status "${state.status}")`);
  const files = planFiles(config, id);
  const dir = files.round(state.round);
  await mkdir(dir, { recursive: true });
  await copyFile(files.plan, path.join(dir, "plan.json"));
  const answers = await loadAnswers(config, id);
  await writeJson(path.join(dir, "answers.json"), answers);
  const plan = await loadPlan(config, id);
  const now = new Date().toISOString();
  state.status = "submitted";
  state.submitted_at = now;
  state.history = [...(state.history ?? []).filter((h) => h.round !== state.round), { round: state.round, submitted_at: now, counts: counts(plan, answers) }];
  await saveState(config, id, state);
  return state;
}

// How many rounds a decision has already needed a revision: beyond three, it is better settled
// in conversation.
async function revisionCount(config, id, decisionId, upTo) {
  let n = 0;
  for (let round = 1; round <= upTo; round += 1) {
    const dir = planFiles(config, id).round(round);
    if (!existsSync(path.join(dir, "answers.json"))) continue;
    const plan = await readJson(path.join(dir, "plan.json"), null);
    const answers = await readJson(path.join(dir, "answers.json"), {});
    const decision = plan && allDecisions(plan).find(({ decision: d }) => d.id === decisionId)?.decision;
    if (decision && needsRevision(decision, answers[decisionId])) n += 1;
  }
  return n;
}

export async function buildDigest(config, id) {
  const plan = await loadPlan(config, id);
  const answers = await loadAnswers(config, id);
  const state = await loadState(config, id);
  const t = translator(langOf(plan, config));
  const approval = await approvalFor(config, id, plan, answers, state);
  const n = state.round;
  const L = [];
  const rows = allDecisions(plan);
  const get = (d) => answers[d.id] ?? {};
  const toProcess = rows.filter(({ decision }) => needsRevision(decision, get(decision)));
  const rejected = rows.filter(({ decision }) => verdict(decision, get(decision)) === "ko");
  const pending = rows.filter(({ decision }) => verdict(decision, get(decision)) === "pending");
  const validated = rows.filter(({ decision }) => !toProcess.some((r) => r.decision === decision) && ["ok", "mixed"].includes(verdict(decision, get(decision))));

  L.push(`# Round ${n} — digest for the AI assistant`, "");
  L.push(`> Plan "${plan.title}" (\`${id}\`) · status \`${state.status}\`${state.submitted_at ? ` · sent on ${state.submitted_at}` : ""}.`);
  L.push(`> For each decision under "To rework": work the answer into \`plan.json\` and set \`"revision": { "round": ${n + 1}, "note": "…" }\` (what changed, in one or two sentences addressed to the person).`);
  L.push('> A rewrite by the person is taken word for word. A question ("Question asked") is answered by expanding `why` or `learn_more`.');
  L.push("> Then `fluidplan check`, then `fluidplan next-round`.", "");

  L.push(`## To rework (${toProcess.length})`, "");
  if (!toProcess.length) L.push("_Nothing to rework._", "");
  for (const { decision } of toProcess) {
    const answer = get(decision);
    const v = verdict(decision, answer);
    L.push(`### ${decision.id} · ${decision.title} [${importanceOf(decision)}] — ${t(`verdict.${v}`)}`, "");
    if (String(answer.comment ?? "").trim()) L.push(`- ${v === "explain" ? "Question" : "Remark"}: "${answer.comment.trim()}"`);
    const summary = controlSummary(decision, answer, plan, t);
    if (summary) L.push(`- Control answer: ${summary}`);
    for (const [key, value] of Object.entries(answer.edits ?? {})) {
      if (String(value ?? "").trim()) L.push(`- Rewrite of \`${key}\`: "${String(value).trim()}"`);
    }
    for (const item of decision.items ?? []) {
      const state2 = answer.items?.[item.id];
      if (itemVerdict(answer, item.id) === "modify") L.push(`- Item \`${item.id}\` (${item.title}) to change: "${String(state2?.comment ?? "").trim()}"`);
    }
    const deps = dependents(plan, decision.id);
    if (deps.length) L.push(`- Dependents to re-check: ${deps.join(", ")}`);
    const times = await revisionCount(config, id, decision.id, n);
    if (times >= 3) L.push(`- **${times} rounds** of revision on this decision: offer to settle it in conversation.`);
    L.push("");
  }

  L.push(`## Rejected (${rejected.length})`, "");
  L.push("No revision required: they stay rejected. Propose another route (a new decision) only if the plan needs one.", "");
  for (const { decision } of rejected) L.push(`- **${decision.id} · ${decision.title}**${get(decision).comment ? ` — "${get(decision).comment.trim()}"` : ""}`);
  if (rejected.length) L.push("");

  L.push(`## No answer (${pending.length})`, "");
  L.push(pending.length ? `Still open in the next round: ${pending.map(({ decision }) => decision.id).join(", ")}.` : "_None._", "");

  L.push(`## Accepted (${validated.length}) — do not touch`, "");
  L.push(validated.length ? validated.map(({ decision }) => decision.id).join(", ") : "_None._", "");

  L.push("## Next step", "");
  let nextAction = "revise";
  if (!toProcess.length && !pending.length) {
    if (!approval.approved) {
      nextAction = "review";
      L.push("The current plan is not approved as submitted. Do not execute it: present any changed scope in a new review and obtain submission.");
    } else {
      nextAction = approval.autoExecute ? "finalize_and_execute" : "finalize";
      L.push(`Everything is decided: \`fluidplan finalize --plan ${id}\` writes PLAN.md and DECISIONS.md.`);
      if (approval.autoExecute) L.push("On Codex, continue immediately with the accepted tasks in PLAN.md, in this same active turn. Do not ask for another chat approval. Rejected decisions are excluded; existing execution permissions and the user's scope still apply.");
      else L.push(approval.mode === "review" ? "Review only: return the documents without implementing the plan." : "No retained tasks: there is no implementation to execute.");
    }
  }
  else if (!toProcess.length) L.push(`Nothing to rework, but ${pending.length} decision(s) without an answer: \`fluidplan next-round --plan ${id}\` reopens the page as is.`);
  else L.push(`Revise the ${toProcess.length} decision(s) above, run \`fluidplan check --plan ${id}\`, then \`fluidplan next-round --plan ${id}\`.`);
  L.push("");

  const markdown = L.join("\n");
  const file = path.join(planFiles(config, id).round(n), "digest.md");
  await writeAtomic(file, markdown);
  return { markdown, path: toPosix(path.relative(config.root, file)), toProcess: toProcess.map(({ decision }) => decision.id), pending: pending.map(({ decision }) => decision.id), nextAction, approval };
}

export async function nextRound(config, id, { force = false } = {}) {
  const state = await loadState(config, id);
  if (state.status !== "submitted") throw new Error(`next-round expects a sent round (current status "${state.status}")`);
  const n = state.round;
  const files = planFiles(config, id);
  const archived = await readJson(path.join(files.round(n), "plan.json"), null);
  if (!archived) throw new Error(`round ${n} archive missing (${toPosix(path.relative(config.root, files.round(n)))})`);
  const { plan, errors } = await checkPlan(config, id);
  if (errors.length) throw new Error(`plan.json has ${errors.length} error(s): run "fluidplan check" and fix them first`);
  const answers = await loadAnswers(config, id);

  const current = new Map(allDecisions(plan).map(({ decision }) => [decision.id, decision]));
  const untouched = [];
  for (const { decision } of allDecisions(archived)) {
    if (!needsRevision(decision, answers[decision.id])) continue;
    const now = current.get(decision.id);
    if (now && now.revision?.round !== n + 1) untouched.push(decision.id);
  }
  if (untouched.length && !force) {
    throw new Error(`decision(s) to rework without "revision.round: ${n + 1}": ${untouched.join(", ")} (--force to override)`);
  }

  const reset = [];
  const removed = [];
  for (const decisionId of Object.keys(answers)) {
    const decision = current.get(decisionId);
    if (!decision) {
      delete answers[decisionId];
      removed.push(decisionId);
      continue;
    }
    if (decision.revision?.round !== n + 1) continue;
    // A revised list keeps the items already decided (OK, Not OK) that still exist.
    const kept = {};
    for (const item of decision.items ?? []) {
      const status = answers[decisionId].items?.[item.id]?.status;
      if (status === "ok" || status === "ko") kept[item.id] = answers[decisionId].items[item.id];
    }
    if (Object.keys(kept).length) answers[decisionId] = { items: kept, round: n + 1 };
    else delete answers[decisionId];
    reset.push(decisionId);
  }
  await saveAnswers(config, id, answers);
  Object.assign(state, { round: n + 1, status: "review", opened_at: new Date().toISOString(), submitted_at: null });
  await saveState(config, id, state);
  return { round: n + 1, reset, removed, untouched };
}

export async function finalize(config, id, { force = false } = {}) {
  const { plan, errors } = await checkPlan(config, id);
  if (errors.length) throw new Error(`plan.json has ${errors.length} error(s): run "fluidplan check"`);
  const answers = await loadAnswers(config, id);
  const ready = readiness(plan, answers);
  if (!ready.ready && !force) {
    const parts = [];
    if (ready.pending.length) parts.push(`no answer: ${ready.pending.join(", ")}`);
    if (ready.revise.length) parts.push(`to rework: ${ready.revise.join(", ")}`);
    throw new Error(`the plan is not ready (${parts.join("; ")}) — --force writes a draft`);
  }
  const state = await loadState(config, id);
  if (ready.ready) state.status = "ready";
  const approval = await approvalFor(config, id, plan, answers, state);
  const written = await writeOutputs(config, id);
  if (ready.ready) {
    state.status = "exported";
    state.exported_at = new Date().toISOString();
  }
  await saveState(config, id, state);
  return { ...written, draft: !ready.ready, approval };
}
