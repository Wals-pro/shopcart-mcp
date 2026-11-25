import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import { resolveDemoMedia } from "../src/web/landing.js";

function makeLandingApp(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00",
    ...extraEnv
  });
  return { config, app: createApp({ config, store: new MemoryStore() }) };
}

describe("Landing page, static assets, CSP & demo video embeds", () => {
  it("serves dark-mode DE & EN landing page with strict CSP, static assets, client tabs, and interactive live simulation", async () => {
    const { app } = makeLandingApp();

    const de = await request(app).get("/?lang=de").expect(200);
    expect(de.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(de.headers["content-security-policy"]).toContain("style-src 'self'");
    expect(de.text).toContain('href="/assets/landing.css');
    expect(de.text).toContain('src="/assets/hero-flow.js');
    expect(de.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(de.text).toContain('id="hero-flow-canvas"');
    expect(de.text).toContain('id="sim-player"');
    expect(de.text).toContain("BLACKFRIDAY");
    expect(de.text).toContain("Claude.ai");
    expect(de.text).toContain("ChatGPT");
    expect(de.text).toContain("Claude Code");
    expect(de.text).toContain("Cursor");
    expect(de.text).toContain("OpenClaw / Local npx");
    expect(de.text).toContain("/.well-known/security.txt");
    expect(de.text).toContain("/privacy?lang=de");
    expect(de.text).toContain("/terms?lang=de");

    const en = await request(app).get("/?lang=en").expect(200);
    expect(en.text).toContain("for Shopify Stores");
    expect(en.text).toContain("Independent community tool for Shopify stores");

    const css = await request(app).get("/assets/landing.css").expect(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.headers["x-content-type-options"]).toBe("nosniff");

    const js = await request(app).get("/assets/hero-flow.js").expect(200);
    expect(js.headers["content-type"]).toContain("application/javascript");
    expect(js.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("supports zero-redeploy DEMO_VIDEO_URL / _DE / _EN for YouTube, Vimeo, TikTok, and direct mp4/webm", async () => {
    const { config: ytCfg, app: ytApp } = makeLandingApp({
      DEMO_VIDEO_URL_DE: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      DEMO_VIDEO_URL_EN: "https://www.tiktok.com/@walspro/video/7441234567890123456"
    });

    expect(resolveDemoMedia(ytCfg, "de")).toEqual({
      kind: "iframe",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1",
      title: "shopcart-mcp Demo-Video",
      defaultAspect: "16:9"
    });
    expect(resolveDemoMedia(ytCfg, "en")).toEqual({
      kind: "iframe",
      src: "https://www.tiktok.com/embed/v2/7441234567890123456",
      title: "shopcart-mcp TikTok demo",
      defaultAspect: "9:16"
    });

    const ytHtml = await request(ytApp).get("/?lang=de").expect(200);
    expect(ytHtml.text).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(ytHtml.text).not.toContain('id="sim-player"');

    const ttHtml = await request(ytApp).get("/?lang=en").expect(200);
    expect(ttHtml.text).toContain("https://www.tiktok.com/embed/v2/7441234567890123456");
    expect(ttHtml.text).toContain('data-aspect="9:16"');

    const { app: mp4App } = makeLandingApp({
      DEMO_VIDEO_URL: "https://cdn.wals.pro/demos/shopcart-demo.mp4?v=2"
    });
    const mp4Html = await request(mp4App).get("/?lang=de").expect(200);
    expect(mp4Html.text).toContain("<video controls playsinline autoplay muted loop");
    expect(mp4Html.text).toContain("https://cdn.wals.pro/demos/shopcart-demo.mp4?v=2");

    // Unsafe schemes are rejected and safely fall back to simulation
    const { config: badCfg } = makeLandingApp({
      DEMO_VIDEO_URL: "javascript:alert(1)"
    });
    expect(resolveDemoMedia(badCfg, "de")).toEqual({ kind: "simulation" });
  });
});
