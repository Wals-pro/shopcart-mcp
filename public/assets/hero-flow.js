/* ShopCart landing page behaviour (strict CSP: script-src 'self', no inline scripts).
 * 1. Hero silk wave (Canvas 2D) with drifting shopping moments
 * 2. "Let my AI set this up" launcher: wish chips, AI deeplinks, 1-click copy
 * 3. Copy buttons
 * 4. Accessible tabs (developer section)
 * 5. Demo showcase: consumer live-shopping simulation + video aspect toggle
 */
(() => {
  "use strict";

  const reducedMotionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false, addEventListener() {} };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (v) => {
    const x = clamp01(v);
    return x * x * (3 - 2 * x);
  };

  // =========================================================================
  // 1. Hero silk wave
  // =========================================================================
  const initHeroFlow = () => {
    const canvas = document.getElementById("hero-flow-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const wrap = canvas.parentElement;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!wrap || !ctx) return;

    const motionBtn = document.getElementById("hero-motion-btn");
    const heroContent = document.getElementById("hero-content");

    /** @type {Array<{t: string, k: string}>} */
    let chipDefs = [];
    try {
      const parsed = JSON.parse(canvas.dataset.chips || "[]");
      if (Array.isArray(parsed)) {
        chipDefs = parsed.filter((c) => c && typeof c.t === "string").slice(0, 12);
      }
    } catch {
      chipDefs = [];
    }

    // wals.pro red spectrum with silver edges: [r, g, b] stops across the ribbon width
    const PALETTE = [
      [224, 224, 224],
      [255, 138, 91],
      [255, 107, 122],
      [255, 31, 77],
      [214, 18, 60],
      [255, 31, 77],
      [255, 107, 122],
      [255, 236, 240],
      [255, 107, 122],
      [255, 31, 77],
      [255, 138, 91],
      [224, 224, 224]
    ];
    const paletteAt = (p) => {
      const scaled = clamp01(p) * (PALETTE.length - 1);
      const idx = Math.min(PALETTE.length - 2, Math.floor(scaled));
      const f = scaled - idx;
      const a = PALETTE[idx];
      const b = PALETTE[idx + 1];
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f)
      ];
    };

    const state = {
      w: 0,
      h: 0,
      dpr: 1,
      mobile: false,
      samples: 96,
      strands: 72,
      fadeStart: 0,
      fadeEnd: 0,
      safeLeft: 0,
      /** @type {CanvasGradient | null} */
      bodyGrad: null,
      /** @type {Array<{v: number, phase: number, grad: CanvasGradient, gradBack: CanvasGradient, lw: number}>} */
      strandData: [],
      /** @type {Array<{text: string, kind: string, lane: number, offset: number, width: number}>} */
      chips: [],
      laneLength: [0, 0, 0],
      lanes: 3,
      time: 0,
      last: 0,
      running: false,
      visible: true,
      userPaused: false,
      raf: 0
    };

    // Per-frame scratch buffers (no allocations in the hot path)
    let spineY = new Float32Array(0);
    let spineX = new Float32Array(0);
    let twistCos = new Float32Array(0);
    let width = new Float32Array(0);
    let spineY2 = new Float32Array(0);
    let twistCos2 = new Float32Array(0);

    const CHIP_FONT = '600 13px Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
    const CHIP_H = 34;
    const CHIP_GAP = 84;

    const layoutChips = () => {
      state.chips = [];
      state.laneLength = [0, 0, 0];
      if (!chipDefs.length) return;
      ctx.font = CHIP_FONT;
      const lanes = state.lanes;
      const cursor = [0, 0, 0];
      chipDefs.forEach((def, idx) => {
        const lane = idx % lanes;
        const textW = Math.ceil(ctx.measureText(def.t).width);
        const chipW = textW + 44;
        state.chips.push({ text: def.t, kind: def.k, lane, offset: cursor[lane], width: chipW });
        cursor[lane] += chipW + CHIP_GAP + (lane === 1 ? 46 : 0);
      });
      const travel = state.w - (state.mobile ? -40 : state.safeLeft + 28) + 80;
      for (let lane = 0; lane < lanes; lane++) {
        state.laneLength[lane] = Math.max(cursor[lane], travel);
      }
    };

    const buildStrands = () => {
      state.strandData = [];
      const { w, strands, fadeStart, fadeEnd } = state;
      const s0 = clamp01(fadeStart / w);
      const s1 = clamp01(Math.max(fadeEnd, fadeStart + 1) / w);
      for (let i = 0; i < strands; i++) {
        const p = strands === 1 ? 0.5 : i / (strands - 1);
        const v = p * 2 - 1;
        const [r, g, b] = paletteAt(p);
        const edge = 1 - Math.pow(Math.abs(v), 2.4) * 0.55;
        const jitter = 0.72 + 0.28 * Math.sin(i * 12.9898) * Math.sin(i * 4.1414);
        const alpha = (state.mobile ? 0.5 : 0.62) * edge * jitter;

        const makeGrad = (a, shift) => {
          const grad = ctx.createLinearGradient(0, 0, w, 0);
          const [r2, g2, b2] = paletteAt(clamp01(p + shift));
          if (s0 > 0) {
            grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
            grad.addColorStop(s0, `rgba(${r},${g},${b},0)`);
            grad.addColorStop(s1, `rgba(${r},${g},${b},${a.toFixed(3)})`);
          } else {
            grad.addColorStop(0, `rgba(${r},${g},${b},${(a * 0.85).toFixed(3)})`);
          }
          grad.addColorStop(Math.min(0.94, Math.max(s1 + 0.02, 0.78)), `rgba(${r2},${g2},${b2},${a.toFixed(3)})`);
          grad.addColorStop(1, `rgba(${r2},${g2},${b2},${(a * 0.5).toFixed(3)})`);
          return grad;
        };

        state.strandData.push({
          v,
          phase: i * 0.61,
          grad: makeGrad(alpha, 0.12),
          gradBack: makeGrad(alpha * 0.36, -0.18),
          gradGlow: i % 5 === 2 ? makeGrad(alpha * 0.16, 0.05) : null,
          lw: 1.05 + 0.75 * (0.5 + 0.5 * Math.sin(i * 2.37))
        });
      }
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = w;
      state.h = h;
      state.dpr = dpr;
      state.mobile = w < 900;
      state.samples = state.mobile ? 56 : 96;
      state.strands = state.mobile ? 54 : 104;
      state.lanes = state.mobile ? 1 : 3;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      if (state.mobile || !heroContent) {
        state.fadeStart = 0;
        state.fadeEnd = 0;
        state.safeLeft = 0;
      } else {
        const contentRect = heroContent.getBoundingClientRect();
        const safeLeft = Math.max(0, contentRect.right - rect.left);
        state.safeLeft = safeLeft;
        state.fadeStart = Math.min(w * 0.6, safeLeft * 0.66);
        state.fadeEnd = Math.min(w * 0.82, safeLeft + (w - safeLeft) * 0.26);
      }

      // Soft translucent body under the strands gives the ribbon its mass
      const body = ctx.createLinearGradient(0, 0, w, 0);
      const b0 = clamp01(state.fadeStart / w);
      const b1 = clamp01(Math.max(state.fadeEnd, state.fadeStart + 1) / w);
      if (b0 > 0) {
        body.addColorStop(0, "rgba(255,31,77,0)");
        body.addColorStop(b0, "rgba(255,31,77,0)");
        body.addColorStop(b1, "rgba(255,31,77,0.15)");
      } else {
        body.addColorStop(0, "rgba(255,31,77,0.12)");
      }
      body.addColorStop(0.86, "rgba(255,84,104,0.17)");
      body.addColorStop(1, "rgba(255,138,91,0.1)");
      state.bodyGrad = body;

      const n = state.samples + 1;
      spineY = new Float32Array(n);
      spineX = new Float32Array(n);
      twistCos = new Float32Array(n);
      width = new Float32Array(n);
      spineY2 = new Float32Array(n);
      twistCos2 = new Float32Array(n);

      // On phones the wave is a band above the text: keep the chip lane clear of the
      // eyebrow badge so a chip can never touch or overlap it.
      state.chipTop = 10;
      state.chipBottom = Infinity;
      if (state.mobile && heroContent) {
        const badge = heroContent.querySelector(".eyebrow") || heroContent;
        const badgeTop = badge.getBoundingClientRect().top - rect.top;
        state.chipBottom = Math.max(state.chipTop, badgeTop - CHIP_H - 20);
      }

      buildStrands();
      layoutChips();
    };

    const TAU = Math.PI * 2;

    const spineAt = (u, t) => {
      const { mobile } = state;
      // Keep the wave inside the first screen even when the hero is taller than the viewport
      const h = mobile ? state.h : Math.min(state.h, 860);
      const base = mobile ? h * (0.4 - 0.06 * u) : h * (0.84 - 0.5 * u);
      const a1 = h * (mobile ? 0.13 : 0.085);
      const a2 = h * (mobile ? 0.06 : 0.04);
      return base + a1 * Math.sin(TAU * (0.92 * u) + t * 0.34) + a2 * Math.sin(TAU * (1.9 * u) - t * 0.23 + 1.3);
    };

    const ribbonWidth = () =>
      state.mobile ? Math.min(state.h * 0.34, 72) : Math.min(state.h * 0.22, 190);

    const computeFrame = (t) => {
      const { w, h, samples, mobile } = state;
      const x0 = -w * 0.06;
      const x1 = w * 1.06;
      const baseW = ribbonWidth();
      for (let s = 0; s <= samples; s++) {
        const u = s / samples;
        spineX[s] = x0 + (x1 - x0) * u;
        spineY[s] = spineAt(u, t);
        twistCos[s] = Math.cos(TAU * (0.78 * u) + t * 0.21 + 0.5);
        width[s] = baseW * (0.72 + 0.28 * Math.sin(TAU * (0.6 * u) + t * 0.17 + 2.1));
        // Back ribbon: same family, shifted phase, so the two weave through each other
        spineY2[s] =
          spineAt(u, t + 0.9) + Math.min(h, 860) * (mobile ? 0.02 : 0.03) * Math.sin(TAU * (1.3 * u) + t * 0.19);
        twistCos2[s] = Math.cos(TAU * (0.7 * u) - t * 0.16 + 1.9);
      }
    };

    const fillBody = (ys, tw, scale) => {
      const { samples } = state;
      ctx.beginPath();
      for (let s = 0; s <= samples; s++) {
        const y = ys[s] - width[s] * scale * Math.abs(tw[s]) - width[s] * 0.1;
        if (s === 0) ctx.moveTo(spineX[s], y);
        else ctx.lineTo(spineX[s], y);
      }
      for (let s = samples; s >= 0; s--) {
        ctx.lineTo(spineX[s], ys[s] + width[s] * scale * Math.abs(tw[s]) + width[s] * 0.1);
      }
      ctx.closePath();
      ctx.fillStyle = state.bodyGrad;
      ctx.fill();
    };

    const strokeRibbon = (ys, tw, back, t) => {
      const { samples, strandData } = state;
      const step = back ? 2 : 1;
      for (let i = 0; i < strandData.length; i += step) {
        const strand = strandData[i];
        const v = strand.v;
        ctx.beginPath();
        for (let s = 0; s <= samples; s++) {
          const u = s / samples;
          const wv = width[s] * (back ? 0.84 : 1);
          // Twisted ribbon projection + a silk spread that keeps pinches from collapsing to a line
          const silk = wv * 0.15 * Math.sin(TAU * (1.55 * u) + strand.phase + t * 0.42);
          const y = ys[s] + v * wv * tw[s] + silk;
          if (s === 0) ctx.moveTo(spineX[s], y);
          else ctx.lineTo(spineX[s], y);
        }
        if (!back && strand.gradGlow) {
          // Cheap bloom: a wide, faint pass under every sixth strand
          ctx.strokeStyle = strand.gradGlow;
          ctx.lineWidth = 7;
          ctx.stroke();
        }
        ctx.strokeStyle = back ? strand.gradBack : strand.grad;
        ctx.lineWidth = back ? strand.lw * 0.85 : strand.lw;
        ctx.stroke();
      }
    };

    const roundRectPath = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
      ctx.lineTo(x + w, y + h - r);
      ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
      ctx.lineTo(x + r, y + h);
      ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
      ctx.lineTo(x, y + r);
      ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
      ctx.closePath();
    };

    const KIND_DOT = {
      item: "#e0e0e0",
      price: "#ff8a5b",
      ready: "#ff1f4d",
      link: "#ff6b7a"
    };

    const drawChips = (t) => {
      const { chips, w, h, mobile, lanes } = state;
      if (!chips.length) return;
      const xStart = mobile ? -40 : state.safeLeft + 28;
      const baseW = ribbonWidth();
      const laneOffsets = lanes === 1 ? [0] : [-baseW * 0.8, 0, baseW * 0.8];
      const laneSpeed = [21, 28, 24];
      const x0 = -w * 0.06;
      const x1 = w * 1.06;

      ctx.font = CHIP_FONT;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      for (let i = 0; i < chips.length; i++) {
        const chip = chips[i];
        const laneLen = state.laneLength[chip.lane] || 1;
        const travelled = (chip.offset + t * laneSpeed[chip.lane]) % laneLen;
        const x = xStart + travelled - chip.width;
        if (x > w + 10 || x + chip.width < xStart - 10) continue;

        const centerX = x + chip.width / 2;
        const u = clamp01((centerX - x0) / (x1 - x0));
        let y =
          spineAt(u, t) + laneOffsets[chip.lane] + Math.sin(t * 0.6 + i * 1.7) * 5 - CHIP_H / 2;
        if (mobile && Number.isFinite(state.chipBottom)) {
          // Map the wave's vertical travel into the clear band above the eyebrow badge
          const lo = h * 0.15 - CHIP_H / 2;
          const hi = h * 0.6 - CHIP_H / 2;
          const k = clamp01((y - lo) / Math.max(1, hi - lo));
          y = state.chipTop + k * (state.chipBottom - state.chipTop);
        }

        const fadeIn = smooth((x + chip.width * 0.5 - xStart) / 110);
        const fadeOut = smooth((w - (x + chip.width * 0.35)) / 120);
        const alpha = fadeIn * fadeOut * (chip.lane === 1 ? 1 : 0.9);
        if (alpha <= 0.01) continue;

        ctx.globalAlpha = alpha;
        roundRectPath(x, y, chip.width, CHIP_H, CHIP_H / 2);
        ctx.fillStyle = "rgba(14, 14, 14, 0.86)";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle =
          chip.kind === "ready" || chip.kind === "link" ? "rgba(255, 31, 77, 0.62)" : "rgba(255, 255, 255, 0.2)";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x + 16, y + CHIP_H / 2, 3.5, 0, TAU);
        ctx.fillStyle = KIND_DOT[chip.kind] || KIND_DOT.item;
        ctx.fill();

        ctx.fillStyle = "#f4f4f4";
        ctx.fillText(chip.text, x + 28, y + CHIP_H / 2 + 0.5);
      }
      ctx.globalAlpha = 1;
    };

    const draw = (t) => {
      const { w, h, dpr } = state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      computeFrame(t);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "lighter";
      fillBody(spineY2, twistCos2, 0.84);
      fillBody(spineY, twistCos, 1);
      strokeRibbon(spineY2, twistCos2, true, t);
      strokeRibbon(spineY, twistCos, false, t);
      ctx.globalCompositeOperation = "source-over";

      drawChips(t);
    };

    const frame = (now) => {
      if (!state.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - state.last) / 1000));
      state.last = now;
      state.time += dt;
      draw(state.time);
      state.raf = window.requestAnimationFrame(frame);
    };

    const syncRunning = () => {
      const shouldRun = state.visible && !state.userPaused && !document.hidden;
      if (shouldRun && !state.running) {
        state.running = true;
        state.last = performance.now();
        state.raf = window.requestAnimationFrame(frame);
      } else if (!shouldRun && state.running) {
        state.running = false;
        window.cancelAnimationFrame(state.raf);
      }
      if (motionBtn) {
        const paused = state.userPaused;
        motionBtn.textContent = paused ? "▶" : "❚❚";
        motionBtn.setAttribute(
          "aria-label",
          (paused ? motionBtn.dataset.playLabel : motionBtn.dataset.pauseLabel) || ""
        );
        motionBtn.setAttribute("aria-pressed", String(paused));
      }
    };

    // A calm, good-looking still frame for reduced motion and as first paint
    state.time = 7.4;
    state.userPaused = reducedMotionQuery.matches;

    resize();
    draw(state.time);

    if ("ResizeObserver" in window) {
      let pending = 0;
      new ResizeObserver(() => {
        window.cancelAnimationFrame(pending);
        pending = window.requestAnimationFrame(() => {
          resize();
          draw(state.time);
        });
      }).observe(wrap);
    } else {
      window.addEventListener("resize", () => {
        resize();
        draw(state.time);
      });
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            state.visible = entry.isIntersecting;
          });
          syncRunning();
        },
        { threshold: 0.02 }
      ).observe(wrap);
    }

    document.addEventListener("visibilitychange", syncRunning);
    reducedMotionQuery.addEventListener?.("change", (ev) => {
      state.userPaused = ev.matches;
      syncRunning();
    });

    if (motionBtn) {
      motionBtn.addEventListener("click", () => {
        state.userPaused = !state.userPaused;
        syncRunning();
      });
    }

    // Web fonts change chip metrics once loaded
    document.fonts?.ready?.then(() => {
      layoutChips();
      if (!state.running) draw(state.time);
    });

    syncRunning();
  };

  // =========================================================================
  // 2. Clipboard helper + copy buttons
  // =========================================================================
  const copyTextSync = (text) => {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.className = "clipboard-proxy";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  };

  const copyText = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to the legacy path
    }
    return copyTextSync(text);
  };

  const flashCopied = (button) => {
    const labelEl = button.querySelector("span") || button;
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = labelEl.textContent || "";
    }
    labelEl.textContent = button.dataset.copiedLabel || "Copied ✓";
    button.setAttribute("data-copied", "true");
    window.clearTimeout(Number(button.dataset.copyTimer || 0));
    button.dataset.copyTimer = String(
      window.setTimeout(() => {
        labelEl.textContent = button.dataset.originalLabel || "";
        button.removeAttribute("data-copied");
      }, 2000)
    );
  };

  const initCopyButtons = () => {
    document.querySelectorAll("[data-copy-target]").forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      button.addEventListener("click", async () => {
        const target = document.getElementById(button.dataset.copyTarget || "");
        if (!target) return;
        const ok = await copyText(target.textContent || "");
        if (ok) {
          flashCopied(button);
        } else {
          // Last resort: select the text so the visitor can copy it manually
          const range = document.createRange();
          range.selectNodeContents(target);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });
    });
  };

  // =========================================================================
  // 3. Launcher: wish chips make the start prompt concrete, deeplinks follow
  // =========================================================================
  const initLaunchers = () => {
    document.querySelectorAll("[data-launcher]").forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      const head = root.dataset.promptHead || "";
      const defaultTail = root.dataset.defaultTail || "";
      const chips = Array.from(root.querySelectorAll("[data-wish-tail]"));
      const links = Array.from(root.querySelectorAll("[data-ai-link]"));
      const preview = root.querySelector("[data-prompt-preview]");
      const copyBtn = root.querySelector("[data-copy-prompt]");
      const connectStatus = root.querySelector("[data-connect-status]");

      // "Mit Claude/ChatGPT verbinden": copy the connector URL, then let the link open the
      // AI's connector settings in a new tab. No site can install a custom connector via URL,
      // so this is the honest shortest path (copy + open + paste).
      root.querySelectorAll("[data-connect]").forEach((link) => {
        link.addEventListener("click", () => {
          const url = link.getAttribute("data-connect-url") || "";
          if (!url) return;
          // Synchronous copy first: it completes before the new tab takes focus.
          let ok = copyTextSync(url);
          try {
            if (navigator.clipboard && window.isSecureContext) {
              navigator.clipboard.writeText(url).catch(() => {});
              ok = true;
            }
          } catch {
            // keep the synchronous result
          }
          if (connectStatus) {
            connectStatus.textContent =
              (ok ? link.getAttribute("data-connect-hint") : link.getAttribute("data-connect-failed")) || "";
            connectStatus.setAttribute("data-state", ok ? "copied" : "failed");
          }
        });
      });

      const currentPrompt = () => {
        const active = chips.find((chip) => chip.getAttribute("aria-pressed") === "true");
        const tail = (active && active.getAttribute("data-wish-tail")) || defaultTail;
        return `${head} ${tail}`.trim();
      };

      const sync = () => {
        const prompt = currentPrompt();
        // Same strict RFC 3986 encoding as the server-rendered links
        const encoded = encodeURIComponent(prompt).replace(
          /[!'()*]/g,
          (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase()
        );
        links.forEach((link) => {
          const base = link.getAttribute("data-ai-base");
          if (base) link.setAttribute("href", base + encoded);
        });
        if (preview) preview.textContent = prompt;
      };

      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          const wasActive = chip.getAttribute("aria-pressed") === "true";
          chips.forEach((other) => other.setAttribute("aria-pressed", "false"));
          chip.setAttribute("aria-pressed", String(!wasActive));
          sync();
        });
      });

      if (copyBtn instanceof HTMLButtonElement) {
        copyBtn.addEventListener("click", async () => {
          const ok = await copyText(currentPrompt());
          if (ok) {
            flashCopied(copyBtn);
          } else {
            const peek = root.querySelector(".prompt-peek");
            if (peek instanceof HTMLDetailsElement) peek.open = true;
          }
        });
      }
    });
  };

  // =========================================================================
  // 4. Accessible tabs (developer section)
  // =========================================================================
  const initTabs = () => {
    const tablists = document.querySelectorAll('[role="tablist"]');
    tablists.forEach((tablist) => {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]')).filter(
        (el) => el instanceof HTMLButtonElement
      );
      if (!tabs.length) return;
      const root = tablist.closest("[data-tabs-root]") || tablist.parentElement;
      if (!root) return;
      const panels = Array.from(root.querySelectorAll('[role="tabpanel"]')).filter(
        (el) => el instanceof HTMLElement
      );

      const activate = (selectedTab, shouldFocus) => {
        tabs.forEach((tab) => {
          const isSelected = tab === selectedTab;
          tab.setAttribute("aria-selected", String(isSelected));
          tab.tabIndex = isSelected ? 0 : -1;
        });

        panels.forEach((panel) => {
          const match = panel.getAttribute("aria-labelledby") === selectedTab.id;
          if (match) {
            panel.removeAttribute("hidden");
          } else {
            panel.setAttribute("hidden", "until-found");
          }
        });

        if (shouldFocus) {
          selectedTab.focus();
        }
        if (typeof selectedTab.scrollIntoView === "function") {
          selectedTab.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      };

      tabs.forEach((tab, idx) => {
        tab.addEventListener("click", () => activate(tab, false));
        tab.addEventListener("keydown", (ev) => {
          let nextIdx = -1;
          if (ev.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
          else if (ev.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
          else if (ev.key === "Home") nextIdx = 0;
          else if (ev.key === "End") nextIdx = tabs.length - 1;
          if (nextIdx >= 0) {
            ev.preventDefault();
            activate(tabs[nextIdx], true);
          }
        });
      });

      // Sync tab selection if browser find-in-page reveals a hidden="until-found" panel
      panels.forEach((panel) => {
        panel.addEventListener("beforematch", () => {
          const labelId = panel.getAttribute("aria-labelledby");
          const matchingTab = tabs.find((t) => t.id === labelId);
          if (matchingTab) activate(matchingTab, false);
        });
      });
    });
  };

  // =========================================================================
  // 5. Demo showcase: video aspect toggle + consumer live-shopping simulation
  // =========================================================================
  const initDemoShowcase = () => {
    const shell = document.getElementById("demo-shell");
    if (!shell) return;

    // 5a. External video: 16:9 / 9:16 toggle
    const aspectBtns = Array.from(shell.querySelectorAll("[data-set-aspect]"));
    aspectBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const aspect = btn.getAttribute("data-set-aspect") || "16:9";
        shell.setAttribute("data-aspect", aspect);
        aspectBtns.forEach((other) => other.setAttribute("aria-pressed", String(other === btn)));
      });
    });

    // 5b. Simulation
    const player = document.getElementById("sim-player");
    if (!player) return;

    let scenarios = [];
    try {
      const parsed = JSON.parse(player.dataset.sim || "[]");
      if (Array.isArray(parsed)) scenarios = parsed;
    } catch {
      scenarios = [];
    }
    if (!scenarios.length) return;

    const userEl = document.getElementById("sim-user");
    const stepsEl = document.getElementById("sim-steps");
    const answerEl = document.getElementById("sim-answer");
    const cartEl = document.getElementById("sim-cart");
    const itemsEl = document.getElementById("sim-items");
    const totalEl = document.getElementById("sim-total");
    const linkEl = document.getElementById("sim-link");
    const linkLabelEl = document.getElementById("sim-link-label");
    const shopEl = document.getElementById("sim-shop");
    const playBtn = document.getElementById("sim-play-btn");
    const replayBtn = document.getElementById("sim-replay-btn");
    const phaseBtns = Array.from(shell.querySelectorAll("[data-sim-phase]"));
    const scenarioBtns = Array.from(shell.querySelectorAll("[data-sim-scenario]"));
    if (!userEl || !stepsEl || !answerEl || !cartEl || !itemsEl || !totalEl || !linkEl) return;

    const PHASE_MS = [2800, 3200, 3000, 4600];

    const sim = {
      scenario: 0,
      phase: 3,
      elapsed: PHASE_MS[3],
      playing: false,
      visible: false,
      last: 0,
      raf: 0,
      renderedScenario: -1
    };

    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const buildScenario = (idx) => {
      const sc = scenarios[idx];
      stepsEl.replaceChildren(
        ...sc.steps.map((step) => {
          const li = el("li", "sim-step");
          li.setAttribute("data-state", "pending");
          const icon = el("span", "sim-step-icon");
          icon.setAttribute("aria-hidden", "true");
          li.append(icon, el("span", "sim-step-label", step.label), el("span", "sim-step-meta", step.meta));
          return li;
        })
      );
      itemsEl.replaceChildren(
        ...sc.items.map((item) => {
          const li = el("li", "sim-cart-item");
          li.setAttribute("data-show", "false");
          const info = el("span", "sim-cart-info");
          info.append(el("span", "sim-cart-name", item.name), el("span", "sim-cart-meta", item.variant));
          li.append(el("span", "sim-cart-qty", item.qty), info, el("span", "sim-cart-price", item.price));
          return li;
        })
      );
      answerEl.textContent = sc.answer;
      totalEl.textContent = sc.total;
      if (shopEl) shopEl.textContent = sc.shop;
      if (linkLabelEl) linkLabelEl.textContent = sc.cta;
      // Only allow https cart links that came from the server-rendered data
      if (typeof sc.cartUrl === "string" && sc.cartUrl.startsWith("https://")) {
        linkEl.setAttribute("href", sc.cartUrl);
      }
      scenarioBtns.forEach((btn) =>
        btn.setAttribute("aria-pressed", String(Number(btn.getAttribute("data-sim-scenario")) === idx))
      );
      sim.renderedScenario = idx;
    };

    const setAttr = (node, name, value) => {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    };

    const render = () => {
      if (sim.renderedScenario !== sim.scenario) buildScenario(sim.scenario);
      const sc = scenarios[sim.scenario];
      const phase = sim.phase;
      const progress = clamp01(sim.elapsed / PHASE_MS[phase]);

      setAttr(player, "data-phase", String(phase));

      // User wish types in during phase 0
      const typed =
        phase === 0 ? sc.user.slice(0, Math.ceil(sc.user.length * clamp01(progress / 0.72))) : sc.user;
      if (userEl.textContent !== typed) userEl.textContent = typed;
      setAttr(userEl, "data-typing", String(phase === 0 && progress < 0.72));

      // Steps
      const stepNodes = stepsEl.children;
      const stepState = (i) => {
        if (phase === 0) return "pending";
        if (phase === 1) {
          if (i === 0) return progress < 0.45 ? "active" : "done";
          if (i === 1) return progress < 0.45 ? "pending" : "active";
          return "pending";
        }
        if (phase === 2) {
          if (i < 2) return "done";
          if (i === 2) return progress < 0.62 ? "active" : "done";
          return "pending";
        }
        if (i < 3) return "done";
        return progress < 0.3 ? "active" : "done";
      };
      for (let i = 0; i < stepNodes.length; i++) {
        setAttr(stepNodes[i], "data-state", stepState(i));
      }

      // Cart items appear one by one while the AI checks size & price
      const itemNodes = itemsEl.children;
      let shown = 0;
      for (let i = 0; i < itemNodes.length; i++) {
        const show = phase > 2 || (phase === 2 && progress > 0.22 + i * 0.26);
        if (show) shown++;
        setAttr(itemNodes[i], "data-show", String(show));
      }
      setAttr(cartEl, "data-count", String(shown));

      const ready = phase === 3 && progress >= 0.3;
      setAttr(cartEl, "data-ready", String(ready));
      setAttr(linkEl, "aria-disabled", String(!ready));
      if (ready) linkEl.removeAttribute("tabindex");
      else linkEl.setAttribute("tabindex", "-1");
      setAttr(answerEl, "data-show", String(phase === 3 && progress >= 0.42));

      // Timeline
      phaseBtns.forEach((btn) => {
        const idx = Number(btn.getAttribute("data-sim-phase"));
        setAttr(btn, "data-active", String(idx === phase));
        setAttr(btn, "data-filled", String(idx < phase));
        const fill = btn.querySelector(".sim-seg-fill");
        if (fill instanceof HTMLElement) {
          const value = idx < phase ? 1 : idx === phase ? progress : 0;
          fill.style.transform = `scaleX(${value.toFixed(3)})`;
        }
      });
    };

    const syncPlayButton = () => {
      if (!playBtn) return;
      playBtn.textContent = sim.playing
        ? `❚❚ ${playBtn.dataset.pauseLabel || "Pause"}`
        : `▶ ${playBtn.dataset.playLabel || "Play"}`;
      playBtn.setAttribute("aria-pressed", String(!sim.playing));
    };

    const tick = (now) => {
      if (!sim.playing || !sim.visible || document.hidden) {
        sim.raf = 0;
        return;
      }
      const dt = Math.min(100, Math.max(0, now - sim.last));
      sim.last = now;
      sim.elapsed += dt;
      if (sim.elapsed >= PHASE_MS[sim.phase]) {
        if (sim.phase < 3) {
          sim.phase += 1;
          sim.elapsed = 0;
        } else {
          sim.scenario = (sim.scenario + 1) % scenarios.length;
          sim.phase = 0;
          sim.elapsed = 0;
        }
      }
      render();
      sim.raf = window.requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (sim.playing && sim.visible && !document.hidden && !sim.raf) {
        sim.last = performance.now();
        sim.raf = window.requestAnimationFrame(tick);
      }
    };

    const play = () => {
      sim.playing = true;
      syncPlayButton();
      ensureLoop();
    };

    const pause = () => {
      sim.playing = false;
      syncPlayButton();
    };

    const jump = (scenario, phase, autoplay) => {
      sim.scenario = scenario;
      sim.phase = phase;
      sim.elapsed = 0;
      render();
      if (autoplay) play();
    };

    playBtn?.addEventListener("click", () => {
      if (sim.playing) {
        pause();
      } else {
        if (sim.phase === 3 && sim.elapsed >= PHASE_MS[3]) {
          jump(sim.scenario, 0, true);
        } else {
          play();
        }
      }
    });

    replayBtn?.addEventListener("click", () => jump(sim.scenario, 0, true));

    phaseBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-sim-phase")) || 0;
        jump(sim.scenario, idx, !reducedMotionQuery.matches);
        if (reducedMotionQuery.matches) {
          sim.elapsed = PHASE_MS[idx];
          render();
        }
      });
    });

    scenarioBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-sim-scenario")) || 0;
        if (reducedMotionQuery.matches) {
          sim.scenario = idx;
          sim.phase = 3;
          sim.elapsed = PHASE_MS[3];
          render();
        } else {
          jump(idx, 0, true);
        }
      });
    });

    document.addEventListener("visibilitychange", ensureLoop);

    if ("IntersectionObserver" in window) {
      let started = false;
      new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            sim.visible = entry.isIntersecting;
          });
          if (sim.visible && !started && !reducedMotionQuery.matches) {
            // First time in view: start the story from the beginning
            started = true;
            jump(0, 0, true);
          } else {
            ensureLoop();
          }
        },
        { threshold: 0.3 }
      ).observe(player);
    } else {
      sim.visible = true;
      if (!reducedMotionQuery.matches) jump(0, 0, true);
    }

    // Initial state: finished cart (also the no-JS / reduced-motion presentation)
    buildScenario(0);
    render();
    syncPlayButton();
  };

  initHeroFlow();
  initCopyButtons();
  initLaunchers();
  initTabs();
  initDemoShowcase();
})();
