# Roblox Test-Driven Development — Full Reference

> Adapted for Roblox Studio and B9 from obra/superpowers
> `test-driven-development` v6.1.1.

## 1. Define One Observable Behavior

Start with a statement a player or consuming module could observe. Examples:
“a second receipt with the same purchase ID grants nothing” or “the round moves
from Intermission to Active only after the timer expires.” Avoid tests that only
mirror implementation details.

Find the repository's existing framework and conventions. If none exists, keep
the first harness small and reversible; do not introduce a large framework just
to test one function.

## 2. Isolate Roblox Dependencies

Put deterministic policy in a ModuleScript and inject effects behind narrow
interfaces. Useful seams include:

- Clock: `now(): number`
- Random source: `nextInteger(min, max): number`
- Store: `load(key)` and `update(key, transform)`
- Remote output: a callback or event adapter
- Player/session lookup: explicit stable IDs and state objects

This allows fast tests without production DataStores, purchases, real players,
or network timing. Integration behavior still needs a bounded Studio test.

## 3. RED

Write one minimal test and run it before production code. Confirm:

- It fails, rather than crashing because the harness is broken.
- The failure message matches the missing behavior.
- It would pass only when the intended contract is satisfied.

If the test passes immediately, it does not demonstrate a missing behavior.
Strengthen or correct it before implementation.

For a bug in existing code, first reproduce the exact symptom. When safe, prove
the regression test by observing failure with the defect present and success
with the fix present.

## 4. GREEN and Refactor

Implement the smallest coherent behavior that satisfies the test. Do not bundle
unrelated cleanup, future configuration, or broad architecture changes. Run the
focused test and relevant suite. Refactor only after green and rerun afterward.

Studio mutation readback remains mandatory and separate. A readback proves the
right source/property was written; it cannot prove runtime behavior.

## 5. Risk-Focused Cases

Choose cases relevant to the changed system:

| System | High-value cases |
|---|---|
| Remotes | malformed types, bounds, unauthorized state, rate limit |
| Persistence | defaults, migration, failed load, retry, session ownership |
| Inventory | bounds, capacity, stacking, insufficient quantity, round-trip serialization |
| Economy | idempotency, duplicate receipt, insufficient balance, rollback |
| State machine | valid/invalid transitions, timeout, cancel, restart, cleanup |
| Character lifecycle | join, leave, death, respawn, missing character |
| UI/domain split | domain state updates without requiring a real ScreenGui |

Never use production keys, real currency, publication, or destructive cloud
state in a test.

## 6. Evidence and Reporting

Record the exact test or harness, expected RED result, GREEN result, relevant
suite result, and any unavailable runtime check. If B9 cannot execute the test,
prepare it and say it remains pending. “Looks correct” and structural readback
are not substitutes for behavioral evidence.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Tests written only after implementation | Label honestly; add regression proof or restart test-first. |
| Testing framework internals or mocks | Assert externally meaningful domain behavior. |
| Live DataStore in tests | Inject a mock/test store with isolated keys. |
| Huge first test | Split to one behavior and one failure reason. |
| “Manual later” reported as complete | End at ready to test/playtest. |
