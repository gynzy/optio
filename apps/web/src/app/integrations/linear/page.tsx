"use client";

import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { LinearAgentsSettings } from "@/components/linear-agents-settings";

export default function LinearAgentsPage() {
  usePageTitle("Linear Agents");
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Linear Agents</h1>
        <p className="text-sm text-text-muted mt-1">
          Configure Linear integration to automatically run agents from Linear issues and comments.
        </p>
      </div>
      <LinearAgentsSettings />
    </div>
  );
}
