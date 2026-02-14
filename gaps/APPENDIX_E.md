# APPENDIX E: Test Coverage Roadmap

## Purpose

This appendix provides detailed test scenarios for each of the 7 TEST-* gaps. For each gap, we define:
- **Test scenarios:** Concrete, executable test cases
- **Fixtures:** Mock objects and test data setup
- **Exit criteria:** Conditions for marking a gap resolved
- **Effort:** Time to implement all scenarios

---

## TEST-01: Orchestration E2E Integration Tests

**Severity:** S2 | **Effort:** 4h | **Blocking:** Y

### Overview

No integration tests exist for the main orchestration flow. Users could boot the Orchestrator, submit tasks, and have them mysteriously fail without any test warning. E2E tests verify that all components wire together and the main flow works end-to-end.

### Scenario 1: Boot Orchestrator → Submit Task → Verify Routing to Correct Provider

**Test:** `orchestrator.boot() → submitTask(simple_task) → verify Ollama called`

```typescript
describe('Orchestrator E2E', () => {
  let orchestrator: Orchestrator;
  let mockOllama: jest.Mocked<LLMProvider>;
  let mockClaude: jest.Mocked<LLMProvider>;

  beforeEach(async () => {
    mockOllama = createMockProvider('ollama');
    mockClaude = createMockProvider('claude');

    const config = {
      providers: {
        ollama: { type: 'ollama', endpoint: 'http://localhost:11434' },
        claude: { type: 'claude', apiKey: 'sk-...' },
      },
      executionMode: 'classification',
    };

    orchestrator = new Orchestrator(config);
    orchestrator.router.setMockProviders([mockOllama, mockClaude]);

    await orchestrator.boot();
  });

  afterEach(async () => {
    await orchestrator.shutdown();
  });

  it('should boot without errors', async () => {
    // Orchestrator is already booted in beforeEach
    // If boot() threw, we wouldn't reach here
    expect(orchestrator).toBeDefined();
  });

  it('should route simple task to Ollama and receive result', async () => {
    const task: Task = {
      id: 'task-1',
      prompt: 'What is 2 + 2?', // Simple task
      description: 'simple_arithmetic',
    };

    const mockResult: TaskResult = {
      taskId: 'task-1',
      output: '4',
      tokensUsed: 15,
      provider: 'ollama',
    };

    mockOllama.execute.mockResolvedValue(mockResult);

    const result = await orchestrator.submitTask(task);

    expect(result.output).toBe('4');
    expect(mockOllama.execute).toHaveBeenCalledWith(task);
    expect(mockClaude.execute).not.toHaveBeenCalled();
  });

  it('should route complex task to Claude and receive result', async () => {
    const task: Task = {
      id: 'task-2',
      prompt: 'Design a microservices architecture for real-time analytics',
      description: 'complex_design',
    };

    const mockResult: TaskResult = {
      taskId: 'task-2',
      output: 'Architecture: ...',
      tokensUsed: 2500,
      provider: 'claude',
    };

    mockClaude.execute.mockResolvedValue(mockResult);

    const result = await orchestrator.submitTask(task);

    expect(result.output).toContain('Architecture');
    expect(mockClaude.execute).toHaveBeenCalledWith(task);
    expect(mockOllama.execute).not.toHaveBeenCalled();
  });
});
```

**Exit Criteria:**
- [ ] Boot completes without errors
- [ ] Simple task routed to Ollama and completes
- [ ] Complex task routed to Claude and completes
- [ ] Routing decision is correct based on task characteristics

---

### Scenario 2: Router Classification Accuracy

**Test:** `verify task type → provider capability match`

```typescript
describe('Router Classification', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router({
      providers: [
        { type: 'claude', capabilities: ['complex_reasoning', 'code_generation'] },
        { type: 'ollama', capabilities: ['simple_qa', 'summarization'] },
        { type: 'gemini', capabilities: ['multi_language', 'vision'] },
      ],
      mode: 'classification',
    });
  });

  it('should select Ollama for simple QA tasks', () => {
    const task: Task = {
      id: '1',
      prompt: 'What is Python?',
      description: 'simple_qa',
      tokenCount: 50,
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('ollama');
  });

  it('should select Claude for code generation', () => {
    const task: Task = {
      id: '2',
      prompt: 'Write a function to compute fibonacci numbers',
      description: 'code_generation',
      tokenCount: 200,
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('claude');
  });

  it('should select Gemini for multi-language tasks', () => {
    const task: Task = {
      id: '3',
      prompt: 'Translate "hello" to Japanese and Spanish',
      description: 'multi_language',
      tokenCount: 80,
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('gemini');
  });

  it('should prefer user hint over classification', () => {
    const task: Task = {
      id: '4',
      prompt: 'What is 2 + 2?',
      description: 'simple_arithmetic',
      tokenCount: 40,
      preferredProvider: 'claude', // User hint
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('claude'); // Honors hint despite simplicity
  });

  it('should handle multi-factor classification correctly', () => {
    const testCases = [
      {
        prompt: 'Analyze this code: `for x in range(10): print(x)`',
        desc: 'code_analysis',
        tokens: 150,
        expected: 'claude', // Analysis > coding, so Claude
      },
      {
        prompt: 'Print "hello"',
        desc: 'trivial_code',
        tokens: 20,
        expected: 'ollama', // Too simple, even for code
      },
      {
        prompt: 'Summarize this 5000-word article',
        desc: 'summarization',
        tokens: 2000,
        expected: 'claude', // Large token count requires Claude
      },
    ];

    for (const tc of testCases) {
      const provider = router.selectProvider({
        id: '1',
        prompt: tc.prompt,
        description: tc.desc,
        tokenCount: tc.tokens,
      });
      expect(provider.type).toBe(tc.expected);
    }
  });
});
```

**Exit Criteria:**
- [ ] Simple QA tasks route to Ollama
- [ ] Complex tasks route to Claude
- [ ] Multi-language tasks route to Gemini
- [ ] User hints are honored when specified
- [ ] Multi-factor classification is accurate for edge cases

---

### Scenario 3: Session Persistence (Task History Saved to JSONL)

**Test:** `execute task → verify event appended to session file`

```typescript
describe('Session Persistence', () => {
  let orchestrator: Orchestrator;
  let sessionFile: string;

  beforeEach(async () => {
    sessionFile = '/tmp/test-session.jsonl';
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);

    orchestrator = new Orchestrator({
      sessionStoragePath: sessionFile,
    });
    await orchestrator.boot();
  });

  it('should persist task_started event to JSONL', async () => {
    const task: Task = { id: 'task-1', prompt: 'Hello' };

    const promise = orchestrator.submitTask(task);

    // Give time for event to be persisted
    await new Promise(r => setTimeout(r, 100));

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task_started',
        taskId: 'task-1',
      })
    );
  });

  it('should persist task_completed event with result', async () => {
    const task: Task = { id: 'task-2', prompt: 'What is 2+2?' };

    const result = await orchestrator.submitTask(task);

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task_completed',
        taskId: 'task-2',
        result: expect.objectContaining({
          output: expect.any(String),
        }),
      })
    );
  });

  it('should persist provider_switched event on failover', async () => {
    // Setup mock to fail then succeed
    mockOllama.execute.mockRejectedValueOnce(new Error('Rate limited'));
    mockClaude.execute.mockResolvedValueOnce({ output: 'Success' });

    const task: Task = { id: 'task-3', prompt: 'Test' };
    await orchestrator.submitTask(task);

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    const switchEvent = events.find(e => e.type === 'provider_switched');
    expect(switchEvent).toBeDefined();
    expect(switchEvent.from).toBe('ollama');
    expect(switchEvent.to).toBe('claude');
    expect(switchEvent.reason).toContain('Rate limited');
  });

  it('should maintain event order and timestamps', async () => {
    const tasks = [
      { id: 'task-a', prompt: 'A' },
      { id: 'task-b', prompt: 'B' },
      { id: 'task-c', prompt: 'C' },
    ];

    for (const task of tasks) {
      await orchestrator.submitTask(task);
    }

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    // Timestamps should be non-decreasing
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  });
});
```

**Exit Criteria:**
- [ ] task_started event persisted immediately after submission
- [ ] task_completed event includes result
- [ ] provider_switched event logged with reason
- [ ] All events in JSONL format, one per line
- [ ] Event ordering is preserved with timestamps

---

### Test Fixtures

```typescript
// Mock provider factory
function createMockProvider(type: 'claude' | 'ollama' | 'gemini'): jest.Mocked<LLMProvider> {
  return {
    type,
    execute: jest.fn(),
    checkAuth: jest.fn().mockResolvedValue(true),
    close: jest.fn(),
  };
}

// Test task generator
function createTestTask(overrides?: Partial<Task>): Task {
  return {
    id: `task-${Date.now()}`,
    prompt: 'Test prompt',
    ...overrides,
  };
}

// Session file cleanup helper
afterEach(() => {
  if (fs.existsSync('/tmp/test-session.jsonl')) {
    fs.unlinkSync('/tmp/test-session.jsonl');
  }
});
```

---

## TEST-02: Failover & Retry Scenarios

**Severity:** S2 | **Effort:** 3h | **Blocking:** N

### Scenario 1: Provider Quota Exceeded → Failover to Backup

**Test:** `execute with Claude → 429 rate limit → failover to Ollama → retry succeeds`

```typescript
describe('Failover on Quota Exceeded', () => {
  let orchestrator: Orchestrator;
  let mockClaude: jest.Mocked<LLMProvider>;
  let mockOllama: jest.Mocked<LLMProvider>;

  beforeEach(async () => {
    mockClaude = createMockProvider('claude');
    mockOllama = createMockProvider('ollama');

    orchestrator = new Orchestrator({
      providers: [mockClaude, mockOllama],
      failoverMode: 'automatic',
    });
    await orchestrator.boot();
  });

  it('should failover immediately when 429 received', async () => {
    const task: Task = { id: 'task-1', prompt: 'Test' };

    // Claude returns rate limit
    mockClaude.execute.mockRejectedValueOnce(
      new Error('HTTP 429: Rate limited')
    );

    // Ollama succeeds
    mockOllama.execute.mockResolvedValueOnce({
      output: 'Success via Ollama',
      provider: 'ollama',
    });

    const startTime = Date.now();
    const result = await orchestrator.submitTask(task);
    const elapsed = Date.now() - startTime;

    expect(result.output).toContain('Success via Ollama');
    expect(result.provider).toBe('ollama');
    expect(elapsed).toBeLessThan(1000); // Failover should be fast (<1s)
  });

  it('should log failover attempt with provider and reason', async () => {
    const task: Task = { id: 'task-2', prompt: 'Test' };

    const logSpy = jest.spyOn(logger, 'warn');

    mockClaude.execute.mockRejectedValueOnce(
      new Error('HTTP 429: Rate limited')
    );
    mockOllama.execute.mockResolvedValueOnce({ output: 'OK' });

    await orchestrator.submitTask(task);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failing over'),
      expect.objectContaining({
        from: 'claude',
        to: 'ollama',
        reason: 'Rate limited',
      })
    );
  });
});
```

**Exit Criteria:**
- [ ] Failover triggered within 1 second of receiving 429
- [ ] Alternative provider attempted immediately
- [ ] Failover logged with from/to/reason
- [ ] Task succeeds on backup provider

---

### Scenario 2: Task Fails → Enqueue to Retry Queue → Re-Submit on Schedule

**Test:** `execute task → failure → enqueue → wait 5s → verify re-submitted`

```typescript
describe('Automatic Retry', () => {
  let orchestrator: Orchestrator;
  let retryQueue: RetryQueue;

  beforeEach(async () => {
    orchestrator = new Orchestrator({
      retryPolicy: {
        enabled: true,
        maxAttempts: 3,
        backoffMs: 1000,
      },
    });
    retryQueue = orchestrator.getRetryQueue();
    await orchestrator.boot();
  });

  it('should enqueue task on failure and retry after backoff', async () => {
    const task: Task = {
      id: 'task-retry',
      prompt: 'Test',
      description: 'unreliable_operation',
    };

    // First attempt fails
    let attemptCount = 0;
    mockProvider.execute.mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error('Transient failure');
      }
      return { output: 'Success on retry' };
    });

    // Submit - will fail
    const resultPromise = orchestrator.submitTask(task);

    // Wait for it to fail and be enqueued
    await new Promise(r => setTimeout(r, 100));

    const readyTasks = retryQueue.getReadyTasks();
    expect(readyTasks).toContainEqual(
      expect.objectContaining({
        taskId: 'task-retry',
        attempt: 1,
      })
    );

    // Wait for retry backoff
    await new Promise(r => setTimeout(r, 1500));

    // Verify retry was consumed and task succeeded
    const result = await resultPromise;
    expect(result.output).toContain('Success on retry');
    expect(attemptCount).toBe(2);
  });
});
```

**Exit Criteria:**
- [ ] Task enqueued after first failure
- [ ] Task re-submitted after backoff period
- [ ] Attempt counter incremented
- [ ] Task succeeds on second attempt

---

### Scenario 3: Failed Handoff Bundle Contains Execution Context

**Test:** `task fails → verify retry bundle includes context, history, metadata`

```typescript
describe('Retry Context Preservation', () => {
  it('should preserve execution context in retry bundle', async () => {
    const task: Task = {
      id: 'task-context',
      prompt: 'Analyze this data',
      context: {
        conversationId: 'conv-123',
        previousMessages: ['msg-1', 'msg-2'],
        userPreferences: { language: 'en', verbose: true },
      },
    };

    mockProvider.execute.mockRejectedValueOnce(new Error('Failed'));

    await orchestrator.submitTask(task);
    await new Promise(r => setTimeout(r, 100));

    const readyTasks = retryQueue.getReadyTasks();
    const retryTask = readyTasks[0];

    expect(retryTask.context).toEqual(task.context);
    expect(retryTask.previousMessages).toEqual(task.context.previousMessages);
    expect(retryTask.metadata).toEqual({
      originalTaskId: 'task-context',
      attempt: 1,
      failureReason: 'Failed',
      failureTime: expect.any(Number),
    });
  });
});
```

**Exit Criteria:**
- [ ] Retry bundle includes original context
- [ ] Conversation history preserved
- [ ] User preferences maintained
- [ ] Metadata includes attempt count and failure reason

---

## TEST-03: CLI Commands Functional Tests

**Severity:** S2 | **Effort:** 3h | **Blocking:** N

### Test Each Command: start, stop, status, memory, steer, skill, audit

```typescript
describe('CLI Commands', () => {
  let orchestrator: Orchestrator;
  let cliProcess: ChildProcess;

  beforeEach(async () => {
    orchestrator = new Orchestrator(testConfig);
    await orchestrator.boot();
  });

  describe('start command', () => {
    it('should start daemon and bind to port', async () => {
      cliProcess = spawn('node', ['dist/cli.js', 'start', '--port', '9999']);

      await new Promise(r => setTimeout(r, 2000)); // Wait for startup

      const response = await fetch('http://localhost:9999/health');
      expect(response.status).toBe(200);

      cliProcess.kill();
    });
  });

  describe('stop command', () => {
    it('should gracefully shutdown daemon', async () => {
      cliProcess = spawn('node', ['dist/cli.js', 'start', '--port', '9999']);
      await new Promise(r => setTimeout(r, 1000));

      const stop = spawn('node', ['dist/cli.js', 'stop', '--port', '9999']);
      await new Promise(r => stop.on('close', r));

      // Verify daemon stopped
      const response = await fetch('http://localhost:9999/health').catch(() => null);
      expect(response).toBeNull();
    });
  });

  describe('status command', () => {
    it('should report daemon status', async () => {
      const status = spawn('node', ['dist/cli.js', 'status']);

      let output = '';
      status.stdout.on('data', (d) => output += d);

      await new Promise(r => status.on('close', r));

      expect(output).toContain('Status:');
      expect(output).toMatch(/running|stopped/i);
    });
  });

  describe('memory command', () => {
    it('should report memory usage', async () => {
      const memory = spawn('node', ['dist/cli.js', 'memory']);

      let output = '';
      memory.stdout.on('data', (d) => output += d);

      await new Promise(r => memory.on('close', r));

      expect(output).toContain('Memory');
      expect(output).toMatch(/\d+\s*(KB|MB|GB)/);
    });
  });
});
```

**Exit Criteria:**
- [ ] Each command parses arguments correctly
- [ ] Commands execute without errors
- [ ] Commands return expected output/status
- [ ] Error handling for invalid arguments

---

## TEST-04: Dashboard API Endpoints

**Severity:** S2 | **Effort:** 3h | **Blocking:** N

### Test /api/jobs, /api/health, auth middleware

```typescript
describe('Dashboard API', () => {
  let server: Server;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    orchestrator = new Orchestrator(testConfig);
    await orchestrator.boot();

    server = startDashboardServer(orchestrator, { port: 9000 });
  });

  describe('GET /api/health', () => {
    it('should return system health', async () => {
      const response = await fetch('http://localhost:9000/api/health');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        status: 'healthy',
        timestamp: expect.any(Number),
        uptime: expect.any(Number),
      });
    });
  });

  describe('GET /api/jobs', () => {
    it('should return empty list when no jobs submitted', async () => {
      const response = await fetch('http://localhost:9000/api/jobs');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.jobs).toEqual([]);
    });

    it('should return submitted jobs with status', async () => {
      const task: Task = { id: 'job-1', prompt: 'Test' };
      await orchestrator.submitTask(task);

      const response = await fetch('http://localhost:9000/api/jobs');
      const data = await response.json();

      expect(data.jobs).toContainEqual(
        expect.objectContaining({
          id: 'job-1',
          status: expect.stringMatching(/completed|running/),
        })
      );
    });
  });

  describe('Auth Middleware', () => {
    it('should reject requests without token', async () => {
      const response = await fetch('http://localhost:9000/api/jobs');
      expect(response.status).toBe(401);
    });

    it('should accept requests with valid token', async () => {
      const response = await fetch('http://localhost:9000/api/jobs', {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(response.status).toBe(200);
    });
  });
});
```

**Exit Criteria:**
- [ ] /api/health returns health status
- [ ] /api/jobs returns job list with status
- [ ] Auth middleware enforces token validation
- [ ] Error responses have correct status codes

---

## TEST-05: Provider Tool Parsing

**Severity:** S2 | **Effort:** 2h | **Blocking:** N

### Collect Real Output & Test Regex Patterns

```typescript
describe('Provider Tool Parsing', () => {
  describe('Gemini CLI Tool Parsing', () => {
    it('should parse tool calls from real Gemini CLI output', () => {
      const realOutput = `
        [TOOL CALL]
        tool_name: "search"
        arguments: {"query": "what is AI", "limit": 5}
        [/TOOL CALL]
      `;

      const toolCalls = parseGeminiToolCalls(realOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        name: 'search',
        arguments: { query: 'what is AI', limit: 5 },
      });
    });

    it('should handle multiple tool calls in one response', () => {
      const realOutput = `
        [TOOL CALL]
        tool_name: "search"
        arguments: {"query": "data"}
        [/TOOL CALL]

        [TOOL CALL]
        tool_name: "fetch"
        arguments: {"url": "https://example.com"}
        [/TOOL CALL]
      `;

      const toolCalls = parseGeminiToolCalls(realOutput);
      expect(toolCalls).toHaveLength(2);
    });

    it('should validate extracted tool calls against schema', () => {
      const toolCalls = parseGeminiToolCalls(realOutput);

      for (const call of toolCalls) {
        expect(() => {
          toolCallSchema.parse(call);
        }).not.toThrow();
      }
    });
  });
});
```

**Exit Criteria:**
- [ ] Real Gemini CLI output parsed correctly
- [ ] Regex patterns extract all tool calls
- [ ] Tool calls validate against schema
- [ ] Edge cases handled (malformed JSON, missing fields)

---

## TEST-06: GeminiProvider Auth

**Severity:** S2 | **Effort:** 1h | **Blocking:** N

### Mock spawn() & Verify checkAuth()

```typescript
describe('GeminiProvider Auth', () => {
  let provider: GeminiProvider;
  let spawnSpy: jest.Mocked<typeof spawn>;

  beforeEach(() => {
    provider = new GeminiProvider({ endpoint: 'gemini' });
    spawnSpy = jest.spyOn(require('child_process'), 'spawn');
  });

  it('should detect valid authentication', async () => {
    spawnSpy.mockReturnValue({
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0); // Exit code 0 = auth OK
      }),
    });

    const isAuth = await provider.checkAuth();
    expect(isAuth).toBe(true);
  });

  it('should detect invalid/missing authentication', async () => {
    spawnSpy.mockReturnValue({
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(1); // Exit code 1 = auth failed
      }),
    });

    const isAuth = await provider.checkAuth();
    expect(isAuth).toBe(false);
  });

  it('should cache auth result to avoid repeated checks', async () => {
    await provider.checkAuth();
    await provider.checkAuth();

    expect(spawnSpy).toHaveBeenCalledTimes(1); // Called once, result cached
  });
});
```

**Exit Criteria:**
- [ ] checkAuth() detects valid tokens
- [ ] checkAuth() detects invalid tokens
- [ ] Results cached to reduce spawn() calls
- [ ] Error handling for spawn failures

---

## TEST-07: TelegramGateway User Allowlist

**Severity:** S2 | **Effort:** 2h | **Blocking:** N

### Test Allowed Users Accepted, Denied Users Blocked

```typescript
describe('TelegramGateway Allowlist', () => {
  let gateway: TelegramGateway;

  beforeEach(() => {
    gateway = new TelegramGateway({
      botToken: 'test-token',
      allowlist: ['user-1', 'user-2'],
      denylist: ['blocked-user'],
    });
  });

  it('should accept messages from allowed users', async () => {
    const message = {
      userId: 'user-1',
      text: 'Hello',
    };

    const isAllowed = gateway.isUserAllowed(message.userId);
    expect(isAllowed).toBe(true);
  });

  it('should block messages from denied users', async () => {
    const message = {
      userId: 'blocked-user',
      text: 'Hello',
    };

    const isAllowed = gateway.isUserAllowed(message.userId);
    expect(isAllowed).toBe(false);
  });

  it('should block messages from users not in allowlist when strict', () => {
    const gateway = new TelegramGateway({
      botToken: 'test-token',
      allowlist: ['user-1'],
      strictMode: true, // Only allowlist allowed
    });

    expect(gateway.isUserAllowed('user-1')).toBe(true);
    expect(gateway.isUserAllowed('user-3')).toBe(false);
  });

  it('should log security events for denied access', () => {
    const logSpy = jest.spyOn(logger, 'warn');

    gateway.isUserAllowed('blocked-user');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Access denied'),
      expect.objectContaining({
        userId: 'blocked-user',
        reason: 'blocklist',
      })
    );
  });
});
```

**Exit Criteria:**
- [ ] Allowed users accepted
- [ ] Denied users blocked
- [ ] Allowlist/denylist logic correct
- [ ] Security events logged
- [ ] No false positives/negatives

---

### Test Coverage Summary

| Gap ID | Test Scenarios | Fixtures | Exit Criteria | Effort |
|--------|----------------|----------|---------------|--------|
| TEST-01 | 3 (boot, routing, persistence) | Mock providers | All scenarios pass, 100% routing coverage | 4h |
| TEST-02 | 3 (failover, retry, context) | Retry queue, mock provider | <1s failover, retry consumed within 5min | 3h |
| TEST-03 | 7 (CLI commands) | CLI spawn, process mgmt | All commands parse/execute correctly | 3h |
| TEST-04 | 3 (health, jobs, auth) | HTTP server, mock orchestrator | All endpoints return correct schemas | 3h |
| TEST-05 | 3 (tool parsing) | Real Gemini CLI output | Regex patterns match all cases | 2h |
| TEST-06 | 3 (checkAuth coverage) | Mocked spawn() | Auth detection accurate | 1h |
| TEST-07 | 4 (allowlist logic) | Security event logging | Allowlist/deny logic correct | 2h |

**Cumulative Effort:** 21 hours
**Impact:** 100% test coverage for critical paths; production confidence

---


---

