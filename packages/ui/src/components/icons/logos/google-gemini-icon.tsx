import type { SVGProps } from "react";

export function LogosGoogleGeminiIcon({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      {...props}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="311.994 0 72.76 72.76"
    >
      {title ? <title>{title}</title> : null}
      <path
        fill="#076eff"
        d="M348.374 72.76c-2.846-18.788-17.592-33.533-36.38-36.38c18.788-2.847 33.534-17.593 36.38-36.38c2.847 18.787 17.593 33.533 36.38 36.38c-18.787 2.847-33.533 17.592-36.38 36.38"
      />
    </svg>
  );
}
