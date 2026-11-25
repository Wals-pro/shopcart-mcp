import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../config.js";
import type {
  EmailAuthChallengeRecord,
  EmailChallengePurpose,
  EmailChallengeVerifyResult,
  OAuthChallengeParams,
  StorageBackend,
  UserRecord
} from "../store/types.js";
import { hmacSha256Hex, randomSixDigitCode, randomToken, sha256Hex } from "./crypto.js";
import { escapeHtml, type Lang } from "./pages.js";

export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_EMAIL_RATE_LIMIT = 3;
export const OTP_REVIEWER_EMAIL_RATE_LIMIT = 20;
export const OTP_IP_RATE_LIMIT = 15;
export const OTP_RATE_WINDOW_MS = 10 * 60 * 1000;
export const OTP_BIND_COOKIE = "sc_otp_bind";

export interface RenderedOtpEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  lang: Lang;
  code: string;
  formattedCode: string;
  magicLink: string;
}

export interface EmailSender {
  sendOtpEmail(message: RenderedOtpEmail): Promise<void>;
  verify?(): Promise<boolean>;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeOtpInput(raw: string): string {
  return raw.replace(/[\s\-]/g, "").trim();
}

export function formatOtpForDisplay(code: string): string {
  const digits = normalizeOtpInput(code);
  if (digits.length === 6) {
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  }
  return digits;
}

export function hashOtp(secret: string, challengeId: string, code: string): string {
  return hmacSha256Hex(secret, `otp:${challengeId}:${code}`);
}

export function hashMagicToken(secret: string, challengeId: string, rawSecret: string): string {
  return hmacSha256Hex(secret, `magic:${challengeId}:${rawSecret}`);
}

export function hashBrowserBind(secret: string, challengeId: string, rawBind: string): string {
  return hmacSha256Hex(secret, `bind:${challengeId}:${rawBind}`);
}

export function parseCompoundToken(
  raw: string | undefined
): { challengeId: string; secretPart: string } | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) return null;
  const challengeId = trimmed.slice(0, dotIdx);
  const secretPart = trimmed.slice(dotIdx + 1);
  if (
    !/^[A-Za-z0-9_-]{8,80}$/.test(challengeId) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(secretPart)
  ) {
    return null;
  }
  return { challengeId, secretPart };
}

export async function ensureUserByEmail(
  store: StorageBackend,
  email: string
): Promise<UserRecord> {
  const normalized = normalizeEmail(email);
  const existing = await store.getUserByEmail(normalized);
  if (existing) return existing;

  const now = new Date();
  const newUser: UserRecord = {
    id: sha256Hex(normalized),
    email: normalized,
    passwordHash: "",
    passwordSalt: "",
    plan: "free",
    status: "active",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    createdAt: now,
    updatedAt: now
  };
  const created = await store.createUser(newUser);
  if (created) return newUser;

  const raced = await store.getUserByEmail(normalized);
  if (raced) return raced;
  return newUser;
}

export function formatSenderAddress(senderName: string, senderEmail: string): string {
  const cleanName = senderName.replace(/["\r\n]/g, "").trim();
  const cleanEmail = senderEmail.replace(/[\r\n<>]/g, "").trim();
  return cleanName ? `"${cleanName}" <${cleanEmail}>` : cleanEmail;
}

export function renderOtpEmail(params: {
  to: string;
  from: string;
  code: string;
  magicLink: string;
  lang: Lang;
  purpose: EmailChallengePurpose;
  clientName?: string;
}): RenderedOtpEmail {
  const de = params.lang === "de";
  const formattedCode = formatOtpForDisplay(params.code);
  const contextLabel =
    params.purpose === "oauth"
      ? de
        ? `Verbindung für ${params.clientName || "deinen KI-Client"}`
        : `Sign in to connect ${params.clientName || "your AI client"}`
      : de
        ? "Anmeldung für Konto & Billing"
        : "Sign in to Account & Billing";

  const subject = de
    ? `Dein ShopCart Anmeldecode: ${formattedCode}`
    : `Your ShopCart sign-in code: ${formattedCode}`;

  const text = de
    ? [
        `ShopCart by wals.pro — ${contextLabel}`,
        "",
        `Dein 6-stelliger Anmeldecode (funktioniert in Claude iOS/Android, Desktop, ChatGPT & jedem Browser):`,
        "",
        `    ${formattedCode}`,
        "",
        `Oder am Desktop-Browser direkt mit 1 Klick anmelden:`,
        params.magicLink,
        "",
        `Der Code und der Link sind 10 Minuten lang und genau einmal gültig.`,
        `Falls du diese Anmeldung nicht angefordert hast, kannst du diese E-Mail einfach ignorieren.`,
        "",
        `— ShopCart by wals.pro · Wals Professional Services GmbH`
      ].join("\n")
    : [
        `ShopCart by wals.pro — ${contextLabel}`,
        "",
        `Your 6-digit sign-in code (works in Claude iOS/Android, Desktop, ChatGPT & every browser):`,
        "",
        `    ${formattedCode}`,
        "",
        `Or sign in with 1 click on your desktop browser:`,
        params.magicLink,
        "",
        `This code and link expire in 10 minutes and can only be used once.`,
        `If you did not request this sign-in, you can safely ignore this email.`,
        "",
        `— ShopCart by wals.pro · Wals Professional Services GmbH`
      ].join("\n");

  const html = `<!doctype html>
<html lang="${params.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#141414;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${
      de
        ? `Dein 6-stelliger Anmeldecode lautet ${escapeHtml(formattedCode)} (10 Minuten gültig).`
        : `Your 6-digit sign-in code is ${escapeHtml(formattedCode)} (valid for 10 minutes).`
    }
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#141414;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#1a1a1a;border:1px solid #2e2e2e;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="height:4px;background-color:#FF1F4D;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 28px 24px 28px;">
              <div style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;margin-bottom:18px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:#FF1F4D;margin-right:8px;vertical-align:middle;"></span>ShopCart MCP <span style="color:#a3a3a3;font-weight:500;">by wals.pro</span>
              </div>

              <h1 style="margin:0 0 8px 0;font-size:21px;line-height:1.3;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">
                ${de ? "Dein Anmeldecode" : "Your sign-in code"}
              </h1>
              <p style="margin:0 0 22px 0;font-size:14px;line-height:1.55;color:#a3a3a3;">
                ${escapeHtml(contextLabel)}
              </p>

              <div style="background-color:#141414;border:1px solid #2e2e2e;border-radius:12px;padding:22px 16px;text-align:center;margin-bottom:18px;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#a3a3a3;margin-bottom:10px;">
                  ${de ? "Option 1 · 6-stelliger Code (überall nutzbar)" : "Option 1 · 6-digit code (works everywhere)"}
                </div>
                <div style="font-family:ui-monospace,'SFMono-Regular',SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:6px;color:#ffffff;">
                  ${escapeHtml(formattedCode)}
                </div>
                <div style="font-size:12px;color:#a3a3a3;margin-top:10px;">
                  ${
                    de
                      ? "Ideal für Claude iOS/Android, Claude Desktop, ChatGPT & alle Browser."
                      : "Works in Claude iOS/Android, Claude Desktop, ChatGPT & every browser."
                  }
                </div>
              </div>

              <div style="text-align:center;margin:22px 0 18px 0;">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#a3a3a3;margin-bottom:12px;">
                  ${de ? "Option 2 · 1-Klick-Anmeldung (Desktop-Browser)" : "Option 2 · 1-click sign-in (Desktop browser)"}
                </div>
                <a href="${escapeHtml(params.magicLink)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#FF1F4D;color:#000000;font-size:14px;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px;">
                  ${de ? "Mit 1 Klick anmelden" : "Sign in with 1 click"}
                </a>
              </div>

              <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#a3a3a3;word-break:break-all;">
                ${de ? "Falls der Button nicht funktioniert, öffne diesen Link:" : "If the button does not work, open this link:"}<br>
                <a href="${escapeHtml(params.magicLink)}" style="color:#ff6b89;text-decoration:underline;">${escapeHtml(params.magicLink)}</a>
              </p>

              <hr style="border:0;border-top:1px solid #2e2e2e;margin:22px 0 16px 0;">

              <p style="margin:0;font-size:12px;line-height:1.55;color:#737373;">
                ${
                  de
                    ? "Code & Link sind <strong>10 Minuten</strong> und genau <strong>einmal</strong> gültig. Wenn du diese Anmeldung nicht angefordert hast, ignoriere diese E-Mail einfach."
                    : "This code and link are valid for <strong>10 minutes</strong> and <strong>single use</strong> only. If you did not request this sign-in, you can safely ignore this email."
                }
              </p>
              <p style="margin:10px 0 0 0;font-size:11px;color:#525252;">
                Wals Professional Services GmbH · shopcart.wals.pro
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    to: params.to,
    from: params.from,
    subject,
    text,
    html,
    lang: params.lang,
    code: params.code,
    formattedCode,
    magicLink: params.magicLink
  };
}

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(smtpUrl: string) {
    const trimmed = smtpUrl.trim();
    const isStartTls = trimmed.toLowerCase().startsWith("smtp+starttls://");
    const parseable = isStartTls
      ? `smtp://${trimmed.slice("smtp+starttls://".length)}`
      : trimmed;
    const parsed = new URL(parseable);
    const secure = parsed.protocol === "smtps:";
    const defaultPort = secure ? 465 : 587;
    const port = parsed.port ? Number.parseInt(parsed.port, 10) || defaultPort : defaultPort;
    const auth =
      parsed.username || parsed.password
        ? {
            user: decodeURIComponent(parsed.username),
            pass: decodeURIComponent(parsed.password)
          }
        : undefined;

    this.transporter = nodemailer.createTransport({
      host: parsed.hostname,
      port,
      secure,
      requireTLS: isStartTls || (!secure && port === 587),
      auth,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    });
  }

  async sendOtpEmail(message: RenderedOtpEmail): Promise<void> {
    await this.transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html
    });
  }

  async verify(): Promise<boolean> {
    await this.transporter.verify();
    return true;
  }
}

export class MemoryEmailSender implements EmailSender {
  public readonly sent: RenderedOtpEmail[] = [];

  async sendOtpEmail(message: RenderedOtpEmail): Promise<void> {
    this.sent.push(message);
  }

  async verify(): Promise<boolean> {
    return true;
  }

  lastFor(email: string): RenderedOtpEmail | undefined {
    const normalized = normalizeEmail(email);
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (normalizeEmail(this.sent[i]!.to) === normalized) {
        return this.sent[i];
      }
    }
    return undefined;
  }
}

class TimedRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly nowFn: () => Date) {}

  check(key: string, maxRequests: number, windowMs: number): boolean {
    const now = this.nowFn().getTime();
    const existing = this.hits.get(key);
    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      if (this.hits.size > 5000) {
        for (const [k, v] of this.hits) {
          if (v.resetAt <= now) this.hits.delete(k);
        }
      }
      return true;
    }
    if (existing.count >= maxRequests) return false;
    existing.count += 1;
    return true;
  }
}

export type RequestChallengeResult =
  | {
      ok: true;
      challengeId: string;
      email: string;
      browserBindCookieValue: string;
      isReviewerTest: boolean;
    }
  | {
      ok: false;
      error: "invalid_email" | "rate_limited" | "smtp_not_configured" | "send_failed";
    };

export type VerifyOtpServiceResult =
  | EmailChallengeVerifyResult
  | { status: "invalid_format" };

export interface EmailOtpServiceOptions {
  config: AppConfig;
  store: StorageBackend;
  emailSender?: EmailSender;
  now?: () => Date;
}

export class EmailOtpService {
  private readonly config: AppConfig;
  private readonly store: StorageBackend;
  private readonly emailSender: EmailSender | null;
  private readonly nowFn: () => Date;
  private readonly rateLimiter: TimedRateLimiter;

  constructor(opts: EmailOtpServiceOptions) {
    this.config = opts.config;
    this.store = opts.store;
    this.emailSender =
      opts.emailSender ?? (opts.config.smtpUrl ? new SmtpEmailSender(opts.config.smtpUrl) : null);
    this.nowFn = opts.now ?? (() => new Date());
    this.rateLimiter = new TimedRateLimiter(this.nowFn);
  }

  private isReviewerTestEmail(normalizedEmail: string): boolean {
    return Boolean(
      this.config.reviewerTestEmail &&
        this.config.reviewerTestCode &&
        this.config.reviewerTestEmail === normalizedEmail
    );
  }

  async requestChallenge(input: {
    email: string;
    ip: string;
    purpose: EmailChallengePurpose;
    lang: Lang;
    oauthParams: OAuthChallengeParams | null;
  }): Promise<RequestChallengeResult> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) {
      return { ok: false, error: "invalid_email" };
    }

    const isReviewerTest = this.isReviewerTestEmail(email);
    const emailLimit = isReviewerTest ? OTP_REVIEWER_EMAIL_RATE_LIMIT : OTP_EMAIL_RATE_LIMIT;

    if (
      !this.rateLimiter.check(`otp:ip:${input.ip}`, OTP_IP_RATE_LIMIT, OTP_RATE_WINDOW_MS) ||
      !this.rateLimiter.check(`otp:email:${email}`, emailLimit, OTP_RATE_WINDOW_MS)
    ) {
      return { ok: false, error: "rate_limited" };
    }

    if (!isReviewerTest && !this.emailSender) {
      return { ok: false, error: "smtp_not_configured" };
    }

    const now = this.nowFn();
    const challengeId = `chal_${randomToken(18)}`;
    const code = isReviewerTest ? this.config.reviewerTestCode! : randomSixDigitCode();
    const rawMagicSecret = randomToken(32);
    const rawBrowserBind = randomToken(24);

    const record: EmailAuthChallengeRecord = {
      challengeId,
      email,
      purpose: input.purpose,
      lang: input.lang,
      otpHash: hashOtp(this.config.sessionSecret, challengeId, code),
      magicTokenHash: hashMagicToken(this.config.sessionSecret, challengeId, rawMagicSecret),
      browserBindHash: hashBrowserBind(this.config.sessionSecret, challengeId, rawBrowserBind),
      oauthParams: input.oauthParams,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      used: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS)
    };

    await this.store.saveEmailAuthChallenge(record);

    if (!isReviewerTest && this.emailSender) {
      const magicToken = `${challengeId}.${rawMagicSecret}`;
      const magicLink = `${this.config.appOrigin}/auth/magic?token=${encodeURIComponent(magicToken)}`;
      const from = formatSenderAddress(this.config.smtpSenderName, this.config.smtpSenderEmail);
      const rendered = renderOtpEmail({
        to: email,
        from,
        code,
        magicLink,
        lang: input.lang,
        purpose: input.purpose,
        clientName: input.oauthParams?.clientName
      });

      try {
        await this.emailSender.sendOtpEmail(rendered);
      } catch {
        return { ok: false, error: "send_failed" };
      }
    }

    return {
      ok: true,
      challengeId,
      email,
      browserBindCookieValue: `${challengeId}.${rawBrowserBind}`,
      isReviewerTest
    };
  }

  async verifyOtp(input: { challengeId: string; code: string }): Promise<VerifyOtpServiceResult> {
    const challengeId = input.challengeId.trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(challengeId)) {
      return { status: "not_found" };
    }
    const normalizedCode = normalizeOtpInput(input.code);
    if (!/^\d{6}$/.test(normalizedCode)) {
      return { status: "invalid_format" };
    }
    const expectedHash = hashOtp(this.config.sessionSecret, challengeId, normalizedCode);
    return this.store.verifyAndConsumeEmailOtp(challengeId, expectedHash, this.nowFn());
  }

  async verifyMagicLink(input: {
    rawToken: string | undefined;
    browserBindCookie?: string;
  }): Promise<EmailChallengeVerifyResult> {
    const parsed = parseCompoundToken(input.rawToken);
    if (!parsed) {
      return { status: "not_found" };
    }

    const expectedMagicHash = hashMagicToken(
      this.config.sessionSecret,
      parsed.challengeId,
      parsed.secretPart
    );

    let browserBindHash: string | null = null;
    const parsedBind = parseCompoundToken(input.browserBindCookie);
    if (parsedBind && parsedBind.challengeId === parsed.challengeId) {
      browserBindHash = hashBrowserBind(
        this.config.sessionSecret,
        parsed.challengeId,
        parsedBind.secretPart
      );
    }

    return this.store.verifyAndConsumeEmailMagicLink(
      parsed.challengeId,
      expectedMagicHash,
      browserBindHash,
      this.nowFn()
    );
  }
}
