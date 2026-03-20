"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, KeyRound, Eye, EyeOff } from "lucide-react";

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", value: "", scope: "global" });
  const [submitting, setSubmitting] = useState(false);

  const loadSecrets = () => {
    api.listSecrets()
      .then((res) => setSecrets(res.secrets))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSecrets(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createSecret(form);
      toast.success("Secret saved", { description: `${form.name} has been encrypted and stored.` });
      setForm({ name: "", value: "", scope: "global" });
      setShowForm(false);
      loadSecrets();
    } catch (err) {
      toast.error("Failed to save secret", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (name: string, scope: string) => {
    try {
      await api.deleteSecret(name, scope);
      toast.success("Secret deleted");
      loadSecrets();
    } catch (err) {
      toast.error("Failed to delete secret");
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Secrets</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Secret
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 p-4 rounded-lg border border-border bg-bg-card space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-text-muted mb-1">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="ANTHROPIC_API_KEY"
                className="w-full px-3 py-2 rounded-md bg-bg border border-border text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Scope</label>
              <input
                value={form.scope}
                onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
                className="w-full px-3 py-2 rounded-md bg-bg border border-border text-sm focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1">Value</label>
            <input
              required
              type="password"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder="sk-ant-..."
              className="w-full px-3 py-2 rounded-md bg-bg border border-border text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-md bg-bg-hover text-text-muted text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading...
        </div>
      ) : secrets.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
          <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No secrets configured</p>
          <p className="text-xs mt-1">Add API keys for Claude Code or Codex to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {secrets.map((secret: any) => (
            <div
              key={secret.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-bg-card"
            >
              <div>
                <span className="text-sm font-medium">{secret.name}</span>
                <span className="text-xs text-text-muted ml-2">({secret.scope})</span>
              </div>
              <button
                onClick={() => handleDelete(secret.name, secret.scope)}
                className="p-1.5 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                title="Delete secret"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
