import type { ReactDoctorConfig } from "react-doctor/api";

// deslop unused-* cannot follow Next routes, Server Actions, or cross-package consumers.
export default {
  ignore: {
    rules: [
      "deslop/unused-export",
      "deslop/unused-file",
      "deslop/unused-dependency",
      "deslop/unused-dev-dependency",
    ],
    overrides: [
      // packages/ui scans without react-compiler, so the rule's own disabledWhen never applies.
      {
        files: ["src/components/drawer.tsx"],
        rules: ["react-doctor/context-provider-value-from-unmemoized-local-literal"],
      },
      // next-intl's useRouter() calls usePathname() internally, so the read adds no subscription.
      {
        files: ["src/components/layout/locale-switch.tsx"],
        rules: ["react-doctor/rerender-defer-reads-hook"],
      },
    ],
  },
} satisfies ReactDoctorConfig;
