import "server-only";

import { auth } from "@rz-chain-reporter/auth";
import { headers } from "next/headers";
import { cache } from "react";

import { redirect } from "@/i18n/navigation";
import { currentLocale } from "@/i18n/server";

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export async function requireSession() {
  const session = await getSession();

  if (session?.user) {
    return session;
  }

  return redirect({ href: "/login", locale: await currentLocale() });
}

export async function requireActionSession() {
  const session = await getSession();

  if (session?.user) {
    return session;
  }

  throw new Error("unauthorized");
}

export async function requireGuest() {
  const session = await getSession();

  if (session?.user) {
    return redirect({ href: "/dashboard", locale: await currentLocale() });
  }

  return null;
}
