#!/usr/bin/env node
/**
 * Playwright E2E & visual verification suite for the ShopCart Landingpage Connect-UX redesign
 * (Item #86 — `/` DE & `/en` EN).
 *
 * Boots the compiled Express app on an ephemeral localhost port (zero external network calls),
 * verifies Desktop (1440x900) & Mobile (390x844 and 375x812) rendering, WAI-ARIA tabs,
 * mouse + keyboard navigation (ArrowRight/ArrowLeft/Home/End), single visible primary CTA,
 * collapsed <details> disclosure, clipboard copy feedback + live region, zero console/page/CSP
 * errors, zero horizontal overflow, and saves after-screenshots to SCREENSHOT_DIR.
 *
 * Usage:
 *   pnpm build && node e2e/landing-connect-ux.spec.mjs
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
import { CLAUDE_DIRECTORY_URL } from "../dist/web/content.js";

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/item86-screenshots";

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

function resolveChromiumExecutable(chromium) {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }
  try {
    const defaultPath = chromium.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) return undefined;
  } catch {
    // fall through
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

async function verifyLanding({
  browser,
  origin,
  route,
  lang,
  viewportName,
  viewport,
  dpr,
  screenshotName,
  captureSecondaryStates = false
}) {
  const context = await browser.newContext({
    viewport,
    locale: lang === "de" ? "de-DE" : "en-US",
    colorScheme: "dark",
    deviceScaleFactor: dpr
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const thirdPartyRequests = [];

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
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("request", (req) => {
    try {
      const parsed = new URL(req.url());
      if (parsed.origin !== origin) thirdPartyRequests.push(parsed.href);
    } catch {
      // ignore non-HTTP schemes
    }
  });

  const response = await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `${route} (${viewportName}) must return HTTP 200`);
  assert.equal(
    await page.evaluate(() => document.documentElement.lang),
    lang,
    `${route} (${viewportName}) expected <html lang="${lang}">`
  );

  // Zero pre-consent third-party analytics requests
  const consentBanner = page.locator("#sc-consent-banner");
  await consentBanner.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(thirdPartyRequests.length, 0, `${route} (${viewportName}) must make zero pre-consent requests`);

  // Dismiss consent banner so screenshots are unobstructed
  await page.locator('[data-consent-action="essential"]').click();
  await consentBanner.waitFor({ state: "hidden", timeout: 5000 });

  // No Odoo mention anywhere
  const bodyText = await page.evaluate(() => document.body.innerText);
  assert(!/odoo/i.test(bodyText), `${route} (${viewportName}) must never mention Odoo`);

  // Zero horizontal page overflow
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  assert(
    overflow.scrollWidth <= overflow.innerWidth,
    `${route} (${viewportName}) horizontal overflow: ${overflow.scrollWidth} > ${overflow.innerWidth}`
  );

  const switcher = page.locator("#start");
  const tabs = switcher.locator('[role="tab"]');
  const panels = switcher.locator('[role="tabpanel"]');
  assert.equal(await tabs.count(), 4, `${route} (${viewportName}) must render 4 client tabs`);
  assert.equal(await panels.count(), 4, `${route} (${viewportName}) must render 4 tabpanels`);

  // Single-row tablist check (no multi-row wrapping)
  const tabTops = await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  assert(
    Math.max(...tabTops) - Math.min(...tabTops) <= 2,
    `${route} (${viewportName}) tabs must stay on a single row, got tops: ${JSON.stringify(tabTops)}`
  );

  // Default state: Claude tab active, 1 visible primary CTA, collapsed <details>, 20 calls/day
  const claudeTab = page.locator("#connect-hero-tab-claude");
  const claudePanel = page.locator("#connect-hero-panel-claude");
  assert.equal(await claudeTab.getAttribute("aria-selected"), "true");
  assert.equal(await claudePanel.isVisible(), true);
  assert.equal(await page.locator("#connect-hero-panel-chatgpt").isVisible(), false);
  assert.equal(await page.locator("#connect-hero-panel-cli").isVisible(), false);
  assert.equal(await page.locator("#connect-hero-panel-other").isVisible(), false);

  const countVisiblePrimaryCtas = async () => {
    const ctas = switcher.locator(".btn-connect-primary");
    const total = await ctas.count();
    let visible = 0;
    for (let i = 0; i < total; i++) {
      if (await ctas.nth(i).isVisible()) visible++;
    }
    return visible;
  };

  const visiblePrimaryCtas = await countVisiblePrimaryCtas();
  assert.equal(visiblePrimaryCtas, 1, `${route} (${viewportName}) must show at most 1 primary CTA on Claude tab`);

  const claudeCta = claudePanel.locator("a.btn-connect-primary");
  assert.equal(await claudeCta.getAttribute("href"), CLAUDE_DIRECTORY_URL);
  assert.equal(
    (await claudeCta.innerText()).trim().startsWith(lang === "de" ? "In Claude verbinden" : "Connect in Claude"),
    true
  );

  const claudeText = (await claudePanel.innerText()).replace(/\u00a0/g, " ");
  assert(
    claudeText.includes(lang === "de" ? "20 Calls/Tag" : "20 calls/day"),
    `${route} (${viewportName}) must show 20 calls/day free tier`
  );

  // <details> initially closed
  const details = claudePanel.locator("details.connect-details");
  assert.equal(await details.evaluate((el) => el.open), false, "Manual/.mcpb <details> must start closed");
  assert.equal(await claudePanel.locator('a[href="/downloads/shopcart-mcp.mcpb"]').isVisible(), false);

  // Measure heights BEFORE opening details or switching tabs
  const connectBox = await switcher.boundingBox();
  const heroBox = await page.locator("section.hero").boundingBox();
  const metrics = {
    connectHeight: Math.round(connectBox?.height ?? 0),
    heroHeight: Math.round(heroBox?.height ?? 0)
  };

  // Capture primary after-screenshot (same framing as before-screenshots: section.hero)
  if (screenshotName) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.locator("section.hero").screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName) });
  }

  // Expand <details> and verify manual URL + .mcpb download link become visible
  await details.locator("summary").click();
  assert.equal(await details.evaluate((el) => el.open), true, "Manual/.mcpb <details> must open on click");
  assert.equal(await claudePanel.locator('a[href="/downloads/shopcart-mcp.mcpb"]').isVisible(), true);
  assert.equal(await claudePanel.locator("#connect-hero-url-claude").isVisible(), true);

  if (captureSecondaryStates) {
    await page.locator("section.hero").screenshot({
      path: path.join(SCREENSHOT_DIR, "after-de-desktop-details-open.png")
    });
  }

  // Close <details> again
  await details.locator("summary").click();
  assert.equal(await details.evaluate((el) => el.open), false);

  // Mouse-click through all 4 tabs and verify max 1 primary CTA + copy feedback
  const tabIds = [
    { tab: "#connect-hero-tab-chatgpt", panel: "#connect-hero-panel-chatgpt" },
    { tab: "#connect-hero-tab-cli", panel: "#connect-hero-panel-cli" },
    { tab: "#connect-hero-tab-other", panel: "#connect-hero-panel-other" },
    { tab: "#connect-hero-tab-claude", panel: "#connect-hero-panel-claude" }
  ];

  for (const step of tabIds) {
    await page.locator(step.tab).click();
    assert.equal(await page.locator(step.tab).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(step.panel).isVisible(), true);

    const primaryCount = await countVisiblePrimaryCtas();
    assert.equal(primaryCount, 1, `${step.tab} (${viewportName}) must have exactly 1 visible primary CTA`);

    if (step.tab === "#connect-hero-tab-chatgpt") {
      assert((await page.locator(step.panel).innerText()).includes("In review"));
      if (captureSecondaryStates) {
        await page.locator("section.hero").screenshot({
          path: path.join(SCREENSHOT_DIR, "after-de-desktop-tabs-chatgpt.png")
        });
      }
      // Verify copy button feedback + accessible live region
      const copyBtn = page.locator(`${step.panel} [data-copy-target]`);
      await copyBtn.click();
      await page.waitForFunction(
        (sel) => document.querySelector(sel)?.getAttribute("data-copied") === "true",
        `${step.panel} [data-copy-target]`
      );
      const expectedCopied = lang === "de" ? "Kopiert ✓" : "Copied ✓";
      assert.equal((await copyBtn.innerText()).trim(), expectedCopied);
      await page.waitForFunction(
        (expected) => document.querySelector("#start [data-copy-live]")?.textContent === expected,
        expectedCopied
      );
    }

    if (step.tab === "#connect-hero-tab-other") {
      const guidesLink = page.locator(`${step.panel} a.connect-inline-link`);
      assert.equal(await guidesLink.getAttribute("href"), lang === "de" ? "/guides" : "/en/guides");
    }
  }

  // Keyboard navigation: ArrowRight through all 4 tabs, then ArrowLeft, End, Home
  await claudeTab.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#connect-hero-tab-chatgpt").getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "connect-hero-tab-chatgpt");

  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#connect-hero-tab-cli").getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "connect-hero-tab-cli");

  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#connect-hero-tab-other").getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "connect-hero-tab-other");

  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#connect-hero-tab-cli").getAttribute("aria-selected"), "true");

  await page.keyboard.press("Home");
  assert.equal(await claudeTab.getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "connect-hero-tab-claude");

  await page.keyboard.press("End");
  assert.equal(await page.locator("#connect-hero-tab-other").getAttribute("aria-selected"), "true");

  // Re-check horizontal overflow after interactions
  const overflowAfter = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  assert(
    overflowAfter.scrollWidth <= overflowAfter.innerWidth,
    `${route} (${viewportName}) overflow after tab interactions`
  );

  const cspViolations = await page.evaluate(() => window.__cspViolations || []);
  await context.close();

  assert.deepEqual(consoleErrors, [], `${route} (${viewportName}) console errors: ${consoleErrors.join("; ")}`);
  assert.deepEqual(pageErrors, [], `${route} (${viewportName}) page errors: ${pageErrors.join("; ")}`);
  assert.deepEqual(cspViolations, [], `${route} (${viewportName}) CSP violations: ${JSON.stringify(cspViolations)}`);

  console.log(
    `PASS [${lang.toUpperCase()} ${viewportName}] ${route} -> connect=${metrics.connectHeight}px, hero=${metrics.heroHeight}px`
  );
  return metrics;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const { server, origin } = await startServer();
  const executablePath = resolveChromiumExecutable(chromium);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

  try {
    const results = {};
    const matrix = [
      {
        key: "de-desktop",
        route: "/",
        lang: "de",
        viewportName: "desktop-1440",
        viewport: { width: 1440, height: 900 },
        dpr: 1,
        screenshotName: "after-de-desktop.png",
        captureSecondaryStates: true
      },
      {
        key: "de-mobile-390",
        route: "/",
        lang: "de",
        viewportName: "mobile-390",
        viewport: { width: 390, height: 844 },
        dpr: 2,
        screenshotName: "after-de-mobile.png"
      },
      {
        key: "de-mobile-375",
        route: "/",
        lang: "de",
        viewportName: "mobile-375",
        viewport: { width: 375, height: 812 },
        dpr: 2,
        screenshotName: null
      },
      {
        key: "en-desktop",
        route: "/en",
        lang: "en",
        viewportName: "desktop-1440",
        viewport: { width: 1440, height: 900 },
        dpr: 1,
        screenshotName: "after-en-desktop.png"
      },
      {
        key: "en-mobile-390",
        route: "/en",
        lang: "en",
        viewportName: "mobile-390",
        viewport: { width: 390, height: 844 },
        dpr: 2,
        screenshotName: "after-en-mobile.png"
      },
      {
        key: "en-mobile-375",
        route: "/en",
        lang: "en",
        viewportName: "mobile-375",
        viewport: { width: 375, height: 812 },
        dpr: 2,
        screenshotName: null
      }
    ];

    for (const item of matrix) {
      results[item.key] = await verifyLanding({ browser, origin, ...item });
    }
    console.log("METRICS:", JSON.stringify(results, null, 2));
    console.log("All 6 Landingpage Connect-UX Playwright E2E checks & screenshots passed cleanly.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error("Landingpage Connect-UX E2E failed:", err);
  process.exit(1);
});
