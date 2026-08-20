"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { FieldGroup } from "@rz-chain-reporter/ui/components/field";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  FormCheckboxField,
  FormInputField,
  FormRootError,
} from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { useRouter } from "@/i18n/navigation";
import { signInAction } from "../actions/auth-actions";
import { AUTH_NAMESPACE } from "../constants";
import { useFieldErrorMessage } from "../hooks/use-field-error-message";
import { type SignInInput, signInSchema } from "../schemas/sign-in";

export default function SignInForm() {
  const router = useRouter();
  const t = useTranslations(AUTH_NAMESPACE);
  const resolveError = useFieldErrorMessage();

  const action = useAction(signInAction);
  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    setError,
    setFocus,
  } = useForm<SignInInput>({
    defaultValues: { email: "", password: "", rememberMe: false },
    mode: "onSubmit",
    resolver: zodResolver(signInSchema),
  });

  const isPending = isSubmitting || action.isPending;

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute(values);

    if (result.status === "error") {
      applyActionErrorToForm(setError, result, setFocus);
      toast.error(
        result.fieldErrors ? t("signIn.failure") : resolveError(result.code),
      );
      return;
    }

    toast.success(t("signIn.success"));
    router.push("/dashboard");
  });

  return (
    <div className="mx-auto mt-10 w-full max-w-md p-6">
      <h1 className="mb-6 text-center font-bold text-3xl">
        {t("signIn.title")}
      </h1>
      <form aria-busy={isPending} onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <FormInputField
            autoComplete="email"
            control={control}
            disabled={isPending}
            label={t("signIn.email")}
            name="email"
            resolveError={resolveError}
            type="email"
          />
          <FormInputField
            autoComplete="current-password"
            control={control}
            disabled={isPending}
            label={t("signIn.password")}
            name="password"
            resolveError={resolveError}
            type="password"
          />
          <FormCheckboxField
            control={control}
            disabled={isPending}
            label={t("signIn.rememberMe")}
            name="rememberMe"
            resolveError={resolveError}
          />
          <FormRootError
            message={
              errors.root?.server
                ? resolveError(errors.root.server.message)
                : undefined
            }
          />
          <Button className="w-full" disabled={isPending} type="submit">
            {isPending ? (
              <Spinner aria-hidden="true" data-icon="inline-start" />
            ) : null}
            {isPending ? t("signIn.submitting") : t("signIn.submit")}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
