# Roblox Plan Execution — Full Reference

> Adapted for B9 from obra/superpowers `writing-plans` and `executing-plans`
> v6.1.1. B9's visible plan and coordinator remain authoritative.

## 1. Review Before Mutation

The runtime may require an initial plan before inspection. Treat that as a
living hypothesis. After loading relevant skills and inspecting Studio, revise
the visible plan when paths, architecture, or requirements differ.

Check:

- Every approved requirement maps to a step and success criterion.
- No step assumes an instance, script, API, or convention that was not found.
- Dependencies are ordered and independently understandable.
- Deletion, arbitrary code, imported scripts, broad bulk edits, and publication
  retain their required user approval.
- The plan ends with appropriate static and behavioral evidence.

## 2. Right-Size Steps

A good step produces one coherent result that can be verified before the next
dependent mutation. Fold setup into the behavior it enables. Split steps when
they have different risks, authority, rollback, or acceptance evidence.

Weak: “Build the inventory.”

Stronger: “Add the server-authoritative inventory ModuleScript under the
existing service, preserving its public interface; verify the exact source and
run the focused add/remove/idempotency tests.”

Keep the total at 2-8 steps. For a larger design, plan one playable vertical
slice and defer later slices explicitly.

## 3. Resource and Evidence Map

For every mutation step, identify:

| Field | Question |
|---|---|
| Target | Which exact resource changes? |
| Discovery | If unknown, which parent or search resolves it? |
| Owner | Is the coordinator the sole mutation owner? |
| Risk | What approval or preview is needed? |
| Structural proof | Which matching readback covers each target? |
| Behavioral proof | Which test/playtest demonstrates the claim? |
| Recovery | What undo, rollback, or cleanup restores safe state? |

For creation, inspect the known parent, specify class/name/role/collision policy,
verify through that parent, then reuse Studio's canonical returned path. Never
guess or concatenate a descendant path.

Mutation responses are receipts, not verification. Generic logs and unrelated
reads cannot cover a changed resource.

## 4. Execute and Adapt

Work one plan step at a time. Mark it in progress, inspect, mutate, read back,
test, then complete. Use bulk tools only for independent equivalent operations
with the same risk and verification shape.

When evidence contradicts a plan assumption:

1. Do not guess a nearby path or repeat the mutation.
2. Mark or annotate the affected step visibly.
3. Inspect the nearest known parent or working example.
4. Revise the plan and success criteria.
5. Ask only if the new choice changes product intent or authority.

Changes to approved behavior, targets, risk, deletion/bulk scope, or authority
invalidate prior approval. Broad batches require an exact preview and bounded,
recoverable chunks with attributable failures and readback for every target.

After a tool failure, classify it and use `roblox-debug` when relevant. Never
hide a failed or dismissed worker result.

## 5. Finish Honestly

Re-read the approved scope and plan. Confirm every step is completed or
explicitly skipped, worker evidence is settled, and verification is fresh. Use
`agent_finish_plan(success=false)` when verification fails so repair remains
visible.

Static proof supports claims such as “the script source was updated.” Runtime
claims such as “round restart works” require an observed test/playtest. When B9
cannot obtain runtime evidence, report the build as ready to playtest and list
the exact pending cases.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Initial plan treated as immutable | Revise after real inspection. |
| Steps organized by tool calls | Organize by independently verifiable result. |
| Worker proposes and performs a write | Coordinator alone owns every write. |
| Readback of a sibling resource | Read each changed resource after mutation. |
| Stale evidence used to finish | Gather fresh evidence after the latest change. |
