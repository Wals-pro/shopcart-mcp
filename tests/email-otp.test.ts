import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { sha256Base64Url, sha256Hex } from "../src/auth/crypto.js";
import {
  EmailOtpService,
  MemoryEmailSender,
  OTP_TTL_MS,
  formatOtpForDisplay,
  renderOtpEmail
} from "../src/auth/email-otp.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory.js";

function extractCookies(setCookieHeader: unknown): string {
  if (!Array.isArray(setCookieHeader)) return "";
  return setCookieHeader.map((c) => String(c).split(";")[0]).join("; ");
}

function makeOtpTestApp(opts: {
  extraEnv?: Record<string, string>;
  nowRef?: { current: Date };
  withSender?: boolean;
} = {}) {
  const config = loadConfig({
    APP_ORIGIN: "https://shopcart.wals.pro",
    STORAGE_BACKEND: "memory",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    SMTP_SENDER_EMAIL: "support@notify.wals.pro",
    SMTP_SENDER_NAME: "ShopCart by wals.pro",
    PROMO_FREE_PRO_UNTIL: "2026-12-06T23:59:59+01:00",
    ...(opts.extraEnv ?? {})
  });
  const store = new MemoryStore();
  const emailSender = opts.withSender === false ? undefined : new MemoryEmailSender();
  const nowRef = opts.nowRef ?? { current: new Date("2026-11-25T22:00:00.000Z") };
  const otpService = new EmailOtpService({
    config,
    store,
    emailSender,
    now: () => nowRef.current
  });
  const app = createApp({ config, store, otpService });
  return { app, store, config, emailSender, otpService, nowRef };
}

async function startOAuthFlow(app: ReturnType<typeof createApp>, lang: "de" | "en" = "de") {
  const reg = await request(app)
    .post("/oauth/register")
    .send({
      client_name: "Claude Desktop",
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none"
    })
    .expect(201);

  const clientId = reg.body.client_id as string;
  const verifier = "verifier_abcdefghijklmnopqrstuvwxyz_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const challenge = sha256Base64Url(verifier);
  const redirectUri = "http://127.0.0.1:45678/callback";

  const authGet = await request(app)
    .get("/oauth/authorize")
    .query({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "https://shopcart.wals.pro/mcp",
      state: "state_xyz",
      lang
    })
    .expect(200);

  const csrf = authGet.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
  const cookies = extractCookies(authGet.headers["set-cookie"]);

  return { clientId, verifier, challenge, redirectUri, csrf, cookies, html: authGet.text };
}

describe("Passwordless Email OTP + Magic Link Authentication", () => {
  it("renders wals.pro dark-mode UI without password fields on /oauth/authorize and /billing/login", async () => {
    const { app } = makeOtpTestApp();
    const oauth = await startOAuthFlow(app, "de");

    expect(oauth.html).toContain("--walspro-bg:#141414");
    expect(oauth.html).toContain("--walspro-surface:#1a1a1a");
    expect(oauth.html).toContain("--walspro-accent:#ff1f4d");
    expect(oauth.html).toContain("--walspro-on-accent:#000000");
    expect(oauth.html).toContain('<meta name="color-scheme" content="dark">');
    expect(oauth.html).not.toContain('type="password"');
    expect(oauth.html).toContain("Code per E-Mail senden");

    const billing = await request(app).get("/billing/login?lang=en").expect(200);
    expect(billing.text).toContain("--walspro-accent:#ff1f4d");
    expect(billing.text).toContain("--walspro-on-accent:#000000");
    expect(billing.text).not.toContain('type="password"');
    expect(billing.text).toContain("Send sign-in code");
  });

  it("completes OAuth 6-digit OTP happy path, stores only HMAC hashes, and preserves canonical userId", async () => {
    const { app, store, emailSender } = makeOtpTestApp();
    const oauth = await startOAuthFlow(app, "de");

    const step1 = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", oauth.cookies)
      .type("form")
      .send({
        _csrf: oauth.csrf,
        step: "email",
        lang: "de",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "Markus@Example.com"
      })
      .expect(200);

    // Step 2 uses modern single-input OTP markup
    expect(step1.text).toContain('inputmode="numeric"');
    expect(step1.text).toContain('autocomplete="one-time-code"');
    expect(step1.text).not.toContain('type="number"');

    const challengeId = step1.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;
    const csrf2 = step1.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const cookies2 = extractCookies(step1.headers["set-cookie"]);

    const mail = emailSender!.lastFor("markus@example.com")!;
    expect(mail).toBeDefined();
    expect(mail.from).toBe('"ShopCart by wals.pro" <support@notify.wals.pro>');
    expect(mail.code).toMatch(/^\d{6}$/);

    // Security check: plaintext OTP & magic secret are NEVER stored in challenge record
    const stored = await store.getEmailAuthChallenge(challengeId);
    expect(stored).not.toBeNull();
    const storedJson = JSON.stringify(stored);
    expect(storedJson).not.toContain(mail.code);
    const rawMagicParam = new URL(mail.magicLink).searchParams.get("token")!;
    const rawMagicSecret = rawMagicParam.split(".")[1]!;
    expect(storedJson).not.toContain(rawMagicSecret);

    // Submit formatted 6-digit code ("482 917")
    const verifyRes = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", cookies2)
      .type("form")
      .send({
        _csrf: csrf2,
        step: "verify",
        challenge_id: challengeId,
        lang: "de",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "markus@example.com",
        code: formatOtpForDisplay(mail.code)
      })
      .expect(303);

    const loc = new URL(verifyRes.headers.location!);
    expect(loc.searchParams.get("code")).toMatch(/^sc_code_/);
    expect(loc.searchParams.get("state")).toBe("state_xyz");
    expect(loc.searchParams.get("iss")).toBe("https://shopcart.wals.pro");

    // Canonical userId matches sha256Hex(normalizedEmail)
    const user = await store.getUserByEmail("markus@example.com");
    expect(user).not.toBeNull();
    expect(user!.id).toBe(sha256Hex("markus@example.com"));

    // Single-use replay: trying the Magic Link from the SAME challenge must fail (410)
    const replayMagic = await request(app)
      .get(`/auth/magic?token=${encodeURIComponent(rawMagicParam)}`)
      .set("Cookie", cookies2)
      .expect(410);
    expect(replayMagic.text).toContain('data-state="used"');
  });

  it("completes OAuth Magic Link happy path in same browser, protects HEAD prefetchers, and handles cross-browser safely", async () => {
    const { app, emailSender } = makeOtpTestApp();
    const oauth = await startOAuthFlow(app, "en");

    const step1 = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", oauth.cookies)
      .type("form")
      .send({
        _csrf: oauth.csrf,
        step: "email",
        lang: "en",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "desktop@example.com"
      })
      .expect(200);

    const cookiesWithBind = extractCookies(step1.headers["set-cookie"]);
    const mail = emailSender!.lastFor("desktop@example.com")!;
    const magicUrl = new URL(mail.magicLink);
    const magicPath = `${magicUrl.pathname}${magicUrl.search}`;

    // 1. HEAD prefetcher (e.g. email scanner) must NOT consume the token
    await request(app).head(magicPath).expect(200);

    // 2. Cross-browser click (NO sc_otp_bind cookie) shows friendly 6-digit hint & does NOT consume challenge
    const otherBrowser = await request(app).get(magicPath).expect(200);
    expect(otherBrowser.text).toContain('data-state="browser_mismatch"');
    expect(otherBrowser.text).toContain("6-digit code");

    // 3. Same-browser click (WITH sc_otp_bind cookie) completes OAuth in 1 click!
    const sameBrowser = await request(app)
      .get(magicPath)
      .set("Cookie", cookiesWithBind)
      .expect(303);

    const loc = new URL(sameBrowser.headers.location!);
    expect(loc.origin + loc.pathname).toBe(oauth.redirectUri);
    expect(loc.searchParams.get("code")).toMatch(/^sc_code_/);
    expect(loc.searchParams.get("iss")).toBe("https://shopcart.wals.pro");

    // 4. Replay of the Magic Link fails (410 used)
    await request(app).get(magicPath).set("Cookie", cookiesWithBind).expect(410);
  });

  it("completes /billing/login via both 6-digit OTP and 1-click Magic Link", async () => {
    const { app, emailSender, store } = makeOtpTestApp();

    // Flow A: /billing/login -> 6-digit OTP -> /billing
    const loginGet = await request(app).get("/billing/login?lang=de").expect(200);
    const csrf1 = loginGet.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const cookies1 = extractCookies(loginGet.headers["set-cookie"]);

    const loginPost = await request(app)
      .post("/billing/login")
      .set("Cookie", cookies1)
      .type("form")
      .send({ _csrf: csrf1, lang: "de", email: "billing-otp@example.com" })
      .expect(200);

    const challengeId = loginPost.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;
    const csrf2 = loginPost.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const cookies2 = extractCookies(loginPost.headers["set-cookie"]);
    const otpMail = emailSender!.lastFor("billing-otp@example.com")!;

    const verifyPost = await request(app)
      .post("/billing/verify")
      .set("Cookie", cookies2)
      .type("form")
      .send({
        _csrf: csrf2,
        lang: "de",
        challenge_id: challengeId,
        email: "billing-otp@example.com",
        code: otpMail.code
      })
      .expect(303);

    expect(verifyPost.headers.location).toBe("/billing?lang=de");
    const sessionCookie = extractCookies(verifyPost.headers["set-cookie"]);
    const dashboard = await request(app).get("/billing?lang=de").set("Cookie", sessionCookie).expect(200);
    expect(dashboard.text).toContain("billing-otp@example.com");
    expect(dashboard.text).toContain("Pro (Gratis-Promo)");

    // Flow B: /billing/login -> 1-click Magic Link (even without browser bind cookie!)
    const login2 = await request(app).get("/billing/login?lang=en").expect(200);
    const csrfB = login2.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const cookiesB = extractCookies(login2.headers["set-cookie"]);

    await request(app)
      .post("/billing/login")
      .set("Cookie", cookiesB)
      .type("form")
      .send({ _csrf: csrfB, lang: "en", email: "billing-magic@example.com" })
      .expect(200);

    const magicMail = emailSender!.lastFor("billing-magic@example.com")!;
    const magicUrl = new URL(magicMail.magicLink);
    const magicRes = await request(app)
      .get(`${magicUrl.pathname}${magicUrl.search}`)
      .expect(303);

    expect(magicRes.headers.location).toBe("/billing?lang=en");
    const magicSession = extractCookies(magicRes.headers["set-cookie"]);
    const dash2 = await request(app).get("/billing?lang=en").set("Cookie", magicSession).expect(200);
    expect(dash2.text).toContain("billing-magic@example.com");

    const user = await store.getUserByEmail("billing-magic@example.com");
    expect(user?.id).toBe(sha256Hex("billing-magic@example.com"));
  });

  it("locks challenge after 5 failed OTP attempts so even the correct code and magic link fail", async () => {
    const { otpService, emailSender } = makeOtpTestApp();

    const req = await otpService.requestChallenge({
      email: "lockout@example.com",
      ip: "203.0.113.10",
      purpose: "billing",
      lang: "en",
      oauthParams: null
    });
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    const mail = emailSender!.lastFor("lockout@example.com")!;
    const wrongCode = mail.code === "000000" ? "999999" : "000000";

    for (let i = 1; i <= 4; i++) {
      const res = await otpService.verifyOtp({ challengeId: req.challengeId, code: wrongCode });
      expect(res).toEqual({ status: "invalid_code", remainingAttempts: 5 - i });
    }

    // 5th failed attempt triggers lockout
    const fifth = await otpService.verifyOtp({ challengeId: req.challengeId, code: wrongCode });
    expect(fifth).toEqual({ status: "locked" });

    // 6th attempt with the CORRECT code must remain locked!
    const withCorrect = await otpService.verifyOtp({ challengeId: req.challengeId, code: mail.code });
    expect(withCorrect).toEqual({ status: "locked" });

    // Magic link for the locked challenge is also locked!
    const rawToken = new URL(mail.magicLink).searchParams.get("token")!;
    const withMagic = await otpService.verifyMagicLink({ rawToken });
    expect(withMagic).toEqual({ status: "locked" });
  });

  it("enforces single-use replay protection on OTP", async () => {
    const { otpService, emailSender } = makeOtpTestApp();
    const req = await otpService.requestChallenge({
      email: "replay@example.com",
      ip: "203.0.113.11",
      purpose: "billing",
      lang: "en",
      oauthParams: null
    });
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    const mail = emailSender!.lastFor("replay@example.com")!;
    const first = await otpService.verifyOtp({ challengeId: req.challengeId, code: mail.code });
    expect(first.status).toBe("ok");

    const second = await otpService.verifyOtp({ challengeId: req.challengeId, code: mail.code });
    expect(second).toEqual({ status: "used" });
  });

  it("expires both OTP and Magic Link after 10 minutes TTL", async () => {
    const nowRef = { current: new Date("2026-11-25T22:00:00.000Z") };
    const { otpService, emailSender } = makeOtpTestApp({ nowRef });

    const req = await otpService.requestChallenge({
      email: "expiry@example.com",
      ip: "203.0.113.12",
      purpose: "billing",
      lang: "de",
      oauthParams: null
    });
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    const mail = emailSender!.lastFor("expiry@example.com")!;
    const rawToken = new URL(mail.magicLink).searchParams.get("token")!;

    // Advance clock past 10 minutes
    nowRef.current = new Date(nowRef.current.getTime() + OTP_TTL_MS + 1000);

    expect(await otpService.verifyOtp({ challengeId: req.challengeId, code: mail.code })).toEqual({
      status: "expired"
    });
    expect(await otpService.verifyMagicLink({ rawToken })).toEqual({
      status: "expired"
    });
  });

  it("enforces per-email (3/10min) and per-IP (15/10min) rate limits and resets after window", async () => {
    const nowRef = { current: new Date("2026-11-25T22:00:00.000Z") };
    const { otpService } = makeOtpTestApp({ nowRef });

    // Per-email limit: 3 allowed, 4th blocked
    for (let i = 0; i < 3; i++) {
      const r = await otpService.requestChallenge({
        email: "limited@example.com",
        ip: `203.0.113.${20 + i}`,
        purpose: "billing",
        lang: "en",
        oauthParams: null
      });
      expect(r.ok).toBe(true);
    }
    const fourth = await otpService.requestChallenge({
      email: "limited@example.com",
      ip: "203.0.113.99",
      purpose: "billing",
      lang: "en",
      oauthParams: null
    });
    expect(fourth).toEqual({ ok: false, error: "rate_limited" });

    // Per-IP limit: 15 allowed across different emails, 16th blocked
    for (let i = 0; i < 15; i++) {
      const r = await otpService.requestChallenge({
        email: `user${i}@example.com`,
        ip: "198.51.100.5",
        purpose: "billing",
        lang: "en",
        oauthParams: null
      });
      expect(r.ok).toBe(true);
    }
    const sixteenth = await otpService.requestChallenge({
      email: "user15@example.com",
      ip: "198.51.100.5",
      purpose: "billing",
      lang: "en",
      oauthParams: null
    });
    expect(sixteenth).toEqual({ ok: false, error: "rate_limited" });

    // Advance past 10-minute window -> allowed again
    nowRef.current = new Date(nowRef.current.getTime() + OTP_TTL_MS + 1000);
    const afterWindow = await otpService.requestChallenge({
      email: "limited@example.com",
      ip: "198.51.100.5",
      purpose: "billing",
      lang: "en",
      oauthParams: null
    });
    expect(afterWindow.ok).toBe(true);
  });

  it("renders DE and EN dark-mode emails with 6-digit code, Magic Link, wals.pro tokens, and HTML escaping", () => {
    const deMail = renderOtpEmail({
      to: "user@example.com",
      from: '"ShopCart by wals.pro" <support@notify.wals.pro>',
      code: "482917",
      magicLink: "https://shopcart.wals.pro/auth/magic?token=chal_abc.secret123",
      lang: "de",
      purpose: "oauth",
      clientName: 'Claude <script>"test"</script>'
    });

    expect(deMail.subject).toBe("Dein ShopCart Anmeldecode: 482 917");
    expect(deMail.html).toContain("#141414");
    expect(deMail.html).toContain("#1a1a1a");
    expect(deMail.html).toContain("#FF1F4D");
    expect(deMail.html).toContain("#000000");
    expect(deMail.html).toContain("482 917");
    expect(deMail.html).toContain("Mit 1 Klick anmelden");
    expect(deMail.html).toContain("https://shopcart.wals.pro/auth/magic?token=chal_abc.secret123");
    expect(deMail.html).not.toContain("<script>");
    expect(deMail.text).toContain("482 917");
    expect(deMail.text).toContain("https://shopcart.wals.pro/auth/magic?token=chal_abc.secret123");

    const enMail = renderOtpEmail({
      to: "user@example.com",
      from: '"ShopCart by wals.pro" <support@notify.wals.pro>',
      code: "007419",
      magicLink: "https://shopcart.wals.pro/auth/magic?token=chal_def.secret456",
      lang: "en",
      purpose: "billing"
    });

    expect(enMail.subject).toBe("Your ShopCart sign-in code: 007 419");
    expect(enMail.html).toContain("007 419");
    expect(enMail.html).toContain("Sign in with 1 click");
    expect(enMail.text).toContain("007 419");
    expect(enMail.text).toContain("Account & Billing");
  });

  it("supports env-gated REVIEWER_TEST_EMAIL + REVIEWER_TEST_CODE without sending SMTP mail and stays off by default", async () => {
    // 1. Disabled by default when env vars are unset
    const defaultSetup = makeOtpTestApp({ withSender: false });
    const noSmtp = await defaultSetup.otpService.requestChallenge({
      email: "reviewer@glama.ai",
      ip: "203.0.113.50",
      purpose: "oauth",
      lang: "en",
      oauthParams: null
    });
    expect(noSmtp).toEqual({ ok: false, error: "smtp_not_configured" });

    // 2. Enabled explicitly via REVIEWER_TEST_EMAIL + REVIEWER_TEST_CODE (even without SMTP!)
    const { app, emailSender } = makeOtpTestApp({
      withSender: false,
      extraEnv: {
        REVIEWER_TEST_EMAIL: "reviewer@glama.ai",
        REVIEWER_TEST_CODE: "482 917"
      }
    });
    expect(emailSender).toBeUndefined();

    const oauth = await startOAuthFlow(app, "en");
    const step1 = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", oauth.cookies)
      .type("form")
      .send({
        _csrf: oauth.csrf,
        step: "email",
        lang: "en",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "reviewer@glama.ai"
      })
      .expect(200);

    const challengeId = step1.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;
    const csrf2 = step1.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const cookies2 = extractCookies(step1.headers["set-cookie"]);

    // Wrong code fails even for reviewer account
    await request(app)
      .post("/oauth/authorize")
      .set("Cookie", cookies2)
      .type("form")
      .send({
        _csrf: csrf2,
        step: "verify",
        challenge_id: challengeId,
        lang: "en",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "reviewer@glama.ai",
        code: "111111"
      })
      .expect(401);

    // Need fresh CSRF from failed page or let's request fresh verification cleanly
    const step1b = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", oauth.cookies)
      .type("form")
      .send({
        _csrf: oauth.csrf,
        step: "email",
        lang: "en",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "reviewer@glama.ai"
      })
      .expect(200);

    const challengeId2 = step1b.text.match(/name="challenge_id" value="([^"]+)"/)![1]!;
    const csrf3 = step1b.text.match(/name="_csrf" value="([^"]+)"/)![1]!;
    const cookies3 = extractCookies(step1b.headers["set-cookie"]);

    const okRes = await request(app)
      .post("/oauth/authorize")
      .set("Cookie", cookies3)
      .type("form")
      .send({
        _csrf: csrf3,
        step: "verify",
        challenge_id: challengeId2,
        lang: "en",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "reviewer@glama.ai",
        code: "482917"
      })
      .expect(303);

    expect(new URL(okRes.headers.location!).searchParams.get("code")).toMatch(/^sc_code_/);

    // Normal user still fails without SMTP (cannot use reviewer code)
    await request(app)
      .post("/oauth/authorize")
      .set("Cookie", oauth.cookies)
      .type("form")
      .send({
        _csrf: oauth.csrf,
        step: "email",
        lang: "en",
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        code_challenge: oauth.challenge,
        code_challenge_method: "S256",
        resource: "https://shopcart.wals.pro/mcp",
        scope: "mcp:read",
        state: "state_xyz",
        email: "normal@example.com"
      })
      .expect(503);
  });
});
