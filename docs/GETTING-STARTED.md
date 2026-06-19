# Getting Started with Codex Romanus

> A complete setup guide for deploying and running the 12-agent AI team for opencode.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [First Run](#first-run)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Next Steps](#next-steps)

---

## Prerequisites

### Required Software

| Dependency | Minimum Version | Recommended |
|------------|----------------|-------------|
| **Node.js** | 22.12+ | 24.x LTS |
| **npm** | 10+ | 11+ |
| **Git** | 2.40+ | 2.47+ |
| **opencode** | Latest | Go version |
| **PowerShell** (Windows) | 7.4+ | 7.5+ |

### Hardware Recommendations

| Setup | RAM | Disk | CPU |
|-------|-----|------|-----|
| **Minimum** | 8 GB | 2 GB free | 4 cores |
| **Recommended** | 16 GB | 5 GB free | 8 cores |
| **With ComfyUI (Imago)** | 32 GB | 20 GB free | GPU (8+ GB VRAM) |

### opencode Subscription

Codex Romanus requires an **opencode Go** subscription to access the DeepSeek V4 model family used by all agents. Free-tier models lack the capability to run multi-agent workflows reliably.

---

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url> codex-romanus
cd codex-romanus
```

### 2. Install Subproject Dependencies

Codex Romanus ships with multiple MCP server subprojects. Each must be built independently:

```bash
# Tabularium — governance, memory, metrics
cd tabularium
npm install
npm run build
cd ..

# Ianus Liminalis — filesystem with atomic backup
cd ianus-liminalis
npm install
npm run build
cd ..

# Speculum — web search (DuckDuckGo, no API key)
cd speculum
npm install
npm run build
cd ..

# Imago — AI image generation via ComfyUI (optional)
cd imago
npm install
npm run build
cd ..

# Praetorium — operational dashboard (optional)
cd praetorium
npm install
npm run build
cd ..
```

> **Note**: Imago and Praetorium are optional. Skip them if you don't need image generation or the web dashboard.

### 3. (Optional) Install ComfyUI for Imago

If you plan to use the Imago MCP server for AI image generation:

```bash
# Follow the official ComfyUI installation guide:
# https://github.com/comfyanonymous/ComfyUI

# Ensure ComfyUI is running before starting opencode
# Default: http://127.0.0.1:8188
```

### 4. Verify File Structure

After installation, your project root should contain:

```
codex-romanus/
├── tabularium/          # Governance MCP server
├── ianus-liminalis/     # Filesystem MCP server
├── speculum/            # Web search MCP server
├── imago/               # Image generation MCP server (optional)
├── praetorium/          # Dashboard (optional)
├── docs/                # Documentation
│   └── eng/             # English docs
├── opencode.json        # Team configuration
├── AGENTS.md            # Agent protocol reference
└── README.md            # Project overview
```

---

## Configuration

### 1. opencode.json

The `opencode.json` file at the project root defines all 12 agents and their MCP servers. In most cases, no manual editing is required — the default configuration works out of the box.

If you need to customize agent models, update the `models` section:

```jsonc
// opencode.json
{
  "agents": {
    "iuppiter-orchestrator": {
      "model": {
        "provider": "opencode",
        "model": "deepseek-v4-pro"  // or "deepseek-v4-flash"
      }
    }
    // ... other agents
  }
}
```

### 2. MCP Server Configuration

MCP servers are configured in the `mcp` section of `opencode.json`. Each server connects via `stdio` (local subprocess) or `sse` (remote):

```jsonc
{
  "mcp": {
    "tabularium": {
      "type": "sse",
      "url": "http://localhost:3001/sse",
      "transport": "sse"
    },
    "ianus-liminalis": {
      "type": "sse",
      "url": "http://localhost:3002/sse",
      "transport": "sse"
    },
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    }
    // ...
  }
}
```

### 3. Environment Variables

Create a `.env` file in each subproject (or a single `.env` in the project root):

```bash
# Tabularium
TABULARIUM_PORT=3001
TABULARIUM_DB_PATH=./memory.db

# Ianus Liminalis
IANUS_PORT=3002
IANUS_WORKSPACE=.

# Speculum
SPECULUM_PORT=3003

# Imago (optional)
IMAGO_COMFYUI_URL=http://127.0.0.1:8188
IMAGO_PORT=3004

# Praetorium (optional)
PRAETORIUM_PORT=3005
PRAETORIUM_TABULARIUM_URL=http://localhost:3001
```

> **Windows users**: Use `copy .env.example .env` instead of `cp`.

### 4. Team Preset Selection (Optional)

Codex Romanus supports three team sizes. Select the one that fits your project:

```powershell
# PowerShell (Windows)
.\switch-team.ps1 small    # 6 agents — lightest
.\switch-team.ps1 medium   # 9 agents — balanced
.\switch-team.ps1 large    # 12 agents — full team (default)
```

```bash
# bash (Linux/macOS)
chmod +x switch-team.sh
./switch-team.sh medium
```

---

## First Run

### 1. Start MCP Servers

Launch each MCP server in its own terminal (or use a process manager):

```bash
# Terminal 1: Tabularium
cd tabularium && node dist/index.js

# Terminal 2: Ianus Liminalis
cd ianus-liminalis && node dist/index.js

# Terminal 3: Speculum
cd speculum && node dist/index.js
```

### 2. Start opencode

Open the project in opencode with MCP server auto-loading:

```bash
opencode .
```

### 3. Verify Agents Are Online

In opencode, run the health check command:

```
@iuppiter-orchestrator health check
```

This triggers the orchestration layer to verify all 12 agents respond to heartbeat pings.

### 4. Check Agent Status via Tabularium

```json
// The orchestrator will query agent statuses
tabularium_agent_list_agents
```

Expected output — all agents show `status: "idle"`:

| Agent | Status |
|-------|--------|
| iuppiter-orchestrator | idle |
| minerva-architect | idle |
| vulcanus-senior-dev | idle |
| mercurius-junior-dev | idle |
| ... (all 12) | idle |

### 5. Run a Simple Test Task

Verify end-to-end agent execution:

```
@mercurius-junior-dev Run health check and report
```

The agent should:
1. Load Lex Agentium skill
2. Set heartbeat to busy
3. Execute the check
4. Report results
5. Set heartbeat to idle

---

## Verification

### Check the Praetorium Dashboard (Optional)

If you have Praetorium installed, open `http://localhost:3005` in your browser:

- **Live Agent Board** — see all agent statuses in real time
- **Heartbeat Monitor** — check last ping per agent
- **Metrics Panel** — view quality, test, and performance trends
- **Alert Feed** — unresolved issues requiring attention

### Run the Quality Gate

From any agent, trigger a full quality audit:

```
@catone-quality Run quality gate
```

This executes the pipeline:

```text
lint → TypeScript type check → unit tests → coverage → security audit
```

All steps must pass with zero errors for a green status.

### Verify MCP Servers

Check each MCP server responds:

```json
// Tabularium health
tabularium_utility action="health"

// Ianus Liminalis file access
ianus-liminalis_fs_stat path="README.md"

// Speculum search
speculum_speculum_web_search query="opencode AI editor"
```

Expected response from each: `success: true` with relevant data.

### Verify File Change Journal

Ensure the journal is operational:

```json
ianus-liminalis_fs_journal limit=5
```

You should see recent file operations indexed with agent, path, and timestamp.

---

## Troubleshooting

### Common Issues and Fixes

#### ❌ Agent shows "offline" on dashboard

```
Cause: Heartbeat timeout (180s without ping)
Fix:   @agent_name status — triggers reconnect
       Or restart opencode to reinitialize MCP servers
```

#### ❌ MCP server connection refused

```
Cause: Server not running or wrong port
Fix:   Verify the server process is alive:
         ps aux | grep node (Linux/macOS)
         Get-Process node (Windows)
       Check port in use:
         netstat -an | findstr :3001 (Windows)
         lsof -i :3001 (Linux/macOS)
       Restart the specific MCP server subproject
```

#### ❌ TypeScript build fails in subproject

```
Cause: Missing dependencies or Node.js version mismatch
Fix:   cd <subproject>
       rm -rf node_modules
       npm install
       npm run build
       Verify Node.js >= 22.12:
         node --version
```

#### ❌ Tabularium database locked

```
Cause: Another process holds a lock on memory.db
Fix:   Close all other opencode instances
       Kill orphaned Node.js processes:
         taskkill /F /IM node.exe (Windows)
         killall node (Linux/macOS)
       Restart Tabularium
```

#### ❌ Praetorium dashboard shows no data

```
Cause: Tabularium not fully started before Praetorium
Fix:   Restart Praetorium after Tabularium is running
       Verify Tabularium URL in Praetorium .env
       Check browser console for CORS errors
```

#### ❌ Windows — long path errors

```
Cause: Windows MAX_PATH limitation (260 chars)
Fix:   Enable long paths in Group Policy:
         gpedit.msc → Computer Configuration →
         Administrative Templates → System → Filesystem →
         Enable Win32 Long Paths
       Or clone to a shorter path like C:\codex
```

#### ❌ "Command not found: opencode"

```
Cause: opencode not in PATH
Fix:   Add opencode installation directory to PATH
       Or use the full path:
         & "C:\Program Files\opencode\opencode.exe" . (Windows)
```

---

## Next Steps

Once the team is operational:

| Step | Action | Guide |
|------|--------|-------|
| 1 | Read the full agent protocol | [AGENTS.md](AGENTS.md) |
| 2 | Understand system architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 3 | Learn about all 6 MCP servers | [MCP-SERVERS.md](MCP-SERVERS.md) |
| 4 | Set up CI/CD pipeline | DevOps via @agrippa-devops |
| 5 | Configure SEO metadata | SEO via @plinioilvecchio-seo |
| 6 | Contribute to the project | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## Quick Reference Card

```text
┌─────────────────────────────────────────────────────┐
│              CODEX ROMANUS — QUICK START             │
├─────────────────────────────────────────────────────┤
│                                                     │
│  git clone <repo> && cd codex-romanus               │
│  cd tabularium  && npm i && npm run build && cd ..  │
│  cd ianus-liminalis && npm i && npm run build && ..  │
│  cd speculum && npm i && npm run build && cd ..     │
│                                                     │
│  # Start servers (3 terminals)                      │
│  node tabularium/dist/index.js                      │
│  node ianus-liminalis/dist/index.js                 │
│  node speculum/dist/index.js                        │
│                                                     │
│  opencode .   # Launch opencode                     │
│  @iuppiter-orchestrator health check                │
│  @catone-quality Run quality gate                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```
