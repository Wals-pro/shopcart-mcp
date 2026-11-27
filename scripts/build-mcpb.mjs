#!/usr/bin/env node
import crypto from "node:crypto";
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
  const sortedEntries = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of sortedEntries) {
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
      "Read-only shopping MCP: price comparison, deals, 16 secondhand/refurbished marketplaces, store discovery & verified cart links — local & zero-auth.",
    long_description: [
      "Connect Claude Desktop directly to public Shopify, WooCommerce, BigCommerce, Shopware 6, Magento 2, Universal JSON-LD storefronts, and Amazon marketplaces with zero login, zero API keys required for core features, and zero telemetry.",
      "",
      "**Included read-only tools:**",
      "- `discover_stores` — Instant in-memory search across ShopCart's curated, live-verified global store directory (12 categories, DACH + US/UK/EU, multi-platform) whenever no store domain is specified.",
      "- `inspect_store` — Detect platform (Amazon, Shopify incl. UCP, WooCommerce, BigCommerce, Shopware 6, Magento 2, or Universal JSON-LD), currency, country, WAF behavior, and capabilities.",
      "- `list_collections` — Browse Shopify store collections and automatically highlight Sale, Black Friday, Bestseller, and seasonal deal collections.",
      "- `search_products` — Search public product catalogs across supported storefronts (or Amazon via optional PA-API/Keepa) with availability, price, and discount sorting (`discount_desc`, `price_asc`, `price_desc`).",
      "- `get_product` — Fetch sanitized product details, options, images, stock, compare-at discounts, and exact variant/SKU IDs or Amazon ASINs (plus optional verified thumbnail via `include_thumbnail=true`).",
      "- `get_store_policies` — Check Shopify shipping thresholds, delivery times, and return/refund policies via native Storefront MCP and public `/policies` pages.",
      "- `find_store_discounts` — Discover official, publicly advertised Shopify promo codes (Black Friday / sale banners, deal collections) and automatic checkout deals published on the merchant's storefront.",
      "- `create_cart_link` — Build one verified cart link (Shopify with optional public promo-code discovery, Amazon), one add-to-cart link per item (WooCommerce, BigCommerce), or verified direct product links (Shopware 6, Magento 2, JSON-LD) so you review and complete checkout yourself.",
      "- `compare_prices` — Neutral, independent price comparison across merchants by keyword or EAN/GTIN barcode with 1-click regional comparison portal links (zero pay-to-rank).",
      "- `find_hot_deals` — Neutral, independent discovery of public promotions, vouchers, and 1-click regional deal community search links (zero pay-to-rank).",
      "- `match_visual_product` — Match a product seen in a user-uploaded photo across up to 5 public online stores in parallel using structured visual attributes and deterministic scoring.",
      "- `search_secondhand_marketplaces` — Generate verified, pre-filtered search deep-links across up to 16 second-hand, classifieds, vintage, and refurbished marketplaces in a single call with zero scraping.",
      "",
      "Includes built-in SSRF protection and prompt-injection sanitization. Independent open-source project by wals.pro, not affiliated with or endorsed by Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware, or Adobe (Magento)."
    ].join("\n"),
    author: {
      name: "wals.pro",
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
      "woocommerce",
      "amazon",
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
        name: "discover_stores",
        description:
          "Use proactively when the user asks which online shops sell a product or category without naming a domain (DE/EN keywords, category, country DE/AT/CH/DACH/US/UK/EU, platform, cart_only)."
      },
      {
        name: "inspect_store",
        description:
          "Check an online store domain or HTTPS URL to see its platform (Shopify, WooCommerce, BigCommerce, Shopware 6, Magento 2, Amazon, secondhand, UCP, or JSON-LD), currency, country, and shopping capabilities."
      },
      {
        name: "list_collections",
        description:
          "Browse a store's product categories, collections, and highlighted Sale, Outlet, Black Friday, Bestseller, or seasonal deal sections directly."
      },
      {
        name: "search_products",
        description:
          "Search products inside a named online store by keyword or collection with live prices, compare-at discounts, stock availability, price bounds, and discount sorting."
      },
      {
        name: "get_product",
        description:
          "Fetch verified live product details, exact sizes/colors, variant IDs, SKUs/EANs, live stock availability, prices, and compare-at discounts for a product handle, ID, ASIN, or full HTTPS product URL."
      },
      {
        name: "get_store_policies",
        description:
          "Answer questions about a store's shipping costs, free-shipping thresholds, delivery times, and return/refund rules directly."
      },
      {
        name: "find_store_discounts",
        description:
          "Find verified, publicly advertised promo/discount codes and active store promotions directly for a named online store."
      },
      {
        name: "create_cart_link",
        description:
          "Build a verified browser cart link (Shopify, WooCommerce, BigCommerce, Amazon) or direct product link (Shopware 6, Magento 2, JSON-LD) from exact variant IDs so the user can review and pay in their own browser. On UCP stores, may initiate a temporary checkout handoff session, but never places orders or processes payments."
      },
      {
        name: "compare_prices",
        description:
          "Use proactively for neutral, independent price comparison by keyword or EAN/GTIN across Geizhals, idealo, billiger.de, Toppreise.ch, and Google Shopping (DE, AT, CH, UK, FR, US) — zero pay-to-rank."
      },
      {
        name: "find_hot_deals",
        description:
          "Use proactively for neutral, independent discovery of current offers, public vouchers, and regional deal communities (mydealz, Preisjäger, HotUKDeals, Dealabs, Slickdeals) across DE, AT, CH, UK, FR, and US — zero pay-to-rank."
      },
      {
        name: "match_visual_product",
        description:
          "Use proactively when the user uploads a product photo or describes visual appearance attributes to find matching products across online stores with ranked confidence scores."
      },
      {
        name: "search_secondhand_marketplaces",
        description:
          "Use proactively to search up to 16 major second-hand, local-pickup (incl. German PLZ), vintage, and refurbished marketplaces (willhaben, Kleinanzeigen, refurbed, Back Market, Vinted, eBay, Ricardo.ch, rebuy) in 1 call."
      }
    ],
    tools_generated: false,
    compatibility: {
      claude_desktop: ">=0.10.0",
      platforms: ["darwin", "win32", "linux"],
      runtimes: {
        node: ">=22.19.0"
      }
    }
  };
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Pure-Node ZIP reader used by `--check` to inspect entry-level SHA-256 equality
 * alongside exact whole-archive byte equivalence.
 *
 * @param {Buffer} zipBuf
 * @returns {Map<string, Buffer>}
 */
export function extractZipEntries(zipBuf) {
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= Math.max(0, zipBuf.length - 65557); i -= 1) {
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
  const entries = new Map();
  let cursor = centralDirOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (zipBuf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory header");
    }
    const method = zipBuf.readUInt16LE(cursor + 10);
    const compressedSize = zipBuf.readUInt32LE(cursor + 20);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);

    const name = zipBuf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = zipBuf.subarray(dataStart, dataStart + compressedSize);
    const data =
      method === 0
        ? Buffer.from(compressedData)
        : method === 8
          ? zlib.inflateRawSync(compressedData)
          : (() => {
              throw new Error(`Unsupported ZIP compression method: ${method}`);
            })();

    entries.set(name, data);
  }

  return entries;
}

/**
 * Builds the deterministic `.mcpb` archive purely in memory (without touching disk).
 */
export async function buildMcpbBuffer() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const version = typeof pkg.version === "string" && pkg.version ? pkg.version : "0.1.0";

  // Bundle src/cli.ts into a single self-contained ESM file with CJS require shim for undici
  const result = await esbuild.build({
    absWorkingDir: ROOT_DIR,
    entryPoints: [ENTRY_POINT],
    bundle: true,
    platform: "node",
    target: "node22",
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

  const rawEntries = [
    { name: "LICENSE", data: licenseBuf, mode: 0o100644 },
    { name: "icon.png", data: iconBuf, mode: 0o100644 },
    { name: "manifest.json", data: manifestBuf, mode: 0o100644 },
    { name: "server/index.mjs", data: serverBundle, mode: 0o100755 }
  ];

  const zipBuf = createZipBuffer(rawEntries);
  return {
    zipBuf,
    archiveSha256: sha256Hex(zipBuf),
    archiveBytes: zipBuf.length,
    bundleBytes: serverBundle.length,
    entries: new Map(rawEntries.map((e) => [e.name, e.data])),
    version
  };
}

export async function buildMcpb(outputPath = OUTPUT_PATH) {
  const built = await buildMcpbBuffer();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, built.zipBuf);

  return {
    outputPath,
    archiveBytes: built.archiveBytes,
    archiveSha256: built.archiveSha256,
    bundleBytes: built.bundleBytes,
    version: built.version
  };
}

/**
 * Rebuilds the `.mcpb` archive in memory from source and verifies byte-for-byte
 * SHA-256 identity (and per-entry SHA-256 identity) against the committed archive on disk.
 */
export async function verifyMcpb(targetPath = OUTPUT_PATH) {
  if (!fs.existsSync(targetPath)) {
    return {
      ok: false,
      reason: `Archive not found at ${path.relative(ROOT_DIR, targetPath)}`,
      expectedSha256: null,
      actualSha256: null,
      mismatchedEntries: []
    };
  }

  const built = await buildMcpbBuffer();
  const diskBuf = fs.readFileSync(targetPath);
  const actualSha256 = sha256Hex(diskBuf);

  const diskEntries = extractZipEntries(diskBuf);
  const expectedNames = Array.from(built.entries.keys()).sort();
  const actualNames = Array.from(diskEntries.keys()).sort();
  const mismatchedEntries = [];

  if (expectedNames.join(",") !== actualNames.join(",")) {
    mismatchedEntries.push(
      `entry-list mismatch (expected [${expectedNames.join(", ")}], actual [${actualNames.join(", ")}])`
    );
  } else {
    for (const name of expectedNames) {
      const expBuf = built.entries.get(name);
      const actBuf = diskEntries.get(name);
      if (!expBuf || !actBuf || !expBuf.equals(actBuf)) {
        mismatchedEntries.push(
          `${name} (expected sha256=${sha256Hex(expBuf ?? Buffer.alloc(0)).slice(0, 12)}, actual sha256=${sha256Hex(actBuf ?? Buffer.alloc(0)).slice(0, 12)})`
        );
      }
    }
  }

  const archiveExactMatch = built.zipBuf.equals(diskBuf);
  const ok = archiveExactMatch && mismatchedEntries.length === 0;

  return {
    ok,
    archiveExactMatch,
    expectedSha256: built.archiveSha256,
    actualSha256,
    archiveBytes: built.archiveBytes,
    diskBytes: diskBuf.length,
    mismatchedEntries,
    reason: ok
      ? null
      : mismatchedEntries.length > 0
        ? `Entry content drift detected: ${mismatchedEntries.join("; ")}`
        : `Archive SHA-256 mismatch (expected ${built.archiveSha256}, actual ${actualSha256})`
  };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const isCheck = process.argv.includes("--check");
  if (isCheck) {
    verifyMcpb()
      .then((res) => {
        const rel = path.relative(ROOT_DIR, OUTPUT_PATH);
        if (!res.ok) {
          console.error(
            `[build-mcpb --check] FAILED for ${rel}: ${res.reason}. Run 'pnpm run build:mcpb' to regenerate.`
          );
          process.exit(1);
        }
        console.log(
          `[build-mcpb --check] OK ${rel} — exact SHA-256 match (${res.actualSha256}, ${res.archiveBytes} B)`
        );
      })
      .catch((err) => {
        console.error("[build-mcpb --check] Failed:", err);
        process.exit(1);
      });
  } else {
    buildMcpb()
      .then(({ outputPath, archiveBytes, archiveSha256, bundleBytes, version }) => {
        const rel = path.relative(ROOT_DIR, outputPath);
        console.log(
          `Built ${rel} (v${version}) — archive: ${(archiveBytes / 1024).toFixed(1)} KB (${archiveBytes} B, sha256=${archiveSha256.slice(0, 16)}…), server/index.mjs: ${(bundleBytes / 1024).toFixed(1)} KB`
        );
      })
      .catch((err) => {
        console.error("[build-mcpb] Failed:", err);
        process.exit(1);
      });
  }
}
