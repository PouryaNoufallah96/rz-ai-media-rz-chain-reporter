"use client";

import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({
  dir,
  ...props
}: Omit<ToasterProps, "dir"> & { dir: "ltr" | "rtl" }) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      dir={dir}
      // DESIGN.md anchors the toast at the inline end; sonner's own positions
      // are physical, and its runtime-injected CSS outranks a plain utility.
      position={dir === "rtl" ? "bottom-left" : "bottom-right"}
      theme={theme as ToasterProps["theme"]}
      className="toaster group motion-reduce:transition-none!"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Spinner className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast motion-reduce:animate-none! motion-reduce:transition-none!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
