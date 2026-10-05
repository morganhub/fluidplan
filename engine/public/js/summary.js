// The summary: where the plan stands, what is left, and a preview of the two final files. The main
// action stays “Send the plan to AI”: the assistant finalizes; writing the files from here gives
// a preview (DRAFT until everything is decided).
import { h } from "./dom.js";
import { documentPreview } from "./document.js";
import { verdictBadge, VERDICT_STYLE } from "./decision.js";
import { buildDecisionsMd } from "./export_decisions.js";
import { buildPlanMd } from "./export_plan.js";
import { icon } from "./icons.js";
import { allDecisions, controlSummary, counts, readiness, verdict } from "./model.js";
import { alert, button, tabs, toast } from "./ui.js";

export function renderSummary(ctx, { api, submit }) {
  const { plan, store, t } = ctx;
  const readinessSlot = h("div");
  const stats = h("div", { class: "stat-grid five" });
  const lists = h("div", { class: "summary-lists" });
  const status = h("p", { class: "export-status muted" });
  const planPreview = documentPreview("plan-doc", t);
  const decisionsPreview = documentPreview("decisions-doc", t);

  const sendButton = button({ label: t("submit.button"), icon: "send", onclick: submit });
  const writeButton = button({ label: t("summary.write"), icon: "file-check", variant: "outline", onclick: write });
  const downloadPlan = button({ label: "PLAN.md", icon: "download", variant: "ghost", onclick: () => download("PLAN.md", planText()) });
  const downloadDecisions = button({ label: "DECISIONS.md", icon: "download", variant: "ghost", onclick: () => download("DECISIONS.md", decisionsText()) });

  const preview = tabs({
    ariaLabel: t("summary.preview"),
    items: [
      { id: "plan", label: "PLAN.md", icon: "file-text", render: () => planPreview.el },
      { id: "decisions", label: "DECISIONS.md", icon: "scale", render: () => decisionsPreview.el },
    ],
  });

  const providersLine = h("p", { class: "muted providers" });
  const el = h("article", { class: "page summary", "aria-labelledby": "page-title" },
    h("header", { class: "page-header" },
      h("div", { class: "kicker" }, t("summary.kicker")),
      h("h1", { id: "page-title" }, t("summary.title")),
      h("p", { class: "page-intro" }, t("summary.intro"))),
    readinessSlot,
    stats,
    h("div", { class: "summary-actions" }, sendButton, writeButton, downloadPlan, downloadDecisions),
    status,
    lists,
    h("section", { class: "summary-preview" }, h("h2", {}, t("summary.preview")), preview.el),
    providersLine);

  // Usage of the illustration services: “OpenAI 2 / 5 · Gemini 0 / 5”.
  const renderProviders = () => {
    const { providers, quota } = ctx.images;
    const configured = providers.filter((p) => p.configured);
    providersLine.textContent = configured.length
      ? t("summary.providers", { list: configured.map((p) => `${p.label} ${p.used} / ${quota}`).join(" · ") })
      : t("summary.noProviders");
  };
  renderProviders();
  ctx.onImages(renderProviders, providersLine);

  const planText = () => buildPlanMd(plan, store.answers, { t, state: ctx.state });
  const decisionsText = () => buildDecisionsMd(plan, store.answers, { t, state: ctx.state });

  async function write() {
    writeButton.disabled = true;
    status.textContent = t("summary.writing");
    try {
      await store.flush();
      const result = await api.exportFinal();
      status.textContent = t("summary.written", { plan: result.plan.path, decisions: result.decisions.path });
      toast(t("summary.writtenToast"), { variant: "success" });
    } catch (error) {
      status.textContent = t("summary.writeFailed", { error: error.message });
      toast(error.message, { variant: "error" });
    } finally {
      writeButton.disabled = false;
    }
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const link = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  function update() {
    const c = counts(plan, store.answers);
    const ready = readiness(plan, store.answers);
    readinessSlot.replaceChildren(ready.ready
      ? alert({ variant: "success", icon: "circle-check", title: t("summary.readyTitle"), description: t(["ready", "exported"].includes(ctx.state.status) ? "summary.finalizedText" : plan.execution === "review" ? "summary.readyReviewText" : "summary.readyAutoText") })
      : alert({ variant: "default", icon: "circle-dashed", title: t("summary.notReadyTitle"), description: t("summary.notReadyText", { pending: ready.pending.length, revise: ready.revise.length }) }));
    const tile = (key, value) => h("div", { class: `stat-tile tone-${key}` },
      h("div", { class: "stat-label" }, icon(VERDICT_STYLE[key].icon), t(`summary.stat.${key}`)),
      h("div", { class: "stat-value" }, String(value)));
    stats.replaceChildren(tile("ok", c.ok + c.mixed), tile("modify", c.modify), tile("explain", c.explain), tile("ko", c.ko), tile("pending", c.pending));

    const groups = ["pending", "modify", "explain", "mixed", "ko"];
    lists.replaceChildren(...groups.map((key) => {
      const rows = allDecisions(plan).filter(({ decision }) => verdict(decision, store.answer(decision.id)) === key);
      if (!rows.length) return null;
      return h("section", { class: "summary-list" },
        h("h3", {}, verdictBadge(key, t), h("span", { class: "muted" }, ` ${rows.length}`)),
        h("ul", {}, rows.map(({ page, decision }) => {
          const answer = store.answer(decision.id);
          const variant = controlSummary(decision, answer, plan, t);
          return h("li", {},
            h("a", { href: `#/${page.id}/d-${decision.id}` }, h("span", { class: "mono muted" }, decision.id), ` ${decision.title}`),
            variant ? h("span", { class: "muted" }, ` — ${variant}`) : null,
            answer.comment ? h("div", { class: "summary-comment" }, t("export.quote", { text: answer.comment.trim() })) : null);
        })));
    }).filter(Boolean));

    const locked = ctx.readOnly();
    sendButton.disabled = locked;
    sendButton.hidden = ctx.state.status === "exported";
    planPreview.setText(planText());
    decisionsPreview.setText(decisionsText());
  }
  update();
  return { page: { id: "_summary" }, el, update };
}
