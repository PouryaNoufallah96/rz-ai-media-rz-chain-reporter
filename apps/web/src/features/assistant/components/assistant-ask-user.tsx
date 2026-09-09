"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Card, CardContent } from "@rz-chain-reporter/ui/components/card";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@rz-chain-reporter/ui/components/questionnaire";
import { useTranslations } from "next-intl";

import { ASSISTANT_NAMESPACE } from "../constants";
import type { AssistantAskUser as AskUserInput } from "../schemas/ui-message";

export type AssistantAnswer = { choiceId: string; detail: string };

export type AssistantFocusedQuestion = {
  choices?: readonly { id: string; label: string; description?: string }[];
  description?: string;
  error: string;
  input?: { maxLength: number; placeholder: string };
  name: string;
  submitLabel: string;
  title: string;
};

export function AssistantAskUser({
  input,
  onAnswer,
}: {
  input: AskUserInput;
  onAnswer: (answer: AssistantAnswer) => void;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);

  return (
    <AssistantQuestion
      onAnswer={(value) => onAnswer({ choiceId: value, detail: "" })}
      question={{
        choices: input.choices,
        error: t("askUser.brand.error"),
        name: "brand",
        submitLabel: t("askUser.submit"),
        title: t("askUser.brand.title"),
      }}
    />
  );
}

export function AssistantQuestion({
  onAnswer,
  question,
}: {
  onAnswer: (value: string) => void;
  question: AssistantFocusedQuestion;
}) {
  return (
    <Card data-assistant-question size="sm">
      <CardContent>
        <Questionnaire
          item={question.name}
          items={[
            {
              name: question.name,
              choices: question.choices?.map((choice) => ({
                value: choice.id,
              })),
              required: true,
            },
          ]}
          onSubmit={(event) => {
            event.preventDefault();
            const answer = new FormData(event.currentTarget).get(question.name);
            if (typeof answer === "string" && answer.trim()) {
              onAnswer(answer.trim());
            }
          }}
        >
          <QuestionnaireItem name={question.name} required>
            <QuestionnaireTitle>{question.title}</QuestionnaireTitle>
            {question.description ? (
              <QuestionnaireDescription>
                {question.description}
              </QuestionnaireDescription>
            ) : null}
            {question.choices ? (
              <QuestionnaireChoices>
                {question.choices.map((choice) => (
                  <QuestionnaireChoice key={choice.id} value={choice.id}>
                    <Bdi>{choice.label}</Bdi>
                    {choice.description ? (
                      <span className="text-muted-foreground">
                        <Bdi>{choice.description}</Bdi>
                      </span>
                    ) : null}
                  </QuestionnaireChoice>
                ))}
              </QuestionnaireChoices>
            ) : null}
            {question.input ? (
              <QuestionnaireInput
                maxLength={question.input.maxLength}
                placeholder={question.input.placeholder}
              />
            ) : null}
            <QuestionnaireError>{question.error}</QuestionnaireError>
          </QuestionnaireItem>
          <QuestionnaireActions>
            <QuestionnaireSubmit>{question.submitLabel}</QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
  );
}
