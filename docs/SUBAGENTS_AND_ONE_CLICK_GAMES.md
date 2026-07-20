# Sub-Agents and One-Click Games

Status: planning draft

## Direction

These two roadmap items should share orchestration and verification primitives,
but they should not ship at the same time.

1. Build scoped operations, change preview, and deterministic verification.
2. Ship one curated **One-Click Obby** through a single coordinator.
3. Add bounded, read-only sub-agents for research, inspection, and review.
4. Let workers propose isolated change sets only after ownership, cancellation,
   stale-state detection, and merge behavior have deterministic tests.
5. Add Tycoon after the starter-game contract is proven. Add FPS last because it
   raises networking, input, security, and multiplayer verification risk.

One-Click Games must not depend on sub-agents. The Obby workflow should instead
become the repeatable integration scenario used to prove sub-agent orchestration.

## Product contracts

### One-Click Games

A builder chooses a curated starter, adjusts a few understandable options,
reviews exactly what B9 will add, and presses **Generate** once. B9 installs an
editable starter in the currently open Studio place, verifies the resulting
manifest, and hands the builder to Playtest & Fix.

For the first release:

- generation is additive and never wipes the existing place;
- creating a new place and publishing remain separate Cloud Operations work;
- the preview is the approval boundary, so "one click" does not bypass safety;
- only bundled, reviewed content is installed—no arbitrary generated Luau and
  no Creator Store scripts;
- every generated instance is marked with a generation ID, template ID, and
  template version so B9 can resume, upgrade, or remove only its own work;
- completion means **ready to playtest**, not published or proven fun.

### Sub-agents

When a task is large, B9 may split research, Studio inspection, and review among
a small visible crew. One lead agent still owns the user goal, root plan,
questions, approvals, Studio mutations, verification, and final answer.

For the first release:

- at most two workers may run concurrently;
- workers cannot create workers;
- worker capabilities are enforced by their tool allowlists, not by prompting;
- workers may search skills or the web and use structured Studio readbacks;
- workers cannot ask the user questions, mutate Studio, or finish the root plan;
- the lead performs all Studio writes through one serialized mutation lane;
- the UI shows compact worker status and contributions under the relevant plan
  step, without exposing private reasoning or creating separate chats.

In this plan, **merge** means deterministic aggregation of typed worker results
and conflict-checked change proposals. It does not mean that workers directly
merge concurrent edits into the live Roblox hierarchy.

## Shared foundation: scoped change sets

Both features should use one versioned `ChangeSet` contract. A template compiler
produces a trusted change set directly. Future write-capable workers may only
propose one; the coordinator decides whether it can be committed.

A change set should include:

- stable run, agent, plan, step, and operation IDs;
- its source, such as a template ID/version or worker ID;
- the Studio paths or resources it claims;
- the Studio revision and content hashes it was based on;
- bounded instance, property, and script operations;
- risk flags and the approval it requires;
- exact verification assertions for paths, classes, selected properties, and
  script hashes;
- generated ownership metadata and cleanup instructions;
- a deterministic preview summary.

The coordinator must reject duplicate ownership, overlapping claims, stale base
revisions, invalid paths, oversized changes, and unsupported operations before
anything reaches Studio.

## Runtime architecture

### Run and plan ownership

The current singleton agent state must become run-scoped state with an
append-only event history. Each plan step has one owner or one active lease.
Every plan update, tool event, question, mutation, and evidence record carries
its run and owner context.

Only the coordinator may:

- create or finish the root plan;
- assign, retry, dismiss, or merge worker results;
- ask the user a question;
- request mutation approval;
- enter the Studio mutation lane;
- claim the overall verification result.

Likely seams:

- refactor planning and Roblox tools into context-aware factories;
- pass a `RunContext` and injected toolset through both standard and ChatGPT
  subscription provider paths;
- add coordinator, worker executor, mutation arbiter, and question broker
  modules under `src/lib/agent/`;
- normalize `src/stores/agent.ts` around runs, workers, plans, steps,
  operations, evidence, and events;
- extend `PlanView` to render worker ownership and namespaced progress.

### Studio operation ownership and cancellation

Bridge requests currently identify only a path and body. They need client-known
operation IDs plus run, worker, step, capability, and target metadata. The bridge
should track explicit queued, leased, completed, failed, cancel-requested, and
cancelled states.

Cancellation semantics must be honest and testable:

- cancelling an unleased request removes it so Studio can never execute it;
- cancelling a leased request prevents later work, records that completion may
  still arrive, and triggers recovery/readback before the run can finish;
- active arbitrary Luau remains non-interruptible and is never used to install a
  starter game;
- parent cancellation propagates to every worker and blocks new worker starts,
  questions, approvals, and mutations.

The existing FIFO bridge and single polling Studio plugin already serialize
execution in practice. The coordinator should make that a product invariant by
allowing only one mutation lease at a time while still permitting bounded
parallel read-only work.

### Resource-aware evidence

A later readback should verify only the mutation targets or manifest assertions
it actually covers. Ordering alone is insufficient once several workers can
inspect unrelated resources.

Evidence should therefore record:

- operation and owner IDs;
- target paths or resource keys;
- base and resulting revisions or hashes;
- the assertions evaluated;
- pass, fail, or partial status;
- whether the evidence arrived after cancellation or a repair barrier.

The root plan cannot finish until every worker is terminal and each result is
merged, dismissed, or explicitly failed, and every committed change set has
complete resource-scoped verification.

## Starter-game architecture

Add an allowlisted, lazy-loaded game catalog patterned after the skill catalog.
The model and UI should call the same `GameBuilderService`; neither may send an
arbitrary privileged manifest to Studio.

Suggested areas:

```text
games/
  obby/
    manifest.ts
    scripts/
src/lib/games/
  catalog.ts
  schema.ts
  registry.ts
  compiler.ts
  service.ts
src/components/games/
  GameGallery.tsx
  GamePreviewDialog.tsx
  GameBuildProgress.tsx
```

Each template contains compact catalog metadata, a compatibility version,
validated parameters, required skills, trusted instance and script content,
verification assertions, and preview metadata. Full manifests and script source
remain lazy-loaded.

The Studio plugin needs a dedicated bounded install path rather than a large
`roblox_run_code` call. Installation should:

1. inspect edit/playtest state and the current Studio revision;
2. compile and validate the trusted template locally;
3. preflight every path, name, class, property, script, and size limit;
4. show the exact additions and conflicts in Change Preview;
5. acquire one approval and one mutation lease;
6. stage and apply the manifest as one logical installation;
7. remove staged work on failure and surface any cleanup failure;
8. record generated ownership metadata;
9. verify the complete manifest through structured readbacks;
10. expose Resume and Remove Generated Game recovery actions;
11. hand off to the existing Playtest & Fix workflow.

One logical Studio undo is a release target and must be proven in a live Studio
test. Manifest-based removal remains necessary for recovery and for projects
that have changed since generation.

## One-Click Obby MVP

The first starter should be **Obby Starter v1**.

Recommended options:

- stages: 5, 10, or 15;
- difficulty: easy, standard, or challenging;
- visual style: bright, neon, or nature.

Included content:

- start spawn and clearly ordered stage geometry;
- checkpoints and respawn behavior;
- kill floor;
- finish trigger;
- small progress UI;
- primitive Roblox parts and bundled reviewed scripts only.

Explicitly excluded:

- publishing or creating a new place;
- DataStore persistence, purchases, or cloud credentials;
- imported Creator Store scripts;
- AI-generated privileged manifests;
- destructive resets of existing content.

### Acceptance criteria

- The same template version and options compile to the same bounded manifest.
- Blank-baseplate and non-empty-place fixtures both pass without modifying
  unrelated content.
- Name or ownership conflicts fail before mutation and appear in preview.
- A retry cannot duplicate an existing generation.
- An injected mid-install failure cannot be reported as success and leaves no
  silent partial game.
- Verification checks every critical expected path, class, selected property,
  and script hash; one generic readback is not sufficient.
- Stop prevents unleased work from starting and clearly labels any leased work
  that completed after cancellation.
- Resume and Remove Generated Game touch only instances owned by the recorded
  generation manifest.
- A live Studio test proves the intended undo and recovery behavior.
- The final state is labeled ready to playtest and links directly to the
  Playtest & Fix instructions.
- Existing frontend, Rust, skill, plugin-integrity, and live bridge gates pass.

## Read-only sub-agent MVP

Initial worker roles:

- **Studio Explorer** — structured reads of the game tree, scripts, properties,
  selection, and playtest evidence;
- **Roblox Researcher** — allowlisted skill search/loading and bounded web
  research when required;
- **Plan Reviewer** — checks a proposed plan or change set for missing risks,
  verification assertions, and conflicting ownership.

The coordinator chooses no more than two roles for a run. Workers return a typed
result containing status, summary, scoped findings, evidence references, risks,
unresolved questions, and optional change proposals. Results are merged in a
stable order independent of completion timing.

### Acceptance criteria

- Cross-run and cross-worker plan updates are rejected.
- Worker count, depth, steps, time, and provider usage are bounded.
- Mutation tools are absent from worker toolsets and rejected if requested.
- One worker's readback cannot verify another owner's unrelated mutation.
- Out-of-order worker completion produces the same merged result.
- A child failure can be retried, dismissed, or surfaced without losing the
  parent run.
- Stop reaches every worker and prevents new Studio mutations from starting.
- Only the coordinator can ask questions, request approval, mutate Studio, or
  finish the root plan.
- OpenAI, Anthropic, and ChatGPT subscription paths exercise the same ownership
  and cancellation contract.
- A live smoke test runs two read-only workers concurrently, performs one
  coordinator-owned serialized mutation, and records targeted verification.

## Later phases

### Tycoon Lite

Add only after the Obby installer, preview, verification, recovery, and upgrade
contracts are stable. Start with session-only currency and droppers. Persistence,
purchases, and publishing remain separate explicit additions.

### Worker-authored proposals

Workers may eventually prepare script patches or instance change sets against a
captured revision. They still do not write directly. The coordinator rejects
stale or overlapping proposals, re-inspects when needed, and commits accepted
changes serially.

### FPS starter

Add last, after server authority, remote validation, exploit resistance,
mobile/gamepad input, multiplayer playtests, and performance verification have
dedicated template assertions.

## First implementation slice

The first pull request should not mutate Studio. It should:

1. define the versioned game-template and change-set schemas;
2. add a lazy allowlisted game catalog containing Obby Starter v1 metadata;
3. compile the Obby options into a deterministic manifest;
4. validate bounds, paths, ownership markers, and script hashes;
5. snapshot-test stable compiler output and invalid/collision cases;
6. render the template picker and exact Change Preview behind a development
   flag;
7. document the operation IDs and cancellation states required by the later
   bridge install path.

In parallel, a test-only orchestration slice can introduce scoped run and worker
IDs plus ownership tests without exposing sub-agents in the product UI.

## Planning defaults to revisit

These decisions let implementation start without pretending they are permanent:

- generate into the currently open place;
- add safely under B9-owned roots and never wipe existing content;
- preview once, then one Generate click;
- maximum two read-only workers, with no nesting;
- same provider/model as the lead initially;
- Obby first, Tycoon Lite second, FPS last;
- coordinator-only Studio writes through v1.
