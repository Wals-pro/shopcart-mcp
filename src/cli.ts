#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runCli } from "./cli/oneshot.js";
import { createShopcartMcpServer } from "./mcp/create-server.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const exitCode = await runCli(args);
    process.exitCode = exitCode;
    return;
  }

  const server = createShopcartMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[shopcart-mcp] Fatal error:", err);
  process.exit(1);
});
