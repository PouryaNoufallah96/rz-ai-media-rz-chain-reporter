"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";

import { DateTimePicker } from "@/components/form/date-time-picker";

import { PUBLISHING_NAMESPACE } from "../constants";

export function PublishingDateTimePicker(
  props: Omit<ComponentProps<typeof DateTimePicker>, "labels">,
) {
  const t = useTranslations(PUBLISHING_NAMESPACE);

  return (
    <DateTimePicker
      {...props}
      labels={{
        choose: t("dateTime.choose"),
        date: t("dateTime.date"),
        time: t("dateTime.time"),
        hour: t("dateTime.hour"),
        minute: t("dateTime.minute"),
        clear: t("dateTime.clear"),
        close: t("dateTime.close"),
        invalid: t("dateTime.invalid"),
        gregorian: t("dateTime.gregorian"),
      }}
    />
  );
}
