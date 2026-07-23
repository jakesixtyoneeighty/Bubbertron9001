---
name: roblox-test-driven-development
description: "Use when implementing testable Roblox behavior or fixing a Luau bug before writing production code."
last_reviewed: 2026-07-23
sources:
  - https://github.com/obra/superpowers/tree/v6.1.1/skills/test-driven-development
  - original
---

## When to Load

Load for gameplay logic, services, remotes, economy, persistence, state
machines, reusable modules, and bug fixes. If behavior is tightly coupled,
create the narrowest safe test seam first. Only purely visual or exploratory
changes should use manual-only verification.

## Quick Reference

### Red-Green-Refactor

1. **Inspect** — Find the existing test framework and separate deterministic
   domain logic from Studio services, network, clocks, randomness, and storage.
2. **RED** — Write the smallest persistent regression test for one behavior.
   Use an approved disposable harness only when no test can be retained. Run it
   and confirm it fails for the expected missing behavior.
3. **GREEN** — Implement only enough production code to pass that test.
4. **Verify** — Run the focused test, then the relevant suite. Read back every
   Studio mutation separately; readback proves deployment, not behavior.
5. **Refactor** — Improve structure only while the tests stay green.
6. **Repeat** — One behavior at a time, including failure and cleanup paths.

If production code was written before a meaningful test, do not pretend a test
added afterward proves the red phase. Add a regression test and honestly label
the evidence as test-after, or—when safe and proportionate—revert the unproven
implementation and restart test-first.

### Roblox Test Boundaries

- Prefer pure ModuleScripts with injected adapters for DataStore, remotes,
  time, randomness, and player/session state.
- Use test stores, mocks, or in-memory fakes. Never point tests at production
  DataStore keys, live purchases, publishing, or destructive cloud actions.
- Test server validation and idempotency, not just the happy client path.
- A source/property readback is structural evidence. A passing test or observed
  connected playtest is behavioral evidence.
- Running arbitrary test code through Studio still requires the normal approval.

### Blocked Runtime

When B9 cannot start a runner or playtest, still prepare the smallest safe test
and give exact steps for the user to run it. Report **implemented; test pending**
or **ready to playtest**, never complete, passing, or fixed. A request to skip
tests changes the reported evidence/status; it does not make behavior verified.

### Red Flags

- “Studio testing is slow, so script readback is enough”
- Writing several production behaviors before the first test
- A test that passes on its first run without proving it can catch the defect
- Tests that touch live persistence, purchases, or publication
- Mock-call assertions that never exercise real domain behavior
- Refactoring unrelated code during GREEN

📖 Full reference: `references/full.md`
