"use client";
import { Component, type ReactNode } from "react";
import { Card } from "@/components/ui/card";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: unknown) {
    // Surface in console for debugging — UI degrades to the card below.
    console.error("[ErrorBoundary]", error);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <Card className="p-8 text-center border-warm-border bg-warm-white">
          <p className="text-sm font-semibold text-charcoal">Something went wrong loading this section.</p>
          <p className="text-xs text-text-secondary mt-1">
            The rest of the dashboard is unaffected. You can retry this section or reload the page.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gold text-white hover:bg-gold-dark transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-warm-border text-text-secondary hover:bg-warm-gray hover:text-charcoal transition-colors"
            >
              Reload page
            </button>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}
