import type { SubscriptionInfo, EntitledResolution, StorageAddon, StreamRegion } from "@shared/gfn";
import { httpGet } from "../http";

const MES_URL = "https://mes.geforcenow.com/v4/subscriptions";
const LCARS_CLIENT_ID = "ec7e38d4-03af-4b58-b131-cfb0495903ab";
const GFN_CLIENT_VERSION = "2.0.80.173";

interface SubscriptionResponse {
  firstEntitlementStartDateTime?: string;
  type?: string;
  membershipTier?: string;
  allottedTimeInMinutes?: number;
  purchasedTimeInMinutes?: number;
  rolledOverTimeInMinutes?: number;
  remainingTimeInMinutes?: number;
  totalTimeInMinutes?: number;
  notifications?: {
    notifyUserWhenTimeRemainingInMinutes?: number;
    notifyUserOnSessionWhenRemainingTimeInMinutes?: number;
  };
  currentSpanStartDateTime?: string;
  currentSpanEndDateTime?: string;
  currentSubscriptionState?: { state?: string; isGamePlayAllowed?: boolean };
  subType?: string;
  addons?: Array<{
    type?: string;
    subType?: string;
    status?: string;
    attributes?: Array<{ key?: string; textValue?: string }>;
  }>;
  features?: { resolutions?: Array<{ heightInPixels: number; widthInPixels: number; framesPerSecond: number; isEntitled: boolean }> };
}

function parseMinutes(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseNumberText(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseIsoDate(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function fetchSubscriptionWeb(
  token: string,
  userId: string,
  vpcId = "NP-AMS-08",
): Promise<SubscriptionInfo> {
  const url = new URL(MES_URL);
  url.searchParams.append("serviceName", "gfn_pc");
  url.searchParams.append("languageCode", "en_US");
  url.searchParams.append("vpcId", vpcId);
  url.searchParams.append("userId", userId);

  const response = await httpGet(url.toString(), {
    headers: {
      Authorization: `GFNJWT ${token}`,
      Accept: "application/json",
      "nv-client-id": LCARS_CLIENT_ID,
      "nv-client-type": "NATIVE",
      "nv-client-version": GFN_CLIENT_VERSION,
      "nv-client-streamer": "NVIDIA-CLASSIC",
      "nv-device-os": "ANDROID",
      "nv-device-type": "SHIELD",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Subscription API failed with status ${response.status}: ${body}`);
  }

  const data = (await response.json()) as SubscriptionResponse;
  const membershipTier = data.membershipTier ?? "FREE";

  const allottedMinutes = parseMinutes(data.allottedTimeInMinutes) ?? 0;
  const purchasedMinutes = parseMinutes(data.purchasedTimeInMinutes) ?? 0;
  const rolledOverMinutes = parseMinutes(data.rolledOverTimeInMinutes) ?? 0;
  const fallbackTotalMinutes = allottedMinutes + purchasedMinutes + rolledOverMinutes;
  const totalMinutes = parseMinutes(data.totalTimeInMinutes) ?? fallbackTotalMinutes;
  const remainingMinutes = parseMinutes(data.remainingTimeInMinutes) ?? 0;
  const usedMinutes = Math.max(totalMinutes - remainingMinutes, 0);

  let storageAddon: StorageAddon | undefined;
  const storageAddonResp = data.addons?.find(
    (a) => a.type === "STORAGE" && a.subType === "PERMANENT_STORAGE" && a.status === "OK",
  );
  if (storageAddonResp) {
    storageAddon = {
      type: "PERMANENT_STORAGE",
      sizeGb: parseNumberText(storageAddonResp.attributes?.find((a) => a.key === "TOTAL_STORAGE_SIZE_IN_GB")?.textValue),
      usedGb: parseNumberText(storageAddonResp.attributes?.find((a) => a.key === "USED_STORAGE_SIZE_IN_GB")?.textValue),
      regionName: storageAddonResp.attributes?.find((a) => a.key === "STORAGE_METRO_REGION_NAME")?.textValue,
      regionCode: storageAddonResp.attributes?.find((a) => a.key === "STORAGE_METRO_REGION")?.textValue,
    };
  }

  const entitledResolutions: EntitledResolution[] = [];
  if (data.features?.resolutions) {
    for (const res of data.features.resolutions) {
      entitledResolutions.push({ width: res.widthInPixels, height: res.heightInPixels, fps: res.framesPerSecond });
    }
    entitledResolutions.sort((a, b) => b.width !== a.width ? b.width - a.width : b.height !== a.height ? b.height - a.height : b.fps - a.fps);
  }

  return {
    membershipTier,
    subscriptionType: data.type,
    subscriptionSubType: data.subType,
    allottedHours: allottedMinutes / 60,
    purchasedHours: purchasedMinutes / 60,
    rolledOverHours: rolledOverMinutes / 60,
    usedHours: usedMinutes / 60,
    remainingHours: remainingMinutes / 60,
    totalHours: totalMinutes / 60,
    firstEntitlementStartDateTime: parseIsoDate(data.firstEntitlementStartDateTime),
    serverRegionId: vpcId,
    currentSpanStartDateTime: parseIsoDate(data.currentSpanStartDateTime),
    currentSpanEndDateTime: parseIsoDate(data.currentSpanEndDateTime),
    notifyUserWhenTimeRemainingInMinutes: parseMinutes(data.notifications?.notifyUserWhenTimeRemainingInMinutes),
    notifyUserOnSessionWhenRemainingTimeInMinutes: parseMinutes(data.notifications?.notifyUserOnSessionWhenRemainingTimeInMinutes),
    state: data.currentSubscriptionState?.state,
    isGamePlayAllowed: data.currentSubscriptionState?.isGamePlayAllowed,
    isUnlimited: data.subType === "UNLIMITED",
    storageAddon,
    entitledResolutions,
  };
}

export async function fetchDynamicRegionsWeb(
  token: string | undefined,
  streamingBaseUrl: string,
): Promise<{ regions: StreamRegion[]; vpcId: string | null }> {
  const base = streamingBaseUrl.endsWith("/") ? streamingBaseUrl : `${streamingBaseUrl}/`;
  const url = `${base}v2/serverInfo`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "nv-client-id": LCARS_CLIENT_ID,
    "nv-client-type": "BROWSER",
    "nv-client-version": GFN_CLIENT_VERSION,
    "nv-client-streamer": "WEBRTC",
    "nv-device-os": "ANDROID",
    "nv-device-type": "SHIELD",
  };
  if (token) headers.Authorization = `GFNJWT ${token}`;

  try {
    const response = await httpGet(url, { headers });
    if (!response.ok) return { regions: [], vpcId: null };

    const data = (await response.json()) as { requestStatus?: { serverId?: string }; metaData?: Array<{ key: string; value: string }> };
    const vpcId = data.requestStatus?.serverId ?? null;
    const regions = (data.metaData ?? [])
      .filter((e) => e.value.startsWith("https://") && e.key !== "gfn-regions" && !e.key.startsWith("gfn-"))
      .map<StreamRegion>((e) => ({ name: e.key, url: e.value.endsWith("/") ? e.value : `${e.value}/` }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { regions, vpcId };
  } catch {
    return { regions: [], vpcId: null };
  }
}
