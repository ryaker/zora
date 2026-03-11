# Central PM Zora — Persistent Daemon + Multi-Instance Project Management

**Status:** Planning
**Created:** 2026-03-10
**Related:** Issue #143 (project-scoped dashboard), PR #142 (Signal channel)

---

## Vision

One "PM Zora" runs persistently on the Mac Mini, reachable via Signal and Telegram. When work arrives for a project, PM Zora spawns a project-scoped child Zora instance (or routes to an existing one), coordinates it via AgentBus, and aggregates results back to the user. Each child Zora has its own config, policy, and dashboard — visually distinct and namespaced.

```
                       Signal / Telegram
                             │
                             ▼
                    ┌─────────────────┐
                    │   PM Zora       │  ← persistent daemon, launchd-managed
                    │  ~/.zora/pm/    │    system prompt: project coordinator
                    │  port: 8070     │    receives: ALL inbound Signal/Telegram
                    └────────┬────────┘
                             │ spawn_zora_agent / AgentBus routing
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ Zora:        │  │ Zora:        │  │ Zora:        │
    │ AgentDev     │  │ AbundanceCoach│  │ Trading      │
    │ port: 8071   │  │ port: 8072   │  │ port: 8073   │
    │ color: #6b9fff│ │ color: #ff6b6b│ │ color: #6bff9f│
    └──────────────┘  └──────────────┘  └──────────────┘
              │              │              │
              └──────────────┴──────────────┘
                             │
                        AgentBus :8090
                  (~/.agent-bus/inbox/<project>/)
```

---

## Work Items

### WI-1: Persistent Daemon via launchd

**Description:** Create a launchd plist for PM Zora that survives crashes and machine reboots. The plist must set `JAVA_HOME` and other required env vars (Zora needs them for provider SDK calls), configure log rotation via stdout/stderr redirects to dated log files, and enforce `KeepAlive = true` for auto-restart. Install to `~/Library/LaunchAgents/`.

**Configuration:**
- Working directory: `~/Dev/AgentDev` (PM Zora's project root)
- Config directory: `~/.zora/pm/` (separate from user's default `~/.zora/`)
- Log path: `~/Library/Logs/zora-pm.log`
- Env vars needed: `JAVA_HOME`, `ANDROID_HOME` (for any mobile tooling calls), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`

**Files to create:**
- `~/Library/LaunchAgents/com.ryaker.zora-pm.plist`
- `~/.zora/pm/config.toml` (PM Zora base config)

| WSJF Factor | Score |
|-------------|-------|
| Cost of Delay (usability — nothing works without the daemon) | 9 |
| Wiring Impact (foundation for all other WIs) | 10 |
| Security Risk (no new attack surface) | 2 |
| Time Criticality (blocks WI-3, WI-4, WI-5) | 9 |
| **Job Size** | **3** |
| **WSJF Score** | **10.0** |

**Dependencies:** None
**Parallelizable:** Yes (Group A)
**Complexity:** S

---

### WI-2: Multi-Instance Config Layout

**Description:** Define a standard directory layout for per-project Zora instances. Each project gets its own config directory under `~/.zora/projects/<name>/`, containing `config.toml` (port, provider preferences, project identity) and `policy.toml` (channel allowlists, tool restrictions). A shared `~/.zora/defaults.toml` provides base values all instances inherit, overridden per-project.

**Proposed layout:**
```
~/.zora/
  defaults.toml              ← shared base config (port: 8070, providers, etc.)
  pm/
    config.toml              ← PM Zora overrides (port: 8070, soul: pm-coordinator)
    SOUL.md                  ← PM Zora identity + routing instructions
  projects/
    AgentDev/
      config.toml            ← port: 8071, color: "#6b9fff", name: "AgentDev"
      policy.toml            ← allowed channels, tool restrictions
    AbundanceCoach/
      config.toml            ← port: 8072, color: "#ff6b6b", name: "Abundance Coach"
      policy.toml
    Trading/
      config.toml            ← port: 8073, color: "#6bff9f", name: "Trading"
      policy.toml
```

**Files to create:**
- `~/.zora/defaults.toml`
- Per-project `config.toml` and `policy.toml` for each active project
- Update `src/config/loader.ts` to support `--config-dir` flag for specifying config root

**Config schema additions** (to `config.toml`):
```toml
[project]
name = "AgentDev"
color = "#6b9fff"
icon = "🔧"
description = "Zora agent framework"

[instance]
config_dir = "~/.zora/projects/AgentDev"
```

| WSJF Factor | Score |
|-------------|-------|
| Cost of Delay (multi-instance impossible without it) | 8 |
| Wiring Impact (required by WI-3, WI-4, WI-5) | 9 |
| Security Risk (isolates project policies) | 4 |
| Time Criticality (blocks WI-3, WI-4) | 8 |
| **Job Size** | **3** |
| **WSJF Score** | **9.67** |

**Dependencies:** None
**Parallelizable:** Yes (Group A)
**Complexity:** S

---

### WI-3: Project-Scoped Dashboard with Color Identity (Issue #143)

**Description:** Implement the dashboard visual differentiation specified in issue #143. When running multiple Zora instances on the same machine, each dashboard tab must be immediately identifiable by color, title, and icon — not just port number.

**Implementation (as specified in #143):**

Phase 1 — Config + API:
- Add `ProjectConfig` type to `src/config/defaults.ts`
- Parse `[project]` section in `src/config/loader.ts`, validate hex color
- Add `GET /api/project` endpoint to `src/dashboard/server.ts`
- Add `/favicon.svg` dynamic SVG route (color-matched)

Phase 2 — Frontend:
- `src/dashboard/frontend/src/App.tsx`: fetch `/api/project` on mount
- Update `<title>` → `{icon} {name} — Zora`
- Update header text → `ZORA / {NAME}`
- Override `--color-primary` CSS variable with project color

Phase 3 — Daemon wiring:
- `src/cli/daemon.ts`: pass `config.project` to `DashboardServer` constructor

**Acceptance tests** (from #143):
- `curl localhost:PORT/api/project` returns correct name/color/icon
- Two instances on different ports show different tab titles simultaneously
- Two instances show visually distinct header bar colors
- Missing `[project]` config falls back gracefully (uses `agent.name`, default colors)
- Invalid hex color logs warning and falls back (no crash)

| WSJF Factor | Score |
|-------------|-------|
| Cost of Delay (multi-instance UX unusable without it) | 7 |
| Wiring Impact (unblocks visual management of instances) | 6 |
| Security Risk (no security impact) | 1 |
| Time Criticality (depends on WI-2 config layout) | 5 |
| **Job Size** | **3** |
| **WSJF Score** | **6.33** |

**Dependencies:** WI-2 (multi-instance config layout)
**Parallelizable:** Yes (Group A — config schema is the only dep, trivial to stub)
**Complexity:** M

---

### WI-4: spawn_zora_agent Tool in Orchestrator

**Description:** Add a `spawn_zora_agent` tool to Zora's orchestrator tool registry. When PM Zora invokes this tool, it:
1. Resolves the project's config directory from `~/.zora/projects/<name>/`
2. Checks if an instance is already running on that project's port (via `GET http://localhost:<port>/api/health`)
3. If not running: spawns `zora start --config-dir ~/.zora/projects/<name>/` as a child process
4. Registers the new instance with AgentBus (`POST /api/bus/register`)
5. Returns the instance's URL and port to PM Zora

**Tool schema:**
```typescript
{
  name: "spawn_zora_agent",
  description: "Spawn a project-scoped Zora instance or verify an existing one is running",
  parameters: {
    project_name: string,          // e.g. "AgentDev"
    task?: string,                 // optional initial task to route to the instance
  }
}
```

**Implementation location:** `src/orchestrator/tools/spawn-zora-agent.ts`
**Registration:** `src/orchestrator/tool-registry.ts`

**Safety constraints:**
- Max concurrent child instances: configurable via `[pm] max_children` in PM config (default: 5)
- Child process stdout/stderr → `~/Library/Logs/zora-<project>.log`
- Orphan prevention: PM Zora registers a SIGTERM handler to kill all children on shutdown

| WSJF Factor | Score |
|-------------|-------|
| Cost of Delay (PM Zora can't manage projects without spawning) | 8 |
| Wiring Impact (the core capability of the PM pattern) | 9 |
| Security Risk (spawning processes — needs child count cap) | 5 |
| Time Criticality (blocks WI-6 PM routing logic) | 8 |
| **Job Size** | **4** |
| **WSJF Score** | **7.5** |

**Dependencies:** WI-1 (launchd daemon), WI-2 (multi-instance config)
**Parallelizable:** No (Group B)
**Complexity:** M

---

### WI-5: AgentBus Client in Zora Orchestrator

**Description:** Integrate Zora's orchestrator with AgentBus as a client, so Zora instances can:
1. Register themselves with AgentBus on startup (`POST /api/bus/register`)
2. Send messages to other Zora instances via AgentBus (`POST /api/bus/send`)
3. Receive messages from AgentBus via the existing ZoraBridge (already watches `~/.agent-bus/inbox/<project>/`)
4. Acknowledge handled messages (`POST /api/bus/ack`)

**Implementation:**
- `src/integrations/agentbus/agentbus-client.ts` — typed wrapper around AgentBus REST API (:8090)
- Hook into `src/orchestrator/orchestrator.ts` boot sequence: register on startup, deregister on shutdown
- Expose `send_to_project` tool (routes via AgentBus) for PM Zora to use when addressing child Zoras

**Note:** ZoraBridge in AgentBus already handles the inbound direction (watches inbox, POSTs to `/api/task`). This WI handles the outbound direction and registration — completing the integration loop.

**Relevant AgentBus endpoints:**
- `POST /api/bus/register` — `{ project, folder_path, runtime: "zora", pid }`
- `POST /api/bus/send` — `{ to_project, content, from_source, priority }`
- `POST /api/bus/ack` — `{ message_id, handled_by }`

| WSJF Factor | Score |
|-------------|-------|
| Cost of Delay (PM↔child routing impossible without it) | 8 |
| Wiring Impact (completes the AgentBus↔Zora loop) | 9 |
| Security Risk (local loopback only, no new attack surface) | 2 |
| Time Criticality (blocks WI-6 PM routing logic) | 7 |
| **Job Size** | **3** |
| **WSJF Score** | **8.67** |

**Dependencies:** WI-1 (launchd), WI-2 (multi-instance config)
**Parallelizable:** No (Group B, but can run in parallel with WI-4)
**Complexity:** S

---

### WI-6: PM Zora System Prompt + Signal Routing Logic

**Description:** Author the SOUL.md and system prompt that makes PM Zora behave as a project coordinator rather than a general-purpose agent. PM Zora's job is:
1. Receive inbound messages from Signal (via SignalIntakeAdapter, from PR #142)
2. Identify which project the message relates to (by content analysis or explicit `@project` prefix)
3. Either: route to an existing child Zora via `send_to_project`, or spawn one via `spawn_zora_agent`
4. Aggregate and relay responses back to the Signal sender

**Files:**
- `~/.zora/pm/SOUL.md` — PM Zora identity: project coordinator, knows all active projects, routes rather than executes
- `~/.zora/pm/config.toml` — Signal channel enabled, Telegram channel enabled, all projects listed
- `src/channels/signal/signal-pm-router.ts` — parses `@project` prefix or uses LLM classification to route

**Signal routing rules:**
```
"@AgentDev run the test suite"    → route to AgentDev Zora
"check my MATIC position"         → LLM classifies → route to Trading Zora
"what's on the blog calendar"     → LLM classifies → route to AbundanceCoach Zora
"/status"                         → PM Zora responds directly with all instance health
```

**PM Zora responds directly to:**
- `/status` — list all running instances, ports, last activity
- `/spawn <project>` — explicitly start a project Zora
- `/stop <project>` — gracefully stop a child instance
- `/list` — list configured projects

| WSJF Factor | Score |
|-------------|-------|
| Cost of Delay (PM Zora is useless without routing logic) | 9 |
| Wiring Impact (connects Signal → PM → child Zoras end-to-end) | 9 |
| Security Risk (LLM routing needs injection resistance — quarantine already built) | 3 |
| Time Criticality (final integration step, blocks nothing else) | 4 |
| **Job Size** | **4** |
| **WSJF Score** | **6.25** |

**Dependencies:** WI-4 (spawn tool), WI-5 (AgentBus client), PR #142 merged (Signal channel)
**Parallelizable:** No (Group C)
**Complexity:** M

---

### WI-0: Merge PR #142 (Signal Channel Foundation)

**Description:** PR #142 (Signal secure channel) is the prerequisite for all Signal-based routing. The branch (`feature/signal-secure-channel`) has uncommitted fixes per the git status:
- `config/channel-policy.example.toml` — modified
- `docs/SIGNAL_CHANNEL_SETUP.md` — modified
- `src/channels/channel-identity-registry.ts` — modified
- `src/channels/signal/signal-identity.ts` — modified
- `src/channels/signal/signal-intake-adapter.ts` — modified
- `src/channels/signal/signal-response-gateway.ts` — modified
- `src/cli/daemon.ts` — modified
- `src/dashboard/server.ts` — modified
- `src/orchestrator/orchestrator.ts` — modified
- `src/providers/gemini-provider.ts` — modified
- `tests/unit/channels/signal-intake-adapter.test.ts` — modified
- `tests/unit/dashboard/dashboard-synthetic.test.ts` — modified

Action: commit the working changes on `feature/signal-secure-channel`, push, address any remaining reviewer comments, and merge to main.

| WSJF Factor | Score |
|-------------|-------|
| Cost of Delay (all Signal routing blocked until merged) | 10 |
| Wiring Impact (foundation for WI-6) | 10 |
| Security Risk (already reviewed, no new risk) | 1 |
| Time Criticality (blocks WI-6, should happen first) | 10 |
| **Job Size** | **1** |
| **WSJF Score** | **31.0** |

**Dependencies:** None (it's already built)
**Parallelizable:** Yes (do this first, in parallel with Group A)
**Complexity:** S

---

## Priority-Ordered Work Item Table

| ID | Title | WSJF | Group | Size | Blocks |
|----|-------|------|-------|------|--------|
| WI-0 | Merge PR #142 (Signal channel) | 31.0 | Pre-A | S | WI-6 |
| WI-1 | launchd persistent daemon | 10.0 | A | S | WI-4, WI-5 |
| WI-2 | Multi-instance config layout | 9.67 | A | S | WI-3, WI-4, WI-5 |
| WI-5 | AgentBus client in Zora | 8.67 | B | S | WI-6 |
| WI-4 | spawn_zora_agent tool | 7.50 | B | M | WI-6 |
| WI-3 | Dashboard color identity (#143) | 6.33 | A | M | — |
| WI-6 | PM Zora system prompt + Signal routing | 6.25 | C | M | — |

---

## ASCII Dependency Diagram

```
  WI-0: Merge PR #142 (Signal)
  ├── no blocking deps
  └── enables: WI-6 (Signal routing)

  GROUP A ─────────────────────────────── (start immediately, all parallel)
  │
  ├── WI-1: launchd plist
  │   ├── no blocking deps
  │   └── enables: WI-4 (spawn tool), WI-5 (AgentBus client)
  │
  ├── WI-2: multi-instance config layout
  │   ├── no blocking deps
  │   └── enables: WI-3 (dashboard), WI-4 (spawn tool), WI-5 (AgentBus client)
  │
  └── WI-3: dashboard color identity (issue #143)
      ├── soft dep on WI-2 (config schema, can stub)
      └── no downstream blocks

  GROUP B ─────────────────────────────── (start after Group A complete)
  │
  ├── WI-4: spawn_zora_agent tool
  │   ├── requires: WI-1 (daemon), WI-2 (config)
  │   └── enables: WI-6 (PM routing)
  │
  └── WI-5: AgentBus client in Zora
      ├── requires: WI-1 (daemon), WI-2 (config)
      └── enables: WI-6 (PM routing)

  GROUP C ─────────────────────────────── (start after Group B complete + WI-0 merged)
  │
  └── WI-6: PM Zora system prompt + Signal routing
      ├── requires: WI-4, WI-5, WI-0 (PR #142 merged)
      └── delivers: full PM Zora capability


  Timeline (optimistic parallel execution):
  ─────────────────────────────────────────────────────────────────
  Day 1:  [WI-0 commit+push] [WI-1 plist] [WI-2 config] [WI-3 dashboard]
  Day 2:  [WI-4 spawn tool] [WI-5 AgentBus client]  (parallel)
  Day 3:  [WI-6 PM routing + SOUL.md]
  Day 4:  Integration testing, launchd install, signal-cli end-to-end
  ─────────────────────────────────────────────────────────────────
```

---

## Parallelization Groups Summary

### Group A — Start Immediately (no dependencies)

All three can run concurrently on separate worktrees/branches:

| Work Item | Branch | Worktree |
|-----------|--------|----------|
| WI-0: Merge PR #142 | `feature/signal-secure-channel` (already exists) | main repo |
| WI-1: launchd plist | `feature/pm-zora-launchd` | `~/Dev/zora-worktrees/pm-daemon` |
| WI-2: multi-instance config | `feature/multi-instance-config` | `~/Dev/zora-worktrees/pm-config` |
| WI-3: dashboard colors (#143) | `feature/project-dashboard-colors` | `~/Dev/zora-worktrees/dashboard` |

### Group B — After Group A Complete

Both can run concurrently:

| Work Item | Branch | Worktree |
|-----------|--------|----------|
| WI-4: spawn_zora_agent tool | `feature/spawn-zora-agent` | `~/Dev/zora-worktrees/spawn-tool` |
| WI-5: AgentBus client | `feature/agentbus-client` | `~/Dev/zora-worktrees/agentbus` |

### Group C — After Group B Complete + PR #142 Merged

| Work Item | Branch | Worktree |
|-----------|--------|----------|
| WI-6: PM Zora routing | `feature/pm-zora-routing` | `~/Dev/zora-worktrees/pm-routing` |

---

## Verification Steps

For each work item, success is defined as:

**WI-0:** `git push && gh pr view 142` shows all checks passing, PR merged to main.

**WI-1:** `launchctl list | grep zora-pm` shows the service loaded; kill the process and verify it restarts within 10 seconds; check `~/Library/Logs/zora-pm.log` for boot sequence.

**WI-2:** `zora start --config-dir ~/.zora/projects/AgentDev/` boots cleanly; `zora start --config-dir ~/.zora/projects/Trading/` boots on a different port without conflict.

**WI-3:** Two browser tabs open to ports 8071 and 8072 show visually distinct header colors and tab titles simultaneously. `curl localhost:8071/api/project` returns `{"name":"AgentDev","color":"#6b9fff"}`.

**WI-4:** PM Zora conversation: `"spawn AgentDev"` → `spawn_zora_agent(project_name="AgentDev")` executes → port 8071 becomes reachable → `GET http://localhost:8071/api/health` returns 200.

**WI-5:** `agent-bus status` shows both PM Zora and child Zora as registered sessions. AgentBus inbox delivery to a running Zora instance is ACKed within 5 seconds.

**WI-6:** End-to-end: Signal message sent via signal-cli → PM Zora receives → routes to correct child → child responds → response delivered back to Signal sender. `/status` command to PM Zora returns list of all running instances.

---

## Key Files Affected

| File | Work Item | Change |
|------|-----------|--------|
| `~/Library/LaunchAgents/com.ryaker.zora-pm.plist` | WI-1 | New |
| `~/.zora/pm/config.toml` | WI-1, WI-6 | New |
| `~/.zora/projects/<name>/config.toml` | WI-2 | New (per project) |
| `src/config/defaults.ts` | WI-2, WI-3 | Add ProjectConfig type |
| `src/config/loader.ts` | WI-2, WI-3 | Parse [project] section, --config-dir flag |
| `src/dashboard/server.ts` | WI-3 | GET /api/project + /favicon.svg |
| `src/dashboard/frontend/src/App.tsx` | WI-3 | Fetch project info, update CSS vars |
| `src/cli/daemon.ts` | WI-3 | Pass config.project to DashboardServer |
| `src/orchestrator/tools/spawn-zora-agent.ts` | WI-4 | New tool |
| `src/orchestrator/tool-registry.ts` | WI-4 | Register spawn tool |
| `src/integrations/agentbus/agentbus-client.ts` | WI-5 | New |
| `src/orchestrator/orchestrator.ts` | WI-5 | Register/deregister on boot/shutdown |
| `~/.zora/pm/SOUL.md` | WI-6 | New — PM Zora identity |
| `src/channels/signal/signal-pm-router.ts` | WI-6 | New — routing logic |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| launchd env vars not inherited | Medium | High | Explicitly set all vars in plist `<EnvironmentVariables>` dict |
| Port conflicts between instances | Low | Medium | WI-2 config schema enforces unique ports; health check before spawn |
| AgentBus ZoraBridge → /api/task port mismatch | Medium | High | ZoraBridge reads port from projects.json — update when child ports assigned |
| Child Zoras orphaned on PM crash | Medium | Medium | PM SIGTERM handler kills children; launchd plist kills process group |
| Signal routing misclassification | Medium | Low | Quarantine processor (already in PR #142) pre-screens; explicit `@project` prefix always wins |
| PR #142 uncommitted changes lost | Low | High | Commit before any other work starts (WI-0 is Group Pre-A) |

---

*This plan assumes Zora health score 8/10 (all critical gaps closed). The 10 remaining open gaps (logging, docs, polish) do not block any work item in this plan.*
