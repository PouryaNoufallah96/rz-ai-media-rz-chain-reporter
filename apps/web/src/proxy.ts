import { isLocale } from "@rz-chain-reporter/i18n";
import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

export function proxy(request: NextRequest) {
  const locale = request.nextUrl.pathname.split("/")[1];

  if (!isLocale(locale)) {
    return handleI18nRouting(request);
  }

  const route = request.nextUrl.pathname.slice(locale.length + 1);
  const isPublicRoute =
    route === "" || route === "/" || route === "/login" || route === "/login/";

  if (isPublicRoute || getSessionCookie(request)) {
    return handleI18nRouting(request);
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = `/${locale}/login`;
  loginUrl.search = "";

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.[^/]+$).*)"],
};
