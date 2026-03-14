import { Library, Search, Clock, Gamepad2, Loader2, X } from "lucide-react";
import type { JSX } from "react";
import type { GameInfo } from "@shared/gfn";
import { GameCard } from "./GameCard";

export interface LibraryPageProps {
  games: GameInfo[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPlayGame: (game: GameInfo) => void;
  isLoading: boolean;
}

function formatLastPlayed(date?: string): string {
  if (!date) return "Never played";

  const lastPlayed = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - lastPlayed.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return lastPlayed.toLocaleDateString();
}

export function LibraryPage({
  games,
  searchQuery,
  onSearchChange,
  onPlayGame,
  isLoading,
}: LibraryPageProps): JSX.Element {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredGames = normalizedSearchQuery
    ? games.filter((game) =>
        game.title.toLowerCase().includes(normalizedSearchQuery)
      )
    : games;
  const visibleGameCount = normalizedSearchQuery ? filteredGames.length : games.length;

  return (
    <div className="library-page">
      <header className="library-toolbar">
        <div className="library-toolbar-top">
          <div className="library-title">
            <Library className="library-title-icon" size={20} />
            <h1>My Library</h1>
          </div>

          <span className="library-count">
            {isLoading
              ? "Loading..."
              : `${visibleGameCount} game${visibleGameCount !== 1 ? "s" : ""}`}
          </span>
        </div>

        <div className="library-search">
          <Search className="library-search-icon" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search your library..."
            className="library-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="library-search-clear"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="library-grid-area">
        {isLoading ? (
          <div className="library-empty-state">
            <Loader2 className="library-spinner" size={36} />
            <p>Loading your library...</p>
          </div>
        ) : games.length === 0 ? (
          <div className="library-empty-state">
            <Gamepad2 className="library-empty-icon" size={36} />
            <h3>Your library is empty</h3>
            <p>Games you own will appear here. Browse the catalog to find games.</p>
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="library-empty-state">
            <Search className="library-empty-icon" size={36} />
            <h3>No results</h3>
            <p>No games match &ldquo;{searchQuery}&rdquo;</p>
          </div>
        ) : (
          <div className="game-grid">
            {filteredGames.map((game, index) => (
              <div key={`${game.id}-${index}`} className="library-game-wrapper">
                <GameCard game={game} onPlay={() => onPlayGame(game)} />
                {game.lastPlayed && (
                  <div className="library-last-played">
                    <Clock size={12} />
                    <span>{formatLastPlayed(game.lastPlayed)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
