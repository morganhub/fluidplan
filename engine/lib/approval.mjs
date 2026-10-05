// The assistant consumes this signal; the local server never executes task commands.
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { readJson } from "./fsutil.mjs";
import { planFiles } from "./plans.mjs";
import { allDecisions, readiness, resolvePlanTasks } from "../public/js/model.js";

export async function approvalFor(config, id, plan, answers, state) {
  const mode = plan.execution ?? "auto";
  const settled = readiness(plan, answers).ready;
  const submitted = ["submitted", "ready", "exported"].includes(state.status) && Boolean(state.submitted_at);
  const archive = planFiles(config, id).round(state.round);
  const approvedPlan = submitted ? await readJson(path.join(archive, "plan.json"), null) : null;
  const approvedAnswers = submitted ? await readJson(path.join(archive, "answers.json"), null) : null;
  const unchanged = isDeepStrictEqual(plan, approvedPlan) && isDeepStrictEqual(answers, approvedAnswers);
  const approved = submitted && settled && unchanged && allDecisions(plan).length > 0;
  const tasks = resolvePlanTasks(plan, answers).byRef.size;
  return { mode, approved, tasks, autoExecute: approved && mode === "auto" && tasks > 0 };
}
