import { Suspended } from "@/components/fetcher/suspended";
import { requireGuest } from "@/features/auth/api/server/session";
import SignInForm from "@/features/auth/components/sign-in-form";
import { AUTH_NAMESPACE } from "@/features/auth/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";

export default function LoginPage() {
  return (
    <main id="main-content">
      <Suspended data={requireGuest} fallback={null}>
        {() => null}
      </Suspended>
      <Localized namespaces={[SHARED_NAMESPACE, AUTH_NAMESPACE]}>
        <SignInForm />
      </Localized>
    </main>
  );
}
