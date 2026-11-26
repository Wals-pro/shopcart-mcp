import { z } from "zod";
import { validateExternalUrl } from "../security/ssrf.js";

export const DEFAULT_UTM_SOURCE = "shopcart.wals.pro";
export const DEFAULT_UTM_MEDIUM = "ai_mcp";
export const DEFAULT_UTM_CAMPAIGN = "shopcart_mcp";

export const AFFILIATE_DISCLOSURE_NOTE =
  "Affiliate disclosure: This response includes partner or affiliate links. Purchases made through these links may earn ShopCart (Wals Professional Services GmbH) a commission at no extra cost to you.";

const PARAM_KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
const DISCOUNT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const AMAZON_TAG_RE = /^[A-Za-z0-9._-]{2,64}$/;
const DOMAIN_PATTERN_RE = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const KNOWN_AMAZON_MARKETPLACES = new Set([
  "com",
  "de",
  "co.uk",
  "fr",
  "it",
  "es",
  "nl",
  "at",
  "ca",
  "co.jp",
  "com.au",
  "pl",
  "se",
  "com.be",
  "com.br",
  "com.mx",
  "in",
  "sg",
  "ae",
  "sa",
  "eg",
  "com.tr"
]);

export interface AffiliateRule {
  id?: string;
  network?: string;
  domain: string;
  ref?: string;
  discount?: string;
  params?: Record<string, string>;
  deeplink_template?: string;
  disclosure_label?: string;
}

export interface AttributionConfig {
  disableUtm: boolean;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  amazonAssociateTag?: string;
  amazonAssociateTags: Record<string, string>;
  affiliateRules: AffiliateRule[];
  warnings: string[];
}

export interface AttributionLinkOptions {
  kind?: "cart" | "product" | "generic";
  skipRuleDiscount?: boolean;
}

export interface AttributedLinkResult {
  url: string;
  affiliate_disclosure: boolean;
  disclosure_note?: string;
  utm_applied: boolean;
  applied_network?: string;
  applied_rule_domain?: string;
}

const AffiliateRuleSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  network: z.string().trim().min(1).max(40).optional(),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) => (d.startsWith(".") ? `*${d}` : d))
    .refine((d) => DOMAIN_PATTERN_RE.test(d), "Invalid domain or wildcard pattern"),
  ref: z.string().trim().min(1).max(128).optional(),
  discount: z.string().trim().regex(DISCOUNT_RE, "Invalid discount code").optional(),
  params: z
    .record(
      z.string().regex(PARAM_KEY_RE, "Invalid query param key"),
      z.string().max(256)
    )
    .optional(),
  deeplink_template: z.string().trim().min(1).max(1024).optional(),
  disclosure_label: z.string().trim().min(1).max(200).optional()
});

const AmazonTagsRecordSchema = z.record(z.string().min(1).max(32), z.string().trim().min(1).max(64));

function parseBooleanFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const norm = raw.trim().toLowerCase();
  return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
}

function sanitizeUtmValue(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 120);
}

function normalizeAmazonMarketplaceKey(rawKey: string): string | null {
  let key = rawKey.trim().toLowerCase().replace(/^\.+/, "");
  if (key.startsWith("www.")) key = key.slice(4);
  if (key.startsWith("amazon.")) key = key.slice("amazon.".length);
  if (!key || !/^[a-z]{2,3}(?:\.[a-z]{2,3})?$/.test(key)) return null;
  return key;
}

/**
 * Validates an affiliate deeplink wrapper template:
 * - Must contain `{encoded_url}` and NO other `{...}` placeholders.
 * - Must be `https://` with a fixed, SSRF-safe host (no placeholders in scheme/host/port).
 * - Substituted URL must pass `validateExternalUrl`.
 */
export function validateDeeplinkTemplate(template: string): { valid: boolean; reason?: string } {
  const trimmed = template.trim();
  if (!trimmed) return { valid: false, reason: "Empty deeplink_template" };

  const placeholders = trimmed.match(/\{[^}]*\}/g) ?? [];
  if (placeholders.length === 0) {
    return { valid: false, reason: "deeplink_template must include {encoded_url} placeholder" };
  }
  for (const ph of placeholders) {
    if (ph !== "{encoded_url}") {
      return {
        valid: false,
        reason: `Unsupported placeholder '${ph}' in deeplink_template (only {encoded_url} is allowed)`
      };
    }
  }

  // Ensure placeholder cannot inject scheme, userinfo, host, or port
  const firstPlaceholderIdx = trimmed.indexOf("{encoded_url}");
  const schemeEnd = trimmed.indexOf("://");
  if (schemeEnd === -1 || firstPlaceholderIdx < schemeEnd + 3) {
    return { valid: false, reason: "deeplink_template must start with a fixed https:// origin" };
  }
  const afterScheme = trimmed.slice(schemeEnd + 3);
  const pathOrQueryIdx = afterScheme.search(/[/?#]/);
  if (pathOrQueryIdx === -1 || firstPlaceholderIdx < schemeEnd + 3 + pathOrQueryIdx) {
    return {
      valid: false,
      reason: "{encoded_url} is not allowed in deeplink_template hostname or port"
    };
  }

  const probe = trimmed.replaceAll("{encoded_url}", encodeURIComponent("https://example.com/item"));
  try {
    const parsed = validateExternalUrl(probe);
    if (parsed.protocol !== "https:") {
      return { valid: false, reason: "deeplink_template must use https://" };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : "Invalid deeplink_template URL"
    };
  }
}

export function extractAmazonMarketplace(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const match = host.match(/^(?:[a-z0-9-]+\.)*amazon\.([a-z]{2,3}(?:\.[a-z]{2,3})?)$/);
  if (!match?.[1]) return null;
  const tld = match[1];
  return KNOWN_AMAZON_MARKETPLACES.has(tld) ? tld : null;
}

export function loadAttributionConfig(
  env: NodeJS.ProcessEnv = process.env
): AttributionConfig {
  const warnings: string[] = [];
  const disableUtm = parseBooleanFlag(env.SHOPCART_DISABLE_UTM);
  const utmSource = sanitizeUtmValue(env.ATTRIBUTION_UTM_SOURCE, DEFAULT_UTM_SOURCE);
  const utmMedium = sanitizeUtmValue(env.ATTRIBUTION_UTM_MEDIUM, DEFAULT_UTM_MEDIUM);
  const utmCampaign = sanitizeUtmValue(env.ATTRIBUTION_UTM_CAMPAIGN, DEFAULT_UTM_CAMPAIGN);

  const rawDefaultAmazonTag = env.AMAZON_ASSOCIATE_TAG?.trim();
  let amazonAssociateTag: string | undefined;
  if (rawDefaultAmazonTag) {
    if (AMAZON_TAG_RE.test(rawDefaultAmazonTag)) {
      amazonAssociateTag = rawDefaultAmazonTag;
    } else {
      warnings.push("Ignored invalid AMAZON_ASSOCIATE_TAG format.");
    }
  }

  const amazonAssociateTags: Record<string, string> = {};
  const rawAmazonTagsJson = env.AMAZON_ASSOCIATE_TAGS_JSON?.trim();
  if (rawAmazonTagsJson) {
    try {
      const parsedJson: unknown = JSON.parse(rawAmazonTagsJson);
      const validated = AmazonTagsRecordSchema.safeParse(parsedJson);
      if (validated.success) {
        for (const [k, v] of Object.entries(validated.data)) {
          const normKey = normalizeAmazonMarketplaceKey(k);
          if (normKey && AMAZON_TAG_RE.test(v)) {
            amazonAssociateTags[normKey] = v;
          } else {
            warnings.push(`Ignored invalid AMAZON_ASSOCIATE_TAGS_JSON entry '${k}'.`);
          }
        }
      } else {
        warnings.push("Ignored malformed AMAZON_ASSOCIATE_TAGS_JSON (expected JSON object of marketplace->tag).");
      }
    } catch {
      warnings.push("Ignored malformed AMAZON_ASSOCIATE_TAGS_JSON (invalid JSON syntax).");
    }
  }

  const affiliateRules: AffiliateRule[] = [];
  const rawRulesJson = env.AFFILIATE_RULES_JSON?.trim();
  if (rawRulesJson) {
    try {
      const parsedJson: unknown = JSON.parse(rawRulesJson);
      const rawArray: unknown[] | null = Array.isArray(parsedJson)
        ? parsedJson
        : parsedJson &&
            typeof parsedJson === "object" &&
            Array.isArray((parsedJson as { rules?: unknown }).rules)
          ? (parsedJson as { rules: unknown[] }).rules
          : null;

      if (!rawArray) {
        warnings.push("Ignored AFFILIATE_RULES_JSON (expected JSON array of rules).");
      } else {
        for (const [idx, item] of rawArray.entries()) {
          const checked = AffiliateRuleSchema.safeParse(item);
          if (!checked.success) {
            warnings.push(`Ignored invalid AFFILIATE_RULES_JSON rule at index ${idx}.`);
            continue;
          }
          const rule = checked.data;
          if (rule.deeplink_template) {
            const tplCheck = validateDeeplinkTemplate(rule.deeplink_template);
            if (!tplCheck.valid) {
              warnings.push(
                `Ignored AFFILIATE_RULES_JSON rule for '${rule.domain}': ${tplCheck.reason}`
              );
              continue;
            }
          }
          const hasAction = Boolean(
            rule.ref ||
              rule.discount ||
              (rule.params && Object.keys(rule.params).length > 0) ||
              rule.deeplink_template
          );
          if (!hasAction) {
            warnings.push(
              `Ignored AFFILIATE_RULES_JSON rule for '${rule.domain}' with no monetization parameters.`
            );
            continue;
          }
          affiliateRules.push(rule);
        }
      }
    } catch {
      warnings.push("Ignored malformed AFFILIATE_RULES_JSON (invalid JSON syntax).");
    }
  }

  return {
    disableUtm,
    utmSource,
    utmMedium,
    utmCampaign,
    amazonAssociateTag,
    amazonAssociateTags,
    affiliateRules,
    warnings
  };
}

export function getAffiliateRuleDiscount(rule: AffiliateRule): string | undefined {
  const topLevel = rule.discount?.trim();
  if (topLevel) return topLevel;
  if (rule.params) {
    for (const [k, v] of Object.entries(rule.params)) {
      if (k.toLowerCase() === "discount") {
        const trimmed = v.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return undefined;
}

export function matchAffiliateRule(
  hostname: string,
  rules: readonly AffiliateRule[]
): AffiliateRule | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  let bestRule: AffiliateRule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    const pattern = rule.domain.toLowerCase();
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        // Wildcard match score: prioritize more specific suffixes, always below exact matches
        const score = 100 + suffix.length;
        if (score > bestScore) {
          bestScore = score;
          bestRule = rule;
        }
      }
    } else if (
      host === pattern ||
      (!pattern.startsWith("www.") && host === `www.${pattern}`)
    ) {
      // Exact hostname match (including www. alias for apex pattern)
      const score = 1000 + (host === pattern ? 50 : 0) + pattern.length;
      if (score > bestScore) {
        bestScore = score;
        bestRule = rule;
      }
    }
  }

  return bestRule;
}

export function resolveAmazonAssociateTag(
  hostname: string,
  config: AttributionConfig
): string | null {
  const marketplace = extractAmazonMarketplace(hostname);
  if (!marketplace) return null;
  if (Object.hasOwn(config.amazonAssociateTags, marketplace)) {
    return config.amazonAssociateTags[marketplace] ?? null;
  }
  return config.amazonAssociateTag ?? null;
}

/**
 * Applies universal UTM attribution and optional partner/affiliate rules (Amazon tags,
 * domain ref/discount/custom params, or SSRF-validated deeplink wrappers) to an HTTPS URL.
 *
 * Pure UTM attribution ALWAYS sets `affiliate_disclosure: false`.
 * Any monetized affiliate tag, rule, or wrapper sets `affiliate_disclosure: true` + `disclosure_note`.
 */
export function applyAttribution(
  rawUrl: string,
  config: AttributionConfig,
  opts: AttributionLinkOptions = {}
): AttributedLinkResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      url: rawUrl,
      affiliate_disclosure: false,
      utm_applied: false
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      url: rawUrl,
      affiliate_disclosure: false,
      utm_applied: false
    };
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return {
      url: rawUrl,
      affiliate_disclosure: false,
      utm_applied: false
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  let utmApplied = false;
  let monetized = false;
  let appliedNetwork: string | undefined;
  let appliedRuleDomain: string | undefined;
  let customDisclosure: string | undefined;

  // 1. Universal UTM attribution (unless disabled via SHOPCART_DISABLE_UTM=1)
  if (!config.disableUtm) {
    if (!parsed.searchParams.has("utm_source")) {
      parsed.searchParams.set("utm_source", config.utmSource);
    }
    if (!parsed.searchParams.has("utm_medium")) {
      parsed.searchParams.set("utm_medium", config.utmMedium);
    }
    if (!parsed.searchParams.has("utm_campaign")) {
      parsed.searchParams.set("utm_campaign", config.utmCampaign);
    }
    utmApplied = true;
  }

  // 2. Per-marketplace Amazon Associate Tag (with fallback to AMAZON_ASSOCIATE_TAG)
  const amazonTag = resolveAmazonAssociateTag(host, config);
  if (amazonTag) {
    const isAmazonCart =
      opts.kind === "cart" || parsed.pathname.toLowerCase().startsWith("/gp/aws/cart/add");
    if (isAmazonCart) {
      if (!parsed.searchParams.has("AssociateTag")) {
        parsed.searchParams.set("AssociateTag", amazonTag);
      }
    } else if (!parsed.searchParams.has("tag")) {
      parsed.searchParams.set("tag", amazonTag);
    }
    monetized = true;
    appliedNetwork = "amazon_associates";
    appliedRuleDomain = host;
  }

  // 3. Domain-specific partner/affiliate rule (ref, discount, custom params, or deeplink wrapper)
  const matchedRule = matchAffiliateRule(host, config.affiliateRules);
  let finalUrl = parsed.toString();

  if (matchedRule) {
    if (matchedRule.ref && !parsed.searchParams.has("ref")) {
      parsed.searchParams.set("ref", matchedRule.ref);
      monetized = true;
    }
    // Preserve any user-supplied discount code on cart permalinks; apply rule discount only when absent and not opted out
    const ruleDiscount = getAffiliateRuleDiscount(matchedRule);
    if (matchedRule.discount && !opts.skipRuleDiscount && !parsed.searchParams.has("discount")) {
      parsed.searchParams.set("discount", matchedRule.discount);
      monetized = true;
    }
    if (matchedRule.params) {
      for (const [k, v] of Object.entries(matchedRule.params)) {
        if (opts.skipRuleDiscount && k.toLowerCase() === "discount") {
          continue;
        }
        if (k.toLowerCase() === "discount" && parsed.searchParams.has("discount")) {
          continue;
        }
        if (!parsed.searchParams.has(k)) {
          parsed.searchParams.set(k, v);
          monetized = true;
        }
      }
    }

    // Disclose monetization whenever the final URL carries a configured partner discount code
    // (whether configured in rule.discount or case-insensitive rule.params.discount, and whether
    // attached by rule, storefront deduplication, or passed explicitly after discovery).
    let finalDiscount = parsed.searchParams.get("discount")?.trim().toLowerCase();
    if (!finalDiscount) {
      for (const [k, v] of parsed.searchParams.entries()) {
        if (k.toLowerCase() === "discount" && v.trim()) {
          finalDiscount = v.trim().toLowerCase();
          break;
        }
      }
    }
    if (finalDiscount) {
      const matchesRuleDiscount =
        (ruleDiscount !== undefined && finalDiscount === ruleDiscount.toLowerCase()) ||
        Boolean(
          matchedRule.params &&
            Object.entries(matchedRule.params).some(
              ([k, v]) =>
                k.toLowerCase() === "discount" && v.trim().toLowerCase() === finalDiscount
            )
        );
      if (matchesRuleDiscount) {
        monetized = true;
      }
    }

    finalUrl = parsed.toString();

    if (matchedRule.deeplink_template) {
      const tplCheck = validateDeeplinkTemplate(matchedRule.deeplink_template);
      if (tplCheck.valid) {
        const probeTemplate = new URL(
          matchedRule.deeplink_template.replaceAll(
            "{encoded_url}",
            encodeURIComponent("https://example.com/")
          )
        );
        // Avoid double-wrapping if URL is already hosted on the affiliate wrapper domain
        if (probeTemplate.hostname.toLowerCase() !== host) {
          finalUrl = matchedRule.deeplink_template.replaceAll(
            "{encoded_url}",
            encodeURIComponent(finalUrl)
          );
          monetized = true;
        }
      }
    }

    if (monetized) {
      appliedNetwork = matchedRule.network ?? appliedNetwork ?? "partner";
      appliedRuleDomain = matchedRule.domain;
      if (matchedRule.disclosure_label) {
        customDisclosure = matchedRule.disclosure_label;
      }
    }
  }

  if (monetized) {
    return {
      url: finalUrl,
      affiliate_disclosure: true,
      disclosure_note: customDisclosure ?? AFFILIATE_DISCLOSURE_NOTE,
      utm_applied: utmApplied,
      applied_network: appliedNetwork,
      applied_rule_domain: appliedRuleDomain
    };
  }

  return {
    url: finalUrl,
    affiliate_disclosure: false,
    utm_applied: utmApplied
  };
}
