"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormInputField } from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { useRouter } from "@/i18n/navigation";
import { signUpAction } from "../actions/auth-actions";
import { AUTH_NAMESPACE } from "../constants";
import { useFieldErrorMessage } from "../hooks/use-field-error-message";
import { type SignUpInput, signUpSchema } from "../schemas/sign-up";

export default function SignUpForm({
  onSwitchToSignIn,
}: {
  onSwitchToSignIn: () => void;
}) {
  const router = useRouter();
  const t = useTranslations(AUTH_NAMESPACE);
  const resolveError = useFieldErrorMessage();

  const action = useAction(signUpAction);
  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    setError,
  } = useForm<SignUpInput>({
    defaultValues: { name: "", email: "", password: "" },
    mode: "onSubmit",
    resolver: zodResolver(signUpSchema),
  });

  const isPending = isSubmitting || action.isPending;

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute(values);

    if (result.status === "error") {
      applyActionErrorToForm(setError, result);
      if (!result.fieldErrors) {
        toast.error(t("signUp.failure"));
      }
      return;
    }

    toast.success(t("signUp.success"));
    router.push("/dashboard");
  });

  return (
    <div className="mx-auto mt-10 w-full max-w-md p-6">
      <h1 className="mb-6 text-center font-bold text-3xl">
        {t("signUp.title")}
      </h1>
      <form
        aria-busy={isPending}
        className="space-y-4"
        onSubmit={onSubmit}
        noValidate
      >
        <FormInputField
          autoComplete="name"
          control={control}
          disabled={isPending}
          label={t("signUp.name")}
          name="name"
          resolveError={resolveError}
          type="text"
        />
        <FormInputField
          autoComplete="email"
          control={control}
          disabled={isPending}
          label={t("signUp.email")}
          name="email"
          resolveError={resolveError}
          type="email"
        />
        <FormInputField
          autoComplete="new-password"
          control={control}
          disabled={isPending}
          label={t("signUp.password")}
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
          {isPending ? t("signUp.submitting") : t("signUp.submit")}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Button onClick={onSwitchToSignIn} type="button" variant="link">
          {t("signUp.switch")}
        </Button>
      </div>
    </div>
  );
}
