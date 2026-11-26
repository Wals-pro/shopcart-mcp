#!/usr/bin/env node
/**
 * IndexNow submission helper for ShopCart MCP.
 *
 * Defaults to DRY-RUN mode (prints the exact payload without sending a POST).
 * Pass --live to verify the hosted key file and submit all sitemap URLs to
 * https://api.indexnow.org/indexnow.
 *
 * Usage:
 *   INDEXNOW_KEY=<hex-key> node scripts/ping-indexnow.mjs
 *   INDEXNOW_KEY=<hex-key> node scripts/ping-indexnow.mjs --live
 *   node scripts/ping-indexnow.mjs --origin https://shopcart.wals.pro --key <hex-key> --sitemap-file ./sitemap.xml
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_KEY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{6,126}[A-Za-z0-9])$/;

export function isValidIndexNowKey(key) {
  return typeof key === "string" && INDEXNOW_KEY_RE.test(key.trim());
}

export function extractSitemapUrls(xml, expectedHost) {
  const urls = [];
  const seen = new Set();
  const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const raw = (match[1] ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      if (expectedHost && parsed.host.toLowerCase() !== expectedHost.toLowerCase()) continue;
      const normalized = parsed.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } catch {
      // Skip malformed entries
    }
  }
  return urls;
}

export function buildIndexNowPayload({ origin, key, urlList }) {
  const parsedOrigin = new URL(origin);
  return {
    host: parsedOrigin.host,
    key,
    keyLocation: `${parsedOrigin.origin}/${key}.txt`,
    urlList
  };
}

export function parseCliArgs(argv) {
  const opts = {
    live: false,
    origin: process.env.APP_ORIGIN || "https://shopcart.wals.pro",
    key: process.env.INDEXNOW_KEY || "",
    sitemapUrl: "",
    sitemapFile: "",
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--live") {
      opts.live = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--origin" && argv[i + 1]) {
      opts.origin = argv[++i];
    } else if (arg === "--key" && argv[i + 1]) {
      opts.key = argv[++i];
    } else if (arg === "--sitemap" && argv[i + 1]) {
      opts.sitemapUrl = argv[++i];
    } else if (arg === "--sitemap-file" && argv[i + 1]) {
      opts.sitemapFile = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  opts.origin = new URL(opts.origin).origin;
  opts.key = opts.key.trim();
  if (!opts.sitemapUrl) {
    opts.sitemapUrl = `${opts.origin}/sitemap.xml`;
  }
  return opts;
}

async function loadSitemapXml(opts) {
  if (opts.sitemapFile) {
    return fs.readFileSync(path.resolve(opts.sitemapFile), "utf8");
  }
  const res = await fetch(opts.sitemapUrl, {
    headers: { Accept: "application/xml, text/xml;q=0.9, */*;q=0.1" }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch sitemap ${opts.sitemapUrl}: HTTP ${res.status}`);
  }
  return res.text();
}

async function runCli() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      [
        "Usage: node scripts/ping-indexnow.mjs [--live] [--origin URL] [--key KEY] [--sitemap URL | --sitemap-file PATH]",
        "",
        "Defaults to DRY-RUN mode. Pass --live to verify /<key>.txt and POST to https://api.indexnow.org/indexnow."
      ].join("\n")
    );
    return;
  }

  const keyValid = isValidIndexNowKey(opts.key);
  if (opts.live && !keyValid) {
    console.error(
      "Error: INDEXNOW_KEY must be a valid 8-128 character alphanumeric/hex key before running with --live."
    );
    process.exitCode = 1;
    return;
  }

  const displayKey = keyValid ? opts.key : "<SET_INDEXNOW_KEY>";
  const xml = await loadSitemapXml(opts);
  const host = new URL(opts.origin).host;
  const urlList = extractSitemapUrls(xml, host);

  if (urlList.length === 0) {
    console.error(`Error: No URLs found for host ${host} in sitemap.`);
    process.exitCode = 1;
    return;
  }

  const payload = buildIndexNowPayload({
    origin: opts.origin,
    key: displayKey,
    urlList
  });

  if (!opts.live) {
    console.log(`[DRY-RUN] Mode: dry-run (pass --live to submit to ${INDEXNOW_ENDPOINT})`);
    if (!keyValid) {
      console.log("[DRY-RUN] Note: INDEXNOW_KEY is not set or invalid; showing placeholder key.");
    }
    console.log(`[DRY-RUN] Endpoint: POST ${INDEXNOW_ENDPOINT}`);
    console.log(`[DRY-RUN] URLs discovered: ${urlList.length}`);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Verify the hosted key file before pinging IndexNow
  const verifyRes = await fetch(payload.keyLocation);
  const verifyBody = (await verifyRes.text()).trim();
  if (!verifyRes.ok || verifyBody !== opts.key) {
    console.error(
      `Error: Key verification failed at ${payload.keyLocation} (HTTP ${verifyRes.status}). Deploy INDEXNOW_KEY first.`
    );
    process.exitCode = 1;
    return;
  }

  const submitRes = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });

  const responseText = await submitRes.text();
  if (submitRes.status === 200 || submitRes.status === 202) {
    console.log(
      `[LIVE] IndexNow accepted ${urlList.length} URLs for ${host} (HTTP ${submitRes.status}).`
    );
    return;
  }

  console.error(
    `[LIVE] IndexNow returned HTTP ${submitRes.status}: ${responseText.slice(0, 400)}`
  );
  process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
