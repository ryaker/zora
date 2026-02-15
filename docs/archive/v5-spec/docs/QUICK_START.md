# Zora v0.5 - Quick Start

Draft quick start for v0.5. Commands and CLI names may change as implementation lands.

## 1) Install

```bash
git clone https://github.com/your-org/zora.git
cd zora
pnpm install
```

## 2) Verify system

```bash
pnpm zora doctor
```

## 3) Initialize (safe defaults)

```bash
pnpm zora init
```

Recommended first-run answers:
- Workspace: `~/.zora`
- Read: `~/Projects`
- Write: `~/Projects`
- Web fetch: `yes`
- Shell allowlist: `yes`

## 4) Start the agent

```bash
pnpm zora start
pnpm zora status
```

## 5) First task (safe)

```bash
pnpm zora ask "List repos in ~/Projects and summarize the most recent commit in each"
```

## 6) Later: expand policy deliberately

```bash
pnpm zora policy edit
```

See `docs_v5/SECURITY_DEFAULTS.md` for recommended policy changes.
