import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";
import { escapeHtml } from "../src/auth/pages.js";
import {
  buildAiLinks,
  buildInstallLinks,
  buildStartPrompt,
  encodePrompt,
  getFaq,
  getHowTo,
  getWishes
} from "../src/web/content.js";
import { getSimScenarios, resolveDemoMedia } from "../src/web/landing.js";
import {
  AMAZON_MARKETPLACES,
  PLATFORM_NAMES,
  getComfortFeatures,
  getPlatformRows,
  renderPlatformMatrixMarkdown
} from "../src/web/platforms.js";

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
    // Strict CSP: the only script without src is the JSON-LD data block; no inline styles or handlers
    const inlineScripts = de.text.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) ?? [];
    expect(inlineScripts).toEqual(['<script type="application/ld+json">']);
    expect(de.text).not.toMatch(/<style[\s>]/i);
    expect(de.text).not.toMatch(/\sstyle="/i);
    expect(de.text).not.toMatch(/\son[a-z]+="/i);
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
    expect(en.text).toContain(
      "Independent open-source tool by wals.pro, not affiliated with or endorsed by Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware, or Adobe (Magento)."
    );
    expect(de.text).toContain(
      "Unabhängiges Open-Source-Tool von wals.pro, nicht verbunden mit oder unterstützt von Shopify, WooCommerce (Automattic), Amazon, BigCommerce, Shopware oder Adobe (Magento)."
    );
    // No outdated "Shopify only" positioning anywhere on the landing page
    for (const html of [de.text, en.text]) {
      expect(html).not.toMatch(/community tool for Shopify|Community-Tool für Shopify|only Shopify|nur Shopify-Shops/i);
    }

    const css = await request(app).get("/assets/landing.css").expect(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.headers["x-content-type-options"]).toBe("nosniff");
    expect(css.text).toContain("--walspro-accent: #ff1f4d");
    expect(css.text).toContain("--walspro-bg: #141414");
    expect(css.text).toContain("--walspro-bg-deep: #090909");
    expect(css.text).toContain("--walspro-on-accent: #000000");
    expect(css.text).toContain("prefers-reduced-motion");

    const js = await request(app).get("/assets/hero-flow.js").expect(200);
    expect(js.headers["content-type"]).toContain("application/javascript");
    expect(js.headers["x-content-type-options"]).toBe("nosniff");
    expect(js.text).toContain("prefers-reduced-motion");
    expect(js.text).not.toContain("window.prompt");

    const mark = await request(app).get("/assets/walspro-mark.svg").expect(200);
    expect(mark.headers["content-type"]).toContain("image/svg+xml");

    const billing = await request(app).get("/billing?lang=de").expect(200);
    expect(billing.text).toContain("--walspro-accent:#ff1f4d");
    expect(billing.text).toContain("--walspro-bg:#141414");
  });

  it("speaks to shoppers first: consumer hero, how-it-works, use cases, pricing, FAQ; developer info compact at the bottom", async () => {
    const { app } = makeLandingApp();

    const de = await request(app).get("/?lang=de").expect(200);
    expect(de.headers["content-language"]).toBe("de");
    expect(de.text).toContain("Lass Claude &amp; ChatGPT");
    expect(de.text).toContain("deinen Warenkorb füllen.");
    expect(de.text).toContain(
      "Sag deiner KI einfach, was du suchst – sie findet die passenden Produkte &amp; Größen in echten Online-Shops und gibt dir einen fertigen Warenkorb-Link. Du prüfst und bezahlst selbst."
    );
    expect(de.text).toContain("In 30 Sekunden mit Claude oder ChatGPT einkaufen");
    expect(de.text).toContain("KI Shopping Assistent");
    expect(de.text).toContain("Black Friday");
    expect(de.text).toContain("Adventskalender");
    expect(de.text).toContain("SNOCKS");
    expect(de.text).toContain("KERNenergie");
    expect(de.text).toContain("PURELEI");
    expect(de.text).toContain("Für Entwickler &amp; Self-Hosting");
    expect(de.text).toContain("Shopify MCP");
    expect(de.text).toContain("Agentic Commerce");
    expect(de.text).toContain("server.json");
    expect(de.text).toContain("npx -y shopcart-mcp");

    // Consumer sections come first; the developer section is the last one before the footer
    const order = ['id="top"', 'id="demo"', 'id="how"', 'id="examples"', 'id="pricing"', 'id="faq"', 'id="developers"', "<footer"].map(
      (marker) => de.text.indexOf(marker)
    );
    expect(order.every((pos) => pos > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // No developer jargon above the fold (hero)
    const hero = de.text.slice(de.text.indexOf('id="top"'), de.text.indexOf('id="demo"'));
    expect(hero).not.toMatch(/OAuth|npx|RFC|JSON|stdio|server\.json/);

    // Shopping moments on the wave instead of RFC codes; brand always lowercase
    expect(hero).toContain("Warenkorb bereit ✓");
    expect(hero).toContain("Checkout-Link");
    expect(de.text).not.toMatch(/Wals\.pro|WALS\.PRO/);

    const en = await request(app).get("/?lang=en").expect(200);
    expect(en.headers["content-language"]).toBe("en");
    expect(en.text).toContain("Let Claude &amp; ChatGPT");
    expect(en.text).toContain("fill your shopping cart.");
    expect(en.text).toContain(
      "Tell your AI what you&#39;re looking for — it finds real products, sizes, and prices in online stores and hands you a ready-to-review cart link. You stay in full control of checkout."
        .replace("&#39;", "'")
    );
    expect(en.text).toContain("Shop with Claude or ChatGPT in 30 seconds");
    expect(en.text).toContain("AI shopping assistant");
    expect(en.text).toContain("For developers &amp; self-hosting");
    expect(en.text).not.toMatch(/Wals\.pro|WALS\.PRO/);
  });

  it("offers an honest 2-click connect plus prefilled start-prompt deeplinks into Claude, ChatGPT & Perplexity, in the hero and after the demo", async () => {
    const { app, config } = makeLandingApp();
    const expectedDe = buildStartPrompt(config, "de");
    expect(expectedDe).toContain("Verbinde ShopCart (https://shopcart.wals.pro/mcp) für mich");
    expect(expectedDe).toContain("https://shopcart.wals.pro/llms.txt");
    expect(expectedDe).toContain("Wunsch-Shop");

    const de = await request(app).get("/?lang=de").expect(200);
    expect(de.text.match(/data-launcher/g)).toHaveLength(2);
    expect(de.text.match(/Lass meine KI das einrichten/g)?.length).toBeGreaterThanOrEqual(2);
    for (const label of [
      "Mit Claude verbinden",
      "Mit ChatGPT verbinden",
      "In Claude starten",
      "In ChatGPT starten",
      "In Perplexity starten",
      "Startprompt für jede andere KI kopieren"
    ]) {
      expect(de.text.match(new RegExp(`<span>${label}</span>`, "g"))).toHaveLength(2);
    }

    // Step 1 "Einmalig verbinden": copies the connector URL and opens the AI's connector settings.
    // No fake "1-click install" promise: neither Claude nor ChatGPT lets a website install a custom connector.
    expect(
      de.text.match(
        /data-connect="claude" data-connect-url="https:\/\/shopcart\.wals\.pro\/mcp"[^>]*href="https:\/\/claude\.ai\/settings\/connectors" target="_blank" rel="noopener"/g
      )
    ).toHaveLength(2);
    expect(
      de.text.match(
        /data-connect="chatgpt" data-connect-url="https:\/\/shopcart\.wals\.pro\/mcp"[^>]*href="https:\/\/chatgpt\.com\/#settings\/Connectors" target="_blank" rel="noopener"/g
      )
    ).toHaveLength(2);
    expect(de.text).toContain("Link kopiert ✓ – einfach in Claude einfügen &amp; verbinden.");
    expect(de.text.match(/data-connect-status role="status" aria-live="polite"/g)).toHaveLength(2);
    expect(de.text.indexOf("Einmalig verbinden")).toBeLessThan(de.text.indexOf("Sofort losshoppen"));
    expect(de.text).not.toMatch(/1[- ]Klick[- ]Connect|automatisch installiert/i);
    const encoded = encodePrompt(expectedDe);
    expect(encoded).not.toMatch(/['()"<>&\s]/);
    expect(de.text).toContain(`href="https://claude.ai/new?q=${encoded}"`);
    expect(de.text).toContain(`href="https://chatgpt.com/?q=${encoded}"`);
    expect(de.text).toContain(`href="https://www.perplexity.ai/search?q=${encoded}"`);
    expect(de.text).toContain('data-copied-label="Kopiert ✓"');
    expect(de.text).toContain('data-copy-target="mcp-url-hero"');
    expect(de.text).toContain('<code class="url-copy-value" id="mcp-url-hero">https://shopcart.wals.pro/mcp</code>');

    // Wish chips make the prompt concrete; every chip carries a full prompt tail
    const deWishes = getWishes("de");
    expect(deWishes.map((w) => w.label)).toEqual([
      "SNOCKS Socken-Bundle",
      "KERNenergie Adventskalender",
      "PURELEI Geschenk unter 50 €",
      "Eigener Wunsch-Shop"
    ]);
    for (const wish of deWishes) {
      expect(de.text).toContain(`>${wish.label}</button>`);
      expect(wish.tail.length).toBeGreaterThan(20);
    }
    expect(buildAiLinks(buildStartPrompt(config, "de", deWishes[0]!.tail)).claude).toMatch(
      /^https:\/\/claude\.ai\/new\?q=Verbinde%20ShopCart%20%28https%3A%2F%2Fshopcart\.wals\.pro%2Fmcp%29/
    );

    const en = await request(app).get("/?lang=en").expect(200);
    const expectedEn = buildStartPrompt(config, "en");
    expect(en.text).toContain(`href="https://claude.ai/new?q=${encodePrompt(expectedEn)}"`);
    expect(en.text).toContain(`href="https://chatgpt.com/?q=${encodePrompt(expectedEn)}"`);
    expect(en.text.match(/Let my AI set this up for me/g)?.length).toBeGreaterThanOrEqual(2);
    for (const label of ["Connect to Claude", "Connect to ChatGPT", "Start in Claude", "Start in ChatGPT"]) {
      expect(en.text.match(new RegExp(`<span>${label}</span>`, "g"))).toHaveLength(2);
    }
    expect(en.text).toContain("Link copied ✓ – just paste it into Claude and connect.");

    // Native 1-click install deeplinks only where the app supports them (developer section)
    const install = buildInstallLinks(config);
    expect(install.cursor).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=shopcart&config=[A-Za-z0-9%]+$/);
    const cursorConfig = decodeURIComponent(install.cursor.split("config=")[1]!);
    expect(JSON.parse(Buffer.from(cursorConfig, "base64").toString("utf8"))).toEqual({
      url: "https://shopcart.wals.pro/mcp"
    });
    expect(install.vscode.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(install.vscode.slice("vscode:mcp/install?".length)))).toEqual({
      name: "shopcart",
      type: "http",
      url: "https://shopcart.wals.pro/mcp"
    });
    const devSection = en.text.slice(en.text.indexOf('id="developers"'));
    expect(devSection).toContain(`href="${install.cursor.replace(/&/g, "&amp;")}"`);
    expect(devSection).toContain("Install in VS Code");
    // Claude Desktop extension (.mcpb): offered in the launcher (hero + after demo) and in the developer section
    expect(en.text.match(/href="\/downloads\/shopcart-mcp\.mcpb" download/g)).toHaveLength(3);
    await request(app).get("/downloads/shopcart-mcp.mcpb").expect(200);
    expect(en.text.slice(0, en.text.indexOf('id="developers"'))).not.toContain("cursor://");
    expect(getWishes("en").map((w) => w.label)).toEqual([
      "Allbirds sneakers",
      "Holiday gift under $50",
      "SNOCKS bundle",
      "My own store"
    ]);
    expect(en.text).toContain('data-copied-label="Copied ✓"');
  });

  it("shows all 7 connected platforms in an honest capability matrix plus the comfort features (DE + EN)", async () => {
    const { app } = makeLandingApp();
    for (const lang of ["de", "en"] as const) {
      const res = await request(app).get(`/?lang=${lang}`).expect(200);
      const html = res.text;

      // Hero strip names every platform and links to the matrix
      const heroStrip = html.slice(html.indexOf('class="hero-platforms"'), html.indexOf('id="shops"'));
      for (const name of PLATFORM_NAMES) {
        expect(heroStrip).toContain(`>${escapeHtml(name)}<`);
      }

      // Matrix section: 7 rows, each with platform name, handoff badge and honest handoff text
      const shops = html.slice(html.indexOf('id="shops"'), html.indexOf('id="comfort"'));
      const rows = getPlatformRows(lang);
      expect(rows.map((row) => row.id)).toEqual([
        "shopify",
        "woocommerce",
        "bigcommerce",
        "amazon",
        "shopware",
        "magento",
        "universal"
      ]);
      expect(shops.match(/class="matrix-row"/g) ?? []).toHaveLength(7);
      for (const row of rows) {
        expect(shops).toContain(escapeHtml(row.name));
        expect(shops).toContain(escapeHtml(row.handoffLabel));
        expect(shops).toContain(`handoff-${row.handoffLevel}`);
      }
      // Honest handoff levels: only Shopify and Amazon get one link for the whole cart
      expect(rows.filter((row) => row.handoffLevel === "cart").map((row) => row.id)).toEqual(["shopify"]);
      expect(rows.filter((row) => row.handoffLevel === "amazon").map((row) => row.id)).toEqual(["amazon"]);
      expect(rows.filter((row) => row.handoffLevel === "sequence").map((row) => row.id)).toEqual([
        "woocommerce",
        "bigcommerce"
      ]);
      expect(rows.filter((row) => row.handoffLevel === "product").map((row) => row.id)).toEqual([
        "shopware",
        "magento",
        "universal"
      ]);
      expect(shops).toContain(AMAZON_MARKETPLACES);
      expect(AMAZON_MARKETPLACES.split(", ")).toHaveLength(10);

      // Comfort section: all six features visible
      const comfort = html.slice(html.indexOf('id="comfort"'), html.indexOf('id="examples"'));
      const features = getComfortFeatures(lang);
      expect(features.map((f) => f.id)).toEqual(["policies", "deals", "connect", "desktop", "login", "readonly"]);
      for (const feature of features) {
        expect(comfort).toContain(escapeHtml(feature.title));
      }

      // Developer section documents all six live tools
      for (const tool of [
        "inspect_store",
        "list_collections",
        "search_products",
        "get_product",
        "get_store_policies",
        "create_cart_link"
      ]) {
        expect(html).toContain(tool);
      }
      // Strict CSP still holds for the new sections
      expect(shops + comfort).not.toMatch(/ style="| on[a-z]+="|<style/);
      // Team-Direktive 8 & brand spelling
      expect(html).not.toMatch(/DataForSEO|Suchvolumen|search volume/i);
      expect(html).not.toMatch(/Wals\.pro|WALS\.PRO/);
    }

    const md = renderPlatformMatrixMarkdown("en");
    expect(md.split("\n").filter((line) => line.startsWith("| ")).length).toBe(9); // header + separator + 7 platform rows
  });

  it("embeds Schema.org JSON-LD (SoftwareApplication, FAQPage, HowTo) in sync with the visible FAQ and steps", async () => {
    const { app, config } = makeLandingApp();

    for (const lang of ["de", "en"] as const) {
      const res = await request(app).get(`/?lang=${lang}`).expect(200);
      const match = res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      expect(match).not.toBeNull();
      const data = JSON.parse(match![1]!) as { "@context": string; "@graph": Array<Record<string, any>> };
      expect(data["@context"]).toBe("https://schema.org");
      const byType = (type: string) => data["@graph"].find((node) => node["@type"] === type);

      const app_ = byType("SoftwareApplication")!;
      expect(app_.name).toBe("ShopCart");
      expect(app_.url).toBe(`https://shopcart.wals.pro/?lang=${lang}`);
      expect(JSON.stringify(app_.offers)).toContain('"price":"0"');
      expect(app_.inLanguage).toBe(lang);

      const faqPage = byType("FAQPage")!;
      const faq = getFaq(config, lang);
      expect(faq).toHaveLength(8);
      expect(faqPage.mainEntity).toHaveLength(8);
      // SoftwareApplication lists every connected platform and the comfort features
      for (const row of getPlatformRows(lang)) {
        expect(app_.featureList.some((f: string) => f.startsWith(`${row.name}:`))).toBe(true);
      }
      for (const feature of getComfortFeatures(lang)) {
        expect(app_.featureList).toContain(feature.title);
      }
      faq.forEach((item, idx) => {
        expect(faqPage.mainEntity[idx]["@type"]).toBe("Question");
        expect(faqPage.mainEntity[idx].name).toBe(item.q);
        expect(faqPage.mainEntity[idx].acceptedAnswer.text).toBe(item.a);
        // ...and the same question is visible in the accordion
        expect(res.text).toContain(`<summary><span>${escapeHtml(item.q)}</span>`);
        expect(res.text).toContain(`<p>${escapeHtml(item.a)}</p>`);
      });

      const howTo = byType("HowTo")!;
      const how = getHowTo(lang);
      expect(howTo.name).toBe(how.name);
      expect(howTo.step).toHaveLength(how.steps.length);
      how.steps.forEach((step, idx) => {
        expect(howTo.step[idx].name).toBe(step.name);
        expect(res.text).toContain(`<h3>${escapeHtml(step.name)}</h3>`);
      });

      // No fabricated ratings or review counts
      expect(match![1]).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
    }

    const de = await request(app).get("/?lang=de").expect(200);
    expect(de.text).toContain('"name":"In 30 Sekunden mit Claude oder ChatGPT einkaufen"');
  });

  it("falls back to a consumer live-shopping simulation that only uses live-verified example carts instead of developer JSON", async () => {
    const { app } = makeLandingApp();
    const de = await request(app).get("/?lang=de").expect(200);
    const sim = de.text.slice(de.text.indexOf('id="sim-player"'), de.text.indexOf('class="demo-cta"'));
    expect(sim).toContain("Dein Warenkorb");
    expect(sim).toContain("Sneaker Socken | White");
    expect(sim).toContain("67,47 €");
    expect(sim).toContain('href="https://snocks.com/cart/44434567725323:2,19729211981894:1?storefront=true"');
    expect(sim).toContain("Du prüfst und bezahlst selbst im Shop");
    expect(sim).not.toMatch(/tools\/call|jsonrpc|inspect_store|variant_id/);

    // Allowlist: the only example cart links that may ever appear on the site. Each one was opened
    // live in a browser and resolves (302 -> /cart?cart_link_id=...) to a filled merchant cart.
    const VERIFIED_CARTS: Record<string, { url: string; total: { de?: string; en?: string } }> = {
      snocks: {
        url: "https://snocks.com/cart/44434567725323:2,19729211981894:1?storefront=true",
        total: { de: "67,47 €", en: "€67.47" }
      },
      kernenergie: {
        url: "https://kern-energie.com/cart/49277053370627:1,49277057696003:1?storefront=true",
        total: { de: "37,90 €", en: "€37.90" }
      },
      purelei: {
        url: "https://purelei.com/cart/57560981766409:1,55956947566857:1?storefront=true",
        total: { de: "167,83 €" }
      },
      allbirds: {
        url: "https://www.allbirds.com/cart/41243558707280:1?storefront=true",
        total: { en: "$110.00" }
      }
    };
    expect(getSimScenarios("de").map((s) => s.id)).toEqual(["snocks", "kernenergie", "purelei"]);
    expect(getSimScenarios("en").map((s) => s.id)).toEqual(["allbirds", "snocks", "kernenergie"]);
    for (const lang of ["de", "en"] as const) {
      for (const sc of getSimScenarios(lang)) {
        const verified = VERIFIED_CARTS[sc.id];
        expect(verified, sc.id).toBeDefined();
        expect(sc.cartUrl).toBe(verified!.url);
        expect(sc.total).toBe(verified!.total[lang]);
        expect(sc.steps).toHaveLength(4);
      }
      // No other merchant cart permalink anywhere on the rendered page (e.g. the old shop.allbirds.eu bug)
      const page = (await request(app).get(`/?lang=${lang}`).expect(200)).text.replace(/&quot;/g, '"');
      const allowed = new Set(Object.values(VERIFIED_CARTS).map((v) => v.url));
      const found = page.match(/https:\/\/[a-z0-9.-]+\/cart\/[0-9][0-9:,]*[^"\s<]*/g) ?? [];
      expect(found.length).toBeGreaterThanOrEqual(3);
      for (const url of found) expect(allowed.has(url), url).toBe(true);
      expect(page).not.toContain("shop.allbirds.eu");
    }
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
