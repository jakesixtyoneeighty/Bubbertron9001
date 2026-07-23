---
name: roblox-debug
description: "Use when diagnosing Roblox or Luau errors, crashes, or unexpected behavior with an iterative reproduce, inspect, fix, and verify loop."
last_reviewed: 2026-07-12
sources:
  - https://github.com/obra/superpowers/tree/v6.1.1/skills/systematic-debugging
  - original
---

## When to Load

Load when diagnosing errors, crashes, test failures, or unexpected Roblox/Luau
behavior. **Hard gate:** no fix without a reproducible failure and an
evidence-backed root-cause hypothesis. Urgency never lowers this bar.

## Quick Reference

### 7-Step Debug Loop

**1. Error Gathering** — Get exact error, stack trace, trigger, and consistent
reproduction. Capture a failing case before editing.

**2. Code Discovery** — Read relevant script(s). Search for error text, function names, or script from stack trace.

**3. Root Cause Analysis** — Categorize: Syntax · Runtime · Logic · Security ·
Performance. Check recent changes and a working example. Trace the faulty value
or state across client, server, remote, and service boundaries to its source.
Load `roblox-sharp-edges` for known gotchas.

**4. Hypothesis & Minimal Test** — State “X is the root cause because Y.” Test
the smallest possible change, one variable at a time. Never bundle likely fixes.

**5. Apply & Test** — Apply one root-cause fix. Read back the exact mutation,
then rerun the original reproduction and relevant regression checks.

**MCP evidence:** discover/select Studio, inspect before editing, read back the fix, run playtest when relevant, and report console/screenshot limitations explicitly.

**6. Verify** — Readback proves only that code was written. Behavior requires the
original reproduction/test. After a failed fix, do not stack changes; return to
the last known baseline unless the change is independently required, then return
to Step 1 with new evidence. After 3 failures, discuss architecture before #4.

**7. Summary** — Document: bug description · root cause · fix applied · verification · related risks · prevention pattern. If systemic, recommend `/code-review`.

### Escalation
Report attempted hypotheses/evidence, remaining causes, architecture concerns,
and next safe checks. If behavior cannot be rerun, report it as unverified.

📖 Full reference: `references/full.md`
