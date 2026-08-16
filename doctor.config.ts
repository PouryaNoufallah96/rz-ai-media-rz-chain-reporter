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
  },
} satisfies ReactDoctorConfig;
