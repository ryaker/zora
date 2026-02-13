import { describe, it, expect } from 'vitest';
import { loadConfigFromString, toSdkMcpServers } from '../../../src/config/loader.js';

describe('MCP Config', () => {
  it('parses [mcp.servers.*] from TOML', () => {
    const toml = `
[agent]
name = "test"
workspace = "~/.zora/workspace"
max_parallel_jobs = 1
default_timeout = "1h"
heartbeat_interval = "30m"
log_level = "info"

[agent.identity]
soul_file = "~/.zora/SOUL.md"

[agent.resources]
cpu_throttle_percent = 80
memory_limit_mb = 4096
throttle_check_interval = "10s"

[mcp.servers.nanobanana]
type = "http"
url = "https://mcp.yaker.org/nanobanana/mcp"

[mcp.servers.github]
type = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
`;

    const config = loadConfigFromString(toml);
    expect(config.mcp).toBeDefined();
    expect(config.mcp!.servers['nanobanana']).toEqual({
      type: 'http',
      url: 'https://mcp.yaker.org/nanobanana/mcp',
    });
    expect(config.mcp!.servers['github']).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    });
  });

  it('defaults to empty servers when no MCP config', () => {
    const toml = `
[agent]
name = "test"
workspace = "~/.zora/workspace"
max_parallel_jobs = 1
default_timeout = "1h"
heartbeat_interval = "30m"
log_level = "info"

[agent.identity]
soul_file = "~/.zora/SOUL.md"

[agent.resources]
cpu_throttle_percent = 80
memory_limit_mb = 4096
throttle_check_interval = "10s"
`;

    const config = loadConfigFromString(toml);
    expect(config.mcp).toBeDefined();
    expect(config.mcp!.servers).toEqual({});
  });
});

describe('toSdkMcpServers', () => {
  it('converts HTTP servers', () => {
    const result = toSdkMcpServers({
      'test-api': { type: 'http', url: 'https://api.example.com/mcp' },
    });
    expect(result['test-api']).toEqual({
      type: 'http',
      url: 'https://api.example.com/mcp',
    });
  });

  it('converts SSE servers with headers', () => {
    const result = toSdkMcpServers({
      'test-sse': {
        type: 'sse',
        url: 'https://api.example.com/sse',
        headers: { 'Authorization': 'Bearer token' },
      },
    });
    expect(result['test-sse']).toEqual({
      type: 'sse',
      url: 'https://api.example.com/sse',
      headers: { 'Authorization': 'Bearer token' },
    });
  });

  it('converts stdio servers', () => {
    const result = toSdkMcpServers({
      'github': {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { 'GITHUB_TOKEN': 'test' },
      },
    });
    expect(result['github']).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { 'GITHUB_TOKEN': 'test' },
    });
  });

  it('defaults to stdio when command is present without type', () => {
    const result = toSdkMcpServers({
      'local': { command: 'node', args: ['server.js'] },
    });
    expect(result['local']).toEqual({
      command: 'node',
      args: ['server.js'],
    });
  });

  it('handles empty servers', () => {
    expect(toSdkMcpServers({})).toEqual({});
  });
});
