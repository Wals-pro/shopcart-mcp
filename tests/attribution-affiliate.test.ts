import zlib from "node:zlib";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  AwinFeedClient,
  createAffiliateFeedProvider,
  loadAffiliateFeedConfig,
  searchAffiliateDeals,
  validateAwinFeedUrl
} from "../src/adapters/affiliate-feed/index.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { ShopifyAdapter } from "../src/adapters/shopify/adapter.js";
import { ShopifyClient } from "../src/adapters/shopify/client.js";
import { createApp } from "../src/app.js";
import {
  AFFILIATE_DISCLOSURE_NOTE,
  applyAttribution,
  DEFAULT_UTM_CAMPAIGN,
  DEFAULT_UTM_MEDIUM,
  DEFAULT_UTM_SOURCE,
  loadAttributionConfig,
  matchAffiliateRule,
  validateDeeplinkTemplate
} from "../src/attribution/links.js";
import { sha256Base64Url } from "../src/auth/crypto.js";
import { MemoryEmailSender } from "../src/auth/email-otp.js";
import { loadConfig } from "../src/config.js";
import type { SafeFetchResponse } from "../src/security/ssrf.js";
import { MemoryStore } from "../src/store/memory.js";

function makeResponse(
  url: string,
  body: string | Buffer,
  status = 200,
  contentType = "text/csv; charset=utf-8"
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

async function issueBearerToken(
  app: ReturnType<typeof createApp>,
  emailSender: MemoryEmailSender
): Promise<string> {
  const reg = await request(app)
    .post("/oauth/register")
    .send({
      client_name: "Attribution Test Client",
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none"
    })
    .expect(201);

  const clientId = reg.body.client_id as string;
  const verifier = "verifier_attribution_test_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const challenge = sha256Base64Url(verifier);
  const redirectUri = "http://127.0.0.1:42222/callback";

  const authGet = await request(app)
    .get("/oauth/authorize")
    .query({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "https://shopcart.wals.pro/mcp",
      state: "st_attr"
    })
    .expect(200);

  const csrf1 = authGet.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
  const step1 = await request(app)
    .post("/oauth/authorize")
    .set("Origin", "https://shopcart.wals.pro")
    .type("form")
    .send({
      _csrf: csrf1,
      step: "email",
      lang: "en",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "https://shopcart.wals.pro/mcp",
      scope: "mcp:read",
      state: "st_attr",
      email: "tester@example.com"
    })
    .expect(200);

  const mail = emailSender.lastFor("tester@example.com")!;
  const csrf2 = step1.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
  const challengeId = step1.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;

  const step2 = await request(app)
    .post("/oauth/authorize")
    .set("Origin", "https://shopcart.wals.pro")
    .type("form")
    .send({
      _csrf: csrf2,
      step: "verify",
      challenge_id: challengeId,
      lang: "en",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "https://shopcart.wals.pro/mcp",
      scope: "mcp:read",
      state: "st_attr",
      email: "tester@example.com",
      code: mail.code
    })
    .expect(303);

  const code = new URL(step2.headers.location!).searchParams.get("code")!;
  const tok = await request(app)
    .post("/oauth/token")
    .type("form")
    .send({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: "https://shopcart.wals.pro/mcp"
    })
    .expect(200);

  return tok.body.access_token as string;
}

describe("Universal UTM Attribution & Affiliate Engine (src/attribution/links.ts)", () => {
  it("appends default UTM params preserving existing Shopify, WooCommerce, and Amazon query params with affiliate_disclosure=false", () => {
    const cfg = loadAttributionConfig({});
    expect(cfg.disableUtm).toBe(false);
    expect(cfg.utmSource).toBe(DEFAULT_UTM_SOURCE);
    expect(cfg.utmMedium).toBe(DEFAULT_UTM_MEDIUM);
    expect(cfg.utmCampaign).toBe(DEFAULT_UTM_CAMPAIGN);

    // Shopify cart permalink preserves storefront=true and discount
    const shopifyCart = applyAttribution(
      "https://snocks.com/cart/44434567725323:2,19729211981894:1?storefront=true&discount=BF2026",
      cfg,
      { kind: "cart" }
    );
    const sUrl = new URL(shopifyCart.url);
    expect(sUrl.pathname).toBe("/cart/44434567725323:2,19729211981894:1");
    expect(sUrl.searchParams.get("storefront")).toBe("true");
    expect(sUrl.searchParams.get("discount")).toBe("BF2026");
    expect(sUrl.searchParams.get("utm_source")).toBe("shopcart.wals.pro");
    expect(sUrl.searchParams.get("utm_medium")).toBe("ai_mcp");
    expect(sUrl.searchParams.get("utm_campaign")).toBe("shopcart_mcp");
    expect(shopifyCart.affiliate_disclosure).toBe(false);
    expect(shopifyCart.disclosure_note).toBeUndefined();
    expect(shopifyCart.utm_applied).toBe(true);

    // WooCommerce add-to-cart preserves add-to-cart and quantity
    const wooCart = applyAttribution(
      "https://shop.example.de/?add-to-cart=9876&quantity=3",
      cfg,
      { kind: "cart" }
    );
    const wUrl = new URL(wooCart.url);
    expect(wUrl.searchParams.get("add-to-cart")).toBe("9876");
    expect(wUrl.searchParams.get("quantity")).toBe("3");
    expect(wUrl.searchParams.get("utm_source")).toBe("shopcart.wals.pro");
    expect(wooCart.affiliate_disclosure).toBe(false);

    // Amazon cart permalink without affiliate tag preserves ASIN.1 & Quantity.1
    const amzCart = applyAttribution(
      "https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=B08N5WRWNW&Quantity.1=2",
      cfg,
      { kind: "cart" }
    );
    const aUrl = new URL(amzCart.url);
    expect(aUrl.pathname).toBe("/gp/aws/cart/add.html");
    expect(aUrl.searchParams.get("ASIN.1")).toBe("B08N5WRWNW");
    expect(aUrl.searchParams.get("Quantity.1")).toBe("2");
    expect(aUrl.searchParams.get("utm_source")).toBe("shopcart.wals.pro");
    expect(amzCart.affiliate_disclosure).toBe(false);
  });

  it("supports SHOPCART_DISABLE_UTM=1 opt-out and custom ATTRIBUTION_UTM_* overrides", () => {
    const disabled = loadAttributionConfig({ SHOPCART_DISABLE_UTM: "1" });
    const res = applyAttribution(
      "https://snocks.com/cart/44434567725323:2?storefront=true",
      disabled,
      { kind: "cart" }
    );
    expect(res.url).toBe("https://snocks.com/cart/44434567725323:2?storefront=true");
    expect(res.utm_applied).toBe(false);
    expect(res.affiliate_disclosure).toBe(false);

    const custom = loadAttributionConfig({
      ATTRIBUTION_UTM_SOURCE: "custom.example.com",
      ATTRIBUTION_UTM_MEDIUM: "partner_agent",
      ATTRIBUTION_UTM_CAMPAIGN: "q4_launch"
    });
    const customRes = applyAttribution("https://snocks.com/products/sneaker-socken", custom, {
      kind: "product"
    });
    const u = new URL(customRes.url);
    expect(u.searchParams.get("utm_source")).toBe("custom.example.com");
    expect(u.searchParams.get("utm_medium")).toBe("partner_agent");
    expect(u.searchParams.get("utm_campaign")).toBe("q4_launch");
    expect(customRes.affiliate_disclosure).toBe(false);
  });

  it("applies per-marketplace Amazon PartnerNet tags with fallback to AMAZON_ASSOCIATE_TAG and sets affiliate_disclosure=true", () => {
    const cfg = loadAttributionConfig({
      SHOPCART_DISABLE_UTM: "1",
      AMAZON_ASSOCIATE_TAG: "fallback-21",
      AMAZON_ASSOCIATE_TAGS_JSON: JSON.stringify({
        de: "shopcartde-21",
        com: "shopcartus-20",
        "co.uk": "shopcartuk-21"
      })
    });

    // Amazon DE cart permalink uses AssociateTag
    const deCart = applyAttribution(
      "https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=B0B7CPSN2K&Quantity.1=1",
      cfg,
      { kind: "cart" }
    );
    const deUrl = new URL(deCart.url);
    expect(deUrl.searchParams.get("ASIN.1")).toBe("B0B7CPSN2K");
    expect(deUrl.searchParams.get("Quantity.1")).toBe("1");
    expect(deUrl.searchParams.get("AssociateTag")).toBe("shopcartde-21");
    expect(deCart.affiliate_disclosure).toBe(true);
    expect(deCart.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);
    expect(deCart.applied_network).toBe("amazon_associates");

    // Amazon US product page uses tag=
    const usProd = applyAttribution("https://amazon.com/dp/B0B7CPSN2K", cfg, { kind: "product" });
    expect(new URL(usProd.url).searchParams.get("tag")).toBe("shopcartus-20");
    expect(usProd.affiliate_disclosure).toBe(true);

    // Amazon UK product page uses co.uk tag
    const ukProd = applyAttribution("https://www.amazon.co.uk/dp/B0B7CPSN2K", cfg, {
      kind: "product"
    });
    expect(new URL(ukProd.url).searchParams.get("tag")).toBe("shopcartuk-21");

    // Amazon FR falls back to AMAZON_ASSOCIATE_TAG
    const frProd = applyAttribution("https://www.amazon.fr/dp/B0B7CPSN2K", cfg, {
      kind: "product"
    });
    expect(new URL(frProd.url).searchParams.get("tag")).toBe("fallback-21");
    expect(frProd.affiliate_disclosure).toBe(true);
  });

  it("matches exact and wildcard AFFILIATE_RULES_JSON domains, appends ref/discount/custom params, and wraps configured deeplink templates", () => {
    const cfg = loadAttributionConfig({
      AFFILIATE_RULES_JSON: JSON.stringify([
        {
          domain: "snocks.com",
          network: "direct_partner",
          ref: "walspro",
          discount: "PARTNER10",
          params: { aff_sub: "mcp" }
        },
        {
          domain: "*.example.de",
          network: "awin",
          deeplink_template:
            "https://www.awin1.com/cread.php?awinmid=11111&awinaffid=22222&ued={encoded_url}"
        },
        {
          domain: "vip.example.de",
          network: "sovrn",
          deeplink_template: "https://redirect.viglink.com/?key=demo123&u={encoded_url}"
        }
      ])
    });

    // Exact domain rule applies ref, discount (when absent), custom params, and UTMs
    const snocksCart = applyAttribution(
      "https://snocks.com/cart/44434567725323:1?storefront=true",
      cfg,
      { kind: "cart" }
    );
    const sUrl = new URL(snocksCart.url);
    expect(sUrl.searchParams.get("storefront")).toBe("true");
    expect(sUrl.searchParams.get("ref")).toBe("walspro");
    expect(sUrl.searchParams.get("discount")).toBe("PARTNER10");
    expect(sUrl.searchParams.get("aff_sub")).toBe("mcp");
    expect(sUrl.searchParams.get("utm_source")).toBe("shopcart.wals.pro");
    expect(snocksCart.affiliate_disclosure).toBe(true);
    expect(snocksCart.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);

    // User-supplied discount code is NEVER overwritten by rule discount
    const userDiscountCart = applyAttribution(
      "https://www.snocks.com/cart/44434567725323:1?storefront=true&discount=USER25",
      cfg,
      { kind: "cart" }
    );
    expect(new URL(userDiscountCart.url).searchParams.get("discount")).toBe("USER25");
    expect(new URL(userDiscountCart.url).searchParams.get("ref")).toBe("walspro");
    expect(userDiscountCart.affiliate_disclosure).toBe(true);

    // Subdomain does NOT match exact rule "snocks.com"
    expect(matchAffiliateRule("blog.snocks.com", cfg.affiliateRules)).toBeNull();

    // Wildcard suffix matches shop.example.de with Awin deeplink wrapper
    const wrapped = applyAttribution("https://shop.example.de/products/jacket", cfg, {
      kind: "product"
    });
    const awinUrl = new URL(wrapped.url);
    expect(awinUrl.hostname).toBe("www.awin1.com");
    expect(awinUrl.searchParams.get("awinmid")).toBe("11111");
    expect(awinUrl.searchParams.get("awinaffid")).toBe("22222");
    const innerUrl = new URL(awinUrl.searchParams.get("ued")!);
    expect(innerUrl.origin + innerUrl.pathname).toBe("https://shop.example.de/products/jacket");
    expect(innerUrl.searchParams.get("utm_source")).toBe("shopcart.wals.pro");
    expect(wrapped.affiliate_disclosure).toBe(true);
    expect(wrapped.applied_network).toBe("awin");

    // Exact rule beats wildcard rule for vip.example.de (Sovrn Commerce)
    const exactWins = applyAttribution("https://vip.example.de/item/1", cfg, { kind: "product" });
    expect(new URL(exactWins.url).hostname).toBe("redirect.viglink.com");
    expect(exactWins.applied_network).toBe("sovrn");
    expect(exactWins.affiliate_disclosure).toBe(true);

    // Lookalike suffix "notexample.de" NEVER matches "*.example.de"
    const nonMatch = applyAttribution("https://notexample.de/products/a", cfg, { kind: "product" });
    expect(new URL(nonMatch.url).hostname).toBe("notexample.de");
    expect(nonMatch.affiliate_disclosure).toBe(false);
  });

  it("rejects unsafe deeplink templates and degrades safely on malformed JSON env vars", () => {
    // SSRF / URL validation on deeplink templates
    expect(
      validateDeeplinkTemplate("http://www.awin1.com/cread.php?ued={encoded_url}").valid
    ).toBe(false);
    expect(validateDeeplinkTemplate("javascript:alert({encoded_url})").valid).toBe(false);
    expect(
      validateDeeplinkTemplate("https://127.0.0.1/redirect?u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateDeeplinkTemplate("https://169.254.169.254/latest?u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateDeeplinkTemplate("https://localhost/redirect?u={encoded_url}").valid
    ).toBe(false);
    expect(
      validateDeeplinkTemplate("https://{encoded_url}/evil").valid
    ).toBe(false);
    expect(
      validateDeeplinkTemplate("https://www.awin1.com/cread.php?ued={raw_url}").valid
    ).toBe(false);
    expect(
      validateDeeplinkTemplate("https://www.awin1.com/cread.php?ued=static").valid
    ).toBe(false);
    expect(
      validateDeeplinkTemplate(
        "https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued={encoded_url}"
      ).valid
    ).toBe(true);

    // Malformed JSON does not throw and preserves default UTM behavior
    const malformed = loadAttributionConfig({
      AMAZON_ASSOCIATE_TAGS_JSON: "{not valid json",
      AFFILIATE_RULES_JSON: "[{broken"
    });
    expect(malformed.affiliateRules).toEqual([]);
    expect(malformed.amazonAssociateTags).toEqual({});
    expect(malformed.warnings.length).toBeGreaterThanOrEqual(2);

    // Mix of valid and unsafe rules keeps only valid rules
    const mixed = loadAttributionConfig({
      AFFILIATE_RULES_JSON: JSON.stringify([
        { domain: "bad.example", deeplink_template: "http://evil.test/?u={encoded_url}" },
        { domain: "good.example", ref: "ok123" }
      ])
    });
    expect(mixed.affiliateRules).toHaveLength(1);
    expect(mixed.affiliateRules[0]!.domain).toBe("good.example");
    expect(mixed.warnings).toHaveLength(1);
  });
});

describe("Awin Affiliate Product Feed Adapter (src/adapters/affiliate-feed/)", () => {
  const SAMPLE_FEED_CSV = [
    "aw_deep_link,product_name,aw_product_id,merchant_product_id,merchant_image_url,description,merchant_category,search_price,merchant_name,merchant_id,currency,in_stock,stock_quantity,brand_name,ean,gtin,mpn,rrp_price,store_price,merchant_deep_link",
    '"https://www.awin1.com/pclick.php?p=1001&a=999&m=11307","Sony WH-1000XM5 Wireless Kopfhörer Schwarz",1001,MM-XM5,"https://assets.mmsrg.com/xm5.jpg","Noise Cancelling Kopfhörer, 30h Akku","Audio > Kopfhörer",289.00,"MediaMarkt DE",11307,EUR,1,15,Sony,4548736132580,4548736132580,WH1000XM5B,399.00,289.00,"https://www.mediamarkt.de/de/product/sony-wh1000xm5"',
    '"https://www.awin1.com/pclick.php?p=1002&a=999&m=14336","Sony WH-1000XM5 Bluetooth Over-Ear",1002,OTTO-XM5,"https://i.otto.de/xm5.jpg","Premium ANC Over-Ear","Kopfhörer",279.99,"OTTO",14336,EUR,1,8,Sony,4548736132580,4548736132580,WH1000XM5B,419.00,279.99,"https://www.otto.de/p/sony-wh1000xm5"',
    '"https://www.awin1.com/pclick.php?p=1003&a=999&m=15000","Apple MacBook Air M3 16GB",1003,CP-MBA,"https://img.cyberport.de/mba.jpg","13 Zoll Laptop","Notebooks",1149.00,"Cyberport",15000,EUR,1,4,Apple,0195949112232,0195949112232,MRXN3D/A,1299.00,1149.00,"https://www.cyberport.de/macbook-air"',
    '"https://www.awin1.com/pclick.php?p=1004&a=999&m=16000","Sony WH-1000XM5 Silber (Ausverkauft)",1004,ALT-XM5,"https://www.alternate.de/xm5.jpg","Sold out model","Audio",269.00,"Alternate",16000,EUR,0,0,Sony,4548736132580,4548736132580,WH1000XM5S,399.00,269.00,"https://www.alternate.de/sony-xm5"',
    '"javascript:alert(1)","Malicious Row",9999,BAD-1,"","XSS test","Bad",1.00,"EvilStore",9999,EUR,1,1,Bad,0000000000000,,BAD,2.00,1.00,"http://127.0.0.1/bad"'
  ].join("\n");

  const SAMPLE_DECATHLON_CSV = [
    "aw_deep_link,product_name,aw_product_id,merchant_product_id,merchant_image_url,description,merchant_category,search_price,merchant_name,merchant_id,currency,in_stock,stock_quantity,brand_name,ean,gtin,mpn,rrp_price,store_price,merchant_deep_link",
    '"https://www.awin1.com/pclick.php?p=2001&a=999&m=17000","Quechua Wanderrucksack 30L",2001,DEC-30L,"https://contents.mediadecathlon.com/pack.jpg","Leichter Rucksack für Tagestouren","Wandern",49.99,"Decathlon DE",17000,EUR,1,20,Quechua,3608439123456,3608439123456,MH500,59.99,49.99,"https://www.decathlon.de/p/mh500"'
  ].join("\n");

  it("degrades gracefully with zero errors when AWIN env vars are not set", async () => {
    const provider = createAffiliateFeedProvider(loadAffiliateFeedConfig({}));
    expect(provider.isConfigured()).toBe(false);
    expect(await provider.listMerchants()).toEqual([]);

    const result = await searchAffiliateDeals(provider, { query: "Sony" });
    expect(result.configured).toBe(false);
    expect(result.products).toEqual([]);
    expect(result.affiliate_disclosure).toBe(false);
    expect(result.notices[0]).toContain("not configured");
  });

  it("supports gzipped + plain CSV feeds, EAN/GTIN lookup, umlaut keyword search, TTL caching, and SSRF hardening", async () => {
    let nowMs = 1_700_000_000_000;
    let fetchCount = 0;

    const gzippedElectronics = zlib.gzipSync(Buffer.from(SAMPLE_FEED_CSV, "utf8"));

    const client = new AwinFeedClient(
      loadAffiliateFeedConfig({
        AWIN_API_TOKEN: "secret-awin-token-xyz",
        AWIN_PUBLISHER_ID: "999123",
        AWIN_FEED_IDS: "55501,55502",
        AWIN_FEED_TTL_SECONDS: "300"
      }),
      {
        nowFn: () => nowMs,
        fetcher: async (url) => {
          fetchCount++;
          if (url.includes("/fid/55501/")) {
            return makeResponse(url, gzippedElectronics, 200, "application/gzip");
          }
          if (url.includes("/fid/55502/")) {
            return makeResponse(url, SAMPLE_DECATHLON_CSV, 200, "text/csv");
          }
          return makeResponse(url, "Not Found", 404, "text/plain");
        }
      }
    );

    expect(client.isConfigured()).toBe(true);

    // 1. EAN lookup returns all matching offers sorted in-stock first, then lowest price (OTTO 279.99 -> MediaMarkt 289.00 -> Alternate out-of-stock 269.00)
    const eanRes = await client.searchByEan("4548736132580");
    expect(fetchCount).toBe(2);
    expect(eanRes.configured).toBe(true);
    expect(eanRes.affiliate_disclosure).toBe(true);
    expect(eanRes.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);
    expect(eanRes.merchants_searched).toEqual([
      "Alternate",
      "Cyberport",
      "Decathlon DE",
      "MediaMarkt DE",
      "OTTO"
    ]);
    expect(eanRes.products).toHaveLength(3);
    expect(eanRes.products[0]!.merchant_name).toBe("OTTO");
    expect(eanRes.products[0]!.price.amount).toBe(279.99);
    expect(eanRes.products[0]!.compare_at_price?.amount).toBe(419);
    expect(eanRes.products[0]!.url).toContain("https://www.awin1.com/pclick.php");
    expect(eanRes.products[0]!.affiliate_disclosure).toBe(true);
    expect(eanRes.products[1]!.merchant_name).toBe("MediaMarkt DE");
    expect(eanRes.products[2]!.merchant_name).toBe("Alternate");
    expect(eanRes.products[2]!.available).toBe(false);

    // 2. Subsequent search within TTL uses in-memory cache (no new HTTP fetches)
    const kwRes = await client.search({
      query: "Kopfhoerer",
      availableOnly: true,
      maxPrice: 300
    });
    expect(fetchCount).toBe(2); // still cached!
    expect(kwRes.products).toHaveLength(2);
    expect(kwRes.products.every((p) => p.available)).toBe(true);

    // Malicious javascript: row was sanitized out and never appears
    const allRes = await client.search({ query: "Malicious" });
    expect(allRes.products).toHaveLength(0);

    // 3. Auto-detects EAN when passed in query string & supports merchant filter
    const autoEan = await client.search({ query: "3608439123456", merchant: "Decathlon" });
    expect(autoEan.products).toHaveLength(1);
    expect(autoEan.products[0]!.merchant_name).toBe("Decathlon DE");
    expect(autoEan.products[0]!.price.formatted).toBe("49.99 EUR");

    // 4. Advance clock past TTL -> refreshes feeds
    nowMs += 301_000;
    await client.search({ query: "MacBook" });
    expect(fetchCount).toBe(4);

    // 5. SSRF allowlist blocks non-Awin feed URLs
    expect(() => validateAwinFeedUrl("https://evil.example/feed.csv")).toThrow();
    expect(() => validateAwinFeedUrl("http://productdata.awin.com/feed.csv")).toThrow();
    expect(() => validateAwinFeedUrl("https://169.254.169.254/latest")).toThrow();
    expect(validateAwinFeedUrl("https://productdata.awin.com/datafeed/list/apikey/test")).toContain(
      "productdata.awin.com"
    );

    // 6. Token is never leaked in error notices
    const failingClient = new AwinFeedClient(
      loadAffiliateFeedConfig({
        AWIN_API_TOKEN: "super-secret-token-999",
        AWIN_PUBLISHER_ID: "123",
        AWIN_FEED_IDS: "777"
      }),
      {
        fetcher: async () => {
          throw new Error("Connection failed to https://productdata.awin.com/apikey/super-secret-token-999");
        }
      }
    );
    const errRes = await failingClient.search({ query: "test" });
    expect(errRes.notices[0]).not.toContain("super-secret-token-999");
    expect(errRes.notices[0]).toContain("[REDACTED]");
  });
});

describe("MCP tool integration & /privacy + /terms affiliate disclosure", () => {
  function makeShopifyMockRegistry() {
    const client = new ShopifyClient(async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/meta.json") {
        return makeResponse(
          url,
          JSON.stringify({ id: 1, name: "SNOCKS", currency: "EUR", country: "DE", domain: "snocks.com" }),
          200,
          "application/json"
        );
      }
      if (parsed.pathname === "/search/suggest.json") {
        return makeResponse(
          url,
          JSON.stringify({
            resources: {
              results: {
                products: [
                  {
                    id: 101,
                    handle: "sneaker-socken",
                    title: "Sneaker Socken",
                    vendor: "SNOCKS",
                    available: true,
                    price: "19.99",
                    url: "/products/sneaker-socken?_pos=1"
                  }
                ]
              }
            }
          }),
          200,
          "application/json"
        );
      }
      if (parsed.pathname === "/products/sneaker-socken.js") {
        return makeResponse(
          url,
          JSON.stringify({
            id: 101,
            handle: "sneaker-socken",
            title: "Sneaker Socken",
            vendor: "SNOCKS",
            available: true,
            url: "/products/sneaker-socken",
            options: ["Size"],
            variants: [{ id: 44434567725323, title: "43-46", available: true, price: 1999, options: ["43-46"] }]
          }),
          200,
          "application/json"
        );
      }
      return makeResponse(url, "Not Found", 404, "text/plain");
    });
    return new AdapterRegistry([new ShopifyAdapter(client)]);
  }

  it("attaches UTMs & affiliate disclosure across MCP tools, supports compare/deals search, and renders DE/EN legal disclosures", async () => {
    const emailSender = new MemoryEmailSender();
    const feedCsv = [
      "aw_deep_link,product_name,aw_product_id,merchant_product_id,search_price,merchant_name,merchant_id,currency,in_stock,brand_name,ean",
      '"https://www.awin1.com/pclick.php?p=501&a=1&m=2","Garmin Fenix 8",501,G8,899.00,"MediaMarkt DE",2,EUR,1,Garmin,0753759337728'
    ].join("\n");

    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      STORAGE_BACKEND: "memory",
      SESSION_SECRET: "test-session-secret-0123456789abcdef",
      AFFILIATE_RULES_JSON: JSON.stringify([
        { domain: "snocks.com", network: "direct", ref: "walspro", discount: "SNOCKS10" }
      ]),
      AWIN_API_TOKEN: "mock-token",
      AWIN_PUBLISHER_ID: "999",
      AWIN_FEED_IDS: "12345"
    });

    const affiliateFeed = new AwinFeedClient(config.affiliateFeed, {
      fetcher: async (url) => makeResponse(url, feedCsv, 200, "text/csv")
    });

    const app = createApp({
      config,
      store: new MemoryStore(),
      registry: makeShopifyMockRegistry(),
      affiliateFeed,
      emailSender
    });

    // 1. Verify /privacy and /terms include DE + EN EU/DACH/FTC & Amazon PartnerNet disclosures
    const privDe = await request(app).get("/privacy?lang=de").expect(200);
    expect(privDe.text).toContain("utm_source=shopcart.wals.pro");
    expect(privDe.text).toContain("affiliate_disclosure: true");
    expect(privDe.text).toContain("Als Amazon-Partner verdient Wals Professional Services GmbH an qualifizierten Verkäufen");

    const privEn = await request(app).get("/privacy?lang=en").expect(200);
    expect(privEn.text).toContain("As an Amazon Associate, Wals Professional Services GmbH earns from qualifying purchases");
    expect(privEn.text).toContain("16 CFR Part 255");

    const termsDe = await request(app).get("/terms?lang=de").expect(200);
    expect(termsDe.text).toContain("Affiliate-");
    expect(termsDe.text).toContain("Als Amazon-Partner verdient Wals Professional Services GmbH an qualifizierten Verkäufen");

    const termsEn = await request(app).get("/terms?lang=en").expect(200);
    expect(termsEn.text).toContain("Affiliate &amp; Partner Link Disclosure");
    expect(termsEn.text).toContain("As an Amazon Associate, Wals Professional Services GmbH earns from qualifying purchases");

    // 2. Authenticate and exercise MCP tools over Streamable HTTP
    const token = await issueBearerToken(app, emailSender);

    const listRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);

    const toolNames = (listRes.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toContain("search_affiliate_deals");

    // 3. create_cart_link applies UTM + partner rule (ref + discount) + affiliate_disclosure: true
    const cartCall = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "create_cart_link",
          arguments: {
            store_url: "snocks.com",
            items: [{ variant_id: "44434567725323", quantity: 2 }],
            mode: "cart"
          }
        }
      })
      .expect(200);

    const cartPayload = JSON.parse(cartCall.body.result.content[0].text as string);
    const cartUrl = new URL(cartPayload.cart_url);
    expect(cartUrl.searchParams.get("storefront")).toBe("true");
    expect(cartUrl.searchParams.get("utm_source")).toBe("shopcart.wals.pro");
    expect(cartUrl.searchParams.get("ref")).toBe("walspro");
    expect(cartUrl.searchParams.get("discount")).toBe("SNOCKS10");
    expect(cartPayload.affiliate_disclosure).toBe(true);
    expect(cartPayload.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);

    // 4. search_products(store_url="compare") routes cleanly to Awin feed
    const compareCall = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "search_products",
          arguments: {
            store_url: "compare",
            query: "Garmin Fenix 8"
          }
        }
      })
      .expect(200);

    const comparePayload = JSON.parse(compareCall.body.result.content[0].text as string);
    expect(comparePayload.affiliate_disclosure).toBe(true);
    expect(comparePayload.disclosure_note).toBe(AFFILIATE_DISCLOSURE_NOTE);
    expect(comparePayload.products).toHaveLength(1);
    expect(comparePayload.products[0].merchant_name).toBe("MediaMarkt DE");
    expect(comparePayload.products[0].ean).toBe("0753759337728");

    // 5. search_affiliate_deals by EAN
    const dealsCall = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "search_affiliate_deals",
          arguments: {
            ean: "0753759337728"
          }
        }
      })
      .expect(200);

    const dealsPayload = JSON.parse(dealsCall.body.result.content[0].text as string);
    expect(dealsPayload.affiliate_disclosure).toBe(true);
    expect(dealsPayload.products).toHaveLength(1);
    expect(dealsPayload.products[0].product_url).toContain("https://www.awin1.com/pclick.php");
  });

  it("sets affiliate_disclosure=false for pure UTM across search_products/get_product/create_cart_link and degrades gracefully when AWIN is unset", async () => {
    const emailSender = new MemoryEmailSender();
    const config = loadConfig({
      APP_ORIGIN: "https://shopcart.wals.pro",
      STORAGE_BACKEND: "memory",
      SESSION_SECRET: "test-session-secret-0123456789abcdef"
    });
    const app = createApp({
      config,
      store: new MemoryStore(),
      registry: makeShopifyMockRegistry(),
      emailSender
    });

    const token = await issueBearerToken(app, emailSender);

    // search_products -> pure UTM, affiliate_disclosure: false
    const searchRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "search_products",
          arguments: { store_url: "snocks.com", query: "Socken" }
        }
      })
      .expect(200);
    const searchData = JSON.parse(searchRes.body.result.content[0].text as string);
    expect(searchData.affiliate_disclosure).toBe(false);
    expect(searchData.disclosure_note).toBeUndefined();
    const prodUrl = new URL(searchData.products[0].url);
    expect(prodUrl.searchParams.get("utm_source")).toBe("shopcart.wals.pro");
    expect(prodUrl.searchParams.get("utm_medium")).toBe("ai_mcp");
    expect(prodUrl.searchParams.get("utm_campaign")).toBe("shopcart_mcp");

    // get_product -> pure UTM, affiliate_disclosure: false
    const detailRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "get_product",
          arguments: { store_url: "snocks.com", handle_or_url: "sneaker-socken" }
        }
      })
      .expect(200);
    const detailData = JSON.parse(detailRes.body.result.content[0].text as string);
    expect(detailData.affiliate_disclosure).toBe(false);
    expect(detailData.disclosure_note).toBeUndefined();
    expect(new URL(detailData.product.url).searchParams.get("utm_source")).toBe("shopcart.wals.pro");

    // search_products(store_url="deals") with no AWIN env -> 0 errors, helpful notice
    const dealsFallback = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "search_products",
          arguments: { store_url: "deals", query: "Sony" }
        }
      })
      .expect(200);
    expect(dealsFallback.body.result.isError).toBe(false);
    const dealsData = JSON.parse(dealsFallback.body.result.content[0].text as string);
    expect(dealsData.products).toEqual([]);
    expect(dealsData.affiliate_disclosure).toBe(false);
    expect(dealsData.notices[0]).toContain("not configured");
  });
});
