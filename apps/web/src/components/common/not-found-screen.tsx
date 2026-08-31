import { Button } from "@rz-chain-reporter/ui/components/button";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { FileQuestionIcon } from "lucide-react";

import { Suspended } from "@/components/fetcher/suspended";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Link } from "@/i18n/navigation";
import { getT } from "@/i18n/server";

export function NotFoundScreen() {
  return (
    <Suspended
      data={() => getT(SHARED_NAMESPACE)}
      fallback={<NotFoundSkeleton />}
    >
      {(t) => (
        <>
          <FileQuestionIcon
            aria-hidden="true"
            className="mb-5 size-8 text-muted-foreground"
          />
          <h1 className="font-semibold text-3xl tracking-display">
            {t("notFound.title")}
          </h1>
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
        </>
      )}
    </Suspended>
  );
}

async function NotFoundSkeleton() {
  const t = await getT(SHARED_NAMESPACE);

  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        {t("loader.loading")}
      </span>
      <Skeleton className="mb-5 size-8" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-3 h-6 w-full max-w-xl" />
      <Skeleton className="mt-6 h-8 w-32" />
    </div>
  );
}
