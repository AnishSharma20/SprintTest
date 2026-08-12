"use client";

import { useEffect, useState } from "react";

/**
 * The signed-in Microsoft identity, used as the "Reviewer" name recorded on approvals, quality
 * scores and rule changes. Replaces the old free-text localStorage field: the name is only ever
 * what Microsoft gave us at sign in, not something typed in.
 */
export function useCurrentUser(): { name: string; email: string; loading: boolean } {
  const [user, setUser] = useState({ name: "", email: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setUser({ name: data.name, email: data.email });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...user, loading };
}
