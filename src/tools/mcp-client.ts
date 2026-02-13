/**
 * McpClient — Self-contained MCP client for tool discovery and invocation.
 *
 * This is a lightweight client structured so the real @modelcontextprotocol/sdk
 * can be swapped in later. All interfaces are defined locally to avoid external
 * dependencies.
 */

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpClientOptions {
  serverUrl: string;
  serverName: string;
}

export class McpClient {
  private readonly _serverUrl: string;
  private readonly _serverName: string;
  private _connected = false;

  constructor(options: McpClientOptions) {
    this._serverUrl = options.serverUrl;
    this._serverName = options.serverName;
  }

  /**
   * Establishes a connection to the MCP server.
   * Stub implementation — will be replaced with real SDK transport.
   */
  async connect(): Promise<void> {
    // In a real implementation, this would use the MCP SDK's
    // StdioClientTransport or StreamableHTTPClientTransport.
    this._connected = true;
  }

  /**
   * Lists available tools from the connected MCP server.
   */
  async listTools(): Promise<McpToolInfo[]> {
    this._ensureConnected();

    // Stub: In production, this calls client.listTools() via the SDK.
    // Returns empty array until the real SDK is integrated.
    return [];
  }

  /**
   * Calls a tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this._ensureConnected();

    // Stub: In production, this calls client.callTool({ name, arguments: args })
    // via the SDK. Returns null until the real SDK is integrated.
    void name;
    void args;
    return null;
  }

  /**
   * Disconnects from the MCP server.
   */
  async disconnect(): Promise<void> {
    this._connected = false;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get serverName(): string {
    return this._serverName;
  }

  get serverUrl(): string {
    return this._serverUrl;
  }

  private _ensureConnected(): void {
    if (!this._connected) {
      throw new Error(`McpClient is not connected to "${this._serverName}"`);
    }
  }
}
