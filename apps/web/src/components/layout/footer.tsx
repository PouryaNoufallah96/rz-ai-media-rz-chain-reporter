import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Link } from "@/i18n/navigation";
import { getT } from "@/i18n/server";
import { customerProductName } from "@/lib/customer-template.server";

export async function Footer() {
  const t = await getT(SHARED_NAMESPACE);
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-4 py-4 text-muted-foreground text-xs sm:px-6">
      <Link
        className="rounded-sm font-medium underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        href="/"
      >
        {customerProductName}
      </Link>
      <span>{t("footer.description")}</span>
      <Link
        className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        href="/account"
      >
        {t("header.account")}
      </Link>
    </footer>
  );
}
