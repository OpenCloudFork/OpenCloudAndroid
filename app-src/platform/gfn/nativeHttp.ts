import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";

const TAG = "[NativeHttp]";

export class NativeResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  private readonly _data: unknown;

  constructor(response: HttpResponse) {
    this.status = response.status;
    this.ok = response.status >= 200 && response.status < 300;
    this.statusText = String(response.status);
    this.headers = response.headers ?? {};
    this._data = response.data;
  }

  async json(): Promise<unknown> {
    if (typeof this._data === "object" && this._data !== null) return this._data;
    if (typeof this._data === "string") return JSON.parse(this._data);
    return this._data;
  }

  async text(): Promise<string> {
    if (typeof this._data === "string") return this._data;
    if (typeof this._data === "object" && this._data !== null) return JSON.stringify(this._data);
    return String(this._data ?? "");
  }
}

interface NativeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
}

export async function nativeFetch(url: string, options: NativeFetchOptions = {}): Promise<NativeResponse> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  if (headers["Authorization"] || headers["authorization"]) {
    const val = headers["Authorization"] ?? headers["authorization"];
    const preview = val.length > 40 ? `${val.slice(0, 40)}…` : val;
    console.log(`${TAG} Auth header attached: ${preview}`);
  }

  let data: string | undefined;
  if (options.body) {
    if (options.body instanceof URLSearchParams) {
      data = options.body.toString();
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else {
      data = options.body;
    }
  }

  const httpOptions: HttpOptions = { url, method, headers, data };

  console.log(`${TAG} → ${method} ${url}`);
  const t0 = performance.now();

  try {
    const response = await CapacitorHttp.request(httpOptions);
    const elapsed = Math.round(performance.now() - t0);
    const nativeResp = new NativeResponse(response);

    if (!nativeResp.ok) {
      const bodyPreview = typeof response.data === "string"
        ? response.data.slice(0, 200)
        : JSON.stringify(response.data ?? "").slice(0, 200);
      console.warn(`${TAG} ✗ ${method} ${url} → ${response.status} (${elapsed}ms) | ${bodyPreview}`);
    } else {
      console.log(`${TAG} ✓ ${method} ${url} → ${response.status} (${elapsed}ms)`);
    }

    return nativeResp;
  } catch (error: unknown) {
    const elapsed = Math.round(performance.now() - t0);
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${TAG} ✗✗ ${method} ${url} threw after ${elapsed}ms: ${msg}`);
    throw error;
  }
}
