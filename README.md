# OpenCloud Android

Android client for GeForce NOW streaming, built with Capacitor + React. Ports the OpenNOW desktop renderer to an Android APK with maximum feature parity.

## Architecture

```
OpenCloudAndroid/
├── app-src/                    # Web application source
│   ├── src/                    # React renderer (ported from OpenNOW)
│   │   ├── App.tsx             # Main application component
│   │   ├── components/         # UI components (login, settings, stream, etc.)
│   │   ├── gfn/                # WebRTC client, SDP, input protocol, HDR, mic
│   │   └── flight/             # Flight controls (WebHID - desktop only)
│   ├── shared/                 # Shared types (gfn.ts, flight configs)
│   └── platform/               # Platform abstraction layer
│       ├── openNowPlatform.ts  # OpenNowApi implementation for Android
│       └── gfn/                # Ported GFN backend modules
│           ├── auth.ts         # OAuth PKCE (Capacitor Browser + deep links)
│           ├── cloudmatch.ts   # Session create/poll/stop/claim
│           ├── signaling.ts    # Browser WebSocket signaling client
│           ├── games.ts        # Games GraphQL API
│           ├── subscription.ts # MES subscription API
│           ├── settings.ts     # Settings via Capacitor Preferences
│           ├── storage.ts      # Capacitor Preferences wrapper
│           ├── errorCodes.ts   # GFN error code mappings
│           └── types.ts        # CloudMatch request/response types
├── android/                    # Native Android project (Capacitor)
├── capacitor.config.ts         # Capacitor configuration
├── vite.config.ts              # Vite build configuration
└── package.json
```

### Platform Adapter

The desktop app uses Electron IPC (`window.openNow.*` via preload bridge). On Android, `platform/openNowPlatform.ts` implements the same `OpenNowApi` interface using:

- **Auth**: OAuth PKCE flow via Capacitor Browser plugin + deep link callback (`com.opencloud.android://auth/callback`)
- **Sessions**: Direct `fetch()` to NVIDIA CloudMatch API
- **Signaling**: Browser-native `WebSocket` (replaces Node.js `ws` module)
- **Storage**: Capacitor Preferences (replaces Electron `app.getPath` + fs)
- **Settings**: JSON serialized to Capacitor Preferences

## Prerequisites

- Node.js 20+
- Java 21 (JDK)
- Android SDK (API 35, Build Tools 35.0.0)
- Android Studio (optional, for emulator/device debugging)

## Setup

```bash
# Install dependencies
npm install

# Build web assets
npm run build

# Add/sync Android project
npx cap sync android
```

## Building APK Locally

```bash
# Build web + sync
npm run cap:build

# Build debug APK
cd android
./gradlew assembleDebug

# APK output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Environment Variables for Gradle

If `ANDROID_HOME` is not set:

```bash
export ANDROID_HOME=$HOME/Android/Sdk  # or wherever your SDK is
export JAVA_HOME=/path/to/jdk-21
```

## Development

```bash
# Start Vite dev server
npm run dev

# Open in Android Studio
npx cap open android
```

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`) automatically:
- Builds a debug APK on every push/PR to `main`
- Uploads APK as artifact (30-day retention)
- Optionally builds signed release APK if these secrets are set:
  - `KEYSTORE_BASE64`: Base64-encoded release keystore
  - `KEYSTORE_PASSWORD`: Keystore password
  - `KEY_ALIAS`: Signing key alias
  - `KEY_PASSWORD`: Signing key password

## Known Limitations vs Desktop

| Feature | Desktop | Android | Notes |
|---------|---------|---------|-------|
| Discord Rich Presence | ✅ | ❌ | Not available on Android |
| HDR streaming | ✅ | ❌ | Forced SDR; HDR UI hidden |
| Flight controls (HOTAS) | ✅ | ❌ | WebHID not available on Android |
| Pointer lock | ✅ | ⚠️ | Limited browser support |
| Keyboard shortcuts | ✅ | ⚠️ | Physical keyboard only |
| Clipboard paste | ✅ | ⚠️ | Platform dependent |
| Window resize | ✅ | N/A | Fixed to screen size |
| Video decode backend | Configurable | Auto | Android handles codec selection |
| HEVC compat mode | Configurable | Auto | Android handles codec selection |
| Session clock | ✅ | ✅ | Works identically |
| Microphone | ✅ | ✅ | Requires RECORD_AUDIO permission |
| Touch input | N/A | ✅ | Touch mapped to mouse |
| Controller (Gamepad API) | ✅ | ✅ | Via Gamepad API |
| Back button | N/A | ✅ | Confirms before ending stream |
| Immersive mode | N/A | ✅ | During streaming |

## Authentication Flow (Android)

1. User taps login → `Browser.open()` opens NVIDIA OAuth page
2. User authenticates → redirected to `com.opencloud.android://auth/callback?code=...`
3. Deep link intent received → `CapApp.addListener("appUrlOpen")` fires
4. Auth code exchanged for tokens via PKCE flow
5. Tokens stored in Capacitor Preferences
6. Session restored on next launch via refresh token

## License

See upstream OpenNOW project for license terms.
