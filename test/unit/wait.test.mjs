// Real CLI waits against web submissions: editing answers must not wake the assistant,
// sending a round must, and a new wait must listen again after next-round.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../../engine/lib/config.mjs";
import { finalize, nextRound } from "../../engine/lib/rounds.mjs";
import { startServer } from "../../engine/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../../engine/fluidplan.mjs");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
process.env.FLUIDPLAN_ENV_FILE = "none";

function removeTemporaryRoot(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("fluidplan-wait-"));
  rmSync(resolved, { recursive: true, force: true });
}

function waitCommand(t, root, ...args) {
  const child = spawn(process.execPath, [CLI, "wait", "--root", root, "--plan", "mini", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let closed = false;
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => { closed = true; resolve({ code, stdout, stderr }); });
  });
  t.after(async () => { if (!closed) child.kill(); await result; });
  return { result, isClosed: () => closed };
}

test("web submission releases wait, and the next round can be listened to again", { timeout: 15000 }, async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-wait-"));
  t.after(() => removeTemporaryRoot(root));
  const dir = path.join(root, ".fluidplan", "mini");
  cpSync(path.resolve(HERE, "../fixtures/plans/mini"), dir, { recursive: true });
  const config = resolveConfig({ root, port: 5900 + Math.floor(Math.random() * 500) });
  const { server, port } = await startServer(config, { quiet: true, register: false });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const api = async (route, options) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/${route}?id=mini`, options);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };

  const first = waitCommand(t, root, "--timeout", "10");
  await api("answers", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ D1: { status: "modify", comment: "Use an in-memory cache." }, D3: { status: "ok" } }),
  });
  await sleep(1200);
  assert.equal(first.isClosed(), false, "saving an answer is not sending the round");
  await api("submit", { method: "POST" });
  const sent = await first.result;
  assert.equal(sent.code, 0, sent.stderr);
  assert.match(sent.stdout, /sent round 1/);
  assert.match(sent.stdout, /Use an in-memory cache\./);
  assert.match(sent.stdout, /### D1/);

  const file = path.join(dir, "plan.json");
  const plan = JSON.parse(readFileSync(file, "utf8"));
  const decision = plan.pages.flatMap((page) => page.decisions).find((d) => d.id === "D1");
  decision.proposal = "Use an in-memory cache.";
  decision.revision = { round: 2, note: "In-memory cache selected." };
  writeFileSync(file, JSON.stringify(plan, null, 2));
  await nextRound(config, "mini");
  const second = waitCommand(t, root, "--timeout", "10");
  await sleep(1200);
  assert.equal(second.isClosed(), false, "a rearmed listener does not replay round 1");
  await api("submit", { method: "POST" });
  const sentAgain = await second.result;
  assert.equal(sentAgain.code, 0, sentAgain.stderr);
  assert.match(sentAgain.stdout, /sent round 2/);

  const attachedLate = await waitCommand(t, root, "--timeout", "1").result;
  assert.equal(attachedLate.code, 0, "a submitted round remains available when attaching late");

  await nextRound(config, "mini");
  const answers = Object.fromEntries(plan.pages.flatMap((page) => page.decisions).map((d) => [
    d.id, { status: "ko", items: Object.fromEntries((d.items ?? []).map((item) => [item.id, { status: "ko" }])) },
  ]));
  await api("answers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(answers) });
  await api("submit", { method: "POST" });
  await finalize(config, "mini");
  const finished = await waitCommand(t, root, "--timeout", "1").result;
  assert.equal(finished.code, 2, "a finalized review ends listening");
});

test("a bounded wait times out without submitting or changing a round", { timeout: 6000 }, async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "fluidplan-wait-timeout-"));
  t.after(() => removeTemporaryRoot(root));
  cpSync(path.resolve(HERE, "../fixtures/plans/mini"), path.join(root, ".fluidplan", "mini"), { recursive: true });
  const result = await waitCommand(t, root, "--timeout", "1").result;
  assert.equal(result.code, 3, result.stderr);
  assert.match(result.stdout, /status "review"/);
});
