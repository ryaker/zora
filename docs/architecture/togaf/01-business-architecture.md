# Business Architecture
## TOGAF ADM Phase B --- Zora Agent Framework

**Document ID:** TOGAF-BA-001  
**Version:** 1.0  
**Date:** 2026-02-25  
**Status:** Approved  

---

## 1. Business Context

### 1.1 Organization

Zora targets individual knowledge workers, small development teams, and call center operations seeking to augment human productivity with autonomous AI assistance. The initial deployment context is personal productivity on macOS / Linux workstations, with a secondary deployment context of enterprise call center augmentation (e.g., DirecTV inbound customer support).

### 1.2 Business Drivers

| Driver | Description |
|---|---|
| Productivity amplification | Automate repetitive file, code, and research tasks that currently require manual LLM interaction |
| Cost containment | Leverage existing Claude Code / Gemini CLI subscriptions (included/free cost tier) rather than per-token API billing |
| Compliance readiness | Provide tamper-evident audit logs suitable for SOC2, CPNI, and enterprise security reviews |
| Operator control | Give non-technical users declarative control over what the AI can and cannot do |
| Local-first privacy | Keep all user data, files, and memory on the user machine --- no cloud sync required |

---

## 2. Business Capability Model

### 2.1 Core Capabilities

| Capability | Description | Zora Implementation |
|---|---|---|
| **Task Orchestration** | Accept user tasks and route to appropriate AI backend | Orchestrator.submitTask() + Router.selectProvider() |
| **Autonomous Execution** | Execute tool calls (file ops, shell, API) on behalf of user | ExecutionLoop + ClaudeProvider/GeminiProvider |
| **Memory Management** | Persist and retrieve context across sessions | MemoryManager (3-tier: MEMORY.md, daily notes, structured items) |
| **Policy Enforcement** | Enforce user-defined boundaries on AI actions | PolicyEngine.canUseTool() gating every tool call |
| **Audit and Accountability** | Produce tamper-evident record of all AI actions | AuditLogger SHA-256 hash-chained JSONL |
| **Human Oversight** | Enable real-time steering and monitoring | DashboardServer (SSE), TelegramGateway, SteeringManager |
| **Provider Failover** | Maintain continuity when primary LLM is unavailable | FailoverController + RetryQueue + CircuitBreaker |
| **Scheduled Automation** | Run recurring tasks without user initiation | RoutineManager + HeartbeatSystem (node-cron) |
| **Security Hardening** | Detect and mitigate prompt injection, goal drift, data leaks | IntentCapsuleManager, LeakDetector, PromptDefense, IntegrityGuardian |
| **Multi-agent Coordination** | Coordinate parallel specialized agents on complex tasks | TeamManager + Mailbox (filesystem-based inbox) |

### 2.2 Capability Dependencies

    Task Orchestration
      |-- requires --> Policy Enforcement (gate every execution)
      |-- requires --> Audit and Accountability (log every event)
      |-- requires --> Provider Failover (handle backend unavailability)
      |-- uses --> Memory Management (inject context into task)
      |-- uses --> Human Oversight (stream events to dashboard)

---

## 3. Business Process Model

### 3.1 Core Process: Task Execution

    1. User submits task (CLI / Dashboard / Telegram)
    2. Orchestrator sanitizes input via PromptDefense.sanitizeInput()
    3. Orchestrator creates IntentCapsule (HMAC-SHA256 signed mandate)
    4. AuditLogger records task.start event
    5. Router selects optimal provider (capability + cost + availability)
    6. ExecutionLoop runs LLM with canUseTool callback
    7. For each tool call:
       a. PolicyEngine.canUseTool() gates the action
       b. IntentCapsuleManager.checkDrift() verifies alignment
       c. AuditLogger records tool.call event
       d. Tool executes
       e. LeakDetector scans output
       f. AuditLogger records tool.result event
    8. Task completes; AuditLogger records task.end event
    9. SessionManager persists event stream to sessions/jobId.jsonl
    10. MemoryManager optionally extracts insights via ExtractionPipeline

### 3.2 Supporting Process: Provider Failover

    1. CircuitBreaker detects failure threshold (default: 3 failures in 60s)
    2. FailoverController.classifyError() categorizes error (rate_limit, quota, auth, timeout, transient, permanent)
    3. If retryable: RetryQueue schedules retry with exponential backoff
    4. If provider exhausted: FailoverController creates HandoffBundle (conversation context)
    5. Router selects next available provider by rank and capability
    6. ExecutionLoop resumes with handoff bundle injected into new context
    7. AuditLogger records failover event

### 3.3 Supporting Process: Scheduled Routine

    1. RoutineManager loads routine definition from ~/.zora/routines/<name>.toml
    2. node-cron schedules task based on cron expression
    3. At trigger time: RoutineManager calls Orchestrator.submitTask()
    4. Task follows core execution process (steps 3-10 above)
    5. HeartbeatSystem confirms routine health

---

## 4. Information Model

### 4.1 Key Business Entities

| Entity | Description | Storage Location |
|---|---|---|
| **Task** | A user request submitted for execution | In-memory during execution; summarized in SessionManager |
| **Session** | Complete event stream for one task execution | sessions/jobId.jsonl (JSONL, one event per line) |
| **AuditEntry** | Tamper-evident record of one event | audit/audit.jsonl (SHA-256 hash chain) |
| **MemoryItem** | A structured persistent memory record | memory/items/ (JSON files) |
| **ZoraConfig** | Agent configuration (providers, routing, memory) | config.toml |
| **ZoraPolicy** | Security policy (paths, commands, budgets) | policy.toml |
| **IntentCapsule** | HMAC-signed mandate for drift detection | In-memory per task; referenced in audit entries |
| **HandoffBundle** | Provider transition context bundle | In-memory during failover |
| **RoutineDefinition** | Scheduled task specification | routines/<name>.toml |
| **TeamConfig** | Multi-agent team definition | teams/<name>/config.json |

---

## 5. Organization Model

### 5.1 Deployment Roles

| Role | Responsibilities | Zora Interface |
|---|---|---|
| **Agent Operator** | Installs, configures, and monitors Zora | CLI (zora-agent init, start, status, audit), Dashboard |
| **End User** | Submits tasks, reviews results, steers in-flight | CLI, Dashboard, Telegram |
| **Security Administrator** | Defines policy, reviews audit logs, manages capability tokens | policy.toml, zora-agent audit, zora-agent security |
| **Integration Engineer** | Adds MCP servers, custom tools, hooks, routines | config.toml, routine .toml files, hook scripts |
| **Compliance Officer** | Reviews audit exports, verifies chain integrity | zora-agent audit --verify, SIEM integration |

---

## 6. Constraints and Assumptions

| Item | Detail |
|---|---|
| CPNI compliance | Call center deployments must treat customer account details as CPNI. PolicyEngine shell allowlists and LeakDetector patterns must be tuned to prevent CPNI exposure in LLM prompts. |
| Data sovereignty | All task data and memory stays on the operator machine. LLM API calls send only the prompt text and tool results, not raw file contents unless the task requires it. |
| User consent | The operator who installs Zora is responsible for ensuring end users consent to AI-assisted interactions. |
| Model hallucination | Zora does not validate LLM outputs for factual accuracy. Tool results are grounded in actual filesystem/shell execution, but textual summaries may be inaccurate. |
