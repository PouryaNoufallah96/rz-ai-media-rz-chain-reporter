"use client";

import { Checkbox } from "@rz-chain-reporter/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@rz-chain-reporter/ui/components/field";
import { Input } from "@rz-chain-reporter/ui/components/input";
import { type ComponentProps, type ReactNode, useId } from "react";
import type {
  ControllerFieldState,
  ControllerRenderProps,
  FieldPath,
  FieldValues,
  UseControllerProps,
} from "react-hook-form";
import { useController } from "react-hook-form";

interface ControlProps {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
  id: string;
}

export interface FormFieldRenderProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  controlId: string;
  controlProps: ControlProps;
  descriptionId?: string;
  field: ControllerRenderProps<TFieldValues, TName>;
  fieldState: ControllerFieldState;
}

type FormFieldControllerProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = UseControllerProps<TFieldValues, TName> & {
  className?: string;
  description?: ReactNode;
  id?: string;
  orientation?: ComponentProps<typeof Field>["orientation"];
  resolveError: (code: string | undefined) => string;
};

type FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = FormFieldControllerProps<TFieldValues, TName> & {
  children: (props: FormFieldRenderProps<TFieldValues, TName>) => ReactNode;
};

type FormAdapterProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = FormFieldControllerProps<TFieldValues, TName> & {
  label: ReactNode;
};

function fieldId(name: string, fallbackId: string) {
  return `${name.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${fallbackId.replace(/:/g, "")}`;
}

function describedBy(...ids: Array<string | undefined>) {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

export function FormField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  children,
  className,
  control,
  defaultValue,
  description,
  disabled,
  id,
  name,
  orientation,
  resolveError,
  rules,
  shouldUnregister,
}: FormFieldProps<TFieldValues, TName>) {
  const generatedId = useId();
  const { field, fieldState } = useController({
    control,
    defaultValue,
    name,
    rules,
    shouldUnregister,
  });

  const controlId = id ?? fieldId(field.name, generatedId);
  const descriptionId = description ? `${controlId}-description` : undefined;
  const message = fieldState.error
    ? resolveError(fieldState.error.message)
    : undefined;
  const errorId = message ? `${controlId}-error` : undefined;
  const isDisabled = disabled ?? field.disabled;

  const controlProps: ControlProps = {
    "aria-describedby": describedBy(descriptionId, errorId),
    "aria-invalid": fieldState.invalid || undefined,
    disabled: isDisabled,
    id: controlId,
  };

  return (
    <Field
      className={className}
      data-disabled={isDisabled || undefined}
      data-invalid={fieldState.invalid || undefined}
      disabled={isDisabled}
      orientation={orientation}
    >
      {children({
        controlId,
        controlProps,
        descriptionId,
        field,
        fieldState,
      })}
      <FieldError id={errorId}>{message}</FieldError>
    </Field>
  );
}

type FormInputFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = Omit<
  ComponentProps<typeof Input>,
  | "aria-describedby"
  | "aria-invalid"
  | "defaultValue"
  | "disabled"
  | "id"
  | "name"
  | "onBlur"
  | "onChange"
  | "ref"
  | "value"
> &
  FormAdapterProps<TFieldValues, TName>;

export function FormInputField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({ className, ...props }: FormInputFieldProps<TFieldValues, TName>) {
  const {
    control,
    defaultValue,
    description,
    disabled,
    id,
    label,
    name,
    orientation,
    resolveError,
    rules,
    shouldUnregister,
    ...inputProps
  } = props;

  return (
    <FormField
      className={className}
      control={control}
      defaultValue={defaultValue}
      description={description}
      disabled={disabled}
      id={id}
      name={name}
      orientation={orientation}
      resolveError={resolveError}
      rules={rules}
      shouldUnregister={shouldUnregister}
    >
      {({ controlId, controlProps, descriptionId, field }) => {
        const input = (
          <Input
            {...inputProps}
            {...controlProps}
            name={field.name}
            onBlur={field.onBlur}
            onChange={(event) => field.onChange(event.currentTarget.value)}
            ref={field.ref}
            value={field.value ?? ""}
          />
        );
        const descriptionNode = description ? (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        ) : null;
        const beside =
          orientation === "horizontal" || orientation === "responsive";

        if (beside) {
          return (
            <>
              <FieldContent>
                <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
                {descriptionNode}
              </FieldContent>
              {input}
            </>
          );
        }

        return (
          <>
            <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
            {input}
            {descriptionNode}
          </>
        );
      }}
    </FormField>
  );
}

type FormCheckboxFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = Omit<
  ComponentProps<typeof Checkbox>,
  | "aria-describedby"
  | "aria-invalid"
  | "checked"
  | "defaultChecked"
  | "disabled"
  | "id"
  | "name"
  | "onBlur"
  | "onCheckedChange"
  | "ref"
> &
  FormAdapterProps<TFieldValues, TName>;

export function FormCheckboxField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({ className, ...props }: FormCheckboxFieldProps<TFieldValues, TName>) {
  const {
    control,
    defaultValue,
    description,
    disabled,
    id,
    label,
    name,
    orientation = "horizontal",
    resolveError,
    rules,
    shouldUnregister,
    ...checkboxProps
  } = props;

  return (
    <FormField
      className={className}
      control={control}
      defaultValue={defaultValue}
      description={description}
      disabled={disabled}
      id={id}
      name={name}
      orientation={orientation}
      resolveError={resolveError}
      rules={rules}
      shouldUnregister={shouldUnregister}
    >
      {({ controlId, controlProps, descriptionId, field }) => {
        const labelNode = description ? (
          <FieldContent>
            <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
            <FieldDescription id={descriptionId}>
              {description}
            </FieldDescription>
          </FieldContent>
        ) : (
          <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
        );

        return (
          <>
            <Checkbox
              {...checkboxProps}
              {...controlProps}
              checked={field.value === true}
              name={field.name}
              onBlur={field.onBlur}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              ref={field.ref}
            />
            {labelNode}
          </>
        );
      }}
    </FormField>
  );
}

export function FormRootError({
  className,
  message,
  ...props
}: ComponentProps<"div"> & { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <FieldError className={className} {...props}>
      {message}
    </FieldError>
  );
}
