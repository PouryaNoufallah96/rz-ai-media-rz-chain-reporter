import { SignInScreen } from "@/features/auth/components/sign-in-screen";

export default function LoginPage() {
  return (
    <main
      className="relative flex min-h-0 flex-col"
      id="main-content"
      tabIndex={-1}
    >
      <SignInScreen />
    </main>
  );
}
