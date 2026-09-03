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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rz-chain-reporter/ui/components/select";
import { Switch } from "@rz-chain-reporter/ui/components/switch";
import { Textarea } from "@rz-chain-reporter/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@rz-chain-reporter/ui/components/toggle-group";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { type ComponentProps, type ReactNode, type Ref, useId } from "react";
import type {
  ControllerFieldState,
  ControllerRenderProps,
  FieldError as FieldErrorState,
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
  descriptionNode: ReactNode;
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

// An indexed issue (`sourceIds.0`) leaves RHF's field error nested with no
// top-level message; surface the first nested code instead of the fallback.
function errorCode(error: FieldErrorState) {
  if (error.message !== undefined) return error.message;
  const nested = Object.values(error).find(
    (value): value is FieldErrorState =>
      typeof value === "object" && value !== null,
  );
  return nested?.message;
}

function describedBy(...ids: Array<string | undefined>) {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

export function FieldCaption({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <FieldLabel className="ticket-label" htmlFor={htmlFor}>
      {children}
    </FieldLabel>
  );
}

function CaptionedControl({
  children,
  controlId,
  description,
  descriptionId,
  label,
  orientation,
}: {
  children: ReactNode;
  controlId: string;
  description?: ReactNode;
  descriptionId?: string;
  label: ReactNode;
  orientation?: ComponentProps<typeof Field>["orientation"];
}) {
  const descriptionNode = description ? (
    <FieldDescription id={descriptionId}>{description}</FieldDescription>
  ) : null;
  const caption = <FieldCaption htmlFor={controlId}>{label}</FieldCaption>;
  const beside = orientation === "horizontal" || orientation === "responsive";

  if (beside) {
    return (
      <>
        <FieldContent>
          {caption}
          {descriptionNode}
        </FieldContent>
        {children}
      </>
    );
  }

  return (
    <>
      {caption}
      {children}
      {descriptionNode}
    </>
  );
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
  const descriptionNode = description ? (
    <FieldDescription id={descriptionId}>{description}</FieldDescription>
  ) : null;
  const message = fieldState.error
    ? resolveError(errorCode(fieldState.error))
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
        descriptionNode,
        field,
        fieldState,
      })}
      <FieldError id={errorId}>{message}</FieldError>
    </Field>
  );
}

export function FormSwitchField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  label,
  onCheckedChange,
  ...props
}: FormAdapterProps<TFieldValues, TName> & {
  onCheckedChange?: (
    checked: boolean,
    commit: (value: boolean) => void,
  ) => void;
}) {
  return (
    <FormField {...props} orientation="horizontal">
      {({ controlId, controlProps, descriptionId, field }) => (
        <>
          <FieldContent>
            <FieldCaption htmlFor={controlId}>{label}</FieldCaption>
            {props.description ? (
              <FieldDescription id={descriptionId}>
                {props.description}
              </FieldDescription>
            ) : null}
          </FieldContent>
          <Switch
            {...controlProps}
            checked={field.value === true}
            name={field.name}
            onBlur={field.onBlur}
            onCheckedChange={(checked) =>
              onCheckedChange
                ? onCheckedChange(checked, field.onChange)
                : field.onChange(checked)
            }
            inputRef={field.ref}
          />
        </>
      )}
    </FormField>
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
      {({ controlId, controlProps, descriptionId, field }) => (
        <CaptionedControl
          controlId={controlId}
          description={description}
          descriptionId={descriptionId}
          label={label}
          orientation={orientation}
        >
          <Input
            {...inputProps}
            {...controlProps}
            name={field.name}
            onBlur={field.onBlur}
            onChange={(event) => field.onChange(event.currentTarget.value)}
            ref={field.ref}
            value={field.value ?? ""}
          />
        </CaptionedControl>
      )}
    </FormField>
  );
}

export function FormNumberField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  className,
  control,
  defaultValue,
  description,
  disabled,
  id,
  label,
  max,
  min = 1,
  name,
  orientation,
  resolveError,
  rules,
  shouldUnregister,
}: FormAdapterProps<TFieldValues, TName> & {
  max?: number;
  min?: number;
}) {
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
      {({ controlId, controlProps, descriptionId, field }) => (
        <CaptionedControl
          controlId={controlId}
          description={description}
          descriptionId={descriptionId}
          label={label}
          orientation={orientation}
        >
          <Input
            {...controlProps}
            className="w-24"
            inputMode="numeric"
            max={max}
            min={min}
            name={field.name}
            onBlur={field.onBlur}
            onChange={(event) =>
              field.onChange(event.currentTarget.valueAsNumber)
            }
            ref={field.ref}
            type="number"
            value={Number.isNaN(field.value) ? "" : field.value}
          />
        </CaptionedControl>
      )}
    </FormField>
  );
}

type FormTextareaFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = Omit<
  ComponentProps<typeof Textarea>,
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

export function FormTextareaField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({ className, ...props }: FormTextareaFieldProps<TFieldValues, TName>) {
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
    ...textareaProps
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
      {({ controlId, controlProps, descriptionId, field }) => (
        <CaptionedControl
          controlId={controlId}
          description={description}
          descriptionId={descriptionId}
          label={label}
          orientation={orientation}
        >
          <Textarea
            {...textareaProps}
            {...controlProps}
            name={field.name}
            onBlur={field.onBlur}
            onChange={(event) => field.onChange(event.currentTarget.value)}
            ref={field.ref}
            value={field.value ?? ""}
          />
        </CaptionedControl>
      )}
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
            <FieldCaption htmlFor={controlId}>{label}</FieldCaption>
            <FieldDescription id={descriptionId}>
              {description}
            </FieldDescription>
          </FieldContent>
        ) : (
          <FieldCaption htmlFor={controlId}>{label}</FieldCaption>
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

export type SelectOption<T extends string = string> = {
  disabled?: boolean;
  label: ReactNode;
  value: T;
};

const EMPTY_SELECT_VALUE = "__empty__";

type SelectContentProps = Pick<
  ComponentProps<typeof SelectContent>,
  "alignItemWithTrigger" | "className"
>;

function SelectControl<T extends string>({
  className,
  contentProps,
  disabled,
  id,
  inputRef,
  name,
  onBlur,
  onValueChange,
  options,
  placeholder,
  triggerRef,
  value,
  ...controlProps
}: {
  className?: string;
  contentProps?: SelectContentProps;
  disabled?: boolean;
  id?: string;
  inputRef?: ComponentProps<typeof Select>["inputRef"];
  name?: string;
  onBlur?: ComponentProps<typeof SelectTrigger>["onBlur"];
  onValueChange: (value: T | null) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  value: T | null;
} & Pick<ControlProps, "aria-describedby" | "aria-invalid">) {
  return (
    <Select
      disabled={disabled}
      inputRef={inputRef}
      items={[...options]}
      modal={false}
      name={name}
      onValueChange={onValueChange}
      value={value}
    >
      <SelectTrigger
        aria-describedby={controlProps["aria-describedby"]}
        aria-invalid={controlProps["aria-invalid"]}
        className={className}
        id={id}
        onBlur={onBlur}
        ref={triggerRef}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent {...contentProps}>
        {options.map((option) => (
          <SelectItem
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type FormSelectFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TValue extends string,
> = FormAdapterProps<TFieldValues, TName> & {
  onValueChange?: (value: TValue) => void;
  options: readonly SelectOption<TValue>[];
  placeholder?: string;
};

export function FormSelectField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TValue extends string,
>({
  className,
  control,
  defaultValue,
  description,
  disabled,
  id,
  label,
  name,
  onValueChange,
  options,
  orientation,
  placeholder,
  resolveError,
  rules,
  shouldUnregister,
}: FormSelectFieldProps<TFieldValues, TName, TValue>) {
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
      {({ controlId, controlProps, descriptionId, field }) => (
        <CaptionedControl
          controlId={controlId}
          description={description}
          descriptionId={descriptionId}
          label={label}
          orientation={orientation}
        >
          <SelectControl
            aria-describedby={controlProps["aria-describedby"]}
            aria-invalid={controlProps["aria-invalid"]}
            className="w-full"
            disabled={controlProps.disabled}
            id={controlId}
            name={field.name}
            onBlur={field.onBlur}
            onValueChange={(next) => {
              if (next == null) return;
              field.onChange(next);
              onValueChange?.(next);
            }}
            options={options}
            placeholder={placeholder}
            triggerRef={field.ref}
            value={field.value ?? null}
          />
        </CaptionedControl>
      )}
    </FormField>
  );
}

export function LabeledSelect<T extends string>({
  busy,
  className,
  contentProps,
  disabled,
  emptyLabel,
  id,
  label,
  onBlur,
  onValueChange,
  options,
  orientation,
  placeholder,
  triggerClassName,
  value,
  ...controlProps
}: {
  busy?: boolean;
  className?: string;
  contentProps?: SelectContentProps;
  disabled?: boolean;
  emptyLabel?: string;
  id?: string;
  label: ReactNode;
  onBlur?: ComponentProps<typeof SelectTrigger>["onBlur"];
  onValueChange: (value: T | null) => void;
  options: readonly SelectOption<T>[];
  orientation?: ComponentProps<typeof Field>["orientation"];
  placeholder?: string;
  triggerClassName?: string;
  value: T | null;
} & Pick<ControlProps, "aria-describedby" | "aria-invalid">) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const selectOptions: SelectOption<string>[] = emptyLabel
    ? [{ label: emptyLabel, value: EMPTY_SELECT_VALUE }, ...options]
    : [...options];

  return (
    <Field
      aria-busy={busy || undefined}
      className={className}
      data-disabled={disabled || undefined}
      data-invalid={controlProps["aria-invalid"] || undefined}
      disabled={disabled}
      orientation={orientation}
    >
      <FieldCaption htmlFor={controlId}>{label}</FieldCaption>
      <SelectControl
        {...controlProps}
        className={triggerClassName}
        contentProps={contentProps}
        disabled={disabled}
        id={controlId}
        onBlur={onBlur}
        onValueChange={(next) => {
          if (next == null || next === EMPTY_SELECT_VALUE) {
            onValueChange(null);
            return;
          }
          const selected = options.find((option) => option.value === next);
          if (!selected) return;
          onValueChange(selected.value);
        }}
        options={selectOptions}
        placeholder={placeholder}
        value={value ?? (emptyLabel ? EMPTY_SELECT_VALUE : null)}
      />
    </Field>
  );
}

export function LabeledInput({
  className,
  id,
  inputClassName,
  label,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, "className"> & {
  className?: string;
  inputClassName?: ComponentProps<typeof Input>["className"];
  label: ReactNode;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <Field className={className}>
      <FieldCaption htmlFor={controlId}>{label}</FieldCaption>
      <Input {...inputProps} className={inputClassName} id={controlId} />
    </Field>
  );
}

export type ToggleOption<T extends string | number> = {
  label: ReactNode;
  title?: string;
  value: T;
};

export function FormToggleGroupField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  TValue extends string | number,
>({
  className,
  control,
  defaultValue,
  description,
  disabled,
  groupClassName,
  hint,
  id,
  label,
  name,
  onValueChange,
  options,
  resolveError,
  rules,
  shouldUnregister,
}: FormAdapterProps<TFieldValues, TName> & {
  groupClassName?: string;
  hint?: ReactNode;
  onValueChange?: (value: TValue) => void;
  options: readonly ToggleOption<TValue>[];
}) {
  return (
    <FormField
      className={className}
      control={control}
      defaultValue={defaultValue}
      description={description}
      disabled={disabled}
      id={id}
      name={name}
      resolveError={resolveError}
      rules={rules}
      shouldUnregister={shouldUnregister}
    >
      {({ controlId, controlProps, descriptionNode, field }) => {
        const labelId = `${controlId}-label`;
        return (
          <div className="grid min-w-0 gap-1.5">
            <span className="flex h-6 items-center gap-1">
              <span className="ticket-label" id={labelId}>
                {label}
              </span>
              {hint}
            </span>
            <ToggleGroup
              aria-describedby={controlProps["aria-describedby"]}
              aria-invalid={controlProps["aria-invalid"]}
              aria-labelledby={labelId}
              className={cn("flex-wrap", groupClassName)}
              disabled={controlProps.disabled}
              id={controlId}
              onBlur={field.onBlur}
              onValueChange={(next) => {
                const chosen = next.at(-1);
                const option = options.find(
                  (candidate) => String(candidate.value) === chosen,
                );
                if (!option) return;
                field.onChange(option.value);
                onValueChange?.(option.value);
              }}
              ref={field.ref}
              value={[String(field.value)]}
            >
              {options.map((option) => (
                <ToggleGroupItem
                  key={String(option.value)}
                  title={option.title}
                  value={String(option.value)}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {descriptionNode}
          </div>
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
