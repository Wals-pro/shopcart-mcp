/* ShopCart MCP — Global Store Directory Progressive Filter UI
 * Strict CSP compliant: external script only, zero inline handlers, DOM-safe createElement rendering.
 */
(() => {
  "use strict";

  const form = document.getElementById("stores-filter-form");
  const queryInput = document.getElementById("stores-q");
  const categoryInput = document.getElementById("stores-category-input");
  const countrySelect = document.getElementById("stores-country");
  const platformSelect = document.getElementById("stores-platform");
  const cartOnlyCheckbox = document.getElementById("stores-cart-only");
  const resetLink = document.getElementById("stores-reset-link");
  const statusEl = document.getElementById("stores-status");
  const gridEl = document.getElementById("stores-grid");
  const emptyEl = document.getElementById("stores-empty");
  const chipEls = Array.from(document.querySelectorAll(".cat-chip"));

  if (!form || !queryInput || !categoryInput || !countrySelect || !platformSelect || !cartOnlyCheckbox || !gridEl) {
    return;
  }

  const lang = document.body.getAttribute("data-lang") === "en" ? "en" : "de";
  const de = lang === "de";
  const basePath = de ? "/stores" : "/en/stores";
  const checkPath = de ? "/check" : "/en/check";

  const PLATFORM_LABELS = {
    shopify: "Shopify",
    woocommerce: "WooCommerce",
    shopware: "Shopware 6",
    bigcommerce: "BigCommerce",
    magento: "Magento 2",
    ucp: "UCP",
    other: de ? "JSON-LD / Weitere" : "JSON-LD / Other"
  };

  const CATEGORY_LABELS = {
    fashion: de ? "Mode & Basics" : "Fashion & Basics",
    "sports-outdoor": de ? "Sport & Outdoor" : "Sports & Outdoor",
    "nutrition-supplements": de ? "Ernährung & Supplements" : "Nutrition & Supplements",
    "beauty-care": de ? "Beauty & Pflege" : "Beauty & Skincare",
    "home-living": "Home & Living",
    "tech-gadgets": "Tech & Gadgets",
    "coffee-tea-food": de ? "Kaffee, Tee & Genuss" : "Coffee, Tea & Specialty Food",
    "kids-family": de ? "Kids & Familie" : "Kids & Family",
    "sustainable-bio": de ? "Nachhaltig & Bio" : "Sustainable & Organic",
    pets: de ? "Haustiere" : "Pets",
    "gifts-lifestyle": de ? "Geschenke & Lifestyle" : "Gifts & Lifestyle",
    "secondhand-refurbished": "Second-Hand & Refurbished"
  };

  let activeController = null;
  let debounceTimer = null;

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (typeof text === "string") el.textContent = text;
    return el;
  }

  function isSafeHttpsUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function toSafeStoreUrl(rawUrl, rawDomain) {
    if (typeof rawUrl === "string" && isSafeHttpsUrl(rawUrl)) {
      return rawUrl;
    }
    const cleanDomain = String(rawDomain || "").trim().toLowerCase();
    if (/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(cleanDomain) && cleanDomain.includes(".")) {
      return `https://${cleanDomain}`;
    }
    return basePath;
  }

  function buildStoreCard(store) {
    const li = createEl("li", "store-card");
    li.setAttribute("data-domain", String(store.domain || ""));

    const head = createEl("div", "store-card-head");
    const titleWrap = createEl("div", "store-title-wrap");
    const nameEl = createEl("h3", "store-name", String(store.name || ""));
    const domainLink = createEl("a", "store-domain");
    const safeStoreUrl = toSafeStoreUrl(store.url, store.domain);
    domainLink.href = safeStoreUrl;
    domainLink.target = "_blank";
    domainLink.rel = "noopener noreferrer";
    domainLink.textContent = String(store.domain || "");
    const domainSr = createEl(
      "span",
      "visually-hidden",
      de ? " (öffnet Shop in neuem Tab)" : " (opens store in new tab)"
    );
    domainLink.appendChild(domainSr);
    titleWrap.appendChild(nameEl);
    titleWrap.appendChild(domainLink);

    const platformKey = String(store.platform || "other");
    const platformBadge = createEl(
      "span",
      `badge badge-platform badge-platform-${platformKey}`,
      PLATFORM_LABELS[platformKey] || platformKey
    );

    head.appendChild(titleWrap);
    head.appendChild(platformBadge);
    li.appendChild(head);

    const desc = createEl("p", "store-desc", String(store.description || ""));
    li.appendChild(desc);

    const metaRow = createEl("div", "store-meta-row");
    metaRow.setAttribute("aria-label", de ? "Länder und Funktionen" : "Countries and capabilities");
    for (const country of Array.isArray(store.countries) ? store.countries : []) {
      metaRow.appendChild(createEl("span", "badge badge-country", String(country)));
    }

    const capBadge = createEl(
      "span",
      store.cart_supported ? "badge badge-cap badge-cap-yes" : "badge badge-cap badge-cap-link"
    );
    const capIcon = createEl("span", "", store.cart_supported ? "✓" : "↗");
    capIcon.setAttribute("aria-hidden", "true");
    capBadge.appendChild(capIcon);
    capBadge.appendChild(
      document.createTextNode(
        store.cart_supported
          ? de
            ? " Warenkorb-Link"
            : " Cart link"
          : de
            ? " Produktlink"
            : " Product link"
      )
    );
    metaRow.appendChild(capBadge);

    if (store.discounts_supported) {
      const discBadge = createEl("span", "badge badge-cap badge-cap-discount");
      const discIcon = createEl("span", "", "%");
      discIcon.setAttribute("aria-hidden", "true");
      discBadge.appendChild(discIcon);
      discBadge.appendChild(document.createTextNode(de ? " Rabatt-Check" : " Discounts"));
      metaRow.appendChild(discBadge);
    }
    li.appendChild(metaRow);

    const catsRow = createEl("div", "store-cats-row");
    for (const catId of Array.isArray(store.categories) ? store.categories : []) {
      catsRow.appendChild(createEl("span", "badge badge-cat", CATEGORY_LABELS[catId] || String(catId)));
    }
    li.appendChild(catsRow);

    const actions = createEl("div", "store-actions");
    const checkBtn = createEl("a", "store-btn store-btn-secondary");
    checkBtn.href = `${checkPath}?url=${encodeURIComponent(safeStoreUrl)}`;
    checkBtn.textContent = de ? "Shop im Selbstcheck prüfen" : "Check Storefront";
    checkBtn.appendChild(createEl("span", "visually-hidden", ` (${String(store.name || "")})`));

    const testBtn = createEl("a", "store-btn store-btn-primary");
    testBtn.href = `/?lang=${lang}#start`;
    testBtn.textContent = de ? "In Claude/ChatGPT testen" : "Test in Claude/ChatGPT";
    testBtn.appendChild(createEl("span", "visually-hidden", ` (${String(store.name || "")})`));

    actions.appendChild(checkBtn);
    actions.appendChild(testBtn);
    li.appendChild(actions);

    return li;
  }

  function currentParams() {
    return {
      q: queryInput.value.trim(),
      category: categoryInput.value.trim(),
      country: countrySelect.value.trim(),
      platform: platformSelect.value.trim(),
      cart_only: cartOnlyCheckbox.checked
    };
  }

  function buildSearchParams(p, includeLang) {
    const sp = new URLSearchParams();
    if (p.q) sp.set("q", p.q);
    if (p.category) sp.set("category", p.category);
    if (p.country) sp.set("country", p.country);
    if (p.platform) sp.set("platform", p.platform);
    if (p.cart_only) sp.set("cart_only", "true");
    if (includeLang) sp.set("lang", lang);
    return sp;
  }

  function syncUiState(p, payload) {
    const hasFilter = Boolean(p.q || p.category || p.country || p.platform || p.cart_only);
    if (resetLink) {
      resetLink.classList.toggle("is-hidden", !hasFilter);
    }

    const counts = payload && payload.category_counts ? payload.category_counts : null;
    for (const chip of chipEls) {
      const cat = chip.getAttribute("data-category") || "";
      const active = cat === p.category;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-current", active ? "true" : "false");

      // Keep progressive fallback href in sync
      const chipParams = buildSearchParams({ ...p, category: cat }, false);
      const qs = chipParams.toString();
      chip.href = qs ? `${basePath}?${qs}` : basePath;

      const countEl = chip.querySelector("[data-cat-count]");
      if (countEl && payload) {
        if (cat === "") {
          countEl.textContent = String(payload.category_total ?? payload.total_matches ?? 0);
        } else if (counts && typeof counts[cat] === "number") {
          countEl.textContent = String(counts[cat]);
        }
      }
    }
  }

  async function applyFilters() {
    const p = currentParams();
    const pageQs = buildSearchParams(p, false).toString();
    const nextUrl = pageQs ? `${basePath}?${pageQs}` : basePath;
    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, "", nextUrl);
    }

    if (activeController) {
      activeController.abort();
    }
    activeController = new AbortController();

    try {
      const apiQs = buildSearchParams(p, true).toString();
      const res = await fetch(`/api/stores?${apiQs}`, {
        headers: { Accept: "application/json" },
        signal: activeController.signal
      });
      if (!res.ok) return;
      const payload = await res.json();

      const frag = document.createDocumentFragment();
      const stores = Array.isArray(payload.stores) ? payload.stores : [];
      for (const store of stores) {
        frag.appendChild(buildStoreCard(store));
      }
      gridEl.replaceChildren(frag);

      if (emptyEl) {
        emptyEl.classList.toggle("is-hidden", stores.length > 0);
      }

      if (statusEl) {
        const total = Number(payload.directory_size || 0);
        const matches = Number(payload.total_matches || 0);
        statusEl.textContent = de
          ? `${matches} von ${total} live geprüften Online-Shops`
          : `${matches} of ${total} live-verified online stores`;
      }

      syncUiState(p, payload);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      // Fallback: let server-side GET handle filtering on next submit
    }
  }

  function scheduleFilter(delayMs) {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void applyFilters();
    }, delayMs);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (debounceTimer) window.clearTimeout(debounceTimer);
    void applyFilters();
  });

  queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.isComposing || event.keyCode === 229) return;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      void applyFilters();
    }
  });

  queryInput.addEventListener("input", () => scheduleFilter(180));
  countrySelect.addEventListener("change", () => scheduleFilter(0));
  platformSelect.addEventListener("change", () => scheduleFilter(0));
  cartOnlyCheckbox.addEventListener("change", () => scheduleFilter(0));

  for (const chip of chipEls) {
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      const cat = chip.getAttribute("data-category") || "";
      categoryInput.value = cat;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      void applyFilters();
    });
  }

  if (resetLink) {
    resetLink.addEventListener("click", (event) => {
      event.preventDefault();
      queryInput.value = "";
      categoryInput.value = "";
      countrySelect.value = "";
      platformSelect.value = "";
      cartOnlyCheckbox.checked = false;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      void applyFilters();
    });
  }
})();
