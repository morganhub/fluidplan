// The application shell, modeled on shadcn's “sidebar” block: sidebar (pages grouped by section,
// with their state), header (breadcrumb, progress, saving, round, glossary, theme, send), state
// banners, and one page at a time.
import { h } from "./dom.js";
import { glossaryList } from "./glossary.js";
import { formatTime } from "./i18n.js";
import { icon } from "./icons.js";
import { counts, readiness, SUMMARY_PAGE } from "./model.js";
import { PAGE_STATE_ICON, renderHome, renderPage } from "./page.js";
import { renderSummary } from "./summary.js";
import { alert, badge, button, dialog, floating, progress, sheet, toast } from "./ui.js";

const HOME_PAGE = "_home";
const THEME_KEY = "fluidplan:theme";

export function renderApp(ctx, { api }) {
  const { plan, store, t } = ctx;
  const app = document.getElementById("app");

  // --- sidebar --------------------------------------------------------------------------------------
  const navLinks = new Map();
  const navLink = (id, label, iconName, extra) => {
    const count = h("span", { class: "nav-count" });
    const stateIcon = h("span", { class: "nav-icon" }, icon(iconName));
    const link = h("a", { class: "nav-link", href: `#/${id}`, dataset: { page: id } }, stateIcon, h("span", { class: "nav-text" }, label), count);
    navLinks.set(id, { link, count, stateIcon, extra });
    return link;
  };
  const buildNav = () => {
    const groups = [];
    for (const page of plan.pages) {
      const key = page.section ?? "";
      let group = groups.find((g) => g.key === key);
      if (!group) groups.push((group = { key, pages: [] }));
      group.pages.push(page);
    }
    return h("nav", { class: "nav", "aria-label": t("nav.pages") },
      h("div", { class: "nav-group" }, navLink(HOME_PAGE, t("home.nav"), "map")),
      groups.map((group) => h("div", { class: "nav-group" },
        group.key ? h("div", { class: "nav-label" }, group.key) : null,
        group.pages.map((page) => navLink(page.id, page.title, "circle", { page })))),
      h("div", { class: "nav-group" }, navLink(SUMMARY_PAGE, t("summary.nav"), "file-text")));
  };
  const sideProgress = progress([]);
  const sideCount = h("div", { class: "side-count muted" });
  const sideUnresolved = h("div", { class: "side-count muted", role: "status" });
  const sidebar = h("aside", { class: "sidebar" },
    h("div", { class: "side-brand" },
      h("div", { class: "side-logo", "aria-hidden": "true" }, icon("list-checks")),
      h("div", { class: "side-titles" }, h("div", { class: "side-title" }, plan.title), plan.subtitle ? h("div", { class: "side-sub" }, plan.subtitle) : null)),
    h("div", { class: "side-scroll" }, buildNav()),
    h("div", { class: "side-foot" }, sideProgress.el, sideCount, sideUnresolved));

  // --- header -----------------------------------------------------------------------------------------
  const crumbs = h("div", { class: "crumbs" });
  const saveState = h("span", { class: "save-state muted" }, icon("cloud-check"), h("span", { class: "save-text" }, t("save.saved")));
  const mobileNav = sheet({ title: plan.title, description: plan.subtitle, closeLabel: t("common.close") });
  const glossarySheet = sheet({ title: t("glossary.title"), side: "right", closeLabel: t("common.close") });
  const themeButton = button({ icon: "monitor", variant: "ghost", size: "sm", title: t("theme.toggle"), onclick: cycleTheme });
  const densityButton = button({ label: t(ctx.density === "detailed" ? "density.detailed" : "density.summary"), icon: "book-open", variant: "outline", size: "sm", className: "density-button", title: t("density.switch"), onclick: () => {
    ctx.setDensity(ctx.density === "summary" ? "detailed" : "summary");
    densityButton.querySelector("span").textContent = t(ctx.density === "detailed" ? "density.detailed" : "density.summary");
    current?.update?.();
  } });
  const submitButton = button({ label: t("submit.button"), icon: "send", size: "sm", className: "submit-button", onclick: submit });
  const topbar = h("header", { class: "topbar" },
    button({ icon: "menu", variant: "ghost", size: "sm", title: t("nav.open"), className: "menu-button", onclick: () => mobileNav.open(buildNav()) }),
    crumbs,
    h("div", { class: "topbar-right" },
      saveState,
      badge(t("round.label", { n: ctx.state.round }), { variant: "outline", icon: "history", className: "round-badge" }),
      plan.glossary?.length ? button({ icon: "book-open", variant: "ghost", size: "sm", title: t("glossary.title"), onclick: () => glossarySheet.open(glossaryList(plan.glossary, t)) }) : null,
      themeButton,
      densityButton,
      submitButton));

  const banners = h("div", { class: "banners" });
  const main = h("main", { class: "content", id: "main", tabindex: "-1" });
  app.replaceChildren(sidebar, h("div", { class: "main-col" }, topbar, h("div", { class: "content-wrap" }, banners, main)));

  // --- theme ------------------------------------------------------------------------------------------
  function readTheme() {
    try {
      return localStorage.getItem(THEME_KEY) ?? "system";
    } catch {
      return "system";
    }
  }
  function applyTheme(choice) {
    const forced = new URLSearchParams(location.search).get("theme");
    const value = forced ?? choice;
    const dark = value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeButton.replaceChildren(icon(value === "dark" ? "moon" : value === "light" ? "sun" : "monitor"));
    themeButton.title = t(`theme.${value}`);
  }
  function cycleTheme() {
    const order = ["system", "light", "dark"];
    const next = order[(order.indexOf(readTheme()) + 1) % order.length];
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private browsing: the choice lasts for the session */
    }
    applyTheme(next);
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(readTheme()));
  applyTheme(readTheme());

  // --- routing ----------------------------------------------------------------------------------------
  let current = null;
  ctx.go = (pageId, anchor) => {
    const target = `#/${pageId}${anchor ? `/${anchor}` : ""}`;
    mobileNav.close();
    if (location.hash === target) route();
    else location.hash = target;
  };

  function route() {
    const match = location.hash.match(/^#\/([^/]+)(?:\/(.+))?$/);
    const id = match?.[1] ?? HOME_PAGE;
    const page = plan.pages.find((p) => p.id === id);
    const key = page ? page.id : id === SUMMARY_PAGE ? SUMMARY_PAGE : HOME_PAGE;
    if (!current || current.page.id !== key) {
      floating.hide();
      current = key === SUMMARY_PAGE ? renderSummary(ctx, { api, submit }) : page ? renderPage(page, ctx) : renderHome(ctx);
      main.replaceChildren(current.el);
      window.scrollTo({ top: 0 });
      document.title = `${key === HOME_PAGE ? plan.title : key === SUMMARY_PAGE ? t("summary.nav") : page.title} · fluidplan`;
    }
    for (const [pageId, { link }] of navLinks) {
      const active = pageId === key;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    crumbs.replaceChildren(...crumbsFor(key, page));
    const anchor = match?.[2];
    if (anchor) {
      const target = document.getElementById(anchor);
      if (target) {
        // A card hidden by the filter must reappear so we can go to it.
        if (target.hidden) {
          ctx.setFilter("all");
          current = null;
          route();
          return;
        }
        for (let parent = target.parentElement; parent; parent = parent.parentElement) {
          if (parent.matches("details:not([open])")) parent.open = true;
        }
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("flash");
        setTimeout(() => target.classList.remove("flash"), 1600);
      }
    }
  }

  function crumbsFor(key, page) {
    if (key === HOME_PAGE) return [h("span", { class: "crumb-current" }, t("home.nav"))];
    if (key === SUMMARY_PAGE) return [h("span", { class: "crumb-current" }, t("summary.nav"))];
    return [
      page.section ? h("span", { class: "crumb muted" }, page.section) : null,
      page.section ? icon("chevron-right", { className: "crumb-sep" }) : null,
      h("span", { class: "crumb-current" }, page.title),
    ].filter(Boolean);
  }

  function step(delta) {
    const order = [HOME_PAGE, ...plan.pages.map((p) => p.id), SUMMARY_PAGE];
    const index = order.indexOf(current?.page.id ?? HOME_PAGE);
    const next = order[index + delta];
    if (next) ctx.go(next);
  }

  // --- plan state: banners ----------------------------------------------------------------------------
  function renderBanners() {
    const list = [];
    const { state, check } = ctx;
    if (check.errors.length) {
      list.push(alert({
        variant: "destructive",
        icon: "octagon-alert",
        title: t("banner.errors", { count: check.errors.length }),
        description: h("ul", {}, check.errors.slice(0, 5).map((e) => h("li", {}, e))),
      }));
    }
    if (state.status === "submitted") {
      list.push(alert({ variant: "info", icon: "loader-circle", title: t("banner.submittedTitle", { n: state.round }), description: t("banner.submittedText") }));
    } else if (state.status === "exported" || state.status === "ready") {
      list.push(alert({ variant: "success", icon: "badge-check", title: t("banner.exportedTitle"), description: t("banner.exportedText") }));
    } else if (state.round > 1) {
      const revised = plan.pages.flatMap((p) => p.decisions ?? []).filter((d) => d.revision?.round === state.round).length;
      list.push(alert({
        variant: "info",
        icon: "history",
        title: t("banner.roundTitle", { n: state.round }),
        description: t("banner.roundText", { count: revised }),
        actions: [button({ label: t("filter.todo"), icon: "list-filter", variant: "outline", size: "sm", onclick: () => { ctx.setFilter("todo"); current = null; route(); } })],
      }));
    }
    banners.replaceChildren(...list);
    banners.querySelector(".alert-info > .icon-loader-circle")?.classList.add("spin");
  }

  // --- sending the round --------------------------------------------------------------------------------
  function submit() {
    if (ctx.readOnly()) return;
    const c = counts(plan, store.answers);
    const ready = readiness(plan, store.answers);
    dialog({
      title: t("submit.title", { n: ctx.state.round }),
      description: ready.ready ? t("submit.ready") : [
        ready.revise.length ? t("submit.rework", { count: ready.revise.length }) : t("submit.nothing"),
        ready.pending.length ? t("submit.pending", { count: ready.pending.length }) : "",
      ].filter(Boolean).join(" "),
      closeLabel: t("common.close"),
      content: h("div", {}, h("p", { class: "workflow-notice" }, t(plan.execution === "review" ? "execution.review" : "execution.auto")), h("ul", { class: "submit-counts" },
        h("li", {}, t("summary.stat.ok"), h("b", {}, String(c.ok + c.mixed))),
        h("li", {}, t("summary.stat.modify"), h("b", {}, String(c.modify))),
        h("li", {}, t("summary.stat.explain"), h("b", {}, String(c.explain))),
        h("li", {}, t("summary.stat.ko"), h("b", {}, String(c.ko))),
        h("li", {}, t("summary.stat.pending"), h("b", {}, String(c.pending))))),
      actions: ({ close }) => [
        button({ label: t("common.cancel"), variant: "outline", onclick: close }),
        button({
          label: t("submit.confirm"),
          icon: "send",
          onclick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              await store.flush();
              ctx.state = await api.submit();
              close();
              applyState();
              toast(t("submit.done"), { variant: "success" });
            } catch (error) {
              close();
              toast(error.message, { variant: "error" });
            }
          },
        }),
      ],
    });
  }

  function applyState() {
    store.readOnly = ctx.state.status !== "review";
    submitButton.disabled = store.readOnly || ctx.check.errors.length > 0;
    renderBanners();
    current?.update?.();
  }

  // --- refreshes ---------------------------------------------------------------------------------------
  function refreshChrome() {
    const c = counts(plan, store.answers);
    const all = c.all || 1;
    sideProgress.update([
      { tone: "ok", value: c.ok + c.mixed, total: all },
      { tone: "modify", value: c.modify },
      { tone: "explain", value: c.explain },
      { tone: "ko", value: c.ko },
    ]);
    sideCount.textContent = t("nav.progress", { done: c.all - c.pending, total: c.all });
    sideUnresolved.textContent = t("nav.unresolved", { count: readiness(plan, store.answers).revise.length });
    for (const { stateIcon, count, extra } of navLinks.values()) {
      if (!extra?.page) continue;
      const state = store.pageState(extra.page);
      stateIcon.className = `nav-icon state-${state}`;
      stateIcon.replaceChildren(icon(PAGE_STATE_ICON[state]));
      const decisions = extra.page.decisions ?? [];
      count.textContent = decisions.length ? `${decisions.filter((d) => store.verdict(d.id) !== "pending").length}/${decisions.length}` : "";
    }
  }

  store.subscribe(() => {
    refreshChrome();
    current?.update?.();
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("keydown", (event) => {
    // Arrow keys are already used in button groups, tabs and the phase order.
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable], dialog, [role=group], [role=tablist], [role=radiogroup], .order")) return;
    if (event.key === "ArrowRight") step(1);
    if (event.key === "ArrowLeft") step(-1);
  });

  refreshChrome();
  applyState();
  route();

  return {
    saving() {
      saveState.className = "save-state muted";
      saveState.replaceChildren(icon("loader-circle", { className: "spin" }), h("span", { class: "save-text" }, t("save.saving")));
    },
    saved(at) {
      saveState.className = "save-state muted";
      saveState.replaceChildren(icon("cloud-check"), h("span", { class: "save-text" }, t("save.savedAt", { time: formatTime(at, t.lang) })));
    },
    offline(message) {
      saveState.className = "save-state offline";
      saveState.replaceChildren(icon("cloud-off"), h("span", { class: "save-text" }, message ?? t("save.offline")));
    },
    planChanged() {
      if (ctx.state.status !== "review") return;
      banners.prepend(alert({
        variant: "warning",
        icon: "refresh-cw",
        title: t("banner.planChangedTitle"),
        description: t("banner.planChangedText"),
        actions: [button({ label: t("banner.reload"), icon: "refresh-cw", size: "sm", onclick: async () => { await store.flush(); location.reload(); } })],
      }));
    },
  };
}
