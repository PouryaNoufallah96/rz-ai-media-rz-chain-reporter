import { useTranslations } from "next-intl";

import { useFallbackErrorMessage } from "@/components/form/use-error-message";

import { AUTH_NAMESPACE } from "../constants";

const MESSAGE_KEYS = {
  emailInvalid: "errors.emailInvalid",
  passwordRequired: "errors.passwordRequired",
  INVALID_CREDENTIALS: "errors.invalidCredentials",
} as const;

type FieldErrorCode = keyof typeof MESSAGE_KEYS;

function isFieldErrorCode(value: string): value is FieldErrorCode {
  return value in MESSAGE_KEYS;
}

export function useFieldErrorMessage() {
  const t = useTranslations(AUTH_NAMESPACE);
  const fallback = useFallbackErrorMessage();

  return (code: string | undefined) =>
    code !== undefined && isFieldErrorCode(code)
      ? t(MESSAGE_KEYS[code])
      : fallback();
}
