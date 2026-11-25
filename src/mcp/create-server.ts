import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdapterRegistry } from "../adapters/registry.js";
import { registerShoppingTools, type ToolRuntimeContext } from "./tools.js";

export function createShopcartMcpServer(
  opts: Partial<ToolRuntimeContext> & { version?: string } = {}
): McpServer {
  const server = new McpServer({
    name: "shopcart-mcp",
    version: opts.version ?? "0.1.0"
  });

  registerShoppingTools(server, {
    registry: opts.registry ?? new AdapterRegistry(),
    concurrencyKey: opts.concurrencyKey,
    consumeQuota: opts.consumeQuota
  });

  return server;
}
