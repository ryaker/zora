import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebTools } from '../../../src/tools/web.js';

describe('WebTools', () => {
  let tools: WebTools;

  beforeEach(() => {
    tools = new WebTools();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches content from a URL', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>Success</body></html>',
    } as any);

    const result = await tools.fetch('https://example.com');
    expect(result.success).toBe(true);
    expect(result.content).toContain('Success');
  });

  it('handles HTTP error status', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const result = await tools.fetch('https://example.com/notfound');
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
  });

  it('handles network exceptions', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Connection timeout'));

    const result = await tools.fetch('https://example.com');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection timeout');
  });
});
