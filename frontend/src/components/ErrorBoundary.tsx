import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] items-center justify-center bg-slate-950 p-6">
          <div className="card max-w-md text-center">
            <h2 className="mb-2 text-lg font-semibold text-rose-400">
              Something went wrong
            </h2>
            <p className="mb-4 text-sm text-slate-400">
              An unexpected error occurred. Try refreshing the page.
            </p>
            <pre className="mb-4 max-h-32 overflow-auto rounded-lg bg-slate-900/50 p-3 text-left text-xs text-slate-500">
              {this.state.error?.message ?? "Unknown error"}
            </pre>
            <button
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
