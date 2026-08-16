import type * as React from "react";

function Bdi({ ...props }: React.ComponentProps<"bdi">) {
  return <bdi data-slot="bdi" {...props} />;
}

export { Bdi };
