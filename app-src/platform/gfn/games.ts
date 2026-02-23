import type { GameInfo, GameVariant } from "@shared/gfn";
import { nativeFetch } from "./nativeHttp";

const GRAPHQL_URL = "https://games.geforce.com/graphql";
const PANELS_QUERY_HASH = "f8e26265a5db5c20e1334a6872cf04b6e3970507697f6ae55a6ddefa5420daf0";
const APP_METADATA_QUERY_HASH = "39187e85b6dcf60b7279a5f233288b0a8b69a8b1dbcfb5b25555afdcb988f0d7";
const DEFAULT_LOCALE = "en_US";
const LCARS_CLIENT_ID = "ec7e38d4-03af-4b58-b131-cfb0495903ab";
const GFN_CLIENT_VERSION = "2.0.80.173";
const GFN_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 OpenCloudAndroid/1.0.0";

interface GraphQlResponse {
  data?: { panels: Array<{ name: string; sections: Array<{ items: Array<{ __typename: string; app?: AppData }> }> }> };
  errors?: Array<{ message: string }>;
}
interface AppMetaDataResponse {
  data?: { apps: { items: AppData[] } };
  errors?: Array<{ message: string }>;
}
interface AppData {
  id: string; title: string; description?: string; longDescription?: string;
  images?: { GAME_BOX_ART?: string; TV_BANNER?: string; HERO_IMAGE?: string };
  variants?: Array<{ id: string; appStore: string; supportedControls?: string[]; gfn?: { library?: { selected?: boolean } } }>;
  gfn?: { playType?: string; minimumMembershipTierLabel?: string };
}

function optimizeImage(url: string): string {
  return url.includes("img.nvidiagrid.net") ? `${url};f=webp;w=272` : url;
}
function isNumericId(value: string | undefined): value is string {
  return !!value && /^\d+$/.test(value);
}
function randomHuId(): string {
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

async function getVpcId(token: string, providerStreamingBaseUrl?: string): Promise<string> {
  const base = providerStreamingBaseUrl?.trim() || "https://prod.cloudmatchbeta.nvidiagrid.net/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  try {
    const response = await nativeFetch(`${normalizedBase}v2/serverInfo`, {
      headers: {
        Accept: "application/json", Authorization: `GFNJWT ${token}`,
        "nv-client-id": LCARS_CLIENT_ID, "nv-client-type": "NATIVE", "nv-client-version": GFN_CLIENT_VERSION,
        "nv-client-streamer": "NVIDIA-CLASSIC", "nv-device-os": "ANDROID", "nv-device-type": "SHIELD",
        "User-Agent": GFN_USER_AGENT,
      },
    });
    if (!response.ok) return "GFN-PC";
    const payload = (await response.json()) as { requestStatus?: { serverId?: string } };
    return payload.requestStatus?.serverId ?? "GFN-PC";
  } catch {
    return "GFN-PC";
  }
}

function appToGame(app: AppData): GameInfo {
  const variants: GameVariant[] = app.variants?.map((v) => ({ id: v.id, store: v.appStore, supportedControls: v.supportedControls ?? [] })) ?? [];
  const selectedVariantIndex = app.variants?.findIndex((v) => v.gfn?.library?.selected === true) ?? 0;
  const safeIndex = Math.max(0, selectedVariantIndex);
  const selectedVariant = variants[safeIndex];
  const selectedVariantId = selectedVariant?.id;
  const fallbackNumericVariantId = variants.find((v) => isNumericId(v.id))?.id;
  const launchAppId = isNumericId(selectedVariantId) ? selectedVariantId : fallbackNumericVariantId ?? (isNumericId(app.id) ? app.id : undefined);
  const imageUrl = app.images?.GAME_BOX_ART ?? app.images?.TV_BANNER ?? app.images?.HERO_IMAGE ?? undefined;
  return {
    id: `${app.id}:${selectedVariantId ?? "default"}`, uuid: app.id, launchAppId, title: app.title,
    description: app.description ?? app.longDescription, imageUrl: imageUrl ? optimizeImage(imageUrl) : undefined,
    playType: app.gfn?.playType, membershipTierLabel: app.gfn?.minimumMembershipTierLabel,
    selectedVariantIndex: Math.max(0, selectedVariantIndex), variants,
  };
}

async function fetchPanels(token: string, panelNames: string[], vpcId: string): Promise<GraphQlResponse> {
  const variables = JSON.stringify({ vpcId, locale: DEFAULT_LOCALE, panelNames });
  const extensions = JSON.stringify({ persistedQuery: { sha256Hash: PANELS_QUERY_HASH } });
  const requestType = panelNames.includes("LIBRARY") ? "panels/Library" : "panels/MainV2";
  const params = new URLSearchParams({ requestType, extensions, huId: randomHuId(), variables });
  const response = await nativeFetch(`${GRAPHQL_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json, text/plain, */*", "Content-Type": "application/graphql",
      Origin: "https://play.geforcenow.com", Referer: "https://play.geforcenow.com/",
      Authorization: `GFNJWT ${token}`, "nv-client-id": LCARS_CLIENT_ID, "nv-client-type": "NATIVE",
      "nv-client-version": GFN_CLIENT_VERSION, "nv-client-streamer": "NVIDIA-CLASSIC",
      "nv-device-os": "ANDROID", "nv-device-type": "SHIELD", "User-Agent": GFN_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Games GraphQL failed (${response.status})`);
  return (await response.json()) as GraphQlResponse;
}

function flattenPanels(payload: GraphQlResponse): GameInfo[] {
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join(", "));
  const games: GameInfo[] = [];
  for (const panel of payload.data?.panels ?? [])
    for (const section of panel.sections ?? [])
      for (const item of section.items ?? [])
        if (item.__typename === "GameItem" && item.app) games.push(appToGame(item.app));
  return games;
}

export async function fetchMainGamesWeb(token: string, providerStreamingBaseUrl?: string): Promise<GameInfo[]> {
  const vpcId = await getVpcId(token, providerStreamingBaseUrl);
  return flattenPanels(await fetchPanels(token, ["MAIN"], vpcId));
}

export async function fetchLibraryGamesWeb(token: string, providerStreamingBaseUrl?: string): Promise<GameInfo[]> {
  const vpcId = await getVpcId(token, providerStreamingBaseUrl);
  return flattenPanels(await fetchPanels(token, ["LIBRARY"], vpcId));
}

export async function fetchPublicGamesWeb(): Promise<GameInfo[]> {
  try {
    const response = await nativeFetch("https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-en-US.json", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{ id?: string | number; title?: string; steamUrl?: string; status?: string }>;
    if (!Array.isArray(data)) return [];
    return data.filter((g) => g.title && g.status === "AVAILABLE").map((g) => ({
      id: String(g.id ?? ""), title: g.title ?? "", variants: [], selectedVariantIndex: 0,
    }));
  } catch {
    return [];
  }
}

export async function resolveLaunchAppIdWeb(
  token: string, appIdOrUuid: string, providerStreamingBaseUrl?: string,
): Promise<string | null> {
  if (/^\d+$/.test(appIdOrUuid)) return appIdOrUuid;
  const vpcId = await getVpcId(token, providerStreamingBaseUrl);
  const variables = JSON.stringify({ vpcId, locale: DEFAULT_LOCALE, appIds: [appIdOrUuid] });
  const extensions = JSON.stringify({ persistedQuery: { sha256Hash: APP_METADATA_QUERY_HASH } });
  const params = new URLSearchParams({ requestType: "appMetaData", extensions, huId: randomHuId(), variables });
  try {
    const response = await nativeFetch(`${GRAPHQL_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json, text/plain, */*", "Content-Type": "application/graphql",
        Origin: "https://play.geforcenow.com", Referer: "https://play.geforcenow.com/",
        Authorization: `GFNJWT ${token}`, "nv-client-id": LCARS_CLIENT_ID, "nv-client-type": "NATIVE",
        "nv-client-version": GFN_CLIENT_VERSION, "User-Agent": GFN_USER_AGENT,
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as AppMetaDataResponse;
    const app = payload.data?.apps?.items?.[0];
    if (!app) return null;
    const game = appToGame(app);
    return game.launchAppId ?? null;
  } catch {
    return null;
  }
}
