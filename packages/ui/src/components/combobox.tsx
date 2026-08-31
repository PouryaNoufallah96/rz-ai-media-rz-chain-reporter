"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useDirection } from "@base-ui/react/direction-provider";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@rz-chain-reporter/ui/components/input-group";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

const Combobox = ComboboxPrimitive.Root;

function ComboboxInput({
  className,
  toggleLabel,
  disabled,
  ...props
}: Omit<ComboboxPrimitive.Input.Props, "className"> & {
  className?: string;
  toggleLabel: string;
}) {
  return (
    <InputGroup className={className}>
      <ComboboxPrimitive.Input
        disabled={disabled}
        render={<InputGroupInput />}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        <ComboboxPrimitive.Trigger
          aria-label={toggleLabel}
          disabled={disabled}
          render={<InputGroupButton size="icon-xs" variant="ghost" />}
        >
          <ChevronDownIcon aria-hidden="true" />
        </ComboboxPrimitive.Trigger>
      </InputGroupAddon>
    </InputGroup>
  );
}

function ComboboxContent({
  className,
  ...props
}: ComboboxPrimitive.Popup.Props) {
  const direction = useDirection();
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        align="start"
        className="isolate z-50"
        side="bottom"
        sideOffset={6}
      >
        <ComboboxPrimitive.Popup
          className={cn(
            "max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
            className,
          )}
          data-slot="combobox-content"
          dir={direction}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      className={cn(
        "max-h-[min(--spacing(64),calc(var(--available-height)-(--spacing(2))-2px))] scroll-py-1 overflow-y-auto overscroll-contain",
        className,
      )}
      data-slot="combobox-list"
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        "relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-md py-2 ps-2 pe-8 text-xs outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 max-sm:min-h-11",
        className,
      )}
      data-slot="combobox-item"
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="absolute inset-e-2 flex size-4 items-center justify-center">
        <CheckIcon aria-hidden="true" className="size-3.5" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      className={cn("p-3 text-muted-foreground text-xs", className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
};
