import { Component } from "react";
import type { ErrorInfo, ReactNode, JSX } from "react";
import { getDebugText } from "../../platform/debugLog";

interface Props {
  children: ReactNode;
  onGoHome?: () => void;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  private handleCopy = (): void => {
    const { error, errorInfo } = this.state;
    const debugLines = getDebugText(100);
    const parts = [
      `Error: ${error?.message ?? "Unknown"}`,
      `Stack: ${error?.stack ?? "N/A"}`,
      `Component: ${errorInfo?.componentStack ?? "N/A"}`,
      `---`,
      `Debug log (last 100 lines):`,
      debugLines,
    ];
    const text = parts.join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
  };

  private handleGoHome = (): void => {
    this.setState({ error: null, errorInfo: null });
    this.props.onGoHome?.();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    const { error, errorInfo } = this.state;
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Something went wrong</h2>
          <p style={styles.message}>{error?.message ?? "Unknown error"}</p>
          <pre style={styles.stack}>
            {error?.stack ?? "No stack trace"}
            {errorInfo?.componentStack
              ? `\n\nComponent stack:${errorInfo.componentStack}`
              : ""}
          </pre>
          <div style={styles.buttons}>
            <button style={styles.copyBtn} onClick={this.handleCopy}>
              Copy debug logs
            </button>
            <button style={styles.homeBtn} onClick={this.handleGoHome}>
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0b1220",
    zIndex: 99999,
    padding: 16,
  },
  card: {
    maxWidth: 600,
    width: "100%",
    background: "#151d2e",
    border: "1px solid #c0392b",
    borderRadius: 12,
    padding: 24,
    color: "#e0e0e0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  title: {
    margin: "0 0 8px",
    fontSize: 20,
    color: "#e74c3c",
    fontWeight: 600,
  },
  message: {
    margin: "0 0 12px",
    fontSize: 14,
    color: "#f5b7b1",
    lineHeight: 1.4,
  },
  stack: {
    margin: "0 0 16px",
    padding: 12,
    background: "#0d1117",
    border: "1px solid #2d333b",
    borderRadius: 8,
    fontSize: 11,
    lineHeight: 1.5,
    color: "#8b949e",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 260,
    overflow: "auto",
    userSelect: "text",
    WebkitUserSelect: "text",
  },
  buttons: {
    display: "flex",
    gap: 12,
  },
  copyBtn: {
    flex: 1,
    padding: "10px 16px",
    background: "#2d333b",
    color: "#e0e0e0",
    border: "1px solid #444c56",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  homeBtn: {
    flex: 1,
    padding: "10px 16px",
    background: "#238636",
    color: "#ffffff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
};
