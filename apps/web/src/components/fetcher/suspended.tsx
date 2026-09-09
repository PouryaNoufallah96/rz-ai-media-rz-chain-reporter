import "server-only";

import { type ReactNode, Suspense, ViewTransition } from "react";
import type {} from "react/canary";

import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { getT } from "@/i18n/server";

import { ComponentErrorBoundary } from "./error-boundary";

type Source<T> = Promise<T> | (() => Promise<T>);

type ResolvedProps<T> = {
  children: (data: T) => ReactNode;
  data: Source<T>;
  empty?: ReactNode;
};

async function Resolved<T>({ children, data, empty = null }: ResolvedProps<T>) {
  const resolved = typeof data === "function" ? await data() : await data;

  if (resolved === null || resolved === undefined) {
    return empty;
  }

  return children(resolved);
}

type SuspendedProps<T> = ResolvedProps<T> & {
  fallback: ReactNode;
};

export function UrlDataBoundary({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export async function Suspended<T>({
  children,
  data,
  empty,
  fallback,
}: SuspendedProps<T>) {
  const t = await getT(SHARED_NAMESPACE);

  return (
    <ComponentErrorBoundary
      message={t("error.message")}
      retryLabel={t("error.retry")}
    >
      <Suspense
        fallback={
          <ViewTransition default="none" exit="page-fade">
            {fallback}
          </ViewTransition>
        }
      >
        <ViewTransition default="none" enter="page-fade">
          <Resolved data={data} empty={empty}>
            {children}
          </Resolved>
        </ViewTransition>
      </Suspense>
    </ComponentErrorBoundary>
  );
}
