"use client";

import { BackgroundGradient } from "@rz-chain-reporter/ui/components/background-gradient";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { ASSISTANT_NAMESPACE } from "../constants";

let pageHost: HTMLDivElement | null = null;
let bodyRoot: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
const bodyRootListeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPageHost() {
  return pageHost;
}

function getServerPageHost() {
  return null;
}

function registerPageHost(node: HTMLDivElement) {
  pageHost = node;
  for (const listener of listeners) listener();

  return () => {
    if (pageHost !== node) return;
    pageHost = null;
    for (const listener of listeners) listener();
  };
}

function getBodyRoot() {
  return bodyRoot;
}

function subscribeBodyRoot(listener: () => void) {
  bodyRootListeners.add(listener);
  if (bodyRoot === null) {
    bodyRoot = globalThis.document.createElement("div");
    bodyRoot.className =
      "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden max-sm:**:data-[slot=message-scroller-button]:min-h-11 max-sm:**:data-[slot=message-scroller-button]:min-w-11";
    bodyRoot.dataset.assistantBodyRoot = "";
    for (const current of bodyRootListeners) current();
  }

  return () => bodyRootListeners.delete(listener);
}

function getServerBodyRoot() {
  return null;
}

export function useAssistantPageHost() {
  return useSyncExternalStore(subscribe, getPageHost, getServerPageHost);
}

export function useAssistantBodyRoot() {
  return useSyncExternalStore(
    subscribeBodyRoot,
    getBodyRoot,
    getServerBodyRoot,
  );
}

export function AssistantPageHost() {
  const t = useTranslations(ASSISTANT_NAMESPACE);

  return (
    <section className="flex h-[calc(100dvh-9rem)] min-h-0 flex-col gap-4">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-display">
          {t("page.title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          {t("page.description")}
        </p>
      </div>
      <BackgroundGradient
        className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 max-sm:**:data-[slot=button]:min-h-11 max-sm:**:data-[slot=button]:min-w-11 sm:p-4"
        containerClassName="flex min-h-0 flex-1 flex-col"
      >
        <section
          aria-label={t("page.workspaceLabel")}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          data-assistant-page-host
          data-assistant-surface
          ref={registerPageHost}
        />
      </BackgroundGradient>
    </section>
  );
}
