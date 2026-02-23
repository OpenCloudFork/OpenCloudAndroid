import type {
  ActiveSessionInfo,
  IceServer,
  SessionClaimRequest,
  SessionCreateRequest,
  SessionInfo,
  SessionPollRequest,
  SessionStopRequest,
  StreamSettings,
} from "@shared/gfn";
import { colorQualityBitDepth, colorQualityChromaFormat } from "@shared/gfn";
import type { CloudMatchRequest, CloudMatchResponse, GetSessionsResponse } from "./types";
import { SessionError } from "./errorCodes";

const GFN_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 OpenCloudAndroid/1.0.0";
const GFN_CLIENT_VERSION = "2.0.80.173";

function normalizeIceServers(response: CloudMatchResponse): IceServer[] {
  const raw = response.session.iceServerConfiguration?.iceServers ?? [];
  const servers = raw
    .map((entry) => ({ urls: Array.isArray(entry.urls) ? entry.urls : [entry.urls], username: entry.username, credential: entry.credential }))
    .filter((e) => e.urls.length > 0);
  if (servers.length > 0) return servers;
  return [
    { urls: ["stun:s1.stun.gamestream.nvidia.com:19308"] },
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
}

function streamingServerIp(response: CloudMatchResponse): string | null {
  const connections = response.session.connectionInfo ?? [];
  const sigConn = connections.find((c) => c.usage === 14);
  if (sigConn) {
    const rawIp = sigConn.ip;
    const directIp = Array.isArray(rawIp) ? rawIp[0] : rawIp;
    if (directIp && directIp.length > 0) return directIp;
    if (sigConn.resourcePath) {
      const host = extractHostFromUrl(sigConn.resourcePath);
      if (host) return host;
    }
  }
  const controlIp = response.session.sessionControlInfo?.ip;
  if (controlIp && controlIp.length > 0) return Array.isArray(controlIp) ? controlIp[0] : controlIp;
  return null;
}

function extractHostFromUrl(url: string): string | null {
  for (const prefix of ["rtsps://", "rtsp://", "wss://", "https://"]) {
    if (url.startsWith(prefix)) {
      const afterProto = url.slice(prefix.length);
      const host = afterProto.split(":")[0]?.split("/")[0];
      if (host && host.length > 0 && !host.startsWith(".")) return host;
      return null;
    }
  }
  return null;
}

function buildSignalingUrl(resourcePath: string, serverIp: string): { signalingUrl: string; signalingHost: string | null } {
  if (resourcePath.startsWith("rtsps://") || resourcePath.startsWith("rtsp://")) {
    const host = extractHostFromUrl(resourcePath);
    if (host) return { signalingUrl: `wss://${host}/nvst/`, signalingHost: host };
  }
  if (resourcePath.startsWith("wss://")) return { signalingUrl: resourcePath, signalingHost: null };
  if (resourcePath.startsWith("/")) return { signalingUrl: `wss://${serverIp}:443${resourcePath}`, signalingHost: null };
  return { signalingUrl: `wss://${serverIp}:443/nvst/`, signalingHost: null };
}

function resolveMediaConnectionInfo(connections: Array<{ ip?: string; port: number; usage: number }>, serverIp: string): { ip: string; port: number } | undefined {
  const mediaConn = connections.find((c) => c.usage === 6);
  if (mediaConn?.ip) return { ip: Array.isArray(mediaConn.ip) ? mediaConn.ip[0]! : mediaConn.ip, port: mediaConn.port };
  return undefined;
}

function resolveSignaling(response: CloudMatchResponse): {
  serverIp: string; signalingServer: string; signalingUrl: string; mediaConnectionInfo?: { ip: string; port: number };
} {
  const connections = response.session.connectionInfo ?? [];
  const signalingConnection = connections.find((c) => c.usage === 14 && c.ip) ?? connections.find((c) => c.ip);
  const serverIp = streamingServerIp(response);
  if (!serverIp) throw new Error("CloudMatch response did not include a signaling host");
  const resourcePath = signalingConnection?.resourcePath ?? "/nvst/";
  const { signalingUrl, signalingHost } = buildSignalingUrl(resourcePath, serverIp);
  const effectiveHost = signalingHost ?? serverIp;
  const signalingServer = effectiveHost.includes(":") ? effectiveHost : `${effectiveHost}:443`;
  return { serverIp, signalingServer, signalingUrl, mediaConnectionInfo: resolveMediaConnectionInfo(connections, serverIp) };
}

function randomDeviceHash(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseResolution(resolution: string): { width: number; height: number } {
  const parts = resolution.split("x");
  return { width: parseInt(parts[0], 10) || 1920, height: parseInt(parts[1], 10) || 1080 };
}

function buildSessionRequest(appId: string, internalTitle: string, settings: StreamSettings, accountLinked: boolean): CloudMatchRequest {
  const { width, height } = parseResolution(settings.resolution);
  const bitDepth = colorQualityBitDepth(settings.colorQuality);
  const chromaFormat = colorQualityChromaFormat(settings.colorQuality);
  return {
    sessionRequestData: {
      appId, internalTitle: internalTitle || null,
      availableSupportedControllers: [1, 2, 4, 8, 16, 32, 64],
      networkTestSessionId: null, parentSessionId: null,
      clientIdentification: "OpenCloudAndroid", deviceHashId: randomDeviceHash(),
      clientVersion: GFN_CLIENT_VERSION, sdkVersion: GFN_CLIENT_VERSION, streamerVersion: 7,
      clientPlatformName: "ANDROID",
      clientRequestMonitorSettings: [{
        widthInPixels: width, heightInPixels: height, framesPerSecond: settings.fps,
        sdrHdrMode: bitDepth >= 10 ? 1 : 0,
        displayData: { desiredContentMaxLuminance: 1000, desiredContentMinLuminance: 0, desiredContentMaxFrameAverageLuminance: 500 },
        dpi: 96,
      }],
      useOps: true, audioMode: 0, metaData: [],
      sdrHdrMode: bitDepth >= 10 ? 1 : 0,
      clientDisplayHdrCapabilities: null,
      surroundAudioInfo: 0, remoteControllersBitmap: 6,
      clientTimezoneOffset: new Date().getTimezoneOffset(),
      enhancedStreamMode: 0, appLaunchMode: 0,
      secureRTSPSupported: false, partnerCustomData: "",
      accountLinked, enablePersistingInGameSettings: true, userAge: 99,
      requestedStreamingFeatures: {
        reflex: true, bitDepth, cloudGsync: false, enabledL4S: false,
        mouseMovementFlags: 3, trueHdr: bitDepth >= 10,
        supportedHidDevices: 0, profile: 0, fallbackToLogicalResolution: false,
        hidDevices: null, chromaFormat, prefilterMode: 0, prefilterSharpness: 0,
        prefilterNoiseReduction: 0, hudStreamingMode: 0, sdrColorSpace: 0, hdrColorSpace: 0,
      },
    },
  };
}

function commonHeaders(token: string, zone: string): Record<string, string> {
  return {
    Accept: "application/json", "Content-Type": "application/json",
    Authorization: `GFNJWT ${token}`,
    "nv-client-id": "ec7e38d4-03af-4b58-b131-cfb0495903ab",
    "nv-client-type": "BROWSER", "nv-client-version": GFN_CLIENT_VERSION,
    "nv-client-streamer": "WEBRTC", "nv-device-os": "ANDROID", "nv-device-type": "SHIELD",
    "User-Agent": GFN_USER_AGENT,
  };
}

export async function createSessionWeb(input: SessionCreateRequest): Promise<SessionInfo> {
  const token = input.token!;
  const base = (input.streamingBaseUrl ?? "https://prod.cloudmatchbeta.nvidiagrid.net/").replace(/\/$/, "");
  const zone = input.zone || "";
  const url = zone ? `${base}/v2/session?keyboardLayout=en-US&languageCode=en_US&zone=${encodeURIComponent(zone)}`
    : `${base}/v2/session?keyboardLayout=en-US&languageCode=en_US`;

  const body = buildSessionRequest(input.appId, input.internalTitle, input.settings, input.accountLinked ?? false);
  const response = await fetch(url, { method: "PUT", headers: commonHeaders(token, zone), body: JSON.stringify(body) });

  if (!response.ok) {
    const text = await response.text();
    throw SessionError.fromResponse(response.status, text);
  }

  const data = (await response.json()) as CloudMatchResponse;
  if (data.requestStatus.statusCode !== 0) {
    throw SessionError.fromResponse(0, JSON.stringify(data));
  }

  return {
    sessionId: data.session.sessionId, status: data.session.status, zone,
    streamingBaseUrl: base, serverIp: streamingServerIp(data) ?? "",
    signalingServer: "", signalingUrl: "", gpuType: data.session.gpuType,
    queuePosition: data.session.queuePosition, iceServers: normalizeIceServers(data),
  };
}

export async function pollSessionWeb(input: SessionPollRequest): Promise<SessionInfo> {
  const token = input.token!;
  const serverIp = input.serverIp;
  const base = serverIp ? `https://${serverIp}` : (input.streamingBaseUrl ?? "https://prod.cloudmatchbeta.nvidiagrid.net").replace(/\/$/, "");
  const zone = input.zone || "";
  const url = zone
    ? `${base}/v2/session/${input.sessionId}?keyboardLayout=en-US&languageCode=en_US&zone=${encodeURIComponent(zone)}`
    : `${base}/v2/session/${input.sessionId}?keyboardLayout=en-US&languageCode=en_US`;

  const response = await fetch(url, { headers: commonHeaders(token, zone) });
  if (!response.ok) {
    const text = await response.text();
    throw SessionError.fromResponse(response.status, text);
  }

  const data = (await response.json()) as CloudMatchResponse;
  if (data.requestStatus.statusCode !== 0 && data.requestStatus.statusCode !== undefined) {
    if (data.requestStatus.statusCode >= 2) {
      throw SessionError.fromResponse(0, JSON.stringify(data));
    }
  }

  const sessionStatus = data.session.status;
  let signaling: ReturnType<typeof resolveSignaling> | null = null;
  if (sessionStatus === 2 || sessionStatus === 3) {
    try { signaling = resolveSignaling(data); } catch { /* not ready yet */ }
  }

  return {
    sessionId: data.session.sessionId, status: sessionStatus, zone,
    streamingBaseUrl: base, serverIp: signaling?.serverIp ?? serverIp ?? "",
    signalingServer: signaling?.signalingServer ?? "", signalingUrl: signaling?.signalingUrl ?? "",
    gpuType: data.session.gpuType, queuePosition: data.session.queuePosition,
    iceServers: normalizeIceServers(data), mediaConnectionInfo: signaling?.mediaConnectionInfo,
  };
}

export async function stopSessionWeb(input: SessionStopRequest): Promise<void> {
  const token = input.token!;
  const serverIp = input.serverIp;
  const base = serverIp ? `https://${serverIp}` : (input.streamingBaseUrl ?? "https://prod.cloudmatchbeta.nvidiagrid.net").replace(/\/$/, "");
  const zone = input.zone || "";
  const url = zone
    ? `${base}/v2/session/${input.sessionId}?keyboardLayout=en-US&languageCode=en_US&zone=${encodeURIComponent(zone)}`
    : `${base}/v2/session/${input.sessionId}?keyboardLayout=en-US&languageCode=en_US`;
  await fetch(url, { method: "DELETE", headers: commonHeaders(token, zone) });
}

export async function getActiveSessionsWeb(token: string, streamingBaseUrl?: string): Promise<ActiveSessionInfo[]> {
  const base = (streamingBaseUrl ?? "https://prod.cloudmatchbeta.nvidiagrid.net").replace(/\/$/, "");
  const url = `${base}/v2/session?keyboardLayout=en-US&languageCode=en_US`;
  const response = await fetch(url, { headers: commonHeaders(token, "") });
  if (!response.ok) return [];

  const data = (await response.json()) as GetSessionsResponse;
  return (data.sessions ?? []).map((s) => ({
    sessionId: s.sessionId, status: s.status, gpuType: s.gpuType,
    appId: parseInt(s.sessionRequestData?.appId ?? "0", 10) || 0,
    serverIp: s.sessionControlInfo?.ip,
  }));
}

export async function claimSessionWeb(input: SessionClaimRequest): Promise<SessionInfo> {
  const token = input.token!;
  const serverIp = input.serverIp;
  const base = serverIp ? `https://${serverIp}` : (input.streamingBaseUrl ?? "https://prod.cloudmatchbeta.nvidiagrid.net").replace(/\/$/, "");

  for (let attempt = 0; attempt < 15; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));

    const url = `${base}/v2/session/${input.sessionId}?keyboardLayout=en-US&languageCode=en_US`;
    const response = await fetch(url, { headers: commonHeaders(token, "") });
    if (!response.ok) continue;

    const data = (await response.json()) as CloudMatchResponse;
    const sessionData = data.session;

    if (sessionData.status === 2 || sessionData.status === 3) {
      const signaling = resolveSignaling(data);
      return {
        sessionId: sessionData.sessionId, status: sessionData.status, zone: "",
        streamingBaseUrl: base, serverIp: signaling.serverIp,
        signalingServer: signaling.signalingServer, signalingUrl: signaling.signalingUrl,
        gpuType: sessionData.gpuType, iceServers: normalizeIceServers(data),
        mediaConnectionInfo: signaling.mediaConnectionInfo,
      };
    }
    if (sessionData.status !== 6) break;
  }
  throw new Error("Session did not become ready after claiming");
}
