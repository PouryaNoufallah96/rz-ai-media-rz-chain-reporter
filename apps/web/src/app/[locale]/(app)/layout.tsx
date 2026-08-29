import { AssistantScope } from "@/features/assistant/components/assistant-scope";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AssistantScope>{children}</AssistantScope>;
}
