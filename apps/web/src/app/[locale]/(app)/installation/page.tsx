import { InstallationScreen } from "@/features/installation/components/installation-screen";

export default function InstallationPage() {
  return (
    <main
      className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8"
      id="main-content"
      tabIndex={-1}
    >
      <InstallationScreen />
    </main>
  );
}
