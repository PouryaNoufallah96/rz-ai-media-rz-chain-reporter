import AuthPanel from "@/features/auth/components/auth-panel";
import { AUTH_NAMESPACE } from "@/features/auth/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";

export default function LoginPage() {
  return (
    <main id="main-content">
      <Localized namespaces={[SHARED_NAMESPACE, AUTH_NAMESPACE]}>
        <AuthPanel />
      </Localized>
    </main>
  );
}
