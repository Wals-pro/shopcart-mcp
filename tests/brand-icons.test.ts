import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import { sha256Base64Url } from "../src/auth/crypto.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SPARK_PATH_PREFIX = "M44 10.5c.8 4.4 2.1 5.7 6.5 6.5";

function makeBrandApp() {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef"
  });
  return { config, app: createApp({ config, store: new MemoryStore() }) };
}

function readBinary(app: ReturnType<typeof createApp>, route: string) {
  return request(app)
    .get(route)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
}

function parsePngDimensions(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

function extractZipEntry(zipBuf: Buffer, targetName: string): Buffer | null {
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65557); i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;
  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  let cursor = zipBuf.readUInt32LE(eocdOffset + 16);
  for (let i = 0; i < totalEntries; i++) {
    const method = zipBuf.readUInt16LE(cursor + 10);
    const compressedSize = zipBuf.readUInt32LE(cursor + 20);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);
    const name = zipBuf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;
    if (name !== targetName) continue;
    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const payload = zipBuf.subarray(dataStart, dataStart + compressedSize);
    return method === 0 ? Buffer.from(payload) : zlib.inflateRawSync(payload);
  }
  return null;
}

describe("Unified Spark Cart brand & icon suite (Option A, #FF1F4D)", () => {
  it("serves all master SVG, multi-size ICO, PNG icons, and web app manifest with strict headers", async () => {
    const { app } = makeBrandApp();

    // Old W-mark asset is gone
    await request(app).get("/assets/walspro-mark.svg").expect(404);
    expect(fs.existsSync(path.join(PUBLIC_DIR, "assets", "walspro-mark.svg"))).toBe(false);

    // Master SVGs
    const favSvg = await readBinary(app, "/favicon.svg").expect(200);
    expect(favSvg.headers["content-type"]).toContain("image/svg+xml");
    expect(favSvg.headers["x-content-type-options"]).toBe("nosniff");
    const favSvgText = (favSvg.body as Buffer).toString("utf8");
    expect(favSvgText).toContain('rect x="0" y="0" width="64" height="64" rx="16" fill="#FF1F4D"');
    expect(favSvgText).toContain(SPARK_PATH_PREFIX);

    const logoSvg = await readBinary(app, "/logo.svg").expect(200);
    expect(logoSvg.headers["content-type"]).toContain("image/svg+xml");
    expect(logoSvg.headers["x-content-type-options"]).toBe("nosniff");
    const logoSvgText = (logoSvg.body as Buffer).toString("utf8");
    expect(logoSvgText).toContain('rect x="2" y="2" width="60" height="60" rx="15" fill="#FF1F4D"');
    expect(logoSvgText).toContain(SPARK_PATH_PREFIX);

    // True multi-size ICO (16x16, 32x32, 48x48)
    const icoRes = await readBinary(app, "/favicon.ico").expect(200);
    expect(icoRes.headers["content-type"]).toContain("image/x-icon");
    expect(icoRes.headers["x-content-type-options"]).toBe("nosniff");
    const icoBuf = icoRes.body as Buffer;
    expect(icoBuf.readUInt16LE(0)).toBe(0);
    expect(icoBuf.readUInt16LE(2)).toBe(1);
    expect(icoBuf.readUInt16LE(4)).toBe(3);
    const icoSizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const entryOffset = 6 + i * 16;
      const w = icoBuf.readUInt8(entryOffset);
      const h = icoBuf.readUInt8(entryOffset + 1);
      const byteLen = icoBuf.readUInt32LE(entryOffset + 8);
      const imgOffset = icoBuf.readUInt32LE(entryOffset + 12);
      expect(w).toBe(h);
      icoSizes.push(w);
      const dims = parsePngDimensions(icoBuf.subarray(imgOffset, imgOffset + byteLen));
      expect(dims).toEqual({ width: w, height: h });
    }
    expect(icoSizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);

    // Exact PNG dimensions
    const expectedPngs: Array<[string, number]> = [
      ["/favicon.png", 32],
      ["/apple-touch-icon.png", 180],
      ["/icon-192.png", 192],
      ["/icon-512.png", 512]
    ];
    for (const [route, size] of expectedPngs) {
      const res = await readBinary(app, route).expect(200);
      expect(res.headers["content-type"]).toContain("image/png");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(parsePngDimensions(res.body as Buffer)).toEqual({ width: size, height: size });
    }

    // Web App Manifest (both .webmanifest and .json aliases)
    for (const route of ["/manifest.webmanifest", "/manifest.json"]) {
      const res = await request(app).get(route).expect(200);
      expect(res.headers["content-type"]).toContain("application/manifest+json");
      const manifest = JSON.parse(res.text) as {
        short_name: string;
        theme_color: string;
        icons: Array<{ src: string; sizes: string }>;
      };
      expect(manifest.short_name).toBe("ShopCart");
      expect(manifest.theme_color).toBe("#FF1F4D");
      expect(manifest.icons.map((i) => i.src)).toEqual([
        "/icon-192.png",
        "/icon-512.png",
        "/favicon.svg"
      ]);
    }
  });

  it("exposes Spark Cart icons in OAuth AS metadata, /.well-known/mcp.json, server.json, and .mcpb bundle", async () => {
    const { app } = makeBrandApp();

    const asMeta = await request(app).get("/.well-known/oauth-authorization-server").expect(200);
    expect(asMeta.body.logo_uri).toBe("https://shopcart.wals.pro/icon-512.png");

    const mcpCard = await request(app).get("/.well-known/mcp.json").expect(200);
    expect(mcpCard.body.icons.map((i: { src: string }) => i.src)).toEqual([
      "https://shopcart.wals.pro/apple-touch-icon.png",
      "https://shopcart.wals.pro/icon-192.png",
      "https://shopcart.wals.pro/icon-512.png"
    ]);

    const serverJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "server.json"), "utf8")) as {
      icons: Array<{ src: string }>;
    };
    expect(serverJson.icons.map((i) => i.src)).toEqual([
      "https://shopcart.wals.pro/apple-touch-icon.png",
      "https://shopcart.wals.pro/icon-192.png",
      "https://shopcart.wals.pro/icon-512.png"
    ]);

    // .mcpb embedded icon.png matches the freshly generated public/icon-512.png byte-for-byte
    const mcpbBuf = fs.readFileSync(path.join(PUBLIC_DIR, "downloads", "shopcart-mcp.mcpb"));
    const embeddedIcon = extractZipEntry(mcpbBuf, "icon.png");
    const diskIcon = fs.readFileSync(path.join(PUBLIC_DIR, "icon-512.png"));
    expect(embeddedIcon).not.toBeNull();
    expect(embeddedIcon!.equals(diskIcon)).toBe(true);
  });

  it("renders Spark Cart SVG & wordmark with zero residual old W-mark across all HTML pages (including 404)", async () => {
    const { app } = makeBrandApp();

    // Register a DCR client so /oauth/authorize renders the full consent page
    const reg = await request(app)
      .post("/oauth/register")
      .send({
        client_name: "Brand QA Client",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"]
      })
      .expect(201);

    const verifier = "verifier_0123456789_abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const oauthQuery = new URLSearchParams({
      response_type: "code",
      client_id: reg.body.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: sha256Base64Url(verifier),
      code_challenge_method: "S256",
      lang: "de"
    }).toString();

    const htmlPages: Array<{ route: string; expectedStatus: number; acceptHtml?: boolean }> = [
      { route: "/?lang=de", expectedStatus: 200 },
      { route: "/?lang=en", expectedStatus: 200 },
      { route: "/guides?lang=de", expectedStatus: 200 },
      { route: "/guides/mit-claude-online-einkaufen", expectedStatus: 200 },
      { route: "/billing?lang=de", expectedStatus: 200 },
      { route: "/billing/login?lang=en", expectedStatus: 200 },
      { route: `/oauth/authorize?${oauthQuery}`, expectedStatus: 200 },
      { route: "/auth/magic?token=invalid_test_token&lang=de", expectedStatus: 400 },
      { route: "/privacy?lang=de", expectedStatus: 200 },
      { route: "/terms?lang=en", expectedStatus: 200 },
      { route: "/non-existent-brand-qa-page?lang=de", expectedStatus: 404, acceptHtml: true }
    ];

    for (const { route, expectedStatus, acceptHtml } of htmlPages) {
      const req = request(app).get(route);
      if (acceptHtml) req.set("Accept", "text/html,application/xhtml+xml");
      const res = await req.expect(expectedStatus);
      const html = res.text;

      expect(html, `${route} should render Spark Cart SVG`).toContain('fill="#FF1F4D"');
      expect(html, `${route} should include 4-point spark path`).toContain(SPARK_PATH_PREFIX);
      expect(html, `${route} should render Shop+Cart wordmark`).toContain(
        'Shop<span class="brand-accent">Cart</span>'
      );
      expect(html, `${route} should link favicon.svg`).toContain('href="/favicon.svg"');
      expect(html, `${route} should link favicon.ico`).toContain('href="/favicon.ico"');
      expect(html, `${route} should link apple-touch-icon.png`).toContain('href="/apple-touch-icon.png"');
      expect(html, `${route} should link manifest.webmanifest`).toContain('href="/manifest.webmanifest"');
      expect(html, `${route} must not reference old walspro-mark`).not.toContain("walspro-mark");
      expect(html, `${route} must preserve subtle wals.pro attribution`).toContain("wals.pro");
    }

    // API clients requesting unknown routes without Accept: text/html still get JSON 404
    const api404 = await request(app).get("/non-existent-api-route").expect(404);
    expect(api404.body).toEqual({ error: "not_found" });
  });
});
