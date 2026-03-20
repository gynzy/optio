"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import Link from "next/link";
import { Loader2, FolderGit2, Lock, Globe, ChevronRight, Settings2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

export default function ReposPage() {
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listRepos()
      .then((res) => setRepos(res.repos))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Repositories</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : repos.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
          <FolderGit2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No repositories configured</p>
          <p className="text-xs mt-1">Add repos during <Link href="/setup" className="text-primary hover:underline">setup</Link> or when creating a task.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {repos.map((repo: any) => (
            <Link
              key={repo.id}
              href={`/repos/${repo.id}`}
              className="flex items-center justify-between p-4 rounded-lg border border-border bg-bg-card hover:bg-bg-hover transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FolderGit2 className="w-5 h-5 text-text-muted shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{repo.fullName}</span>
                    {repo.isPrivate ? (
                      <Lock className="w-3 h-3 text-text-muted" />
                    ) : (
                      <Globe className="w-3 h-3 text-text-muted" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
                    <span>Branch: {repo.defaultBranch}</span>
                    <span>Image: {repo.imagePreset ?? "base"}</span>
                    {repo.autoMerge && <span className="text-warning">auto-merge</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-text-muted">
                <Settings2 className="w-4 h-4" />
                <ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
