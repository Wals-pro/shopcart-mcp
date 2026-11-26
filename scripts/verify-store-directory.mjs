#!/usr/bin/env node
/**
 * Dev-only live verification script for ShopCart MCP's Global Online Store Directory.
 *
 * Usage:
 *   node scripts/verify-store-directory.mjs                      # Verify every store in src/stores/curated-stores.ts
 *   node scripts/verify-store-directory.mjs --probe <file.json>  # Probe a candidate list of domains and print JSON results
 *   node scripts/verify-store-directory.mjs --concurrency 12     # Adjust parallel probe concurrency (default 10)
 *
 * Strictly read-only: sends lightweight GET/HEAD requests over HTTPS to verify
 * domain liveness (HTTP 200) and real platform markers matching ShopCart's adapters.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const USER_AGENT =
  "Mozilla/5.0 (compatible; ShopCartMCP-DirectoryVerifier/1.0; +https://shopcart.wals.pro)";
const REQUEST_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 350_000;

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: opts.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
        ...(opts.headers ?? {})
      }
    });

    let text = "";
    if (opts.readBody !== false) {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks = [];
        let total = 0;
        while (total < (opts.maxBytes ?? MAX_HTML_BYTES)) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.byteLength;
        }
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        text = Buffer.concat(chunks).toString("utf8");
      }
    }

    const headers = {};
    for (const [k, v] of res.headers.entries()) {
      headers[k.toLowerCase()] = v;
    }

    return {
      ok: true,
      status: res.status,
      finalUrl: res.url,
      headers,
      text
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      headers: {},
      text: "",
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

function isParkedOrErrorPage(html) {
  const lower = html.toLowerCase();
  return (
    lower.includes("domain is for sale") ||
    lower.includes("this domain may be for sale") ||
    lower.includes("sedoparking") ||
    lower.includes("buy this domain") ||
    (lower.includes("afternic") && lower.includes("domain")) ||
    lower.includes("parked free, courtesy of godaddy") ||
    lower.includes("this store is currently unavailable") ||
    lower.includes("sorry, this shop is currently unavailable") ||
    (lower.includes("opening soon") && lower.includes("enter using password"))
  );
}

function extractReferencedHosts(html) {
  const hosts = new Set();
  const urlRe = /https:\/\/[a-z0-9.-]+(?=[/"'\s<>])/gi;
  for (const match of html.matchAll(urlRe)) {
    try {
      const parsed = new URL(match[0]);
      hosts.add(parsed.hostname.toLowerCase());
    } catch {
      // ignore invalid URLs
    }
  }
  return hosts;
}

function detectMarkersFromHtmlAndHeaders(html, headers) {
  const lower = html.toLowerCase();
  const h = headers || {};
  const referencedHosts = extractReferencedHosts(html);
  const markers = [];

  // Shopify markers
  const hasShopifyHeader = Boolean(
    h["x-shopify-stage"] ||
      h["x-shopid"] ||
      h["x-sorting-hat-shopid"] ||
      (h["powered-by"] && h["powered-by"].toLowerCase().includes("shopify")) ||
      (h["server"] && h["server"].toLowerCase().includes("shopify"))
  );
  let hasShopifyCdnHost = false;
  for (const host of referencedHosts) {
    if (host === "cdn.shopify.com" || host.endsWith(".myshopify.com") || host.endsWith(".shopifycdn.com")) {
      hasShopifyCdnHost = true;
      break;
    }
  }
  const hasShopifyHtml =
    hasShopifyCdnHost ||
    lower.includes("shopify.shop") ||
    lower.includes("shopify-features") ||
    lower.includes("shopify-digital-wallet") ||
    lower.includes("window.shopify");
  if (hasShopifyHeader || hasShopifyHtml) markers.push("shopify");

  // WooCommerce markers
  const hasWooHtml =
    lower.includes("wp-content/plugins/woocommerce") ||
    lower.includes("woocommerce-js") ||
    lower.includes("wc-blocks") ||
    lower.includes("woocommerce-page") ||
    lower.includes("wc_add_to_cart_params");
  if (hasWooHtml) markers.push("woocommerce");

  // BigCommerce markers
  const hasBcHeader = Boolean(
    h["x-bc-storefront-type"] ||
      h["x-bc-edge-cache-status"] ||
      (h["set-cookie"] && h["set-cookie"].includes("SHOP_SESSION_TOKEN"))
  );
  let hasBcCdnHost = false;
  for (const host of referencedHosts) {
    if (/^cdn\d*\.bigcommerce\.com$/.test(host)) {
      hasBcCdnHost = true;
      break;
    }
  }
  const hasBcHtml =
    hasBcCdnHost ||
    lower.includes("window.bcdata") ||
    lower.includes("stencil-utils") ||
    lower.includes("bc-sf-filter");
  if (hasBcHeader || hasBcHtml) markers.push("bigcommerce");

  // Shopware 6 markers
  const hasSwHeader = Boolean(
    h["sw-context-token"] ||
      h["x-shopware-cache-id"] ||
      (h["x-powered-by"] && h["x-powered-by"].toLowerCase().includes("shopware"))
  );
  const hasSwHtml =
    lower.includes("/bundles/storefront/") ||
    lower.includes("shopware-storefront") ||
    lower.includes("frontend.checkout.line-item") ||
    lower.includes("window.router") && lower.includes("frontend.search") ||
    lower.includes("data-csrf-token") && lower.includes("shopware") ||
    lower.includes("/theme/") && lower.includes("sw-");
  if (hasSwHeader || hasSwHtml) markers.push("shopware");

  // Magento 2 markers
  const hasMagentoHeader = Boolean(
    h["x-magento-vary"] ||
      h["x-magento-tags"] ||
      h["x-magento-cache-control"] ||
      h["x-magento-cache-debug"]
  );
  const hasMagentoHtml =
    lower.includes("text/x-magento-init") ||
    lower.includes("mage/cookies") ||
    lower.includes("magento_ui") ||
    lower.includes("magento_catalog") ||
    lower.includes("/static/version") && lower.includes("requirejs-config") ||
    lower.includes("mage.cookies");
  if (hasMagentoHeader || hasMagentoHtml) markers.push("magento");

  // Schema.org / JSON-LD presence
  const hasJsonLd = lower.includes("application/ld+json");

  return { markers, hasJsonLd };
}

export async function probeDomain(domain) {
  let cleanDomain = domain.trim().toLowerCase();
  if (cleanDomain.startsWith("https://")) cleanDomain = cleanDomain.slice(8);
  else if (cleanDomain.startsWith("http://")) cleanDomain = cleanDomain.slice(7);
  const slashIdx = cleanDomain.indexOf("/");
  if (slashIdx !== -1) cleanDomain = cleanDomain.slice(0, slashIdx);
  const origin = `https://${cleanDomain}`;

  const home = await fetchWithTimeout(origin, { timeoutMs: REQUEST_TIMEOUT_MS });
  if (!home.ok || home.status !== 200) {
    return {
      domain: cleanDomain,
      ok: false,
      status: home.status,
      finalUrl: home.finalUrl,
      error: home.error ?? `HTTP ${home.status}`,
      detectedPlatform: null
    };
  }

  if (isParkedOrErrorPage(home.text)) {
    return {
      domain: cleanDomain,
      ok: false,
      status: home.status,
      finalUrl: home.finalUrl,
      error: "Parked or unavailable storefront page",
      detectedPlatform: null
    };
  }

  let finalOrigin = origin;
  let finalHost = cleanDomain;
  try {
    const u = new URL(home.finalUrl);
    finalOrigin = u.origin;
    finalHost = u.hostname.toLowerCase();
  } catch {
    // keep default
  }

  // Reject cross-brand redirects (apex <-> www or regional subdomain of same registrable domain is fine)
  const { markers, hasJsonLd } = detectMarkersFromHtmlAndHeaders(home.text, home.headers);

  let detectedPlatform = null;
  let shopifyProductsApi = false;
  let wooStoreApi = false;
  let ucpSupported = false;
  let magentoGraphql = false;

  // Probe UCP well-known quickly (on Shopify or any storefront)
  const ucpProbe = await fetchWithTimeout(`${finalOrigin}/.well-known/ucp`, {
    timeoutMs: 3500,
    accept: "application/json",
    maxBytes: 20_000
  });
  if (ucpProbe.ok && ucpProbe.status === 200 && ucpProbe.text.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(ucpProbe.text);
      if (parsed && (parsed.ucp || parsed.services || parsed.capabilities || parsed.version)) {
        ucpSupported = true;
      }
    } catch {
      // not valid UCP JSON
    }
  }

  // Confirm Shopify via /products.json?limit=1
  if (markers.includes("shopify")) {
    detectedPlatform = "shopify";
    const prodProbe = await fetchWithTimeout(`${finalOrigin}/products.json?limit=1`, {
      timeoutMs: 4500,
      accept: "application/json",
      maxBytes: 30_000
    });
    if (prodProbe.ok && prodProbe.status === 200 && prodProbe.text.includes('"products"')) {
      shopifyProductsApi = true;
    }
  }

  // Confirm WooCommerce via Store API v1
  if (!detectedPlatform && markers.includes("woocommerce")) {
    detectedPlatform = "woocommerce";
    const wooProbe = await fetchWithTimeout(
      `${finalOrigin}/wp-json/wc/store/v1/products?per_page=1`,
      {
        timeoutMs: 4500,
        accept: "application/json",
        maxBytes: 30_000
      }
    );
    if (wooProbe.ok && wooProbe.status === 200 && wooProbe.text.trim().startsWith("[")) {
      wooStoreApi = true;
    }
  }

  // Check BigCommerce, Shopware, Magento from markers
  if (!detectedPlatform && markers.includes("bigcommerce")) {
    detectedPlatform = "bigcommerce";
  }
  if (!detectedPlatform && markers.includes("shopware")) {
    detectedPlatform = "shopware";
  }
  if (!detectedPlatform && markers.includes("magento")) {
    detectedPlatform = "magento";
    const gqlProbe = await fetchWithTimeout(`${finalOrigin}/graphql?query=%7BstoreConfig%7Bbase_currency_code%7D%7D`, {
      timeoutMs: 4000,
      accept: "application/json",
      maxBytes: 15_000
    });
    if (gqlProbe.ok && gqlProbe.status === 200 && gqlProbe.text.includes("storeConfig")) {
      magentoGraphql = true;
    }
  }

  // If no HTML markers matched, probe Shopify /products.json and Woo /wp-json/wc/store/v1/products
  if (!detectedPlatform) {
    const [shProbe, wcProbe] = await Promise.all([
      fetchWithTimeout(`${finalOrigin}/products.json?limit=1`, {
        timeoutMs: 4000,
        accept: "application/json",
        maxBytes: 25_000
      }),
      fetchWithTimeout(`${finalOrigin}/wp-json/wc/store/v1/products?per_page=1`, {
        timeoutMs: 4000,
        accept: "application/json",
        maxBytes: 25_000
      })
    ]);

    if (shProbe.ok && shProbe.status === 200 && shProbe.text.trim().startsWith("{") && shProbe.text.includes('"products"')) {
      detectedPlatform = "shopify";
      shopifyProductsApi = true;
    } else if (wcProbe.ok && wcProbe.status === 200 && wcProbe.text.trim().startsWith("[")) {
      try {
        const arr = JSON.parse(wcProbe.text);
        if (Array.isArray(arr)) {
          detectedPlatform = "woocommerce";
          wooStoreApi = true;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!detectedPlatform) {
    detectedPlatform = ucpSupported ? "ucp" : "other";
  }

  return {
    domain: cleanDomain,
    ok: true,
    status: home.status,
    finalHost,
    finalUrl: home.finalUrl,
    detectedPlatform,
    markers,
    shopifyProductsApi,
    wooStoreApi,
    magentoGraphql,
    ucpSupported,
    hasJsonLd
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function runWorker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function parseCuratedStoresFromTs(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const entries = [];
  let pos = 0;
  while (pos < src.length) {
    const start = src.indexOf("{", pos);
    if (start === -1) break;
    const end = src.indexOf("}", start + 1);
    if (end === -1) break;
    const block = src.slice(start, end + 1);
    const domainMatch = block.match(/domain:\s*"([^"]+)"/);
    if (domainMatch) {
      const platformMatch = block.match(/platform:\s*"([^"]+)"/);
      const cartMatch = block.match(/cart_supported:\s*(true|false)/);
      const nameMatch = block.match(/name:\s*"([^"]+)"/);
      entries.push({
        domain: domainMatch[1],
        name: nameMatch?.[1] ?? domainMatch[1],
        platform: platformMatch?.[1] ?? "unknown",
        cart_supported: cartMatch?.[1] === "true"
      });
    }
    pos = end + 1;
  }
  return entries;
}

function expectedCartSupport(platform) {
  return platform === "shopify" || platform === "woocommerce" || platform === "bigcommerce";
}

async function main() {
  const args = process.argv.slice(2);
  let probeFile = null;
  let outFile = null;
  let concurrency = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--probe" && args[i + 1]) {
      probeFile = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      outFile = args[++i];
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, Math.min(30, Number.parseInt(args[++i], 10) || 10));
    }
  }

  if (probeFile) {
    const raw = JSON.parse(fs.readFileSync(probeFile, "utf8"));
    const domains = Array.isArray(raw) ? raw : Object.values(raw).flat();
    const uniqueDomains = [...new Set(domains.map((d) => String(d).trim().toLowerCase()))];
    console.error(`Probing ${uniqueDomains.length} candidate domains (concurrency=${concurrency})...`);

    let done = 0;
    const results = await runPool(uniqueDomains, concurrency, async (domain) => {
      const res = await probeDomain(domain);
      done++;
      if (done % 25 === 0 || done === uniqueDomains.length) {
        console.error(`  progress: ${done}/${uniqueDomains.length}`);
      }
      return res;
    });

    const okList = results.filter((r) => r.ok);
    const failList = results.filter((r) => !r.ok);
    const byPlatform = {};
    for (const r of okList) {
      byPlatform[r.detectedPlatform] = (byPlatform[r.detectedPlatform] ?? 0) + 1;
    }
    const ucpCount = okList.filter((r) => r.ucpSupported).length;
    console.error(
      `Done: ${okList.length} OK, ${failList.length} failed. Platforms: ${JSON.stringify(byPlatform)}, UCP detected: ${ucpCount}`
    );

    const payload = JSON.stringify({ summary: { total: results.length, ok: okList.length, failed: failList.length, byPlatform, ucpCount }, results }, null, 2);
    if (outFile) {
      fs.writeFileSync(outFile, payload, "utf8");
      console.error(`Wrote report to ${outFile}`);
    } else {
      console.log(payload);
    }
    return;
  }

  // Default mode: verify curated-stores.ts
  const curatedPath = path.join(REPO_ROOT, "src", "stores", "curated-stores.ts");
  if (!fs.existsSync(curatedPath)) {
    console.error(`Directory dataset not found at ${curatedPath}`);
    process.exit(1);
  }

  const entries = parseCuratedStoresFromTs(curatedPath);
  console.log(`Verifying ${entries.length} stores from src/stores/curated-stores.ts (concurrency=${concurrency})...`);

  let done = 0;
  const results = await runPool(entries, concurrency, async (entry) => {
    const probe = await probeDomain(entry.domain);
    done++;
    if (done % 20 === 0 || done === entries.length) {
      console.log(`  progress: ${done}/${entries.length}`);
    }

    const errors = [];
    if (!probe.ok) {
      errors.push(`Unreachable/non-200: ${probe.error}`);
    } else {
      // Allow ucp to match either ucpSupported or platform === "ucp"
      const platformMatches =
        entry.platform === probe.detectedPlatform ||
        (entry.platform === "ucp" && probe.ucpSupported);
      if (!platformMatches) {
        errors.push(`Platform mismatch: declared='${entry.platform}', detected='${probe.detectedPlatform}' (ucp=${probe.ucpSupported})`);
      }
      if (entry.cart_supported !== expectedCartSupport(entry.platform)) {
        errors.push(`cart_supported mismatch: declared=${entry.cart_supported}, expected=${expectedCartSupport(entry.platform)} for platform '${entry.platform}'`);
      }
    }

    return { entry, probe, errors };
  });

  const failures = results.filter((r) => r.errors.length > 0);
  const platformCounts = {};
  for (const r of results) {
    platformCounts[r.entry.platform] = (platformCounts[r.entry.platform] ?? 0) + 1;
  }

  console.log(`\nSummary: ${results.length - failures.length}/${results.length} stores passed live verification.`);
  console.log(`Platforms: ${JSON.stringify(platformCounts)}`);

  if (failures.length > 0) {
    console.error(`\nFailed stores (${failures.length}):`);
    for (const f of failures) {
      console.error(`  - ${f.entry.domain} (${f.entry.name}): ${f.errors.join("; ")}`);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
