#!/usr/bin/env node
// Ollama model bake-off (#236): tool-use, long-context recall, latency, tokens.
// Usage: OLLAMA_URL=http://localhost:11434 node scripts/bakeoff/ollama-bakeoff.mjs model1 model2 ...
// Talks to the Ollama REST API only; no credentials are read or printed.
const URL_ = (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const REPEATS = Number(process.env.BAKEOFF_REPEATS ?? 3);
const models = process.argv.slice(2);
if (models.length === 0) { console.error('usage: ollama-bakeoff.mjs <model>...'); process.exit(2); }

const chat = async (model, body) => {
  const t0 = Date.now();
  const r = await fetch(`${URL_}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false, options: { temperature: 0 }, ...body }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return { j, ms: Date.now() - t0 };
};

const tools = [
  { type: 'function', function: { name: 'read_file', description: 'Read a text file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'memory_search', description: 'Search saved memories', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'send_message', description: 'Send a chat message', parameters: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'] } } },
];
const toolCases = [
  ['Open the file /etc/hostname and tell me what is in it.', 'read_file', a => a.path === '/etc/hostname'],
  ['What did we decide about the retry policy last week? Check my memories.', 'memory_search', a => /retry/i.test(a.query ?? '')],
  ['Tell the reviewer that PR 12 is ready.', 'send_message', a => /review/i.test(a.to ?? '') && /12/.test(a.text ?? '')],
  ['What is 17 * 3? Answer directly, no tools needed.', null, () => true],
];

const NEEDLE = 'The deploy passphrase codename is BLUE-HERON-4417.';
const filler = n => Array.from({ length: n }, (_, i) =>
  `Log line ${i}: service alpha handled request ${i * 7} in ${(i % 13) + 2}ms with status ok.`).join('\n');
const longCase = lines => {
  const all = filler(lines).split('\n'); all.splice(Math.floor(all.length * 0.4), 0, NEEDLE);
  return `${all.join('\n')}\n\nQuestion: what is the deploy passphrase codename? Answer with the codename only.`;
};

const results = [];
for (const model of models) {
  const row = { model, tool_ok: 0, tool_total: 0, long_ok: {}, ms: [], out_tokens: 0, errors: 0, tool_misses: [] };
  for (let rep = 0; rep < REPEATS; rep++) {
    for (const [prompt, want, check] of toolCases) {
      try {
        const { j, ms } = await chat(model, { messages: [{ role: 'user', content: prompt }], tools });
        row.tool_total++; // only answered calls count; errors are tallied separately
        row.ms.push(ms); row.out_tokens += j.eval_count ?? 0;
        const call = j.message?.tool_calls?.[0]?.function;
        const ok = want === null ? !call : call?.name === want && check(call.arguments ?? {});
        if (ok) row.tool_ok++;
        else row.tool_misses.push({ prompt, called: call ? { name: call.name, arguments: call.arguments } : null });
      } catch { row.errors++; } // errors are reported separately; a failed call is NOT counted as a tool miss
    }
  }
  for (const lines of [200, 1500]) {
    let ok = 0;
    for (let rep = 0; rep < REPEATS; rep++) {
      try {
        const { j, ms } = await chat(model, { messages: [{ role: 'user', content: longCase(lines) }], options: { temperature: 0, num_ctx: 32768 } });
        row.ms.push(ms); row.out_tokens += j.eval_count ?? 0;
        if ((j.message?.content ?? '').includes('BLUE-HERON-4417')) ok++;
      } catch { row.errors++; }
    }
    row.long_ok[`${lines} lines`] = `${ok}/${REPEATS}`;
  }
  row.ms.sort((a, b) => a - b);
  results.push({ ...row, p50_ms: row.ms[Math.floor(row.ms.length / 2)] ?? null, ms: undefined });
  console.error(`done ${model}`);
}
console.log(JSON.stringify(results, null, 2));
