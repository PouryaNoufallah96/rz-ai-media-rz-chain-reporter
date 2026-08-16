import { Button } from "@rz-chain-reporter/ui/components/button";

import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Link } from "@/i18n/navigation";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT(SHARED_NAMESPACE);

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16"
      id="main-content"
    >
      <h1 className="font-semibold text-3xl">{t("notFound.title")}</h1>
      <p className="mt-3 text-muted-foreground">{t("notFound.body")}</p>
      <div className="mt-6">
        <Button
          nativeButton={false}
          render={<Link href="/" />}
          variant="outline"
        >
          {t("notFound.home")}
        </Button>
      </div>
    </main>
  );
}
