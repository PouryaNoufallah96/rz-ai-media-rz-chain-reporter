"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { Textarea } from "@rz-chain-reporter/ui/components/textarea";
import { useTranslations } from "next-intl";
import { type RefObject, useRef, useState } from "react";

import { ASSISTANT_NAMESPACE, MAX_QUESTION_CHARS } from "../constants";

export function AssistantComposer({
  busy,
  onClear,
  onSend,
  onStop,
  ref,
}: {
  busy: boolean;
  onClear: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  ref: RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const [text, setText] = useState("");
  const composing = useRef(false);
  const trimmed = text.trim();

  const submit = () => {
    if (busy || trimmed.length === 0 || trimmed.length > MAX_QUESTION_CHARS) {
      return;
    }

    onSend(trimmed);
    setText("");
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        aria-label={t("composer.label")}
        className="min-h-16 resize-none"
        maxLength={MAX_QUESTION_CHARS}
        onChange={(event) => setText(event.target.value)}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || composing.current) {
            return;
          }

          event.preventDefault();
          submit();
        }}
        placeholder={t("composer.placeholder")}
        ref={ref}
        value={text}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-2xs text-muted-foreground tabular-nums">
          {t("composer.counter", {
            length: trimmed.length,
            limit: MAX_QUESTION_CHARS,
          })}
        </span>

        <div className="flex items-center gap-1.5">
          <Button
            disabled={busy}
            onClick={onClear}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("composer.clear")}
          </Button>

          {busy ? (
            <Button onClick={onStop} size="sm" type="button" variant="outline">
              {t("composer.stop")}
            </Button>
          ) : (
            <Button disabled={trimmed.length === 0} size="sm" type="submit">
              {t("composer.send")}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
