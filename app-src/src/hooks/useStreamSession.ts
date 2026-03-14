import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActiveSessionInfo,
  AuthSession,
  GameInfo,
  PlatformInfo,
  SessionInfo,
  Settings,
} from "@shared/gfn";

import { GFN_ERROR } from "../../platform/gfn/errorCodes";
import { SESSION_STATUS } from "../../platform/gfn/constants";
import { buildInitialHdrState } from "../gfn/hdrCapability";
import { MicAudioService } from "../gfn/micAudioService";
import type { MicAudioState } from "../gfn/micAudioService";
import {
  GfnWebRtcClient,
  type StreamDiagnostics,
  type StreamTimeWarning,
} from "../gfn/webrtcClient";
import {
  formatShortcutForDisplay,
  isShortcutMatch,
  normalizeShortcut,
} from "../shortcuts";
import type { DefaultShortcuts } from "./useSettings";

export type StreamStatus = "idle" | "queue" | "setup" | "starting" | "connecting" | "streaming";
export type StreamLoadingStatus = "queue" | "setup" | "starting" | "connecting";
export type ExitPromptState = { open: boolean; gameTitle: string };
export type StreamWarningState = {
  code: StreamTimeWarning["code"];
  message: string;
  tone: "warn" | "critical";
  secondsLeft?: number;
};
export type LaunchErrorState = {
  stage: StreamLoadingStatus;
  title: string;
  description: string;
  codeLabel?: string;
};

const IS_MAC = false;
const POINTER_RELEASE_DELAY_MS = 75;
const ANTI_AFK_INTERVAL_MS = 240000;
const WARNING_AUTO_HIDE_MS = 12000;
const ACTIVE_SESSION_POLL_MS = 10000;
const CLAIM_SIGNALING_DELAY_MS = 1000;
const ALLOCATION_TIMEOUT_MS = 180_000;
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 5000;
const BACKOFF_EXTENDED_MAX_MS = 10_000;
const READY_CONFIRMS_NEEDED = 3;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function isNumericId(value: string | undefined): value is string {
  if (!value) return false;
  return /^\d+$/.test(value);
}

function parseNumericId(value: string | undefined): number | null {
  if (!isNumericId(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultVariantId(game: GameInfo): string {
  const fallback = game.variants[0]?.id;
  const preferred = game.variants[game.selectedVariantIndex]?.id;
  return preferred ?? fallback ?? game.id;
}

function defaultDiagnostics(): StreamDiagnostics {
  return {
    connectionState: "closed",
    inputReady: false,
    connectedGamepads: 0,
    resolution: "",
    codec: "",
    isHdr: false,
    bitrateKbps: 0,
    decodeFps: 0,
    renderFps: 0,
    packetsLost: 0,
    packetsReceived: 0,
    packetLossPercent: 0,
    jitterMs: 0,
    rttMs: 0,
    framesReceived: 0,
    framesDecoded: 0,
    framesDropped: 0,
    decodeTimeMs: 0,
    renderTimeMs: 0,
    jitterBufferDelayMs: 0,
    inputQueueBufferedBytes: 0,
    inputQueuePeakBufferedBytes: 0,
    inputQueueDropCount: 0,
    inputQueueMaxSchedulingDelayMs: 0,
    micBytesSent: 0,
    micPacketsSent: 0,
    hdrState: buildInitialHdrState(),
    gpuType: "",
    serverRegion: "",
  };
}

function isSessionLimitError(error: unknown): boolean {
  if (error && typeof error === "object" && "gfnErrorCode" in error) {
    const candidate = error.gfnErrorCode;
    if (typeof candidate === "number") {
      return candidate === GFN_ERROR.SESSION_LIMIT_EXCEEDED || candidate === GFN_ERROR.INSUFFICIENT_PLAYABILITY;
    }
  }
  if (error instanceof Error) {
    const message = error.message.toUpperCase();
    return message.includes("SESSION LIMIT") || message.includes("INSUFFICIENT_PLAYABILITY") || message.includes("DUPLICATE SESSION");
  }
  return false;
}

function warningTone(code: StreamTimeWarning["code"]): "warn" | "critical" {
  return code === 3 ? "critical" : "warn";
}

function warningMessage(code: StreamTimeWarning["code"]): string {
  if (code === 1) return "Session time limit approaching";
  if (code === 2) return "Idle timeout approaching";
  return "Maximum session time approaching";
}

export function toLoadingStatus(status: StreamStatus): StreamLoadingStatus {
  switch (status) {
    case "queue":
    case "setup":
    case "starting":
    case "connecting":
      return status;
    default:
      return "queue";
  }
}

function toCodeLabel(code: number | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (code === GFN_ERROR.SESSION_LIMIT_EXCEEDED) return `SessionLimitExceeded (${code})`;
  if (code === GFN_ERROR.INSUFFICIENT_PLAYABILITY) return `SessionInsufficientPlayabilityLevel (${code})`;
  if (code === GFN_ERROR.SESSION_SERVER_ERROR) return `SessionServerError (${code})`;
  return `GFN Error ${code}`;
}

function extractLaunchErrorCode(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    if ("gfnErrorCode" in error) {
      const directCode = error.gfnErrorCode;
      if (typeof directCode === "number") return directCode;
    }
    if ("statusCode" in error) {
      const statusCode = error.statusCode;
      if (typeof statusCode === "number" && statusCode > 0 && statusCode < 255) {
        return GFN_ERROR.SESSION_SERVER_ERROR + statusCode;
      }
    }
  }
  if (error instanceof Error) {
    const match = error.message.match(/\b(3237\d{6,})\b/);
    if (match) {
      const code = Number(match[1]);
      if (Number.isFinite(code)) return code;
    }
  }
  return undefined;
}

function toLaunchErrorState(error: unknown, stage: StreamLoadingStatus): LaunchErrorState {
  const unknownMessage = "The game could not start. Please try again.";

  const titleFromError =
    error && typeof error === "object" && "title" in error && typeof error.title === "string"
      ? error.title.trim()
      : "";
  const descriptionFromError =
    error && typeof error === "object" && "description" in error && typeof error.description === "string"
      ? error.description.trim()
      : "";
  const statusDescription =
    error && typeof error === "object" && "statusDescription" in error && typeof error.statusDescription === "string"
      ? error.statusDescription.trim()
      : "";
  const messageFromError = error instanceof Error ? error.message.trim() : "";
  const combined = `${statusDescription} ${messageFromError}`.toUpperCase();
  const code = extractLaunchErrorCode(error);

  if (
    isSessionLimitError(error) ||
    combined.includes("INSUFFICIENT_PLAYABILITY") ||
    combined.includes("SESSION_LIMIT") ||
    combined.includes("DUPLICATE SESSION")
  ) {
    return {
      stage,
      title: "Duplicate Session Detected",
      description: "Another session is already running on your account. Close it first or wait for it to timeout, then launch again.",
      codeLabel: toCodeLabel(code),
    };
  }

  const httpStatus =
    error && typeof error === "object" && "httpStatus" in error && typeof error.httpStatus === "number"
      ? error.httpStatus
      : 0;
  const httpDetail = httpStatus > 0 ? ` (HTTP ${httpStatus})` : "";

  return {
    stage,
    title: titleFromError || "Launch Failed",
    description: (descriptionFromError || messageFromError || statusDescription || unknownMessage) + httpDetail,
    codeLabel: toCodeLabel(code),
  };
}

interface UseStreamSessionOptions {
  authSession: AuthSession | null;
  setAuthSession: React.Dispatch<React.SetStateAction<AuthSession | null>>;
  settings: Settings;
  games: GameInfo[];
  libraryGames: GameInfo[];
  defaultShortcuts: DefaultShortcuts;
}

interface UseStreamSessionResult {
  streamStatus: StreamStatus;
  session: SessionInfo | null;
  streamingGame: GameInfo | null;
  queuePosition: number | undefined;
  provisioningElapsed: number;
  diagnostics: StreamDiagnostics;
  showStatsOverlay: boolean;
  launchError: LaunchErrorState | null;
  exitPrompt: ExitPromptState;
  antiAfkEnabled: boolean;
  sessionElapsedSeconds: number;
  sessionClockVisible: boolean;
  streamWarning: StreamWarningState | null;
  escHoldReleaseIndicator: { visible: boolean; progress: number };
  navbarActiveSession: ActiveSessionInfo | null;
  isResumingNavbarSession: boolean;
  activeSessionGameTitle: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  clientRef: React.RefObject<GfnWebRtcClient | null>;
  micAudioState: MicAudioState | null;
  streamShortcuts: {
    toggleStats: string;
    togglePointerLock: string;
    stopStream: string;
  };
  handlePlayGame: (game: GameInfo) => Promise<void>;
  handleResumeFromNavbar: () => Promise<void>;
  handleStopStream: () => Promise<void>;
  handlePromptedStopStream: () => Promise<void>;
  handleDismissLaunchError: () => Promise<void>;
  handleToggleFullscreen: () => void;
  handleExitPromptConfirm: () => void;
  handleExitPromptCancel: () => void;
}

export function useStreamSession({
  authSession,
  setAuthSession,
  settings,
  games,
  libraryGames,
  defaultShortcuts,
}: UseStreamSessionOptions): UseStreamSessionResult {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [diagnostics, setDiagnostics] = useState<StreamDiagnostics>(defaultDiagnostics());
  const [showStatsOverlay, setShowStatsOverlay] = useState(true);
  const [antiAfkEnabled, setAntiAfkEnabled] = useState(false);
  const [escHoldReleaseIndicator, setEscHoldReleaseIndicator] = useState({ visible: false, progress: 0 });
  const [exitPrompt, setExitPrompt] = useState<ExitPromptState>({ open: false, gameTitle: "Game" });
  const [streamingGame, setStreamingGame] = useState<GameInfo | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | undefined>();
  const [navbarActiveSession, setNavbarActiveSession] = useState<ActiveSessionInfo | null>(null);
  const [isResumingNavbarSession, setIsResumingNavbarSession] = useState(false);
  const [launchError, setLaunchError] = useState<LaunchErrorState | null>(null);
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState<number | null>(null);
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [streamWarning, setStreamWarning] = useState<StreamWarningState | null>(null);
  const [provisioningElapsed, setProvisioningElapsed] = useState(0);
  const [sessionClockVisible, setSessionClockVisible] = useState(true);
  const [micAudioState, setMicAudioState] = useState<MicAudioState | null>(null);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);

  const diagnosticsRef = useRef<StreamDiagnostics>(diagnostics);
  const statsThrottleRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<GfnWebRtcClient | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const platformInfoRef = useRef<PlatformInfo | null>(null);
  const lastStreamGameTitleRef = useRef<string | null>(null);
  const launchInFlightRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const exitPromptResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const micServiceRef = useRef<MicAudioService | null>(null);

  const effectiveStreamingBaseUrl = authSession?.provider.streamingServiceUrl ?? "";

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    platformInfoRef.current = platformInfo;
  }, [platformInfo]);

  useEffect(() => {
    void window.openNow.getPlatformInfo().then(setPlatformInfo).catch(() => {});
  }, []);

  const refreshNavbarActiveSession = useCallback(async (): Promise<void> => {
    if (!authSession) {
      setNavbarActiveSession(null);
      return;
    }
    const token = authSession.tokens.idToken ?? authSession.tokens.accessToken;
    if (!token || !effectiveStreamingBaseUrl) {
      setNavbarActiveSession(null);
      return;
    }
    try {
      const activeSessions = await window.openNow.getActiveSessions(token, effectiveStreamingBaseUrl);
      const candidate = activeSessions.find((entry) => (
        entry.status === SESSION_STATUS.STREAMING || entry.status === SESSION_STATUS.READY
      )) ?? null;
      setNavbarActiveSession(candidate);
    } catch (error) {
      console.warn("Failed to refresh active sessions:", error);
    }
  }, [authSession, effectiveStreamingBaseUrl]);

  useEffect(() => {
    if (!authSession || streamStatus !== "idle") {
      return;
    }
    void refreshNavbarActiveSession();
    const timer = window.setInterval(() => {
      void refreshNavbarActiveSession();
    }, ACTIVE_SESSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [authSession, refreshNavbarActiveSession, streamStatus]);

  const shortcuts = useMemo(() => {
    const parseWithFallback = (value: string, fallback: string) => {
      const parsed = normalizeShortcut(value);
      return parsed.valid ? parsed : normalizeShortcut(fallback);
    };
    return {
      toggleStats: parseWithFallback(settings.shortcutToggleStats, defaultShortcuts.shortcutToggleStats),
      togglePointerLock: parseWithFallback(settings.shortcutTogglePointerLock, defaultShortcuts.shortcutTogglePointerLock),
      stopStream: parseWithFallback(settings.shortcutStopStream, defaultShortcuts.shortcutStopStream),
      toggleAntiAfk: parseWithFallback(settings.shortcutToggleAntiAfk, defaultShortcuts.shortcutToggleAntiAfk),
      toggleMic: parseWithFallback(settings.shortcutToggleMic, defaultShortcuts.shortcutToggleMic),
    };
  }, [
    defaultShortcuts.shortcutStopStream,
    defaultShortcuts.shortcutToggleAntiAfk,
    defaultShortcuts.shortcutToggleMic,
    defaultShortcuts.shortcutTogglePointerLock,
    defaultShortcuts.shortcutToggleStats,
    settings.shortcutStopStream,
    settings.shortcutToggleAntiAfk,
    settings.shortcutToggleMic,
    settings.shortcutTogglePointerLock,
    settings.shortcutToggleStats,
  ]);

  const requestEscLockedPointerCapture = useCallback(async (target: HTMLVideoElement) => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => {});
    }

    const nav = navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void> } };
    if (document.fullscreenElement && nav.keyboard?.lock) {
      await nav.keyboard.lock([
        "Escape",
        "F11",
        "BrowserBack",
        "BrowserForward",
        "BrowserRefresh",
      ]).catch(() => {});
    }

    await (target.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown as Promise<void>)
      .catch((error: DOMException) => {
        if (error.name === "NotSupportedError") {
          return target.requestPointerLock();
        }
        throw error;
      })
      .catch(() => {});
  }, []);

  const resolveExitPrompt = useCallback((confirmed: boolean) => {
    const resolver = exitPromptResolverRef.current;
    exitPromptResolverRef.current = null;
    setExitPrompt((prev) => (prev.open ? { ...prev, open: false } : prev));
    resolver?.(confirmed);
  }, []);

  const requestExitPrompt = useCallback((gameTitle: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (exitPromptResolverRef.current) {
        exitPromptResolverRef.current(false);
      }
      exitPromptResolverRef.current = resolve;
      setExitPrompt({
        open: true,
        gameTitle: gameTitle || "this game",
      });
    });
  }, []);

  const handleExitPromptConfirm = useCallback(() => {
    resolveExitPrompt(true);
  }, [resolveExitPrompt]);

  const handleExitPromptCancel = useCallback(() => {
    resolveExitPrompt(false);
  }, [resolveExitPrompt]);

  useEffect(() => {
    return () => {
      if (exitPromptResolverRef.current) {
        exitPromptResolverRef.current(false);
        exitPromptResolverRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.openNow.onToggleFullscreen(() => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!antiAfkEnabled || streamStatus !== "streaming") return;

    const interval = window.setInterval(() => {
      clientRef.current?.sendAntiAfkPulse();
    }, ANTI_AFK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [antiAfkEnabled, streamStatus]);

  useEffect(() => {
    if (streamStatus === "idle" || sessionStartedAtMs === null) {
      setSessionElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - sessionStartedAtMs) / 1000));
      setSessionElapsedSeconds(elapsed);
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [sessionStartedAtMs, streamStatus]);

  useEffect(() => {
    if (streamStatus === "idle" || sessionStartedAtMs === null) {
      setSessionClockVisible(true);
      return;
    }

    const everyMinutes = settings.sessionClockShowEveryMinutes;
    const durationSeconds = settings.sessionClockShowDurationSeconds;

    if (everyMinutes <= 0) {
      setSessionClockVisible(true);
      return;
    }

    setSessionClockVisible(true);
    const hideTimer = window.setTimeout(() => {
      setSessionClockVisible(false);
    }, durationSeconds * 1000);

    let pendingHideTimer: number | null = null;
    const revealInterval = window.setInterval(() => {
      setSessionClockVisible(true);
      if (pendingHideTimer !== null) window.clearTimeout(pendingHideTimer);
      pendingHideTimer = window.setTimeout(() => {
        setSessionClockVisible(false);
        pendingHideTimer = null;
      }, durationSeconds * 1000);
    }, everyMinutes * 60 * 1000);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearInterval(revealInterval);
      if (pendingHideTimer !== null) window.clearTimeout(pendingHideTimer);
    };
  }, [
    sessionStartedAtMs,
    settings.sessionClockShowDurationSeconds,
    settings.sessionClockShowEveryMinutes,
    streamStatus,
  ]);

  useEffect(() => {
    if (!streamWarning) return;
    const warning = streamWarning;
    const timer = window.setTimeout(() => {
      setStreamWarning((current) => (current === warning ? null : current));
    }, WARNING_AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [streamWarning]);

  const resetStreamRuntime = useCallback((nextStatus: StreamStatus = "idle") => {
    setSession(null);
    setStreamStatus(nextStatus);
    setQueuePosition(undefined);
    setSessionStartedAtMs(null);
    setSessionElapsedSeconds(0);
    setStreamWarning(null);
    setEscHoldReleaseIndicator({ visible: false, progress: 0 });
    setDiagnostics(defaultDiagnostics());
    setProvisioningElapsed(0);
  }, []);

  useEffect(() => {
    const unsubscribe = window.openNow.onSignalingEvent(async (event) => {
      console.log(
        `[App] Signaling event: ${event.type}`,
        event.type === "offer" ? `(SDP ${event.sdp.length} chars)` : "",
        event.type === "remote-ice" ? event.candidate : "",
      );
      try {
        if (event.type === "offer") {
          const activeSession = sessionRef.current;
          if (!activeSession) {
            console.warn("[App] Received offer but no active session in sessionRef!");
            return;
          }
          console.log("[App] Active session for offer:", JSON.stringify({
            sessionId: activeSession.sessionId,
            serverIp: activeSession.serverIp,
            signalingServer: activeSession.signalingServer,
            mediaConnectionInfo: activeSession.mediaConnectionInfo,
            iceServersCount: activeSession.iceServers?.length,
          }));

          if (!clientRef.current && videoRef.current && audioRef.current) {
            clientRef.current = new GfnWebRtcClient({
              videoElement: videoRef.current,
              audioElement: audioRef.current,
              onLog: (line: string) => console.log(`[WebRTC] ${line}`),
              onStats: (stats) => {
                diagnosticsRef.current = stats;
                const now = performance.now();
                if (now - statsThrottleRef.current > 1000) {
                  statsThrottleRef.current = now;
                  setDiagnostics(stats);
                }
              },
              onEscHoldProgress: (visible, progress) => {
                setEscHoldReleaseIndicator({ visible, progress });
              },
              onTimeWarning: (warning) => {
                setStreamWarning({
                  code: warning.code,
                  message: warningMessage(warning.code),
                  tone: warningTone(warning.code),
                  secondsLeft: warning.secondsLeft,
                });
              },
            });
          }

          if (clientRef.current) {
            const hdrEnabledForStream = false;

            await clientRef.current.handleOffer(event.sdp, activeSession, {
              codec: settings.codec,
              colorQuality: settings.colorQuality,
              resolution: settings.resolution,
              fps: settings.fps,
              maxBitrateKbps: settings.maxBitrateMbps * 1000,
              hdrEnabled: hdrEnabledForStream,
              hevcCompatMode: settings.hevcCompatMode,
              platformInfo: platformInfoRef.current,
              videoDecodeBackend: settings.videoDecodeBackend,
            });
            setLaunchError(null);
            setStreamStatus("streaming");
            setSessionStartedAtMs((current) => current ?? Date.now());
          }
        } else if (event.type === "remote-ice") {
          await clientRef.current?.addRemoteCandidate(event.candidate);
        } else if (event.type === "disconnected") {
          console.warn("Signaling disconnected:", event.reason);
          clientRef.current?.dispose();
          clientRef.current = null;
          setStreamingGame(null);
          lastStreamGameTitleRef.current = null;
          setLaunchError(null);
          launchInFlightRef.current = false;
          resetStreamRuntime();
        } else if (event.type === "error") {
          console.error("Signaling error:", event.message);
        }
      } catch (error) {
        console.error("Signaling event error:", error);
      }
    });

    return unsubscribe;
  }, [resetStreamRuntime, settings]);

  const claimAndConnectSession = useCallback(async (existingSession: ActiveSessionInfo): Promise<void> => {
    const token = authSession?.tokens.idToken ?? authSession?.tokens.accessToken;
    if (!token) {
      throw new Error("Missing token for session resume");
    }
    if (!existingSession.serverIp) {
      throw new Error("Active session is missing server address. Start the game again to create a new session.");
    }

    const hdrEnabledForClaim = false;

    const claimed = await window.openNow.claimSession({
      token,
      streamingBaseUrl: effectiveStreamingBaseUrl,
      serverIp: existingSession.serverIp,
      sessionId: existingSession.sessionId,
      settings: {
        resolution: settings.resolution,
        fps: settings.fps,
        maxBitrateMbps: settings.maxBitrateMbps,
        codec: settings.codec,
        colorQuality: settings.colorQuality,
        hdrEnabled: hdrEnabledForClaim,
      },
    });

    console.log("Claimed session:", {
      sessionId: claimed.sessionId,
      signalingServer: claimed.signalingServer,
      signalingUrl: claimed.signalingUrl,
      status: claimed.status,
    });

    await sleep(CLAIM_SIGNALING_DELAY_MS);

    setSession(claimed);
    sessionRef.current = claimed;
    setQueuePosition(undefined);
    setStreamStatus("connecting");
    await window.openNow.connectSignaling({
      sessionId: claimed.sessionId,
      signalingServer: claimed.signalingServer,
      signalingUrl: claimed.signalingUrl,
    });
  }, [authSession, effectiveStreamingBaseUrl, settings]);

  const handlePlayGame = useCallback(async (game: GameInfo) => {
    if (!authSession) return;

    if (launchInFlightRef.current || streamStatus !== "idle") {
      console.warn("Ignoring play request: launch already in progress or stream not idle", {
        inFlight: launchInFlightRef.current,
        streamStatus,
      });
      return;
    }

    launchInFlightRef.current = true;
    let loadingStep: StreamLoadingStatus = "queue";
    const updateLoadingStep = (next: StreamLoadingStatus): void => {
      loadingStep = next;
      setStreamStatus(next);
    };

    setSessionStartedAtMs(Date.now());
    setSessionElapsedSeconds(0);
    setStreamWarning(null);
    setLaunchError(null);
    setStreamingGame(game);
    lastStreamGameTitleRef.current = game.title?.trim() || null;
    updateLoadingStep("queue");
    setQueuePosition(undefined);

    try {
      let token = authSession.tokens.idToken ?? authSession.tokens.accessToken;
      try {
        const freshResult = await window.openNow.getAuthSession({ forceRefresh: false });
        if (freshResult.session) {
          const freshToken = freshResult.session.tokens.idToken ?? freshResult.session.tokens.accessToken;
          if (freshToken) {
            token = freshToken;
            if (freshResult.session !== authSession) {
              setAuthSession(freshResult.session);
            }
          }
        }
      } catch (refreshError) {
        console.warn("[App] Pre-launch token refresh failed, using existing token:", refreshError);
      }
      const selectedVariantId = defaultVariantId(game);

      let appId: string | null = null;
      if (isNumericId(selectedVariantId)) {
        appId = selectedVariantId;
      } else if (isNumericId(game.launchAppId)) {
        appId = game.launchAppId;
      }

      if (!appId && token) {
        try {
          const resolved = await window.openNow.resolveLaunchAppId({
            token,
            providerStreamingBaseUrl: effectiveStreamingBaseUrl,
            appIdOrUuid: game.uuid ?? selectedVariantId,
          });
          if (resolved && isNumericId(resolved)) {
            appId = resolved;
          }
        } catch {
          // Ignore resolution errors
        }
      }

      if (!appId) {
        throw new Error("Could not resolve numeric appId for this game");
      }

      if (token) {
        try {
          const activeSessions = await window.openNow.getActiveSessions(token, effectiveStreamingBaseUrl);
          if (activeSessions.length > 0) {
            const existingSession = activeSessions[0];
            await claimAndConnectSession(existingSession);
            setNavbarActiveSession(null);
            return;
          }
        } catch (error) {
          console.error("Failed to claim/resume session:", error);
        }
      }

      const hdrEnabledForCreate = false;

      const newSession = await window.openNow.createSession({
        token: token || undefined,
        streamingBaseUrl: effectiveStreamingBaseUrl,
        appId,
        internalTitle: game.title,
        accountLinked: game.playType !== "INSTALL_TO_PLAY",
        zone: "prod",
        settings: {
          resolution: settings.resolution,
          fps: settings.fps,
          maxBitrateMbps: settings.maxBitrateMbps,
          codec: settings.codec,
          colorQuality: settings.colorQuality,
          hdrEnabled: hdrEnabledForCreate,
        },
      });

      setSession(newSession);

      const pollAbort = new AbortController();
      pollAbortRef.current = pollAbort;
      const pollSignal = pollAbort.signal;

      let readyCount = 0;
      let attempt = 0;
      let delay = BACKOFF_INITIAL_MS;
      let allocationStartMs: number | null = null;
      let allocationTimedOut = false;
      const pollStartMs = Date.now();

      try {
        while (readyCount < READY_CONFIRMS_NEEDED) {
          if (pollSignal.aborted) {
            throw new DOMException("Polling cancelled", "AbortError");
          }

          await sleep(delay, pollSignal);
          attempt++;

          const polled = await window.openNow.pollSession({
            token: token || undefined,
            streamingBaseUrl: newSession.streamingBaseUrl ?? effectiveStreamingBaseUrl,
            serverIp: newSession.serverIp,
            zone: newSession.zone,
            sessionId: newSession.sessionId,
          });

          if (pollSignal.aborted) {
            throw new DOMException("Polling cancelled", "AbortError");
          }

          setSession(polled);

          const polledQueuePos = polled.queuePosition ?? 0;
          const isInQueueMode = polledQueuePos > 1;
          const pollStartElapsed = Date.now() - pollStartMs;
          console.log(
            `Poll attempt ${attempt}: status=${polled.status}, queuePosition=${polledQueuePos}, ` +
            `signalingUrl=${polled.signalingUrl}, elapsed=${Math.round(pollStartElapsed / 1000)}s`,
          );

          if (polled.status === SESSION_STATUS.READY || polled.status === SESSION_STATUS.STREAMING) {
            readyCount++;
            console.log(`Ready count: ${readyCount}/${READY_CONFIRMS_NEEDED}`);
            delay = BACKOFF_INITIAL_MS;
          } else if (polled.status === SESSION_STATUS.PROVISIONING) {
            readyCount = 0;

            if (isInQueueMode) {
              updateLoadingStep("queue");
              setQueuePosition(polledQueuePos);
              allocationStartMs = null;
              allocationTimedOut = false;
              delay = Math.min(delay * 1.5, BACKOFF_MAX_MS);
            } else {
              setQueuePosition(undefined);

              if (allocationStartMs === null) {
                allocationStartMs = Date.now();
              }

              const allocationElapsed = Date.now() - allocationStartMs;

              if (!allocationTimedOut && allocationElapsed >= ALLOCATION_TIMEOUT_MS) {
                allocationTimedOut = true;
                console.warn(
                  `Allocation exceeded ${ALLOCATION_TIMEOUT_MS / 1000}s — continuing with extended backoff`,
                );
              }

              updateLoadingStep("setup");
              setProvisioningElapsed(Math.round(allocationElapsed / 1000));
              delay = Math.min(delay * 1.5, allocationTimedOut ? BACKOFF_EXTENDED_MAX_MS : BACKOFF_MAX_MS);
            }
          } else if (polled.status === SESSION_STATUS.ACTIVE) {
            throw new Error("Session is being cleaned up. Please try launching again.");
          } else {
            readyCount = 0;
            console.warn(`Unexpected session status: ${polled.status}, continuing to poll`);
            delay = Math.min(delay * 1.5, BACKOFF_MAX_MS);
          }
        }
      } finally {
        if (pollAbortRef.current === pollAbort) {
          pollAbortRef.current = null;
        }
        setQueuePosition(undefined);
        setProvisioningElapsed(0);
      }

      updateLoadingStep("connecting");

      const finalSession = sessionRef.current ?? newSession;
      console.log("Connecting signaling with:", {
        sessionId: finalSession.sessionId,
        signalingServer: finalSession.signalingServer,
        signalingUrl: finalSession.signalingUrl,
        status: finalSession.status,
      });

      await window.openNow.connectSignaling({
        sessionId: finalSession.sessionId,
        signalingServer: finalSession.signalingServer,
        signalingUrl: finalSession.signalingUrl,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";

      if (isAbort) {
        console.log("Launch cancelled by user");
      } else {
        console.error("Launch failed:", error);
        setLaunchError(toLaunchErrorState(error, loadingStep));
      }

      await window.openNow.disconnectSignaling().catch(() => {});
      clientRef.current?.dispose();
      clientRef.current = null;
      void refreshNavbarActiveSession();
      resetStreamRuntime();
    } finally {
      launchInFlightRef.current = false;
    }
  }, [
    authSession,
    claimAndConnectSession,
    effectiveStreamingBaseUrl,
    refreshNavbarActiveSession,
    resetStreamRuntime,
    setAuthSession,
    settings,
    streamStatus,
  ]);

  const gameTitleByAppId = useMemo(() => {
    const titles = new Map<number, string>();
    const allKnownGames = [...games, ...libraryGames];

    for (const game of allKnownGames) {
      const idsForGame = new Set<number>();
      const launchId = parseNumericId(game.launchAppId);
      if (launchId !== null) {
        idsForGame.add(launchId);
      }
      for (const variant of game.variants) {
        const variantId = parseNumericId(variant.id);
        if (variantId !== null) {
          idsForGame.add(variantId);
        }
      }
      for (const appId of idsForGame) {
        if (!titles.has(appId)) {
          titles.set(appId, game.title);
        }
      }
    }

    return titles;
  }, [games, libraryGames]);

  const activeSessionGameTitle = useMemo(() => {
    if (!navbarActiveSession) return null;
    const mappedTitle = gameTitleByAppId.get(navbarActiveSession.appId);
    if (mappedTitle) {
      return mappedTitle;
    }
    if (session?.sessionId === navbarActiveSession.sessionId && streamingGame?.title) {
      return streamingGame.title;
    }
    return null;
  }, [gameTitleByAppId, navbarActiveSession, session?.sessionId, streamingGame?.title]);

  const handleResumeFromNavbar = useCallback(async () => {
    if (!authSession || !navbarActiveSession || isResumingNavbarSession) {
      return;
    }
    if (launchInFlightRef.current || streamStatus !== "idle") {
      return;
    }

    launchInFlightRef.current = true;
    setIsResumingNavbarSession(true);
    let loadingStep: StreamLoadingStatus = "setup";
    const updateLoadingStep = (next: StreamLoadingStatus): void => {
      loadingStep = next;
      setStreamStatus(next);
    };

    setLaunchError(null);
    setQueuePosition(undefined);
    setSessionStartedAtMs(Date.now());
    setSessionElapsedSeconds(0);
    setStreamWarning(null);
    lastStreamGameTitleRef.current = activeSessionGameTitle?.trim() || null;
    updateLoadingStep("setup");

    try {
      await claimAndConnectSession(navbarActiveSession);
      setNavbarActiveSession(null);
    } catch (error) {
      console.error("Navbar resume failed:", error);
      setLaunchError(toLaunchErrorState(error, loadingStep));
      await window.openNow.disconnectSignaling().catch(() => {});
      clientRef.current?.dispose();
      clientRef.current = null;
      void refreshNavbarActiveSession();
      resetStreamRuntime();
    } finally {
      launchInFlightRef.current = false;
      setIsResumingNavbarSession(false);
    }
  }, [
    activeSessionGameTitle,
    authSession,
    claimAndConnectSession,
    isResumingNavbarSession,
    navbarActiveSession,
    refreshNavbarActiveSession,
    resetStreamRuntime,
    streamStatus,
  ]);

  const handleStopStream = useCallback(async () => {
    try {
      resolveExitPrompt(false);
      pollAbortRef.current?.abort();
      await window.openNow.disconnectSignaling();

      const current = sessionRef.current;
      if (current) {
        const token = authSession?.tokens.idToken ?? authSession?.tokens.accessToken;
        await window.openNow.stopSession({
          token: token || undefined,
          streamingBaseUrl: current.streamingBaseUrl,
          serverIp: current.serverIp,
          zone: current.zone,
          sessionId: current.sessionId,
        });
      }

      clientRef.current?.dispose();
      clientRef.current = null;
      setStreamingGame(null);
      lastStreamGameTitleRef.current = null;
      setNavbarActiveSession(null);
      setLaunchError(null);
      void refreshNavbarActiveSession();
      resetStreamRuntime();
    } catch (error) {
      console.error("Stop failed:", error);
    }
  }, [authSession, refreshNavbarActiveSession, resetStreamRuntime, resolveExitPrompt]);

  const handleDismissLaunchError = useCallback(async () => {
    pollAbortRef.current?.abort();
    await window.openNow.disconnectSignaling().catch(() => {});
    clientRef.current?.dispose();
    clientRef.current = null;
    setLaunchError(null);
    setStreamingGame(null);
    lastStreamGameTitleRef.current = null;
    void refreshNavbarActiveSession();
    resetStreamRuntime();
  }, [refreshNavbarActiveSession, resetStreamRuntime]);

  const releasePointerLockIfNeeded = useCallback(async () => {
    if (document.pointerLockElement) {
      document.exitPointerLock();
      setEscHoldReleaseIndicator({ visible: false, progress: 0 });
      await sleep(POINTER_RELEASE_DELAY_MS);
    }
  }, []);

  const handlePromptedStopStream = useCallback(async () => {
    if (streamStatus === "idle") {
      return;
    }

    await releasePointerLockIfNeeded();

    const gameName = (streamingGame?.title || "this game").trim();
    const shouldExit = await requestExitPrompt(gameName);
    if (!shouldExit) {
      return;
    }

    await handleStopStream();
  }, [handleStopStream, releasePointerLockIfNeeded, requestExitPrompt, streamStatus, streamingGame?.title]);

  useEffect(() => {
    const handler = () => {
      void handlePromptedStopStream();
    };
    window.addEventListener("opencloud:stop-stream", handler);
    return () => window.removeEventListener("opencloud:stop-stream", handler);
  }, [handlePromptedStopStream]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = !!target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (isTyping) {
        return;
      }

      if (exitPrompt.open) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          handleExitPromptCancel();
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          handleExitPromptConfirm();
        }
        return;
      }

      const isPasteShortcut = event.key.toLowerCase() === "v" && !event.altKey && event.ctrlKey;
      if (streamStatus === "streaming" && isPasteShortcut) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (settings.clipboardPaste) {
          void (async () => {
            const client = clientRef.current;
            if (!client) return;

            try {
              const text = await navigator.clipboard.readText();
              if (text && client.sendText(text) > 0) {
                return;
              }
            } catch (error) {
              console.warn("Clipboard read failed, falling back to paste shortcut:", error);
            }

            client.sendPasteShortcut(IS_MAC);
          })();
        }
        return;
      }

      if (isShortcutMatch(event, shortcuts.toggleStats)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setShowStatsOverlay((prev) => !prev);
        return;
      }

      if (isShortcutMatch(event, shortcuts.togglePointerLock)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (streamStatus === "streaming" && videoRef.current) {
          if (document.pointerLockElement === videoRef.current) {
            document.exitPointerLock();
          } else {
            void requestEscLockedPointerCapture(videoRef.current);
          }
        }
        return;
      }

      if (isShortcutMatch(event, shortcuts.stopStream)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void handlePromptedStopStream();
        return;
      }

      if (isShortcutMatch(event, shortcuts.toggleAntiAfk)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (streamStatus === "streaming") {
          setAntiAfkEnabled((prev) => !prev);
        }
      }

      if (isShortcutMatch(event, shortcuts.toggleMic)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (streamStatus === "streaming" && micServiceRef.current) {
          const service = micServiceRef.current;
          if (service.getMode() === "push-to-talk") {
            service.setPttActive(true);
          } else {
            service.toggleMute();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (streamStatus !== "streaming") return;
      if (!micServiceRef.current) return;
      const service = micServiceRef.current;
      if (service.getMode() === "push-to-talk" && isShortcutMatch(event, shortcuts.toggleMic)) {
        service.setPttActive(false);
      }
    };
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [
    exitPrompt.open,
    handleExitPromptCancel,
    handleExitPromptConfirm,
    handlePromptedStopStream,
    requestEscLockedPointerCapture,
    settings.clipboardPaste,
    shortcuts,
    streamStatus,
  ]);

  useEffect(() => {
    if (streamStatus === "streaming") {
      if (!micServiceRef.current) {
        micServiceRef.current = new MicAudioService();
      }
      const service = micServiceRef.current;

      if (clientRef.current) {
        clientRef.current.setMicService(service);
      }

      void service.configure({
        mode: settings.micMode,
        deviceId: settings.micDeviceId,
        gain: settings.micGain,
        noiseSuppression: settings.micNoiseSuppression,
        autoGainControl: settings.micAutoGainControl,
        echoCancellation: settings.micEchoCancellation,
      });
    } else if (micServiceRef.current) {
      micServiceRef.current.dispose();
      micServiceRef.current = null;
    }
  }, [
    settings.micAutoGainControl,
    settings.micDeviceId,
    settings.micEchoCancellation,
    settings.micGain,
    settings.micMode,
    settings.micNoiseSuppression,
    streamStatus,
  ]);

  useEffect(() => {
    return () => {
      if (micServiceRef.current) {
        micServiceRef.current.dispose();
        micServiceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const service = micServiceRef.current;
    if (!service) {
      setMicAudioState(null);
      return;
    }
    setMicAudioState(service.getState());
    const unsubscribe = service.onStateChange((state) => {
      setMicAudioState(state);
    });
    return unsubscribe;
  }, [streamStatus, settings.micMode]);

  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const streamShortcuts = useMemo(() => ({
    toggleStats: formatShortcutForDisplay(shortcuts.toggleStats.canonical, IS_MAC),
    togglePointerLock: formatShortcutForDisplay(shortcuts.togglePointerLock.canonical, IS_MAC),
    stopStream: formatShortcutForDisplay(shortcuts.stopStream.canonical, IS_MAC),
  }), [shortcuts.stopStream.canonical, shortcuts.togglePointerLock.canonical, shortcuts.toggleStats.canonical]);

  return {
    streamStatus,
    session,
    streamingGame,
    queuePosition,
    provisioningElapsed,
    diagnostics,
    showStatsOverlay,
    launchError,
    exitPrompt,
    antiAfkEnabled,
    sessionElapsedSeconds,
    sessionClockVisible,
    streamWarning,
    escHoldReleaseIndicator,
    navbarActiveSession,
    isResumingNavbarSession,
    activeSessionGameTitle,
    videoRef,
    audioRef,
    clientRef,
    micAudioState,
    streamShortcuts,
    handlePlayGame,
    handleResumeFromNavbar,
    handleStopStream,
    handlePromptedStopStream,
    handleDismissLaunchError,
    handleToggleFullscreen,
    handleExitPromptConfirm,
    handleExitPromptCancel,
  };
}
