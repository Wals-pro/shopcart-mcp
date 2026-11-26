/* ShopCart Storefront Self-Check client controller
 * Strict CSP compliant: external script only, zero inline handlers, zero innerHTML.
 * All external strings are rendered strictly via document.createElement + textContent.
 */
(() => {
  "use strict";

  const form = document.getElementById("store-check-form");
  if (!(form instanceof HTMLFormElement)) return;

  const storeInput = document.getElementById("sc-store-url");
  const productInput = document.getElementById("sc-product-url");
  const submitBtn = document.getElementById("sc-submit-btn");
  const formAlert = document.getElementById("sc-form-alert");
  const loadingSection = document.getElementById("sc-loading");
  const resultSection = document.getElementById("sc-result");

  if (
    !(storeInput instanceof HTMLInputElement) ||
    !(productInput instanceof HTMLInputElement) ||
    !(submitBtn instanceof HTMLButtonElement) ||
    !(formAlert instanceof HTMLElement) ||
    !(loadingSection instanceof HTMLElement) ||
    !(resultSection instanceof HTMLElement)
  ) {
    return;
  }

  const lang = form.getAttribute("data-lang") === "en" ? "en" : "de";
  const de = lang === "de";

  const COPY = de
    ? {
        capabilitiesTitle: "Was KI-Assistenten (Claude, ChatGPT, Gemini, Instinct) lesen können",
        productTitle: "Live-Produktcheck (2. Blick)",
        priceLabel: "Preis",
        availabilityLabel: "Verfügbarkeit",
        variantsLabel: "Varianten",
        variantsShowing: (shown, total) => `${shown} von ${total} Varianten angezeigt`,
        inStock: "Verfügbar",
        outOfStock: "Ausverkauft",
        skuPrefix: "SKU: ",
        gtinPrefix: "EAN/GTIN: ",
        hintsTitle: "Konkrete Hinweise für deinen Shop",
        copyPrompt: "Prompt kopieren",
        copiedPrompt: "Kopiert ✓",
        copyFailed: "Kopieren fehlgeschlagen",
        storefrontMcpTag: "Shopify Storefront MCP aktiv",
        storefrontUcpTag: "Shopify UCP aktiv",
        wafTag: "WAF / Bot-Regeln erkannt",
        currencyTag: (c) => `Währung: ${c}`,
        countryTag: (c) => `Land: ${c}`,
        networkError: "Netzwerkfehler bei der Prüfung. Bitte versuche es in einem Moment erneut.",
        storeRequired: "Bitte gib eine öffentliche Shop-Domain oder HTTPS-URL ein (z. B. snocks.com).",
        productInvalid: "Bitte gib eine gültige Produkt-URL derselben Shop-Domain ein.",
        statusDone: (domain, statusLabel) => `Prüfung für ${domain} abgeschlossen: ${statusLabel}.`,
        statusIcon: {
          ai_ready: "✓",
          partially_readable: "!",
          not_publicly_readable: "×"
        },
        capIcon: {
          supported: "✓",
          limited: "◐",
          unsupported: "—"
        }
      }
    : {
        capabilitiesTitle: "What AI assistants (Claude, ChatGPT, Gemini, Instinct) can read",
        productTitle: "Live product check (2nd look)",
        priceLabel: "Price",
        availabilityLabel: "Availability",
        variantsLabel: "Variants",
        variantsShowing: (shown, total) => `Showing ${shown} of ${total} variants`,
        inStock: "In stock",
        outOfStock: "Out of stock",
        skuPrefix: "SKU: ",
        gtinPrefix: "EAN/GTIN: ",
        hintsTitle: "Actionable hints for your store",
        copyPrompt: "Copy prompt",
        copiedPrompt: "Copied ✓",
        copyFailed: "Copy failed",
        storefrontMcpTag: "Shopify Storefront MCP active",
        storefrontUcpTag: "Shopify UCP active",
        wafTag: "WAF / bot rules detected",
        currencyTag: (c) => `Currency: ${c}`,
        countryTag: (c) => `Country: ${c}`,
        networkError: "Network error during check. Please try again in a moment.",
        storeRequired: "Please enter a public store domain or HTTPS URL (e.g. allbirds.com).",
        productInvalid: "Please enter a valid product URL from the same store domain.",
        statusDone: (domain, statusLabel) => `Check completed for ${domain}: ${statusLabel}.`,
        statusIcon: {
          ai_ready: "✓",
          partially_readable: "!",
          not_publicly_readable: "×"
        },
        capIcon: {
          supported: "✓",
          limited: "◐",
          unsupported: "—"
        }
      };

  // Single polite live region for screen-reader announcements
  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.className = "visually-hidden";
  document.body.appendChild(announcer);
  let announceTimer = 0;

  const announce = (text, delayMs) => {
    window.clearTimeout(announceTimer);
    announcer.textContent = "";
    announceTimer = window.setTimeout(() => {
      announcer.textContent = text;
    }, delayMs || 80);
  };

  // Synchronize aria-invalid & aria-describedby cleanly with interaction state
  const linkError = (input, shown) => {
    const errorId = input.dataset.error;
    if (!errorId) return;
    const ids = (input.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
    else input.removeAttribute("aria-describedby");
  };

  const setFieldError = (input, message) => {
    const errorEl = input.dataset.error ? document.getElementById(input.dataset.error) : null;
    const textEl = errorEl ? errorEl.querySelector("[data-error-text]") : null;
    if (message) {
      if (textEl) textEl.textContent = message;
      input.setCustomValidity(message);
      input.classList.add("user-invalid-fallback");
      input.setAttribute("aria-invalid", "true");
      linkError(input, true);
    } else {
      input.setCustomValidity("");
      input.classList.remove("user-invalid-fallback");
      input.setAttribute("aria-invalid", "false");
      linkError(input, false);
    }
  };

  const validateStoreField = () => {
    const val = storeInput.value.trim();
    if (!val) {
      setFieldError(storeInput, COPY.storeRequired);
      return false;
    }
    if (/^(javascript|data|file|vbscript):/i.test(val) || /\s/.test(val)) {
      setFieldError(storeInput, COPY.storeRequired);
      return false;
    }
    setFieldError(storeInput, "");
    return true;
  };

  const validateProductField = () => {
    const val = productInput.value.trim();
    if (!val) {
      setFieldError(productInput, "");
      return true;
    }
    if (/^(javascript|data|file|vbscript):/i.test(val) || /\s/.test(val)) {
      setFieldError(productInput, COPY.productInvalid);
      return false;
    }
    setFieldError(productInput, "");
    return true;
  };

  const touched = new WeakSet();

  storeInput.addEventListener("blur", () => {
    if (touched.has(storeInput) || storeInput.value.trim().length > 0) {
      if (!validateStoreField()) {
        announce(COPY.storeRequired, 300);
      }
    }
  });
  storeInput.addEventListener("input", () => {
    touched.add(storeInput);
    if (storeInput.getAttribute("aria-invalid") === "true") {
      validateStoreField();
    }
  });

  productInput.addEventListener("blur", () => {
    if (touched.has(productInput) || productInput.value.trim().length > 0) {
      if (!validateProductField()) {
        announce(COPY.productInvalid, 300);
      }
    }
  });
  productInput.addEventListener("input", () => {
    touched.add(productInput);
    if (productInput.getAttribute("aria-invalid") === "true") {
      validateProductField();
    }
  });

  // Example store chips
  form.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const chip = target.closest("[data-example-store]");
    if (!(chip instanceof HTMLButtonElement)) return;
    const domain = chip.getAttribute("data-example-store") || "";
    if (!domain) return;
    storeInput.value = domain;
    setFieldError(storeInput, "");
    formAlert.hidden = true;
    formAlert.textContent = "";
    storeInput.focus();
  });

  // Clipboard helper with graceful fallback (zero window.prompt)
  const copyText = async (text) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback below
      }
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.className = "clipboard-proxy";
      area.setAttribute("readonly", "");
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return Boolean(ok);
    } catch {
      return false;
    }
  };

  // Safe DOM element builder (strictly textContent, NEVER innerHTML)
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  const renderResult = (data) => {
    // Clear previous content safely without innerHTML
    resultSection.replaceChildren();

    const wrap = el("div", "wrap wrap-narrow");
    const shell = el("div", "sc-result-shell");

    // 1. Header Card
    const headerCard = el("article", "sc-result-header");
    const topRow = el("div", "sc-result-top");

    const domainGroup = el("div", "sc-result-domain-group");
    const heading = el("h2", "sc-result-heading", data.store?.name || data.store?.domain || "");
    heading.id = "sc-result-heading";
    heading.setAttribute("tabindex", "-1");

    const submeta = el("div", "sc-result-submeta");
    const platformPill = el("span", "sc-platform-pill", data.platformLabel || data.platform || "");
    submeta.appendChild(platformPill);
    if (data.store?.domain) {
      submeta.appendChild(el("span", "", data.store.domain));
    }

    domainGroup.appendChild(heading);
    domainGroup.appendChild(submeta);

    const statusKey =
      data.status === "ai_ready" ||
      data.status === "partially_readable" ||
      data.status === "not_publicly_readable"
        ? data.status
        : "not_publicly_readable";
    const statusBadge = el("span", `sc-status-badge sc-status-${statusKey}`);
    const iconSpan = el("span", "", COPY.statusIcon[statusKey] || "!");
    iconSpan.setAttribute("aria-hidden", "true");
    statusBadge.appendChild(iconSpan);
    statusBadge.appendChild(el("span", "", data.statusLabel || ""));

    topRow.appendChild(domainGroup);
    topRow.appendChild(statusBadge);
    headerCard.appendChild(topRow);

    if (data.statusSummary) {
      headerCard.appendChild(el("p", "sc-status-summary", data.statusSummary));
    }

    const metaTags = el("div", "sc-meta-tags");
    if (data.store?.currency) {
      metaTags.appendChild(el("span", "sc-meta-tag", COPY.currencyTag(data.store.currency)));
    }
    if (data.store?.country) {
      metaTags.appendChild(el("span", "sc-meta-tag", COPY.countryTag(data.store.country)));
    }
    if (data.store?.storefrontMcp) {
      metaTags.appendChild(el("span", "sc-meta-tag", COPY.storefrontMcpTag));
    }
    if (data.store?.storefrontUcp) {
      metaTags.appendChild(el("span", "sc-meta-tag", COPY.storefrontUcpTag));
    }
    if (data.store?.wafRestricted) {
      metaTags.appendChild(el("span", "sc-meta-tag", COPY.wafTag));
    }
    if (metaTags.childNodes.length > 0) {
      headerCard.appendChild(metaTags);
    }

    shell.appendChild(headerCard);

    // 2. Capabilities Panel
    if (Array.isArray(data.capabilities) && data.capabilities.length > 0) {
      const capPanel = el("section", "sc-panel");
      capPanel.appendChild(el("h3", "sc-panel-title", COPY.capabilitiesTitle));
      const capGrid = el("div", "sc-cap-grid");

      for (const cap of data.capabilities) {
        const capState =
          cap.state === "supported" || cap.state === "limited" || cap.state === "unsupported"
            ? cap.state
            : "unsupported";
        const card = el("div", "sc-cap-card");
        const head = el("div", "sc-cap-head");
        head.appendChild(el("span", "sc-cap-name", cap.label || ""));
        const pill = el("span", `sc-cap-pill sc-cap-${capState}`);
        const cIcon = el("span", "", COPY.capIcon[capState]);
        cIcon.setAttribute("aria-hidden", "true");
        pill.appendChild(cIcon);
        pill.appendChild(el("span", "", cap.stateLabel || ""));
        head.appendChild(pill);
        card.appendChild(head);
        card.appendChild(el("p", "sc-cap-detail", cap.detail || ""));
        capGrid.appendChild(card);
      }

      capPanel.appendChild(capGrid);
      shell.appendChild(capPanel);
    }

    // 3. Optional 2nd Look: Product Check Panel
    if (data.productCheck) {
      const prodPanel = el("section", "sc-panel");
      prodPanel.appendChild(el("h3", "sc-panel-title", COPY.productTitle));

      if (data.productCheck.ok && data.productCheck.product) {
        const p = data.productCheck.product;
        prodPanel.appendChild(el("p", "sc-product-title", p.title || ""));

        const subParts = [];
        if (p.vendor) subParts.push(p.vendor);
        if (p.sku) subParts.push(`${COPY.skuPrefix}${p.sku}`);
        if (p.gtin) subParts.push(`${COPY.gtinPrefix}${p.gtin}`);
        if (subParts.length > 0) {
          prodPanel.appendChild(el("p", "sc-product-sub", subParts.join(" · ")));
        }

        const stats = el("div", "sc-product-meta-grid");

        const priceStat = el("div", "sc-product-stat");
        priceStat.appendChild(el("div", "sc-product-stat-label", COPY.priceLabel));
        const priceText = p.price
          ? p.compareAtPrice
            ? `${p.price} (UVP ${p.compareAtPrice})`
            : p.price
          : "—";
        priceStat.appendChild(el("div", "sc-product-stat-value", priceText));
        stats.appendChild(priceStat);

        const availStat = el("div", "sc-product-stat");
        availStat.appendChild(el("div", "sc-product-stat-label", COPY.availabilityLabel));
        availStat.appendChild(el("div", "sc-product-stat-value", p.availabilityLabel || "—"));
        stats.appendChild(availStat);

        const varStat = el("div", "sc-product-stat");
        varStat.appendChild(el("div", "sc-product-stat-label", COPY.variantsLabel));
        varStat.appendChild(
          el("div", "sc-product-stat-value", `${p.inStockVariantCount ?? 0} / ${p.variantCount ?? 0}`)
        );
        stats.appendChild(varStat);

        prodPanel.appendChild(stats);

        if (Array.isArray(p.variants) && p.variants.length > 0) {
          const list = el("ul", "sc-variants-list");
          for (const v of p.variants) {
            const li = el("li", "sc-variant-item");
            li.appendChild(el("span", "sc-variant-name", v.title || ""));
            const right = el("span", "sc-variant-right");
            if (v.price) {
              right.appendChild(el("span", "sc-variant-price", v.price));
            }
            right.appendChild(
              el(
                "span",
                v.available ? "sc-variant-stock-in" : "sc-variant-stock-out",
                v.available ? COPY.inStock : COPY.outOfStock
              )
            );
            li.appendChild(right);
            list.appendChild(li);
          }
          prodPanel.appendChild(list);

          if (typeof p.variantCount === "number" && p.variantCount > p.variants.length) {
            prodPanel.appendChild(
              el("p", "sc-product-sub", COPY.variantsShowing(p.variants.length, p.variantCount))
            );
          }
        }
      } else {
        prodPanel.appendChild(
          el("p", "sc-product-error", data.productCheck.errorMessage || COPY.productInvalid)
        );
      }

      shell.appendChild(prodPanel);
    }

    // 4. Copyable Example Prompt
    if (data.examplePrompt && data.examplePrompt.text) {
      const promptBox = el("section", "sc-prompt-box");
      const promptHead = el("div", "sc-prompt-head");
      promptHead.appendChild(el("h3", "sc-prompt-title", data.examplePrompt.heading || ""));

      const copyBtn = el("button", "sc-copy-btn", COPY.copyPrompt);
      copyBtn.type = "button";
      copyBtn.setAttribute("data-copy-example-prompt", "");
      copyBtn.addEventListener("click", async () => {
        const ok = await copyText(data.examplePrompt.text);
        copyBtn.textContent = ok ? COPY.copiedPrompt : COPY.copyFailed;
        copyBtn.setAttribute("data-copied", ok ? "true" : "false");
        window.setTimeout(() => {
          copyBtn.textContent = COPY.copyPrompt;
          copyBtn.removeAttribute("data-copied");
        }, 2200);
      });
      promptHead.appendChild(copyBtn);
      promptBox.appendChild(promptHead);
      promptBox.appendChild(el("p", "sc-prompt-text", data.examplePrompt.text));
      shell.appendChild(promptBox);
    }

    // 5. Actionable Hints
    if (Array.isArray(data.hints) && data.hints.length > 0) {
      const hintsPanel = el("section", "sc-panel");
      hintsPanel.appendChild(el("h3", "sc-panel-title", COPY.hintsTitle));
      const hintsList = el("ul", "sc-hints-list");
      for (const hint of data.hints) {
        const li = el("li", "sc-hint-item");
        li.appendChild(el("h4", "sc-hint-title", hint.title || ""));
        li.appendChild(el("p", "sc-hint-text", hint.text || ""));
        hintsList.appendChild(li);
      }
      hintsPanel.appendChild(hintsList);
      shell.appendChild(hintsPanel);
    }

    // 6. Independence Disclaimer inside result
    if (data.disclaimer) {
      shell.appendChild(el("p", "sc-disclaimer-box", data.disclaimer));
    }

    wrap.appendChild(shell);
    resultSection.appendChild(wrap);
    resultSection.hidden = false;
    heading.focus();
    announce(COPY.statusDone(data.store?.domain || "", data.statusLabel || ""), 120);
  };

  let inFlight = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (inFlight) return;

    formAlert.hidden = true;
    formAlert.textContent = "";

    const storeOk = validateStoreField();
    const productOk = validateProductField();
    if (!storeOk) {
      storeInput.focus();
      return;
    }
    if (!productOk) {
      productInput.focus();
      return;
    }

    const storeUrl = storeInput.value.trim();
    const productUrl = productInput.value.trim();
    const hasProductUrl = productUrl.length > 0;

    inFlight = true;
    submitBtn.disabled = true;
    submitBtn.textContent = submitBtn.getAttribute("data-loading-label") || submitBtn.textContent;
    loadingSection.hidden = false;
    resultSection.hidden = true;

    try {
      const res = await fetch("/api/store-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({
          storeUrl,
          ...(hasProductUrl ? { productUrl } : {}),
          lang
        })
      });

      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const errMsg = (payload && typeof payload.message === "string" && payload.message) || COPY.networkError;
        if (res.status === 400 && payload && payload.field === "storeUrl") {
          setFieldError(storeInput, errMsg);
          storeInput.focus();
        } else if (res.status === 400 && payload && payload.field === "productUrl") {
          setFieldError(productInput, errMsg);
          productInput.focus();
        } else {
          formAlert.textContent = errMsg;
          formAlert.hidden = false;
        }
        return;
      }

      if (!payload || typeof payload !== "object") {
        formAlert.textContent = COPY.networkError;
        formAlert.hidden = false;
        return;
      }

      renderResult(payload);

      // Emit strictly anonymous categorical event for consent-gated GA4 (/assets/analytics.js)
      document.dispatchEvent(
        new CustomEvent("shopcart:store_check_run", {
          detail: {
            platform: typeof payload.platform === "string" ? payload.platform : "unknown",
            status: typeof payload.status === "string" ? payload.status : "not_publicly_readable",
            has_product_url: hasProductUrl
          }
        })
      );
    } catch {
      formAlert.textContent = COPY.networkError;
      formAlert.hidden = false;
    } finally {
      inFlight = false;
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.getAttribute("data-idle-label") || submitBtn.textContent;
      loadingSection.hidden = true;
    }
  });
})();
