"use client";

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
    calendar: "gregory",
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }),
  fa: new Intl.DateTimeFormat("fa", {
    calendar: "persian",
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
}: {
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
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const locale = useLocale();
  const persian = locale === "fa";
  const [datePart = "", timePart = ""] = value.split("T");
  const [hour = "", minute = ""] = timePart.split(":");
  const minimumDatePart = min.slice(0, 10);
  const minimumHour = min.slice(11, 13);
  const minimumMinute = min.slice(14, 16);
  const effectiveDate = datePart || minimumDatePart;
  const effectiveHour = hour || minimumHour;
  const atMinimumDate = effectiveDate === minimumDatePart;
  const timeFormat = TIME_FORMATS[persian ? "fa" : "en"];
  const timeLabel = /^\d{2}:\d{2}$/.test(timePart)
    ? timePart
        .split(":")
        .map((part) => timeFormat.format(Number(part)))
        .join(":")
    : "";
  const minimumDate = civilDay(minimumDatePart);
  const selected = civilDay(datePart);
  const dateLabel = selected
    ? DATE_FORMATS[persian ? "fa" : "en"].format(selected)
    : labels.choose;

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
          aria-describedby={`${inputId}-hint${invalid ? ` ${inputId}-error` : ""}`}
          className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal py-2 sm:min-h-8"
        >
          <CalendarIcon aria-hidden="true" />
          <span className="min-w-0">
            {dateLabel}
            {timeLabel ? (
              <>
                {" "}
                · <bdi dir="ltr">{timeLabel}</bdi>
              </>
            ) : null}
          </span>
        </PopoverTrigger>
        <PopoverContent dir={persian ? "rtl" : "ltr"} lang={locale}>
          <PopoverTitle className="border-b px-3 py-2 font-medium text-sm">
            {label}
          </PopoverTitle>
          <Calendar
            calendar={persian ? "persian" : "gregory"}
            dir={persian ? "rtl" : "ltr"}
            lang={locale}
            mode="single"
            required
            selected={selected}
            defaultMonth={selected ?? minimumDate}
            today={minimumDate}
            timeZone="UTC"
            noonSafe
            disabled={
              disabled
                ? true
                : minimumDate
                  ? { before: minimumDate }
                  : undefined
            }
            onSelect={(day) =>
              onValueChange(
                `${day.toISOString().slice(0, 10)}T${timePart || min.slice(11)}`,
              )
            }
            aria-label={labels.date}
          />
          <div className="grid gap-2 border-t p-3">
            <FieldSet className="gap-2" disabled={disabled}>
              <FieldLegend className="ticket-label" variant="label">
                {labels.time}
              </FieldLegend>
              <FieldGroup className="grid grid-cols-2 gap-3">
                <LabeledSelect
                  aria-describedby={invalid ? `${inputId}-error` : undefined}
                  aria-invalid={invalid || undefined}
                  contentProps={TIME_MENU_PROPS}
                  disabled={disabled}
                  id={`${inputId}-hour`}
                  label={labels.hour}
                  onBlur={onBlur}
                  onValueChange={(next) => {
                    if (next === null) return;
                    onValueChange(
                      `${effectiveDate}T${next}:${minute || minimumMinute}`,
                    );
                  }}
                  options={HOURS.map((value) => ({
                    disabled: atMinimumDate && value < minimumHour,
                    label: timeFormat.format(Number(value)),
                    value,
                  }))}
                  placeholder={labels.hour}
                  triggerClassName="min-h-11 sm:min-h-8"
                  value={hour || null}
                />
                <LabeledSelect
                  aria-describedby={invalid ? `${inputId}-error` : undefined}
                  aria-invalid={invalid || undefined}
                  contentProps={TIME_MENU_PROPS}
                  disabled={disabled}
                  id={`${inputId}-minute`}
                  label={labels.minute}
                  onBlur={onBlur}
                  onValueChange={(next) => {
                    if (next === null) return;
                    onValueChange(`${effectiveDate}T${effectiveHour}:${next}`);
                  }}
                  options={MINUTES.map((value) => ({
                    disabled:
                      atMinimumDate &&
                      (effectiveHour < minimumHour ||
                        (effectiveHour === minimumHour &&
                          value < minimumMinute)),
                    label: timeFormat.format(Number(value)),
                    value,
                  }))}
                  placeholder={labels.minute}
                  triggerClassName="min-h-11 sm:min-h-8"
                  value={minute || null}
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
        </PopoverContent>
      </Popover>
      <p
        id={`${inputId}-hint`}
        className="wrap-break-word text-muted-foreground text-xs/relaxed"
      >
        {persian && selected ? (
          <>
            {labels.gregorian}: <bdi dir="ltr">{datePart}</bdi> ·{" "}
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
          {labels.invalid}
        </p>
      ) : null}
    </div>
  );
}

function civilDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new TZDate(`${value}T12:00:00Z`, "UTC");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : undefined;
}
