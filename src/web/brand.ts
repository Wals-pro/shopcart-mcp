export const SPARK_CART_BRAND_RED = "#FF1F4D";
export const SPARK_CART_WORDMARK_ACCENT = "#FF2D59";

function escapeAttr(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SparkCartIconOptions {
  size?: number;
  className?: string;
  decorative?: boolean;
  fullBleed?: boolean;
}

/**
 * Unified ShopCart "Spark Cart" brand SVG (Option A, wals.pro red #FF1F4D).
 * - Standard variant (`fullBleed: false`, default): 60x60 rounded square with 2px inset (`rx="15"`).
 * - Full-bleed variant (`fullBleed: true`): 64x64 rounded square (`rx="16"`), matching favicon.svg & PNG app icons.
 */
export function renderSparkCartSvg(opts: SparkCartIconOptions = {}): string {
  const size = opts.size ?? 28;
  const classAttr = opts.className ? ` class="${escapeAttr(opts.className)}"` : "";
  const a11yAttrs =
    opts.decorative === false
      ? ' role="img" aria-label="ShopCart"'
      : ' aria-hidden="true" focusable="false"';
  const rect = opts.fullBleed
    ? '<rect x="0" y="0" width="64" height="64" rx="16" fill="#FF1F4D"/>'
    : '<rect x="2" y="2" width="60" height="60" rx="15" fill="#FF1F4D"/>';
  return `<svg${classAttr} width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"${a11yAttrs}>${rect}<path d="M13 18h6.2l4.4 20.5a3.2 3.2 0 0 0 3.1 2.5h17.8a3.2 3.2 0 0 0 3.1-2.4l3.1-12.2H22.2" fill="none" stroke="#FFFFFF" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26.5" cy="49.5" r="3.4" fill="#FFFFFF"/><circle cx="43.5" cy="49.5" r="3.4" fill="#FFFFFF"/><path d="M44 10.5c.8 4.4 2.1 5.7 6.5 6.5-4.4.8-5.7 2.1-6.5 6.5-.8-4.4-2.1-5.7-6.5-6.5 4.4-.8 5.7-2.1 6.5-6.5z" fill="#FFFFFF"/></svg>`;
}

/**
 * Unified navbar wordmark: "Shop" in #FFFFFF + "Cart" in #FF2D59 (.brand-accent),
 * with optional trailing suffix (e.g. "MCP").
 */
export function renderShopCartWordmark(suffix = ""): string {
  const trailing = suffix ? ` ${escapeAttr(suffix)}` : "";
  return `<span class="brand-wordmark">Shop<span class="brand-accent">Cart</span>${trailing}</span>`;
}

/**
 * Unified <head> icon and Web App Manifest links shared across all HTML pages.
 */
export function renderFaviconHeadLinks(): string {
  return [
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/manifest.webmanifest">'
  ].join("\n");
}
