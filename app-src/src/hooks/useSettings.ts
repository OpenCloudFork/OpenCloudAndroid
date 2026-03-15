import { useCallback, useEffect, useState } from "react";

import type { Settings } from "@shared/gfn";

export interface DefaultShortcuts {
  shortcutToggleStats: string;
  shortcutTogglePointerLock: string;
  shortcutStopStream: string;
  shortcutToggleAntiAfk: string;
  shortcutToggleMic: string;
}

interface UseSettingsOptions {
  defaultShortcuts: DefaultShortcuts;
}

const INITIAL_SETTINGS = (defaultShortcuts: DefaultShortcuts): Settings => ({
  resolution: "1920x1080",
  fps: 60,
  maxBitrateMbps: 75,
  codec: "H264",
  decoderPreference: "auto",
  encoderPreference: "auto",
  colorQuality: "10bit_420",
  region: "",
  clipboardPaste: false,
  mouseSensitivity: 1,
  shortcutToggleStats: defaultShortcuts.shortcutToggleStats,
  shortcutTogglePointerLock: defaultShortcuts.shortcutTogglePointerLock,
  shortcutStopStream: defaultShortcuts.shortcutStopStream,
  shortcutToggleAntiAfk: defaultShortcuts.shortcutToggleAntiAfk,
  windowWidth: 1400,
  windowHeight: 900,
  discordPresenceEnabled: false,
  discordClientId: "",
  flightControlsEnabled: false,
  flightControlsSlot: 3,
  flightSlots: [],
  hdrStreaming: "off",
  micMode: "off",
  micDeviceId: "",
  micGain: 1.0,
  micNoiseSuppression: true,
  micAutoGainControl: true,
  micEchoCancellation: true,
  shortcutToggleMic: defaultShortcuts.shortcutToggleMic,
  hevcCompatMode: "auto",
  videoDecodeBackend: "auto",
  sessionClockShowEveryMinutes: 60,
  sessionClockShowDurationSeconds: 30,
  debugLogging: false,
});

export function useSettings({ defaultShortcuts }: UseSettingsOptions): {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
} {
  const [settings, setSettings] = useState<Settings>(() => INITIAL_SETTINGS(defaultShortcuts));
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const loadedSettings = await window.openNow.getSettings();
        if (cancelled) return;
        setSettings(loadedSettings);
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateSetting = useCallback(async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (settingsLoaded) {
      await window.openNow.setSetting(key, value);
    }
  }, [settingsLoaded]);

  return { settings, updateSetting };
}
