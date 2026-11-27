import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCPB_PATH = path.join(ROOT_DIR, "public", "downloads", "shopcart-mcp.mcpb");

const EXPECTED_TOOLS = [
  "discover_stores",
  "inspect_store",
  "list_collections",
  "search_products",
  "get_product",
  "get_store_policies",
  "find_store_discounts",
  "create_cart_link",
  "compare_prices",
  "find_hot_deals",
  "match_visual_product",
  "search_secondhand_marketplaces"
];

/**
 * Minimal pure-Node ZIP extractor for validating the generated .mcpb archive
 * without relying on an external unzip binary.
 */
function readZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  // Locate End of Central Directory (PK\x05\x06)
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65557); i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: EOCD record not found");
  }

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, Buffer>();
  let cursor = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    expect(zipBuf.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = zipBuf.readUInt16LE(cursor + 10);
    const expectedCrc = zipBuf.readUInt32LE(cursor + 16);
    const compressedSize = zipBuf.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuf.readUInt32LE(cursor + 24);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);

    const name = zipBuf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

    expect(zipBuf.readUInt32LE(localHeaderOffset)).toBe(0x04034b50);
    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = zipBuf.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressedData);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }

    expect(data.length).toBe(uncompressedSize);
    expect(zlib.crc32(data) >>> 0).toBe(expectedCrc);
    entries.set(name, data);
  }

  return entries;
}

describe("Claude Desktop 1-click Extension (.mcpb)", () => {
  it("packages a valid ZIP archive with MCPB v0.3 manifest, icon, LICENSE, and self-contained server bundle", () => {
    expect(fs.existsSync(MCPB_PATH)).toBe(true);
    const zipBuf = fs.readFileSync(MCPB_PATH);

    // ZIP Local File Header magic bytes PK\x03\x04
    expect(zipBuf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const entries = readZipEntries(zipBuf);
    expect(Array.from(entries.keys()).sort()).toEqual([
      "LICENSE",
      "icon.png",
      "manifest.json",
      "server/index.mjs"
    ]);

    // PNG signature check on icon.png
    const iconBuf = entries.get("icon.png")!;
    expect(iconBuf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );

    // LICENSE is non-empty MIT license
    expect(entries.get("LICENSE")!.toString("utf8")).toContain("MIT License");

    // Validate manifest.json against MCPB v0.3 specification
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));

    const allowedTopLevelKeys = new Set([
      "$schema",
      "dxt_version",
      "manifest_version",
      "name",
      "display_name",
      "version",
      "description",
      "long_description",
      "author",
      "repository",
      "homepage",
      "documentation",
      "support",
      "icon",
      "icons",
      "screenshots",
      "localization",
      "server",
      "tools",
      "tools_generated",
      "prompts",
      "prompts_generated",
      "keywords",
      "license",
      "privacy_policies",
      "compatibility",
      "user_config",
      "_meta"
    ]);
    for (const key of Object.keys(manifest)) {
      expect(allowedTopLevelKeys.has(key)).toBe(true);
    }

    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.name).toBe("shopcart-mcp");
    expect(manifest.display_name).toBe("ShopCart MCP");
    expect(manifest.version).toBe(pkg.version);
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(10);
    expect(manifest.author).toEqual({
      name: "wals.pro",
      email: "support@wals.pro",
      url: "https://wals.pro"
    });
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/Wals-pro/shopcart-mcp.git"
    });
    expect(manifest.homepage).toBe("https://shopcart.wals.pro");
    expect(manifest.license).toBe("MIT");
    expect(manifest.icon).toBe("icon.png");
    expect(manifest.icons).toEqual([{ src: "icon.png", size: "512x512" }]);
    expect(manifest.privacy_policies).toEqual(["https://shopcart.wals.pro/privacy"]);

    expect(manifest.server).toEqual({
      type: "node",
      entry_point: "server/index.mjs",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.mjs"]
      }
    });

    expect(Array.isArray(manifest.tools)).toBe(true);
    expect(manifest.tools.map((t: { name: string }) => t.name)).toEqual(EXPECTED_TOOLS);
    for (const tool of manifest.tools) {
      expect(Object.keys(tool).sort()).toEqual(["description", "name"]);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
    }

    expect(manifest.compatibility).toEqual({
      claude_desktop: ">=0.10.0",
      platforms: ["darwin", "win32", "linux"],
      runtimes: {
        node: ">=22.19.0"
      }
    });
  });

  it("runs server/index.mjs standalone from an isolated temp directory without node_modules", async () => {
    const zipBuf = fs.readFileSync(MCPB_PATH);
    const entries = readZipEntries(zipBuf);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopcart-mcpb-test-"));

    try {
      for (const [relPath, content] of entries) {
        const dest = path.join(tmpDir, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content);
      }

      const serverPath = path.join(tmpDir, "server", "index.mjs");
      const child = spawn(process.execPath, [serverPath], {
        cwd: tmpDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "" }
      });

      const responses = new Map<number, Record<string, unknown>>();
      let stdoutBuf = "";
      let stderrBuf = "";

      const waitForId = (id: number, timeoutMs = 5000) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const existing = responses.get(id);
          if (existing) {
            resolve(existing);
            return;
          }
          const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for JSON-RPC response id=${id}. stderr=${stderrBuf}`));
          }, timeoutMs);
          const check = () => {
            const msg = responses.get(id);
            if (msg) {
              clearTimeout(timer);
              child.stdout.off("data", onData);
              resolve(msg);
            }
          };
          const onData = () => check();
          child.stdout.on("data", onData);
        });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBuf += chunk;
        let idx = stdoutBuf.indexOf("\n");
        while (idx !== -1) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (line) {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (typeof parsed.id === "number") {
              responses.set(parsed.id, parsed);
            }
          }
          idx = stdoutBuf.indexOf("\n");
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrBuf += chunk;
      });

      const send = (payload: Record<string, unknown>) => {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      };

      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "mcpb-vitest", version: "1.0.0" }
        }
      });

      const initRes = await waitForId(1);
      expect(initRes.error).toBeUndefined();
      const initResult = initRes.result as { serverInfo: { name: string } };
      expect(initResult.serverInfo.name).toBe("shopcart-mcp");

      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

      const toolsRes = await waitForId(2);
      expect(toolsRes.error).toBeUndefined();
      const toolsResult = toolsRes.result as { tools: Array<{ name: string }> };
      expect(toolsResult.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);

      child.kill("SIGTERM");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("serves GET /downloads/shopcart-mcp.mcpb with 200 OK, octet-stream, attachment header, and ZIP magic bytes", async () => {
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      STORAGE_BACKEND: "memory",
      SESSION_SECRET: "test-session-secret-0123456789abcdef"
    });
    const app = createApp({ config, store: new MemoryStore() });

    const res = await request(app)
      .get("/downloads/shopcart-mcp.mcpb")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers["content-type"]).toContain("application/octet-stream");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="shopcart-mcp.mcpb"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const diskBytes = fs.readFileSync(MCPB_PATH);
    expect(body.length).toBe(diskBytes.length);
    expect(body.equals(diskBytes)).toBe(true);
  });
});
