"use client";

import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { LinearAgentSettings } from "@/components/linear-agent-settings";

export default function LinearAgentPage() {
  usePageTitle("Linear Agent");
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Linear Agent</h1>
        <p className="text-sm text-text-muted mt-1">
          Configure Linear integration to automatically run an agent from Linear issues and
          comments.
        </p>
      </div>
      <LinearAgentSettings />
    </div>
  );
}
