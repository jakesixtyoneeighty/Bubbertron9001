# Roblox Verification — Full Reference

> Adapted for B9 from obra/superpowers `verification-before-completion` v6.1.1.
> Evidence must respect B9's coordinator ownership and resource-scoped readbacks.

## 1. Convert Requirements into Claims

Re-read the approved design, request, and visible plan. List each statement the
final response would make. Classify it:

- **Structural** — Instance, class, parent, property, source, or ownership marker
- **Behavioral** — Player-observable runtime result or state transition
- **Quality** — Performance, security, persistence, compatibility, or polish
- **Operational** — Undo, recovery, publication, or production readiness

Do not let a passing structural check silently expand into a behavioral claim.

## 2. Build the Proof Map

Use the narrowest sufficient evidence for every claim. Structural mutations need
matching structured readbacks for each affected resource. Behavioral claims need
focused automated tests or a connected playtest that executes the acceptance
path and directly inspects its outcome. Connection, running state, or empty logs
do not prove behavior. Security requires
negative/adversarial cases; performance requires measurement on the relevant
device/load; persistence requires isolated save/load, failure, and migration
cases. Publication needs the dedicated checklist and external prerequisites.

Mutation receipts, plan status, worker summaries, generated source, generic logs,
or an unrelated successful read do not prove the target claim.

## 3. Freshness and Scope

Gather evidence after the latest relevant change. A repair invalidates earlier
proof for affected resources and behavior. Confirm:

1. Exact canonical resource paths match the mutation targets.
2. Each target has later coordinator readback.
3. The test exercised the changed behavior and correct environment.
4. Failures, warnings, and skipped cases are recorded.
5. Every approved acceptance criterion maps to evidence or a named gap.

When a playtest is already running, B9 may inspect state/logs but must not make
persistent mutations. Ask the user to stop before repair, then gather new proof.

## 4. Verify Repairs

For a bug fix, preserve the original reproduction. Observe failure with the
defect when feasible, then success after the fix. If a proposed fix fails, form
a new hypothesis rather than stacking speculative edits. Fresh evidence must
follow the final mutation.

## 5. Report the Narrowest True Status

Good final reporting names:

- What changed
- Exact checks that passed
- What was not executable or did not pass
- Whether the state is complete, partially applied, ready to playtest, or blocked
- Undo/recovery availability

If tests cannot run, source/readback can still be reported—but only as structural
verification. Never convert confidence into evidence.

## Common Mistakes

| Mistake | Correction |
|---|---|
| “The write succeeded, so it is done.” | Read the exact target after the write. |
| “The script looks right.” | Run the focused behavior test/playtest. |
| “No log errors.” | Exercise the actual acceptance case. |
| “The worker verified it.” | Coordinator corroborates with direct evidence. |
| “Most targets passed.” | Report partial status and every failed target. |
| “Old test was green.” | Rerun after the latest relevant mutation. |
