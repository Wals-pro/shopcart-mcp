#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const OUTPUT_PATH = path.join(ROOT_DIR, "public", "downloads", "shopcart-mcp.mcpb");
const ENTRY_POINT = path.join(ROOT_DIR, "src", "cli.ts");
const ICON_PATH = path.join(ROOT_DIR, "public", "icon-512.png");
const LICENSE_PATH = path.join(ROOT_DIR, "LICENSE");
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, "package.json");

// Fixed DOS timestamp (2026-01-01 00:00:00) for deterministic ZIP builds
const FIXED_DOS_TIME = 0x0000;
const FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * Build a standard ZIP archive buffer in pure Node.js (no external `zip` binary needed).
 * Uses DEFLATE when it shrinks the entry and STORE otherwise (e.g. already-compressed PNG).
 *
 * @param {Array<{ name: string; data: Buffer; mode?: number }>} entries
 * @returns {Buffer}
 */
export function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawData = entry.data;
    const crc = zlib.crc32(rawData) >>> 0;
    const deflated = zlib.deflateRawSync(rawData, { level: 9 });

    const useDeflate = deflated.length < rawData.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : rawData;

    const flags = 0x0800; // UTF-8 filename encoding
    const versionNeeded = 20; // 2.0 (DEFLATE)
    const versionMadeBy = (3 << 8) | 20; // UNIX + 2.0
    const unixMode = (entry.mode ?? 0o100644) >>> 0;
    const externalAttrs = (unixMode << 16) >>> 0;

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    localHeader.writeUInt16LE(versionNeeded, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
    localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, nameBuf, payload);

    // Central Directory File Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    centralHeader.writeUInt16LE(versionMadeBy, 4);
    centralHeader.writeUInt16LE(versionNeeded, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12);
    centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attrs
    centralHeader.writeUInt32LE(externalAttrs, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/**
 * Build MCPB v0.3 manifest conforming strictly to modelcontextprotocol/mcpb
 * schemas/mcpb-manifest-v0.3.schema.json (latest).
 *
 * @param {string} version
 */
export function createMcpbManifest(version) {
  return {
    manifest_version: "0.3",
    name: "shopcart-mcp",
    display_name: "ShopCart MCP",
    version,
    description:
      "Search Shopify stores, inspect live product variants and prices, and create browser cart links — local & zero-auth.",
    long_description: [
      "Connect Claude Desktop directly to public Shopify storefronts with zero login, zero API keys, and zero telemetry.",
      "",
      "**Included read-only tools:**",
      "- `inspect_store` — Verify Shopify storefront support, currency, country, and WAF behavior.",
      "- `list_collections` — Browse store collections and automatically highlight Sale, Black Friday, Bestseller, and seasonal deal collections.",
      "- `search_products` — Search public product catalogs or collections with availability, price, and discount sorting (`discount_desc`, `price_asc`, `price_desc`).",
      "- `get_product` — Fetch sanitized product details, options, images, stock, compare-at discounts, and exact numeric variant IDs.",
      "- `get_store_policies` — Check shipping thresholds, delivery times, and return/refund policies via native Storefront MCP and public `/policies` pages.",
      "- `create_cart_link` — Build verified browser cart or checkout permalinks so you review and complete checkout yourself.",
      "",
      "Includes built-in SSRF protection and prompt-injection sanitization. Independent open-source project by Wals.pro (not affiliated with Shopify Inc.)."
    ].join("\n"),
    author: {
      name: "Wals.pro",
      email: "support@wals.pro",
      url: "https://wals.pro"
    },
    repository: {
      type: "git",
      url: "https://github.com/Wals-pro/shopcart-mcp.git"
    },
    homepage: "https://shopcart.wals.pro",
    documentation: "https://github.com/Wals-pro/shopcart-mcp#readme",
    support: "https://github.com/Wals-pro/shopcart-mcp/issues",
    icon: "icon.png",
    icons: [
      {
        src: "icon.png",
        size: "512x512"
      }
    ],
    license: "MIT",
    privacy_policies: ["https://shopcart.wals.pro/privacy"],
    keywords: [
      "shopify",
      "shopping",
      "ecommerce",
      "cart",
      "mcp",
      "products",
      "checkout",
      "storefront"
    ],
    server: {
      type: "node",
      entry_point: "server/index.mjs",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/index.mjs"]
      }
    },
    tools: [
      {
        name: "inspect_store",
        description:
          "Check whether an HTTPS online store URL is a supported public Shopify storefront and return its currency, country, WAF restrictions, and available catalog endpoints."
      },
      {
        name: "list_collections",
        description:
          "List public collections from a Shopify storefront and automatically highlight Sale, Black Friday, Outlet, Bestseller, Bundle, and Advent calendar deal collections."
      },
      {
        name: "search_products",
        description:
          "Search a Shopify storefront's public catalog by keyword or collection handle with optional availability, min/max price filters, sort_by (including discount_desc), and automatic discount/savings calculation."
      },
      {
        name: "get_product",
        description:
          "Retrieve product details, sanitized description text, options, images, and exact numeric variant IDs, prices, compare-at discounts, and availability for a Shopify product handle or URL."
      },
      {
        name: "get_store_policies",
        description:
          "Fetch a Shopify store's shipping, delivery, and return/refund policies via native Storefront MCP FAQ search and public /policies endpoints with sanitized excerpts, extracted hints, and official policy URLs."
      },
      {
        name: "create_cart_link",
        description:
          "Generate a read-only Shopify browser cart or checkout permalink from exact numeric variant IDs and quantities, optionally verifying live availability via verify_handles."
      }
    ],
    tools_generated: false,
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: ["darwin", "win32", "linux"],
      runtimes: {
        node: ">=20.0.0"
      }
    }
  };
}

export async function buildMcpb(outputPath = OUTPUT_PATH) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const version = typeof pkg.version === "string" && pkg.version ? pkg.version : "0.1.0";

  // Bundle src/cli.ts into a single self-contained ESM file with CJS require shim for undici
  const result = await esbuild.build({
    entryPoints: [ENTRY_POINT],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    minify: true,
    sourcemap: false,
    write: false,
    legalComments: "none",
    banner: {
      js: [
        'import { createRequire as __mcpbCreateRequire } from "node:module";',
        'import { fileURLToPath as __mcpbFileURLToPath } from "node:url";',
        'import { dirname as __mcpbDirname } from "node:path";',
        "const require = __mcpbCreateRequire(import.meta.url);",
        "const __filename = __mcpbFileURLToPath(import.meta.url);",
        "const __dirname = __mcpbDirname(__filename);"
      ].join("\n")
    },
    define: {
      "process.env.NODE_ENV": '"production"'
    }
  });

  const bundledFile = result.outputFiles?.[0];
  if (!bundledFile) {
    throw new Error("esbuild produced no output file for src/cli.ts");
  }

  const serverBundle = Buffer.from(bundledFile.contents);
  const manifest = createMcpbManifest(version);
  const manifestBuf = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const iconBuf = fs.readFileSync(ICON_PATH);
  const licenseBuf = fs.readFileSync(LICENSE_PATH);

  const zipBuf = createZipBuffer([
    { name: "manifest.json", data: manifestBuf, mode: 0o100644 },
    { name: "icon.png", data: iconBuf, mode: 0o100644 },
    { name: "LICENSE", data: licenseBuf, mode: 0o100644 },
    { name: "server/index.mjs", data: serverBundle, mode: 0o100755 }
  ]);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, zipBuf);

  return {
    outputPath,
    archiveBytes: zipBuf.length,
    bundleBytes: serverBundle.length,
    version
  };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  buildMcpb()
    .then(({ outputPath, archiveBytes, bundleBytes, version }) => {
      const rel = path.relative(ROOT_DIR, outputPath);
      console.log(
        `Built ${rel} (v${version}) — archive: ${(archiveBytes / 1024).toFixed(1)} KB (${archiveBytes} B), server/index.mjs: ${(bundleBytes / 1024).toFixed(1)} KB`
      );
    })
    .catch((err) => {
      console.error("[build-mcpb] Failed:", err);
      process.exit(1);
    });
}
