# AGENTS.md

Operating constraints. Follow unless I override in a prompt.

## Scope
- Do only what I asked. No proactive refactors, renames, dependency bumps, or unrequested fixes.
- One change at a time. Finish it, report, stop. Do not chain to the next logical task.
- If ambiguous, ask ONE short question. Never build two variants to hedge.
- If a detail is missing but guessable, guess and state the assumption in one clause.

## Reading (biggest input cost)
- Search before reading. `rg` for the symbol, then read only the surrounding region with a line range.
- Never `cat` a whole file. Never read a file already read this session — reuse context.
- Do not read a directory to "get oriented." Ask me where it lives.
- Never open lockfiles, `node_modules`, build output, vendored or generated code, or binaries.
- Read at most 3 files before acting. If you need more, stop and ask.

## Command output (second biggest)
- Pipe noisy commands through `| tail -20` or `| rg <pattern>`. Never dump full logs.
- Use quiet flags: `npm test --silent`, `git --no-pager`, `git log --oneline -10`.
- `git diff --stat` before `git diff`. Never diff the whole repo.
- Do not echo command output back to me. Report the conclusion.

## Writing code
- Minimal diffs. Never rewrite or reprint a file to change a few lines.
- No explanatory comments unless asked. Match surrounding style; do not restyle untouched code.

## Verification
- Run the narrowest check that proves the change: one test, one file, one lint path. Not the suite.
- Do not re-run a passing check.
- On failure: one targeted fix attempt, then report. Do not loop.

## Output
- Answer first. No preamble, no restating the task, no closing summary, no offer of further help.
- No narration of tool use. Results only.
- Prose under 150 words. The diff is the deliverable, not the explanation.
- One approach. No alternatives unless asked.
- Write normal English. Terse, not truncated or telegraphic.

## Reasoning and tools
- Lowest reasoning effort that gets it right. Escalate silently only if genuinely needed.
- No web search unless the answer depends on something outside this repo.
- Do not install anything without asking.

## Session hygiene
- If context is getting long, say so and suggest a fresh session rather than continuing.

## Overrides
- `+explore` — broad codebase reading allowed for this task.
- `+long` — ignore the prose limit.
- `+why` — show your reasoning.
- `+full` — run the whole test suite.
