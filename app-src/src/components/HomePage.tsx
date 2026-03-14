import { Search, LayoutGrid, Globe, Loader2, X } from "lucide-react";
import type { JSX } from "react";
import type { GameInfo } from "@shared/gfn";
import { GameCard } from "./GameCard";

export interface HomePageProps {
  games: GameInfo[];
  source: "main" | "library" | "public";
  onSourceChange: (source: "main" | "library" | "public") => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPlayGame: (game: GameInfo) => void;
  isLoading: boolean;
}

export function HomePage({
  games,
  source,
  onSourceChange,
  searchQuery,
  onSearchChange,
  onPlayGame,
  isLoading,
}: HomePageProps): JSX.Element {
  const hasGames = games.length > 0;
  const gameCountLabel = isLoading
    ? "Loading..."
    : `${games.length} game${games.length !== 1 ? "s" : ""}`;

  return (
    <div className="home-page">
      <header className="home-toolbar">
        <div className="home-toolbar-top">
          <div className="home-tabs" role="tablist" aria-label="Game catalog source">
            <button
              type="button"
              className={`home-tab ${source === "main" ? "active" : ""}`}
              onClick={() => onSourceChange("main")}
              disabled={isLoading}
              aria-pressed={source === "main"}
            >
              <LayoutGrid size={16} />
              Catalog
            </button>
            <button
              type="button"
              className={`home-tab ${source === "public" ? "active" : ""}`}
              onClick={() => onSourceChange("public")}
              disabled={isLoading}
              aria-pressed={source === "public"}
            >
              <Globe size={16} />
              Public
            </button>
          </div>

          <span className="home-count">{gameCountLabel}</span>
        </div>

        <div className="home-search">
          <Search className="home-search-icon" size={16} />
          <input
            type="text"
            className="home-search-input"
            placeholder="Search games..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="home-search-clear"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="home-grid-area">
        {isLoading ? (
          <div className="home-empty-state">
            <Loader2 className="home-spinner" size={36} />
            <p>Loading games...</p>
          </div>
        ) : !hasGames ? (
          <div className="home-empty-state">
            <LayoutGrid size={36} className="home-empty-icon" />
            <h3>No games found</h3>
            <p>
              {searchQuery
                ? "Try adjusting your search terms"
                : "Check back later for new additions"}
            </p>
          </div>
        ) : (
          <div className="game-grid">
            {games.map((game, index) => (
              <GameCard
                key={`${game.id}-${index}`}
                game={game}
                onPlay={() => onPlayGame(game)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
