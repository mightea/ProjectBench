/**
 * Bridges a stdio MCP client (Claude Desktop, Claude Code) to the ProjectBench HTTP endpoint.
 * It never opens the SQLite file, so the server stays the only writer.
 * stdout carries the protocol, so all diagnostics go to stderr.
 */
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isJSONRPCRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

const baseUrl = process.env.PROJECTBENCH_URL;
const token = process.env.PROJECTBENCH_TOKEN;
if (!baseUrl || !token) {
  console.error('Set PROJECTBENCH_URL (for example https://projectbench.example.com) and PROJECTBENCH_TOKEN.');
  process.exit(1);
}

const endpoint = new URL('mcp', baseUrl.replace(/\/(mcp\/?)?$/, '') + '/');
const remote = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const local = new StdioServerTransport();

/** Requests must get an answer, or the client waits until it times out. */
async function forward(message: JSONRPCMessage) {
  try {
    await remote.send(message);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`ProjectBench request failed: ${detail}`);
    if (isJSONRPCRequest(message)) {
      await local.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: `Could not reach ProjectBench: ${detail}` },
      });
    }
  }
}

local.onmessage = (message) => void forward(message);
remote.onmessage = (message) => {
  const result = (message as { result?: { protocolVersion?: unknown } }).result;
  if (typeof result?.protocolVersion === 'string') remote.setProtocolVersion(result.protocolVersion);
  void local.send(message);
};
remote.onerror = (err) => console.error(`ProjectBench connection: ${err.message}`);

const shutdown = async () => {
  await Promise.allSettled([remote.close(), local.close()]);
  process.exit(0);
};
local.onclose = () => void shutdown();
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await remote.start();
await local.start();
