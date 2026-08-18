import UserMenu from "@/features/auth/components/user-menu";
import { OperationsIndicator } from "@/features/operations/components/operations-indicator";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";
import { Link } from "@/i18n/navigation";
import { getT } from "@/i18n/server";

import { ModeToggle } from "./mode-toggle";

export default async function Header() {
  const t = await getT(SHARED_NAMESPACE);

  return (
    <header className="relative border-b">
      <a
        className="sr-only z-50 bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2"
        href="#main-content"
      >
        {t("header.skipToContent")}
      </a>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav aria-label={t("header.primaryNav")} className="flex gap-4 text-lg">
          <Link href="/">{t("header.home")}</Link>
          <Link href="/dashboard">{t("header.dashboard")}</Link>
          <Link href="/installation">{t("header.installation")}</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Localized namespaces={[SHARED_NAMESPACE, OPERATIONS_NAMESPACE]}>
            <OperationsIndicator />
          </Localized>
          <Localized namespaces={[SHARED_NAMESPACE]}>
            <ModeToggle />
            <UserMenu />
          </Localized>
        </div>
      </div>
    </header>
  );
}
