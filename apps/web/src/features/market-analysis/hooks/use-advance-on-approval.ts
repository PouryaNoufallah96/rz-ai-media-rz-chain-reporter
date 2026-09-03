"use client";

import { useEffect, useRef, useState } from "react";

export function useAdvanceOnApproval(
  approval: string | null,
  onContinue: () => void,
) {
  const [awaiting, setAwaiting] = useState(false);
  const advanced = useRef(false);

  useEffect(() => {
    if (!awaiting || advanced.current || !approval) return;
    advanced.current = true;
    onContinue();
  }, [approval, awaiting, onContinue]);

  return () => setAwaiting(true);
}
