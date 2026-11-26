import {
  STORE_CATEGORY_IDS,
  type StoreCategoryDefinition,
  type StoreCategoryId
} from "./types.js";

export const STORE_CATEGORIES: readonly StoreCategoryDefinition[] = [
  {
    id: "fashion",
    label_de: "Mode & Basics",
    label_en: "Fashion & Basics",
    aliases: [
      "mode",
      "kleidung",
      "clothing",
      "apparel",
      "basics",
      "schuhe",
      "shoes",
      "sneaker",
      "socken",
      "socks",
      "streetwear"
    ]
  },
  {
    id: "sports-outdoor",
    label_de: "Sport & Outdoor",
    label_en: "Sports & Outdoor",
    aliases: [
      "sport",
      "sports",
      "outdoor",
      "fitness",
      "running",
      "laufen",
      "wandern",
      "hiking",
      "camping",
      "cycling",
      "fahrrad",
      "bike",
      "yoga"
    ]
  },
  {
    id: "nutrition-supplements",
    label_de: "Ernährung & Supplements",
    label_en: "Nutrition & Supplements",
    aliases: [
      "ernaehrung",
      "nutrition",
      "supplements",
      "vitamine",
      "vitamins",
      "protein",
      "nahrungsergaenzung",
      "gesundheit",
      "health"
    ]
  },
  {
    id: "beauty-care",
    label_de: "Beauty & Pflege",
    label_en: "Beauty & Skincare",
    aliases: [
      "beauty",
      "pflege",
      "skincare",
      "hautpflege",
      "kosmetik",
      "cosmetics",
      "naturkosmetik",
      "makeup"
    ]
  },
  {
    id: "home-living",
    label_de: "Home & Living",
    label_en: "Home & Living",
    aliases: [
      "home",
      "living",
      "wohnen",
      "moebel",
      "furniture",
      "kueche",
      "kitchen",
      "deko",
      "decor",
      "keramik",
      "interior"
    ]
  },
  {
    id: "tech-gadgets",
    label_de: "Tech & Gadgets",
    label_en: "Tech & Gadgets",
    aliases: [
      "tech",
      "technik",
      "elektronik",
      "electronics",
      "gadgets",
      "audio",
      "smart-home",
      "smarthome",
      "hardware",
      "computer"
    ]
  },
  {
    id: "coffee-tea-food",
    label_de: "Kaffee, Tee & Genuss",
    label_en: "Coffee, Tea & Specialty Food",
    aliases: [
      "kaffee",
      "coffee",
      "espresso",
      "tee",
      "tea",
      "matcha",
      "food",
      "genuss",
      "feinkost",
      "gewuerze",
      "spices",
      "schokolade",
      "chocolate",
      "snacks"
    ]
  },
  {
    id: "kids-family",
    label_de: "Kids & Familie",
    label_en: "Kids & Family",
    aliases: [
      "kids",
      "kinder",
      "familie",
      "family",
      "baby",
      "spielzeug",
      "toys",
      "schule",
      "school"
    ]
  },
  {
    id: "sustainable-bio",
    label_de: "Nachhaltig & Bio",
    label_en: "Sustainable & Organic",
    aliases: [
      "nachhaltig",
      "sustainable",
      "bio",
      "organic",
      "eco",
      "oeko",
      "fairtrade",
      "zero-waste",
      "zerowaste",
      "vegan"
    ]
  },
  {
    id: "pets",
    label_de: "Haustiere",
    label_en: "Pets",
    aliases: [
      "haustiere",
      "haustier",
      "tierbedarf",
      "pet",
      "hund",
      "hunde",
      "dog",
      "dogs",
      "katze",
      "katzen",
      "cat",
      "cats",
      "futter"
    ]
  },
  {
    id: "gifts-lifestyle",
    label_de: "Geschenke & Lifestyle",
    label_en: "Gifts & Lifestyle",
    aliases: [
      "geschenke",
      "geschenk",
      "gifts",
      "gift",
      "lifestyle",
      "schmuck",
      "jewelry",
      "uhren",
      "watches",
      "accessoires",
      "accessories",
      "papeterie",
      "stationery"
    ]
  },
  {
    id: "secondhand-refurbished",
    label_de: "Second-Hand & Refurbished",
    label_en: "Second-Hand & Refurbished",
    aliases: [
      "secondhand",
      "second-hand",
      "refurbished",
      "gebraucht",
      "used",
      "preloved",
      "pre-owned",
      "recommerce",
      "generalueberholt"
    ]
  }
] as const;

export const STORE_CATEGORY_BY_ID: ReadonlyMap<StoreCategoryId, StoreCategoryDefinition> = new Map(
  STORE_CATEGORIES.map((c) => [c.id, c])
);

const CATEGORY_ALIAS_LOOKUP: ReadonlyMap<string, StoreCategoryId> = (() => {
  const map = new Map<string, StoreCategoryId>();
  for (const cat of STORE_CATEGORIES) {
    map.set(cat.id, cat.id);
    map.set(cat.id.replace(/-/g, ""), cat.id);
    map.set(normalizeLookupToken(cat.label_de), cat.id);
    map.set(normalizeLookupToken(cat.label_en), cat.id);
    for (const alias of cat.aliases) {
      map.set(normalizeLookupToken(alias), cat.id);
    }
  }
  return map;
})();

export function normalizeLookupToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s/&,]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isStoreCategoryId(value: string): value is StoreCategoryId {
  return (STORE_CATEGORY_IDS as readonly string[]).includes(value);
}

export function resolveCategorySlug(raw: string | undefined): StoreCategoryId | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (isStoreCategoryId(trimmed)) return trimmed;

  const normalized = normalizeLookupToken(trimmed);
  if (isStoreCategoryId(normalized)) return normalized;

  const direct = CATEGORY_ALIAS_LOOKUP.get(normalized);
  if (direct) return direct;

  const compact = normalized.replace(/-/g, "");
  return CATEGORY_ALIAS_LOOKUP.get(compact) ?? null;
}

export function getCategoryLabel(id: StoreCategoryId, lang: "de" | "en"): string {
  const def = STORE_CATEGORY_BY_ID.get(id);
  if (!def) return id;
  return lang === "de" ? def.label_de : def.label_en;
}
