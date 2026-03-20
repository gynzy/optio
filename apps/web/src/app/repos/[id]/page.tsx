"use client";

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PRESET_IMAGES, type PresetImageId } from "@optio/shared";
import {
  Loader2,
  FolderGit2,
  Save,
  Trash2,
  ArrowLeft,
  Lock,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function RepoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [repo, setRepo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [imagePreset, setImagePreset] = useState("base");
  const [extraPackages, setExtraPackages] = useState("");
  const [autoMerge, setAutoMerge] = useState(false);
  const [promptOverride, setPromptOverride] = useState("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [defaultBranch, setDefaultBranch] = useState("main");

  useEffect(() => {
    api.getRepo(id)
      .then((res) => {
        const r = res.repo;
        setRepo(r);
        setImagePreset(r.imagePreset ?? "base");
        setExtraPackages(r.extraPackages ?? "");
        setAutoMerge(r.autoMerge);
        setDefaultBranch(r.defaultBranch);
        if (r.promptTemplateOverride) {
          setUseCustomPrompt(true);
          setPromptOverride(r.promptTemplateOverride);
        }
      })
      .catch(() => toast.error("Failed to load repo"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateRepo(id, {
        imagePreset,
        extraPackages: extraPackages || undefined,
        autoMerge,
        defaultBranch,
        promptTemplateOverride: useCustomPrompt ? promptOverride : null,
      });
      toast.success("Repo settings saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove ${repo?.fullName} from Optio?`)) return;
    try {
      await api.deleteRepo(id);
      toast.success("Repo removed");
      router.push("/repos");
    } catch {
      toast.error("Failed to remove repo");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="flex items-center justify-center h-full text-error">
        Repo not found
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/repos" className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <FolderGit2 className="w-5 h-5 text-text-muted" />
        <h1 className="text-xl font-bold">{repo.fullName}</h1>
        {repo.isPrivate ? <Lock className="w-4 h-4 text-text-muted" /> : <Globe className="w-4 h-4 text-text-muted" />}
      </div>

      {/* Default branch */}
      <section className="p-4 rounded-lg border border-border bg-bg-card space-y-3">
        <h2 className="text-sm font-medium">General</h2>
        <div>
          <label className="block text-xs text-text-muted mb-1">Default Branch</label>
          <input
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            className="w-48 px-3 py-2 rounded-md bg-bg border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoMerge}
            onChange={(e) => setAutoMerge(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm">Auto-merge PRs when CI passes</span>
        </label>
      </section>

      {/* Image */}
      <section className="p-4 rounded-lg border border-border bg-bg-card space-y-3">
        <h2 className="text-sm font-medium">Container Image</h2>
        <p className="text-xs text-text-muted">Choose the base image for agent pods working on this repo.</p>
        <div className="grid gap-1.5">
          {(Object.entries(PRESET_IMAGES) as [PresetImageId, typeof PRESET_IMAGES[PresetImageId]][]).map(([key, img]) => (
            <button
              key={key}
              onClick={() => setImagePreset(key)}
              className={cn(
                "flex items-start gap-3 p-2.5 rounded-md border text-left text-sm transition-colors",
                imagePreset === key ? "border-primary bg-primary/5" : "border-border hover:border-text-muted bg-bg"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center",
                imagePreset === key ? "border-primary" : "border-border"
              )}>
                {imagePreset === key && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <div>
                <span className="font-medium">{img.label}</span>
                <p className="text-xs text-text-muted mt-0.5">{img.description}</p>
              </div>
            </button>
          ))}
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Extra packages (comma-separated)</label>
          <input
            value={extraPackages}
            onChange={(e) => setExtraPackages(e.target.value)}
            placeholder="postgresql-client, redis-tools"
            className="w-full px-3 py-2 rounded-md bg-bg border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </section>

      {/* Prompt override */}
      <section className="p-4 rounded-lg border border-border bg-bg-card space-y-3">
        <h2 className="text-sm font-medium">Prompt Template</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useCustomPrompt}
            onChange={(e) => setUseCustomPrompt(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm">Override the global prompt template for this repo</span>
        </label>
        {useCustomPrompt && (
          <textarea
            value={promptOverride}
            onChange={(e) => setPromptOverride(e.target.value)}
            rows={10}
            placeholder="Custom prompt template for this repo..."
            className="w-full px-3 py-2 rounded-md bg-bg border border-border text-xs font-mono focus:outline-none focus:border-primary resize-y leading-relaxed"
          />
        )}
      </section>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleDelete}
          className="flex items-center gap-2 px-4 py-2 rounded-md text-error text-sm hover:bg-error/10 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Remove Repo
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-md bg-primary text-white text-sm hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
