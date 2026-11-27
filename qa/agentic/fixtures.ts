import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AffiliateFeedProvider,
  AwinPromotionsProvider
} from "../../src/adapters/affiliate-feed/index.js";
import { AdapterRegistry } from "../../src/adapters/registry.js";
import type {
  CartLinkItemInput,
  CartLinkResult,
  CollectionSummary,
  FindStoreDiscountsOptions,
  GetProductResult,
  ListCollectionsOptions,
  ListCollectionsResult,
  Money,
  ProductDetail,
  ProductSummary,
  SearchProductsOptions,
  SearchProductsResult,
  StoreAdapter,
  StoreDiscountsResult,
  StoreInfo,
  StorePoliciesOptions,
  StorePoliciesResult
} from "../../src/adapters/types.js";
import { DISCOUNT_DISCLAIMER, SOURCE_NOTICE_DISCOUNTS } from "../../src/adapters/shopify/discounts.js";
import { loadAttributionConfig } from "../../src/attribution/links.js";
import { loadComparisonConfig } from "../../src/comparison/deep-links.js";
import { createShopcartMcpServer } from "../../src/mcp/create-server.js";
import type { AnthropicToolDefinition } from "./types.js";

function money(amount: number, currency: string): Money {
  const rounded = Math.round(amount * 100) / 100;
  return {
    amount: rounded,
    formatted: `${rounded.toFixed(2)} ${currency}`,
    currency
  };
}

interface FixtureStoreData {
  origin: string;
  name: string;
  currency: string;
  country: string;
  myshopifyDomain: string;
  collections: CollectionSummary[];
  products: ProductDetail[];
  policies: Omit<StorePoliciesResult, "store_origin">;
  discounts: Omit<StoreDiscountsResult, "store_origin">;
}

function buildAllbirdsFixture(): FixtureStoreData {
  const origin = "https://allbirds.com";
  const woolRunner: ProductDetail = {
    id: "prod-ab-wool-runner",
    handle: "mens-wool-runner",
    title: "Allbirds Men's Wool Runner",
    vendor: "Allbirds",
    product_type: "Sneakers",
    description_text:
      "Soft ZQ Merino wool everyday sneaker with SweetFoam sugarcane midsole. Machine washable and breathable.",
    sku: "AB-WR-BLK",
    ean: "0194987654321",
    available: true,
    availability: "InStock",
    price_min: money(119.45, "EUR"),
    price_max: money(119.45, "EUR"),
    url: `${origin}/products/mens-wool-runner`,
    options: [
      { name: "Color", values: ["Natural Black", "Mist Grey"] },
      { name: "Size", values: ["EU 41", "EU 42", "EU 43"] }
    ],
    images: [`${origin}/cdn/shop/files/wool-runner-black.jpg`],
    variants: [
      {
        id: "42001001",
        title: "Natural Black / EU 41",
        sku: "AB-WR-BLK-41",
        ean: "0194987654314",
        available: true,
        availability: "InStock",
        price: money(119.45, "EUR"),
        compare_at_price: money(135.0, "EUR"),
        discount_percent: 12,
        savings: money(15.55, "EUR"),
        option_values: ["Natural Black", "EU 41"],
        url: `${origin}/products/mens-wool-runner?variant=42001001`
      },
      {
        id: "42001002",
        title: "Natural Black / EU 42",
        sku: "AB-WR-BLK-42",
        ean: "0194987654321",
        available: true,
        availability: "InStock",
        price: money(119.45, "EUR"),
        compare_at_price: money(135.0, "EUR"),
        discount_percent: 12,
        savings: money(15.55, "EUR"),
        option_values: ["Natural Black", "EU 42"],
        url: `${origin}/products/mens-wool-runner?variant=42001002`
      },
      {
        id: "42001003",
        title: "Natural Black / EU 43",
        sku: "AB-WR-BLK-43",
        ean: "0194987654338",
        available: false,
        availability: "OutOfStock",
        price: money(119.45, "EUR"),
        compare_at_price: money(135.0, "EUR"),
        discount_percent: 12,
        savings: money(15.55, "EUR"),
        option_values: ["Natural Black", "EU 43"],
        url: `${origin}/products/mens-wool-runner?variant=42001003`
      }
    ]
  };

  const treeRunner: ProductDetail = {
    id: "prod-ab-tree-runner",
    handle: "mens-tree-runner",
    title: "Allbirds Men's Tree Runner",
    vendor: "Allbirds",
    product_type: "Sneakers",
    description_text:
      "Lightweight eucalyptus tree fiber sneaker designed for warm weather comfort.",
    sku: "AB-TR-WHT",
    ean: "0194987654413",
    available: true,
    availability: "InStock",
    price_min: money(109.2, "EUR"),
    price_max: money(109.2, "EUR"),
    url: `${origin}/products/mens-tree-runner`,
    options: [
      { name: "Color", values: ["Kaikoura White"] },
      { name: "Size", values: ["EU 42", "EU 43"] }
    ],
    images: [`${origin}/cdn/shop/files/tree-runner-white.jpg`],
    variants: [
      {
        id: "42002001",
        title: "Kaikoura White / EU 42",
        sku: "AB-TR-WHT-42",
        ean: "0194987654413",
        available: true,
        availability: "InStock",
        price: money(109.2, "EUR"),
        compare_at_price: null,
        option_values: ["Kaikoura White", "EU 42"],
        url: `${origin}/products/mens-tree-runner?variant=42002001`
      }
    ]
  };

  return {
    origin,
    name: "Allbirds",
    currency: "EUR",
    country: "DE",
    myshopifyDomain: "allbirds-eu.myshopify.com",
    collections: [
      {
        id: "col-ab-sale",
        handle: "sale",
        title: "Seasonal Sale",
        products_count: 24,
        url: `${origin}/collections/sale`,
        is_deal_collection: true,
        deal_tags: ["sale"]
      },
      {
        id: "col-ab-bestsellers",
        handle: "bestsellers",
        title: "Bestsellers",
        products_count: 18,
        url: `${origin}/collections/bestsellers`,
        is_deal_collection: true,
        deal_tags: ["bestseller"]
      },
      {
        id: "col-ab-mens-runners",
        handle: "mens-runners",
        title: "Men's Wool & Tree Runners",
        products_count: 32,
        url: `${origin}/collections/mens-runners`,
        is_deal_collection: false,
        deal_tags: []
      },
      {
        id: "col-ab-womens-runners",
        handle: "womens-runners",
        title: "Women's Wool & Tree Runners",
        products_count: 30,
        url: `${origin}/collections/womens-runners`,
        is_deal_collection: false,
        deal_tags: []
      },
      {
        id: "col-ab-apparel",
        handle: "apparel",
        title: "Sustainable Apparel & Socks",
        products_count: 19,
        url: `${origin}/collections/apparel`,
        is_deal_collection: false,
        deal_tags: []
      }
    ],
    products: [woolRunner, treeRunner],
    policies: {
      shipping_policy_excerpt:
        "Standard shipping within Germany and EU is 5.00 EUR and free on orders over 75.00 EUR. Delivery takes 2 to 4 business days via DHL or DPD.",
      return_policy_excerpt:
        "Allbirds offers a 30-day no-questions-asked return window with free return shipping labels for unworn or lightly tried items.",
      hints: {
        free_shipping_threshold: "75.00 EUR",
        return_window_days: 30,
        return_window_text: "30 days",
        free_returns: true,
        delivery_time_text: "2-4 business days",
        shipping_carriers: ["DHL", "DPD"]
      },
      policy_urls: {
        shipping: `${origin}/policies/shipping-policy`,
        returns: `${origin}/policies/refund-policy`
      },
      notices: []
    },
    discounts: {
      codes: [
        {
          code: "WOOL15",
          context_snippet: "Save 15% on your order with promo code WOOL15 (announcement bar).",
          source: "homepage_announcement",
          estimated_discount_text: "15% off",
          confidence: "high"
        }
      ],
      automatic_deals: [
        {
          text: "Free standard shipping automatically applied on orders over 75 EUR.",
          source: "homepage_banner"
        }
      ],
      checked_sources: ["homepage_announcement", "homepage_banner", "collection_description"],
      source_notice: SOURCE_NOTICE_DISCOUNTS,
      disclaimer: DISCOUNT_DISCLAIMER
    }
  };
}

function buildGymsharkFixture(): FixtureStoreData {
  const origin = "https://gymshark.com";
  const crestTee: ProductDetail = {
    id: "prod-gs-crest-tee",
    handle: "crest-classic-black-t-shirt",
    title: "Gymshark Crest Classic T-Shirt - Black",
    vendor: "Gymshark",
    product_type: "T-Shirts",
    description_text:
      "Classic regular-fit training and everyday black cotton-blend t-shirt with minimalist embroidered crest logo.",
    sku: "GS-CREST-BLK",
    ean: "5057913456789",
    available: true,
    availability: "InStock",
    price_min: money(24.85, "USD"),
    price_max: money(24.85, "USD"),
    url: `${origin}/products/crest-classic-black-t-shirt`,
    options: [
      { name: "Color", values: ["Black"] },
      { name: "Size", values: ["S", "M", "L", "XL"] }
    ],
    images: [`${origin}/cdn/shop/files/crest-classic-black-tee.jpg`],
    variants: [
      {
        id: "51002001",
        title: "Black / S",
        sku: "GS-CREST-BLK-S",
        available: true,
        availability: "InStock",
        price: money(24.85, "USD"),
        compare_at_price: money(30.0, "USD"),
        discount_percent: 17,
        savings: money(5.15, "USD"),
        option_values: ["Black", "S"],
        url: `${origin}/products/crest-classic-black-t-shirt?variant=51002001`
      },
      {
        id: "51002002",
        title: "Black / M",
        sku: "GS-CREST-BLK-M",
        available: true,
        availability: "InStock",
        price: money(24.85, "USD"),
        compare_at_price: money(30.0, "USD"),
        discount_percent: 17,
        savings: money(5.15, "USD"),
        option_values: ["Black", "M"],
        url: `${origin}/products/crest-classic-black-t-shirt?variant=51002002`
      },
      {
        id: "51002003",
        title: "Black / L",
        sku: "GS-CREST-BLK-L",
        available: true,
        availability: "InStock",
        price: money(24.85, "USD"),
        compare_at_price: money(30.0, "USD"),
        discount_percent: 17,
        savings: money(5.15, "USD"),
        option_values: ["Black", "L"],
        url: `${origin}/products/crest-classic-black-t-shirt?variant=51002003`
      },
      {
        id: "51002004",
        title: "Black / XL",
        sku: "GS-CREST-BLK-XL",
        available: false,
        availability: "OutOfStock",
        price: money(24.85, "USD"),
        compare_at_price: money(30.0, "USD"),
        discount_percent: 17,
        savings: money(5.15, "USD"),
        option_values: ["Black", "XL"],
        url: `${origin}/products/crest-classic-black-t-shirt?variant=51002004`
      }
    ]
  };

  const arrivalTee: ProductDetail = {
    id: "prod-gs-arrival-tee",
    handle: "arrival-slim-black-t-shirt",
    title: "Gymshark Arrival Slim T-Shirt - Black",
    vendor: "Gymshark",
    product_type: "T-Shirts",
    description_text: "Lightweight sweat-wicking performance t-shirt in matte black.",
    sku: "GS-ARR-BLK",
    available: true,
    availability: "InStock",
    price_min: money(21.6, "USD"),
    price_max: money(21.6, "USD"),
    url: `${origin}/products/arrival-slim-black-t-shirt`,
    options: [{ name: "Size", values: ["S", "M", "L"] }],
    images: [`${origin}/cdn/shop/files/arrival-black-tee.jpg`],
    variants: [
      {
        id: "51003002",
        title: "Black / M",
        sku: "GS-ARR-BLK-M",
        available: true,
        availability: "InStock",
        price: money(21.6, "USD"),
        compare_at_price: null,
        option_values: ["M"],
        url: `${origin}/products/arrival-slim-black-t-shirt?variant=51003002`
      }
    ]
  };

  return {
    origin,
    name: "Gymshark",
    currency: "USD",
    country: "US",
    myshopifyDomain: "gymshark-us.myshopify.com",
    collections: [
      {
        id: "col-gs-outlet",
        handle: "outlet",
        title: "Outlet & Sale",
        products_count: 64,
        url: `${origin}/collections/outlet`,
        is_deal_collection: true,
        deal_tags: ["outlet", "sale"]
      },
      {
        id: "col-gs-mens-tees",
        handle: "mens-t-shirts",
        title: "Men's T-Shirts & Tops",
        products_count: 48,
        url: `${origin}/collections/mens-t-shirts`,
        is_deal_collection: false,
        deal_tags: []
      }
    ],
    products: [crestTee, arrivalTee],
    policies: {
      shipping_policy_excerpt:
        "Standard shipping is 5.00 USD and free on orders over 75.00 USD. Express shipping arrives in 1-2 business days.",
      return_policy_excerpt:
        "30-day return policy for unworn gymwear with tags attached.",
      hints: {
        free_shipping_threshold: "75.00 USD",
        return_window_days: 30,
        return_window_text: "30 days",
        free_returns: true,
        delivery_time_text: "3-5 business days",
        shipping_carriers: ["UPS", "USPS"]
      },
      policy_urls: {
        shipping: `${origin}/policies/shipping-policy`,
        returns: `${origin}/policies/refund-policy`
      },
      notices: []
    },
    discounts: {
      codes: [
        {
          code: "GYM10",
          context_snippet: "Get 10% off training essentials with code GYM10.",
          source: "homepage_banner",
          estimated_discount_text: "10% off",
          confidence: "high"
        }
      ],
      automatic_deals: [],
      checked_sources: ["homepage_banner"],
      source_notice: SOURCE_NOTICE_DISCOUNTS,
      disclaimer: DISCOUNT_DISCLAIMER
    }
  };
}

function buildWaterdropFixture(): FixtureStoreData {
  const origin = "https://waterdrop.com";
  const redBottle: ProductDetail = {
    id: "prod-wd-red-bottle",
    handle: "matte-red-thermo-bottle-500ml",
    title: "Minimalist Matte Red Insulated Bottle with Wood Lid 500ml",
    vendor: "waterdrop",
    product_type: "Thermosflasche",
    description_text:
      "Minimalistische doppelwandige Edelstahl-Thermosflasche in Mattrot mit Bambus-Holzdeckel, 500 ml Fassungsvermögen.",
    sku: "WD-THERMO-RED-500",
    ean: "9120089412345",
    available: true,
    availability: "InStock",
    price_min: money(38.75, "EUR"),
    price_max: money(38.75, "EUR"),
    url: `${origin}/products/matte-red-thermo-bottle-500ml`,
    options: [
      { name: "Color", values: ["Matte Red"] },
      { name: "Size", values: ["500 ml"] }
    ],
    images: [`${origin}/cdn/shop/files/matte-red-thermo-bottle-500ml.jpg`],
    variants: [
      {
        id: "63001001",
        title: "Matte Red / 500 ml",
        sku: "WD-THERMO-RED-500",
        ean: "9120089412345",
        available: true,
        availability: "InStock",
        price: money(38.75, "EUR"),
        compare_at_price: null,
        option_values: ["Matte Red", "500 ml"],
        url: `${origin}/products/matte-red-thermo-bottle-500ml?variant=63001001`
      }
    ]
  };

  return {
    origin,
    name: "waterdrop",
    currency: "EUR",
    country: "AT",
    myshopifyDomain: "waterdrop-eu.myshopify.com",
    collections: [
      {
        id: "col-wd-bottles",
        handle: "trinkflaschen",
        title: "Isolierte Trinkflaschen & Thermosflaschen",
        products_count: 22,
        url: `${origin}/collections/trinkflaschen`,
        is_deal_collection: false,
        deal_tags: []
      }
    ],
    products: [redBottle],
    policies: {
      shipping_policy_excerpt: "Kostenloser Versand ab 49.00 EUR in AT/DE.",
      return_policy_excerpt: "30 Tage Rückgaberecht.",
      hints: {
        free_shipping_threshold: "49.00 EUR",
        return_window_days: 30,
        return_window_text: "30 Tage",
        free_returns: true,
        delivery_time_text: "2-3 Werktage",
        shipping_carriers: ["DHL", "Österreichische Post"]
      },
      policy_urls: {
        shipping: `${origin}/policies/shipping-policy`,
        returns: `${origin}/policies/refund-policy`
      },
      notices: []
    },
    discounts: {
      codes: [],
      automatic_deals: [],
      checked_sources: ["homepage_banner"],
      source_notice: SOURCE_NOTICE_DISCOUNTS,
      disclaimer: DISCOUNT_DISCLAIMER
    }
  };
}

function buildGenericFallbackFixture(origin: string): FixtureStoreData {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const storeName = host.split(".")[0] ?? "DemoStore";
  const displayName = storeName.charAt(0).toUpperCase() + storeName.slice(1);
  const genericProduct: ProductDetail = {
    id: `prod-${storeName}-featured`,
    handle: "featured-catalog-item",
    title: `${displayName} Featured Item (Matte Red / Classic)`,
    vendor: displayName,
    product_type: "Featured",
    description_text: `Deterministic fixture product for ${host}.`,
    sku: `${storeName.toUpperCase()}-001`,
    available: true,
    availability: "InStock",
    price_min: money(49.95, "EUR"),
    price_max: money(49.95, "EUR"),
    url: `${origin}/products/featured-catalog-item`,
    options: [{ name: "Variant", values: ["Standard"] }],
    images: [`${origin}/cdn/shop/files/featured.jpg`],
    variants: [
      {
        id: "99001001",
        title: "Standard",
        sku: `${storeName.toUpperCase()}-001`,
        available: true,
        availability: "InStock",
        price: money(49.95, "EUR"),
        compare_at_price: null,
        option_values: ["Standard"],
        url: `${origin}/products/featured-catalog-item?variant=99001001`
      }
    ]
  };

  return {
    origin,
    name: displayName,
    currency: "EUR",
    country: "DE",
    myshopifyDomain: `${storeName}.myshopify.com`,
    collections: [
      {
        id: `col-${storeName}-all`,
        handle: "all",
        title: "All Products",
        products_count: 12,
        url: `${origin}/collections/all`,
        is_deal_collection: false,
        deal_tags: []
      }
    ],
    products: [genericProduct],
    policies: {
      shipping_policy_excerpt: "Standard shipping 4.90 EUR, free over 60.00 EUR.",
      return_policy_excerpt: "30-day return window.",
      hints: {
        free_shipping_threshold: "60.00 EUR",
        return_window_days: 30,
        return_window_text: "30 days",
        free_returns: true,
        delivery_time_text: "2-4 business days",
        shipping_carriers: ["DHL"]
      },
      policy_urls: {
        shipping: `${origin}/policies/shipping-policy`,
        returns: `${origin}/policies/refund-policy`
      },
      notices: []
    },
    discounts: {
      codes: [],
      automatic_deals: [],
      checked_sources: ["homepage_banner"],
      source_notice: SOURCE_NOTICE_DISCOUNTS,
      disclaimer: DISCOUNT_DISCLAIMER
    }
  };
}

function toSummary(product: ProductDetail): ProductSummary {
  const firstVariant = product.variants[0];
  const price = product.price_min ?? firstVariant?.price ?? money(0, "EUR");
  const priceMax = product.price_max ?? price;
  const compareAt = firstVariant?.compare_at_price ?? null;
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    product_type: product.product_type,
    available: product.available,
    price,
    price_min: price,
    price_max: priceMax,
    compare_at_price: compareAt,
    discount_percent: firstVariant?.discount_percent ?? null,
    savings: firstVariant?.savings ?? null,
    url: product.url,
    image_url: product.images[0] ?? null
  };
}

function canonicalHost(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return origin.toLowerCase();
  }
}

/**
 * Deterministic in-memory Shopify fixture adapter.
 * Zero outbound network requests; supports every known benchmark store plus deterministic fallback.
 */
export class FixtureShopifyAdapter implements StoreAdapter {
  readonly platform = "shopify";
  private readonly storeMap = new Map<string, FixtureStoreData>();

  constructor() {
    const stores = [buildAllbirdsFixture(), buildGymsharkFixture(), buildWaterdropFixture()];
    for (const store of stores) {
      this.storeMap.set(canonicalHost(store.origin), store);
    }
  }

  private getStore(origin: string): FixtureStoreData {
    const host = canonicalHost(origin);
    return this.storeMap.get(host) ?? buildGenericFallbackFixture(origin);
  }

  async detect(origin: string): Promise<StoreInfo> {
    const store = this.getStore(origin);
    return {
      platform: "shopify",
      origin: store.origin,
      name: store.name,
      currency: store.currency,
      country: store.country,
      myshopifyDomain: store.myshopifyDomain,
      wafRestricted: false,
      capabilities: {
        predictiveSearch: true,
        productCatalogJson: true,
        storefrontMcp: true,
        storefrontMcpTools: ["search_shop_catalog", "search_shop_policies_and_faqs"],
        handoffTier: "cart_permalink"
      }
    };
  }

  async listCollections(
    origin: string,
    opts?: ListCollectionsOptions
  ): Promise<ListCollectionsResult> {
    const store = this.getStore(origin);
    const limit = opts?.limit ?? 30;
    const highlighted = store.collections.filter((c) => c.is_deal_collection);
    const selected = (opts?.dealsOnly ? highlighted : store.collections).slice(0, limit);
    return {
      store_origin: store.origin,
      waf_restricted: false,
      total_collections: selected.length,
      highlighted_deals: highlighted,
      collections: selected,
      notices: []
    };
  }

  async searchProducts(
    origin: string,
    opts: SearchProductsOptions
  ): Promise<SearchProductsResult> {
    const store = this.getStore(origin);
    const q = (opts.query ?? "").trim().toLowerCase();
    let products = [...store.products];

    if (q) {
      const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
      const matched = products.filter((p) => {
        const hay = `${p.title} ${p.handle} ${p.vendor ?? ""} ${p.product_type ?? ""} ${p.description_text}`.toLowerCase();
        return tokens.some((tok) => hay.includes(tok));
      });
      if (matched.length > 0) {
        products = matched;
      }
    }

    if (opts.availableOnly) {
      products = products.filter((p) => p.available);
    }

    let summaries = products.map(toSummary);

    if (typeof opts.minPrice === "number") {
      summaries = summaries.filter((p) => p.price.amount >= opts.minPrice!);
    }
    if (typeof opts.maxPrice === "number") {
      summaries = summaries.filter((p) => p.price.amount <= opts.maxPrice!);
    }

    if (opts.sortBy === "price_asc") {
      summaries.sort((a, b) => a.price.amount - b.price.amount);
    } else if (opts.sortBy === "price_desc") {
      summaries.sort((a, b) => b.price.amount - a.price.amount);
    } else if (opts.sortBy === "discount_desc") {
      summaries.sort((a, b) => (b.discount_percent ?? 0) - (a.discount_percent ?? 0));
    }

    return {
      store_origin: store.origin,
      currency: store.currency,
      ...(opts.collection ? { collection: opts.collection } : {}),
      ...(opts.sortBy ? { sort_by: opts.sortBy } : {}),
      handoff_tier: "cart_permalink",
      products: summaries.slice(0, opts.limit),
      notices: []
    };
  }

  async getProduct(origin: string, handleOrUrl: string): Promise<GetProductResult> {
    const store = this.getStore(origin);
    const needle = handleOrUrl.trim().toLowerCase();
    const matched =
      store.products.find(
        (p) =>
          p.handle.toLowerCase() === needle ||
          p.url.toLowerCase() === needle ||
          needle.includes(p.handle.toLowerCase()) ||
          p.id.toLowerCase() === needle ||
          p.variants.some((v) => v.id === handleOrUrl.trim())
      ) ?? store.products[0]!;

    return {
      store_origin: store.origin,
      currency: store.currency,
      handoff_tier: "cart_permalink",
      product: matched
    };
  }

  async getStorePolicies(
    origin: string,
    opts?: StorePoliciesOptions
  ): Promise<StorePoliciesResult> {
    const store = this.getStore(origin);
    const topic = opts?.topic ?? "all";
    return {
      store_origin: store.origin,
      shipping_policy_excerpt:
        topic === "returns" ? null : store.policies.shipping_policy_excerpt,
      return_policy_excerpt:
        topic === "shipping" ? null : store.policies.return_policy_excerpt,
      hints: store.policies.hints,
      policy_urls: store.policies.policy_urls,
      notices: store.policies.notices
    };
  }

  async findStoreDiscounts(
    origin: string,
    _opts?: FindStoreDiscountsOptions
  ): Promise<StoreDiscountsResult> {
    const store = this.getStore(origin);
    return {
      store_origin: store.origin,
      ...store.discounts
    };
  }

  async buildCartLink(
    origin: string,
    items: CartLinkItemInput[],
    opts: {
      mode: "cart" | "checkout";
      discountCode?: string;
      verifyHandles?: string[];
    }
  ): Promise<CartLinkResult> {
    const store = this.getStore(origin);
    const variantLookup = new Map<
      string,
      { title: string; available: boolean; price: Money }
    >();
    for (const product of store.products) {
      for (const variant of product.variants) {
        variantLookup.set(variant.id, {
          title: `${product.title} — ${variant.title}`,
          available: variant.available,
          price: variant.price
        });
      }
    }

    const warnings: string[] = [];
    const lineItems = items.map((item) => {
      const found = variantLookup.get(item.variantId);
      if (!found) {
        warnings.push(`Variant '${item.variantId}' was not found in fixture catalog.`);
        return {
          variant_id: item.variantId,
          quantity: item.quantity,
          verified: false
        };
      }
      if (!found.available) {
        warnings.push(`Variant '${item.variantId}' (${found.title}) is currently out of stock.`);
      }
      return {
        variant_id: item.variantId,
        quantity: item.quantity,
        verified: Boolean(opts.verifyHandles && opts.verifyHandles.length > 0),
        available: found.available,
        title: found.title,
        unit_price: found.price
      };
    });

    const segments = items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
    const u = new URL(`${store.origin}/cart/${segments}`);
    if (opts.mode === "cart") {
      u.searchParams.set("storefront", "true");
    }
    if (opts.discountCode) {
      u.searchParams.set("discount", opts.discountCode);
    }

    return {
      store_origin: store.origin,
      cart_url: u.toString(),
      mode: opts.mode,
      cart_mode: opts.mode === "checkout" ? "checkout_permalink" : "cart_permalink",
      handoff_tier: "cart_permalink",
      items: lineItems,
      warnings,
      next_step:
        "Share the cart_url with the user together with itemized prices and quantities so they can review and complete checkout in their own browser."
    };
  }
}

function createUnconfiguredAffiliateFeed(): AffiliateFeedProvider {
  const emptyResult = {
    provider: "awin" as const,
    configured: false,
    currency: "EUR",
    affiliate_disclosure: false,
    merchants_searched: [] as string[],
    products: [],
    notices: ["Live partner product feeds are not configured on this instance."]
  };
  return {
    providerName: "awin",
    isConfigured: () => false,
    clearCache: () => undefined,
    listMerchants: async () => [],
    resolveStoreTarget: async () => null,
    search: async () => emptyResult,
    searchByEan: async () => emptyResult
  };
}

function createUnconfiguredAwinPromotions(): AwinPromotionsProvider {
  return {
    providerName: "awin_promotions",
    isConfigured: () => false,
    clearCache: () => undefined,
    search: async (opts) => ({
      provider: "awin_promotions",
      configured: false,
      region: opts.region,
      awin_region_code: opts.region === "UK" ? "GB" : opts.region,
      live_vouchers: [],
      live_deals: [],
      notices: [
        "Awin Publisher Promotions API is not configured on this instance; returning deterministic 1-click Tier-B regional deal community links."
      ],
      affiliate_disclosure: false
    })
  };
}

export interface McpTestSession {
  server: McpServer;
  client: Client;
  serverInstructions: string | undefined;
  tools: AnthropicToolDefinition[];
  shopcartToolNames: Set<string>;
  prompts: Array<{ name: string; description?: string }>;
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ text: string; isError: boolean }>;
  close: () => Promise<void>;
}

/**
 * Starts the REAL ShopCart MCP server in-process over `InMemoryTransport`
 * backed by deterministic zero-network fixture adapters.
 *
 * Guarantees that `initialize` -> `server.instructions`, `tools/list`,
 * `prompts/list`, and all tool handlers match the exact production code.
 */
export async function createMcpTestSession(): Promise<McpTestSession> {
  const registry = new AdapterRegistry([new FixtureShopifyAdapter()]);

  const server = createShopcartMcpServer({
    registry,
    attribution: loadAttributionConfig({}),
    comparison: loadComparisonConfig({}),
    affiliateFeed: createUnconfiguredAffiliateFeed(),
    awinPromotions: createUnconfiguredAwinPromotions(),
    thumbnailFetcher: async (url) => ({
      status: 404,
      url,
      contentType: "text/plain",
      headers: {},
      bodyBuffer: Buffer.alloc(0),
      bodyText: ""
    })
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "shopcart-agentic-qa-harness",
    version: "1.0.0"
  });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const serverInstructions = client.getInstructions();
  const listedTools = await client.listTools();
  const tools: AnthropicToolDefinition[] = listedTools.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<
      string,
      unknown
    >
  }));

  const shopcartToolNames = new Set(tools.map((t) => t.name));

  let prompts: Array<{ name: string; description?: string }> = [];
  try {
    const listedPrompts = await client.listPrompts();
    prompts = (listedPrompts.prompts ?? []).map((p) => ({
      name: p.name,
      description: p.description
    }));
  } catch {
    // Current baseline server registers 0 prompts (MCP returns Method not found / capability absent).
    prompts = [];
  }

  return {
    server,
    client,
    serverInstructions,
    tools,
    shopcartToolNames,
    prompts,
    async callTool(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      const blocks = Array.isArray(result.content) ? result.content : [];
      const textParts: string[] = [];
      for (const block of blocks) {
        if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
          textParts.push(String(block.text));
        }
      }
      return {
        text: textParts.join("\n"),
        isError: Boolean(result.isError)
      };
    },
    async close() {
      await Promise.allSettled([client.close(), server.close()]);
    }
  };
}
