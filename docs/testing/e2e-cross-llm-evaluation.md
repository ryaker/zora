# E2E Cross-LLM Evaluation Pattern

## Overview

The cross-LLM evaluation pattern uses two separate provider calls to catch output quality issues that a single-provider test cannot detect. A **generator** produces output; an **evaluator** checks it. The evaluator can be a different model or provider, enabling independent verification.

## How It Works

1. **Generator step**: Submit a task to the primary provider (e.g., Claude or EchoProvider).
2. **Capture output**: Record the generator's response text.
3. **Evaluator step**: Submit `"evaluate: <generator output>"` to the evaluator provider (e.g., Gemini or EchoProvider).
4. **Assert on evaluator response**: The evaluator response should contain `"EVALUATION:"` and indicate success or flag issues.

## Example (from scenario-harness.test.ts, Scenario 5)

```typescript
// Step 1: Generate
const genResult = spawnAsk('Write a function to add two numbers', { configDir, cwd });
const generatedText = genResult.stdout.trim();

// Step 2: Evaluate
const evalResult = spawnAsk(`evaluate: ${generatedText}`, { configDir, cwd });
expect(evalResult.stdout).toContain('EVALUATION:');
```

## EchoProvider Behavior

In CI (no API keys), both steps use EchoProvider:
- Generator receives `"write"` keyword → returns a minimal code snippet.
- Evaluator receives `"evaluate:"` prefix → returns `"EVALUATION: [provider:echo] Task appears correct. No issues found."`.

This validates the wiring (two separate CLI invocations, two session files written) without requiring real LLMs.

## Real Provider Configuration

When `ZORA_REAL_PROVIDERS=1` is set and real API keys are available, use `tests/fixtures/e2e-config-real.toml.example` as a template:

```bash
cp tests/fixtures/e2e-config-real.toml.example tests/fixtures/e2e-config-real.toml
# Edit to set real provider credentials/models
ZORA_E2E=1 ZORA_REAL_PROVIDERS=1 npm run test:e2e:real
```

## CI vs Local Development

| Mode | Config | Providers | API Keys |
|------|--------|-----------|----------|
| CI (`ZORA_E2E=1`) | `e2e-config.toml` | EchoProvider | None needed |
| Local real (`ZORA_E2E=1 ZORA_REAL_PROVIDERS=1`) | `e2e-config-real.toml` | Claude + Gemini | Required |

## Why Two Session Files?

Each `zora-agent ask` invocation writes its own JSONL session file. Scenario 5 asserts that at least two session files are created — one for the generation step and one for the evaluation step. This confirms that both CLI invocations completed their full boot-and-shutdown cycle, not just that the output strings matched.

## Extending the Pattern

To add a new evaluation scenario:
1. Choose a generator prompt (triggers specific EchoProvider response rule).
2. Prefix the evaluator prompt with `"evaluate:"`.
3. Assert both session files exist and the evaluator response contains `"EVALUATION:"`.
4. For real providers: assert the evaluator response contains no hallucination markers (domain-specific checks).
