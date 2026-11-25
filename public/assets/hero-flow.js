(() => {
  "use strict";

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  // =========================================================================
  // 1. OVHcloud-Style 3D Curved Code-Flow Ribbon Canvas (60fps, zero deps)
  // =========================================================================
  const initHeroFlow = () => {
    const canvas = document.getElementById("hero-flow-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const motionBtn = document.getElementById("hero-motion-btn");
    const heroFrame = canvas.closest(".hero-frame") || canvas.parentElement;

    const SNIPPETS = [
      'search_products("merino socks")',
      'get_product("rolltop-2-0")',
      "create_cart_link(37548706496709:2)",
      "302 -> /cart?storefront=true",
      "OAuth 2.1 PKCE S256",
      "EUR 25.49 · in_stock: true",
      'inspect_store("allbirds.eu")',
      "POST /mcp · 200 OK",
      "ssrf_guard: dns_pinned",
      "readOnlyHint: true",
      "CIMD · DCR · RFC 9728",
      "minor_units: 2549 -> EUR"
    ];

    // Pre-build 18 dense parallel tracks with readable MCP tokens along the curved 3D ribbon
    const TRACK_COUNT = 18;
    const tracks = [];
    for (let i = 0; i < TRACK_COUNT; i++) {
      const v = (i / (TRACK_COUNT - 1)) * 2 - 1; // -1 .. +1 across ribbon width
      const tokens = [];
      for (let k = 0; k < 6; k++) {
        tokens.push(SNIPPETS[(i * 2 + k) % SNIPPETS.length]);
      }
      tracks.push({
        v,
        tokens,
        speed: 0.032 + (i % 5) * 0.0055,
        phase: (i * 0.137) % 1
      });
    }

    // Floating luminous particles along the ribbon
    const particles = Array.from({ length: 42 }, (_, idx) => ({
      u: (idx / 42) * 1.15 - 0.05,
      v: Math.sin(idx * 2.13) * 1.18,
      speed: 0.018 + (idx % 6) * 0.004,
      size: 1.15 + (idx % 3) * 0.65,
      hueBias: idx % 3
    }));

    let width = 1200;
    let height = 520;
    let dpr = 1;
    let rafId = 0;
    let isVisible = true;
    let isPaused = reducedMotionQuery.matches;
    let simTime = 14.2; // Rich initial wave pose for static reduced-motion frame
    let lastTs = 0;

    const updateMotionButton = () => {
      if (!(motionBtn instanceof HTMLButtonElement)) return;
      const pauseLabel = motionBtn.dataset.pauseLabel || "Pause";
      const playLabel = motionBtn.dataset.playLabel || "Play";
      motionBtn.textContent = isPaused ? `▶ ${playLabel}` : `❚❚ ${pauseLabel}`;
      motionBtn.setAttribute("aria-label", isPaused ? playLabel : pauseLabel);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };

    // 3D parametric ribbon surface: sweeping diagonally across the right & center-back like OVHcloud
    const projectPoint = (u, v, t) => {
      const mobile = width < 720;
      const spanX = mobile ? width * 1.24 : width * 1.12;
      const startX = mobile ? -width * 0.1 : width * 0.14;

      const xWorld = startX + u * spanX - width * 0.5;
      // Sweeps gracefully from upper-mid through center-right into an upward-curving violet flare on the right
      const spineY =
        Math.sin(u * Math.PI * 1.45 - 0.85 + t * 0.3) * (height * 0.25) -
        (u - 0.55) * (height * 0.18) +
        Math.cos(u * 3.6 - t * 0.42) * (height * 0.045);
      const spineZ =
        Math.cos(u * Math.PI * 1.35 - 0.4 + t * 0.26) * 135 +
        Math.sin(u * 2.8 + t * 0.22) * 40;

      // Ribbon flares boldly across the right half
      const halfWidth = (mobile ? 115 : 195) * (0.76 + 0.42 * Math.sin(u * Math.PI * 0.9 + 0.15));

      const twist = 0.38 + u * 1.18 + Math.sin(u * 2.1 - t * 0.32) * 0.28;
      const lateralY = Math.cos(twist) * v * halfWidth;
      const lateralZ = Math.sin(twist) * v * halfWidth;

      const yWorld = spineY + lateralY;
      const zWorld = spineZ + lateralZ;

      const fov = 580;
      const camZ = 440;
      const depth = Math.max(120, camZ + zWorld);
      const scale = fov / depth;

      const sx = width * (mobile ? 0.52 : 0.62) + xWorld * scale;
      const sy = height * (mobile ? 0.56 : 0.48) + yWorld * scale;
      return { sx, sy, scale, z: zWorld };
    };

    const colorForRibbon = (u, v, z, alpha) => {
      // wals.pro Dark-Mode Spectrum: Silver-Ash (#a7adb4) -> Rose (#ff6b7a) -> Brand Red (#ff1f4d) -> Warm Coral (#ff8a5b)
      let r;
      let g;
      let b;
      if (u < 0.36) {
        const k = Math.max(0, Math.min(1, u / 0.36));
        r = Math.round(167 + (255 - 167) * k);
        g = Math.round(173 + (107 - 173) * k);
        b = Math.round(180 + (122 - 180) * k);
      } else if (u < 0.72) {
        const k = (u - 0.36) / 0.36;
        r = 255;
        g = Math.round(107 + (31 - 107) * k);
        b = Math.round(122 + (77 - 122) * k);
      } else {
        const k = Math.max(0, Math.min(1, (u - 0.72) / 0.32));
        r = 255;
        g = Math.round(31 + (138 - 31) * k);
        b = Math.round(77 + (91 - 77) * k);
      }

      // Fine silver-white code highlights on foreground wave crests (#e0e0e0)
      const crest = Math.max(0, 1 - Math.abs(z + 40) / 145) * (1 - Math.abs(v) * 0.4);
      r = Math.min(242, Math.round(r + crest * 45));
      g = Math.min(234, Math.round(g + crest * 110));
      b = Math.min(236, Math.round(b + crest * 115));

      return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    };

    const drawFrame = (t) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // A. Luminous wals.pro Red & Warm Coral ambient ribbon aura behind the code mesh
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const bandOffsets = [-0.72, -0.22, 0.25, 0.72];
      for (let bIdx = 0; bIdx < bandOffsets.length; bIdx++) {
        const vOff = bandOffsets[bIdx];
        ctx.beginPath();
        for (let s = 0; s <= 36; s++) {
          const u = -0.08 + (s / 36) * 1.18;
          const pt = projectPoint(u, vOff, t);
          if (s === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        }
        const grad = ctx.createLinearGradient(width * 0.18, height * 0.1, width, height * 0.85);
        grad.addColorStop(0, "rgba(167, 173, 180, 0.04)");
        grad.addColorStop(0.38, "rgba(255, 107, 122, 0.16)");
        grad.addColorStop(0.7, "rgba(255, 31, 77, 0.24)");
        grad.addColorStop(1, "rgba(255, 138, 91, 0.22)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = bIdx === 1 || bIdx === 2 ? 78 : 46;
        ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.restore();

      // B. Render the 3D flowing readable monospace MCP code tracks
      const slots = width < 720 ? 5 : 7;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      for (let ti = 0; ti < tracks.length; ti++) {
        const track = tracks[ti];
        const edgeFade = 1 - Math.pow(Math.abs(track.v), 2.2) * 0.52;
        const scroll = (t * track.speed + track.phase) % 1;

        for (let si = 0; si < slots; si++) {
          const baseU = (si / slots + scroll) % 1;
          const u = baseU * 1.24 - 0.1;
          if (u < -0.06 || u > 1.12) continue;

          const p0 = projectPoint(u, track.v, t);
          if (p0.sx < -160 || p0.sx > width + 160 || p0.sy < -60 || p0.sy > height + 60) {
            continue;
          }
          const p1 = projectPoint(u + 0.025, track.v, t);
          const angle = Math.atan2(p1.sy - p0.sy, p1.sx - p0.sx);

          const uFade =
            Math.min(1, Math.max(0, (u + 0.05) / 0.16)) *
            Math.min(1, Math.max(0, (1.1 - u) / 0.16));
          const depthAlpha = Math.max(0.16, Math.min(0.96, (p0.scale - 0.58) * 1.15));
          const alpha = depthAlpha * edgeFade * uFade;
          if (alpha < 0.06) continue;

          const token = track.tokens[si % track.tokens.length];
          const fontSize = Math.max(8.5, Math.min(14.5, 10.6 * p0.scale));

          ctx.save();
          ctx.translate(p0.sx, p0.sy);
          ctx.rotate(angle);
          ctx.font = `600 ${fontSize.toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.fillStyle = colorForRibbon(u, track.v, p0.z, alpha);
          ctx.fillText(token, 0, 0);
          ctx.restore();
        }
      }

      // C. Luminous energy sparks drifting across the ribbon (wals.pro Red / Coral / Silver)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const u = ((p.u + t * p.speed) % 1.15) - 0.05;
        const pt = projectPoint(u, p.v, t);
        const r = Math.max(1, p.size * pt.scale);
        ctx.beginPath();
        ctx.arc(pt.sx, pt.sy, r, 0, Math.PI * 2);
        ctx.fillStyle =
          p.hueBias === 0
            ? "rgba(255, 31, 77, 0.6)"
            : p.hueBias === 1
              ? "rgba(255, 138, 91, 0.5)"
              : "rgba(224, 224, 224, 0.55)";
        ctx.fill();
      }
      ctx.restore();
    };

    const tick = (ts) => {
      if (isPaused || !isVisible || document.hidden) {
        rafId = 0;
        lastTs = 0;
        return;
      }
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      simTime += dt;
      drawFrame(simTime);
      rafId = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (!isPaused && isVisible && !document.hidden && !rafId) {
        lastTs = 0;
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const stop = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    resize();
    drawFrame(simTime);
    updateMotionButton();
    start();

    if (typeof ResizeObserver !== "undefined" && heroFrame) {
      const ro = new ResizeObserver(() => {
        resize();
        drawFrame(simTime);
      });
      ro.observe(heroFrame);
    } else {
      window.addEventListener("resize", () => {
        resize();
        drawFrame(simTime);
      });
    }

    if (typeof IntersectionObserver !== "undefined" && heroFrame) {
      const io = new IntersectionObserver(
        (entries) => {
          isVisible = entries.some((e) => e.isIntersecting);
          if (isVisible) start();
          else stop();
        },
        { threshold: 0.02 }
      );
      io.observe(heroFrame);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    motionBtn?.addEventListener("click", () => {
      isPaused = !isPaused;
      updateMotionButton();
      if (isPaused) {
        stop();
      } else {
        start();
      }
    });

    reducedMotionQuery.addEventListener?.("change", (ev) => {
      isPaused = ev.matches;
      updateMotionButton();
      if (isPaused) {
        stop();
        drawFrame(simTime);
      } else {
        start();
      }
    });
  };

  // =========================================================================
  // 2. Copy-to-Clipboard (Hero MCP URL + Code Snippets)
  // =========================================================================
  const initCopyButtons = () => {
    const copyText = async (text) => {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    };

    document.querySelectorAll("[data-copy-target]").forEach((btn) => {
      if (!(btn instanceof HTMLButtonElement)) return;
      btn.addEventListener("click", async () => {
        const targetId = btn.dataset.copyTarget;
        const targetEl = targetId ? document.getElementById(targetId) : null;
        const text = targetEl?.textContent?.trim();
        if (!text) return;
        const copiedLabel = btn.dataset.copiedLabel || "Copied ✓";
        const promptLabel = btn.dataset.promptLabel || "Copy:";
        const original = btn.dataset.originalLabel || btn.textContent || "";
        btn.dataset.originalLabel = original;
        try {
          const ok = await copyText(text);
          if (!ok) throw new Error("no clipboard");
          btn.textContent = copiedLabel;
          window.setTimeout(() => {
            btn.textContent = original;
          }, 1800);
        } catch {
          window.prompt(promptLabel, text);
        }
      });
    });
  };

  // =========================================================================
  // 3. Accessible Client Setup Tabs (Roving Tabindex + hidden="until-found")
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

        selectedTab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        if (shouldFocus) {
          selectedTab.focus();
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
  // 4. Demo Showcase: 16:9 / 9:16 Toggle + Interactive Live Simulation Player
  // =========================================================================
  const initDemoShowcase = () => {
    const shell = document.getElementById("demo-shell");
    if (!shell) return;

    // 16:9 Desktop / 9:16 Reel Toggle
    const aspectButtons = Array.from(shell.querySelectorAll("[data-set-aspect]")).filter(
      (el) => el instanceof HTMLButtonElement
    );
    aspectButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const aspect = btn.dataset.setAspect || "16:9";
        shell.setAttribute("data-aspect", aspect);
        aspectButtons.forEach((b) => {
          b.setAttribute("aria-pressed", String(b === btn));
        });
      });
    });

    // Interactive Live Simulation (active when no external video URL is configured)
    const simRoot = document.getElementById("sim-player");
    if (!simRoot) return;

    const steps = Array.from(simRoot.querySelectorAll(".sim-step"));
    const segButtons = Array.from(shell.querySelectorAll("[data-sim-step]")).filter(
      (el) => el instanceof HTMLButtonElement
    );
    const jsonEl = document.getElementById("sim-json-output");
    const latencyEl = document.getElementById("sim-latency");
    const cartCard = document.getElementById("sim-cart-card");
    const playBtn = document.getElementById("sim-play-btn");
    const replayBtn = document.getElementById("sim-replay-btn");

    const PAYLOADS = [
      {
        latency: "142 ms · 200 OK",
        json: JSON.stringify(
          {
            tool: "inspect_store",
            arguments: { store_url: "https://shop.allbirds.eu" },
            result: {
              platform: "shopify",
              currency: "EUR",
              country: "DE",
              waf_resilient: true,
              ssrf_check: "dns_pinned_public_ip"
            }
          },
          null,
          2
        )
      },
      {
        latency: "188 ms · 200 OK",
        json: JSON.stringify(
          {
            tool: "search_products",
            arguments: { query: "merino socks", max_price: 30, available_only: true },
            result: {
              matches: 4,
              top_match: {
                handle: "merino-crew-sock",
                title: "Merino Crew Sock",
                price: "25.49 EUR",
                in_stock: true
              }
            }
          },
          null,
          2
        )
      },
      {
        latency: "164 ms · 200 OK",
        json: JSON.stringify(
          {
            tool: "get_product",
            arguments: { handle: "merino-crew-sock" },
            result: {
              variant_id: "37548706496709",
              option: "Size M · Natural Black",
              price_minor: 2549,
              price_formatted: "25.49 EUR",
              available: true,
              sanitized: "html_and_hidden_unicode_stripped"
            }
          },
          null,
          2
        )
      },
      {
        latency: "95 ms · 302 Verified",
        json: JSON.stringify(
          {
            tool: "create_cart_link",
            arguments: { items: [{ variant_id: "37548706496709", quantity: 2 }] },
            result: {
              cart_url: "https://shop.allbirds.eu/cart/37548706496709:2?storefront=true",
              subtotal: "50.98 EUR",
              live_variant_verified: true,
              read_only: true
            }
          },
          null,
          2
        )
      }
    ];

    let currentStep = reducedMotionQuery.matches ? 3 : 0;
    let playing = !reducedMotionQuery.matches;
    let timer = 0;

    const renderStep = (idx) => {
      currentStep = Math.max(0, Math.min(PAYLOADS.length - 1, idx));
      steps.forEach((stepEl, i) => {
        if (i < currentStep) stepEl.setAttribute("data-state", "done");
        else if (i === currentStep) {
          stepEl.setAttribute("data-state", currentStep === PAYLOADS.length - 1 ? "done" : "active");
        } else {
          stepEl.setAttribute("data-state", "pending");
        }
      });

      segButtons.forEach((btn, i) => {
        btn.setAttribute("data-active", String(i === currentStep));
        btn.setAttribute("data-filled", String(i <= currentStep));
      });

      const payload = PAYLOADS[currentStep];
      if (jsonEl && payload) jsonEl.textContent = payload.json;
      if (latencyEl && payload) latencyEl.textContent = payload.latency;
      if (cartCard) {
        cartCard.setAttribute("data-ready", String(currentStep === PAYLOADS.length - 1));
      }
    };

    const updatePlayButton = () => {
      if (!(playBtn instanceof HTMLButtonElement)) return;
      const pauseLabel = playBtn.dataset.pauseLabel || "Pause";
      const playLabel = playBtn.dataset.playLabel || "Play";
      playBtn.textContent = playing ? `❚❚ ${pauseLabel}` : `▶ ${playLabel}`;
    };

    const scheduleNext = () => {
      window.clearTimeout(timer);
      if (!playing) return;
      const delay = currentStep === PAYLOADS.length - 1 ? 3600 : 1850;
      timer = window.setTimeout(() => {
        if (!playing) return;
        const next = (currentStep + 1) % PAYLOADS.length;
        renderStep(next);
        scheduleNext();
      }, delay);
    };

    playBtn?.addEventListener("click", () => {
      playing = !playing;
      updatePlayButton();
      if (playing) scheduleNext();
      else window.clearTimeout(timer);
    });

    replayBtn?.addEventListener("click", () => {
      renderStep(0);
      playing = true;
      updatePlayButton();
      scheduleNext();
    });

    segButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number.parseInt(btn.dataset.simStep || "0", 10);
        if (!Number.isNaN(idx)) {
          renderStep(idx);
          if (playing) scheduleNext();
        }
      });
    });

    renderStep(currentStep);
    updatePlayButton();
    if (playing) scheduleNext();
  };

  initHeroFlow();
  initCopyButtons();
  initTabs();
  initDemoShowcase();
})();
