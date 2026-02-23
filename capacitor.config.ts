import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.opencloud.android",
  appName: "OpenCloud",
  webDir: "dist",
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    Browser: {
      presentationStyle: "fullscreen",
    },
  },
};

export default config;
