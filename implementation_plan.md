# bubbertron9001 Agent Runtime — Implementation Status

## Objective

bubbertron9001 (B9) is a skills-powered Roblox Studio agent. The upgraded
runtime should turn a goal into a bounded workflow:

1. understand the request and inspect relevant Studio state;
2. search and load only the Roblox skills needed for the task;
3. research current or uncertain facts when necessary;
4. create a concrete plan before complex mutations;
5. execute through the Studio bridge;
6. verify the result with read-back evidence;
7. repair failures before reporting completion.

Repository: <https://github.com/jakesixtyoneeighty/bubbertron9001>

Skills source: <https://github.com/jakesixtyoneeighty/roblox-brain>

License: GNU AGPL-3.0 with the additional notice terms in `LICENSE`

## Current Architecture

```text
┌─────────────────┐       HTTP        ┌─────────────────┐      polling      ┌─────────────────┐
│ B9 React client │ ◄───────────────► │ Rust/Tauri      │ ◄──────────────► │ Roblox Studio   │
│ plan + evidence │   localhost:3001  │ bounded bridge  │                  │ B9 plugin       │
└────────┬────────┘                   └─────────────────┘                  └─────────────────┘
         │
         ├── provider-native web search
         ├── 30 lazy Roblox skills
         ├── planning and repair tools
         └── OpenAI / Anthropic / ChatGPT subscription models
```

The primary bridge namespace is `/bubbertron9001/*`. The former
`/bubberton9001/*` and older `/stud/*` namespaces remain compatibility aliases
during migration.

## Completed Upgrade

### Product identity and compatibility

- Product name, window metadata, plugin identity, UI copy, and package metadata
  use **bubbertron9001** or compact **B9**.
- Existing storage and bridge identifiers are migrated instead of silently
  discarding user settings or breaking older clients.
- The legacy Tauri bundle identifier is intentionally retained so an installed
  Stud app upgrades in place and can migrate its existing WebView storage.
- The Studio plugin and desktop app use the same bubbertron9001 naming.

### Progressive Roblox skills

- All 30 `roblox-brain` skills are vendored under `skills/`, including every
  `SKILL.md`, full reference, auxiliary reference, index, and license notice.
- A small static catalog provides names and descriptions without loading the
  documents.
- `skill_search` ranks relevant skills.
- `skill_load` accepts only exact allowlisted names and supports:
  - `quick`: load only `SKILL.md`;
  - `full`: load `SKILL.md` plus every reference.
- Vite lazy raw imports, safe lookup, and promise caching keep startup and
  context use bounded.

### Planning, verification, and repair

- `agent_create_plan` creates a bounded plan of up to eight steps before
  complex changes; the agent is prompted to use 2–8 meaningful steps.
- `agent_update_plan` records progress and evidence.
- Successful Studio mutations and read-backs receive monotonic evidence
  ordering. `agent_finish_plan` refuses to close work unless a successful
  inspection began after the latest successful mutation.
- Failed verification moves the run back into a bounded repair state.
- Planning state is visible in the chat UI.
- Automatic planning is enabled by default and can be changed in Settings.

### Runtime playtest diagnostics

- `roblox_get_playtest_state` reads Studio's current edit, running, or paused
  state without changing it.
- `roblox_get_recent_logs` reads a bounded diagnostic buffer seeded from Studio
  Output and updated live during playtests.
- Log messages are capped, redacted, filtered for bridge noise, treated as
  untrusted evidence, and never used as authoritative verification by themselves.
- The visible **Playtest & Fix** guide tells a young builder exactly when to
  press Play, try the game, and ask B9 to inspect the result.

### Guided Mac setup

- First launch uses four clickable steps for Studio, the securely paired plugin,
  ChatGPT sign-in, and the first live connection; no Terminal commands appear.
- B9 can open Roblox Studio, install or migrate the plugin, recheck each step,
  and restart itself when its local connector needs recovery.
- Settings can reopen the guide as a Setup Doctor after onboarding.
- The sign-in flow, wizard, and Studio plugin use the same Forest Glass colors.

### Current-information research

- OpenAI, Anthropic, and ChatGPT subscription paths expose web search.
- Explicit web-search requests are enforced by the runtime.
- Roblox documentation requests can be constrained to official Creator Hub
  sources.
- Search citations are surfaced in the response UI.

### Runtime reliability

- Bridge requests are authenticated, validated, bounded, leased once, and timed
  out cleanly. One paired Studio session owns the queue at a time.
- Provider errors are normalized into useful retry or setup guidance.
- Duplicate or malformed plugin requests are rejected.
- API keys and ChatGPT tokens use the operating system credential store in
  packaged builds, with one-time plaintext migration.
- Creator Store results use Roblox's Toolbox v2 contract; only explicitly free,
  purchasable assets of the requested type are accepted.
- Imported scripts are inventoried and BaseScripts are disabled before an asset
  enters the live game hierarchy.
- Retired model selections migrate to current GPT-5.6 and Claude replacements.
- Destructive workflows retain confirmation and Studio undo waypoints.
- Provider/tool execution, Markdown rendering, and syntax highlighting are
  loaded on demand; the initial application chunk is about 38% smaller than
  the pre-optimization build.
- Local release scripts run frontend, Rust, skill, and plugin-integrity gates;
  hosted release automation remains future work.
- The Mac package script temporarily disables Cargo release stripping to avoid
  [rust-lang/rust#157750](https://github.com/rust-lang/rust/issues/157750) on
  macOS 27; remove that workaround after the fixed Rust toolchain is adopted.

## Verification Gates

Every release should satisfy the following:

- `npm run test:run`
- `npm run typecheck`
- `npm run build`
- `npm run validate:skills`
- `npm run check:studio-plugin`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings`
- a live smoke test:
  1. launch the Tauri app;
  2. connect the bubbertron9001 Studio plugin;
  3. inspect the game tree;
  4. run one planned mutation;
  5. confirm read-back verification and an undo waypoint;
  6. run one current-information web search and inspect its citations.
  7. press Play in Studio and confirm B9 can read the playtest state and a
     bounded set of recent Output diagnostics.

## Remaining Product Priorities

1. Run and automate an end-to-end bridge and playtest test against the real
   Studio plugin.
2. Add live provider-contract canaries for OpenAI, Anthropic, and ChatGPT
   subscription tool loops without placing credentials in ordinary CI.
3. Add cancellable or isolated execution before treating active arbitrary Luau
   as interruptible; today cancellation stops future work, not Luau already
   running in Studio.
4. Add authenticated Roblox Open Cloud workflows only with explicit permission
   and confirmation boundaries.
5. Add parallel sub-agents only after plan ownership, cancellation, and merge
   behavior have deterministic tests.
6. Add Developer ID signing, Apple notarization, universal Mac artifacts, and
   automatic updates once the release credentials and stable release host exist.

## Definition of Done

A task is complete only when B9 can show what changed, which skill or source
guided the decision, what verification ran, and whether any risk remains.
Tool success alone is not sufficient evidence.
