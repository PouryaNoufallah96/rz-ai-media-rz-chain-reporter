import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@rz-chain-reporter/ui/components/card";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type { ReactNode, Ref } from "react";

const titleClassName = "font-medium text-sm group-data-[size=sm]/card:text-sm";

const CONTENT_CLASS = {
  default: undefined,
  flush: "p-0",
  grid: "grid gap-4",
  stack: "flex min-w-0 flex-1 flex-col gap-4",
} as const;

export function SectionCard({
  action,
  children,
  className,
  content = "default",
  contentClassName,
  description,
  footer,
  section,
  size = "default",
  title,
  titleId,
  titleLevel = 2,
  titleRef,
  titleTabIndex,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  content?: keyof typeof CONTENT_CLASS;
  contentClassName?: string;
  description?: ReactNode;
  footer?: ReactNode;
  section?: boolean | string;
  size?: "default" | "sm";
  title: ReactNode;
  titleId?: string;
  titleLevel?: 2 | 3;
  titleRef?: Ref<HTMLHeadingElement>;
  titleTabIndex?: number;
}) {
  const card = (
    <Card
      className={cn(
        "gap-0 border ring-0",
        section !== undefined && "flex-1",
        className,
      )}
      size={size}
    >
      <CardHeader className="border-b bg-muted/30">
        {titleLevel === 3 ? (
          <h3 className={titleClassName} data-slot="card-title" id={titleId}>
            {title}
          </h3>
        ) : (
          <h2
            className={titleClassName}
            data-slot="card-title"
            id={titleId}
            ref={titleRef}
            tabIndex={titleTabIndex}
          >
            {title}
          </h2>
        )}
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent
        className={cn(
          "py-(--card-spacing)",
          CONTENT_CLASS[content],
          contentClassName,
        )}
      >
        {children}
      </CardContent>
      {footer != null ? (
        <CardFooter>
          {typeof footer === "string" ? (
            <CardDescription>{footer}</CardDescription>
          ) : (
            footer
          )}
        </CardFooter>
      ) : null}
    </Card>
  );

  if (section === undefined) return card;

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col",
        typeof section === "string" ? section : undefined,
      )}
    >
      {card}
    </section>
  );
}
