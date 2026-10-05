// Answers → PLAN.md, the plan to execute: working rules, tasks numbered by phase with files,
// acceptance criteria and verify commands, then what is out of scope.
// Pure module, shared by the page (preview) and the server (writing).
import { headerLines, indentBlock, oneLine, punctuation, quote } from "./export_common.js";
import { allDecisions, controlSummary, importanceOf, itemVerdict, resolvePlanTasks, textOf, verdict } from "./model.js";

export function buildPlanMd(plan, answers, { t, now = new Date(), state = {} } = {}) {
  const { colon } = punctuation(t);
  const get = (id) => answers?.[id] ?? {};
  const L = [];
  L.push(`# ${t("planMd.title", { title: plan.title })}`, "");
  const header = headerLines(plan, answers, { t, now, state });
  L.push(...header.lines);
  L.push(`> ${t("planMd.regenerate", { id: plan.id })}`, "");

  if (plan.summary) {
    L.push(`## ${t("home.goal")}`, "", plan.summary.goal, "");
    for (const key of ["changes", "risks"]) if (plan.summary[key]?.length) L.push(`### ${t(`home.${key}`)}`, "", ...plan.summary[key].map((text) => `- ${text}`), "");
  }
  if (plan.context) L.push(`## ${t("planMd.context")}`, "", plan.context.trim(), "");

  const resolved = resolvePlanTasks(plan, answers);
  const withTasks = new Set([...resolved.byRef.values()].map((entry) => entry.decision.id));
  const rows = allDecisions(plan);

  // Accepted decisions that produce no task: they are rules to follow.
  const rules = rows.filter(({ decision }) => verdict(decision, get(decision.id)) !== "ko" && !withTasks.has(decision.id));
  if (rules.length) {
    L.push(`## ${t("planMd.rules")}`, "");
    for (const { decision } of rules) {
      const answer = get(decision.id);
      const summary = controlSummary(decision, answer, plan, t, { effective: true });
      const proposal = oneLine(textOf(answer, "proposal", decision.proposal));
      L.push(`- **${decision.id} · ${decision.title}**${summary ? ` — ${summary}` : ""}${stateMark(decision, answer, t)}${proposal ? `. ${proposal}` : ""}`);
      if (String(answer.comment ?? "").trim()) L.push(`  - ${t("planMd.remark")}${colon} ${quote(answer.comment, t)}`);
    }
    L.push("");
  }

  const seen = new Set();
  const push = (entry) => {
    pushTask(L, entry, resolved, plan, t, !seen.has(entry.decision.id));
    seen.add(entry.decision.id);
  };

  if (resolved.loose.length) {
    L.push(`## ${t("planMd.transverse")}`, "");
    resolved.loose.forEach(push);
  }

  for (const group of resolved.groups) {
    const meta = [group.phase.estimate, group.phase.cost].filter(Boolean).join(" · ");
    L.push(`## ${t("planMd.phase", { n: group.index + 1, title: group.phase.title })}${meta ? ` (${meta})` : ""}`, "");
    if (!group.entries.length) {
      L.push(`_${t("planMd.emptyPhase")}_`, "");
      continue;
    }
    group.entries.forEach(push);
  }

  const commands = [];
  for (const entry of resolved.byRef.values()) for (const command of entry.task.verify ?? []) if (!commands.includes(command)) commands.push(command);
  if (commands.length) {
    L.push(`## ${t("planMd.finalCheck")}`, "");
    for (const command of commands) L.push(`- [ ] \`${command}\``);
    L.push("");
  }

  const out = [];
  for (const { decision } of rows) {
    const answer = get(decision.id);
    if (verdict(decision, answer) === "ko") {
      out.push(`- **${decision.id} · ${decision.title}** — ${t("verdict.ko").toLowerCase()}${answer.comment ? `${colon} ${quote(answer.comment, t)}` : ""}`);
      continue;
    }
    for (const item of decision.items ?? []) {
      if (itemVerdict(answer, item.id) !== "ko") continue;
      const comment = answer.items?.[item.id]?.comment;
      out.push(`- **${decision.id}** / ${item.title} — ${t("verdict.ko").toLowerCase()}${comment ? `${colon} ${quote(comment, t)}` : ""}`);
    }
  }
  if (out.length) L.push(`## ${t("planMd.outOfScope")}`, "", ...out, "");

  return finish(L);
}

function stateMark(decision, answer, t) {
  const v = verdict(decision, answer);
  return v === "ok" || v === "mixed" ? "" : ` _(${t(`verdict.${v}`).toLowerCase()})_`;
}

function pushTask(L, entry, resolved, plan, t, first) {
  const { colon } = punctuation(t);
  const { task, decision, answer } = entry;
  const number = resolved.numbers.get(entry.ref);
  L.push(`### [ ] ${number} ${task.title}${stateMark(decision, answer, t)} · ${decision.id}`, "");
  const summary = controlSummary(decision, answer, plan, t, { effective: true });
  const importance = importanceOf(decision);
  L.push(`- ${t("planMd.decision")}${colon} **${decision.id}** ${decision.title}${summary ? ` — ${summary}` : ""}${importance === "critical" ? ` [${t("importance.critical").toLowerCase()}]` : ""}`);
  if (task.files?.length) {
    L.push(`- ${t("planMd.files")}${colon} ${task.files.map((f) => `\`${f.path}\` (${t(`op.${f.op ?? "modify"}`)})`).join(", ")}`);
  }
  if (task.do) L.push(`- ${t("planMd.do")}${colon} ${indentBlock(task.do)}`);
  if (task.acceptance?.length) {
    L.push(`- ${t("planMd.acceptance")}${colon}`);
    for (const criterion of task.acceptance) L.push(`  - [ ] ${oneLine(criterion)}`);
  }
  if (task.verify?.length) L.push(`- ${t("planMd.verify")}${colon} ${task.verify.map((c) => `\`${c}\``).join(" · ")}`);
  const after = resolved.after(entry);
  if (after.length) L.push(`- ${t("planMd.after")}${colon} ${after.join(", ")}`);
  if (first) {
    if (String(answer.comment ?? "").trim()) L.push(`- ${t("planMd.remark")}${colon} ${quote(answer.comment, t)}`);
    const kept = (decision.items ?? []).filter((item) => itemVerdict(answer, item.id) !== "ko");
    if (kept.length) {
      L.push(`- ${t("planMd.items")}${colon}`);
      for (const item of kept) {
        const state = answer.items?.[item.id] ?? {};
        const detail = oneLine(textOf(answer, `items/${item.id}/detail`, item.detail));
        const mark = itemVerdict(answer, item.id) === "ok" ? "" : ` _(${t(`itemVerdict.${itemVerdict(answer, item.id)}`).toLowerCase()})_`;
        L.push(`  - ${item.title}${item.tag ? ` (${item.tag})` : ""}${detail ? ` — ${detail}` : ""}${mark}${state.comment ? ` · ${t("planMd.remark").toLowerCase()}${colon} ${quote(state.comment, t)}` : ""}`);
      }
    }
  }
  L.push("");
}

function finish(L) {
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
