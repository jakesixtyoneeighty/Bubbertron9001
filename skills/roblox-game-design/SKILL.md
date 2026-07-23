---
name: roblox-game-design
description: "Use before building a new Roblox game, game mode, or materially ambiguous gameplay feature."
last_reviewed: 2026-07-23
sources:
  - https://github.com/obra/superpowers/tree/v6.1.1/skills/brainstorming
  - original
---

## When to Load

Load before Studio mutations when a request introduces a new game, game mode,
core loop, or feature whose player experience has material unanswered choices.
Do not load for a narrow, fully specified edit or a straightforward bug fix.

## Quick Reference

### Design Gate

1. **Inspect first** — Read relevant hierarchy, scripts, and existing style.
2. **Find material unknowns** — Player goal, round or session flow, win/loss,
   audience, progression, content scope, platform constraints, and success test.
3. **Ask one question at a time** — Give 2-3 concrete choices and a recommended
   default when possible. Do not ask what inspection can answer.
4. **Compare approaches** — Present 2-3 viable shapes with real tradeoffs.
5. **Present a compact design** — Cover the core loop, authority, structure,
   lifecycle/cleanup, UI/input, performance, and verification.
6. **Get approval before mutation** — Approval may be a user-approved design or
   an exact Change Preview. Then create or revise the visible execution plan.

Urgency or “just start” does not settle product choices. If the user declines
discovery, propose one bounded, reversible vertical slice with explicit
assumptions and ask approval for that scope. Measure playable behavior, not count.

Approval must be an explicit response after the design/preview. The original
request, silence, or Studio mutation permission is not design approval. An exact
preview names paths, operations, responsibilities, and maximum object counts.

### Handoff Contract

The approved design must give the plan:

- Exact in-scope and out-of-scope behavior
- Server/client ownership and trusted boundaries
- Persistent versus session-only state
- Named lifecycle states and cleanup paths
- Acceptance cases and the evidence each case needs

If a plan is required first, make it discovery-only; do not implement before
design approval. Never use `roblox_run_code` to bypass previewable structured
mutations and resource-scoped verification.

Keep all writes coordinator-owned and serialized. End at **ready to playtest**
unless a connected playtest actually proves the designed behavior.

### Red Flags

- Choosing broad defaults only because the user asked for speed
- Treating a scaffold or high instance count as a finished game loop
- Asking many generic questions before inspecting the current experience
- Mutating while the design or Change Preview still has material ambiguity
- Treating generic run permission as approval of the proposed design
- Using arbitrary code to bypass previewable structured mutations
- Calling static script/property readback proof of runtime gameplay

📖 Full reference: `references/full.md`
