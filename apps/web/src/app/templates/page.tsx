"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { usePageTitle } from "@/hooks/use-page-title";
import { FileText, Loader2, Plus, Trash2, Eye, X, Save, Pencil } from "lucide-react";
import { toast } from "sonner";

type TemplateKind = "prompt" | "review" | "job" | "task";

interface Template {
  id: string;
  name: string;
  template: string;
  kind: TemplateKind;
  description: string | null;
  paramsSchema: Record<string, unknown> | null;
  defaultAgentType: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

const KIND_LABELS: Record<TemplateKind, string> = {
  prompt: "Coding prompt",
  review: "Code review",
  job: "Standalone task prompt",
  task: "Repo task blueprint",
};

const KIND_FILTERS: Array<{ value: TemplateKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "prompt", label: "Coding" },
  { value: "review", label: "Review" },
  { value: "job", label: "Standalone" },
  { value: "task", label: "Tasks" },
];

export default function TemplatesPage() {
  usePageTitle("Templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filter, setFilter] = useState<TemplateKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | "new" | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listTemplates();
      setTemplates(res.templates as Template[]);
    } catch (err) {
      toast.error("Failed to load templates", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visible = templates.filter((t) => filter === "all" || t.kind === filter);

  const remove = async (t: Template) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.deleteNamedTemplate(t.id);
      await load();
    } catch (err) {
      toast.error("Failed to delete", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-text-muted mt-1">
            Reusable prompt templates. Repo Tasks and Standalone Tasks can reference a template and
            fill in parameters at runtime.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              filter === f.value
                ? "border-primary text-text"
                : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-muted py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <FileText className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            No templates {filter !== "all" && `in "${filter}"`} yet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-base font-medium truncate">{t.name}</h2>
                    <span className="px-2 py-0.5 text-xs rounded bg-bg border border-border text-text-muted">
                      {KIND_LABELS[t.kind] ?? t.kind}
                    </span>
                    {t.defaultAgentType && (
                      <span className="text-xs text-text-muted">{t.defaultAgentType}</span>
                    )}
                  </div>
                  {t.description && <p className="text-xs text-text-muted mb-2">{t.description}</p>}
                  <pre className="text-xs font-mono text-text-muted bg-bg rounded px-2 py-1.5 line-clamp-3 whitespace-pre-wrap">
                    {t.template}
                  </pre>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(t)}
                    title="Edit"
                    className="p-2 rounded hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => remove(t)}
                    title="Delete"
                    className="p-2 rounded hover:bg-bg-hover text-text-muted hover:text-danger transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: template?.name ?? "",
    template: template?.template ?? "",
    kind: (template?.kind ?? "prompt") as TemplateKind,
    description: template?.description ?? "",
    defaultAgentType: template?.defaultAgentType ?? "",
  });
  const [previewParams, setPreviewParams] = useState("{}");
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        template: form.template,
        kind: form.kind,
        description: form.description || undefined,
        defaultAgentType: form.defaultAgentType || undefined,
      };
      if (template) {
        await api.updateNamedTemplate(template.id, payload);
      } else {
        await api.createNamedTemplate(payload);
      }
      toast.success(template ? "Template updated" : "Template created");
      onSaved();
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!template) {
      toast.info("Save the template first to preview.");
      return;
    }
    try {
      const params = JSON.parse(previewParams);
      const res = await api.previewTemplate(template.id, params);
      setPreview(res.rendered);
    } catch (err) {
      toast.error("Preview failed", {
        description: err instanceof Error ? err.message : "Invalid JSON",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-bg flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">{template ? "Edit Template" : "New Template"}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1.5">Kind</label>
              <select
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as TemplateKind }))}
                className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm"
              >
                <option value="prompt">Coding prompt</option>
                <option value="review">Code review</option>
                <option value="job">Standalone task prompt</option>
                <option value="task">Repo task blueprint</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is this template for?"
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">Default agent type</label>
            <input
              type="text"
              value={form.defaultAgentType}
              onChange={(e) => setForm((f) => ({ ...f, defaultAgentType: e.target.value }))}
              placeholder="e.g. claude-code"
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">Template body</label>
            <textarea
              rows={10}
              value={form.template}
              onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
              placeholder={
                "Use {{param}} for substitution.\n{{#if flag}}...{{/if}} for conditionals."
              }
              className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-xs font-mono"
            />
          </div>

          {template && (
            <div className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Preview with params</span>
                <button
                  onClick={handlePreview}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Render
                </button>
              </div>
              <textarea
                rows={3}
                value={previewParams}
                onChange={(e) => setPreviewParams(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-bg-card border border-border text-xs font-mono"
                placeholder='{"name": "example"}'
              />
              {preview !== null && (
                <pre className="bg-bg rounded px-2 py-1.5 text-xs font-mono whitespace-pre-wrap border border-border">
                  {preview}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-bg flex items-center justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:text-text hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name || !form.template}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
