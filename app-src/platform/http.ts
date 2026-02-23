import { CapacitorHttp, type HttpOptions, type HttpResponse as CapHttpResponse } from "@capacitor/core";

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

function logAuth(headers: Record<string, string>): void {
  const val = headers["Authorization"] ?? headers["authorization"];
  if (val) {
    const preview = val.length > 40 ? `${val.slice(0, 40)}…` : val;
    console.log(`${TAG} Auth header: ${preview}`);
  }
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
  logAuth(headers);

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

  console.log(`${TAG} → ${upperMethod} ${finalUrl}`);
  const t0 = performance.now();

  try {
    const raw = await CapacitorHttp.request(httpOpts);
    const elapsed = Math.round(performance.now() - t0);
    const resp = new HttpResponse(raw);

    if (!resp.ok) {
      const preview =
        typeof raw.data === "string"
          ? raw.data.slice(0, 200)
          : JSON.stringify(raw.data ?? "").slice(0, 200);
      console.warn(
        `${TAG} ✗ ${upperMethod} ${finalUrl} → ${raw.status} (${elapsed}ms) | ${preview}`,
      );
    } else {
      console.log(
        `${TAG} ✓ ${upperMethod} ${finalUrl} → ${raw.status} (${elapsed}ms)`,
      );
    }

    return resp;
  } catch (error: unknown) {
    const elapsed = Math.round(performance.now() - t0);
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `${TAG} ✗✗ ${upperMethod} ${finalUrl} threw after ${elapsed}ms: ${msg}`,
    );
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
