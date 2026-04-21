"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The standalone list page is retired in favor of the "Standalone" tab on
 * /tasks (so Repo Tasks and Standalone Tasks share one hub with matching
 * row styles). Detail pages at /jobs/:id and /jobs/:id/runs/:runId keep
 * working; only this list page redirects.
 */
export default function LegacyJobsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/tasks?tab=standalone");
  }, [router]);
  return null;
}
