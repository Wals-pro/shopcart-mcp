export interface AmazonMarketplace {
  /** Canonical hostname used for product links & cart permalinks (always www.amazon.<tld>) */
  canonicalHost: string;
  /** Canonical HTTPS origin, e.g. https://www.amazon.de */
  origin: string;
  /** Human-readable marketplace name */
  name: string;
  /** ISO 4217 currency code */
  currency: string;
  /** ISO 3166-1 alpha-2 country code */
  country: string;
  /** Ordered env var suffixes checked for marketplace-specific Associate Tag */
  associateTagEnvKeys: readonly string[];
  /** Amazon PA-API 5.0 host */
  paApiHost: string;
  /** AWS SigV4 signing region for PA-API 5.0 */
  paApiRegion: string;
  /** PA-API 5.0 Marketplace parameter */
  paApiMarketplace: string;
  /** Keepa API numeric domain ID (null if unsupported by Keepa) */
  keepaDomainId: number | null;
}

const DE_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.de",
  origin: "https://www.amazon.de",
  name: "Amazon Germany",
  currency: "EUR",
  country: "DE",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_DE", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.de",
  paApiRegion: "eu-west-1",
  paApiMarketplace: "www.amazon.de",
  keepaDomainId: 3
};

const AT_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.de",
  origin: "https://www.amazon.de",
  name: "Amazon Austria (via Amazon.de)",
  currency: "EUR",
  country: "AT",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_AT", "AMAZON_ASSOCIATE_TAG_DE", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.de",
  paApiRegion: "eu-west-1",
  paApiMarketplace: "www.amazon.de",
  keepaDomainId: 3
};

const US_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.com",
  origin: "https://www.amazon.com",
  name: "Amazon US",
  currency: "USD",
  country: "US",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_US", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.com",
  paApiRegion: "us-east-1",
  paApiMarketplace: "www.amazon.com",
  keepaDomainId: 1
};

const UK_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.co.uk",
  origin: "https://www.amazon.co.uk",
  name: "Amazon UK",
  currency: "GBP",
  country: "GB",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_UK", "AMAZON_ASSOCIATE_TAG_GB", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.co.uk",
  paApiRegion: "eu-west-1",
  paApiMarketplace: "www.amazon.co.uk",
  keepaDomainId: 2
};

const FR_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.fr",
  origin: "https://www.amazon.fr",
  name: "Amazon France",
  currency: "EUR",
  country: "FR",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_FR", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.fr",
  paApiRegion: "eu-west-1",
  paApiMarketplace: "www.amazon.fr",
  keepaDomainId: 4
};

const IT_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.it",
  origin: "https://www.amazon.it",
  name: "Amazon Italy",
  currency: "EUR",
  country: "IT",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_IT", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.it",
  paApiRegion: "eu-west-1",
  paApiMarketplace: "www.amazon.it",
  keepaDomainId: 8
};

const ES_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.es",
  origin: "https://www.amazon.es",
  name: "Amazon Spain",
  currency: "EUR",
  country: "ES",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_ES", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.es",
  paApiRegion: "eu-west-1",
  paApiMarketplace: "www.amazon.es",
  keepaDomainId: 9
};

const NL_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.nl",
  origin: "https://www.amazon.nl",
  name: "Amazon Netherlands",
  currency: "EUR",
  country: "NL",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_NL", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.nl",
  paApiRegion: "eu-west-1",
  paApiMarketplace: "www.amazon.nl",
  keepaDomainId: null
};

const CA_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.ca",
  origin: "https://www.amazon.ca",
  name: "Amazon Canada",
  currency: "CAD",
  country: "CA",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_CA", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.ca",
  paApiRegion: "us-east-1",
  paApiMarketplace: "www.amazon.ca",
  keepaDomainId: 6
};

const JP_MARKETPLACE: AmazonMarketplace = {
  canonicalHost: "www.amazon.co.jp",
  origin: "https://www.amazon.co.jp",
  name: "Amazon Japan",
  currency: "JPY",
  country: "JP",
  associateTagEnvKeys: ["AMAZON_ASSOCIATE_TAG_JP", "AMAZON_ASSOCIATE_TAG"],
  paApiHost: "webservices.amazon.co.jp",
  paApiRegion: "us-west-2",
  paApiMarketplace: "www.amazon.co.jp",
  keepaDomainId: 5
};

export const AMAZON_DOMAINS: Record<string, AmazonMarketplace> = {
  "amazon.de": DE_MARKETPLACE,
  "www.amazon.de": DE_MARKETPLACE,
  "amazon.at": AT_MARKETPLACE,
  "www.amazon.at": AT_MARKETPLACE,
  "amazon.com": US_MARKETPLACE,
  "www.amazon.com": US_MARKETPLACE,
  "amazon.co.uk": UK_MARKETPLACE,
  "www.amazon.co.uk": UK_MARKETPLACE,
  "amazon.fr": FR_MARKETPLACE,
  "www.amazon.fr": FR_MARKETPLACE,
  "amazon.it": IT_MARKETPLACE,
  "www.amazon.it": IT_MARKETPLACE,
  "amazon.es": ES_MARKETPLACE,
  "www.amazon.es": ES_MARKETPLACE,
  "amazon.nl": NL_MARKETPLACE,
  "www.amazon.nl": NL_MARKETPLACE,
  "amazon.ca": CA_MARKETPLACE,
  "www.amazon.ca": CA_MARKETPLACE,
  "amazon.co.jp": JP_MARKETPLACE,
  "www.amazon.co.jp": JP_MARKETPLACE
};

const ASIN_RE = /^[A-Z0-9]{10}$/;
const ASSOCIATE_TAG_RE = /^[A-Za-z0-9._-]{1,64}$/;

const ASIN_PATH_PATTERNS: readonly RegExp[] = [
  /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/exec\/obidos\/ASIN\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/offer-listing\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/o\/ASIN\/([A-Z0-9]{10})(?:[/?#]|$)/i
];

const ALLOWED_AMAZON_IMAGE_HOSTS = new Set([
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "images-eu.ssl-images-amazon.com",
  "images-fe.ssl-images-amazon.com"
]);

export function resolveAmazonMarketplace(originOrHost: string): AmazonMarketplace | null {
  const trimmed = originOrHost.trim();
  if (!trimmed) return null;

  let hostname = trimmed.toLowerCase();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return null;
      }
      hostname = parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
  } else {
    // Strip path/query if someone passed "amazon.de/dp/..."
    hostname = hostname.split(/[/?#]/, 1)[0] ?? "";
  }

  hostname = hostname.replace(/\.$/, "");
  if (AMAZON_DOMAINS[hostname]) {
    return AMAZON_DOMAINS[hostname]!;
  }

  // Handle mobile/smile subdomains like m.amazon.de or smile.amazon.com
  const subStripped = hostname.replace(/^(?:m|smile)\./, "");
  if (subStripped !== hostname && AMAZON_DOMAINS[subStripped]) {
    return AMAZON_DOMAINS[subStripped]!;
  }

  return null;
}

export function isValidAsin(candidate: string): boolean {
  return ASIN_RE.test(candidate.trim().toUpperCase());
}

/**
 * Extracts and validates a 10-character Amazon ASIN from either:
 * - a direct ASIN (e.g. "B08N5WRWNW")
 * - an Amazon product URL (/dp/<ASIN>, /gp/product/<ASIN>, /gp/aw/d/<ASIN>, /exec/obidos/ASIN/<ASIN>)
 * - a relative Amazon product path (e.g. "/dp/B08N5WRWNW")
 *
 * Returns null if the input is not a valid ASIN or supported Amazon product URL.
 */
export function tryExtractAsin(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Direct 10-character ASIN
  const upper = trimmed.toUpperCase();
  if (ASIN_RE.test(upper)) {
    return upper;
  }

  let pathname: string;
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!resolveAmazonMarketplace(parsed.hostname)) {
      return null;
    }
    pathname = parsed.pathname;
  } else if (trimmed.startsWith("/")) {
    pathname = trimmed.split(/[?#]/, 1)[0] ?? "";
  } else if (/^(?:(?:www|m|smile)\.)?amazon\./i.test(trimmed)) {
    try {
      const parsed = new URL(`https://${trimmed}`);
      if (!resolveAmazonMarketplace(parsed.hostname)) {
        return null;
      }
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  for (const pattern of ASIN_PATH_PATTERNS) {
    const match = pathname.match(pattern);
    if (match?.[1]) {
      const asin = match[1].toUpperCase();
      if (ASIN_RE.test(asin)) {
        return asin;
      }
    }
  }

  return null;
}

export function extractAsin(input: string): string {
  const asin = tryExtractAsin(input);
  if (!asin) {
    throw new Error(
      `Invalid Amazon ASIN or product URL: '${input}'. Expected a 10-character ASIN (e.g. B08N5WRWNW) or a supported Amazon URL (/dp/<ASIN>, /gp/product/<ASIN>, /gp/aw/d/<ASIN>, /exec/obidos/ASIN/<ASIN>).`
    );
  }
  return asin;
}

export function resolveAssociateTag(
  marketplace: AmazonMarketplace,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  for (const key of marketplace.associateTagEnvKeys) {
    const raw = env[key]?.trim();
    if (raw && ASSOCIATE_TAG_RE.test(raw)) {
      return raw;
    }
  }
  return null;
}

export function sanitizeAmazonImageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!ALLOWED_AMAZON_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }
  return parsed.toString();
}
