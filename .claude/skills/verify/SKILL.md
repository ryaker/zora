---
name: verify
description: Boots Zora in a throwaway home directory and exercises a change end to end (CLI ask, daemon, dashboard health) without touching the real ~/.zora. Use before reporting that a runtime change works, when reviewing a PR that changes CLI, daemon, provider, channel or orchestrator behavior, or when asked to run or smoke-test Zora.
---

# Verify a Zora change

Unit tests prove functions; this proves Zora boots and answers. Run it for any change to
runtime behavior. Report the exact commands you ran and what they printed. Do not report
success without them.

## Rules

- **Never use the real `~/.zora`.** Zora reads `policy.toml` and writes sessions under
  `os.homedir()/.zora` even when `ZORA_CONFIG_DIR` is set, so every step below sets `HOME`
  to a temp directory. On Richard's machines the real `~/.zora` holds live config, memory
  and the audit log.
- Use the EchoProvider fixtures. They need no API keys and cost nothing. Use a real
  provider only when the change is about that provider, and say so.
- Unset `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` when running Zora from inside a Claude
  Code session, or the Claude SDK provider can conflict with the parent session.

## 1. Build

```bash
npm ci --ignore-scripts      # only if node_modules is missing or package-lock.json changed
npm run build:backend        # tsc → dist/
npm run lint                 # tsc --noEmit
```

Use `npm run build` instead when the change touches `src/dashboard/frontend/`.

## 2. Throwaway home

```bash
export ZT=$(mktemp -d)
mkdir -p "$ZT/.zora"
cp tests/fixtures/e2e-config.toml "$ZT/.zora/config.toml"
cp tests/fixtures/e2e-policy.toml "$ZT/.zora/policy.toml"
chmod 700 "$ZT/.zora"; chmod 600 "$ZT/.zora/"*.toml   # the daemon refuses looser modes
zenv() { env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT HOME="$ZT" ZORA_CONFIG_DIR="$ZT/.zora" "$@"; }
```

## 3. One task through the CLI

```bash
(cd "$ZT" && zenv node "$OLDPWD/dist/cli/index.js" ask "Say hello")
```

Pass: stdout contains `Echo: Say hello`, a log line says the job `finished successfully`,
and the exit code is 0. This goes through the Orchestrator, router, policy engine and hook
chain, so a wiring break shows up here even when unit tests pass.

## 4. Daemon and dashboard

```bash
zenv ZORA_PROJECT_DIR="$PWD" node dist/cli/daemon.js > "$ZT/daemon.log" 2>&1 &
ZPID=$!
for i in $(seq 1 30); do curl -sf localhost:8070/api/health >/dev/null && break; sleep 1; done
curl -s localhost:8070/api/health      # expect "ok":true and both echo providers "status":"OK"
zenv node dist/cli/index.js status     # expect 2 providers registered
kill $ZPID
```

Running `dist/cli/daemon.js` in the foreground, rather than `zora-agent start`, keeps its
logs: `start` forks with `stdio: 'ignore'`, so a crash there is silent. If health never
answers, read `$ZT/daemon.log` for `level` 50 and 60 lines. `Daemon startup blocked:
security audit` means file modes, not a code bug. Expected warnings that are not failures:
`ZORA_MASTER_PASSWORD not set`, `Dashboard API authentication disabled`, `AgentBus
unreachable`.

Port 8070 must be free. If another Zora is running there, stop and say so rather than
killing it.

## 5. The change itself

Exercise the path the PR changed, in the same throwaway home:

| Change touches | Also run |
|---|---|
| `src/cli/**` | the changed command with `zenv node dist/cli/index.js <command> --help` and one real invocation |
| `src/cli/init-command.ts` | in a second throwaway home, `HOME=<it> node dist/cli/index.js init -y --force` (add `--primary` / `--preset` as changed) and read the generated `config.toml` and `policy.toml`; init picks a real provider, so do not run step 3 on that home unless the provider is available |
| `src/providers/**` | `npx vitest run tests/unit/providers`; for Ollama, step 3 with an `ollama` provider block only if Ollama is reachable, else say it was not run |
| `src/channels/**` | `npx vitest run tests/unit/channels`; Slack, Signal and Telegram cannot be exercised without real tokens, so say so |
| `src/security/**`, `src/hooks/**` | `npx vitest run tests/security` and `bash scripts/security-audit.sh` |
| `src/dashboard/**` | step 4, plus `npm run test:browser` for frontend changes |
| anything else | `npx vitest run <the matching tests/unit/<area>>` |

Before handing off, run the E2E scenarios once, in a fresh throwaway home (the harness
copies its policy into `~/.zora` if none exists, and a home that `init` wrote a `SOUL.md`
into trips Scenario 6's leak check):

```bash
HOME="$(mktemp -d)" npm run test:e2e     # expect 7 passed
```

## 6. Report

Say in the PR or review comment, in a few lines:

- the commands run and their result (pass, fail, or not run and why);
- anything you could not exercise (real tokens, a provider that is not installed);
- a flaky result, with how many times you ran it.

Then `rm -rf "$ZT"`.

## Red flags

- "Tests pass" with no command shown.
- A step skipped because it "obviously" works.
- Running against the real `~/.zora`, or with a real provider when Echo would do.
