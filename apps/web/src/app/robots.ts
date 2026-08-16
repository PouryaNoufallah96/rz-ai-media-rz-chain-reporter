import { env } from "@rz-chain-reporter/env/server";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/*/dashboard", "/*/login"],
    },
    sitemap: `${env.APP_URL}/sitemap.xml`,
  };
}
