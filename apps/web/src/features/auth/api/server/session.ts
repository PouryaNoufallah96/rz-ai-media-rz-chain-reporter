import "server-only";

import { auth } from "@rz-chain-reporter/auth";
import { headers } from "next/headers";

import { redirect } from "@/i18n/navigation";
import { currentLocale } from "@/i18n/server";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();

  if (session?.user) {
    return session;
  }

  return redirect({ href: "/login", locale: await currentLocale() });
}
