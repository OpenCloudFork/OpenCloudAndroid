import { CapacitorHttp, type HttpOptions, type HttpResponse as CapHttpResponse } from "@capacitor/core";
import { debugLog, debugWarn, debugError, isDebugLogging } from "./debugLog";

const TAG = "[Http]";

export class HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  private readonly _data: unknown;

  constructor(response: CapHttpResponse) {
    this.status = response.status;
    this.ok = response.status >= 200 && response.status < 300;
    this.statusText = String(response.status);
    this.headers = response.headers ?? {};
    this._data = response.data;
  }

  async json<T = unknown>(): Promise<T> {
    if (typeof this._data === "object" && this._data !== null) return this._data as T;
    if (typeof this._data === "string") return JSON.parse(this._data) as T;
    return this._data as T;
  }

  async text(): Promise<string> {
    if (typeof this._data === "string") return this._data;
    if (typeof this._data === "object" && this._data !== null) return JSON.stringify(this._data);
    return String(this._data ?? "");
  }
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  data?: unknown;
}

function redactAuth(headers: Record<string, string>): string {
  const auth = headers["Authorization"] ?? headers["authorization"];
  if (!auth) return "";
  return auth.length > 30 ? `${auth.slice(0, 30)}…[${auth.length}]` : auth;
}

function serializeBody(
  data: unknown,
  headers: Record<string, string>,
): string | undefined {
  if (data === undefined || data === null) return undefined;
  if (data instanceof URLSearchParams) {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    return data.toString();
  }
  if (typeof data === "string") return data;
  if (!headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return JSON.stringify(data);
}

export async function httpRequest(
  method: string,
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const upperMethod = method.toUpperCase();
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  const body = serializeBody(options.data, headers);

  let finalUrl = url;
  if (options.params) {
    const sep = url.includes("?") ? "&" : "?";
    finalUrl = `${url}${sep}${new URLSearchParams(options.params).toString()}`;
  }

  const httpOpts: HttpOptions = {
    url: finalUrl,
    method: upperMethod,
    headers,
    data: body,
  };

  const authStr = redactAuth(headers);
  debugLog(TAG, `→ ${upperMethod} ${finalUrl}${authStr ? ` [auth=${authStr}]` : ""}`);

  if (isDebugLogging()) {
    const safeHeaders = { ...headers };
    if (safeHeaders["Authorization"]) safeHeaders["Authorization"] = redactAuth(headers);
    if (safeHeaders["authorization"]) safeHeaders["authorization"] = redactAuth(headers);
    debugLog(TAG, `  headers: ${JSON.stringify(safeHeaders)}`);
    if (body) debugLog(TAG, `  body: ${body.slice(0, 300)}`);
  }

  const t0 = performance.now();

  try {
    const raw = await CapacitorHttp.request(httpOpts);
    const elapsed = Math.round(performance.now() - t0);
    const resp = new HttpResponse(raw);

    if (!resp.ok) {
      const preview =
        typeof raw.data === "string"
          ? raw.data.slice(0, 300)
          : JSON.stringify(raw.data ?? "").slice(0, 300);
      debugWarn(TAG, `${upperMethod} ${finalUrl} → ${raw.status} (${elapsed}ms) | ${preview}`);
    } else {
      debugLog(TAG, `✓ ${upperMethod} ${finalUrl} → ${raw.status} (${elapsed}ms)`);
    }

    return resp;
  } catch (error: unknown) {
    const elapsed = Math.round(performance.now() - t0);
    const msg = error instanceof Error ? error.message : String(error);
    debugError(TAG, `${upperMethod} ${finalUrl} threw after ${elapsed}ms: ${msg}`);
    throw new Error(`HTTP ${upperMethod} ${finalUrl} failed: ${msg}`);
  }
}

export function httpGet(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  return httpRequest("GET", url, options);
}

export function httpPost(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  return httpRequest("POST", url, options);
}
