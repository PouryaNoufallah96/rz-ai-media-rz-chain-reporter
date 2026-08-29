import { Card } from "@rz-chain-reporter/ui/components/card";
import { Suspended } from "@/components/fetcher/suspended";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";
import { requireGuest } from "../api/server/session";
import { AUTH_NAMESPACE } from "../constants";
import SignInForm from "./sign-in-form";
import { SignInSideRays } from "./sign-in-side-rays";

export function SignInScreen() {
  return (
    <>
      <Suspended data={requireGuest} fallback={null}>
        {() => null}
      </Suspended>
      <SignInSideRays />
      <section className="relative z-10 flex min-h-0 flex-1 items-center justify-center">
        <div className="mx-auto w-full max-w-md px-5 py-12 sm:py-20">
          <Card className="overflow-visible bg-card/80 p-6 backdrop-blur-xl sm:p-8">
            <Localized namespaces={[SHARED_NAMESPACE, AUTH_NAMESPACE]}>
              <SignInForm />
            </Localized>
          </Card>
        </div>
      </section>
    </>
  );
}
