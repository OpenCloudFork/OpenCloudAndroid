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
│           ├── auth.ts         # OAuth PKCE via native WebView (localhost redirect)
│           ├── authWebView.ts  # Capacitor plugin bridge for native auth WebView
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

- **Auth**: OAuth PKCE flow via native Android WebView plugin that intercepts the `http://localhost:2259` redirect (same redirect URI as desktop OpenNOW)
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

Android auth uses the same NVIDIA login flow as desktop OpenNOW — **not** a custom redirect URI scheme.

1. User taps login → native `AuthWebViewPlugin` opens NVIDIA OAuth page in an Android WebView
2. OAuth URL uses `redirect_uri=http://localhost:2259` (same as desktop)
3. User authenticates on NVIDIA's login page
4. WebView intercepts the `http://localhost:2259?code=...` redirect before it loads
5. Auth code extracted and exchanged for tokens via PKCE flow
6. Tokens stored in Capacitor Preferences
7. Session restored on next launch via refresh token

This avoids the `invalid_redirect_uri` error that occurs with custom URI schemes (`com.opencloud.android://...`) since only the `http://localhost:PORT` redirects are registered with NVIDIA's OAuth server.

## License

See upstream OpenNOW project for license terms.
