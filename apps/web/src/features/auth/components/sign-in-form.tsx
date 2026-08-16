"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormInputField } from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { useRouter } from "@/i18n/navigation";
import { signInAction } from "../actions/auth-actions";
import { AUTH_NAMESPACE } from "../constants";
import { useFieldErrorMessage } from "../hooks/use-field-error-message";
import { type SignInInput, signInSchema } from "../schemas/sign-in";

export default function SignInForm({
  onSwitchToSignUp,
}: {
  onSwitchToSignUp: () => void;
}) {
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
  } = useForm<SignInInput>({
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
    resolver: zodResolver(signInSchema),
  });

  const isPending = isSubmitting || action.isPending;

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute(values);

    if (result.status === "error") {
      applyActionErrorToForm(setError, result);
      toast.error(t("signIn.failure"));
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
      <form
        aria-busy={isPending}
        className="space-y-4"
        onSubmit={onSubmit}
        noValidate
      >
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

        {errors.root?.server && (
          <p className="text-destructive text-sm" role="alert">
            {resolveError(errors.root.server.message)}
          </p>
        )}

        <Button className="w-full" disabled={isPending} type="submit">
          {isPending ? t("signIn.submitting") : t("signIn.submit")}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Button onClick={onSwitchToSignUp} type="button" variant="link">
          {t("signIn.switch")}
        </Button>
      </div>
    </div>
  );
}
