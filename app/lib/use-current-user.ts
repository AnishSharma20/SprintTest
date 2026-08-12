"use client";

import { useEffect, useState } from "react";

const REVIEWER_KEY = "claimsReviewerName:v1";

/** The reviewer name typed into the sidebar's Reviewer field (shared via localStorage, same key
 * every page uses) — a lightweight read-only view for call sites that only need the name. */
export function useCurrentUser(): { name: string; email: string; loading: boolean } {
  const [name, setName] = useState("");

  useEffect(() => {
    setName(window.localStorage.getItem(REVIEWER_KEY) || "");
  }, []);

  return { name, email: "", loading: false };
}
