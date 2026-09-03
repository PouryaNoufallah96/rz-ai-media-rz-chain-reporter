"use client";

import { CALENDAR, DIRECTION } from "@rz-chain-reporter/i18n";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Calendar, TZDate } from "@rz-chain-reporter/ui/components/calendar";
import {
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@rz-chain-reporter/ui/components/field";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@rz-chain-reporter/ui/components/popover";
import { CalendarIcon } from "lucide-react";
import { useLocale } from "next-intl";
import { type Ref, useId } from "react";

import { FieldCaption, LabeledSelect } from "./form-field";

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  hour.toString().padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, minute) =>
  minute.toString().padStart(2, "0"),
);
const TIME_MENU_PROPS = {
  alignItemWithTrigger: false,
  className: "max-h-[min(--spacing(56),var(--available-height))] min-w-0",
};

const TIME_FORMATS = {
  en: new Intl.NumberFormat("en", {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }),
  fa: new Intl.NumberFormat("fa", {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }),
};

const DATE_FORMATS = {
  en: new Intl.DateTimeFormat("en", {
    calendar: CALENDAR.en,
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }),
  fa: new Intl.DateTimeFormat("fa", {
    calendar: CALENDAR.fa,
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }),
};

type DateTimePickerLabels = {
  choose: string;
  date: string;
  time: string;
  hour: string;
  minute: string;
  clear: string;
  close: string;
  invalid: string;
  gregorian: string;
};

type DateTimePickerProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  min: string;
  timeZone: string;
  label: string;
  labels: DateTimePickerLabels;
  invalid?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function DateTimePicker({
  id,
  value,
  onValueChange,
  onBlur,
  min,
  timeZone,
  label,
  labels,
  invalid = false,
  disabled = false,
  ref,
}: DateTimePickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const locale = useLocale();
  const state = dateTimePickerState(value, min, locale, labels, disabled);
  const errorId = invalid ? `${inputId}-error` : undefined;

  return (
    <div className="grid min-w-0 gap-1.5">
      <FieldCaption htmlFor={inputId}>{label}</FieldCaption>
      <Popover>
        <PopoverTrigger
          render={<Button variant="outline" />}
          ref={ref}
          id={inputId}
          disabled={disabled}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={`${inputId}-hint${errorId ? ` ${errorId}` : ""}`}
          className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal py-2 sm:min-h-8"
        >
          <CalendarIcon aria-hidden="true" />
          <span className="min-w-0">
            {state.dateLabel}
            {state.timeLabel ? (
              <>
                {" "}
                · <bdi dir="ltr">{state.timeLabel}</bdi>
              </>
            ) : null}
          </span>
        </PopoverTrigger>
        <PopoverContent dir={DIRECTION[locale]} lang={locale}>
          <PopoverTitle className="border-b px-3 py-2 font-medium text-sm">
            {label}
          </PopoverTitle>
          <Calendar
            calendar={CALENDAR[locale]}
            dir={DIRECTION[locale]}
            lang={locale}
            mode="single"
            required
            selected={state.selected}
            defaultMonth={state.selected ?? state.minimumDate}
            today={state.minimumDate}
            timeZone="UTC"
            noonSafe
            disabled={state.disabledDates}
            onSelect={(day) =>
              onValueChange(
                `${day.toISOString().slice(0, 10)}T${state.timePart || min.slice(11)}`,
              )
            }
            aria-label={labels.date}
          />
          <PickerTimeFields
            disabled={disabled}
            errorId={errorId}
            inputId={inputId}
            invalid={invalid}
            labels={labels}
            onBlur={onBlur}
            onValueChange={onValueChange}
            state={state}
            timeZone={timeZone}
            value={value}
          />
        </PopoverContent>
      </Popover>
      <PickerFeedback
        datePart={state.datePart}
        gregorianLabel={labels.gregorian}
        inputId={inputId}
        invalid={invalid}
        invalidLabel={labels.invalid}
        showGregorian={state.showGregorian}
        timeZone={timeZone}
      />
    </div>
  );
}

type PickerState = ReturnType<typeof dateTimePickerState>;

function PickerTimeFields({
  disabled,
  errorId,
  inputId,
  invalid,
  labels,
  onBlur,
  onValueChange,
  state,
  timeZone,
  value,
}: {
  disabled: boolean;
  errorId: string | undefined;
  inputId: string;
  invalid: boolean;
  labels: DateTimePickerLabels;
  onBlur?: () => void;
  onValueChange: (value: string) => void;
  state: PickerState;
  timeZone: string;
  value: string;
}) {
  return (
    <div className="grid gap-2 border-t p-3">
      <FieldSet className="gap-2" disabled={disabled}>
        <FieldLegend className="ticket-label" variant="label">
          {labels.time}
        </FieldLegend>
        <FieldGroup className="grid grid-cols-2 gap-3">
          <LabeledSelect
            aria-describedby={errorId}
            aria-invalid={invalid || undefined}
            contentProps={TIME_MENU_PROPS}
            disabled={disabled}
            id={`${inputId}-hour`}
            label={labels.hour}
            onBlur={onBlur}
            onValueChange={(next) => updateHour(next, state, onValueChange)}
            options={state.hourOptions}
            placeholder={labels.hour}
            triggerClassName="min-h-11 sm:min-h-8"
            value={state.hour || null}
          />
          <LabeledSelect
            aria-describedby={errorId}
            aria-invalid={invalid || undefined}
            contentProps={TIME_MENU_PROPS}
            disabled={disabled}
            id={`${inputId}-minute`}
            label={labels.minute}
            onBlur={onBlur}
            onValueChange={(next) => updateMinute(next, state, onValueChange)}
            options={state.minuteOptions}
            placeholder={labels.minute}
            triggerClassName="min-h-11 sm:min-h-8"
            value={state.minute || null}
          />
        </FieldGroup>
      </FieldSet>
      <p className="text-muted-foreground text-xs">
        <bdi dir="ltr">{timeZone}</bdi>
      </p>
      <div className="flex justify-between gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={disabled || !value}
          onClick={() => onValueChange("")}
          type="button"
          variant="ghost"
        >
          {labels.clear}
        </Button>
        <PopoverClose
          render={<Button variant="secondary" />}
          className="min-h-11 sm:min-h-8"
        >
          {labels.close}
        </PopoverClose>
      </div>
    </div>
  );
}

function PickerFeedback({
  datePart,
  gregorianLabel,
  inputId,
  invalid,
  invalidLabel,
  showGregorian,
  timeZone,
}: {
  datePart: string;
  gregorianLabel: string;
  inputId: string;
  invalid: boolean;
  invalidLabel: string;
  showGregorian: boolean;
  timeZone: string;
}) {
  return (
    <>
      <p
        id={`${inputId}-hint`}
        className="wrap-break-word text-muted-foreground text-xs/relaxed"
      >
        {showGregorian ? (
          <>
            {gregorianLabel}: <bdi dir="ltr">{datePart}</bdi> ·{" "}
          </>
        ) : null}
        <bdi dir="ltr">{timeZone}</bdi>
      </p>
      {invalid ? (
        <p
          id={`${inputId}-error`}
          className="text-destructive text-xs"
          role="status"
        >
          {invalidLabel}
        </p>
      ) : null}
    </>
  );
}

function dateTimePickerState(
  value: string,
  min: string,
  locale: keyof typeof TIME_FORMATS,
  labels: DateTimePickerLabels,
  disabled: boolean,
) {
  const [datePart = "", timePart = ""] = value.split("T");
  const [hour = "", minute = ""] = timePart.split(":");
  const minimumDatePart = min.slice(0, 10);
  const minimumHour = min.slice(11, 13);
  const minimumMinute = min.slice(14, 16);
  const effectiveDate = datePart || minimumDatePart;
  const effectiveHour = hour || minimumHour;
  const atMinimumDate = effectiveDate === minimumDatePart;
  const timeFormat = TIME_FORMATS[locale];
  const minimumDate = civilDay(minimumDatePart);
  const selected = civilDay(datePart);

  return {
    datePart,
    timePart,
    hour,
    minute,
    effectiveDate,
    effectiveHour,
    minimumMinute,
    minimumDate,
    selected,
    dateLabel: selected ? DATE_FORMATS[locale].format(selected) : labels.choose,
    timeLabel: /^\d{2}:\d{2}$/.test(timePart)
      ? timePart
          .split(":")
          .map((part) => timeFormat.format(Number(part)))
          .join(":")
      : "",
    disabledDates: disabled
      ? true
      : minimumDate
        ? { before: minimumDate }
        : undefined,
    showGregorian: CALENDAR[locale] === "persian" && Boolean(selected),
    hourOptions: HOURS.map((option) => ({
      disabled: atMinimumDate && option < minimumHour,
      label: timeFormat.format(Number(option)),
      value: option,
    })),
    minuteOptions: MINUTES.map((option) => ({
      disabled:
        atMinimumDate &&
        (effectiveHour < minimumHour ||
          (effectiveHour === minimumHour && option < minimumMinute)),
      label: timeFormat.format(Number(option)),
      value: option,
    })),
  };
}

function updateHour(
  hour: string | null,
  state: PickerState,
  onValueChange: (value: string) => void,
) {
  if (hour === null) return;
  onValueChange(
    `${state.effectiveDate}T${hour}:${state.minute || state.minimumMinute}`,
  );
}

function updateMinute(
  minute: string | null,
  state: PickerState,
  onValueChange: (value: string) => void,
) {
  if (minute === null) return;
  onValueChange(`${state.effectiveDate}T${state.effectiveHour}:${minute}`);
}

function civilDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new TZDate(`${value}T12:00:00Z`, "UTC");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : undefined;
}
