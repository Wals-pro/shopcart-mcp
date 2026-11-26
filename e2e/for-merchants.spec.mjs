#!/usr/bin/env node
/**
 * Playwright E2E & visual verification suite for /for-merchants (DE) and /en/for-merchants (EN).
 *
 * Boots the compiled Express app on an ephemeral localhost port (zero external network calls
 * required), verifies Desktop (1440x900) & Mobile (375x812) rendering, 0 console/page/CSP errors,
 * zero horizontal overflow, working DE <-> EN language switcher, visible CTAs, GDPR consent banner,
 * and saves full-page screenshots to SCREENSHOT_DIR (defaults to /tmp/item67-screenshots).
 *
 * Usage:
 *   pnpm build && node e2e/for-merchants.spec.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";
import { MemoryStore } from "../dist/store/memory.js";
import {
  INDEPENDENCE_GUARANTEE_DE,
  INDEPENDENCE_GUARANTEE_EN,
  WALSPRO_BOOKING_URL
} from "../dist/web/for-merchants.js";

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/item67-screenshots";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const candidates = [];
    if (process.env.PLAYWRIGHT_MODULE_PATH) {
      candidates.push(process.env.PLAYWRIGHT_MODULE_PATH);
    }
    try {
      const shimPath = execFileSync("which", ["playwright"], { encoding: "utf8" }).trim();
      if (shimPath && fs.existsSync(shimPath)) {
        const shim = fs.readFileSync(shimPath, "utf8");
        const match = shim.match(/NODE_PATH="([^"]+)"/);
        if (match?.[1]) {
          for (const dir of match[1].split(":")) {
            const indexPath = path.join(dir, "playwright", "index.mjs");
            const cjsPath = path.join(dir, "playwright", "index.js");
            if (fs.existsSync(indexPath)) candidates.push(indexPath);
            else if (fs.existsSync(cjsPath)) candidates.push(cjsPath);
          }
        }
      }
    } catch {
      // ignore PATH lookup failure
    }

    for (const candidate of candidates) {
      try {
        return await import(pathToFileURL(candidate).href);
      } catch {
        // try next
      }
    }
    throw new Error(
      "Could not load 'playwright'. Install playwright or set PLAYWRIGHT_MODULE_PATH."
    );
  }
}

async function startServer() {
  const store = new MemoryStore();
  const baseConfig = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "e2e-test-session-secret-0123456789abcdef",
    GA4_MEASUREMENT_ID: "G-E2ETEST1234"
  });
  const app = createApp({ config: baseConfig, store });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "Failed to bind ephemeral server port");
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function verifyViewport({ browser, origin, route, lang, viewportName, viewport, screenshotPath }) {
  const context = await browser.newContext({
    viewport,
    colorScheme: "dark",
    deviceScaleFactor: viewportName === "mobile" ? 2 : 1
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const cspViolations = [];
  const thirdPartyAnalyticsRequests = [];

  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push({
        violatedDirective: event.violatedDirective,
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective
      });
    });
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("googletagmanager.com") || url.includes("google-analytics.com")) {
      thirdPartyAnalyticsRequests.push(url);
    }
  });

  const response = await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `${route} (${viewportName}) must return HTTP 200`);

  // Check GDPR consent banner is shown pre-consent and zero GA4 requests occurred
  const consentBanner = page.locator("#sc-consent-banner");
  await consentBanner.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(
    thirdPartyAnalyticsRequests.length,
    0,
    `${route} (${viewportName}) must make zero pre-consent GA4 requests`
  );

  // Dismiss via "Essential only" so the full-page visual screenshot is unobstructed
  await page.locator('[data-consent-action="essential"]').click();
  await consentBanner.waitFor({ state: "hidden", timeout: 5000 });

  // Verify core text, independence guarantee, and hard bans
  const bodyText = await page.evaluate(() => document.body.innerText);
  const expectedGuarantee = lang === "de" ? INDEPENDENCE_GUARANTEE_DE : INDEPENDENCE_GUARANTEE_EN;
  assert(
    bodyText.includes(expectedGuarantee),
    `${route} (${viewportName}) missing exact independence guarantee`
  );
  assert(!/odoo/i.test(bodyText), `${route} (${viewportName}) must never mention Odoo`);

  // Verify primary /check CTA & wals.pro/termin CTA visibility and attributes
  const expectedCheckHref = lang === "de" ? "/check" : "/en/check";
  const selfCheckCta = page.locator(`a[data-analytics-cta="self_check"]`).first();
  assert.equal(await selfCheckCta.isVisible(), true, `${route} (${viewportName}) self-check CTA must be visible`);
  assert.equal(await selfCheckCta.getAttribute("href"), expectedCheckHref);

  const bookCallCta = page.locator(`a[data-analytics-cta="book_call"]`).first();
  assert.equal(await bookCallCta.isVisible(), true, `${route} (${viewportName}) book-call CTA must be visible`);
  assert.equal(await bookCallCta.getAttribute("href"), WALSPRO_BOOKING_URL);
  assert.equal(await bookCallCta.getAttribute("target"), "_blank");
  assert.equal(await bookCallCta.getAttribute("rel"), "noopener noreferrer");

  // Verify zero horizontal overflow
  const overflowMetrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  assert(
    overflowMetrics.scrollWidth <= overflowMetrics.innerWidth,
    `${route} (${viewportName}) horizontal overflow: scrollWidth=${overflowMetrics.scrollWidth} > innerWidth=${overflowMetrics.innerWidth}`
  );

  // Verify computed background is dark mode
  const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bgColor, "rgb(20, 20, 20)", `${route} (${viewportName}) expected #141414 obsidian background`);

  // Capture full-page screenshot
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Verify language switcher navigates directly to the sibling route
  const expectedTargetRoute = lang === "de" ? "/en/for-merchants" : "/for-merchants";
  const langToggle = page.locator(".btn-lang");
  assert.equal(await langToggle.isVisible(), true, `${route} (${viewportName}) language toggle must be visible`);
  assert.equal(await langToggle.getAttribute("href"), expectedTargetRoute);
  await Promise.all([
    page.waitForURL((url) => url.pathname === expectedTargetRoute),
    langToggle.click()
  ]);
  const toggledLang = await page.evaluate(() => document.documentElement.lang);
  assert.equal(toggledLang, lang === "de" ? "en" : "de");

  // Collect any CSP violations recorded during the entire session
  const recordedCsp = await page.evaluate(() => window.__cspViolations || []);
  cspViolations.push(...recordedCsp);

  await context.close();

  assert.deepEqual(consoleErrors, [], `${route} (${viewportName}) console errors: ${consoleErrors.join("; ")}`);
  assert.deepEqual(pageErrors, [], `${route} (${viewportName}) page errors: ${pageErrors.join("; ")}`);
  assert.deepEqual(cspViolations, [], `${route} (${viewportName}) CSP violations: ${JSON.stringify(cspViolations)}`);

  console.log(`PASS [${lang.toUpperCase()} ${viewportName}] ${route} -> ${screenshotPath}`);
}

function resolveChromiumExecutable(chromium) {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }
  try {
    const defaultPath = chromium.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) return undefined;
  } catch {
    // fall through to cached lookup
  }

  const cacheDirs = [
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright")
  ];
  for (const cacheDir of cacheDirs) {
    if (!fs.existsSync(cacheDir)) continue;
    const entries = fs
      .readdirSync(cacheDir)
      .filter((name) => name.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse();
    for (const entry of entries) {
      const base = path.join(cacheDir, entry);
      for (const rel of [
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
        "chrome-mac/headless_shell",
        "chrome-linux/headless_shell",
        "chrome-headless-shell-linux64/chrome-headless-shell"
      ]) {
        const candidate = path.join(base, rel);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const { server, origin } = await startServer();
  const executablePath = resolveChromiumExecutable(chromium);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

  try {
    const matrix = [
      {
        route: "/for-merchants",
        lang: "de",
        viewportName: "desktop",
        viewport: { width: 1440, height: 900 },
        screenshotPath: path.join(SCREENSHOT_DIR, "for-merchants-de-desktop.png")
      },
      {
        route: "/for-merchants",
        lang: "de",
        viewportName: "mobile",
        viewport: { width: 375, height: 812 },
        screenshotPath: path.join(SCREENSHOT_DIR, "for-merchants-de-mobile.png")
      },
      {
        route: "/en/for-merchants",
        lang: "en",
        viewportName: "desktop",
        viewport: { width: 1440, height: 900 },
        screenshotPath: path.join(SCREENSHOT_DIR, "for-merchants-en-desktop.png")
      },
      {
        route: "/en/for-merchants",
        lang: "en",
        viewportName: "mobile",
        viewport: { width: 375, height: 812 },
        screenshotPath: path.join(SCREENSHOT_DIR, "for-merchants-en-mobile.png")
      }
    ];

    for (const item of matrix) {
      await verifyViewport({ browser, origin, ...item });
    }
    console.log("All 4 Playwright E2E checks & screenshots passed cleanly.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error("E2E verification failed:", err);
  process.exit(1);
});
