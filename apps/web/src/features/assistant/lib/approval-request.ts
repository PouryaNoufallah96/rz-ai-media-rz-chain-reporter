export async function postAssistantApproval(
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch("/api/chat/approve", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });
  if (response.ok || response.status === 400 || response.status === 409) {
    return response.json().catch(() => null);
  }
  throw new Error("Assistant approval request failed");
}
