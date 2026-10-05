import { accordion } from "./ui.js";

// Change disclosure state only when the reader changes density; preserve manual openings.
export function readingDetail(ctx, options) {
  let density = ctx.density;
  const el = accordion({ ...options, open: density === "detailed", className: "reading-detail" });
  return { el, update() {
    if (density === ctx.density) return;
    density = ctx.density;
    el.open = density === "detailed";
  } };
}
