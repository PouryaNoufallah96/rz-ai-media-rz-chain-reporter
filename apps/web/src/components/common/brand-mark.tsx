import { cn } from "@rz-chain-reporter/ui/lib/utils";
import Image from "next/image";

export type BrandLogo = { url: string; width: number; height: number };

export function BrandMark({
  className,
  logo,
  name,
}: {
  className?: string;
  logo: BrandLogo | null;
  name: string;
}) {
  if (logo) {
    const wordmark = logo.width > logo.height * 1.5;
    return (
      <Image
        alt=""
        className={cn(
          "size-5 shrink-0 rounded-sm object-contain",
          wordmark && "w-auto max-w-16",
          className,
        )}
        height={logo.height}
        src={logo.url}
        unoptimized
        width={logo.width}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-sm bg-accent font-semibold text-[0.6em] text-accent-foreground",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}
