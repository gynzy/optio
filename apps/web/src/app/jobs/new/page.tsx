"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The standalone-only create page is retired in favor of the unified form
 * at /tasks/new (which handles both standalone and repo tasks via the
 * "Attach a repo" toggle). Redirect here so existing bookmarks still work.
 */
export default function LegacyNewJobRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/tasks/new");
  }, [router]);
  return null;
}
