import type {
  AuthLoginRequest,
  AuthSessionRequest,
  AuthSessionResult,
  GamesFetchRequest,
  RegionsFetchRequest,
  ResolveLaunchIdRequest,
  SessionCreateRequest,
  SessionPollRequest,
  SessionStopRequest,
  SessionClaimRequest,
  SignalingConnectRequest,
  SendAnswerRequest,
  IceCandidatePayload,
  MainToRendererSignalingEvent,
  SubscriptionFetchRequest,
  DiscordPresencePayload,
  FlightProfile,
  MicDeviceInfo,
  PlatformInfo,
  Settings,
  HdrCapability,
  OpenNowApi,
  AuthSession,
  LoginProvider,
  StreamRegion,
  GameInfo,
  SubscriptionInfo,
  SessionInfo,
  ActiveSessionInfo,
} from "@shared/gfn";

import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";

import { authService } from "./gfn/auth";
import { fetchMainGamesWeb, fetchLibraryGamesWeb, fetchPublicGamesWeb, resolveLaunchAppIdWeb } from "./gfn/games";
import { fetchSubscriptionWeb, fetchDynamicRegionsWeb } from "./gfn/subscription";
import { createSessionWeb, pollSessionWeb, stopSessionWeb, getActiveSessionsWeb, claimSessionWeb } from "./gfn/cloudmatch";
import { BrowserSignalingClient } from "./gfn/signaling";
import { loadSettings, setSetting as setSettingStore, resetSettings as resetSettingsStore, DEFAULT_SETTINGS } from "./gfn/settings";
import type { Settings as SettingsType } from "./gfn/settings";
import { setDebugLogging } from "./debugLog";

let signalingClient: BrowserSignalingClient | null = null;
let signalingClientKey: string | null = null;
const signalingEventListeners = new Set<(event: MainToRendererSignalingEvent) => void>();
const sessionExpiredListeners = new Set<(reason: string) => void>();
const micDevicesListeners = new Set<(devices: MicDeviceInfo[]) => void>();
const fullscreenListeners = new Set<() => void>();

let isStreaming = false;

StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
StatusBar.setBackgroundColor({ color: "#0b1220" }).catch(() => {});

CapApp.addListener("backButton", ({ canGoBack }) => {
  if (isStreaming) {
    window.dispatchEvent(new CustomEvent("opencloud:stop-stream"));
  } else if (canGoBack) {
    window.history.back();
  } else {
    CapApp.exitApp();
  }
});

let authInitPromise: Promise<void> | null = null;

async function ensureAuthInit(): Promise<void> {
  if (!authInitPromise) {
    authInitPromise = authService.initialize();
  }
  await authInitPromise;
}

export const openNowPlatform: OpenNowApi = {
  async getAuthSession(input: AuthSessionRequest = {}): Promise<AuthSessionResult> {
    await ensureAuthInit();
    return authService.ensureValidSessionWithStatus(input.forceRefresh ?? false);
  },

  async getLoginProviders(): Promise<LoginProvider[]> {
    await ensureAuthInit();
    return authService.getProviders();
  },

  async getRegions(input: RegionsFetchRequest = {}): Promise<StreamRegion[]> {
    await ensureAuthInit();
    return authService.getRegions(input.token);
  },

  async login(input: AuthLoginRequest): Promise<AuthSession> {
    await ensureAuthInit();
    return authService.startLogin(input);
  },

  async logout(): Promise<void> {
    await ensureAuthInit();
    return authService.logout();
  },

  async fetchSubscription(input: SubscriptionFetchRequest): Promise<SubscriptionInfo> {
    const token = await authService.resolveJwtToken(input.token);
    const baseUrl = input.providerStreamingBaseUrl ?? authService.getSelectedProvider().streamingServiceUrl;
    const { vpcId } = await fetchDynamicRegionsWeb(token, baseUrl);
    return fetchSubscriptionWeb(token, input.userId, vpcId ?? undefined);
  },

  async fetchMainGames(input: GamesFetchRequest): Promise<GameInfo[]> {
    const token = await authService.resolveJwtToken(input.token);
    return fetchMainGamesWeb(token, input.providerStreamingBaseUrl);
  },

  async fetchLibraryGames(input: GamesFetchRequest): Promise<GameInfo[]> {
    const token = await authService.resolveJwtToken(input.token);
    return fetchLibraryGamesWeb(token, input.providerStreamingBaseUrl);
  },

  async fetchPublicGames(): Promise<GameInfo[]> {
    return fetchPublicGamesWeb();
  },

  async resolveLaunchAppId(input: ResolveLaunchIdRequest): Promise<string | null> {
    const token = await authService.resolveJwtToken(input.token);
    return resolveLaunchAppIdWeb(token, input.appIdOrUuid, input.providerStreamingBaseUrl);
  },

  async createSession(input: SessionCreateRequest): Promise<SessionInfo> {
    if (!input.token) {
      const token = await authService.resolveJwtToken();
      input = { ...input, token };
    }
    if (!input.streamingBaseUrl) {
      input = { ...input, streamingBaseUrl: authService.getSelectedProvider().streamingServiceUrl };
    }
    return createSessionWeb(input);
  },

  async pollSession(input: SessionPollRequest): Promise<SessionInfo> {
    if (!input.token) {
      const token = await authService.resolveJwtToken();
      input = { ...input, token };
    }
    return pollSessionWeb(input);
  },

  async stopSession(input: SessionStopRequest): Promise<void> {
    if (!input.token) {
      const token = await authService.resolveJwtToken();
      input = { ...input, token };
    }
    return stopSessionWeb(input);
  },

  async getActiveSessions(token?: string, streamingBaseUrl?: string): Promise<ActiveSessionInfo[]> {
    const resolvedToken = await authService.resolveJwtToken(token);
    return getActiveSessionsWeb(resolvedToken, streamingBaseUrl ?? authService.getSelectedProvider().streamingServiceUrl);
  },

  async claimSession(input: SessionClaimRequest): Promise<SessionInfo> {
    if (!input.token) {
      const token = await authService.resolveJwtToken();
      input = { ...input, token };
    }
    return claimSessionWeb(input);
  },

  async showSessionConflictDialog(): Promise<"resume" | "new" | "cancel"> {
    const choice = window.confirm("You have an active session on another device. Do you want to take over?");
    return choice ? "resume" : "cancel";
  },

  async connectSignaling(input: SignalingConnectRequest): Promise<void> {
    const nextKey = `${input.sessionId}|${input.signalingServer}|${input.signalingUrl ?? ""}`;
    if (signalingClient && signalingClientKey === nextKey) return;

    if (signalingClient) signalingClient.disconnect();

    signalingClient = new BrowserSignalingClient(input.signalingServer, input.sessionId, input.signalingUrl);
    signalingClientKey = nextKey;
    signalingClient.onEvent((event) => {
      for (const listener of signalingEventListeners) listener(event);
    });
    await signalingClient.connect();
    isStreaming = true;
    StatusBar.hide().catch(() => {});
  },

  async disconnectSignaling(): Promise<void> {
    signalingClient?.disconnect();
    signalingClient = null;
    signalingClientKey = null;
    isStreaming = false;
    StatusBar.show().catch(() => {});
  },

  async sendAnswer(input: SendAnswerRequest): Promise<void> {
    if (!signalingClient) throw new Error("Signaling not connected");
    return signalingClient.sendAnswer(input);
  },

  async sendIceCandidate(input: IceCandidatePayload): Promise<void> {
    if (!signalingClient) throw new Error("Signaling not connected");
    return signalingClient.sendIceCandidate(input);
  },

  onSignalingEvent(listener: (event: MainToRendererSignalingEvent) => void): () => void {
    signalingEventListeners.add(listener);
    return () => { signalingEventListeners.delete(listener); };
  },

  onToggleFullscreen(listener: () => void): () => void {
    fullscreenListeners.add(listener);
    return () => { fullscreenListeners.delete(listener); };
  },

  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await document.documentElement.requestFullscreen().catch(() => {});
    }
  },

  async togglePointerLock(): Promise<void> {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    } else {
      await document.documentElement.requestPointerLock().catch(() => {});
    }
  },

  async getSettings(): Promise<Settings> {
    const s = await loadSettings() as Settings;
    setDebugLogging(s.debugLogging ?? false);
    return s;
  },

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    await setSettingStore(key as keyof SettingsType, value as SettingsType[keyof SettingsType]);
    if (key === "debugLogging") setDebugLogging(value as boolean);
  },

  async resetSettings(): Promise<Settings> {
    return resetSettingsStore() as Promise<Settings>;
  },

  async updateDiscordPresence(_state: DiscordPresencePayload): Promise<void> {
    // Discord Rich Presence not supported on Android
  },

  async clearDiscordPresence(): Promise<void> {
    // Discord Rich Presence not supported on Android
  },

  async flightGetProfile(_vidPid: string, _gameId?: string): Promise<FlightProfile | null> {
    return null;
  },

  async flightSetProfile(_profile: FlightProfile): Promise<void> {
    // Flight controls not supported on Android
  },

  async flightDeleteProfile(_vidPid: string, _gameId?: string): Promise<void> {},

  async flightGetAllProfiles(): Promise<FlightProfile[]> {
    return [];
  },

  async flightResetProfile(_vidPid: string): Promise<FlightProfile | null> {
    return null;
  },

  async getOsHdrInfo(): Promise<HdrCapability> {
    return {
      platform: "unknown",
      platformSupport: "unsupported",
      osHdrEnabled: false,
      displayHdrCapable: false,
      decoder10BitCapable: false,
      hdrColorSpaceSupported: false,
      notes: ["HDR is not supported on Android in this version"],
    };
  },

  async relaunchApp(): Promise<void> {
    window.location.reload();
  },

  async micEnumerateDevices(): Promise<MicDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
          isDefault: d.deviceId === "default" || i === 0,
        }));
    } catch {
      return [];
    }
  },

  onMicDevicesChanged(listener: (devices: MicDeviceInfo[]) => void): () => void {
    micDevicesListeners.add(listener);
    const handler = async () => {
      const devices = await openNowPlatform.micEnumerateDevices();
      for (const l of micDevicesListeners) l(devices);
    };
    navigator.mediaDevices?.addEventListener("devicechange", handler);
    return () => {
      micDevicesListeners.delete(listener);
      navigator.mediaDevices?.removeEventListener("devicechange", handler);
    };
  },

  onSessionExpired(listener: (reason: string) => void): () => void {
    sessionExpiredListeners.add(listener);
    const unsub = authService.onSessionExpired((reason) => {
      for (const l of sessionExpiredListeners) l(reason);
    });
    return () => {
      sessionExpiredListeners.delete(listener);
      unsub();
    };
  },

  async getPlatformInfo(): Promise<PlatformInfo> {
    return { platform: "android", arch: "arm64" };
  },
};

(window as unknown as { openNow: OpenNowApi }).openNow = openNowPlatform;
