"use client";

const FOCUS_OPERATION_EVENT = "chainreporter:focus-operation";

export function focusOperation(operationId: string) {
  window.dispatchEvent(
    new CustomEvent(FOCUS_OPERATION_EVENT, { detail: { operationId } }),
  );
}

export function subscribeToOperationFocus(
  listener: (operationId: string) => void,
) {
  const handle = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const operationId = event.detail?.operationId;
    if (typeof operationId === "string") listener(operationId);
  };
  window.addEventListener(FOCUS_OPERATION_EVENT, handle);
  return () => window.removeEventListener(FOCUS_OPERATION_EVENT, handle);
}
