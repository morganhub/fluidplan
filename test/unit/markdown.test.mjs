import assert from "node:assert/strict";
import { test } from "node:test";
import { md, setMdLang } from "../../engine/public/js/md.js";

test("generated plans render adjacent headings, nested criteria and readonly checklists", () => {
  setMdLang("en");
  const result = md("# Plan\n## Work\n- Acceptance:\n  - [x] First\n  - [ ] Second\n## End", { headingOffset: 1 });
  assert.match(result, /^<h2>Plan<\/h2><h3>Work<\/h3>/);
  assert.match(result, /<ul><li>Acceptance:<ul><li class="md-task"><input type="checkbox" disabled checked>First<\/li><li class="md-task"><input type="checkbox" disabled>Second/);
  assert.match(result, /<h3>End<\/h3>$/);
});

test("tables, quotes and code are readable, escaped, and do not allow active markup", () => {
  const result = md('| Name | Value |\n| --- | --- |\n| A \\| B | <script>bad</script> |\n\n> **Draft**\n\n```js\n<x>\n```\n\n[bad](javascript:alert(1))');
  assert.match(result, /<th scope="col">Name<\/th>/);
  assert.match(result, /<td>A \| B<\/td><td>&lt;script&gt;/);
  assert.match(result, /<blockquote><p><strong>Draft<\/strong><\/p><\/blockquote>/);
  assert.match(result, /data-language="js"><code>&lt;x&gt;<\/code>/);
  assert.doesNotMatch(result, /<script>|href="javascript:/);
});

test("an unfinished code fence still renders safely", () => {
  assert.equal(md("```\n<script>"), '<pre class="code-block"><code>&lt;script&gt;</code></pre>');
});
