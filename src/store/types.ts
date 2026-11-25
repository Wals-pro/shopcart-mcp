export type UserPlan = "free" | "pro";
export type UserStatus = "active" | "trialing" | "past_due" | "canceled";
export type ClientAuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  plan: UserPlan;
  status: UserStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: ClientAuthMethod;
  clientSecretHash: string | null;
  scope: string;
  activated: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthCodeRecord {
  codeHash: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scopes: string[];
  used: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthTokenRecord {
  tokenHash: string;
  type: "access" | "refresh";
  familyId: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: string[];
  rotatedAt: Date | null;
  revoked: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface WebSessionRecord {
  sessionHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthChallengeParams {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scope: string;
  state: string;
}

export type EmailChallengePurpose = "oauth" | "billing";

export interface EmailAuthChallengeRecord {
  challengeId: string;
  email: string;
  purpose: EmailChallengePurpose;
  lang: "de" | "en";
  otpHash: string;
  magicTokenHash: string;
  browserBindHash: string | null;
  oauthParams: OAuthChallengeParams | null;
  attempts: number;
  maxAttempts: number;
  used: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export type EmailChallengeVerifyResult =
  | { status: "ok"; challenge: EmailAuthChallengeRecord }
  | { status: "invalid_code"; remainingAttempts: number }
  | { status: "locked" }
  | { status: "expired" }
  | { status: "used" }
  | { status: "not_found" }
  | { status: "browser_mismatch"; challenge: EmailAuthChallengeRecord };

export type RefreshRotationResult =
  | { status: "ok"; record: OAuthTokenRecord }
  | { status: "replayed"; familyId: string }
  | { status: "invalid" };

export interface StorageBackend {
  ping(): Promise<boolean>;

  // Users
  getUserById(userId: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserByStripeCustomerId(customerId: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<boolean>;
  updateUser(userId: string, patch: Partial<Omit<UserRecord, "id" | "email" | "createdAt">>): Promise<void>;

  // DCR Clients
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  saveOAuthClient(client: OAuthClientRecord): Promise<void>;
  activateOAuthClient(clientId: string, newExpiresAt: Date): Promise<void>;

  // Authorization Codes
  saveOAuthCode(code: OAuthCodeRecord): Promise<void>;
  consumeOAuthCode(codeHash: string): Promise<OAuthCodeRecord | null>;

  // Tokens (Access & Refresh)
  saveOAuthToken(token: OAuthTokenRecord): Promise<void>;
  getOAuthToken(tokenHash: string): Promise<OAuthTokenRecord | null>;
  rotateRefreshToken(tokenHash: string): Promise<RefreshRotationResult>;
  revokeToken(tokenHash: string): Promise<void>;
  revokeTokenFamily(familyId: string): Promise<void>;

  // Web sessions (for /billing)
  saveWebSession(session: WebSessionRecord): Promise<void>;
  getWebSession(sessionHash: string): Promise<WebSessionRecord | null>;
  deleteWebSession(sessionHash: string): Promise<void>;

  // Passwordless Email Auth Challenges (OTP + Magic Link)
  saveEmailAuthChallenge(challenge: EmailAuthChallengeRecord): Promise<void>;
  getEmailAuthChallenge(challengeId: string): Promise<EmailAuthChallengeRecord | null>;
  verifyAndConsumeEmailOtp(
    challengeId: string,
    expectedOtpHash: string,
    now?: Date
  ): Promise<EmailChallengeVerifyResult>;
  verifyAndConsumeEmailMagicLink(
    challengeId: string,
    expectedMagicTokenHash: string,
    browserBindHash: string | null,
    now?: Date
  ): Promise<EmailChallengeVerifyResult>;

  // Daily Usage Quota
  getDailyUsage(userId: string, dayKey: string): Promise<number>;
  consumeDailyQuota(
    userId: string,
    dayKey: string,
    limit: number
  ): Promise<{ allowed: boolean; used: number }>;

  // Stripe Webhook Idempotency
  claimStripeEvent(eventId: string, type: string): Promise<boolean>;
}
