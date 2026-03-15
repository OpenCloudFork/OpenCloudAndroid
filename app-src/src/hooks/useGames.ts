import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AuthSession, GameInfo } from "@shared/gfn";

export type GameSource = "main" | "library" | "public";

type GamesError = { message: string; status?: number } | null;

interface UseGamesOptions {
  authSession: AuthSession | null;
  isInitializing: boolean;
}

function sessionIdentity(session: AuthSession | null): string {
  if (!session) return "public";
  return `${session.user.userId}:${session.provider.idpId}`;
}

export function useGames({ authSession, isInitializing }: UseGamesOptions): {
  games: GameInfo[];
  libraryGames: GameInfo[];
  isLoadingGames: boolean;
  gamesError: GamesError;
  source: GameSource;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  loadGames: (targetSource: GameSource) => Promise<void>;
  retryLoadAll: () => Promise<void>;
} {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [libraryGames, setLibraryGames] = useState<GameInfo[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [gamesError, setGamesError] = useState<GamesError>(null);
  const [source, setSource] = useState<GameSource>("main");
  const [searchQuery, setSearchQuery] = useState("");
  const requestIdRef = useRef(0);
  const authIdentity = useMemo(() => sessionIdentity(authSession), [authSession]);

  useEffect(() => {
    if (isInitializing) return;

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    const loadInitialGames = async () => {
      setIsLoadingGames(true);

      try {
        if (authSession) {
          const token = authSession.tokens.idToken ?? authSession.tokens.accessToken;
          const baseUrl = authSession.provider.streamingServiceUrl;

          try {
            const mainGames = await window.openNow.fetchMainGames({
              token,
              providerStreamingBaseUrl: baseUrl,
            });
            if (cancelled || requestIdRef.current !== requestId) return;
            setGames(mainGames);
            setSource("main");

            const library = await window.openNow.fetchLibraryGames({
              token,
              providerStreamingBaseUrl: baseUrl,
            });
            if (cancelled || requestIdRef.current !== requestId) return;
            setLibraryGames(library);
            setGamesError(null);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[App] Games fetch failed:", message);
            if (cancelled || requestIdRef.current !== requestId) return;
            setGamesError({ message });
          }
        }

        const publicGames = await window.openNow.fetchPublicGames();
        if (cancelled || requestIdRef.current !== requestId) return;
        setGames(publicGames);
        setLibraryGames([]);
        setSource("public");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[App] Failed to load initial games:", message);
        if (cancelled || requestIdRef.current !== requestId) return;
        setGamesError({ message });
      } finally {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoadingGames(false);
        }
      }
    };

    void loadInitialGames();

    return () => {
      cancelled = true;
    };
  }, [authIdentity, authSession, isInitializing]);

  const loadGames = useCallback(async (targetSource: GameSource) => {
    const requestId = ++requestIdRef.current;
    setIsLoadingGames(true);

    try {
      const token = authSession?.tokens.idToken ?? authSession?.tokens.accessToken;
      const baseUrl = authSession?.provider.streamingServiceUrl ?? "";

      let result: GameInfo[] = [];
      if (targetSource === "main" && token) {
        result = await window.openNow.fetchMainGames({ token, providerStreamingBaseUrl: baseUrl });
      } else if (targetSource === "library" && token) {
        result = await window.openNow.fetchLibraryGames({ token, providerStreamingBaseUrl: baseUrl });
        if (requestIdRef.current !== requestId) return;
        setLibraryGames(result);
      } else if (targetSource === "public") {
        result = await window.openNow.fetchPublicGames();
      }

      if (requestIdRef.current !== requestId) return;

      if (targetSource !== "library") {
        setGames(result);
        setSource(targetSource);
      }
      setGamesError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[App] Failed to load games:", message);
      if (requestIdRef.current !== requestId) return;
      setGamesError({ message });
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoadingGames(false);
      }
    }
  }, [authSession]);

  const retryLoadAll = useCallback(async () => {
    if (!authSession) return;

    const requestId = ++requestIdRef.current;
    setGamesError(null);
    setIsLoadingGames(true);

    const token = authSession.tokens.idToken ?? authSession.tokens.accessToken;
    const baseUrl = authSession.provider.streamingServiceUrl;

    try {
      const [mainGames, library] = await Promise.all([
        window.openNow.fetchMainGames({ token, providerStreamingBaseUrl: baseUrl }),
        window.openNow.fetchLibraryGames({ token, providerStreamingBaseUrl: baseUrl }),
      ]);

      if (requestIdRef.current !== requestId) return;
      setGames(mainGames);
      setSource("main");
      setLibraryGames(library);
      setGamesError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[App] Retry load failed:", message);
      if (requestIdRef.current !== requestId) return;
      setGamesError({ message });
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoadingGames(false);
      }
    }
  }, [authSession]);

  return {
    games,
    libraryGames,
    isLoadingGames,
    gamesError,
    source,
    searchQuery,
    setSearchQuery,
    loadGames,
    retryLoadAll,
  };
}
