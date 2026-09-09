"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@rz-chain-reporter/ui/components/input-group";
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
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          aria-label={t("composer.label")}
          className="min-h-14"
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
        <InputGroupAddon align="block-end" className="justify-between">
          <InputGroupText className="tabular-nums">
            {t("composer.counter", {
              length: trimmed.length,
              limit: MAX_QUESTION_CHARS,
            })}
          </InputGroupText>
          <div className="flex items-center gap-1">
            <InputGroupButton disabled={busy} onClick={onClear}>
              {t("composer.clear")}
            </InputGroupButton>
            {busy ? (
              <InputGroupButton onClick={onStop} variant="outline">
                {t("composer.stop")}
              </InputGroupButton>
            ) : (
              <InputGroupButton
                disabled={trimmed.length === 0}
                type="submit"
                variant="default"
              >
                {t("composer.send")}
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
