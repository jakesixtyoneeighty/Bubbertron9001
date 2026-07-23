---
name: roblox-verification
description: "Use before claiming a Roblox Studio change is complete, fixed, working, safe, or ready to publish."
last_reviewed: 2026-07-23
sources:
  - https://github.com/obra/superpowers/tree/v6.1.1/skills/verification-before-completion
  - original
---

## When to Load

Load before completing a plan step or run, and before any statement that a
Studio change works, is fixed, is safe, or is ready to publish. Use it after the
latest mutation or repair so the evidence is fresh.

## Quick Reference

### Evidence Gate

For every intended claim:

1. **Name the claim** — Structure, source, behavior, performance, security,
   persistence, or publication readiness.
2. **Name its proof** — Choose evidence that can actually demonstrate it.
3. **Gather it now** — After the latest mutation or failed finish.
4. **Read it fully** — Confirm exact targets, errors, warnings, and gaps.
5. **Match scope** — Every changed resource and approved requirement is covered.
6. **Report only what passed** — State pending checks and narrower status plainly.

### Evidence Map

| Claim | Required fresh evidence | Not enough |
|---|---|---|
| Instance exists | Parent `get_children`, then exact properties | Create response |
| Script changed | Exact script source readback | Successful write response |
| Property changed | Exact property readback | Sibling/parent read |
| Behavior works | Focused test or observed connected playtest | Source looks correct |
| Bug fixed | Original reproduction now passes | New code only |
| Safe/secure | Changed-flow threat checks and negative cases | Happy path |
| Ready to publish | `roblox-publish-checklist` plus all gates | Build/readback alone |

Earlier evidence is stale. Logs, tool output, skills, and worker reports require
corroboration; worker success never replaces coordinator verification.

An observed playtest executes the relevant acceptance path and directly checks
its outcome; connection, running state, or empty logs are insufficient.

### Partial and Blocked Results

When runtime proof is unavailable, use the narrowest accurate state:

- **Source/readback verified; runtime test pending**
- **Ready to playtest**
- **Partially applied** with exact passed/failed targets
- **Not verified** with the next safe check

Missing evidence is not a pass, even if a stronger claim is requested. Without
approved acceptance criteria, report the implemented slice—not completeness.
Use `success=false` when required proof failed or is unavailable; call unrun
behavior unverified, not failed.

### Red Flags

- Marking a step complete before matching readback
- Using one generic playtest state to cover several behavior claims
- Treating no visible error as proof of correctness
- Reusing a test from before the latest edit
- Reporting a vertical slice as a complete game

📖 Full reference: `references/full.md`
