# Iterative Debug Loop — Full Reference


> **Code in this reference is illustrative. Adapt to your game and verify in Studio before production use.**

You are performing an evidence-led debug loop on a Roblox project. No fix may
precede a reproducible failure and an evidence-backed root-cause hypothesis.
After three failed fixes, stop and discuss architecture before a fourth.

---

## Step 1: Error Gathering

**Sync Mode (files on disk):**
Read the error from the user's description or ask them to paste the error message, stack trace, and any relevant output.

**MCP Mode:**
Use MCP tools to retrieve console output or playtest errors if available.

Record:
- Error message (exact text)
- Stack trace (script name + line number)
- When it occurs (on join, on action, on timer, etc.)
- Exact reproduction and whether it is consistent

---

## Step 2: Code Discovery

Read the relevant script(s) from the synced folder (or via MCP if in MCP-Only Mode). Search for the error message, relevant function names, or the script from the stack trace.

---

## Step 3: Root Cause Analysis

Analyze the error against common Roblox issue categories. Load `skills/roblox-sharp-edges/SKILL.md` for known gotchas.

Check recent changes and find a similar working path. Trace the faulty value or
state backward across client, remote, server, and service boundaries until its
source is identified. Do not patch the final symptom.

Categorize the error:
- **Syntax** - Missing `end`, typos, incorrect syntax
- **Runtime** - nil access, missing service, Instance destroyed
- **Logic** - Wrong calculation, incorrect condition, missing state
- **Security** - Client-side issue that should be server-side, unvalidated remote
- **Performance** - Timeout, memory, script contention

If the `roblox-sharp-edges` skill is available, load it for known gotchas. Otherwise, proceed with general Luau knowledge.

Identify:
1. The exact line(s) causing the error
2. Why the error occurs (root cause, not symptom)
3. Whether this is a standalone bug or a symptom of a deeper issue

---

## Step 4: Hypothesis and Minimal Test

State one hypothesis: “X is the root cause because Y.” Capture the smallest
failing reproduction, then test one variable. Never bundle speculative fixes.

If the fix involves architectural changes (not just a line fix), explain the change clearly and suggest where else the same pattern applies.

---

## Step 5: Apply & Test

Write one root-cause fix. Read the exact resource back to prove deployment, then
rerun the original reproduction and relevant regression checks.

If in offline mode, provide the corrected code with clear before/after diff and manual test instructions.

---

## Step 6: Verify

Check if the error is resolved:
- If **resolved**: Proceed to Step 7
- If **new errors appear**: Update error record, return to Step 1 with new information
- If **same error persists**: Do not stack another change; return to Step 1 with
  the new evidence and form a different hypothesis
- If **three fixes failed**: Stop and discuss whether the architecture is wrong
  before attempting fix four

At escalation, output:
1. All attempted fixes and why each was rejected
2. Remaining hypotheses
3. Recommended next steps (manual investigation, Roblox DevForum search, etc.)

---

## Step 7: Summary

Document the completed fix:

1. **Bug description** - What was happening
2. **Root cause** - Why it was happening
3. **Fix applied** - Exact changes made
4. **Verification** - How it was confirmed fixed
5. **Related risks** - Other places that might have the same issue
6. **Prevention** - Pattern to follow to avoid this class of bug in the future

If the bug revealed a systemic issue, recommend running `/code-review` for a full scan.
