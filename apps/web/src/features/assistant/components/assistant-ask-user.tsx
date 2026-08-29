"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@rz-chain-reporter/ui/components/questionnaire";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ASSISTANT_NAMESPACE } from "../constants";
import type { AssistantAskUser as AskUserInput } from "../schemas/ui-message";

const BRAND = "brand";
const DETAIL = "detail";
const ORDER = [BRAND, DETAIL];

export type AssistantAnswer = { choiceId: string; detail: string };

export function AssistantAskUser({
  input,
  onAnswer,
}: {
  input: AskUserInput;
  onAnswer: (answer: AssistantAnswer) => void;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const [item, setItem] = useState(BRAND);

  const progress = t("askUser.progress", {
    current: ORDER.indexOf(item) + 1,
    total: ORDER.length,
  });

  return (
    <Questionnaire
      item={item}
      items={[
        {
          name: BRAND,
          choices: input.choices.map((choice) => ({ value: choice.id })),
          required: true,
        },
        { name: DETAIL },
      ]}
      onItemChange={setItem}
      onSubmit={(event) => {
        event.preventDefault();
        const answered = new FormData(event.currentTarget);
        const chosen = answered.get(BRAND);
        const detail = answered.get(DETAIL);

        if (typeof chosen === "string") {
          onAnswer({
            choiceId: chosen,
            detail: typeof detail === "string" ? detail : "",
          });
        }
      }}
    >
      <QuestionnaireProgress
        aria-label={t("askUser.progressLabel")}
        aria-valuetext={progress}
      >
        {progress}
      </QuestionnaireProgress>

      <QuestionnaireItem name={BRAND} required>
        <QuestionnaireTitle>{t("askUser.brand.title")}</QuestionnaireTitle>
        <QuestionnaireChoices>
          {input.choices.map((choice) => (
            <QuestionnaireChoice key={choice.id} value={choice.id}>
              <Bdi>{choice.label}</Bdi>
            </QuestionnaireChoice>
          ))}
        </QuestionnaireChoices>
        <QuestionnaireError>{t("askUser.brand.error")}</QuestionnaireError>
      </QuestionnaireItem>

      <QuestionnaireItem name={DETAIL}>
        <QuestionnaireTitle>{t("askUser.detail.title")}</QuestionnaireTitle>
        <QuestionnaireDescription>
          {t("askUser.detail.description")}
        </QuestionnaireDescription>
        <QuestionnaireInput placeholder={t("askUser.detail.placeholder")} />
      </QuestionnaireItem>

      <QuestionnaireActions>
        <QuestionnairePrevious>{t("askUser.previous")}</QuestionnairePrevious>
        <QuestionnaireSkip>{t("askUser.skip")}</QuestionnaireSkip>
        <QuestionnaireNext>{t("askUser.next")}</QuestionnaireNext>
        <QuestionnaireSubmit>{t("askUser.submit")}</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}
