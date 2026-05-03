"use client";
import { Component, type ReactNode } from "react";
import { Card } from "@/components/ui/card";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <Card className="p-6 text-center text-muted-foreground">
          <p>Something went wrong loading this section.</p>
          <button onClick={() => this.setState({ hasError: false })} className="mt-2 text-sm text-primary hover:underline">
            Try again
          </button>
        </Card>
      );
    }
    return this.props.children;
  }
}
