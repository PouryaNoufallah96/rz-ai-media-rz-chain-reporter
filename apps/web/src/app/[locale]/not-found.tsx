import { NotFoundScreen } from "@/components/common/not-found-screen";

export default function NotFound() {
  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16"
      id="main-content"
      tabIndex={-1}
    >
      <NotFoundScreen />
    </main>
  );
}
