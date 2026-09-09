"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useRef,
  useState,
} from "react";

import { ASSISTANT_NAMESPACE } from "../constants";
import type { AssistantActiveCard } from "../schemas/chat-request";

export type AssistantIdentity = {
  operatorId: string;
  workspaceId: string;
};

export type AssistantCardLimits = {
  copyByPlatform: Record<string, number>;
  headline: number;
};

type AssistantContextValue = {
  askAboutCard: (card: AssistantActiveCard) => void;
  // The assistant catalog is out of scope where a feature screen mounts its own
  // namespaces, so the one label a Card Sheet needs travels with the context.
  askAboutCardLabel: string;
  cardTruncated: boolean;
  brandKeys: readonly string[];
  card: AssistantActiveCard | null;
  clearCard: () => void;
  focusToken: number;
  open: boolean;
  pinCard: (card: AssistantActiveCard) => void;
  publishSheetCard: (card: AssistantActiveCard | null) => void;
  setBrandKeys: (brandKeys: readonly string[]) => void;
  setOpen: (open: boolean) => void;
  sheetCardRef: RefObject<AssistantActiveCard | null>;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({
  children,
  limits,
}: {
  children: ReactNode;
  limits: AssistantCardLimits;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<AssistantActiveCard | null>(null);
  const [cardTruncated, setCardTruncated] = useState(false);
  const [brandKeys, setBrandKeys] = useState<readonly string[]>([]);
  const [focusToken, setFocusToken] = useState(0);
  const sheetCardRef = useRef<AssistantActiveCard | null>(null);

  const boundCard = (next: AssistantActiveCard) => {
    const copyLimit = limits.copyByPlatform[next.platform] ?? next.copy.length;
    return {
      ...next,
      copy: next.copy.slice(0, copyLimit),
      headline: next.headline.slice(0, limits.headline),
    };
  };

  const pinCard = (next: AssistantActiveCard) => {
    const bounded = boundCard(next);

    setCard(bounded);
    setCardTruncated(
      bounded.copy !== next.copy || bounded.headline !== next.headline,
    );
  };

  const publishSheetCard = (next: AssistantActiveCard | null) => {
    sheetCardRef.current = next === null ? null : boundCard(next);
  };

  const askAboutCard = (next: AssistantActiveCard) => {
    pinCard(next);
    setOpen(true);
    setFocusToken((token) => token + 1);
  };

  // Reading route state here would cost the prerendered shell; the widget inside
  // the assistant Suspense boundary owns route-change clearing.
  const clearCard = () => {
    setCard(null);
    setCardTruncated(false);
    sheetCardRef.current = null;
  };

  const askAboutCardLabel = t("askAboutCard");

  return (
    <AssistantContext
      value={{
        askAboutCard,
        askAboutCardLabel,
        brandKeys,
        card,
        cardTruncated,
        clearCard,
        focusToken,
        open,
        pinCard,
        publishSheetCard,
        setBrandKeys,
        setOpen,
        sheetCardRef,
      }}
    >
      {children}
    </AssistantContext>
  );
}

export function useAssistant() {
  const value = use(AssistantContext);

  if (!value) {
    throw new Error("useAssistant used outside AssistantProvider");
  }

  return value;
}
