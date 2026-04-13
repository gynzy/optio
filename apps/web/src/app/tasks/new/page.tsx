"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";
import { api } from "@/lib/api-client";
import { NumberInput } from "@/components/number-input";
import { Loader2, Sparkles, Link2 } from "lucide-react";
import { toast } from "sonner";

export default function NewTaskPage() {
  usePageTitle("New Task");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [repos, setRepos] = useState<any[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [existingTasks, setExistingTasks] = useState<any[]>([]);
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [showDeps, setShowDeps] = useState(false);
  const [form, setForm] = useState({
    title: "",
    prompt: "",
    repoId: "",
    repoUrl: "",
    repoBranch: "main",
    agentType: "claude-code",
    maxRetries: 3,
    priority: 100,
  });

  useEffect(() => {
    api
      .listRepos()
      .then((res) => {
        setRepos(res.repos);
        if (res.repos.length > 0) {
          const first = res.repos[0];
          setForm((f) => ({
            ...f,
            repoId: first.id,
            repoUrl: first.repoUrl,
            repoBranch: first.defaultBranch ?? "main",
            agentType: first.defaultAgentType ?? "claude-code",
          }));
        }
      })
      .catch(() => {})
      .finally(() => setReposLoading(false));
    api
      .listTasks({ limit: 100 })
      .then((res) => setExistingTasks(res.tasks))
      .catch(() => {});
  }, []);

  const handleRepoChange = (repoId: string) => {
    const repo = repos.find((r: any) => r.id === repoId);
    if (repo) {
      setForm((f) => ({
        ...f,
        repoId: repo.id,
        repoUrl: repo.repoUrl,
        repoBranch: repo.defaultBranch ?? "main",
        agentType: repo.defaultAgentType ?? "claude-code",
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.createTask({
        title: form.title,
        prompt: form.prompt,
        repoUrl: form.repoUrl,
        repoBranch: form.repoBranch,
        agentType: form.agentType,
        maxRetries: form.maxRetries,
        priority: form.priority,
        ...(selectedDeps.length > 0 ? { dependsOn: selectedDeps } : {}),
      });
      toast.success("Task created", { description: `Task "${form.title}" has been queued.` });
      router.push(`/tasks/${res.task.id}`);
    } catch (err) {
      toast.error("Failed to create task", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedRepo = repos.find((r: any) => r.id === form.repoId);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Create New Task</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Repository */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Repository</label>
          {reposLoading ? (
            <div className="flex items-center gap-2 text-text-muted text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading repos...
            </div>
          ) : repos.length > 0 ? (
            <select
              required
              value={form.repoId}
              onChange={(e) => handleRepoChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            >
              {repos.map((repo: any) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName} ({repo.defaultBranch})
                </option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-text-muted py-2">
              No repos configured.{" "}
              <a href="/repos" className="text-primary hover:underline">
                Add a repo
              </a>{" "}
              first.
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Title</label>
          <input
            type="text"
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Add input validation to user registration"
            className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Task Description</label>
          <textarea
            required
            rows={6}
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            placeholder="Describe what the agent should do. Be specific about requirements, files to modify, and expected behavior."
            className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors resize-y"
          />
        </div>

        {/* Branch + Agent Type row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Branch</label>
            <input
              type="text"
              value={form.repoBranch}
              onChange={(e) => setForm((f) => ({ ...f, repoBranch: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">Agent</label>
            <select
              value={form.agentType}
              onChange={(e) => setForm((f) => ({ ...f, agentType: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            >
              <option value="claude-code">Claude Code</option>
              <option value="codex">OpenAI Codex</option>
              <option value="copilot">GitHub Copilot</option>
              <option value="opencode">OpenCode (Experimental)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openclaw">OpenClaw (Experimental)</option>
            </select>
          </div>
        </div>

        {/* Dependencies */}
        <div>
          <button
            type="button"
            onClick={() => setShowDeps(!showDeps)}
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" />
            Dependencies {selectedDeps.length > 0 && `(${selectedDeps.length})`}
          </button>
          {showDeps && (
            <div className="mt-2 p-3 rounded-lg bg-bg-card border border-border">
              <p className="text-xs text-text-muted/60 mb-2">
                This task will wait until selected tasks complete before running.
              </p>
              {existingTasks.length === 0 ? (
                <p className="text-xs text-text-muted">No existing tasks to depend on.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {existingTasks
                    .filter((t) => !["completed", "cancelled"].includes(t.state))
                    .map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 text-xs text-text py-0.5 cursor-pointer hover:bg-bg-hover rounded px-1"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDeps.includes(t.id)}
                          onChange={(e) => {
                            setSelectedDeps((prev) =>
                              e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                            );
                          }}
                          className="rounded"
                        />
                        <span className="truncate flex-1">{t.title}</span>
                        <span className="text-text-muted shrink-0">{t.state}</span>
                      </label>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm text-text-muted mb-1.5">Priority</label>
          <p className="text-xs text-text-muted/60 mb-1.5">
            Lower number = higher priority. Default is 100.
          </p>
          <NumberInput
            min={1}
            max={1000}
            value={form.priority}
            onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
            fallback={100}
            className="w-24 px-3 py-2 rounded-lg bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>

        {/* Submit */}
        <div>
          <button
            type="submit"
            disabled={loading || !form.repoUrl}
            className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {loading ? "Creating..." : "Create Task"}
          </button>
        </div>
      </form>
    </div>
  );
}
