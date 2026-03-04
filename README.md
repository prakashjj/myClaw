# MyClaw — The Superior AI Agent Platform

> **Tiny core. Plugin architecture. Performance-first. Security-first.**
> Beats OpenClaw in modularity, PicoClaw in features, NanoClaw in flexibility, ZeroClaw in usability, MicroClaw in extensibility.

## Why MyClaw?

Every existing claw has critical flaws:

| Problem | OpenClaw | PicoClaw | NanoClaw | ZeroClaw | MicroClaw | **MyClaw** |
|---------|----------|----------|----------|----------|-----------|------------|
| Bloated codebase | 430K lines | — | — | — | — | **~2K lines core** |
| Security vulnerabilities | ClawHavoc attack, RCE | No sandbox | Container-dependent | — | — | **Process + Container sandbox** |
| Hard to set up | 45 min setup | — | Needs Docker | Needs Rust | Needs Rust | **60 seconds** |
| Sequential tool execution | Yes | Yes | Yes | Yes | — | **Parallel execution** |
| No response caching | — | — | — | — | — | **Semantic response cache** |
| No workflow automation | Basic cron | Heartbeat file | — | — | — | **Full pipeline workflows** |
| No smart routing | — | Roadmap | — | — | — | **Built-in cost optimization** |
| Limited code execution | Shell out | — | — | — | — | **Built-in VM sandbox** |
| No browser automation | Heavy deps | — | — | — | — | **Native CDP integration** |

## Features That Beat Every Competitor

### Performance
- **Parallel tool execution** — Run multiple tools simultaneously, not sequentially
- **Response caching with semantic matching** — Cache hits even for similar (not identical) queries
- **Request deduplication** — No wasted API calls on double-sends
- **Token budget optimization** — Intelligent context compression for long conversations
- **Smart routing** — Simple questions go to cheap models, complex ones to powerful models

### Unique Capabilities
- **Workflow engine** — Create multi-step automation pipelines (like Zapier, but AI-controlled)
  - Conditional branching, parallel steps, retry/fallback
  - Template variables between steps (`{{step1.output}}`)
  - Cron, message, and webhook triggers
- **Browser automation** — Direct Chrome DevTools Protocol integration, zero dependencies
- **Code interpreter** — Execute JavaScript in a secure VM sandbox (no shelling out)
- **Agent swarms** — Supervisor pattern with fan-out/fan-in, cost tracking, failure policies

### Security (Lessons from ClawHavoc)
- **Process-level sandboxing** — No Docker/container runtime required
- **Container isolation** — Optional Docker/Apple Container support for maximum isolation
- **Path-restricted filesystem** — Agents can only access explicitly allowed directories
- **Memory validation** — Size limits prevent prompt injection via memory pollution
- **No ambient system access** — Everything is opt-in

### Architecture
- **Plugin-based** — Core engine is ~200 lines. Everything else is a plugin.
- **Three plugin types:** Channels (messaging), Tools (capabilities), Models (AI providers)
- **Hot-pluggable** — Add/remove capabilities without restarting
- **TypeScript** — Full type safety, largest developer ecosystem
- **Zero required dependencies** — Uses Node.js built-ins (fetch, WebSocket, vm, child_process)

## Quick Start

```bash
# Install
npm install -g myclaw

# Initialize config
myclaw init

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start chatting
myclaw chat
```

**Setup time: ~60 seconds** (vs OpenClaw's 45 minutes)

## Commands

```bash
myclaw init              # Generate config file
myclaw chat              # Interactive terminal chat
myclaw run "do X"        # One-shot task execution
myclaw start             # Daemon mode (listen on channels)
myclaw status            # Show loaded plugins/agents
```

## Configuration

MyClaw uses a single JSON config file (`myclaw.json`):

```json
{
  "agents": [{
    "id": "assistant",
    "name": "My Assistant",
    "model": "anthropic/claude-sonnet-4-20250514",
    "systemPrompt": "You are a helpful assistant.",
    "channels": ["telegram", "discord"],
    "smartRouting": {
      "enabled": true,
      "cheapModel": "anthropic/claude-haiku-4-5-20251001",
      "complexityThreshold": 0.5
    },
    "memory": {
      "enabled": true,
      "shortTermLimit": 50,
      "longTerm": true
    }
  }],
  "security": {
    "sandbox": "process",
    "networkAccess": true,
    "maxExecutionTime": 30000,
    "allowedPaths": ["./"]
  }
}
```

### Model Configuration

Like PicoClaw's model-centric config, just specify `vendor/model`:

```json
"model": "anthropic/claude-sonnet-4-20250514"
"model": "openai/gpt-4o"
"model": "openai/o3-mini"
```

Any OpenAI-compatible API works by setting `OPENAI_BASE_URL`:
```bash
# Use Ollama
export OPENAI_BASE_URL=http://localhost:11434/v1
# Use Together.ai
export OPENAI_BASE_URL=https://api.together.xyz/v1
```

## Programmatic Usage

```typescript
import { MyClawEngine, AnthropicPlugin, ShellToolPlugin } from "myclaw";

const engine = new MyClawEngine({
  agents: [{
    id: "worker",
    name: "Worker",
    model: "anthropic/claude-sonnet-4-20250514",
    systemPrompt: "You are a coding assistant.",
    maxTurns: 5,
  }],
  security: {
    sandbox: "process",
    networkAccess: true,
    maxExecutionTime: 30000,
    maxMemoryMB: 256,
  },
});

await engine.registerPlugin(new AnthropicPlugin());
await engine.registerPlugin(new ShellToolPlugin());

// Listen for events
engine.on((event) => {
  if (event.type === "agent.response") {
    console.log("Agent:", event.data);
  }
});
```

## Supported Channels

| Channel | Status | Token Env Var |
|---------|--------|---------------|
| Telegram | Built-in | `TELEGRAM_BOT_TOKEN` |
| Discord | Built-in | `DISCORD_BOT_TOKEN` |
| Slack | Built-in | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` |
| WhatsApp | Plugin | Community plugin |
| Signal | Plugin | Community plugin |
| iMessage | Plugin | macOS only |
| Matrix | Plugin | Community plugin |
| IRC | Plugin | Community plugin |

## Built-in Tools

| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands (sandboxed) |
| `fetch_url` | Fetch web page content |
| `web_search` | Search the web (DuckDuckGo, no API key needed) |
| `read_file` | Read files (path-restricted) |
| `write_file` | Write files (path-restricted) |
| `list_dir` | List directory contents |
| `remember` | Store persistent memories |
| `recall` | Search memories |
| `execute_code` | Run JavaScript in VM sandbox |
| `browser_navigate` | Browser automation via CDP |
| `browser_click` | Click elements |
| `browser_type` | Type into inputs |
| `browser_screenshot` | Capture screenshots |
| `create_workflow` | Build automation pipelines |
| `run_workflow` | Execute pipelines |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    MyClaw CLI                        │
├─────────────────────────────────────────────────────┤
│              MyClaw Engine (~200 LOC)                │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │
│  │ Plugin   │ │ Message  │ │  Agentic Loop     │   │
│  │ Registry │ │ Router   │ │  + Smart Routing  │   │
│  └──────────┘ └──────────┘ └───────────────────┘   │
├─────────────────────────────────────────────────────┤
│  Performance Layer                                   │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Cache  │ │ Parallel │ │ Token    │ │ Dedup   │ │
│  │        │ │ Executor │ │ Optimizer│ │         │ │
│  └────────┘ └──────────┘ └──────────┘ └─────────┘ │
├───────────┬───────────┬─────────────────────────────┤
│ Channels  │  Tools    │  Models                     │
│ ┌───────┐ │ ┌───────┐ │ ┌──────────┐              │
│ │Telegr.│ │ │Shell  │ │ │Anthropic │              │
│ │Discord│ │ │Web    │ │ │OpenAI    │              │
│ │Slack  │ │ │Files  │ │ │(any OAAI │              │
│ │(more) │ │ │Memory │ │ │ compat)  │              │
│ └───────┘ │ │Browser│ │ └──────────┘              │
│           │ │Code   │ │                             │
│           │ │Workflw│ │                             │
│           │ └───────┘ │                             │
├───────────┴───────────┴─────────────────────────────┤
│  Security: Process Sandbox │ Container │ Path Guard  │
└─────────────────────────────────────────────────────┘
```

## Competitive Comparison

| Feature | OpenClaw | PicoClaw | NanoClaw | ZeroClaw | MicroClaw | **MyClaw** |
|---------|----------|----------|----------|----------|-----------|------------|
| **Language** | TypeScript | Go | TypeScript | Rust | Rust | **TypeScript** |
| **Core size** | ~430K LOC | Small | ~3.9K LOC | ~3.4MB bin | Medium | **~2K LOC** |
| **Setup time** | ~45 min | ~5 min | ~10 min | ~10 min | ~15 min | **~1 min** |
| **Parallel tools** | No | No | No | No | No | **Yes** |
| **Response cache** | No | No | No | No | No | **Yes (semantic)** |
| **Smart routing** | No | Planned | No | No | No | **Yes** |
| **Workflows** | Cron only | Heartbeat | No | No | No | **Full pipelines** |
| **Browser** | Playwright | No | No | No | No | **Native CDP** |
| **Code sandbox** | No | No | No | No | No | **VM sandbox** |
| **Agent swarms** | No | No | Yes | No | No | **Yes (supervised)** |
| **Sandbox** | App-level | None | Container | Workspace | None | **Process+Container** |
| **Channels** | 50+ | ~4 | ~6 | 22+ | 14+ | **3 built-in + plugins** |
| **Plugin system** | ClawHub | No | Skills | Traits | Adapters | **Full plugin API** |
| **Min Node** | 22 | N/A | 20 | N/A | N/A | **20** |

## License

MIT
