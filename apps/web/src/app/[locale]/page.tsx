import { LandingScreen } from "@/features/landing/components/landing-screen";

export default function Home() {
  return (
    <main
      className="relative flex min-h-0 flex-col"
      id="main-content"
      tabIndex={-1}
    >
      <LandingScreen />
    </main>
  );
}
