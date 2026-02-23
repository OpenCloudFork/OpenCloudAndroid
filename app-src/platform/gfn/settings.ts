import type {
  VideoCodec, ColorQuality, VideoAccelerationPreference,
  FlightSlotConfig, HdrStreamingMode, MicMode, HevcCompatMode, VideoDecodeBackend,
} from "@shared/gfn";
import { defaultFlightSlots } from "@shared/gfn";
import { preferencesGet, preferencesSet } from "./storage";

export interface Settings {
  resolution: string;
  fps: number;
  maxBitrateMbps: number;
  codec: VideoCodec;
  decoderPreference: VideoAccelerationPreference;
  encoderPreference: VideoAccelerationPreference;
  colorQuality: ColorQuality;
  region: string;
  clipboardPaste: boolean;
  mouseSensitivity: number;
  shortcutToggleStats: string;
  shortcutTogglePointerLock: string;
  shortcutStopStream: string;
  shortcutToggleAntiAfk: string;
  windowWidth: number;
  windowHeight: number;
  discordPresenceEnabled: boolean;
  discordClientId: string;
  flightControlsEnabled: boolean;
  flightControlsSlot: number;
  flightSlots: FlightSlotConfig[];
  hdrStreaming: HdrStreamingMode;
  micMode: MicMode;
  micDeviceId: string;
  micGain: number;
  micNoiseSuppression: boolean;
  micAutoGainControl: boolean;
  micEchoCancellation: boolean;
  shortcutToggleMic: string;
  hevcCompatMode: HevcCompatMode;
  videoDecodeBackend: VideoDecodeBackend;
  sessionClockShowEveryMinutes: number;
  sessionClockShowDurationSeconds: number;
}

const SETTINGS_KEY = "app_settings";

export const DEFAULT_SETTINGS: Settings = {
  resolution: "1920x1080",
  fps: 60,
  maxBitrateMbps: 50,
  codec: "H264",
  decoderPreference: "auto",
  encoderPreference: "auto",
  colorQuality: "8bit_420",
  region: "",
  clipboardPaste: false,
  mouseSensitivity: 1,
  shortcutToggleStats: "F3",
  shortcutTogglePointerLock: "F8",
  shortcutStopStream: "Ctrl+Shift+Q",
  shortcutToggleAntiAfk: "Ctrl+Shift+K",
  windowWidth: 1400,
  windowHeight: 900,
  discordPresenceEnabled: false,
  discordClientId: "",
  flightControlsEnabled: false,
  flightControlsSlot: 3,
  flightSlots: defaultFlightSlots(),
  hdrStreaming: "off",
  micMode: "off",
  micDeviceId: "",
  micGain: 1.0,
  micNoiseSuppression: true,
  micAutoGainControl: true,
  micEchoCancellation: true,
  shortcutToggleMic: "Ctrl+Shift+M",
  hevcCompatMode: "auto",
  videoDecodeBackend: "auto",
  sessionClockShowEveryMinutes: 60,
  sessionClockShowDurationSeconds: 30,
};

let cachedSettings: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  if (cachedSettings) return { ...cachedSettings };
  try {
    const raw = await preferencesGet(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
      if (!Array.isArray(cachedSettings.flightSlots) || cachedSettings.flightSlots.length !== 4) {
        cachedSettings.flightSlots = defaultFlightSlots();
      }
    } else {
      cachedSettings = { ...DEFAULT_SETTINGS };
    }
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return { ...cachedSettings };
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  if (!cachedSettings) await loadSettings();
  cachedSettings![key] = value;
  await preferencesSet(SETTINGS_KEY, JSON.stringify(cachedSettings));
}

export async function resetSettings(): Promise<Settings> {
  cachedSettings = { ...DEFAULT_SETTINGS };
  await preferencesSet(SETTINGS_KEY, JSON.stringify(cachedSettings));
  return { ...cachedSettings };
}
