"use client";

import { DayPicker as PersianDayPicker } from "@daypicker/persian";
import {
  type DayButton,
  DayPicker,
  type DayPickerLocale,
  type DayPickerProps,
  TZDate,
} from "@daypicker/react";
import { enUS } from "@daypicker/react/locale/en-US";
import {
  Button,
  buttonVariants,
} from "@rz-chain-reporter/ui/components/button";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type ComponentProps, useEffect, useRef } from "react";

function Calendar({
  calendar,
  className,
  classNames,
  components,
  ...props
}: DayPickerProps & {
  calendar: "gregory" | "persian";
  locale?: DayPickerLocale;
}) {
  const CalendarComponent =
    calendar === "persian" ? PersianDayPicker : DayPicker;
  return (
    <CalendarComponent
      showOutsideDays
      locale={calendar === "gregory" ? enUS : undefined}
      className={cn(
        "w-fit p-2 [--cell-size:2.75rem] sm:[--cell-size:2.25rem]",
        className,
      )}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex w-full flex-col gap-2",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-(--cell-size) aria-disabled:opacity-40",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-(--cell-size) aria-disabled:opacity-40",
        ),
        month_caption:
          "flex h-(--cell-size) items-center justify-center px-(--cell-size)",
        caption_label: "text-sm font-medium",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-(--cell-size) py-2 text-center text-xs font-normal text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "group/day relative size-(--cell-size) p-0 text-center",
        today: "rounded-md bg-accent text-accent-foreground",
        outside: "text-muted-foreground",
        disabled: "opacity-35",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: iconClassName }) =>
          orientation === "left" ? (
            <ChevronLeftIcon
              aria-hidden="true"
              className={cn("size-4 rtl:rotate-180", iconClassName)}
            />
          ) : (
            <ChevronRightIcon
              aria-hidden="true"
              className={cn("size-4 rtl:rotate-180", iconClassName)}
            />
          ),
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  day,
  modifiers,
  className,
  ...props
}: ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      className={cn(
        "size-(--cell-size) p-0 font-normal text-sm data-selected:bg-primary data-selected:text-primary-foreground",
        className,
      )}
      data-selected={modifiers.selected || undefined}
      size="icon"
      variant="ghost"
      {...props}
    />
  );
}

export { Calendar, TZDate };
