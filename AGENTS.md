# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bubbertron9001** (short name **B9**) is a skills-powered AI agent for Roblox Studio. It connects OpenAI, Anthropic, and ChatGPT subscription models to Studio through an HTTP bridge, then plans, researches, edits, verifies, and repairs work through natural language.

### Architecture

```
┌─────────────┐     HTTP      ┌─────────────┐     Polling     ┌─────────────┐
│    B9 UI    │◄────────────►│   Bridge    │◄───────────────►│   Studio    │
│   (React)   │   :3001      │   (Rust)    │                 │  (Plugin)   │
└─────────────┘              └─────────────┘                 └─────────────┘
      │
      │ Vercel AI SDK
      ▼
┌─────────────┐
│  OpenAI /   │
│  Anthropic  │
└─────────────┘
```

- **React Frontend** (`src/`): Chat UI with shadcn/ui components, Zustand state management
- **Rust Bridge** (`src-tauri/src/bridge.rs`): HTTP server on port 3001 that queues requests; uses oneshot channels for async request/response matching
- **Studio Plugin** (`studio-plugin/bubbertron9001-bridge.server.lua`): Luau plugin polls the bridge, executes commands, and creates undo waypoints
- **Agent Runtime** (`src/lib/agent/`): planning, progress, verification, and repair tools
- **Skill Runtime** (`src/lib/skills/` and `skills/`): compact catalog with lazy quick/full loading for 34 Roblox skills

The polling pattern is necessary because Roblox Studio can only make HTTP requests, not receive them.

## Build Commands

```bash
npm run tauri dev      # Full desktop app with hot reload (frontend on port 1430)
npm run tauri build    # Production build for distribution
npm run dev            # Frontend dev server only (no Tauri)
npx tsc --noEmit       # Type checking
```

## Key Files

| Path | Purpose |
|------|---------|
| `src/lib/ai/providers.ts` | Provider runtime, planning policy, web search, streaming, and tool calling |
| `src/lib/ai/system-prompt.ts` | B9 operating rules shared across providers |
| `src/lib/agent/planning.ts` | Plan creation, progress updates, verification, and repair tools |
| `src/lib/skills/` | Lazy allowlisted skill search and loading runtime |
| `skills/` | 30 vendored Roblox Brain skills plus 4 adapted workflow skills and deeper references |
| `src/lib/roblox/tools.ts` | Studio, bulk, toolbox, and question tools |
| `src/lib/roblox/client.ts` | HTTP client for bridge server communication |
| `src-tauri/src/bridge.rs` | Bridge endpoints under `/bubbertron9001/*`; legacy `/stud/*` aliases remain for compatibility |
| `studio-plugin/bubbertron9001-bridge.server.lua` | Luau plugin that handles Studio operations |
| `src/stores/` | Zustand state for chat, agent runs, settings, auth, Roblox, and plugin state |

## Roblox Tools Available to AI

Studio tools: `roblox_get_script`, `roblox_set_script`, `roblox_edit_script`, `roblox_get_children`, `roblox_get_properties`, `roblox_set_property`, `roblox_create`, `roblox_delete`, `roblox_clone`, `roblox_move`, `roblox_search`, `roblox_get_selection`, `roblox_run_code`

Bulk operations: `roblox_bulk_create`, `roblox_bulk_delete`, `roblox_bulk_set_property`

Research and workflow: `skill_search`, `skill_load`, `web_search`, `agent_create_plan`, `agent_update_plan`, `agent_finish_plan`

## Project Context

This project is a React/Tauri desktop app paired with a Roblox Studio plugin.
Preserve the bounded bridge, allowlisted lazy-skill loader, visible planning
state, and read-back verification loop. Treat this repository as the source of
truth; do not depend on machine-specific forks or paths.

## Style Guide

- Prefer clear names, small focused functions, and early returns where they
  improve readability.
- Preserve strict validation at provider, bridge, and Studio boundaries.
- Avoid `any`; use explicit exported types and inferred local types.
- Every mutation path must surface partial failures and have a later read-back
  verification path.
- Keep startup lean: lazy-load large optional UI and skill content.
- Use parallel tool calls when applicable
- **Never co-author yourself in git commits** - no `Co-Authored-By: Claude` lines

## Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4, shadcn/ui (New York style), Zustand
- **AI**: Vercel AI SDK v6 (`ai` package), `@ai-sdk/openai`, `@ai-sdk/anthropic`
- **Desktop**: Tauri 2 (Rust), Warp HTTP server
- **Validation**: Zod for AI tool schemas

## Prompt-Kit Components

We use [prompt-kit](https://prompt-kit.com) for AI interface components. Install via:
```bash
npx shadcn@latest add "https://prompt-kit.com/c/[COMPONENT].json"
```

### Available Components (in `src/components/ui/`)

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| `PromptInput` | Chat input with auto-resize | `isLoading`, `value`, `onSubmit`, `maxHeight` |
| `ChatContainer` | Auto-scrolling chat wrapper | Uses `use-stick-to-bottom` |
| `Message` | Chat message with avatar | `MessageAvatar`, `MessageContent`, `MessageActions` |
| `ToolCall` | AI tool execution display | `toolPart` (pending/running/complete/error states) |
| `Loader` | 12 loading variants | `variant`, `size`, `text` |
| `Reasoning` | Collapsible AI thinking | `open`, `isStreaming`, `ReasoningContent` |
| `ResponseStream` | Streaming text animation | `textStream`, `mode` (typewriter/fade), `speed` |
| `Markdown` | GFM markdown renderer | `children`, `components`, `id` |
| `CodeBlock` | Syntax highlighting (Shiki) | `code`, `language`, `theme` |
| `PromptSuggestion` | Clickable prompt chips | `highlight`, `onClick`, `variant` |
| `ScrollButton` | Jump to bottom button | `scrollRef`, `threshold` |
| `FileUpload` | Drag-and-drop files | `onFilesAdded`, `multiple`, `accept` |
| `Source` | Website source display | `href`, `SourceTrigger`, `SourceContent` |

### Loader Variants
`circular`, `classic`, `pulse`, `pulse-dot`, `dots`, `typing`, `wave`, `bars`, `terminal`, `text-blink`, `text-shimmer`, `loading-dots`

### Adding New Components
```bash
# Example: Add file upload
npx shadcn@latest add "https://prompt-kit.com/c/file-upload.json"
```

### Primitives (Full Features)
- `chatbot`: Complete chat implementation
- `tool-calling`: Chatbot with tool execution

Docs: https://prompt-kit.com/docs
