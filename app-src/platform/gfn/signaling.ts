import type { IceCandidatePayload, MainToRendererSignalingEvent, SendAnswerRequest } from "@shared/gfn";

interface SignalingMessage {
  ackid?: number;
  ack?: number;
  hb?: number;
  peer_info?: { id: number };
  peer_msg?: { from: number; to: number; msg: string };
}

export class BrowserSignalingClient {
  private ws: WebSocket | null = null;
  private peerId = 2;
  private peerName = `peer-${Math.floor(Math.random() * 10_000_000_000)}`;
  private ackCounter = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(event: MainToRendererSignalingEvent) => void>();

  constructor(
    private readonly signalingServer: string,
    private readonly sessionId: string,
    private readonly signalingUrl?: string,
  ) {}

  private buildSignInUrl(): string {
    let serverWithPort: string;
    if (this.signalingUrl) {
      const withoutScheme = this.signalingUrl.replace(/^wss?:\/\//, "");
      const hostPort = withoutScheme.split("/")[0];
      serverWithPort = hostPort && hostPort.length > 0
        ? (hostPort.includes(":") ? hostPort : `${hostPort}:443`)
        : (this.signalingServer.includes(":") ? this.signalingServer : `${this.signalingServer}:443`);
    } else {
      serverWithPort = this.signalingServer.includes(":")
        ? this.signalingServer : `${this.signalingServer}:443`;
    }
    return `wss://${serverWithPort}/nvst/sign_in?peer_id=${this.peerName}&version=2`;
  }

  onEvent(listener: (event: MainToRendererSignalingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: MainToRendererSignalingEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private nextAckId(): number { return ++this.ackCounter; }

  private sendJson(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private setupHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendJson({ hb: 1 }), 5000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private sendPeerInfo(): void {
    this.sendJson({
      ackid: this.nextAckId(),
      peer_info: {
        browser: "Chrome", browserVersion: "131", connected: true,
        id: this.peerId, name: this.peerName, peerRole: 0,
        resolution: "1920x1080", version: 2,
      },
    });
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const url = this.buildSignInUrl();
    const protocol = `x-nv-sessionid.${this.sessionId}`;

    console.log("[Signaling] Connecting to:", url);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, protocol);
      this.ws = ws;

      ws.onerror = (event) => {
        this.emit({ type: "error", message: `Signaling connect failed: ${String(event)}` });
        reject(new Error("WebSocket error"));
      };

      ws.onopen = () => {
        this.sendPeerInfo();
        this.setupHeartbeat();
        this.emit({ type: "connected" });
        resolve();
      };

      ws.onmessage = (event) => {
        const text = typeof event.data === "string" ? event.data : String(event.data);
        this.handleMessage(text);
      };

      ws.onclose = (event) => {
        this.clearHeartbeat();
        this.emit({ type: "disconnected", reason: event.reason || "socket closed" });
      };
    });
  }

  private handleMessage(text: string): void {
    let parsed: SignalingMessage;
    try { parsed = JSON.parse(text) as SignalingMessage; } catch {
      this.emit({ type: "log", message: `Ignoring non-JSON: ${text.slice(0, 120)}` });
      return;
    }

    if (typeof parsed.ackid === "number") {
      const shouldAck = parsed.peer_info?.id !== this.peerId;
      if (shouldAck) this.sendJson({ ack: parsed.ackid });
    }

    if (parsed.hb) { this.sendJson({ hb: 1 }); return; }
    if (!parsed.peer_msg?.msg) return;

    let peerPayload: Record<string, unknown>;
    try { peerPayload = JSON.parse(parsed.peer_msg.msg) as Record<string, unknown>; } catch {
      this.emit({ type: "log", message: "Non-JSON peer payload" });
      return;
    }

    if (peerPayload.type === "offer" && typeof peerPayload.sdp === "string") {
      console.log(`[Signaling] Received OFFER SDP (${peerPayload.sdp.length} chars)`);
      this.emit({ type: "offer", sdp: peerPayload.sdp });
      return;
    }

    if (typeof peerPayload.candidate === "string") {
      console.log(`[Signaling] Received remote ICE: ${peerPayload.candidate}`);
      this.emit({
        type: "remote-ice",
        candidate: {
          candidate: peerPayload.candidate,
          sdpMid: typeof peerPayload.sdpMid === "string" || peerPayload.sdpMid === null ? peerPayload.sdpMid as string | null : undefined,
          sdpMLineIndex: typeof peerPayload.sdpMLineIndex === "number" || peerPayload.sdpMLineIndex === null ? peerPayload.sdpMLineIndex as number | null : undefined,
        },
      });
      return;
    }

    console.log("[Signaling] Unhandled peer message:", Object.keys(peerPayload));
  }

  async sendAnswer(payload: SendAnswerRequest): Promise<void> {
    console.log(`[Signaling] Sending ANSWER SDP (${payload.sdp.length} chars)`);
    this.sendJson({
      peer_msg: { from: this.peerId, to: 1, msg: JSON.stringify({ type: "answer", sdp: payload.sdp, ...(payload.nvstSdp ? { nvstSdp: payload.nvstSdp } : {}) }) },
      ackid: this.nextAckId(),
    });
  }

  async sendIceCandidate(candidate: IceCandidatePayload): Promise<void> {
    this.sendJson({
      peer_msg: { from: this.peerId, to: 1, msg: JSON.stringify({ candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex }) },
      ackid: this.nextAckId(),
    });
  }

  disconnect(): void {
    this.clearHeartbeat();
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
