import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX, RefObject } from "react";

import type { StreamRegion, SubscriptionInfo } from "@shared/gfn";

import { LoginScreen } from "./components/LoginScreen";
import { BottomTabBar, TopHeader } from "./components/Navbar";
import { HomePage } from "./components/HomePage";
import { LibraryPage } from "./components/LibraryPage";
import { SettingsPage } from "./components/SettingsPage";
import { StreamLoading } from "./components/StreamLoading";
import { StreamView } from "./components/StreamView";
import { TouchInput } from "./components/TouchInput";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { useAuth } from "./hooks/useAuth";
import { useGames } from "./hooks/useGames";
import { useSettings } from "./hooks/useSettings";
import { toLoadingStatus, useStreamSession } from "./hooks/useStreamSession";

type AppPage = "home" | "library" | "settings";

// Keep desktop shortcut defaults as persisted-setting fallbacks even though Android hides the shortcut editor UI.
const DEFAULT_SHORTCUTS = {
  shortcutToggleStats: "F3",
  shortcutTogglePointerLock: "F8",
  shortcutStopStream: "Ctrl+Shift+Q",
  shortcutToggleAntiAfk: "Ctrl+Shift+K",
  shortcutToggleMic: "Ctrl+Shift+M",
} as const;

export function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<AppPage>("home");
  const [regions, setRegions] = useState<StreamRegion[]>([]);
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);

  const auth = useAuth();
  const { settings, updateSetting } = useSettings({ defaultShortcuts: DEFAULT_SHORTCUTS });
  const games = useGames({ authSession: auth.authSession, isInitializing: auth.isInitializing });
  const stream = useStreamSession({
    authSession: auth.authSession,
    setAuthSession: auth.setAuthSession,
    settings,
    games: games.games,
    libraryGames: games.libraryGames,
    defaultShortcuts: DEFAULT_SHORTCUTS,
  });

  useEffect(() => {
    if (!auth.authSession) {
      setCurrentPage("home");
    }
  }, [auth.authSession]);

  const refreshAccountData = useCallback(async () => {
    if (!auth.authSession) {
      setRegions([]);
      setSubscriptionInfo(null);
      return;
    }

    const token = auth.authSession.tokens.idToken ?? auth.authSession.tokens.accessToken;

    try {
      const discovered = await window.openNow.getRegions({ token });
      setRegions(discovered);
    } catch (error) {
      console.warn("Failed to load regions:", error);
      setRegions([]);
    }

    try {
      const subscription = await window.openNow.fetchSubscription({
        token,
        providerStreamingBaseUrl: auth.authSession.provider.streamingServiceUrl,
        userId: auth.authSession.user.userId,
      });
      setSubscriptionInfo(subscription);
    } catch (error) {
      console.warn("Failed to load subscription info:", error);
      setSubscriptionInfo(null);
    }
  }, [auth.authSession]);

  useEffect(() => {
    void refreshAccountData();
  }, [refreshAccountData]);

  const filteredGames = useMemo(() => {
    const query = games.searchQuery.trim().toLowerCase();
    if (!query) return games.games;
    return games.games.filter((game) => game.title.toLowerCase().includes(query));
  }, [games.games, games.searchQuery]);

  const filteredLibraryGames = useMemo(() => {
    const query = games.searchQuery.trim().toLowerCase();
    if (!query) return games.libraryGames;
    return games.libraryGames.filter((game) => game.title.toLowerCase().includes(query));
  }, [games.libraryGames, games.searchQuery]);

  const handleRetryLoadAll = useCallback(async () => {
    await games.retryLoadAll();
    await refreshAccountData();
  }, [games.retryLoadAll, refreshAccountData]);

  const streamVideoRef = stream.videoRef as RefObject<HTMLVideoElement>;
  const streamAudioRef = stream.audioRef as RefObject<HTMLAudioElement>;

  if (!auth.authSession) {
    return (
      <LoginScreen
        providers={auth.providers}
        selectedProviderId={auth.providerIdpId}
        onProviderChange={auth.setProviderIdpId}
        onLogin={auth.handleLogin}
        isLoading={auth.isLoggingIn}
        error={auth.sessionExpiredMessage ?? auth.loginError}
        isInitializing={auth.isInitializing}
        statusMessage={auth.startupStatusMessage}
      />
    );
  }

  const showLaunchOverlay = stream.streamStatus !== "idle" || stream.launchError !== null;

  if (showLaunchOverlay) {
    const loadingStatus = stream.launchError ? stream.launchError.stage : toLoadingStatus(stream.streamStatus);

    return (
      <>
        {stream.streamStatus !== "idle" && (
          <>
            <StreamView
              videoRef={streamVideoRef}
              audioRef={streamAudioRef}
              stats={stream.diagnostics}
              showStats={stream.showStatsOverlay}
              shortcuts={stream.streamShortcuts}
              serverRegion={stream.session?.serverIp}
              connectedControllers={stream.diagnostics.connectedGamepads}
              antiAfkEnabled={stream.antiAfkEnabled}
              escHoldReleaseIndicator={stream.escHoldReleaseIndicator}
              exitPrompt={stream.exitPrompt}
              sessionElapsedSeconds={stream.sessionElapsedSeconds}
              sessionClockVisible={stream.sessionClockVisible}
              streamWarning={stream.streamWarning}
              isConnecting={stream.streamStatus === "connecting"}
              gameTitle={stream.streamingGame?.title ?? "Game"}
              micStatus={stream.micAudioState?.status ?? null}
              onToggleFullscreen={stream.handleToggleFullscreen}
              onConfirmExit={stream.handleExitPromptConfirm}
              onCancelExit={stream.handleExitPromptCancel}
              onEndSession={() => {
                void stream.handlePromptedStopStream();
              }}
            />
            {stream.streamStatus === "streaming" && (
              <TouchInput client={stream.clientRef.current} videoRef={stream.videoRef} />
            )}
          </>
        )}
        {stream.streamStatus !== "streaming" && (
          <StreamLoading
            gameTitle={stream.streamingGame?.title ?? "Game"}
            gameCover={stream.streamingGame?.imageUrl}
            status={loadingStatus}
            queuePosition={stream.queuePosition}
            provisioningElapsed={stream.provisioningElapsed}
            error={
              stream.launchError
                ? {
                    title: stream.launchError.title,
                    description: stream.launchError.description,
                    code: stream.launchError.codeLabel,
                  }
                : undefined
            }
            onCancel={() => {
              if (stream.launchError) {
                void stream.handleDismissLaunchError();
                return;
              }
              void stream.handlePromptedStopStream();
            }}
          />
        )}
      </>
    );
  }

  return (
    <ToastProvider>
      <ErrorBoundary onGoHome={() => setCurrentPage("home")}>
        <div className="app-container">
          {auth.startupRefreshNotice && (
            <div className={`auth-refresh-notice auth-refresh-notice--${auth.startupRefreshNotice.tone}`}>
              {auth.startupRefreshNotice.text}
            </div>
          )}

          <TopHeader
            user={auth.authSession.user}
            subscription={subscriptionInfo}
            activeSession={stream.navbarActiveSession}
            activeSessionGameTitle={stream.activeSessionGameTitle}
            isResumingSession={stream.isResumingNavbarSession}
            onResumeSession={() => {
              void stream.handleResumeFromNavbar();
            }}
            onLogout={auth.handleLogout}
          />

          <main className="main-content">
            {games.gamesError && (
              <div className="api-error-banner">
                <div className="api-error-banner-inner">
                  <div className="api-error-banner-text">
                    <strong>Failed to load data</strong>
                    <span>{games.gamesError.message}</span>
                  </div>
                  <button className="api-error-banner-retry" onClick={() => void handleRetryLoadAll()}>
                    Retry
                  </button>
                </div>
              </div>
            )}

            {currentPage === "home" && (
              <HomePage
                games={filteredGames}
                source={games.source}
                onSourceChange={games.loadGames}
                searchQuery={games.searchQuery}
                onSearchChange={games.setSearchQuery}
                onPlayGame={stream.handlePlayGame}
                isLoading={games.isLoadingGames}
              />
            )}

            {currentPage === "library" && (
              <LibraryPage
                games={filteredLibraryGames}
                searchQuery={games.searchQuery}
                onSearchChange={games.setSearchQuery}
                onPlayGame={stream.handlePlayGame}
                isLoading={games.isLoadingGames}
              />
            )}

            {currentPage === "settings" && (
              <SettingsPage settings={settings} regions={regions} onSettingChange={updateSetting} />
            )}
          </main>

          <BottomTabBar currentPage={currentPage} onNavigate={setCurrentPage} />
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
}
