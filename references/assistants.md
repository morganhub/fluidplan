# Launching and listening across assistants

The engine is shared by Claude Code, Codex, and Gemini in Antigravity. The web page sends a round
to the local server; `wait` notices `state.status === "submitted"`, prints the digest, and exits.
The assistant then revises `plan.json`, runs `check` and `next-round`, and starts a fresh `wait`.
`finalize` ends the review and writes the outputs. These commands and the round files have the
same meaning on every client; the page does not call a conversation API.

Run commands from the target project, or pass its absolute path with `--root`. Always name the
plan with `--plan <id>` so another open plan cannot capture the listener. Keep at most one wait
command for that plan in your session. Cancel your pending wait when the person interrupts.

The HTTP server must stay alive while the person reviews. The wait command must remain attached
to an assistant tool job, so its result reaches the assistant. Only detach the server. On Windows,
if launching it with `Start-Process`, use `-WindowStyle Hidden` and redirect output to temporary
logs; otherwise use the client's persistent terminal/background task facility.

## Claude Code

Keep the existing workflow: run `serve --plan <id> --open` and `wait --plan <id>` with the shell
tool's `run_in_background` option. Retain the wait task ID and use the client's task output or
completion notification to receive its digest. The completed wait task is the continuation
signal. After `next-round`, arm another background wait for the next round. No new hook,
configuration, or conversation API is required.

## Codex

1. Start the persistent server and tell the person that the plan is ready and you are listening.
   Use a progress/commentary message; the review is still ongoing.
2. Run `node <skill>/engine/fluidplan.mjs wait --plan <id>` as a tracked shell-tool job.
   With `exec_command`, use a short `yield_time_ms` and retain the returned `session_id`.
3. If the job is still running, await it with `write_stdin` (empty input) in 10–30 second slices.
   If your host instead returns a code-execution cell ID, use its documented cell-wait tool.
   Follow only the waiting API and IDs actually returned by the host. Keep the same job alive.
4. On successful completion, process the returned digest immediately. If anything is unanswered
   or needs revision, run `check`, then `next-round`, and repeat steps 2–4.
5. Once the submitted plan is settled and unchanged since submission (`approval.approved`),
   run `finalize`. When `approval.autoExecute` is true, read the
   generated plan and execute its retained tasks immediately in the same active turn. Announce
   the transition in commentary; do not ask the person to type "execute", confirm in chat, or
   approve a second time. Round 1 is sufficient; later rounds work the same way after their
   revisions are accepted. In `execution: "review"` mode, stop after generating the documents.
6. Continue until the agreed tasks and checks are complete, or the person interrupts. If a new
   material choice appears during implementation, use the page review loop for that choice.
   Preserve earlier accepted choices and keep listening until the new round is submitted.

Do not send a final response between rounds or between approval and automatic implementation.
The page approves the accepted scope, not changes to Codex's tool permissions. Do not modify
approval settings or infer permission to publish or deploy from a local implementation plan.
Background shell jobs or
asynchronous hooks alone do not start a new idle turn. An optional synchronous `Stop` hook can
guard against premature completion on clients that support it, but is not needed for this loop.
The local server never runs a plan's shell commands itself: the active Codex turn implements them.
If the session ended, a background server cannot resume that idle assistant by itself.
On recovery, read the generated checklist and actual project changes first. Resume incomplete
tasks; do not repeat tasks whose acceptance criteria are already met.
The approval snapshot covers both the plan and answers. Edits after submission need a fresh
review before automatic execution; exporting a preview or forcing a draft is not approval.

## Gemini in Antigravity

Use the same tracked-wait loop as Codex, through the terminal tools exposed by your Antigravity
version. Launch the server as a persistent terminal task. Launch `wait` through `run_command`
(or the available terminal execution tool); keep its returned command/task ID and await its
output with the provided command-status/wait tool. Use 10–30 second waiting slices and retain
the active agent turn until submission. If `command_status` is exposed, use that tool's declared
parameters; do not assume another version has the same tool names or schemas.

After submission, use the returned digest, revise, check, and open the next round, then rearm
the listener. A browser tab, running server, or completed final message alone is not a listener.

## Hosts without persistent job-wait tools

Use `node <skill>/engine/fluidplan.mjs wait --plan <id> --timeout 45` repeatedly in the same active
agent turn. Exit `0` means a submitted round and includes its digest; exit `2` means the plan is
already finalized; exit `3` only means the waiting slice elapsed, so start another slice. Treat
other failures as errors to diagnose, not as submissions. A short timeout is not a reason to ask
the person to type "sent".

If the session is interrupted or closed, automatic listening stops. On resume, use `digest` for
an already submitted round, or restart `wait` for an open round. If the host cannot keep a turn
active or await shell commands at all, explain that limitation and use the manual "sent" recovery
path; do not claim that automatic listening is active.

## Client documentation

- [Codex hooks: background delivery and Stop continuation](https://learn.chatgpt.com/docs/hooks)
- [Antigravity skill discovery and installation locations](https://www.antigravity.google/docs/skills?tab=ide)
- [Antigravity terminal execution tool](https://antigravity.google/docs/sdk/tools)
