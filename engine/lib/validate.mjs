// Checks a v2 plan. Two levels: errors break the display or the export (the plan stays a
// draft), warnings flag a weak plan (missing explanations, a decision with no task…).
// `schema/plan.schema.json` serves the editor; this check enforces the rules that matter.
import { existsSync } from "node:fs";
import path from "node:path";
import { ASPECTS } from "./image_providers.mjs";
import { hasIcon } from "../public/js/icons.js";
import { allDecisions, declaredTasks, findTaskCycles, FILE_OPS, IMPORTANCE } from "../public/js/model.js";

export const BUILTIN_VISUALS = [
  "overview", "cards", "matrix", "bars", "tiers", "icons", "image",
  "timeline", "compare", "file_tree", "risk_matrix", "before_after", "diagram", "code", "stats",
];
const CONTROL_KINDS = new Set(["choice", "multi", "number", "order"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_DECISIONS_PER_PAGE = 6;

// options.visualKinds: kinds brought by the loaded extensions; options.looseVisuals: an extension
// could not be loaded, so an unknown kind is only a warning.
export function validatePlan(plan, { planDir, root, visualKinds = [], looseVisuals = false } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  const warn = (where, message) => warnings.push(`${where}: ${message}`);
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { errors: ["plan: not a JSON object"], warnings };
  if (plan.version !== 2) fail("plan", '"version" must be 2');
  for (const key of ["id", "title", "pages"]) if (!plan[key]) fail("plan", `missing "${key}" field`);
  if (plan.lang && !["fr", "en"].includes(plan.lang)) fail("plan", `unknown language "${plan.lang}" (en, fr)`);
  if (!plan.context) warn("plan", 'no "context": the home page does not explain the request');
  if (plan.execution !== undefined && !["auto", "review"].includes(plan.execution)) fail("plan", '"execution" must be "auto" or "review"');
  const shortText = (where, value, max) => {
    if (typeof value === "string" && value.length > max) warn(where, `${value.length} characters: shorten the visible text and move detail to learn_more`);
  };
  shortText("plan context", plan.context, 1200);
  if (plan.summary !== undefined) {
    if (!plan.summary || typeof plan.summary !== "object" || Array.isArray(plan.summary)) fail("plan", '"summary" must be an object');
    else {
      if (typeof plan.summary.goal !== "string" || !plan.summary.goal.trim()) fail("plan summary", 'missing "goal"');
      shortText("plan summary goal", plan.summary.goal, 240);
      for (const key of ["changes", "risks"]) {
        if (plan.summary[key] !== undefined && (!Array.isArray(plan.summary[key]) || plan.summary[key].some((text) => typeof text !== "string"))) fail("plan summary", `"${key}" must be a list of strings`);
      }
    }
  }

  const kinds = new Set([...BUILTIN_VISUALS, ...visualKinds]);
  const phases = new Set();
  for (const phase of plan.phases ?? []) {
    if (!phase.id || !ID.test(phase.id)) fail("phases", `missing or invalid id "${phase.id ?? ""}"`);
    if (phases.has(phase.id)) fail("phases", `duplicate id "${phase.id}"`);
    if (!phase.title) fail(`phase ${phase.id}`, "missing title");
    phases.add(phase.id);
  }

  // A file created by one of the plan's tasks exists for the tasks that modify it afterwards.
  const created = new Set();
  const createdByDecisionTasks = new Map();
  for (const { decision } of allDecisions(plan)) {
    for (const { task, origin } of declaredTasks(decision)) {
      for (const file of task?.files ?? []) {
        if (file?.op !== "create" || !file.path) continue;
        created.add(file.path);
        if (origin === "decision") createdByDecisionTasks.set(file.path, [...(createdByDecisionTasks.get(file.path) ?? []), `${decision.id}/${task.id}`]);
      }
    }
  }
  for (const [file, refs] of createdByDecisionTasks) {
    if (refs.length > 1) warn("tasks", `"${file}" created by several tasks (${refs.join(", ")}): only one should create it, the others modify it`);
  }

  const decisions = new Map();
  const pageIds = new Set();
  const assets = [];
  const references = [];
  const textBlob = [plan.context ?? "", plan.summary?.goal ?? "", ...(Array.isArray(plan.summary?.changes) ? plan.summary.changes : []), ...(Array.isArray(plan.summary?.risks) ? plan.summary.risks : [])];

  const visual = (where, v) => {
    if (!v) return;
    if (!v.kind) fail(where, 'visual without "kind"');
    else if (!kinds.has(v.kind)) (looseVisuals ? warn : fail)(where, `unknown visual "${v.kind}"${looseVisuals ? " (extension not loaded?)" : ""}`);
    if (v.kind === "image" && !v.src && !v.prompt) fail(where, '"image" visual without "src" or "prompt" (image to generate)');
    if (v.aspect !== undefined && !ASPECTS.includes(v.aspect)) fail(where, `unknown illustration format "${v.aspect}" (${ASPECTS.join(", ")})`);
    if (v.prompt !== undefined && !String(v.prompt).trim()) fail(where, 'empty "prompt"');
    collectAssets(v, assets, where);
    for (const key of ["items_from", "step_from", "rule_from", "gates_from", "options_from"]) if (v[key]) references.push([where, v[key]]);
  };

  (plan.pages ?? []).forEach((page, index) => {
    const where = `page ${page.id ?? index + 1}`;
    if (!page.id || !ID.test(page.id)) fail(where, 'missing or invalid id (letters, digits, "_", "-"; no leading "_")');
    if (pageIds.has(page.id)) fail(where, "duplicate page id");
    pageIds.add(page.id);
    if (!page.title) fail(where, "missing title");
    if (page.kind === "summary") fail(where, 'the summary page is added by the engine: remove "kind: summary"');
    textBlob.push(page.intro ?? "");
    visual(where, page.visual);
    const main = (page.decisions ?? []).filter((d) => d.importance !== "minor");
    if (main.length > MAX_DECISIONS_PER_PAGE) warn(where, `${main.length} non-minor decisions: aim for 3 to 5 per page`);
    for (const decision of page.decisions ?? []) checkDecision(decision);
  });

  function checkDecision(decision) {
    const dw = `decision ${decision.id ?? "?"}`;
    if (!decision.id || !ID.test(decision.id)) fail(dw, "missing or invalid id");
    if (decisions.has(decision.id)) fail(dw, "duplicate id");
    decisions.set(decision.id, decision);
    if (!decision.title) fail(dw, "missing title");
    shortText(`${dw} proposal`, decision.proposal, 600);
    shortText(`${dw} why`, decision.why, 500);
    for (const key of ["benefit", "tradeoff"]) {
      if (decision[key] !== undefined && typeof decision[key] !== "string") fail(dw, `"${key}" must be a string`);
      shortText(`${dw} ${key}`, decision[key], 200);
    }
    textBlob.push(decision.proposal ?? "", decision.why ?? "", decision.learn_more ?? "", decision.benefit ?? "", decision.tradeoff ?? "");
    const importance = decision.importance ?? "important";
    if (!IMPORTANCE.includes(importance)) fail(dw, `unknown importance "${importance}" (${IMPORTANCE.join(", ")})`);
    if (importance === "critical" && !String(decision.why ?? "").trim()) fail(dw, 'critical decision without "why" (why it matters)');
    if (importance === "important" && !String(decision.why ?? "").trim()) warn(dw, 'no "why": say why it matters');
    if (decision.phase && !phases.has(decision.phase)) fail(dw, `unknown phase "${decision.phase}"`);
    for (const dep of decision.depends_on ?? []) references.push([dw, dep]);
    visual(dw, decision.visual);

    if (decision.items?.length) {
      const ids = new Set();
      for (const item of decision.items) {
        if (!item.id || !ID.test(item.id)) fail(dw, `item without a valid id "${item.title ?? "?"}"`);
        if (ids.has(item.id)) fail(dw, `duplicate item "${item.id}"`);
        ids.add(item.id);
        if (!item.title) fail(dw, `item "${item.id}" without a title`);
        if (item.icon) assets.push([dw, item.icon]);
        textBlob.push(item.detail ?? "");
      }
    }

    const control = decision.control;
    if (control) {
      if (decision.items?.length) fail(dw, "a decision carries items or a control, not both");
      if (!CONTROL_KINDS.has(control.kind)) fail(dw, `unknown control "${control.kind}"`);
      if (control.kind === "choice" || control.kind === "multi") {
        if (!control.options?.length) fail(dw, "missing options");
        const ids = new Set();
        for (const option of control.options ?? []) {
          if (!option.id || !ID.test(option.id) || ids.has(option.id)) fail(dw, `option without a valid id, or duplicate "${option.id ?? "?"}"`);
          ids.add(option.id);
          if (!option.label) fail(dw, `option "${option.id}" without a label`);
          if (importance === "critical" && !option.pros?.length && !option.cons?.length) warn(dw, `option "${option.id}" without pros / cons on a critical decision`);
          textBlob.push(option.detail ?? "", ...(option.pros ?? []), ...(option.cons ?? []));
        }
        if (control.kind === "choice" && !(control.options ?? []).some((o) => o.recommended)) warn(dw, 'no "recommended" option: what is being proposed?');
        if (control.kind === "choice" && (control.options ?? []).filter((o) => o.recommended).length > 1) fail(dw, "several recommended options for a single choice");
      }
      if (control.kind === "number") {
        const { min, max, default: def } = control;
        if (!(Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(def) && min < max && def >= min && def <= max)) fail(dw, "inconsistent number bounds (min < max, min ≤ default ≤ max)");
      }
      if (control.kind === "order") {
        if (control.source !== "phases") fail(dw, 'an "order" control orders the phases: set "source": "phases"');
        else if (phases.size < 2) fail(dw, "ordering phases requires at least two phases");
      }
    }

    const tasks = declaredTasks(decision);
    const taskIds = new Set();
    for (const { task, origin } of tasks) {
      const tw = `${dw}, task ${task?.id ?? "?"}`;
      if (!task?.id || !ID.test(task.id)) {
        fail(tw, `missing or invalid id (${origin})`);
        continue;
      }
      if (taskIds.has(task.id)) fail(tw, "duplicate task id in the decision");
      taskIds.add(task.id);
      if (!task.title) fail(tw, "missing title");
      if (!task.acceptance?.length) warn(tw, "no acceptance criteria: how will completion be verified?");
      if (!task.verify?.length) warn(tw, "no verification commands: specify how to check completion");
      if (task.phase && !phases.has(task.phase)) fail(tw, `unknown phase "${task.phase}"`);
      for (const file of task.files ?? []) {
        if (!file?.path) {
          fail(tw, 'file without "path"');
          continue;
        }
        if (file.op && !FILE_OPS.includes(file.op)) fail(tw, `unknown operation "${file.op}" (${FILE_OPS.join(", ")})`);
        if (root && (file.op ?? "modify") !== "create" && !created.has(file.path) && !/[*{]/.test(file.path) && !existsSync(path.resolve(root, file.path))) {
          warn(tw, `file to ${file.op === "delete" ? "delete" : "modify"} not found in the project: ${file.path}`);
        }
      }
      for (const key of ["acceptance", "verify", "after"]) {
        if (task[key] !== undefined && !Array.isArray(task[key])) fail(tw, `"${key}" must be a list`);
      }
    }
    // No task: the decision will only show up among the "Working rules" of PLAN.md.
    // A phase order has no task of its own: it orders everyone else's.
    if (!tasks.length && importance !== "minor" && control?.kind !== "order") warn(dw, "no task: the decision will only be a working rule in PLAN.md");
  }

  // Cross-references, once every decision is known.
  for (const [where, id] of references) if (!decisions.has(id)) fail(where, `reference to an unknown decision "${id}"`);
  const taskRefs = new Set();
  for (const decision of decisions.values()) for (const { task } of declaredTasks(decision)) if (task?.id) taskRefs.add(`${decision.id}/${task.id}`);
  for (const decision of decisions.values()) {
    for (const { task } of declaredTasks(decision)) {
      for (const ref of task?.after ?? []) {
        const full = String(ref).includes("/") ? ref : `${decision.id}/${ref}`;
        if (!taskRefs.has(full)) fail(`decision ${decision.id}, task ${task.id}`, `"after" points to an unknown task "${ref}"`);
      }
    }
  }
  for (const cycle of findTaskCycles(plan)) fail("tasks", `circular dependencies: ${cycle.join(" → ")}`);

  const terms = new Set();
  const blob = textBlob.join("\n").toLowerCase();
  for (const entry of plan.glossary ?? []) {
    if (!entry.term || !entry.definition) {
      fail("glossary", `incomplete entry "${entry.term ?? "?"}" (term + definition)`);
      continue;
    }
    if (terms.has(entry.term.toLowerCase())) fail("glossary", `duplicate term "${entry.term}"`);
    terms.add(entry.term.toLowerCase());
    const used = [entry.term, ...(entry.aliases ?? [])].some((word) => blob.includes(word.toLowerCase()));
    if (!used) warn("glossary", `term "${entry.term}" never used in the texts`);
  }

  for (const [key, value] of Object.entries(plan.output ?? {})) {
    if (!["plan", "decisions"].includes(key)) fail("output", `unknown key "${key}" (plan, decisions)`);
    else if (!/\.md$/i.test(String(value))) fail("output", `"${key}" must be a .md file`);
  }
  for (const extension of plan.extensions ?? []) {
    if (!/^visuals\/[\w.-]+\.m?js$/.test(extension)) fail("extensions", `path rejected "${extension}" (visuals/<name>.js)`);
    else if (planDir && !existsSync(path.join(planDir, extension))) fail("extensions", `missing file: ${extension}`);
  }
  {
    for (const [where, relative] of assets) {
      if (relative.startsWith("lucide:")) {
        if (!hasIcon(relative.slice(7))) fail(where, `unknown icon "${relative}" (list: references/visuals.md, "Icons")`);
        continue;
      }
      if (/^(https?:|data:)/.test(relative) || !planDir) continue;
      if (!existsSync(path.join(planDir, relative))) fail(where, `missing file: ${relative}`);
    }
  }
  if (!allDecisions(plan).length) warn("plan", "no decisions");
  return { errors, warnings };
}

function collectAssets(v, out, where) {
  const push = (file) => {
    if (typeof file === "string" && file) out.push([where, file]);
  };
  push(v.src);
  push(v.icon);
  for (const list of [v.tiles, v.days, v.tiers, v.cards, v.icons]) for (const entry of list ?? []) push(entry.icon);
  for (const column of v.columns ?? []) {
    push(column.icon);
    for (const cellEntry of column.cells ?? []) push(cellEntry.icon);
  }
}
