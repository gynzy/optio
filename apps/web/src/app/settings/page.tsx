"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Loader2, Bell, RefreshCw } from "lucide-react";

function PromptTemplateEditor() {
  const [template, setTemplate] = useState("");
  const [autoMerge, setAutoMerge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getEffectiveTemplate()
      .then((res) => {
        setTemplate(res.template);
        setAutoMerge(res.autoMerge);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.savePromptTemplate({ template, autoMerge });
      toast.success("Prompt template saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const res = await api.getBuiltinDefault();
    setTemplate(res.template);
  };

  if (loading) {
    return (
      <div className="p-4 rounded-lg border border-border bg-bg-card text-center text-text-muted text-sm">
        <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading...
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-border bg-bg-card space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          This system prompt is sent to every agent along with a task file.
        </p>
        <button onClick={handleReset} className="text-xs text-primary hover:underline">Reset to default</button>
      </div>
      <textarea
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        rows={12}
        className="w-full px-3 py-2 rounded-md bg-bg border border-border text-xs font-mono focus:outline-none focus:border-primary resize-y leading-relaxed"
      />
      <div className="p-3 rounded-md bg-bg border border-border">
        <p className="text-xs text-text-muted mb-2">Available template variables:</p>
        <ul className="text-xs space-y-1.5">
          <li className="flex items-start gap-2">
            <code className="text-primary shrink-0">{"{{TASK_FILE}}"}</code>
            <span className="text-text-muted">Path to the task markdown file written into the worktree</span>
          </li>
          <li className="flex items-start gap-2">
            <code className="text-primary shrink-0">{"{{BRANCH_NAME}}"}</code>
            <span className="text-text-muted">Git branch name the agent is working on</span>
          </li>
          <li className="flex items-start gap-2">
            <code className="text-primary shrink-0">{"{{TASK_ID}}"}</code>
            <span className="text-text-muted">Unique task identifier</span>
          </li>
          <li className="flex items-start gap-2">
            <code className="text-primary shrink-0">{"{{TASK_TITLE}}"}</code>
            <span className="text-text-muted">Short title of the task</span>
          </li>
          <li className="flex items-start gap-2">
            <code className="text-primary shrink-0">{"{{REPO_NAME}}"}</code>
            <span className="text-text-muted">Repository name (e.g. owner/repo)</span>
          </li>
          <li className="flex items-start gap-2">
            <code className="text-primary shrink-0">{"{{AUTO_MERGE}}"}</code>
            <span className="text-text-muted">Whether auto-merge is enabled — use with <code className="text-primary">{"{{#if AUTO_MERGE}}...{{/if}}"}</code></span>
          </li>
        </ul>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={autoMerge}
            onChange={(e) => setAutoMerge(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          Auto-merge PRs
        </label>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-md bg-primary text-white text-xs hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [providers, setProviders] = useState<any[]>([]);

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setNotificationsEnabled(Notification.permission === "granted");
    }
    api.listTicketProviders().then((res) => setProviders(res.providers)).catch(() => {});
  }, []);

  const requestNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotificationsEnabled(result === "granted");
    if (result === "granted") {
      toast.success("Notifications enabled");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncTickets();
      toast.success(`Synced ${res.synced} tickets`);
    } catch (err) {
      toast.error("Sync failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* Notifications */}
      <section>
        <h2 className="text-sm font-medium text-text-muted mb-3">Notifications</h2>
        <div className="p-4 rounded-lg border border-border bg-bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-text-muted" />
              <div>
                <p className="text-sm">Browser Notifications</p>
                <p className="text-xs text-text-muted">Get notified when tasks complete or need attention</p>
              </div>
            </div>
            <button
              onClick={requestNotifications}
              disabled={notificationsEnabled}
              className={`px-3 py-1.5 rounded-md text-xs ${
                notificationsEnabled
                  ? "bg-success/10 text-success"
                  : "bg-primary text-white hover:bg-primary-hover"
              }`}
            >
              {notificationsEnabled ? "Enabled" : "Enable"}
            </button>
          </div>
        </div>
      </section>

      {/* Ticket Sync */}
      <section>
        <h2 className="text-sm font-medium text-text-muted mb-3">Ticket Integration</h2>
        <div className="p-4 rounded-lg border border-border bg-bg-card space-y-3">
          <p className="text-xs text-text-muted">
            Sync issues labeled with <code className="px-1 py-0.5 bg-bg rounded text-primary">optio</code> from your configured ticket providers.
          </p>
          {providers.length > 0 ? (
            <div className="space-y-2">
              {providers.map((p: any) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${p.enabled ? "bg-success" : "bg-text-muted"}`} />
                  <span className="capitalize">{p.source}</span>
                  <span className="text-xs text-text-muted">
                    {p.source === "github" && p.config?.owner && `${p.config.owner}/${p.config.repo}`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No ticket providers configured.</p>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Sync Now
          </button>
        </div>
      </section>

      {/* Prompt Template */}
      <section>
        <h2 className="text-sm font-medium text-text-muted mb-3">Agent Prompt Template</h2>
        <PromptTemplateEditor />
      </section>
    </div>
  );
}
