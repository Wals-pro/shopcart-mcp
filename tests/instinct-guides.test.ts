import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_FILE = path.join(ROOT_DIR, "skills", "shopcart-mcp", "SKILL.md");

function makeApp() {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00"
  });
  return createApp({ config, store: new MemoryStore() });
}

describe("Instinct & Autonomous Agent support (DE/EN guides, #setup tab, /SKILL.md, /llms*.txt)", () => {
  it("serves both DE and EN Instinct guides with reciprocal hreflang, honest 2026 facts, WhatsApp/iMessage prompt, and gateway paths", async () => {
    const app = makeApp();

    const deRes = await request(app).get("/guides/instinct-warenkorb-erstellen").expect(200);
    expect(deRes.text).toContain("Kann Instinct einen Warenkorb erstellen? (Anleitung 2026)");
    expect(deRes.text).toContain("Spear Street Technology");
    expect(deRes.text).toContain("Open Instinct");
    expect(deRes.text).toContain("MewCP");
    expect(deRes.text).toContain("Agensi");
    expect(deRes.text).toContain("https://shopcart.wals.pro/SKILL.md");
    expect(deRes.text).toContain("https://shopcart.wals.pro/mcp");
    expect(deRes.text).toContain("npx -y shopcart-mcp");
    expect(deRes.text).toContain("WhatsApp");
    expect(deRes.text).toContain(
      '<link rel="alternate" hreflang="de" href="https://shopcart.wals.pro/guides/instinct-warenkorb-erstellen">'
    );
    expect(deRes.text).toContain(
      '<link rel="alternate" hreflang="en" href="https://shopcart.wals.pro/guides/instinct-shopping-cart">'
    );
    expect(deRes.text).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://shopcart.wals.pro/guides/instinct-shopping-cart">'
    );

    const enRes = await request(app).get("/guides/instinct-shopping-cart").expect(200);
    expect(enRes.text).toContain("Can Instinct AI Build a Shopping Cart? (Safe Read-Only Setup 2026)");
    expect(enRes.text).toContain("Spear Street Technology");
    expect(enRes.text).toContain("Open Instinct");
    expect(enRes.text).toContain("MewCP");
    expect(enRes.text).toContain("Agensi");
    expect(enRes.text).toContain("https://shopcart.wals.pro/SKILL.md");
    expect(enRes.text).toContain("https://shopcart.wals.pro/mcp");
    expect(enRes.text).toContain("npx -y shopcart-mcp");
    expect(enRes.text).toContain("WhatsApp");
    expect(enRes.text).toContain(
      '<link rel="alternate" hreflang="de" href="https://shopcart.wals.pro/guides/instinct-warenkorb-erstellen">'
    );
    expect(enRes.text).toContain(
      '<link rel="alternate" hreflang="en" href="https://shopcart.wals.pro/guides/instinct-shopping-cart">'
    );
    expect(enRes.text).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://shopcart.wals.pro/guides/instinct-shopping-cart">'
    );
  });

  it("renders the Instinct / CLI setup tab inside #setup on both DE and EN landing pages", async () => {
    const app = makeApp();

    for (const [lang, guidePath] of [
      ["de", "/guides/instinct-warenkorb-erstellen"],
      ["en", "/guides/instinct-shopping-cart"]
    ] as const) {
      const res = await request(app).get(`/?lang=${lang}`).expect(200);
      expect(res.text).toContain('id="setup"');
      expect(res.text).toContain('id="tab-instinct"');
      expect(res.text).toContain('aria-labelledby="tab-instinct"');
      expect(res.text).toContain("Instinct / CLI");
      expect(res.text).toContain("npx -y shopcart-mcp inspect snocks.com");
      expect(res.text).toContain("Open Instinct");
      expect(res.text).toContain("MewCP");
      expect(res.text).toContain("Agensi");
      expect(res.text).toContain(`href="${guidePath}"`);
      expect(res.text).toContain('href="/SKILL.md"');
    }
  });

  it("serves /SKILL.md and /skill.md in sync with skills/shopcart-mcp/SKILL.md containing One-Shot CLI & Remote MCP", async () => {
    const app = makeApp();
    const diskSkill = fs.readFileSync(SKILL_FILE, "utf8");

    for (const route of ["/SKILL.md", "/skill.md"]) {
      const res = await request(app).get(route).expect(200);
      expect(res.headers["content-type"]).toBe("text/markdown; charset=utf-8");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.text).toBe(diskSkill);
    }

    for (const required of [
      "https://shopcart.wals.pro/mcp",
      "npx -y shopcart-mcp inspect <store>",
      'npx -y shopcart-mcp search <store> "<query>"',
      "npx -y shopcart-mcp product <store> <handle-or-url>",
      "npx -y shopcart-mcp policies <store>",
      "npx -y shopcart-mcp collections <store>",
      "npx -y shopcart-mcp cart <store> <variantId:qty>",
      "Instinct",
      "Open Instinct",
      "MewCP",
      "Agensi"
    ]) {
      expect(diskSkill).toContain(required);
    }
  });

  it("wires Instinct guides, /SKILL.md, and One-Shot CLI into /guides, /sitemap.xml, /llms.txt, and /llms-full.txt", async () => {
    const app = makeApp();

    const guidesHub = await request(app).get("/guides").expect(200);
    expect(guidesHub.text).toContain('href="/guides/instinct-warenkorb-erstellen"');
    expect(guidesHub.text).toContain('href="/guides/instinct-shopping-cart"');

    const sitemap = await request(app).get("/sitemap.xml").expect(200);
    expect(sitemap.text).toContain("<loc>https://shopcart.wals.pro/guides/instinct-warenkorb-erstellen</loc>");
    expect(sitemap.text).toContain("<loc>https://shopcart.wals.pro/guides/instinct-shopping-cart</loc>");
    expect(sitemap.text).toContain("<loc>https://shopcart.wals.pro/SKILL.md</loc>");

    const llms = await request(app).get("/llms.txt").expect(200);
    expect(llms.text).toContain("https://shopcart.wals.pro/SKILL.md");
    expect(llms.text).toContain("npx -y shopcart-mcp inspect <store>");
    expect(llms.text).toContain("npx -y shopcart-mcp cart <store> <variantId:qty>");
    expect(llms.text).toContain("Instinct");
    expect(llms.text).toContain("MewCP");
    expect(llms.text).toContain("Agensi");
    expect(llms.text).toContain("https://shopcart.wals.pro/guides/instinct-warenkorb-erstellen");
    expect(llms.text).toContain("https://shopcart.wals.pro/guides/instinct-shopping-cart");

    const llmsFull = await request(app).get("/llms-full.txt").expect(200);
    expect(llmsFull.text).toContain("https://shopcart.wals.pro/SKILL.md");
    expect(llmsFull.text).toContain("Spear Street Technology");
    expect(llmsFull.text).toContain("Open Instinct");
    expect(llmsFull.text).toContain("MewCP");
    expect(llmsFull.text).toContain("Agensi");
    expect(llmsFull.text).toContain("https://shopcart.wals.pro/guides/instinct-warenkorb-erstellen");
    expect(llmsFull.text).toContain("https://shopcart.wals.pro/guides/instinct-shopping-cart");
  });
});
