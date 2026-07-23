---
name: roblox-plan-execution
description: "Use when turning approved Roblox requirements into a multi-step Studio plan or reviewing a plan before mutation."
last_reviewed: 2026-07-23
sources:
  - https://github.com/obra/superpowers/tree/v6.1.1/skills/writing-plans
  - https://github.com/obra/superpowers/tree/v6.1.1/skills/executing-plans
  - original
---

## When to Load

Load after requirements or a design are approved for a multi-step build, edit,
or repair, and to review the visible plan before its first Studio mutation.

## Quick Reference

### Plan Contract

Create or revise a focused 2-8 step plan. Each step must include:

- One observable deliverable, not a vague activity
- Exact known Studio resources or the parent/search used to discover them
- Relevant `roblox-*` skills and tools
- Dependencies on earlier steps
- Mutation risk, approval, and rollback/undo needs
- Success criteria naming the matching structured readback
- A runtime test when the claim concerns behavior rather than structure

For creates, specify parent, class, name, role, and collision policy; a path is
not a creation contract.

Put inspection before writes. Keep coordinator mutations serialized. Workers may
only perform bounded read-only inspection, research, or plan review; merge their
evidence before acting. Worker evidence never verifies a coordinator mutation.

### Execution Loop

1. Review the plan against the approved scope and current Studio state.
2. Mark one step `in_progress` before its main work.
3. Inspect exact targets and check stale-state/collision risk.
4. Apply the smallest coherent mutation; surface partial failures.
5. Read back every changed resource with the matching structured tool.
6. Run or request the planned behavioral test when relevant.
7. Mark the step complete only when its success criteria have fresh evidence.
8. On failure, mark error, diagnose, revise the approach, and re-verify.

Revise a stale or impossible plan visibly when inspection changes assumptions.
Ask only when the missing choice changes the result or needs new authority.

A revision that changes approved behavior, targets, risk, bulk/delete scope, or
authority requires fresh design/Change Preview approval.

### Completion Gate

Before `agent_finish_plan`, confirm steps and workers are settled, every mutation
has scoped readback, and behavioral claims have test/playtest evidence. If
runtime evidence is unavailable, finish only with an
honest **ready to playtest** or **runtime verification pending** status.

### Red Flags

- “Implement feature” without exact behavior or success criteria
- A verification step that only says “check it works”
- Parallel worker Studio writes or unrelated readbacks
- Marking a step complete from a mutation response alone
- Continuing after the plan's assumptions are disproved
- Expanding scope through “while I’m here” edits

📖 Full reference: `references/full.md`
