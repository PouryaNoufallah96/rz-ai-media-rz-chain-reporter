"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { EDITORIAL_NAMESPACE } from "../constants";

export function ExpandablePreview({ children }: { children: string }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronUpIcon : ChevronDownIcon;

  return (
    <Collapsible className="grid gap-2" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        render={
          <Button
            className="w-fit max-sm:min-h-11"
            size="xs"
            type="button"
            variant="ghost"
          />
        }
      >
        {t(open ? "detail.hidePreview" : "detail.showPreview")}
        <Icon aria-hidden="true" data-icon="inline-end" />
      </CollapsibleTrigger>
      <CollapsibleContent className="wrap-anywhere">
        <Bdi className="block text-start" dir="auto">
          {children}
        </Bdi>
      </CollapsibleContent>
    </Collapsible>
  );
}
