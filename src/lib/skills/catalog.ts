export const SKILL_CATALOG = [
  {
    name: "roblox-luau-core",
    category: "Core language and architecture",
    description:
      "Use for Luau syntax, tables, control flow, string patterns, math, scope, closures, idioms, or porting code from JavaScript or Python.",
    keywords: ["lua", "syntax", "tables", "strings"],
  },
  {
    name: "roblox-luau-types",
    category: "Core language and architecture",
    description:
      "Use for Luau annotations, generics, unions, narrowing, strictness, sealed tables, module type exports, or typed metatables.",
    keywords: ["typing", "typechecking", "strict", "generics"],
  },
  {
    name: "roblox-luau-patterns",
    category: "Core language and architecture",
    description:
      "Use for Luau metatable classes, inheritance, Promises, coroutines, pcall, module structure, services, and Roblox coding patterns.",
    keywords: ["async", "modules", "classes", "errors"],
  },
  {
    name: "roblox-architecture",
    category: "Core language and architecture",
    description:
      "Use when starting or refactoring a Roblox project, choosing service or module structure, or making client-server architecture decisions.",
    keywords: ["design", "refactor", "structure", "boundaries"],
  },
  {
    name: "roblox-sharp-edges",
    category: "Core language and architecture",
    description:
      "Use before shipping or reviewing Roblox code involving player data, remotes, monetization, or memory to catch high-impact production footguns.",
    keywords: ["gotchas", "pitfalls", "production", "bugs"],
  },
  {
    name: "roblox-game-design",
    category: "Core language and architecture",
    description:
      "Use before building a new Roblox game, game mode, or materially ambiguous gameplay feature.",
    keywords: [
      "brainstorm",
      "design",
      "requirements",
      "game-mode",
      "vertical-slice",
    ],
  },
  {
    name: "roblox-monetization",
    category: "Monetization",
    description:
      "Use when implementing Roblox GamePasses, Developer Products, subscriptions, private servers, Creator Rewards, or purchase policy checks.",
    keywords: ["receipts", "purchases", "robux", "gamepass"],
  },
  {
    name: "roblox-networking",
    category: "Systems and networking",
    description:
      "Use when validating RemoteEvent or RemoteFunction arguments, adding rate limits, designing server-authoritative systems, or preventing exploits.",
    keywords: ["remote", "client-server", "validation", "rate-limit"],
  },
  {
    name: "roblox-security",
    category: "Systems and networking",
    description:
      "Use when auditing Roblox code for exploit vectors, authority models, remotes, economy, and DataStore flows.",
    keywords: ["anti-cheat", "harden", "trust", "validation"],
  },
  {
    name: "roblox-data",
    category: "Systems and networking",
    description:
      "Use when implementing player data persistence with DataStore, session ownership, schemas, migrations, or save and load flows.",
    keywords: ["persistence", "save", "profile", "migration"],
  },
  {
    name: "roblox-server-data",
    category: "Systems and networking",
    description:
      "Use for Roblox server or cross-server data: OrderedDataStore leaderboards, MessagingService, world state, seasons, or guilds.",
    keywords: ["leaderboard", "messaging", "cross-server", "global"],
  },
  {
    name: "roblox-analytics",
    category: "Systems and networking",
    description:
      "Use when tracking player behavior, economy events, or funnels with AnalyticsService, including event taxonomy, rate limits, and batching.",
    keywords: ["telemetry", "events", "metrics", "funnel"],
  },
  {
    name: "roblox-npc-ai",
    category: "Systems and networking",
    description:
      "Use when creating Roblox NPCs or enemies with pathfinding, state machines, line-of-sight or FOV detection, spawns, or AI update loops.",
    keywords: ["enemy", "pathfinding", "fsm", "behavior"],
  },
  {
    name: "roblox-performance",
    category: "Performance and runtime",
    description:
      "Use when profiling Roblox performance or diagnosing FPS, memory, network, mobile, or hot-path problems, including MicroProfiler and optimization.",
    keywords: ["lag", "fps", "profiling", "memory"],
  },
  {
    name: "roblox-building",
    category: "Building and UI",
    description:
      "Use when building Roblox geometry, maps, props, or generated assets with MCP or standalone Luau.",
    keywords: ["world", "map", "parts", "assets"],
  },
  {
    name: "roblox-physics",
    category: "Building and UI",
    description:
      "Use when building Roblox vehicles, ragdolls, projectiles, elevators, constraints, forces, or other physics-driven gameplay.",
    keywords: ["constraints", "forces", "vehicle", "projectile"],
  },
  {
    name: "roblox-gui",
    category: "Building and UI",
    description:
      "Use when building Roblox menus, HUDs, shops, notifications, dialogs, or responsive cross-platform UI.",
    keywords: ["interface", "screen", "hud", "menu"],
  },
  {
    name: "roblox-ui-design",
    category: "Building and UI",
    description:
      "Roblox UI design with simulator default and existing-style inheritance. Use with roblox-gui.",
    keywords: ["visual", "layout", "responsive", "style"],
  },
  {
    name: "roblox-animation-vfx",
    category: "Building and UI",
    description:
      "Use when implementing Roblox character animations, particles, beams, trails, tweens, camera shake, or other visual effects.",
    keywords: ["effects", "particles", "tween", "animation"],
  },
  {
    name: "roblox-lighting",
    category: "Building and UI",
    description:
      "Use for Roblox lighting, atmosphere, day/night, or post-processing effects.",
    keywords: ["atmosphere", "post-processing", "environment", "sky"],
  },
  {
    name: "roblox-audio",
    category: "Building and UI",
    description:
      "Use when implementing Roblox audio playback, spatial sound, music, sound effects, SoundGroups, or dynamic audio effects.",
    keywords: ["sound", "music", "sfx", "spatial"],
  },
  {
    name: "roblox-input",
    category: "Building and UI",
    description:
      "Use when handling Roblox keyboard, mouse, gamepad, touch, motion input, or cross-platform action binding.",
    keywords: ["controls", "mobile", "gamepad", "touch"],
  },
  {
    name: "roblox-camera",
    category: "Building and UI",
    description:
      "Use when scripting Roblox camera behavior, CFrame placement, screen raycasts, first or third-person views, or cutscenes.",
    keywords: ["cframe", "cutscene", "viewport", "raycast"],
  },
  {
    name: "roblox-studio-mcp",
    category: "MCP and cloud",
    description:
      "Use when working with Roblox Studio through built-in MCP for scripts, scenes, generated assets, input, or playtesting.",
    keywords: ["studio", "tools", "automation", "playtest"],
  },
  {
    name: "roblox-cloud",
    category: "MCP and cloud",
    description:
      "Use when working with Roblox Open Cloud REST APIs, API keys, webhooks, or HttpService calls to cloud endpoints.",
    keywords: ["rest", "webhook", "http", "api"],
  },
  {
    name: "roblox-oauth",
    category: "MCP and cloud",
    description:
      "Use when implementing Roblox OAuth 2.0 for Open Cloud, including app registration, PKCE, token exchange, refresh, revocation, or scopes.",
    keywords: ["authentication", "tokens", "pkce", "authorization"],
  },
  {
    name: "roblox-debug",
    category: "Workflow",
    description:
      "Use when diagnosing Roblox or Luau errors, crashes, or unexpected behavior with an iterative reproduce, inspect, fix, and verify loop.",
    keywords: ["fix", "error", "crash", "troubleshoot"],
  },
  {
    name: "roblox-code-review",
    category: "Workflow",
    description:
      "Use when reviewing Roblox or Luau code for security, performance, monetization, data persistence, or architecture risks.",
    keywords: ["audit", "quality", "bugs", "review"],
  },
  {
    name: "roblox-test-driven-development",
    category: "Workflow",
    description:
      "Use when implementing testable Roblox behavior or fixing a Luau bug before writing production code.",
    keywords: [
      "tdd",
      "test",
      "tests",
      "testing",
      "test-first",
      "write",
      "luau",
      "implementation",
      "behavior",
      "regression",
      "datastore",
      "persistence",
      "skip-tests",
    ],
  },
  {
    name: "roblox-plan-execution",
    category: "Workflow",
    description:
      "Use when turning approved Roblox requirements into a multi-step Studio plan or reviewing a plan before mutation.",
    keywords: ["plan", "execute", "requirements", "success-criteria", "readback"],
  },
  {
    name: "roblox-verification",
    category: "Workflow",
    description:
      "Use before claiming a Roblox Studio change is complete, fixed, working, safe, or ready to publish.",
    keywords: [
      "verify",
      "prove",
      "evidence",
      "studio",
      "changes",
      "are",
      "complete",
      "done",
      "playtest",
      "readback",
    ],
  },
  {
    name: "roblox-publish-checklist",
    category: "Workflow",
    description:
      "Use before publishing or updating a Roblox game to check data, security, performance, monetization, mobile, metadata, social, and analytics.",
    keywords: ["release", "ship", "launch", "checklist"],
  },
  {
    name: "roblox-tooling",
    category: "Workflow",
    description:
      "Use when configuring Roblox tooling such as Rojo, Wally, Selene, StyLua, Lune, Aftman, luau-lsp, or CI/CD.",
    keywords: ["rojo", "wally", "lint", "format"],
  },
  {
    name: "roblox-localization",
    category: "Localization",
    description:
      "Use when implementing Roblox multi-language support, translation tables, auto-translation, locale-specific content, or region detection.",
    keywords: ["i18n", "translation", "locale", "language"],
  },
] as const

export type SkillCatalogEntry = (typeof SKILL_CATALOG)[number]
export type SkillName = SkillCatalogEntry["name"]

export const SKILL_NAMES = SKILL_CATALOG.map((skill) => skill.name) as [
  SkillName,
  ...SkillName[],
]

export function getSkillCatalogSummary() {
  return SKILL_CATALOG.map(
    (skill) => `- ${skill.name}: ${skill.description}`,
  ).join("\n")
}
