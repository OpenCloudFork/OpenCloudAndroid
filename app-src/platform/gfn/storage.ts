import { Preferences } from "@capacitor/preferences";

export async function preferencesGet(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key });
  return value;
}

export async function preferencesSet(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value });
}

export async function preferencesRemove(key: string): Promise<void> {
  await Preferences.remove({ key });
}
