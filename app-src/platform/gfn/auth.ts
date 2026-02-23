import type {
  AuthLoginRequest,
  AuthSession,
  AuthSessionResult,
  AuthTokens,
  AuthUser,
  LoginProvider,
  StreamRegion,
  SubscriptionInfo,
} from "@shared/gfn";
import { fetchSubscriptionWeb, fetchDynamicRegionsWeb } from "./subscription";
import { preferencesGet, preferencesSet } from "./storage";
import AuthWebView from "./authWebView";
import { httpGet, httpPost } from "../http";

const SERVICE_URLS_ENDPOINT = "https://pcs.geforcenow.com/v1/serviceUrls";
const TOKEN_ENDPOINT = "https://login.nvidia.com/token";
const USERINFO_ENDPOINT = "https://login.nvidia.com/userinfo";
const AUTH_ENDPOINT = "https://login.nvidia.com/authorize";

const CLIENT_ID = "ZU7sPN-miLujMD95LfOQ453IB0AtjM8sMyvgJ9wCXEQ";
const SCOPES = "openid consent email tk_client age offline_access";
const DEFAULT_IDP_ID = "PDiAhv2kJTFeQ7WOPqiQ2tRZ7lGhR2X11dXvM4TZSxg";

const GFN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 NVIDIACEFClient/HEAD/debb5919f6 GFN-PC/2.0.80.173";

const REDIRECT_PORT = 2259;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

const AUTH_STATE_KEY = "auth_state";

interface PersistedAuthState {
  session: AuthSession | null;
  selectedProvider: LoginProvider | null;
}

interface ServiceUrlsResponse {
  requestStatus?: { statusCode?: number };
  gfnServiceInfo?: {
    gfnServiceEndpoints?: Array<{
      idpId: string;
      loginProviderCode: string;
      loginProviderDisplayName: string;
      streamingServiceUrl: string;
      loginProviderPriority?: number;
    }>;
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

interface ServerInfoResponse {
  requestStatus?: { serverId?: string };
  metaData?: Array<{ key: string; value: string }>;
}

function defaultProvider(): LoginProvider {
  return {
    idpId: DEFAULT_IDP_ID,
    code: "NVIDIA",
    displayName: "NVIDIA",
    streamingServiceUrl: "https://prod.cloudmatchbeta.nvidiagrid.net/",
    priority: 0,
  };
}

function normalizeProvider(provider: LoginProvider): LoginProvider {
  return {
    ...provider,
    streamingServiceUrl: provider.streamingServiceUrl.endsWith("/")
      ? provider.streamingServiceUrl
      : `${provider.streamingServiceUrl}/`,
  };
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${"=".repeat(4 - padding)}`;
  return atob(padded);
}

function parseJwtPayload<T>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = decodeBase64Url(parts[1]);
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let binary = "";
  for (const b of array) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBase64Url(64).slice(0, 86);
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const challenge = arrayBufferToBase64Url(digest);
  return { verifier, challenge };
}

function generateDeviceId(): string {
  return randomBase64Url(32);
}

function buildAuthUrl(provider: LoginProvider, challenge: string): string {
  const nonce = randomBase64Url(16);
  const params = new URLSearchParams({
    response_type: "code",
    device_id: generateDeviceId(),
    scope: SCOPES,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    ui_locales: "en_US",
    nonce,
    prompt: "select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
    idp_id: provider.idpId,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchangeAuthorizationCode(code: string, verifier: string): Promise<AuthTokens> {
  console.log("[Auth] Exchanging authorization code for tokens...");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await httpPost(TOKEN_ENDPOINT, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: "https://nvfile",
      Referer: "https://nvfile/",
      Accept: "application/json, text/plain, */*",
      "User-Agent": GFN_USER_AGENT,
    },
    data: body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const payload = (await response.json()) as TokenResponse;
  console.log("[Auth] Token exchange succeeded. Tokens saved.");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    idToken: payload.id_token,
    expiresAt: Date.now() + (payload.expires_in ?? 86400) * 1000,
  };
}

async function refreshAuthTokens(refreshToken: string): Promise<AuthTokens> {
  console.log("[Auth] Refreshing access token via refresh_token...");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    scope: SCOPES,
  });

  const response = await httpPost(TOKEN_ENDPOINT, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: "https://nvfile",
      Accept: "application/json, text/plain, */*",
      "User-Agent": GFN_USER_AGENT,
    },
    data: body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const payload = (await response.json()) as TokenResponse;
  if (!payload.access_token) throw new Error("Token refresh returned empty access_token");

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? refreshToken,
    idToken: payload.id_token,
    expiresAt: Date.now() + (payload.expires_in ?? 86400) * 1000,
  };
}

async function refreshViaClientToken(refreshToken: string): Promise<AuthTokens> {
  console.log("[Auth] Refreshing via client token exchange...");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: refreshToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    client_id: CLIENT_ID,
    scope: SCOPES,
  });

  const response = await httpPost(TOKEN_ENDPOINT, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: "https://nvfile",
      Accept: "application/json, text/plain, */*",
      "User-Agent": GFN_USER_AGENT,
    },
    data: body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`client_token refresh failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const payload = (await response.json()) as TokenResponse;
  if (!payload.access_token) throw new Error("client_token refresh returned empty access_token");

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? refreshToken,
    idToken: payload.id_token,
    expiresAt: Date.now() + (payload.expires_in ?? 86400) * 1000,
  };
}

async function fetchUserInfo(tokens: AuthTokens): Promise<AuthUser> {
  const jwtToken = tokens.idToken ?? tokens.accessToken;
  const parsed = parseJwtPayload<{
    sub?: string;
    email?: string;
    preferred_username?: string;
    gfn_tier?: string;
    picture?: string;
  }>(jwtToken);

  if (parsed?.sub) {
    return {
      userId: parsed.sub,
      displayName: parsed.preferred_username ?? parsed.email?.split("@")[0] ?? "User",
      email: parsed.email,
      avatarUrl: parsed.picture,
      membershipTier: parsed.gfn_tier ?? "FREE",
    };
  }

  const response = await httpGet(USERINFO_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Origin: "https://nvfile",
      Accept: "application/json",
      "User-Agent": GFN_USER_AGENT,
    },
  });

  if (!response.ok) throw new Error(`User info failed (${response.status})`);

  const payload = (await response.json()) as {
    sub: string;
    preferred_username?: string;
    email?: string;
    picture?: string;
  };

  return {
    userId: payload.sub,
    displayName: payload.preferred_username ?? payload.email?.split("@")[0] ?? "User",
    email: payload.email,
    avatarUrl: payload.picture,
    membershipTier: "FREE",
  };
}

export class AndroidAuthService {
  private providers: LoginProvider[] = [];
  private session: AuthSession | null = null;
  private selectedProvider: LoginProvider = defaultProvider();
  private cachedSubscription: SubscriptionInfo | null = null;
  private cachedVpcId: string | null = null;
  private refreshLock: Promise<AuthTokens | null> | null = null;
  private sessionExpiredListeners = new Set<(reason: string) => void>();

  private pendingPkce: { verifier: string; challenge: string } | null = null;

  async initialize(): Promise<void> {
    console.log("[Auth] Initializing — loading persisted tokens...");
    try {
      const raw = await preferencesGet(AUTH_STATE_KEY);
      if (raw) {
        console.log("[Auth] Found persisted auth state, restoring...");
        const parsed = JSON.parse(raw) as PersistedAuthState;
        if (parsed.selectedProvider) {
          this.selectedProvider = normalizeProvider(parsed.selectedProvider);
        }
        if (parsed.session) {
          this.session = {
            ...parsed.session,
            provider: normalizeProvider(parsed.session.provider),
          };
          await this.enrichUserTier();
          await this.persist();
          console.log(`[Auth] Session restored for user ${this.session.user.displayName} (tier=${this.session.user.membershipTier})`);
        }
      }
    } catch (err) {
      console.warn("[Auth] Failed to restore persisted auth state:", err);
      this.session = null;
      this.selectedProvider = defaultProvider();
    }
  }

  private async persist(): Promise<void> {
    const payload: PersistedAuthState = {
      session: this.session,
      selectedProvider: this.selectedProvider,
    };
    await preferencesSet(AUTH_STATE_KEY, JSON.stringify(payload));
    console.log("[Auth] Tokens persisted to Capacitor Preferences.");
  }

  async getProviders(): Promise<LoginProvider[]> {
    if (this.providers.length > 0) return this.providers;

    try {
      const response = await httpGet(SERVICE_URLS_ENDPOINT, {
        headers: { Accept: "application/json", "User-Agent": GFN_USER_AGENT },
      });

      if (!response.ok) {
        this.providers = [defaultProvider()];
        return this.providers;
      }

      const payload = (await response.json()) as ServiceUrlsResponse;
      const endpoints = payload.gfnServiceInfo?.gfnServiceEndpoints ?? [];

      const providers = endpoints
        .map<LoginProvider>((entry) => ({
          idpId: entry.idpId,
          code: entry.loginProviderCode,
          displayName: entry.loginProviderCode === "BPC" ? "bro.game" : entry.loginProviderDisplayName,
          streamingServiceUrl: entry.streamingServiceUrl,
          priority: entry.loginProviderPriority ?? 0,
        }))
        .sort((a, b) => a.priority - b.priority)
        .map(normalizeProvider);

      this.providers = providers.length > 0 ? providers : [defaultProvider()];
      return this.providers;
    } catch {
      this.providers = [defaultProvider()];
      return this.providers;
    }
  }

  getSession(): AuthSession | null {
    return this.session;
  }

  getSelectedProvider(): LoginProvider {
    return this.selectedProvider;
  }

  async getRegions(explicitToken?: string): Promise<StreamRegion[]> {
    const provider = this.getSelectedProvider();
    const base = provider.streamingServiceUrl.endsWith("/")
      ? provider.streamingServiceUrl
      : `${provider.streamingServiceUrl}/`;

    let token = explicitToken;
    if (!token) {
      const session = await this.ensureValidSession();
      token = session ? session.tokens.idToken ?? session.tokens.accessToken : undefined;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "nv-client-id": "ec7e38d4-03af-4b58-b131-cfb0495903ab",
      "nv-client-type": "NATIVE",
      "nv-client-version": "2.0.80.173",
      "nv-client-streamer": "NVIDIA-CLASSIC",
      "nv-device-os": "WINDOWS",
      "nv-device-type": "DESKTOP",
      "User-Agent": GFN_USER_AGENT,
    };

    if (token) headers.Authorization = `GFNJWT ${token}`;

    try {
      const response = await httpGet(`${base}v2/serverInfo`, { headers });
      if (!response.ok) return [];

      const payload = (await response.json()) as ServerInfoResponse;
      return (payload.metaData ?? [])
        .filter((e) => e.value.startsWith("https://") && e.key !== "gfn-regions" && !e.key.startsWith("gfn-"))
        .map<StreamRegion>((e) => ({ name: e.key, url: e.value.endsWith("/") ? e.value : `${e.value}/` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async startLogin(input: AuthLoginRequest): Promise<AuthSession> {
    const providers = await this.getProviders();
    const selected =
      providers.find((p) => p.idpId === input.providerIdpId) ??
      this.selectedProvider ??
      providers[0] ??
      defaultProvider();

    this.selectedProvider = normalizeProvider(selected);
    this.pendingPkce = await generatePkce();

    const authUrl = buildAuthUrl(this.selectedProvider, this.pendingPkce.challenge);

    const result = await AuthWebView.open({
      url: authUrl,
      redirectPattern: REDIRECT_URI,
    });

    const callbackUrl = result.url;
    const parsedUrl = new URL(callbackUrl);
    const code = parsedUrl.searchParams.get("code");
    if (!code) {
      const error = parsedUrl.searchParams.get("error") || "No authorization code in callback";
      this.pendingPkce = null;
      throw new Error(`Login failed: ${error}`);
    }

    const tokens = await exchangeAuthorizationCode(code, this.pendingPkce.verifier);
    this.pendingPkce = null;

    const user = await fetchUserInfo(tokens);

    this.session = { provider: this.selectedProvider, tokens, user };
    await this.enrichUserTier();
    await this.persist();
    return this.session;
  }

  async logout(): Promise<void> {
    this.session = null;
    this.cachedSubscription = null;
    this.cachedVpcId = null;
    await this.persist();
  }

  async getSubscription(): Promise<SubscriptionInfo | null> {
    if (this.cachedSubscription) return this.cachedSubscription;

    const session = await this.ensureValidSession();
    if (!session) return null;

    const token = session.tokens.idToken ?? session.tokens.accessToken;
    const userId = session.user.userId;

    const { vpcId } = await fetchDynamicRegionsWeb(token, this.selectedProvider.streamingServiceUrl);
    const subscription = await fetchSubscriptionWeb(token, userId, vpcId ?? undefined);
    this.cachedSubscription = subscription;
    return subscription;
  }

  async getVpcId(explicitToken?: string): Promise<string | null> {
    if (this.cachedVpcId) return this.cachedVpcId;

    const provider = this.getSelectedProvider();
    let token = explicitToken;
    if (!token) {
      const session = await this.ensureValidSession();
      token = session ? session.tokens.idToken ?? session.tokens.accessToken : undefined;
    }

    const { vpcId } = await fetchDynamicRegionsWeb(token, provider.streamingServiceUrl);
    if (vpcId) this.cachedVpcId = vpcId;
    return vpcId;
  }

  private async enrichUserTier(): Promise<void> {
    if (!this.session) return;
    try {
      const subscription = await this.getSubscription();
      if (subscription?.membershipTier) {
        this.session = {
          ...this.session,
          user: { ...this.session.user, membershipTier: subscription.membershipTier },
        };
      }
    } catch (error) {
      console.warn("Failed to fetch subscription tier:", error);
    }
  }

  private shouldRefresh(tokens: AuthTokens): boolean {
    return tokens.expiresAt - Date.now() < 10 * 60 * 1000;
  }

  async ensureValidSessionWithStatus(forceRefresh = false): Promise<AuthSessionResult> {
    if (!this.session) {
      return {
        session: null,
        refresh: { attempted: false, forced: forceRefresh, outcome: "not_attempted", message: "No saved session." },
      };
    }

    const tokens = this.session.tokens;
    if (!forceRefresh && !this.shouldRefresh(tokens)) {
      return {
        session: this.session,
        refresh: { attempted: false, forced: false, outcome: "not_attempted", message: "Token still valid." },
      };
    }

    if (!tokens.refreshToken) {
      return {
        session: this.session,
        refresh: { attempted: true, forced: forceRefresh, outcome: "missing_refresh_token", message: "No refresh token." },
      };
    }

    try {
      const refreshed = await this.lockedRefresh();
      if (!refreshed) {
        return {
          session: this.session,
          refresh: { attempted: true, forced: forceRefresh, outcome: "failed", message: "Refresh failed." },
        };
      }

      const user = await fetchUserInfo(refreshed);
      this.session = { provider: this.session.provider, tokens: refreshed, user };
      this.cachedSubscription = null;
      await this.enrichUserTier();
      await this.persist();

      return {
        session: this.session,
        refresh: { attempted: true, forced: forceRefresh, outcome: "refreshed", message: "Token refreshed." },
      };
    } catch (error) {
      return {
        session: this.session,
        refresh: {
          attempted: true,
          forced: forceRefresh,
          outcome: "failed",
          message: "Refresh failed.",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  async ensureValidSession(): Promise<AuthSession | null> {
    const result = await this.ensureValidSessionWithStatus(false);
    return result.session;
  }

  async resolveJwtToken(explicitToken?: string): Promise<string> {
    if (explicitToken?.trim()) return explicitToken;
    const session = await this.ensureValidSession();
    if (!session) throw new Error("No authenticated session available");
    return session.tokens.idToken ?? session.tokens.accessToken;
  }

  onSessionExpired(listener: (reason: string) => void): () => void {
    this.sessionExpiredListeners.add(listener);
    return () => { this.sessionExpiredListeners.delete(listener); };
  }

  private emitSessionExpired(reason: string): void {
    for (const listener of this.sessionExpiredListeners) listener(reason);
  }

  private async performTokenRefresh(): Promise<AuthTokens | null> {
    if (!this.session?.tokens.refreshToken) return null;
    const refreshToken = this.session.tokens.refreshToken;

    try {
      return await refreshAuthTokens(refreshToken);
    } catch {
      try {
        return await refreshViaClientToken(refreshToken);
      } catch {
        return null;
      }
    }
  }

  private async lockedRefresh(): Promise<AuthTokens | null> {
    if (this.refreshLock) return this.refreshLock;
    this.refreshLock = this.performTokenRefresh().finally(() => { this.refreshLock = null; });
    return this.refreshLock;
  }

  async handleApiError(error: unknown): Promise<{ shouldRetry: boolean; token: string | null }> {
    const is401 = error instanceof Error &&
      (error.message.includes("(401)") || error.message.includes("status 401") || error.message.includes("Unauthorized"));

    if (!is401) return { shouldRetry: false, token: null };

    if (!this.session?.tokens.refreshToken) {
      await this.logout();
      this.emitSessionExpired("Session expired. No refresh token.");
      return { shouldRetry: false, token: null };
    }

    const refreshed = await this.lockedRefresh();
    if (!refreshed) {
      await this.logout();
      this.emitSessionExpired("Session expired. Refresh failed.");
      return { shouldRetry: false, token: null };
    }

    try {
      const user = await fetchUserInfo(refreshed);
      this.session = { provider: this.session.provider, tokens: refreshed, user };
      this.cachedSubscription = null;
      await this.enrichUserTier();
      await this.persist();
    } catch {
      this.session = { ...this.session, tokens: refreshed };
      await this.persist();
    }

    return { shouldRetry: true, token: refreshed.idToken ?? refreshed.accessToken };
  }
}

export const authService = new AndroidAuthService();
