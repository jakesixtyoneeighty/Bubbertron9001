# Roblox Game Design — Full Reference

> Adapted for B9 from obra/superpowers `brainstorming` v6.1.1. Preserve B9's
> coordinator-only mutation, approval, and resource-scoped verification rules.

## 1. Scope the Design

Inspect before asking questions. Identify existing services, modules, UI style,
assets, naming, authority boundaries, and any systems the feature must extend.
Prefer a low-churn design that fits those patterns.

A request needs design discovery when two reasonable implementations would
produce meaningfully different player experiences, data models, risk, or work.
Typical signals are a new game or mode, vague terms such as “complete,” or a
request spanning several systems. A precise property edit does not need a
separate design conversation.

For a large request, split it into independently playable vertical slices.
Design the first slice completely rather than sketching every future system.

## 2. Resolve Material Choices

Ask only questions that affect the result. One question per turn keeps choices
easy to answer. Lead with a recommendation and 2-3 options when possible.

For gameplay systems, resolve the smallest relevant subset of:

- Target player, party size, device mix, and session length
- Core action, feedback loop, win/loss, restart, and late-join behavior
- Difficulty curve, rewards, progression, and persistence
- Server authority, remote inputs, and exploit-resistant validation
- Content and visual scope, including placeholder versus final assets
- Performance budget and mobile constraints
- Exact playtest scenarios that demonstrate success

Do not turn this into a generic questionnaire. Inspection may already answer
style, structure, and platform questions.

## 3. Compare Approaches

Offer distinct viable approaches, not cosmetic variations. Compare:

- Player experience and iteration speed
- Compatibility with the current experience
- Security and data risk
- Performance and content cost
- Reversibility and verification difficulty

Recommend one approach. YAGNI applies: avoid systems that the approved vertical
slice does not need.

## 4. Design Contract

Present a compact design scaled to the task. It should name:

1. **Player loop** — What players do, what changes, and how a session ends.
2. **State model** — Named states and valid transitions.
3. **Ownership** — Which decisions are server-authoritative and which UI or
   effects are client-owned.
4. **Structure** — Services, modules, instances, and their interfaces.
5. **Lifecycle** — Join, leave, death, restart, cancellation, and cleanup.
6. **Failure behavior** — Safe defaults, retries, and partial-failure handling.
7. **Budget** — Instance, network, memory, and frame-time constraints.
8. **Verification** — Static readbacks and runtime cases, kept distinct.

Ask for approval of the design or an exact Change Preview before Studio writes.
If the user rejects discovery, offer one bounded reversible slice with explicit
assumptions. Do not interpret refusal as approval for a broad build.

## 5. Plan Handoff

Translate the approved design into B9's visible 2-8 step plan. Each step should
name relevant skills/tools and observable success criteria. The final step must
verify the designed behavior. Static reads can prove structure; runtime claims
need a connected playtest or must remain labeled `ready to playtest`.

## Common Mistakes

| Mistake | Correction |
|---|---|
| “The user wants speed, so defaults are permission.” | State assumptions and approve a bounded slice. |
| Many questions before inspection | Inspect, then ask only material unknowns. |
| Design by object count | Define a playable behavior and acceptance cases. |
| Generic plan equals design | Resolve player experience and system boundaries first. |
| Readback proves gameplay | Separate structural evidence from playtest evidence. |
