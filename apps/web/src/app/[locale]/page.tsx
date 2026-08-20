import { LandingScreen } from "@/features/landing/components/landing-screen";

export default function Home() {
  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16"
      id="main-content"
    >
      <LandingScreen />
    </main>
  );
}
