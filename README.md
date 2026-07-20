# bubbertron9001

**The skills-powered AI agent for Roblox Studio.** bubbertron9001—**B9** for
short—plans the work, researches current answers, changes the game, verifies
the result, and corrects errors.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Made with Tauri](https://img.shields.io/badge/Made%20with-Tauri-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)

bubbertron9001 connects OpenAI, Anthropic, and ChatGPT subscription models
directly to Roblox Studio. It can manipulate instances, scripts, and properties
through natural language while grounding Roblox decisions in a bundled skill
library.

## Why bubbertron9001?

Most AI coding tools are built for text files. Roblox Studio is a live hierarchy
of instances, properties, assets, and Luau scripts. B9 bridges that gap with a
desktop agent and Studio plugin.

**Before B9**: Copy code from chat → Paste into Studio → Debug → Repeat

**With B9**: “Create a car that players can drive” → plan → build → inspect →
verify → repair if needed

## Features

- **Direct Studio Control** - AI creates, modifies, and deletes instances in real-time
- **Script Editing** - Read, write, and make exact verified Luau replacements
- **30 Roblox Skills** - Lazy quick/full guidance from
  [`roblox-brain`](https://github.com/jakesixtyoneeighty/roblox-brain)
- **Automatic Planning** - Complex changes begin with a visible, tracked plan
- **Web Search** - Current Roblox documentation and uncertain facts can be researched
- **Proof-Backed Verification** - A mutation must be followed by a successful Studio read-back before a plan can finish
- **Playtest & Fix** - Reads bounded Studio playtest state, warnings, and errors, then traces runtime problems back to their source
- **Guided Mac Setup** - Four clickable first-run steps install the paired plugin, open sign-in, launch Studio, and verify the connection without Terminal
- **Broad Toolset** - Studio, bulk, toolbox, skill, research, and workflow tools
- **Multi-Provider** - OpenAI API, Anthropic API, or ChatGPT Plus/Pro (no API key needed!)
- **Safe Creator Store** - Free models are revalidated and imported scripts are quarantined for review
- **Hardened Local Bridge** - Paired Studio plugin, one active session, bounded requests, and authenticated local routes
- **Native Secret Storage** - Packaged builds use the operating system credential store
- **Live Feedback** - See exactly what the AI is doing in your game
- **Undo Support** - Every AI change creates an undo waypoint
- **Modern UI** - Built with React 19 and [prompt-kit](https://prompt-kit.com)

## Demo

> *"Set up a basic obby with 5 platforms that get progressively harder"*

The AI will:
1. Inspect the current game and create a short plan
2. Load the relevant building, physics, and review skills
3. Create the obby structure and five increasingly difficult platforms
4. Add spawn, finish, and respawn behavior
5. Read the result back, verify it, and correct any failed check

The plan and tool progress stay visible while B9 works.

## How It Works

```
┌─────────────┐     HTTP      ┌─────────────┐     Polling     ┌─────────────┐
│    B9 UI    │◄────────────►│   Bridge    │◄───────────────►│   Studio    │
│   (React)   │   :3001      │   (Rust)    │   100ms         │  (Plugin)   │
└─────────────┘              └─────────────┘                 └─────────────┘
      │
      │ Vercel AI SDK
      ▼
┌─────────────┐
│  AI Models  │
│ GPT/Claude  │
└─────────────┘
```

1. You describe a goal in bubbertron9001
2. B9 searches or loads only the skills it needs
3. Complex work gets a structured plan
4. The Rust bridge queues requests for the Studio plugin
5. Studio executes the operations and returns evidence
6. B9 verifies the outcome and repairs failures before summarizing

*The polling pattern is necessary because Roblox Studio can only make outgoing HTTP requests.*

## Installation

### On a Mac — no Terminal required

1. Open the bubbertron9001 `.dmg` installer.
2. Drag **bubbertron9001** onto the **Applications** folder.
3. Open bubbertron9001 from Applications.
4. Follow the four big setup steps in the app. B9 can open the Roblox Studio
   download, install its securely paired Studio plugin, open ChatGPT sign-in,
   launch Studio, and confirm the connection for you.

Roblox Studio still requires one visible safety choice inside each experience:
open **File → Experience Settings → Security** and turn on **Allow HTTP
Requests**. The B9 setup guide shows this at the right time.

See [Mac install guide](docs/MAC_INSTALL.md) for the complete parent/child
handoff, including the current macOS signing note.

### Build the Mac installer

Node.js and Rust are needed only on the Mac that builds B9—not on the Mac that
installs the finished app.

```bash
npm install
npm run package:mac
```

The drag-to-Applications installer is written to
`src-tauri/target/release/bundle/dmg/`.

### Install the Studio Plugin

The first-run setup guide installs the plugin automatically. If a manual
fallback is ever needed, choose **Download Paired Plugin** on the connection
screen, move it into Roblox Studio’s Plugins folder, and restart Studio.

The checked-in file at
`studio-plugin/bubbertron9001-bridge.server.lua` is an intentionally unpaired
source template. Do not install or redistribute that raw file: only the desktop
app can render a copy whose pairing secret matches its local bridge.

## Configuration

### AI Providers

| Provider | Setup | Best For |
|----------|-------|----------|
| **ChatGPT Plus/Pro** | Click "Sign in with ChatGPT" | Free with subscription, no API costs |
| **OpenAI API** | Add API key in Settings | Pay-per-use, full control |
| **Anthropic API** | Add API key in Settings | Claude models |

**Recommended**: If you have ChatGPT Plus/Pro, use the OAuth sign-in. B9
defaults to the balanced GPT-5.6 Terra model and shows the current Sol, Terra,
and Luna choices available to the account. Direct API users can choose current
OpenAI or Anthropic models.

### Credential storage

Packaged desktop builds keep API keys and ChatGPT access/refresh tokens in the
operating system credential store (macOS Keychain, Windows Credential Manager,
or Linux Secret Service). Existing plaintext credentials are migrated and
removed from the app's local preferences on first launch.

The browser-only development preview has no native credential store, so it uses
a localStorage fallback. Do not enter production credentials into a shared
browser profile.

## AI Tools

### Instance Manipulation
| Tool | What it does |
|------|-------------|
| `roblox_create` | Create new instances (Parts, Models, Scripts, etc.) |
| `roblox_delete` | Remove instances from the game |
| `roblox_clone` | Duplicate instances |
| `roblox_move` | Reparent instances to new locations |
| `roblox_set_property` | Change any property (Position, Color, Name, etc.) |
| `roblox_get_properties` | Read all properties of an instance |
| `roblox_get_children` | List children (with recursive option) |
| `roblox_search` | Find instances by name or class |
| `roblox_get_selection` | Get what you have selected in Studio |

### Script Editing
| Tool | What it does |
|------|-------------|
| `roblox_get_script` | Read script source code |
| `roblox_set_script` | Replace entire script content |
| `roblox_edit_script` | Find/replace within scripts |
| `roblox_run_code` | Execute bounded Luau after a fresh per-call confirmation |

### Playtest Diagnostics

| Tool | What it does |
|------|-------------|
| `roblox_get_playtest_state` | Read whether Studio is editing, running, or paused |
| `roblox_get_recent_logs` | Read a bounded, redacted set of recent Studio Output messages |

### Bulk Operations
| Tool | What it does |
|------|-------------|
| `roblox_bulk_create` | Create many instances at once |
| `roblox_bulk_delete` | Delete multiple instances |
| `roblox_bulk_set_property` | Update properties across many instances |

### Skills, Research, and Workflow

| Tool | What it does |
|------|-------------|
| `skill_search` | Search the compact allowlisted Roblox skill catalog |
| `skill_load` | Lazily load quick guidance or full references |
| `web_search` | Research current web or official Roblox documentation |
| `agent_create_plan` | Create a concrete plan before complex changes |
| `agent_update_plan` | Track progress and failures during execution |
| `agent_finish_plan` | Verify the result or enter the repair loop |

## Safety boundaries

- B9 asks before the first normal Studio mutation in a run. Arbitrary Luau
  always receives its own confirmation.
- Creator Store IDs are checked as free, purchasable Models immediately before
  insertion. Imported `Script` and `LocalScript` instances are disabled before
  the asset is parented into the game, and all script containers are returned
  for review.
- The desktop, Studio plugin, and OAuth polling routes share a per-install
  pairing secret. Only one Studio session can own the bridge at a time.
- **Stop** prevents later tool calls and cancels waiting frontend requests. It
  cannot forcibly terminate Luau that has already begun inside Studio, so review
  every `roblox_run_code` confirmation carefully.

## Example Prompts

**Creating things:**
> "Create a red neon part at position 0, 10, 0 that slowly rotates"

**Editing scripts:**
> "Add a debounce to the touch handler in game.Workspace.Coin.Script"

**Bulk operations:**
> "Find all parts named 'Coin' and make them spin using TweenService"

**Game systems:**
> "Set up a basic shop system with a GUI and DataStore for saving purchases"

**Debugging:**
> "Why isn't my script in ServerScriptService working? Read it and help me fix it"

## Development

```bash
# Install local development prerequisites first: Node.js 20.19+ or 22.12+,
# Rust, and Roblox Studio.
npm install

# Full app with hot reload
npm run tauri dev

# Frontend only (faster iteration)
npm run dev

# Type checking and frontend tests
npm run typecheck
npm run test:run

# Validate vendored skills and the two plugin copies
npm run validate:skills
npm run check:studio-plugin

# Production build
npm run tauri build
```

### Project Structure

```
bubbertron9001/
├── src/                      # React frontend
│   ├── components/           # UI components (shadcn/ui + prompt-kit)
│   ├── lib/
│   │   ├── agent/           # Planning, verification, and repair
│   │   ├── ai/              # Providers, prompts, and chat runtime
│   │   ├── roblox/          # Roblox tools (Zod schemas)
│   │   └── skills/          # Lazy skill catalog and loading tools
│   └── stores/              # Zustand state management
├── skills/                   # 30 vendored Roblox Brain skills
├── src-tauri/               # Rust backend
│   └── src/
│       ├── bridge.rs        # HTTP bridge server (Warp)
│       └── lib.rs           # Tauri app setup
└── studio-plugin/           # Roblox Studio plugin
    └── bubbertron9001-bridge.server.lua # Unpaired source template
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, Vite 7, Tailwind CSS 4, shadcn/ui |
| **UI Components** | [prompt-kit](https://prompt-kit.com) |
| **AI** | Vercel AI SDK v6, OpenAI, Anthropic |
| **Desktop** | Tauri 2 (Rust) |
| **HTTP Server** | Warp |
| **State** | Zustand |
| **Validation** | Zod |

## Roadmap

- [x] **Toolbox Search** - Search and insert Creator Store assets
- [x] **Auto-Planning** - Plan and track complex tasks before execution
- [x] **Roblox Skills** - Progressive-disclosure guidance across 30 domains
- [x] **Web Search** - Provider-native current-information research
- [x] **Error Repair** - Bounded verification and correction workflow
- [x] **Secure Persistence** - Native credential storage with plaintext migration
- [x] **Local Release Gates** - Frontend, Rust, skills, and plugin-integrity checks
- [x] **@ Mentions** - Reference instances with `@game.Workspace.Part`
- [x] **Playtest & Fix** - Inspect runtime state and bounded Studio Output diagnostics
- [x] **Guided Mac Setup** - Install and connect through clickable first-run steps
- [ ] **Change Preview** - Review scripts, instances, conflicts, and risk before applying a change set
- [ ] **One-Click Starter Games** - Curated, versioned Obby/Tycoon/FPS starters with preview, verified installation, and recovery
- [ ] **Sub-Agents** - Bounded parallel research and inspection workers with coordinator-owned Studio writes
- [ ] **Cloud Operations** - Authenticated DataStore and publishing workflows
- [ ] **Signed Releases & Updates** - Notarized universal Mac builds with automatic updates

Planning for One-Click Starter Games and Sub-Agents is detailed in
[`docs/SUBAGENTS_AND_ONE_CLICK_GAMES.md`](docs/SUBAGENTS_AND_ONE_CLICK_GAMES.md).

## Contributing

Contributions are welcome!

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

See [AGENTS.md](./AGENTS.md) for code style guidelines and architecture details.

## Community

- Report bugs via [GitHub Issues](https://github.com/jakesixtyoneeighty/bubbertron9001/issues)
- Feature requests welcome!
- Star the repo if you find it useful

## License

GNU AGPL-3.0 with the additional notice terms in [LICENSE](./LICENSE).

---

**Made for Roblox developers who want to build faster.**

*Not affiliated with Roblox Corporation.*
