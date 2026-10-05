// Minimal, safe Markdown for a plan's texts: paragraphs, “-” and “1.” lists, ``` code blocks,
// **bold**, *italic*, `code`, [links](https://…). Everything is escaped first; nothing else is
// interpreted. French typography (non-breaking spaces) applies only when the plan is in French.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
let lang = "fr";

export function setMdLang(value) {
  lang = value;
}

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function inline(text) {
  const saved = [];
  const keep = (html) => {
    saved.push(html);
    return `\u0000${saved.length - 1}\u0000`;
  };
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  // Links: http(s) only, opened in a new tab; the link text keeps its formatting.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>");
  if (lang === "fr") {
    // No guillemet or high punctuation mark left orphaned at a line break.
    out = out.replace(/« /g, "«&nbsp;").replace(/ »/g, "&nbsp;»").replace(/ ([:;?!])(?=\s|$|<)/g, "&nbsp;$1");
  }
  let previous;
  do {
    previous = out;
    out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => saved[Number(i)]);
  } while (out !== previous);
  return out;
}

// A line parser keeps generated exports readable without allowing raw HTML or unsafe links.
export function md(text, { headingOffset = 0 } = {}) {
  if (!text) return "";
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const output = [];
  const listItem = (line) => line.match(/^(\s*)([-•*]|\d+[.)])\s+(.+)$/);
  const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
  const tableRule = (line) => line.includes("|") && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
  const startsBlock = (line, next = "") => /^(#{1,6}\s|\s*```|>\s?|[-*_]{3,}\s*$)/.test(line) || Boolean(listItem(line)) || tableRule(next);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      const language = fence[1].trim();
      output.push(`<pre class="code-block"${language ? ` data-language="${escapeHtml(language)}"` : ""}><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + headingOffset);
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue;
    }
    if (i + 1 < lines.length && line.includes("|") && tableRule(lines[i + 1])) {
      const head = cells(line), rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]));
      output.push(`<div class="md-table-wrap"><table><thead><tr>${head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${head.map((_, n) => `<td>${inline(row[n] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^> ?/, ""));
      output.push(`<blockquote>${md(quote.join("\n"), { headingOffset })}</blockquote>`); continue;
    }
    if (/^([-*_])\1{2,}\s*$/.test(line.trim())) { output.push("<hr>"); i++; continue; }
    if (listItem(line)) {
      const renderList = (indent) => {
        const first = listItem(lines[i]);
        const ordered = /^\d/.test(first[2]), tag = ordered ? "ol" : "ul";
        let html = `<${tag}>`;
        while (i < lines.length) {
          const item = listItem(lines[i]);
          if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
          const task = item[3].match(/^\[([ xX])\]\s+(.*)$/);
          html += task ? `<li class="md-task"><input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}>${inline(task[2])}` : `<li>${inline(item[3])}`;
          i++;
          while (i < lines.length && lines[i].trim()) {
            const nested = listItem(lines[i]);
            if (nested) {
              if (nested[1].length <= indent) break;
              html += renderList(nested[1].length);
            } else if (/^\s+/.test(lines[i]) && lines[i].search(/\S/) > indent) {
              html += `<br>${inline(lines[i++].trim())}`;
            } else break;
          }
          html += "</li>";
          // A blank line followed by another indented item stays within this list.
          if (!lines[i]?.trim()) {
            let next = i;
            while (next < lines.length && !lines[next].trim()) next++;
            if (listItem(lines[next] ?? "")?.[1].length === indent) i = next;
          }
        }
        return html + `</${tag}>`;
      };
      output.push(renderList(listItem(line)[1].length)); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) paragraph.push(lines[i++]);
    output.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
  }
  return output.join("");
}

// Plain text (tooltips, attributes): without Markdown marks.
export function plain(text) {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/(^|\s)\*(\S[^*]*?)\*/g, "$1$2");
}
