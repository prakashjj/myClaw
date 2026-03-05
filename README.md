# MyClaw — The Superior AI Agent Platform

> **Tiny core. Plugin architecture. Performance-first. Security-first.**
> Beats OpenClaw in modularity, PicoClaw in features, NanoClaw in flexibility, ZeroClaw in usability, MicroClaw in extensibility.

## Why MyClaw?

Every existing claw has critical flaws:

| Problem | OpenClaw | PicoClaw | NanoClaw | ZeroClaw | MicroClaw | **MyClaw** |
|---------|----------|----------|----------|----------|-----------|------------|
| Bloated codebase | 430K lines | — | — | — | — | **~2K lines core** |
| Security vulnerabilities | ClawHavoc attack, RCE | No sandbox | Container-dependent | — | — | **Process + Container + RBAC + Audit** |
| Hard to set up | 45 min setup | — | Needs Docker | Needs Rust | Needs Rust | **60 seconds** |
| Sequential tool execution | Yes | Yes | Yes | Yes | — | **Parallel execution** |
| No response caching | — | — | — | — | — | **Semantic response cache** |
| No workflow automation | Basic cron | Heartbeat file | — | — | — | **Full pipeline workflows** |
| No smart routing | — | Roadmap | — | — | — | **Built-in cost optimization** |
| No voice support | — | — | — | — | — | **Voice transcription + TTS** |
| No analytics | — | — | — | — | — | **Conversation insights + cost tracking** |
| No REST API | — | — | — | — | — | **Webhook API + Prometheus metrics** |

## Features That Beat Every Competitor

### Performance
- **Parallel tool execution** — Run multiple tools simultaneously, not sequentially
- **Response caching with semantic matching** — Cache hits even for similar (not identical) queries
- **Request deduplication** — No wasted API calls on double-sends
- **Token budget optimization** — Intelligent context compression for long conversations
- **Smart routing** — Simple questions go to cheap models, complex ones to powerful models

### Unique Capabilities (No Other Claw Has These)
- **Workflow engine** — Create multi-step automation pipelines (like Zapier, but AI-controlled)
  - Conditional branching, parallel steps, retry/fallback
  - Template variables between steps (`{{step1.output}}`)
  - Cron, message, and webhook triggers
- **Voice processing** — Transcribe voice notes, generate speech, detect languages
  - Works with WhatsApp/Telegram voice messages natively
  - Whisper API for transcription, OpenAI TTS for synthesis
- **Conversation insights** — Built-in analytics dashboard
  - Sentiment tracking over time
  - Cost breakdown per user/channel
  - Topic extraction and trending
  - Hourly usage distribution with visual charts
  - Prometheus-compatible metrics endpoint
- **Webhook REST API** — External system integration
  - POST /api/message — Send messages to agents programmatically
  - POST /api/webhook/:hookId — Custom webhook triggers
  - GET /api/health — Health check
  - GET /api/status — System status
  - GET /api/metrics — Prometheus metrics
  - Bearer token auth, CORS support
- **Browser automation** — Direct Chrome DevTools Protocol integration, zero dependencies
- **Code interpreter** — Execute JavaScript in a secure VM sandbox (no shelling out)
- **Agent swarms** — Supervisor pattern with fan-out/fan-in, cost tracking, failure policies

### Security (Enterprise-Grade)

MyClaw has the most comprehensive security of any claw variant:

#### Sandbox Isolation
- **Process-level sandboxing** — Tool execution in forked child processes with restricted env
- **Container isolation** — Optional Docker/Podman/Apple Container support
- **Path-restricted filesystem** — Agents can only access explicitly allowed directories
- **Memory validation** — Size limits prevent prompt injection via memory pollution
- **Dangerous command blocking** — `rm -rf /`, `mkfs`, fork bombs automatically blocked

#### Audit Logging (Tamper-Evident)
- Every action logged: tool calls, messages, auth decisions, config changes
- **Hash-chain audit trail** — Each log entry links to the previous via SHA-256 hash
- **Sensitive data redaction** — API keys, tokens, passwords automatically scrubbed from logs
- Periodic flush with immediate write for security events
- JSONL format for easy ingestion into SIEM tools

#### Role-Based Access Control (RBAC)
Four built-in roles with granular permissions:

| Permission | Admin | Operator | User | Viewer |
|-----------|-------|----------|------|--------|
| All tools | Yes | Yes | Safe only | No |
| Dangerous tools (shell, fs write) | Yes | Yes | No | No |
| Config changes | Yes | No | No | No |
| Audit log access | Yes | Yes | No | No |
| Rate limit (msgs/min) | 1000 | 200 | 30 | 10 |

#### Rate Limiting
- **Sliding window** algorithm (not fixed window — more accurate)
- Per-user limits based on RBAC role
- Automatic cleanup of expired windows
- Returns `retryAfterMs` for client-side backoff

#### Security Audit Command
```bash
myclaw secure
```
Validates your installation:
- Data directory permissions (no world-readable)
- No API keys in config files
- Node.js version check
- Root user detection
- Docker availability
- .env file permissions

### Architecture
- **Plugin-based** — Core engine is ~200 lines. Everything else is a plugin.
- **Three plugin types:** Channels (messaging), Tools (capabilities), Models (AI providers)
- **Hot-pluggable** — Add/remove capabilities without restarting
- **TypeScript** — Full type safety, largest developer ecosystem
- **Zero required dependencies** — Uses Node.js built-ins (fetch, WebSocket, vm, child_process)

## Installation

### Option 1: One-Line Install (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/prakashjj/myClaw/main/setup.sh | bash
```

This clones the repo, installs dependencies, builds, links the `myclaw` command, and locks down the data directory.

### Option 2: One-Line Install (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/prakashjj/myClaw/main/setup.ps1 | iex
```

Same as above but also secures the data folder with NTFS ACLs (only your user can access it).

### Option 3: Clone and Build

```bash
# Clone
git clone https://github.com/prakashjj/myClaw.git
cd myClaw

# Install deps + build (one command)
npm run setup

# Link the "myclaw" command globally
npm link
```

### Option 4: npx (No Install)

```bash
# Run directly without installing globally
npx myclaw chat
npx myclaw init
```

### Option 5: As a Library (in Your Own Project)

```bash
npm install myclaw
```

```typescript
import { MyClawEngine, AnthropicPlugin, ShellToolPlugin } from "myclaw";
```

### After Installation

```bash
# 1. Set your API key (pick ONE — any works)
export ANTHROPIC_API_KEY=sk-ant-...     # Direct Anthropic
export OPENROUTER_API_KEY=sk-or-...     # OpenRouter (300+ models)
export OPENAI_API_KEY=sk-...            # Direct OpenAI

# 2. Generate config file
myclaw init

# 3. Run security audit
myclaw secure

# 4. Start chatting
myclaw chat
```

**Setup time: ~60 seconds** (vs OpenClaw's 45 minutes)

### Prerequisites

- **Node.js 20+** — [download here](https://nodejs.org)
- **git** — only needed for clone-based install
- No Docker required. No Rust. No Python. Just Node.

## Secure Installation

MyClaw can run in a fully sandboxed environment. Here's the recommended production setup.

### Linux / macOS

```bash
# 1. Create a dedicated user (don't run as root)
sudo useradd -r -m -s /bin/bash myclaw
sudo su - myclaw

# 2. Clone and build
git clone https://github.com/prakashjj/myClaw.git && cd myClaw
npm run setup

# 3. Init and auto-lock permissions
myclaw init
myclaw secure --fix    # chmod 700 .myclaw automatically

# 4. Lock .env file
chmod 600 .env
```

### Windows (Secured Folder)

```powershell
# 1. Open PowerShell (standard user — NOT Administrator)
# 2. Clone and build
git clone https://github.com/prakashjj/myClaw.git; cd myClaw
npm run setup

# 3. Init and auto-lock with NTFS ACLs
myclaw init
myclaw secure --fix    # Removes inheritance, only your user + SYSTEM get access

# 4. Verify
myclaw secure
```

The `myclaw secure --fix` command on Windows:
- Removes inherited permissions from `.myclaw/` (`icacls /inheritance:r`)
- Grants access only to the current user and SYSTEM
- No other user accounts can read, write, or list the directory
- No admin/elevated privileges needed

```json
{
  "security": {
    "sandbox": "process",
    "allowedPaths": ["./workspace"],
    "networkAccess": true,
    "maxExecutionTime": 30000,
    "maxMemoryMB": 256,
    "auditLog": true,
    "rbac": {
      "enabled": true,
      "users": [
        { "userId": "admin-123", "role": "admin" },
        { "userId": "*", "role": "user" }
      ]
    },
    "rateLimiting": {
      "enabled": true,
      "windowMs": 60000,
      "defaultLimit": 30
    }
  }
}
```

```bash
# 5. Verify security posture
myclaw secure

# 6. Start in daemon mode
myclaw start
```

For maximum isolation, use container sandbox mode:
```json
{
  "security": {
    "sandbox": "container",
    "networkAccess": false
  }
}
```

## Git Workspaces

MyClaw works out-of-the-box on cloud development environments.

### GitHub Codespaces

1. Open the repo in Codespaces (click **Code → Codespaces → New codespace**)
2. The dev container auto-installs dependencies, builds, and initializes config
3. Set your API key:
   ```bash
   export OPENROUTER_API_KEY=sk-or-...
   ```
4. Start chatting:
   ```bash
   myclaw chat
   ```

Ports 3200 (webhook API) and 3100 (WhatsApp webhook) are auto-forwarded.

### Gitpod

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/prakashjj/myClaw)

1. Click the button above (or prefix the repo URL with `gitpod.io/#`)
2. Gitpod runs `npm install && npm run build && node dist/cli.js init` automatically
3. Set your API key and start chatting

### VS Code Dev Containers

1. Install the **Dev Containers** extension
2. Clone the repo and open it in VS Code
3. Click **Reopen in Container** when prompted
4. Same auto-setup as Codespaces

### GitHub Actions CI

The repo includes a CI workflow (`.github/workflows/ci.yml`) that runs on every push and PR:
- **Matrix:** Ubuntu + Windows, Node.js 20 + 22
- **Steps:** Typecheck → Build → Test

## Commands

```bash
myclaw init              # Generate config file
myclaw chat              # Interactive terminal chat
myclaw run "do X"        # One-shot task execution
myclaw start             # Daemon mode (listen on channels)
myclaw status            # Show loaded plugins/agents
myclaw secure            # Run security audit
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
    "channels": ["telegram", "whatsapp", "discord"],
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
    "maxMemoryMB": 256,
    "auditLog": true,
    "rbac": { "enabled": true },
    "rateLimiting": { "enabled": true }
  },
  "webhook": {
    "enabled": true,
    "port": 3200,
    "apiToken": "your-secret-token"
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

## Supported Channels

| Channel | Status | Setup |
|---------|--------|-------|
| Telegram | Built-in | `TELEGRAM_BOT_TOKEN` |
| WhatsApp | Built-in | `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` |
| Discord | Built-in | `DISCORD_BOT_TOKEN` |
| Slack | Built-in | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` |
| Signal | Plugin | Community plugin |
| iMessage | Plugin | macOS only |
| Matrix | Plugin | Community plugin |
| IRC | Plugin | Community plugin |

### WhatsApp Features
- Text messages, images, audio, video, documents
- Interactive buttons and list messages
- Template messages for business notifications
- Read receipts (auto blue ticks)
- Voice note transcription (via Whisper)
- Reply threading
- Media download

### Telegram Features
- Text messages with Markdown/HTML formatting
- Group and private chat support
- Reply threading
- Long-polling (no webhook server needed)

## Built-in Tools

| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands (sandboxed, dangerous commands blocked) |
| `fetch_url` | Fetch web page content |
| `web_search` | Search the web (DuckDuckGo, no API key needed) |
| `read_file` | Read files (path-restricted) |
| `write_file` | Write files (path-restricted) |
| `list_dir` | List directory contents |
| `remember` | Store persistent memories |
| `recall` | Search memories |
| `execute_code` | Run JavaScript in VM sandbox |
| `browser_navigate` | Browser automation via CDP |
| `browser_click` | Click elements in browser |
| `browser_type` | Type into inputs |
| `browser_screenshot` | Capture screenshots |
| `create_workflow` | Build automation pipelines |
| `run_workflow` | Execute pipelines |
| `transcribe_audio` | Transcribe voice/audio to text (Whisper) |
| `text_to_speech` | Generate spoken audio from text |
| `detect_language` | Detect language from audio |
| `track_conversation` | Track messages for analytics |
| `get_insights` | View conversation analytics |
| `get_user_stats` | Per-user usage statistics |
| `get_cost_report` | Cost breakdown by user/channel |
| `get_sentiment_trend` | Sentiment tracking over time |

## Webhook REST API

Enable the webhook API to integrate MyClaw with external systems:

```bash
export MYCLAW_API_TOKEN=your-secret-token
```

### Endpoints

```bash
# Health check (public)
curl http://localhost:3200/api/health

# System status (authenticated)
curl -H "Authorization: Bearer $MYCLAW_API_TOKEN" \
  http://localhost:3200/api/status

# Send a message to an agent
curl -X POST http://localhost:3200/api/message \
  -H "Authorization: Bearer $MYCLAW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agentId": "assistant", "message": "What is the weather?"}'

# Prometheus metrics (for Grafana dashboards)
curl http://localhost:3200/api/metrics

# Custom webhook trigger
curl -X POST http://localhost:3200/api/webhook/deploy-notify \
  -H "Authorization: Bearer $MYCLAW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repo": "myapp", "status": "deployed"}'
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      MyClaw CLI                           │
├──────────────────────────────────────────────────────────┤
│               MyClaw Engine (~200 LOC)                    │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────┐        │
│  │ Plugin   │ │ Message  │ │  Agentic Loop     │        │
│  │ Registry │ │ Router   │ │  + Smart Routing  │        │
│  └──────────┘ └──────────┘ └───────────────────┘        │
├──────────────────────────────────────────────────────────┤
│  Performance Layer                                        │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐      │
│  │ Cache  │ │ Parallel │ │ Token    │ │ Dedup   │      │
│  │        │ │ Executor │ │ Optimizer│ │         │      │
│  └────────┘ └──────────┘ └──────────┘ └─────────┘      │
├──────────────────────────────────────────────────────────┤
│  Security Layer                                           │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐      │
│  │ RBAC   │ │ Audit    │ │ Rate     │ │Sandbox  │      │
│  │        │ │ Logger   │ │ Limiter  │ │         │      │
│  └────────┘ └──────────┘ └──────────┘ └─────────┘      │
├──────────┬──────────┬────────────────────────────────────┤
│ Channels │  Tools   │  Models                             │
│ ┌──────┐ │ ┌──────┐ │ ┌──────────┐                      │
│ │Telegr│ │ │Shell │ │ │Anthropic │                      │
│ │Whats │ │ │Web   │ │ │OpenAI    │                      │
│ │Discrd│ │ │Files │ │ │(any OAAI │                      │
│ │Slack │ │ │Memory│ │ │ compat)  │                      │
│ └──────┘ │ │Browsr│ │ └──────────┘                      │
│          │ │Code  │ │                                     │
│          │ │Workfl│ │  Webhook API                        │
│          │ │Voice │ │ ┌──────────┐                       │
│          │ │Insght│ │ │ REST API │                       │
│          │ └──────┘ │ │ Metrics  │                       │
│          │          │ └──────────┘                       │
├──────────┴──────────┴────────────────────────────────────┤
│  Sandbox: Process Fork │ Docker Container │ Path Guard    │
└──────────────────────────────────────────────────────────┘
```

## Competitive Comparison

| Feature | OpenClaw | PicoClaw | NanoClaw | ZeroClaw | MicroClaw | **MyClaw** |
|---------|----------|----------|----------|----------|-----------|------------|
| **Language** | TypeScript | Go | TypeScript | Rust | Rust | **TypeScript** |
| **Core size** | ~430K LOC | Small | ~3.9K LOC | ~3.4MB bin | Medium | **~2K LOC** |
| **Setup time** | ~45 min | ~5 min | ~10 min | ~10 min | ~15 min | **~1 min** |
| **WhatsApp** | Plugin | No | No | No | Yes | **Built-in (full API)** |
| **Telegram** | Plugin | Plugin | No | Plugin | Yes | **Built-in** |
| **Voice processing** | No | No | No | No | No | **Whisper + TTS** |
| **Analytics** | No | No | No | No | No | **Insights dashboard** |
| **REST API** | No | No | No | No | No | **Webhook API** |
| **Prometheus metrics** | No | No | No | No | No | **Built-in** |
| **RBAC** | No | No | No | No | No | **4 roles + custom** |
| **Audit logging** | No | No | No | No | No | **Hash-chain tamper-evident** |
| **Rate limiting** | No | No | No | No | No | **Sliding window** |
| **Parallel tools** | No | No | No | No | No | **Yes** |
| **Response cache** | No | No | No | No | No | **Yes (semantic)** |
| **Smart routing** | No | Planned | No | No | No | **Yes** |
| **Workflows** | Cron only | Heartbeat | No | No | No | **Full pipelines** |
| **Browser** | Playwright | No | No | No | No | **Native CDP** |
| **Code sandbox** | No | No | No | No | No | **VM sandbox** |
| **Agent swarms** | No | No | Yes | No | No | **Yes (supervised)** |
| **Sandbox** | App-level | None | Container | Workspace | None | **Process+Container** |
| **Security audit CLI** | No | No | No | No | No | **`myclaw secure`** |
| **Plugin system** | ClawHub | No | Skills | Traits | Adapters | **Full plugin API** |

## License

MIT
