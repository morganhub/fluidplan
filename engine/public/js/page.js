// A plan page (one theme: its decisions, its minor points grouped together, a filter) and the home
// page the engine adds: the request, the figures, how to answer, the outline.
import { h } from "./dom.js";
import { renderDecision } from "./decision.js";
import { applyGlossary } from "./glossary.js";
import { illustrationFor } from "./illustration.js";
import { icon } from "./icons.js";
import { md } from "./md.js";
import { readingDetail } from "./reading.js";
import { allDecisions, importanceOf, resolvePlanTasks, verdict } from "./model.js";
import { VERDICT_ICONS } from "./controls.js";
import { accordion, badge, button, card, tabs } from "./ui.js";
import { renderVisual } from "./visuals/index.js";

export function renderPage(page, ctx) {
  const { t, store, plan } = ctx;
  const index = plan.pages.indexOf(page);
  const decisions = page.decisions ?? [];
  const main = decisions.filter((d) => importanceOf(d) !== "minor");
  const minor = decisions.filter((d) => importanceOf(d) === "minor");
  const parts = [];
  const cards = [];

  const el = h("article", { class: "page", "aria-labelledby": "page-title" },
    h("header", { class: "page-header" },
      page.section ? h("div", { class: "kicker" }, page.section) : null,
      h("h1", { id: "page-title" }, page.title),
      page.intro ? h("div", { class: "page-intro", html: md(page.intro) }) : null));
  applyGlossary(el.querySelector(".page-intro"), ctx.glossary);

  const counts = () => ({
    all: decisions.length,
    critical: decisions.filter((d) => importanceOf(d) === "critical").length,
    todo: decisions.filter((d) => verdict(d, store.answer(d.id)) === "pending").length,
  });
  let filterTabs = null;
  if (decisions.length > 1) {
    const c = counts();
    filterTabs = tabs({
      ariaLabel: t("filter.aria"),
      value: ctx.filter,
      items: [
        { id: "all", label: t("filter.all"), count: c.all },
        { id: "critical", label: t("filter.critical"), icon: "octagon-alert", count: c.critical },
        { id: "todo", label: t("filter.todo"), icon: "circle-dashed", count: c.todo },
      ],
      onChange: (value) => {
        ctx.setFilter(value);
        applyFilter();
      },
    });
    el.append(h("div", { class: "page-toolbar" }, filterTabs.el));
  }

  if (page.visual) {
    const visual = renderVisual(page.visual, ctx);
    const illustration = illustrationFor(`page:${page.id}`, page.visual, ctx);
    parts.push(visual);
    const content = h("section", { class: "card page-visual" }, h("div", { class: "card-content" }, illustration?.el, visual.el, page.visual.caption ? h("p", { class: "visual-caption" }, page.visual.caption) : null));
    if (page.visual.kind === "image") el.append(content);
    else {
      const detail = readingDetail(ctx, { label: t("decision.visual"), icon: "layers", content });
      parts.push(detail); el.append(detail.el);
    }
  }

  for (const decision of main) {
    const view = renderDecision(decision, ctx);
    parts.push(view);
    cards.push(view);
    el.append(view.el);
  }

  let minorBlock = null;
  if (minor.length) {
    const list = h("div", { class: "minor-list" });
    for (const decision of minor) {
      const view = renderDecision(decision, ctx, { compact: true });
      parts.push(view);
      cards.push(view);
      list.append(view.el);
    }
    const validateAll = button({
      label: t("minor.validateAll"),
      icon: "check",
      variant: "outline",
      size: "sm",
      onclick: () => {
        for (const decision of minor) {
          if (decision.items?.length) {
            for (const item of decision.items) if (!store.answer(decision.id).items?.[item.id]?.status) store.patchItem(decision.id, item.id, { status: "ok" });
          } else if (!store.answer(decision.id).status) {
            store.patch(decision.id, { status: "ok" });
          }
        }
      },
    });
    parts.push({ update: () => { validateAll.hidden = ctx.readOnly() || minor.every((d) => verdict(d, store.answer(d.id)) !== "pending"); } });
    minorBlock = h("section", { class: "minor-block" },
      accordion({
        label: t("minor.title", { count: minor.length }),
        icon: "circle-small",
        open: main.length === 0,
        content: h("div", { class: "minor-content" }, h("div", { class: "minor-intro" }, h("p", { class: "muted" }, t("minor.intro")), validateAll), list),
      }));
    el.append(minorBlock);
  }

  const empty = h("div", { class: "empty-state", hidden: true },
    icon("circle-check", { className: "icon-lg" }),
    h("p", {}, t("filter.empty")),
    button({ label: t("filter.showAll"), variant: "outline", size: "sm", onclick: () => { ctx.setFilter("all"); filterTabs?.select("all"); applyFilter(); } }));
  el.append(empty);

  el.append(pageNav(index, ctx));

  function matches(view) {
    if (ctx.filter === "critical") return importanceOf(view.decision) === "critical";
    if (ctx.filter === "todo") return verdict(view.decision, store.answer(view.id)) === "pending";
    return true;
  }
  // The filter applies when it is picked, not on every answer: a card does not vanish from under
  // the cursor while it is being decided.
  function applyFilter() {
    let visible = 0;
    for (const view of cards) {
      view.el.hidden = !matches(view);
      if (!view.el.hidden) visible += 1;
    }
    if (minorBlock) {
      const shown = cards.filter((v) => minor.includes(v.decision) && !v.el.hidden).length;
      minorBlock.hidden = shown === 0;
      if (ctx.filter !== "all" && shown) minorBlock.querySelector("details").open = true;
    }
    empty.hidden = visible > 0 || !decisions.length;
  }
  applyFilter();

  return {
    page,
    el,
    update() {
      for (const part of parts) part.update?.();
      if (filterTabs) {
        const c = counts();
        filterTabs.setCount("all", c.all);
        filterTabs.setCount("critical", c.critical);
        filterTabs.setCount("todo", c.todo);
      }
    },
    focusDecision: applyFilter,
  };
}

export function pageNav(index, ctx) {
  const { plan, t } = ctx;
  const prev = index > 0 ? plan.pages[index - 1] : index === 0 ? { id: "_home", title: t("home.nav") } : null;
  const next = index >= 0 && index < plan.pages.length - 1 ? plan.pages[index + 1] : index === plan.pages.length - 1 ? { id: "_summary", title: t("summary.nav") } : null;
  return h("nav", { class: "page-nav", "aria-label": t("nav.pages") },
    prev ? button({ label: prev.title, icon: "chevron-left", variant: "outline", onclick: () => ctx.go(prev.id) }) : h("span"),
    h("span", { class: "muted page-count" }, index >= 0 ? `${index + 1} / ${plan.pages.length}` : ""),
    next ? button({ label: next.title, iconRight: "chevron-right", onclick: () => ctx.go(next.id) }) : h("span"));
}

// --- home ------------------------------------------------------------------------------------------

export function renderHome(ctx) {
  const { plan, t, store } = ctx;
  const rows = allDecisions(plan);
  const critical = rows.filter(({ decision }) => importanceOf(decision) === "critical").length;
  const resolved = resolvePlanTasks(plan, store.answers);
  const taskCount = resolved.byRef.size;
  const parts = [];

  const el = h("article", { class: "page home", "aria-labelledby": "page-title" },
    h("header", { class: "page-header" },
      h("div", { class: "kicker" }, plan.subtitle ?? t("home.kicker")),
      h("h1", { id: "page-title" }, plan.title),
      h("div", { class: "home-badges" },
        badge(t("round.label", { n: ctx.state.round }), { variant: "outline", icon: "history" }),
        badge(t("home.decisions", { count: rows.length }), { variant: "secondary" }),
        critical ? badge(t("home.critical", { count: critical }), { variant: "danger-outline", icon: "octagon-alert" }) : null)));

  if (plan.summary) {
    const section = (key, items) => items?.length ? h("section", {}, h("h3", {}, t(`home.${key}`)), h("ul", {}, items.map((text) => h("li", { html: md(text) })))) : null;
    el.append(card({ className: "home-synthesis", header: [h("h2", { class: "card-title" }, t("home.goal"))], content: h("div", { class: "d-text" },
      h("div", { html: md(plan.summary.goal) }), section("changes", plan.summary.changes), section("risks", plan.summary.risks)) }));
  }
  el.append(h("p", { class: "workflow-notice" }, t(plan.execution === "review" ? "execution.review" : "execution.auto")));

  if (plan.context) {
    const context = card({
      className: "home-context",
      header: [h("div", { class: "card-title" }, t("home.context"))],
      content: h("div", { class: "d-text", html: md(plan.context) }),
    });
    applyGlossary(context, ctx.glossary);
    if (plan.summary) {
      const detail = readingDetail(ctx, { label: t("home.context"), icon: "book-open", content: context });
      parts.push(detail); el.append(detail.el);
    } else el.append(context);
  }

  const stat = (value, label, name) => h("div", { class: "stat-tile" }, h("div", { class: "stat-label" }, icon(name), label), h("div", { class: "stat-value" }, String(value)));
  el.append(h("div", { class: "stat-grid" },
    stat(rows.length, t("home.statDecisions"), "list-checks"),
    stat(critical, t("home.statCritical"), "octagon-alert"),
    stat((plan.phases ?? []).length, t("home.statPhases"), "layers"),
    stat(taskCount, t("home.statTasks"), "wrench")));

  // How to answer: the four answers, rewriting, sending.
  const how = ["ok", "ko", "modify", "explain"].map((kind) => h("div", { class: "how-item" },
    h("span", { class: `how-icon tone-${kind}` }, icon(VERDICT_ICONS[kind])),
    h("div", {}, h("div", { class: "how-title" }, t(`action.${kind}`)), h("div", { class: "muted" }, t(`home.how.${kind}`)))));
  how.push(h("div", { class: "how-item" }, h("span", { class: "how-icon" }, icon("square-pen")), h("div", {}, h("div", { class: "how-title" }, t("edit.rewrite")), h("div", { class: "muted" }, t("home.how.edit")))));
  how.push(h("div", { class: "how-item" }, h("span", { class: "how-icon" }, icon("send")), h("div", {}, h("div", { class: "how-title" }, t("submit.button")), h("div", { class: "muted" }, t("home.how.send")))));
  el.append(card({ header: [h("div", { class: "card-title" }, t("home.howTitle")), h("div", { class: "card-description" }, t("home.howIntro"))], content: h("div", { class: "how-grid" }, how) }));

  // Outline: the sections and their pages, with progress.
  const sections = [];
  for (const page of plan.pages) {
    const key = page.section ?? "";
    let section = sections.find((s) => s.key === key);
    if (!section) sections.push((section = { key, pages: [] }));
    section.pages.push(page);
  }
  const outline = h("div", { class: "outline" });
  const renderOutline = () => outline.replaceChildren(...sections.map((section) => h("div", { class: "outline-section" },
    section.key ? h("div", { class: "outline-label" }, section.key) : null,
    section.pages.map((page) => {
      const decisions = page.decisions ?? [];
      const done = decisions.filter((d) => store.verdict(d.id) !== "pending").length;
      return h("a", { class: "outline-link", href: `#/${page.id}` },
        icon(PAGE_STATE_ICON[store.pageState(page)] ?? "circle", { className: `state-${store.pageState(page)}` }),
        h("span", { class: "outline-title" }, page.title),
        decisions.length ? h("span", { class: "muted outline-count" }, `${done}/${decisions.length}`) : null);
    }))));
  renderOutline();
  parts.push({ update: renderOutline });
  el.append(card({ header: [h("div", { class: "card-title" }, t("home.outline"))], content: outline }));

  if ((plan.phases ?? []).length) {
    const timeline = renderVisual({ kind: "timeline" }, ctx);
    parts.push(timeline);
    el.append(card({ header: [h("div", { class: "card-title" }, t("home.phases")), h("div", { class: "card-description" }, t("home.phasesIntro"))], content: timeline.el }));
  }

  const first = plan.pages.find((page) => store.pageState(page) !== "done" && store.pageState(page) !== "none") ?? plan.pages[0];
  el.append(h("div", { class: "home-cta" }, button({ label: t("home.start"), iconRight: "arrow-right", size: "lg", onclick: () => ctx.go(first.id) })));

  return { page: { id: "_home" }, el, update: () => parts.forEach((p) => p.update?.()) };
}

export const PAGE_STATE_ICON = { none: "circle-small", todo: "circle", partial: "circle-dot", done: "circle-check", attention: "circle-alert" };
