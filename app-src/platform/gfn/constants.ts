/** GFN API user agent string — mimics the official Windows client */
export const GFN_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 NVIDIACEFClient/HEAD/debb5919f6 GFN-PC/2.0.80.173";

/** Client version reported to NVIDIA APIs */
export const GFN_CLIENT_VERSION = "2.0.80.173";

/** OAuth client ID for NVIDIA login */
export const NVIDIA_CLIENT_ID = "ZU7sPN-miLujMD95LfOQ453IB0AtjM8sMyvgJ9wCXEQ";

/** OAuth redirect port (same as desktop OpenNOW) */
export const AUTH_REDIRECT_PORT = 2259;
export const AUTH_REDIRECT_URI = `http://localhost:${AUTH_REDIRECT_PORT}`;

/** OAuth scopes */
export const NVIDIA_SCOPES = "openid consent email tk_client age offline_access";

/** Default IDP ID */
export const DEFAULT_IDP_ID = "PDiAhv2kJTFeQ7WOPqiQ2tRZ7lGhR2X11dXvM4TZSxg";

export const SESSION_STATUS = {
  QUEUED: 0,
  PROVISIONING: 1,
  READY: 2,
  STREAMING: 3,
  STOPPED: 5,
  ACTIVE: 6,
} as const;
