import { z } from "zod";
import type { UcpMetadata, UcpServiceSummary } from "../types.js";

/**
 * Maximum payload size for `/.well-known/ucp` discovery manifests (256 KB).
 */
export const MAX_UCP_MANIFEST_BYTES = 262_144;

/**
 * Maximum payload size for UCP catalog / checkout API JSON responses (512 KB).
 */
export const MAX_UCP_API_BYTES = 524_288;

/**
 * Tight normalized cache caps to prevent memory amplification across wildcard subdomains.
 */
export const MAX_UCP_SERVICES_NORMALIZED = 8;
export const MAX_UCP_CAPABILITIES_NORMALIZED = 16;
export const MAX_UCP_ENDPOINT_URL_LENGTH = 512;
export const MAX_UCP_CACHED_PROFILE_BYTES = 8192;

const BoundedString = z.string().max(512);
const ShortString = z.string().max(160);
const UrlCandidateString = z.string().max(2048);

/**
 * Transport definition inside a UCP service (e.g. `rest`, `mcp`, `a2a`, `embedded`).
 */
export const UcpTransportBindingSchema = z.object({
  schema: UrlCandidateString.optional(),
  endpoint: UrlCandidateString.optional(),
  url: UrlCandidateString.optional()
});

/**
 * Single service entry inside `ucp.services` — supports both object-style transport bindings
 * (`{ rest: { endpoint }, mcp: { endpoint } }`) and flat transport entries
 * (`{ transport: "rest", endpoint: "..." }`).
 */
export const UcpServiceEntrySchema = z.object({
  name: ShortString.optional(),
  version: ShortString.optional(),
  spec: UrlCandidateString.optional(),
  schema: UrlCandidateString.optional(),
  transport: ShortString.optional(),
  endpoint: UrlCandidateString.optional(),
  url: UrlCandidateString.optional(),
  rest: UcpTransportBindingSchema.optional(),
  mcp: UcpTransportBindingSchema.optional(),
  a2a: UcpTransportBindingSchema.optional(),
  embedded: UcpTransportBindingSchema.optional()
});

/**
 * Capability entry inside `ucp.capabilities` — supports object definitions, map values, or plain strings.
 */
export const UcpCapabilityObjectSchema = z.object({
  name: ShortString.optional(),
  version: ShortString.optional(),
  spec: UrlCandidateString.optional(),
  schema: UrlCandidateString.optional(),
  extends: ShortString.optional()
});

const UcpServicesSchema = z.union([
  z
    .record(
      ShortString,
      z.union([UcpServiceEntrySchema, z.array(UcpServiceEntrySchema).max(8)])
    )
    .refine((rec) => Object.keys(rec).length <= 32, "Too many UCP services (max 32)"),
  z.array(UcpServiceEntrySchema).max(32)
]);

const UcpCapabilitiesSchema = z.union([
  z.array(z.union([UcpCapabilityObjectSchema, ShortString])).max(64),
  z
    .record(
      ShortString,
      z.union([UcpCapabilityObjectSchema, z.array(UcpCapabilityObjectSchema).max(8), z.boolean()])
    )
    .refine((rec) => Object.keys(rec).length <= 64, "Too many UCP capabilities (max 64)")
]);

const UcpMerchantMetaSchema = z.object({
  name: BoundedString.optional(),
  currency: z.string().max(16).optional(),
  country: z.string().max(16).optional(),
  platform: ShortString.optional()
});

/**
 * Strict, bounded Zod schema for `/.well-known/ucp` discovery manifests.
 *
 * Strips unknown top-level/nested fields (no unbounded `.passthrough()`) while
 * supporting standard UCP object/map-style and array-style service/capability layouts.
 */
export const UcpManifestSchema = z.object({
  ucp: z.object({
    version: ShortString.min(1),
    services: UcpServicesSchema.optional(),
    capabilities: UcpCapabilitiesSchema.optional()
  }),
  merchant: UcpMerchantMetaSchema.optional(),
  business: UcpMerchantMetaSchema.optional(),
  store: UcpMerchantMetaSchema.optional(),
  payment: z
    .object({
      handlers: z.array(z.object({ id: ShortString.optional(), name: ShortString.optional() })).max(32).optional()
    })
    .optional()
});

export type RawUcpManifest = z.infer<typeof UcpManifestSchema>;

/**
 * Normalized, security-validated UCP profile returned by `discoverUcpProfile`.
 */
export interface NormalizedUcpProfile {
  origin: string;
  manifestUrl: string;
  version: string;
  storeName: string | null;
  currency: string | null;
  country: string | null;
  platformHint: string | null;
  capabilities: string[];
  services: Record<string, UcpServiceSummary>;
  endpoints: {
    rest: string | null;
    mcp: string | null;
    a2a: string | null;
  };
  checkoutHandoffSupported: boolean;
  catalogSearchSupported: boolean;
  rejectedEndpointCount: number;
  warnings: string[];
  metadata: UcpMetadata;
}

/**
 * Bounded Zod schema for UCP REST / MCP catalog product payloads.
 */
const UcpMoneySchema = z.union([
  z.number(),
  z.string().max(64),
  z.object({
    amount: z.union([z.number(), z.string().max(64)]).optional(),
    value: z.union([z.number(), z.string().max(64)]).optional(),
    minor_units: z.number().int().optional(),
    cents: z.number().int().optional(),
    currency: z.string().max(16).optional(),
    currency_code: z.string().max(16).optional()
  })
]);

export const UcpVariantItemSchema = z.object({
  id: z.union([ShortString, z.number()]),
  title: BoundedString.optional(),
  sku: ShortString.optional(),
  gtin: ShortString.optional(),
  ean: ShortString.optional(),
  mpn: ShortString.optional(),
  available: z.boolean().optional(),
  in_stock: z.boolean().optional(),
  availability: ShortString.optional(),
  price: UcpMoneySchema.optional(),
  compare_at_price: UcpMoneySchema.nullable().optional(),
  currency: z.string().max(16).optional(),
  url: UrlCandidateString.optional(),
  option_values: z.array(ShortString).max(12).optional()
});

export const UcpProductItemSchema = z.object({
  id: z.union([ShortString, z.number()]),
  handle: ShortString.optional(),
  slug: ShortString.optional(),
  title: BoundedString.optional(),
  name: BoundedString.optional(),
  vendor: ShortString.optional(),
  brand: ShortString.optional(),
  product_type: ShortString.optional(),
  category: ShortString.optional(),
  description: z.string().max(16_384).optional(),
  sku: ShortString.optional(),
  gtin: ShortString.optional(),
  ean: ShortString.optional(),
  mpn: ShortString.optional(),
  available: z.boolean().optional(),
  in_stock: z.boolean().optional(),
  availability: ShortString.optional(),
  price: UcpMoneySchema.optional(),
  compare_at_price: UcpMoneySchema.nullable().optional(),
  currency: z.string().max(16).optional(),
  url: UrlCandidateString.optional(),
  image_url: UrlCandidateString.nullable().optional(),
  images: z.array(z.union([UrlCandidateString, z.object({ url: UrlCandidateString })])).max(16).optional(),
  variants: z.array(UcpVariantItemSchema).max(100).optional()
});

export type RawUcpProduct = z.infer<typeof UcpProductItemSchema>;

export const UcpCatalogSearchResponseSchema = z.object({
  currency: z.string().max(16).optional(),
  products: z.array(UcpProductItemSchema).max(50).optional(),
  items: z.array(UcpProductItemSchema).max(50).optional(),
  results: z.array(UcpProductItemSchema).max(50).optional()
});

export const UcpProductLookupResponseSchema = z.union([
  z.object({
    currency: z.string().max(16).optional(),
    product: UcpProductItemSchema
  }),
  UcpProductItemSchema
]);

/**
 * Bounded Zod schema for Zero-Liability UCP Checkout Session Handoff responses.
 * ShopCart ONLY reads non-PII handoff fields (`id`, `status`, `continue_url`, escalation links, `messages`).
 */
export const UcpCheckoutMessageSchema = z.object({
  type: ShortString.optional(),
  code: ShortString.optional(),
  content: BoundedString.optional(),
  message: BoundedString.optional()
});

export const UcpCheckoutLinkSchema = z.object({
  rel: ShortString.optional(),
  type: ShortString.optional(),
  href: UrlCandidateString.optional(),
  url: UrlCandidateString.optional()
});

export const UcpCheckoutSessionResponseSchema = z.object({
  id: z.union([ShortString, z.number()]).optional(),
  status: ShortString.optional(),
  currency: z.string().max(16).optional(),
  continue_url: UrlCandidateString.optional(),
  checkout_url: UrlCandidateString.optional(),
  escalation_url: UrlCandidateString.optional(),
  url: UrlCandidateString.optional(),
  links: z.array(UcpCheckoutLinkSchema).max(16).optional(),
  messages: z.array(UcpCheckoutMessageSchema).max(16).optional()
});

export type RawUcpCheckoutSessionResponse = z.infer<typeof UcpCheckoutSessionResponseSchema>;
