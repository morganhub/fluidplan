// Boot: config, plan, answers and state (a single call), the dictionary for the plan's language,
// visual extensions; then saving as you go and listening for changes made on disk (Claude
// revises, the CLI moves to another round).
import { makeT } from "./i18n.js";
import { glossaryMatcher } from "./glossary.js";
import { renderApp } from "./layout.js";
import { setMdLang } from "./md.js";
import { Store } from "./store.js";
import { loadExtensions, validateExtensionVisuals } from "./visuals/index.js";

const localKey = (planId, round) => `fluidplan:${location.port}:${planId}:${round}:answers`;

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `${response.status}`;
    try {
      message = (await response.json()).error ?? message;
    } catch {
      /* unreadable body: keep the status code */
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json();
}

function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function writeLocal(key, answers) {
  try {
    localStorage.setItem(key, JSON.stringify(answers));
  } catch {
    /* private browsing, storage full: the server stays the reference */
  }
}

function fatal(title, detail) {
  const app = document.getElementById("app");
  app.className = "app boot";
  app.replaceChildren();
  const box = document.createElement("div");
  box.className = "boot-box";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const p = document.createElement("p");
  p.textContent = detail ?? "";
  box.append(strong, p);
  app.append(box);
}

async function boot() {
  let config;
  try {
    config = await getJson("/api/config");
  } catch {
    fatal("The fluidplan server is not responding.", "Restart it: node <skill>/engine/fluidplan.mjs serve --open");
    return;
  }
  const planId = new URLSearchParams(location.search).get("plan") ?? config.defaultPlan;
  if (!planId) {
    fatal("No plan in this project.", "Create one: node <skill>/engine/fluidplan.mjs new --plan <id> --title \"…\"");
    return;
  }
  let bundle;
  try {
    bundle = await getJson(`/api/bundle?id=${encodeURIComponent(planId)}`);
  } catch (error) {
    fatal(`Plan “${planId}” is unreadable`, error.message);
    return;
  }
  const { plan, state, previous, check } = bundle;
  const lang = ["fr", "en"].includes(plan.lang) ? plan.lang : config.lang;
  const t = makeT(await getJson(`/i18n/${lang}.json`), lang);
  document.documentElement.lang = lang;
  document.documentElement.dataset.accent = plan.accent ?? config.accent ?? "neutral";
  setMdLang(lang);

  const extensionProblems = await loadExtensions(plan, planId);
  check.warnings.push(...extensionProblems);
  for (const problem of extensionProblems) console.warn(problem);
  check.errors.push(...validateExtensionVisuals(plan));

  const key = localKey(planId, state.round);
  let ui = null;
  const store = new Store(plan, bundle.answers ?? readLocal(key) ?? {}, {
    round: state.round,
    persist: async (data) => {
      writeLocal(key, data);
      ui?.saving();
      try {
        await getJson(`/api/answers?id=${encodeURIComponent(planId)}&round=${state.round}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        ui?.saved(new Date());
      } catch (error) {
        ui?.offline(error.status === 409 ? t("save.stale") : undefined);
      }
    },
  });

  const ctx = {
    plan,
    planId,
    config,
    store,
    state,
    previous: previous ?? {},
    check,
    t,
    lang,
    density: "summary",
    glossary: glossaryMatcher(plan.glossary),
    filter: state.round > 1 && state.status === "review" ? "todo" : "all",
    setFilter(value) {
      ctx.filter = value;
    },
    readOnly: () => store.readOnly,
    images: bundle.images ?? { quota: 0, providers: [], items: [], selected: {} },
    imageListeners: new Map(),
    // An illustration slot subscribes with its element; slots from pages left behind (no longer in
    // the document) are dropped on the next change.
    onImages(render, el) {
      ctx.imageListeners.set(render, el);
    },
    setImages(state) {
      ctx.images = state;
      for (const [render, el] of [...ctx.imageListeners]) {
        if (el && !el.isConnected) ctx.imageListeners.delete(render);
        else render();
      }
    },
    asset: (file) => assetUrl(planId, file),
    go: () => {},
  };
  const densityKey = `fluidplan:${config.root ?? location.port}:${planId}:density`;
  try {
    const savedDensity = localStorage.getItem(densityKey);
    if (["summary", "detailed"].includes(savedDensity)) ctx.density = savedDensity;
  } catch { /* storage is optional */ }
  ctx.setDensity = (value) => {
    if (!["summary", "detailed"].includes(value)) return;
    ctx.density = value;
    document.documentElement.dataset.density = value;
    try { localStorage.setItem(densityKey, value); } catch { /* session preference remains usable */ }
  };
  ctx.setDensity(ctx.density);
  const api = {
    exportFinal: () => getJson(`/api/export?id=${encodeURIComponent(planId)}`, { method: "POST" }),
    submit: () => getJson(`/api/submit?id=${encodeURIComponent(planId)}`, { method: "POST" }),
    generateImage: (body) => getJson(`/api/images?id=${encodeURIComponent(planId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    selectImage: (body) => getJson(`/api/images/select?id=${encodeURIComponent(planId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    refreshImages: () => getJson(`/api/images?id=${encodeURIComponent(planId)}`),
  };
  ctx.api = api;
  ui = renderApp(ctx, { api });

  // The disk changed: a new round (or a round sent from elsewhere) reloads the page, so answers from
  // an outdated round are never sent back to the server.
  const events = new EventSource(`/api/events?id=${encodeURIComponent(planId)}`);
  events.addEventListener("state", (event) => {
    const next = JSON.parse(event.data);
    if (next.round !== state.round || next.status !== ctx.state.status) location.reload();
  });
  events.addEventListener("plan", () => ui.planChanged());

  // A page restored from the back/forward cache would have an outdated round and answers.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  // Tab closed within half a second of an answer: the beacon still goes out. The event stream is
  // closed: otherwise every page left behind keeps a connection, and the browser caps how many
  // there can be per host.
  window.addEventListener("pagehide", () => {
    events.close();
    if (!store.timer) return;
    clearTimeout(store.timer);
    store.timer = null;
    writeLocal(key, store.answers);
    const body = new Blob([JSON.stringify(store.answers)], { type: "application/json" });
    navigator.sendBeacon?.(`/api/answers?id=${encodeURIComponent(planId)}&round=${state.round}`, body);
  });
}

function assetUrl(planId, file) {
  if (!file) return "";
  if (/^(https?:|data:)/.test(file)) return file;
  return `/plans/${encodeURIComponent(planId)}/${file.replace(/^\.?\//, "")}`;
}

boot();
