import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthSession, LoginProvider } from "@shared/gfn";

interface StartupRefreshNotice {
  tone: "success" | "warn";
  text: string;
}

interface UseAuthResult {
  authSession: AuthSession | null;
  providers: LoginProvider[];
  providerIdpId: string;
  setProviderIdpId: React.Dispatch<React.SetStateAction<string>>;
  isLoggingIn: boolean;
  loginError: string | null;
  isInitializing: boolean;
  startupStatusMessage: string;
  sessionExpiredMessage: string | null;
  startupRefreshNotice: StartupRefreshNotice | null;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  setAuthSession: React.Dispatch<React.SetStateAction<AuthSession | null>>;
}

export function useAuth(): UseAuthResult {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [providerIdpId, setProviderIdpId] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [startupStatusMessage, setStartupStatusMessage] = useState("Restoring saved session...");
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [startupRefreshNotice, setStartupRefreshNotice] = useState<StartupRefreshNotice | null>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    if (!startupRefreshNotice) return;
    const timer = window.setTimeout(() => setStartupRefreshNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [startupRefreshNotice]);

  useEffect(() => {
    if (!sessionExpiredMessage) return;
    const timer = window.setTimeout(() => setSessionExpiredMessage(null), 10000);
    return () => window.clearTimeout(timer);
  }, [sessionExpiredMessage]);

  useEffect(() => {
    const unsubscribe = window.openNow.onSessionExpired((reason: string) => {
      console.warn("[App] Session expired:", reason);
      setSessionExpiredMessage(reason);
      setAuthSession(null);
      setLoginError(null);
      setStartupRefreshNotice(null);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const initialize = async () => {
      try {
        setStartupStatusMessage("Restoring saved session and refreshing token...");
        const [providerList, sessionResult] = await Promise.all([
          window.openNow.getLoginProviders(),
          window.openNow.getAuthSession({ forceRefresh: true }),
        ]);
        const persistedSession = sessionResult.session;

        if (sessionResult.refresh.outcome === "refreshed") {
          setStartupRefreshNotice({
            tone: "success",
            text: "Session restored. Token refreshed.",
          });
          setStartupStatusMessage("Token refreshed. Loading your account...");
        } else if (sessionResult.refresh.outcome === "failed") {
          setStartupRefreshNotice({
            tone: "warn",
            text: "Token refresh failed. Using saved session token.",
          });
          setStartupStatusMessage("Token refresh failed. Continuing with saved session...");
        } else if (sessionResult.refresh.outcome === "missing_refresh_token") {
          setStartupStatusMessage("Saved session has no refresh token. Continuing...");
        } else if (persistedSession) {
          setStartupStatusMessage("Session restored.");
        } else {
          setStartupStatusMessage("No saved session found.");
        }

        setIsInitializing(false);
        setProviders(providerList);
        setAuthSession(persistedSession);
        setProviderIdpId(persistedSession?.provider?.idpId ?? providerList[0]?.idpId ?? "");
      } catch (error) {
        console.error("Initialization failed:", error);
        setStartupStatusMessage("Session restore failed. Please sign in again.");
        setIsInitializing(false);
      }
    };

    void initialize();
  }, []);

  const handleLogin = useCallback(async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    setSessionExpiredMessage(null);

    try {
      const session = await window.openNow.login({ providerIdpId: providerIdpId || undefined });
      setAuthSession(session);
      setProviderIdpId(session.provider.idpId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      console.error("[App] Login failed:", message);
      setLoginError(message);
    } finally {
      setIsLoggingIn(false);
    }
  }, [providerIdpId]);

  const handleLogout = useCallback(async () => {
    await window.openNow.logout();
    setAuthSession(null);
    setLoginError(null);
    setSessionExpiredMessage(null);
  }, []);

  return {
    authSession,
    providers,
    providerIdpId,
    setProviderIdpId,
    isLoggingIn,
    loginError,
    isInitializing,
    startupStatusMessage,
    sessionExpiredMessage,
    startupRefreshNotice,
    handleLogin,
    handleLogout,
    setAuthSession,
  };
}
