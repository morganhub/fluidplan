import { h } from "./dom.js";
import { md } from "./md.js";
import { accordion, button, tabs, toast } from "./ui.js";

export function documentPreview(id, t) {
  const article = h("div", { class: "md-document" });
  const outline = h("nav", { class: "md-outline", "aria-label": t("document.outline") });
  const toc = accordion({ label: t("document.outline"), content: outline });
  const raw = h("pre", { class: "md-preview" });
  const view = tabs({ ariaLabel: t("document.view"), items: [
    { id: `${id}-read`, label: t("document.read"), render: () => h("div", { class: "document-reader" }, toc, article) },
    { id: `${id}-source`, label: t("document.source"), render: () => raw },
  ] });
  let previous;
  return { el: view.el, setText(text) {
    if (text === previous) return;
    previous = text;
    raw.textContent = text;
    article.innerHTML = md(text, { headingOffset: 1 });
    outline.replaceChildren(...[...article.querySelectorAll("h2,h3,h4,h5,h6")].map((heading, index) => {
      heading.id = `${id}-heading-${index}`;
      heading.tabIndex = -1;
      return button({ label: heading.textContent, variant: "ghost", className: `toc-level-${heading.tagName.slice(1)}`, onclick: () => {
        heading.scrollIntoView({ block: "start", behavior: "smooth" });
        heading.focus({ preventScroll: true });
      } });
    }));
    toc.hidden = !outline.childNodes.length;
    for (const pre of article.querySelectorAll("pre.code-block")) {
      pre.append(button({ label: t("document.copyCode"), size: "sm", variant: "outline", className: "copy-code", onclick: async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector("code").textContent);
          toast(t("document.copied"), { variant: "success" });
        } catch { toast(t("document.copyFailed"), { variant: "error" }); }
      } }));
    }
  } };
}
