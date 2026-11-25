#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createShopcartMcpServer } from "./mcp/create-server.js";

async function main() {
  const server = createShopcartMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[shopcart-mcp] Fatal stdio error:", err);
  process.exit(1);
});
