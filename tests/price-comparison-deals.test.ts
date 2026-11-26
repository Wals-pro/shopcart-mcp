import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  AwinFeedClient,
  AwinPromotionsClient,
  loadAffiliateFeedConfig,
  mapRegionToAwinCode,
  validateAwinPromotionsUrl
} from "../src/adapters/affiliate-feed/index.js";
import {
  AFFILIATE_DISCLOSURE_NOTE,
  loadAttributionConfig
} from "../src/attribution/links.js";
import {
  buildComparisonLinks,
  buildDealSearchLinks,
  loadComparisonConfig,
  normalizeEan,
  toToppreiseSlug,
  validateSovrnDeeplinkTemplate
} from "../src/comparison/deep-links.js";
import { loadConfig } from "../src/config.js";
import { createShopcartMcpServer } from "../src/mcp/create-server.js";
import { findGeminiSchemaViolations } from "../src/mcp/schema-sanitize.js";
import { SHELL_SAFE_HTTPS_URL_RE } from "../src/security/identifiers.js";
import type { SafeFetchOptions, SafeFetchResponse } from "../src/security/ssrf.js";

function makeResponse(
  url: string,
  body: string | Buffer,
  status = 200,
  contentType = "application/json; charset=utf-8"
): SafeFetchResponse {
  const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return {
    status,
    url,
    contentType,
    headers: { "content-type": contentType },
    bodyBuffer,
    bodyText: Buffer.isBuffer(body) ? body.toString("utf8") : body
  };
}

describe("Deterministic Deep-Link & Affiliate-Hook Module (src/comparison/deep-links.ts)", () => {
  it("normalizes and validates 8-14 digit EAN/GTIN barcodes", () => {
    expect(normalizeEan("4548736132580")).toBe("4548736132580");
    expect(normalizeEan("4548-7361 3258-0")).toBe("4548736132580");
    expect(normalizeEan(" 12345678 ")).toBe("12345678");
    expect(normalizeEan("12345678901234")).toBe("12345678901234");

    expect(normalizeEan("1234567")).toBeNull();
    expect(normalizeEan("123456789012345")).toBeNull();
    expect(normalizeEan("454873613258X")).toBeNull();
    expect(normalizeEan("")).toBeNull();
    expect(normalizeEan(undefined)).toBeNull();
  });

  it("builds deterministic Tier-B comparison links for all 6 countries with price bounds, sorting, and EAN preference", () => {
    // AT: Geizhals AT (hloc=at&hloc=de), idealo AT, Google Shopping AT
    const at = buildComparisonLinks({
      query: "Sony WH-1000XM5",
      ean: "4548-7361-32580",
      country: "AT",
      minPrice: 200,
      maxPrice: 350,
      sortBy: "price_asc"
    });
    expect(at.match_mode).toBe("ean_exact");
    expect(at.ean).toBe("4548736132580");
    expect(at.affiliate_disclosure).toBe(false);
    expect(at.disclosure_note).toBeUndefined();
    expect(at.links.map((l) => l.provider)).toEqual([
      "geizhals_at",
      "idealo_at",
      "google_shopping_at"
    ]);

    const ghAt = new URL(at.links[0]!.url);
    expect(ghAt.origin).toBe("https://geizhals.at");
    expect(ghAt.searchParams.get("fs")).toBe("4548736132580");
    expect(ghAt.searchParams.getAll("hloc")).toEqual(["at", "de"]);
    expect(ghAt.searchParams.get("bpmin")).toBe("200");
    expect(ghAt.searchParams.get("bpmax")).toBe("350");
    expect(ghAt.searchParams.get("sort")).toBe("p");
    expect(ghAt.searchParams.get("utm_source")).toBeNull();

    const idAt = new URL(at.links[1]!.url);
    expect(idAt.origin + idAt.pathname).toBe(
      "https://www.idealo.at/preisvergleich/MainSearchProductCategory.html"
    );
    expect(idAt.searchParams.get("q")).toBe("4548736132580");
    expect(idAt.searchParams.get("minPrice")).toBe("200");
    expect(idAt.searchParams.get("maxPrice")).toBe("350");
    expect(idAt.searchParams.get("sortKey")).toBe("minPrice");

    const gsAt = new URL(at.links[2]!.url);
    expect(gsAt.origin + gsAt.pathname).toBe("https://www.google.com/search");
    expect(gsAt.searchParams.get("q")).toBe("4548736132580");
    expect(gsAt.searchParams.get("udm")).toBe("28");
    expect(gsAt.searchParams.get("tbs")).toBe("p_ord:p");
    expect(gsAt.searchParams.get("gl")).toBe("at");
    expect(gsAt.searchParams.get("hl")).toBe("de");

    // DE: Geizhals DE, idealo DE, billiger.de, Google Shopping DE with sortBy="relevance"
    const de = buildComparisonLinks({
      query: "Garmin Fenix 8",
      country: "DE",
      sortBy: "relevance"
    });
    expect(de.match_mode).toBe("keyword");
    expect(de.ean).toBeNull();
    expect(de.links.map((l) => l.provider)).toEqual([
      "geizhals_de",
      "idealo_de",
      "billiger_de",
      "google_shopping_de"
    ]);
    const ghDe = new URL(de.links[0]!.url);
    expect(ghDe.origin).toBe("https://geizhals.de");
    expect(ghDe.searchParams.getAll("hloc")).toEqual(["de"]);
    expect(ghDe.searchParams.get("sort")).toBeNull();
    expect(new URL(de.links[1]!.url).searchParams.get("sortKey")).toBeNull();
    const billiger = new URL(de.links[2]!.url);
    expect(billiger.origin + billiger.pathname).toBe("https://www.billiger.de/s");
    expect(billiger.searchParams.get("q")).toBe("Garmin Fenix 8");
    const gsDe = new URL(de.links[3]!.url);
    expect(gsDe.searchParams.get("tbs")).toBeNull();
    expect(gsDe.searchParams.get("gl")).toBe("de");
    expect(gsDe.searchParams.get("hl")).toBe("de");

    // CH: Toppreise.ch slug, Geizhals EU, Google Shopping CH
    const ch = buildComparisonLinks({
      query: "Kärcher Dampfreiniger SC 3",
      country: "CH",
      sortBy: "price_asc"
    });
    expect(toToppreiseSlug("Kärcher Dampfreiniger SC 3")).toBe("kaercher-dampfreiniger-sc-3");
    expect(ch.links.map((l) => l.provider)).toEqual([
      "toppreise_ch",
      "geizhals_eu",
      "google_shopping_ch"
    ]);
    expect(ch.links[0]!.url).toBe(
      "https://www.toppreise.ch/preisvergleich/kaercher-dampfreiniger-sc-3"
    );
    expect(new URL(ch.links[1]!.url).origin).toBe("https://geizhals.eu");
    expect(new URL(ch.links[1]!.url).searchParams.getAll("hloc")).toEqual(["eu"]);
    expect(new URL(ch.links[2]!.url).searchParams.get("gl")).toBe("ch");
    expect(new URL(ch.links[2]!.url).searchParams.get("hl")).toBe("de");

    // UK, FR, US
    const uk = buildComparisonLinks({ query: "Dyson V15", country: "UK" });
    expect(uk.links).toHaveLength(1);
    expect(new URL(uk.links[0]!.url).searchParams.get("gl")).toBe("uk");
    expect(new URL(uk.links[0]!.url).searchParams.get("hl")).toBe("en");

    const fr = buildComparisonLinks({ query: "Dyson V15", country: "FR" });
    expect(fr.links).toHaveLength(1);
    expect(new URL(fr.links[0]!.url).searchParams.get("gl")).toBe("fr");
    expect(new URL(fr.links[0]!.url).searchParams.get("hl")).toBe("fr");

    const us = buildComparisonLinks({ query: "Dyson V15", country: "US" });
    expect(us.links).toHaveLength(1);
    expect(new URL(us.links[0]!.url).searchParams.get("gl")).toBe("us");
    expect(new URL(us.links[0]!.url).searchParams.get("hl")).toBe("en");
  });

  it("builds deterministic Tier-B deal search links for all 6 regions (with and without query)", () => {
    const cases: Array<{
      region: "AT" | "DE" | "CH" | "UK" | "FR" | "US";
      withQueryUrls: string[];
      homeUrls: string[];
    }> = [
      {
        region: "AT",
        withQueryUrls: ["https://www.preisjaeger.at/search?q=Sony+XM5"],
        homeUrls: ["https://www.preisjaeger.at/"]
      },
      {
        region: "DE",
        withQueryUrls: ["https://www.mydealz.de/search?q=Sony+XM5"],
        homeUrls: ["https://www.mydealz.de/"]
      },
      {
        region: "CH",
        withQueryUrls: [
          "https://www.preisjaeger.at/search?q=Sony+XM5",
          "https://www.mydealz.de/search?q=Sony+XM5"
        ],
        homeUrls: ["https://www.preisjaeger.at/", "https://www.mydealz.de/"]
      },
      {
        region: "UK",
        withQueryUrls: ["https://www.hotukdeals.com/search?q=Sony+XM5"],
        homeUrls: ["https://www.hotukdeals.com/"]
      },
      {
        region: "FR",
        withQueryUrls: ["https://www.dealabs.com/search?q=Sony+XM5"],
        homeUrls: ["https://www.dealabs.com/"]
      },
      {
        region: "US",
        withQueryUrls: ["https://slickdeals.net/newsearch.php?q=Sony+XM5"],
        homeUrls: ["https://slickdeals.net/"]
      }
    ];

    for (const c of cases) {
      const withQ = buildDealSearchLinks({ region: c.region, query: "Sony XM5" });
      expect(withQ.links.map((l) => l.url)).toEqual(c.withQueryUrls);
      expect(withQ.affiliate_disclosure).toBe(false);
      expect(withQ.disclosure_note).toBeUndefined();

      const home = buildDealSearchLinks({ region: c.region });
      expect(home.links.map((l) => l.url)).toEqual(c.homeUrls);
      expect(home.affiliate_disclosure).toBe(false);
    }

    const ch = buildDealSearchLinks({ region: "CH", query: "OLED" });
    expect(ch.links.every((l) => l.label.includes("DACH"))).toBe(true);
  });

  it("prevents URL/shell injection in query parameters and Toppreise slugs", () => {
    const hostileQuery = `Sony $(whoami) 'test' "; <script>alert(1)</script>\u0000\u200B`;
    const de = buildComparisonLinks({ query: hostileQuery, country: "DE" });
    const ch = buildComparisonLinks({ query: hostileQuery, country: "CH" });
    const deals = buildDealSearchLinks({ query: hostileQuery, region: "DE" });

    for (const link of [...de.links, ...ch.links, ...deals.links]) {
      expect(SHELL_SAFE_HTTPS_URL_RE.test(link.url)).toBe(true);
      expect(link.url).not.toContain("<script>");
      expect(link.url).not.toContain("$(");
      expect(link.url).not.toContain("'");
      expect(link.url).not.toContain('"');
    }
  });

  it("validates Sovrn Commerce deeplink templates strictly, rejects untrusted hosts/schemes, and sets affiliate_disclosure=true when active", () => {
    // Allowed Sovrn hosts
    expect(
      validateSovrnDeeplinkTemplate("https://redirect.viglink.com/?key=abc123&u={encoded_url}").valid
    ).toBe(true);
    expect(
      validateSovrnDeeplinkTemplate("https://sovrn.co/go?key=abc123&u={encoded_url}").valid
    ).toBe(true);

    // Rejected hosts, schemes, SSRF & placeholder attacks
    expect(
      validateSovrnDeeplinkTemplate("http://redirect.viglink.com/?key=abc&u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateSovrnDeeplinkTemplate("https://evil.example/?u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateSovrnDeeplinkTemplate("https://redirect.viglink.com.evil.example/?u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateSovrnDeeplinkTemplate("https://127.0.0.1/?u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateSovrnDeeplinkTemplate("https://169.254.169.254/?u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateSovrnDeeplinkTemplate("https://redirect.viglink.com/?u={raw_url}").valid
    ).toBe(false);
    expect(
      validateSovrnDeeplinkTemplate("https://{encoded_url}/redirect").valid
    ).toBe(false);

    // Env loader ignores invalid Sovrn template with warning & parses KELKOO_API_TOKEN cleanly
    const badCfg = loadComparisonConfig({
      SOVRN_COMMERCE_DEEPLINK_TEMPLATE: "https://attacker.example/?u={encoded_url}",
      KELKOO_API_TOKEN: "kelkoo-secret-token-42"
    });
    expect(badCfg.sovrnDeeplinkTemplate).toBeUndefined();
    expect(badCfg.warnings).toHaveLength(1);
    expect(badCfg.kelkooApiToken).toBe("kelkoo-secret-token-42");

    // Valid Sovrn wrapper wraps deep-links and sets affiliate_disclosure=true
    const goodCfg = loadComparisonConfig({
      SOVRN_COMMERCE_DEEPLINK_TEMPLATE: "https://redirect.viglink.com/?key=demo99&u={encoded_url}"
    });
    const wrappedRes = buildComparisonLinks({
      query: "iPad Air",
      country: "AT",
      comparisonConfig: goodCfg
    });
    expect(wrappedRes.affiliate_disclosure).toBe(true);
    expect(wrappedRes.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);
    for (const link of wrappedRes.links) {
      const parsed = new URL(link.url);
      expect(parsed.hostname).toBe("redirect.viglink.com");
      expect(parsed.searchParams.get("key")).toBe("demo99");
      expect(parsed.searchParams.get("u")).toMatch(/^https:\/\//);
      expect(link.affiliate_disclosure).toBe(true);
      expect(link.applied_network).toBe("sovrn");
    }

    // Domain-matched AFFILIATE_RULES_JSON also sets affiliate_disclosure=true without injecting utm_*
    const ruleAttr = loadAttributionConfig({
      AFFILIATE_RULES_JSON: JSON.stringify([
        {
          domain: "idealo.de",
          network: "partner_idealo",
          ref: "shopcart_de"
        }
      ])
    });
    const ruleRes = buildComparisonLinks({
      query: "Bosch Akkuschrauber",
      country: "DE",
      attribution: ruleAttr
    });
    expect(ruleRes.affiliate_disclosure).toBe(true);
    expect(ruleRes.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);
    const idealoLink = ruleRes.links.find((l) => l.provider === "idealo_de")!;
    const geizhalsLink = ruleRes.links.find((l) => l.provider === "geizhals_de")!;
    expect(idealoLink.affiliate_disclosure).toBe(true);
    expect(new URL(idealoLink.url).searchParams.get("ref")).toBe("shopcart_de");
    expect(new URL(idealoLink.url).searchParams.get("utm_source")).toBeNull();
    expect(geizhalsLink.affiliate_disclosure).toBe(false);
    expect(new URL(geizhalsLink.url).searchParams.get("utm_source")).toBeNull();
  });

  it("loads comparison config inside loadConfig()", () => {
    const cfg = loadConfig({
      SOVRN_COMMERCE_DEEPLINK_TEMPLATE: "https://sovrn.co/r?k=1&u={encoded_url}",
      KELKOO_API_TOKEN: "test-kelkoo-tok"
    });
    expect(cfg.comparison.sovrnDeeplinkTemplate).toBe("https://sovrn.co/r?k=1&u={encoded_url}");
    expect(cfg.comparison.kelkooApiToken).toBe("test-kelkoo-tok");
  });
});

describe("Official Awin Publisher Promotions & Vouchers Client (src/adapters/affiliate-feed/awin-promotions.ts)", () => {
  const SAMPLE_PROMOTIONS_PAYLOAD = {
    data: [
      {
        promotionId: 9001,
        type: "voucher",
        advertiser: { id: 11307, name: "MediaMarkt DE", joined: true },
        title: "<b>15% Rabatt</b> auf Sony Kopfhörer",
        description: "<p>Gültig ab 150 EUR für ausgewählte Audio-Artikel.</p><script>evil()</script>",
        terms: "Nicht kombinierbar mit anderen Aktionen.",
        startDate: "2026-11-01",
        endDate: "2026-12-31",
        url: "https://www.mediamarkt.de/de/category/kopfhoerer.html",
        urlTracking: "https://www.awin1.com/cread.php?awinmid=11307&awinaffid=999123&ued=https%3A%2F%2Fwww.mediamarkt.de",
        campaign: "Black Week Audio",
        categories: [{ id: 1, name: "Electronics" }, { id: 2, name: "Audio" }],
        voucher: { code: "AUDIO15", exclusive: true, attributable: true }
      },
      {
        promotionId: 9002,
        type: "deal",
        advertiser: { id: 17000, name: "Decathlon DE", joined: true },
        title: "Bis zu 40% auf Outdoor & Wanderschuhe",
        description: "Große Herbst-Aktion für Größen 36-47",
        startDate: "2026-11-10",
        endDate: "2026-12-01",
        url: "https://www.decathlon.de/deals",
        urlTracking: "https://www.awin1.com/cread.php?awinmid=17000&awinaffid=999123",
        categories: [{ id: 3, name: "Sports" }]
      },
      {
        promotionId: 9003,
        type: "voucher",
        advertiser: { id: 99999, name: "Malicious Advertiser", joined: true },
        title: "Fake XSS Promo",
        description: "Should be dropped",
        url: "javascript:alert(1)",
        urlTracking: "http://127.0.0.1/ssrf",
        voucher: { code: "BADCODE" }
      }
    ],
    pagination: { page: 1, pageSize: 50, total: 3 }
  };

  it("degrades gracefully with 0 network calls when Awin credentials are not configured", async () => {
    let calls = 0;
    const client = new AwinPromotionsClient(loadAffiliateFeedConfig({}), {
      fetcher: async () => {
        calls++;
        throw new Error("must not be called");
      }
    });

    expect(client.isConfigured()).toBe(false);
    const res = await client.search({ region: "DE", query: "Sony" });
    expect(calls).toBe(0);
    expect(res.configured).toBe(false);
    expect(res.live_vouchers).toEqual([]);
    expect(res.live_deals).toEqual([]);
    expect(res.affiliate_disclosure).toBe(false);
    expect(res.disclosure_note).toBeUndefined();
    expect(res.notices[0]).toContain("not configured");
  });

  it("enforces strict api.awin.com SSRF allowlist and region mapping", () => {
    expect(mapRegionToAwinCode("UK")).toBe("GB");
    expect(mapRegionToAwinCode("AT")).toBe("AT");
    expect(mapRegionToAwinCode("DE")).toBe("DE");
    expect(mapRegionToAwinCode("CH")).toBe("CH");
    expect(mapRegionToAwinCode("FR")).toBe("FR");
    expect(mapRegionToAwinCode("US")).toBe("US");

    expect(validateAwinPromotionsUrl("https://api.awin.com/publisher/12345/promotions")).toBe(
      "https://api.awin.com/publisher/12345/promotions"
    );
    expect(() =>
      validateAwinPromotionsUrl("https://productdata.awin.com/publisher/12345/promotions")
    ).toThrow();
    expect(() => validateAwinPromotionsUrl("http://api.awin.com/publisher/12345/promotions")).toThrow();
    expect(() => validateAwinPromotionsUrl("https://evil.example/promotions")).toThrow();
    expect(() => validateAwinPromotionsUrl("https://169.254.169.254/latest")).toThrow();
  });

  it("fetches promotions via POST, separates vouchers/deals, filters umlaut-aware, sanitizes HTML/URLs, and caches with TTL & bounded keys", async () => {
    let nowMs = 1_700_000_000_000;
    const calls: Array<{ url: string; opts?: SafeFetchOptions }> = [];

    const client = new AwinPromotionsClient(
      loadAffiliateFeedConfig({
        AWIN_API_TOKEN: "awin-promo-secret-token-123",
        AWIN_PUBLISHER_ID: "999123"
      }),
      {
        nowFn: () => nowMs,
        maxCacheKeys: 2,
        fetcher: async (url, opts) => {
          calls.push({ url, opts });
          return makeResponse(url, JSON.stringify(SAMPLE_PROMOTIONS_PAYLOAD), 200);
        }
      }
    );

    // 1. Initial call for UK -> maps to regionCodes: ["GB"]
    const ukRes = await client.search({ region: "UK" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.awin.com/publisher/999123/promotions");
    expect(calls[0]!.opts?.method).toBe("POST");
    expect(calls[0]!.opts?.headers?.Authorization).toBe("Bearer awin-promo-secret-token-123");
    expect(calls[0]!.opts?.headers?.["Content-Type"]).toBe("application/json");
    expect(calls[0]!.opts?.timeoutMs).toBeLessThanOrEqual(8000);
    expect(JSON.parse(calls[0]!.opts?.body ?? "{}")).toEqual({
      filters: {
        membership: "joined",
        regionCodes: ["GB"],
        status: "active"
      },
      pagination: { page: 1, pageSize: 50 }
    });

    expect(ukRes.configured).toBe(true);
    expect(ukRes.awin_region_code).toBe("GB");
    expect(ukRes.affiliate_disclosure).toBe(true);
    expect(ukRes.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);
    // Malicious row dropped -> 1 voucher + 1 deal
    expect(ukRes.live_vouchers).toHaveLength(1);
    expect(ukRes.live_deals).toHaveLength(1);
    expect(ukRes.live_vouchers[0]!.voucher_code).toBe("AUDIO15");
    expect(ukRes.live_vouchers[0]!.title).toBe("15% Rabatt auf Sony Kopfhörer");
    expect(ukRes.live_vouchers[0]!.description).not.toContain("<script>");
    expect(ukRes.live_vouchers[0]!.description).not.toContain("evil()");
    expect(ukRes.live_deals[0]!.advertiser_name).toBe("Decathlon DE");

    // 2. Umlaut-aware query filtering + cache hit (still 1 fetch!)
    const umlautQuery = await client.search({ region: "UK", query: "Kopfhoerer" });
    expect(calls).toHaveLength(1);
    expect(umlautQuery.live_vouchers).toHaveLength(1);
    expect(umlautQuery.live_deals).toHaveLength(0);

    // 3. includeVouchers=false excludes vouchers
    const noVouchers = await client.search({
      region: "UK",
      includeVouchers: false
    });
    expect(calls).toHaveLength(1);
    expect(noVouchers.live_vouchers).toEqual([]);
    expect(noVouchers.live_deals).toHaveLength(1);

    // 4. Category filter
    const sportsOnly = await client.search({ region: "UK", category: "Sports" });
    expect(sportsOnly.live_vouchers).toHaveLength(0);
    expect(sportsOnly.live_deals).toHaveLength(1);

    // 5. Bounded cache eviction (maxCacheKeys=2): add DE and AT -> UK gets evicted
    await client.search({ region: "DE" });
    await client.search({ region: "AT" });
    expect(calls).toHaveLength(3);
    await client.search({ region: "UK" });
    expect(calls).toHaveLength(4);

    // 6. TTL expiry (15 min): advance clock > 15m -> refetches AT
    nowMs += 15 * 60 * 1000 + 1000;
    await client.search({ region: "AT" });
    expect(calls).toHaveLength(5);
  });

  it("redacts API token on HTTP errors and network failures", async () => {
    const secret = "ultra-secret-bearer-token-98765";
    const httpErrClient = new AwinPromotionsClient(
      loadAffiliateFeedConfig({
        AWIN_API_TOKEN: secret,
        AWIN_PUBLISHER_ID: "999123"
      }),
      {
        fetcher: async (url) => makeResponse(url, `Unauthorized for ${secret}`, 401)
      }
    );

    const errRes = await httpErrClient.search({ region: "DE" });
    expect(errRes.configured).toBe(true);
    expect(errRes.live_vouchers).toEqual([]);
    expect(errRes.live_deals).toEqual([]);
    expect(errRes.affiliate_disclosure).toBe(false);
    expect(errRes.notices[0]).toContain("HTTP 401");
    expect(errRes.notices[0]).not.toContain(secret);

    const throwClient = new AwinPromotionsClient(
      loadAffiliateFeedConfig({
        AWIN_API_TOKEN: secret,
        AWIN_PUBLISHER_ID: "999123"
      }),
      {
        fetcher: async () => {
          throw new Error(`Upstream error with token=${secret}`);
        }
      }
    );
    const throwRes = await throwClient.search({ region: "DE" });
    expect(throwRes.notices[0]).toContain("[REDACTED]");
    expect(throwRes.notices[0]).not.toContain(secret);
  });
});

describe("MCP Tools Integration — compare_prices & find_hot_deals (Gemini schema + handlers)", () => {
  it("registers compare_prices & find_hot_deals unconditionally with 0 Gemini schema violations and handles unconfigured mode cleanly", async () => {
    const server = createShopcartMcpServer({
      attribution: loadAttributionConfig({}),
      affiliateFeed: new AwinFeedClient(loadAffiliateFeedConfig({})),
      awinPromotions: new AwinPromotionsClient(loadAffiliateFeedConfig({})),
      comparison: loadComparisonConfig({ KELKOO_API_TOKEN: "secret-kelkoo-never-leak" })
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "price-comparison-test", version: "1.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    // 1. Both tools present and 100% Gemini schema compliant
    const { tools } = await client.listTools();
    const compareTool = tools.find((t) => t.name === "compare_prices");
    const dealsTool = tools.find((t) => t.name === "find_hot_deals");
    expect(compareTool).toBeDefined();
    expect(dealsTool).toBeDefined();
    expect(findGeminiSchemaViolations(compareTool!.inputSchema, "compare_prices")).toEqual([]);
    expect(findGeminiSchemaViolations(dealsTool!.inputSchema, "find_hot_deals")).toEqual([]);

    // 2. compare_prices validation: rejects missing query & ean
    const missingBoth = await client.callTool({
      name: "compare_prices",
      arguments: { country: "AT" }
    });
    expect(missingBoth.isError).toBe(true);

    // 3. compare_prices validation: rejects invalid EAN and inverted price bounds
    const badEan = await client.callTool({
      name: "compare_prices",
      arguments: { ean: "not-a-valid-ean" }
    });
    expect(badEan.isError).toBe(true);

    const badBounds = await client.callTool({
      name: "compare_prices",
      arguments: { query: "Sony XM5", min_price: 500, max_price: 200 }
    });
    expect(badBounds.isError).toBe(true);

    // 4. compare_prices unconfigured mode returns Tier-B links with affiliate_disclosure=false and never leaks KELKOO_API_TOKEN
    const cmpCall = await client.callTool({
      name: "compare_prices",
      arguments: {
        query: "Sony WH-1000XM5",
        ean: "4548736132580",
        country: "AT",
        min_price: 200,
        max_price: 400
      }
    });
    expect(cmpCall.isError).toBeFalsy();
    const cmpText = (cmpCall.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(cmpText).not.toContain("secret-kelkoo-never-leak");
    const cmp = JSON.parse(cmpText);
    expect(cmp.country).toBe("AT");
    expect(cmp.ean).toBe("4548736132580");
    expect(cmp.match_mode).toBe("ean_exact");
    expect(cmp.live_offers).toEqual([]);
    expect(cmp.comparison_links).toHaveLength(3);
    expect(cmp.providers.tier_a_live.awin_product_feeds).toBe("not_configured");
    expect(cmp.providers.tier_a_live.kelkoo).toBe("configured");
    expect(cmp.affiliate_disclosure).toBe(false);
    expect(cmp.disclosure_note).toBeUndefined();
    expect(cmp.agent_guidance).toContain("EAN");
    expect(cmp.agent_guidance).toContain("create_cart_link");

    // 5. find_hot_deals unconfigured mode returns Tier-B deal links with affiliate_disclosure=false
    const dealCall = await client.callTool({
      name: "find_hot_deals",
      arguments: {
        query: "MacBook Air",
        region: "CH"
      }
    });
    expect(dealCall.isError).toBeFalsy();
    const dealData = JSON.parse(
      (dealCall.content as Array<{ type: string; text: string }>)[0]!.text
    );
    expect(dealData.region).toBe("CH");
    expect(dealData.live_vouchers).toEqual([]);
    expect(dealData.live_deals).toEqual([]);
    expect(dealData.deal_search_links).toHaveLength(2);
    expect(dealData.providers.tier_a_live.awin_promotions).toBe("not_configured");
    expect(dealData.affiliate_disclosure).toBe(false);
    expect(dealData.agent_guidance).toContain("inspect_store");
    expect(dealData.agent_guidance).toContain("create_cart_link");

    await client.close();
    await server.close();
  });

  it("integrates live Awin feeds & Awin promotions into compare_prices & find_hot_deals with mandatory affiliate disclosure and quota guard", async () => {
    const feedCsv = [
      "aw_deep_link,product_name,aw_product_id,merchant_product_id,search_price,merchant_name,merchant_id,currency,in_stock,brand_name,ean",
      '"https://www.awin1.com/pclick.php?p=1&a=999&m=1","Sony WH-1000XM5",1,XM5-A,299.00,"MediaMarkt DE",1,EUR,1,Sony,4548736132580',
      '"https://www.awin1.com/pclick.php?p=2&a=999&m=2","Sony WH-1000XM5",2,XM5-B,279.00,"OTTO",2,EUR,1,Sony,4548736132580'
    ].join("\n");

    const promoJson = JSON.stringify({
      data: [
        {
          promotionId: 101,
          type: "voucher",
          advertiser: { id: 1, name: "MediaMarkt DE" },
          title: "10% Rabatt auf Sony Audio",
          description: "Code im Warenkorb eingeben",
          urlTracking: "https://www.awin1.com/cread.php?awinmid=1&awinaffid=999",
          categories: [{ id: 1, name: "Electronics" }],
          voucher: { code: "SONY10", exclusive: false }
        },
        {
          promotionId: 102,
          type: "deal",
          advertiser: { id: 2, name: "OTTO" },
          title: "Sony Kopfhörer Deal Woche",
          description: "Stark reduziert",
          urlTracking: "https://www.awin1.com/cread.php?awinmid=2&awinaffid=999",
          categories: [{ id: 1, name: "Electronics" }]
        }
      ]
    });

    const awinCfg = loadAffiliateFeedConfig({
      AWIN_API_TOKEN: "live-awin-token",
      AWIN_PUBLISHER_ID: "999123",
      AWIN_FEED_IDS: "55501"
    });

    const quotaCalls: string[] = [];
    const server = createShopcartMcpServer({
      attribution: loadAttributionConfig({}),
      affiliateFeed: new AwinFeedClient(awinCfg, {
        fetcher: async (url) => makeResponse(url, feedCsv, 200, "text/csv")
      }),
      awinPromotions: new AwinPromotionsClient(awinCfg, {
        fetcher: async (url) => makeResponse(url, promoJson, 200, "application/json")
      }),
      comparison: loadComparisonConfig({}),
      consumeQuota: async (toolName) => {
        quotaCalls.push(toolName);
        return {
          allowed: true,
          used: quotaCalls.length,
          limit: 500,
          dayKey: "2026-11-26",
          plan: "pro",
          promoActive: true
        };
      }
    });

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "price-comparison-live-test", version: "1.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    // 1. compare_prices merges Tier-A live offers (sorted lowest price first) + Tier-B links
    const cmpCall = await client.callTool({
      name: "compare_prices",
      arguments: {
        ean: "4548736132580",
        country: "DE",
        sort_by: "price_asc"
      }
    });
    expect(cmpCall.isError).toBeFalsy();
    const cmp = JSON.parse(
      (cmpCall.content as Array<{ type: string; text: string }>)[0]!.text
    );
    expect(cmp.live_offers).toHaveLength(2);
    expect(cmp.live_offers[0].merchant_name).toBe("OTTO");
    expect(cmp.live_offers[0].price.amount).toBe(279);
    expect(cmp.live_offers[1].merchant_name).toBe("MediaMarkt DE");
    expect(cmp.comparison_links).toHaveLength(4);
    expect(cmp.providers.tier_a_live.awin_product_feeds).toBe("active");
    expect(cmp.affiliate_disclosure).toBe(true);
    expect(cmp.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);

    // 2. find_hot_deals returns live vouchers + live deals + Tier-B deal links
    const dealCall = await client.callTool({
      name: "find_hot_deals",
      arguments: {
        query: "Sony",
        region: "DE",
        category: "Electronics",
        include_vouchers: true
      }
    });
    expect(dealCall.isError).toBeFalsy();
    const dealData = JSON.parse(
      (dealCall.content as Array<{ type: string; text: string }>)[0]!.text
    );
    expect(dealData.live_vouchers).toHaveLength(1);
    expect(dealData.live_vouchers[0].voucher_code).toBe("SONY10");
    expect(dealData.live_deals).toHaveLength(1);
    expect(dealData.live_deals[0].advertiser_name).toBe("OTTO");
    expect(dealData.deal_search_links).toHaveLength(1);
    expect(dealData.deal_search_links[0].provider).toBe("mydealz_de");
    expect(dealData.providers.tier_a_live.awin_promotions).toBe("active");
    expect(dealData.affiliate_disclosure).toBe(true);
    expect(dealData.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);

    // Verify runGuardedTool invoked consumeQuota for both tools
    expect(quotaCalls).toEqual(["compare_prices", "find_hot_deals"]);

    await client.close();
    await server.close();
  });
});
