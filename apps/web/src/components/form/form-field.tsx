"use client";

import {
  Field,
  FieldError,
  FieldLabel,
} from "@rz-chain-reporter/ui/components/field";
import { Input } from "@rz-chain-reporter/ui/components/input";
import type { ComponentProps } from "react";
import {
  type Control,
  type FieldPath,
  type FieldValues,
  useController,
} from "react-hook-form";

type ControlledInputProps = Omit<
  ComponentProps<typeof Input>,
  "defaultValue" | "id" | "name" | "onBlur" | "onChange" | "ref" | "value"
>;

interface FormInputFieldProps<TFieldValues extends FieldValues>
  extends ControlledInputProps {
  control: Control<TFieldValues>;
  label: string;
  name: FieldPath<TFieldValues>;
  resolveError: (code: string | undefined) => string;
}

export function FormInputField<TFieldValues extends FieldValues>({
  control,
  label,
  name,
  resolveError,
  ...inputProps
}: FormInputFieldProps<TFieldValues>) {
  const { field, fieldState } = useController({ control, name });
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  const message = fieldState.error
    ? resolveError(fieldState.error.message)
    : undefined;

  return (
    <Field
      data-disabled={inputProps.disabled || undefined}
      data-invalid={fieldState.invalid || undefined}
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...inputProps}
        {...field}
        aria-describedby={message ? errorId : undefined}
        aria-invalid={Boolean(fieldState.error)}
        id={id}
      />
      <FieldError id={errorId}>{message}</FieldError>
    </Field>
  );
}
