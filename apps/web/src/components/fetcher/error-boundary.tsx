"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { unstable_rethrow } from "next/navigation";
import { Component, type ReactNode, startTransition } from "react";

import { useRouter } from "@/i18n/navigation";

function ErrorNotice({
  message,
  onReset,
  retryLabel,
}: {
  message: string;
  onReset: () => void;
  retryLabel: string;
}) {
  const router = useRouter();

  return (
    <div
      className="flex flex-col items-center gap-3 p-6 text-center"
      role="alert"
    >
      <p className="text-muted-foreground text-sm">{message}</p>
      <Button
        onClick={() => {
          startTransition(() => {
            router.refresh();
            onReset();
          });
        }}
        size="sm"
        variant="outline"
      >
        {retryLabel}
      </Button>
    </div>
  );
}

type ComponentErrorBoundaryProps = {
  children: ReactNode;
  message: string;
  retryLabel: string;
};

type ComponentErrorBoundaryState = {
  error: unknown;
};

export class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  state: ComponentErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      // redirect()/notFound()/PPR bailout arrive here as ordinary render errors.
      unstable_rethrow(this.state.error);

      return (
        <ErrorNotice
          message={this.props.message}
          onReset={() => this.setState({ error: null })}
          retryLabel={this.props.retryLabel}
        />
      );
    }

    return this.props.children;
  }
}
