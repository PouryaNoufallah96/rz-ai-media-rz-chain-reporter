import { env } from "@rz-chain-reporter/env/server";
import type { MetadataRoute } from "next";
import { connection } from "next/server";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/*/account",
        "/*/dashboard",
        "/*/installation",
        "/*/login",
        "/*/market-analysis",
        "/*/saved",
        "/*/schedule",
        "/*/sources",
        "/*/usage",
      ],
    },
    sitemap: `${env.APP_URL}/sitemap.xml`,
  };
}
