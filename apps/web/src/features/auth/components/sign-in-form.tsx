"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { FieldGroup } from "@rz-chain-reporter/ui/components/field";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { LockKeyholeIcon } from "lucide-react";
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
import { authClient } from "../lib/auth-client";
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
      return;
    }

    toast.success(t("signIn.success"));
    authClient.$store.notify("$sessionSignal");
    router.push("/dashboard");
  });

  return (
    <div className="w-full">
      <LockKeyholeIcon
        aria-hidden="true"
        className="mb-4 size-6 text-primary"
      />
      <h1 className="text-balance font-medium text-2xl tracking-display">
        {t("signIn.title")}
      </h1>
      <p className="mt-2 mb-7 text-pretty text-muted-foreground text-sm leading-6">
        {t("signIn.description")}
      </p>
      <form
        aria-busy={isPending}
        className="max-sm:**:data-[slot=input]:min-h-11"
        onSubmit={onSubmit}
        noValidate
      >
        <FieldGroup>
          <FormInputField
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            control={control}
            disabled={isPending}
            label={t("signIn.email")}
            name="email"
            resolveError={resolveError}
            spellCheck={false}
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
          <Button
            className="w-full max-sm:min-h-11"
            disabled={isPending}
            type="submit"
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {isPending ? t("signIn.submitting") : t("signIn.submit")}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-6 border-t pt-4 text-muted-foreground text-xs leading-5">
        {t("signIn.provisioned")}
      </p>
    </div>
  );
}
