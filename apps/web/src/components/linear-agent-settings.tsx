"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { Link2, Trash2, Check, Copy, Loader2, Bot, X } from "lucide-react";

interface Registration {
  id: string;
  name: string;
  oauthClientId: string;
  enabled: boolean;
  systemPrompt?: string;
  marketplacePlugins?: string[];
  selectedSkillIds?: string[];
  selectedMcpServerIds?: string[];
}

interface RegistrationForm {
  name: string;
  oauthClientId: string;
  webhookSecret: string;
  systemPrompt: string;
  marketplacePlugins: string[];
}

const emptyForm: RegistrationForm = {
  name: "",
  oauthClientId: "",
  webhookSecret: "",
  systemPrompt: "",
  marketplacePlugins: [],
};

export function LinearAgentSettings() {
  // Global config state
  const [tokenValue, setTokenValue] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [configLoading, setConfigLoading] = useState(true);
  const [savingToken, setSavingToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Registration state
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [registrationLoading, setRegistrationLoading] = useState(true);
  const [form, setForm] = useState<RegistrationForm>({ ...emptyForm });
  const [pluginInput, setPluginInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadConfig = async () => {
    try {
      const config = await api.getLinearConfig();
      setTokenConfigured(config.tokenConfigured);
      setConnected(config.connected);
      setWebhookUrl(config.webhookUrl);
    } catch {
      // Config endpoint may not be available yet
    } finally {
      setConfigLoading(false);
    }
  };

  const loadRegistration = async () => {
    try {
      const res = await api.getLinearRegistration();
      const reg = res.registration as Registration | null;
      setRegistration(reg);
      if (reg) {
        setForm({
          name: reg.name,
          oauthClientId: reg.oauthClientId,
          webhookSecret: "",
          systemPrompt: reg.systemPrompt || "",
          marketplacePlugins: reg.marketplacePlugins || [],
        });
      }
    } catch {
      // Registration endpoint may not be available yet
    } finally {
      setRegistrationLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
    loadRegistration();
  }, []);

  const handleSaveToken = async () => {
    if (!tokenValue.trim()) return;
    setSavingToken(true);
    try {
      await api.createSecret({
        name: "LINEAR_API_TOKEN",
        value: tokenValue.trim(),
        scope: "global",
      });
      toast.success("API token saved", {
        description: "LINEAR_API_TOKEN has been encrypted and stored.",
      });
      setTokenValue("");
      setTokenConfigured(true);
      loadConfig();
    } catch (err) {
      toast.error("Failed to save token", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSavingToken(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await api.testLinearConnection();
      if (res.success) {
        toast.success("Connection successful", { description: "Linear API token is valid." });
        setConnected(true);
      } else {
        toast.error("Connection failed", {
          description: res.error || "Could not connect to Linear.",
        });
        setConnected(false);
      }
    } catch (err) {
      toast.error("Connection test failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleCopyWebhook = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("Webhook URL copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddPlugin = () => {
    const value = pluginInput.trim();
    if (!value) return;
    if (form.marketplacePlugins.includes(value)) {
      toast.error("Plugin already added");
      return;
    }
    setForm((f) => ({ ...f, marketplacePlugins: [...f.marketplacePlugins, value] }));
    setPluginInput("");
  };

  const handleRemovePlugin = (plugin: string) => {
    setForm((f) => ({
      ...f,
      marketplacePlugins: f.marketplacePlugins.filter((p) => p !== plugin),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registration && !form.webhookSecret) {
      toast.error("Webhook secret is required for initial setup");
      return;
    }
    setSubmitting(true);
    try {
      const input: any = {
        name: form.name,
        oauthClientId: form.oauthClientId,
        webhookSecret: form.webhookSecret || "placeholder",
        systemPrompt: form.systemPrompt || undefined,
        marketplacePlugins:
          form.marketplacePlugins.length > 0 ? form.marketplacePlugins : undefined,
      };
      // For updates where webhook secret wasn't changed, use existing secret
      if (registration && !form.webhookSecret) {
        input.webhookSecret = "unchanged";
      }
      await api.saveLinearRegistration(input);
      toast.success(registration ? "Registration updated" : "Registration created");
      setForm((f) => ({ ...f, webhookSecret: "" }));
      loadRegistration();
    } catch (err) {
      toast.error("Failed to save registration", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteLinearRegistration();
      toast.success("Registration deleted");
      setRegistration(null);
      setForm({ ...emptyForm });
    } catch (err) {
      toast.error("Failed to delete registration", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* API Token Card */}
      <div className="p-5 rounded-xl border border-border/50 bg-bg-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">API Token</h3>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-error"}`} />
            <span className="text-xs text-text-muted">
              {connected ? "Connected" : "Not configured"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={tokenValue}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder={tokenConfigured ? "••••••••••••••••" : "lin_api_..."}
            className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          <button
            onClick={handleSaveToken}
            disabled={savingToken || !tokenValue.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {savingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </button>
        </div>
        {tokenConfigured && (
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-bg-hover disabled:opacity-50"
          >
            {testing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Testing...
              </span>
            ) : (
              "Test Connection"
            )}
          </button>
        )}
      </div>

      {/* Webhook URL Card */}
      <div className="p-5 rounded-xl border border-border/50 bg-bg-card space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Link2 className="w-4 h-4" />
          Webhook URL
        </h3>
        <p className="text-xs text-text-muted">
          Add this URL as a webhook in your Linear settings to receive events.
        </p>
        {webhookUrl ? (
          <div className="flex gap-2">
            <input
              readOnly
              value={webhookUrl}
              className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-sm font-mono text-text-muted focus:outline-none"
            />
            <button
              onClick={handleCopyWebhook}
              className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-bg-hover"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <p className="text-xs text-text-muted italic">
            Webhook URL will be available after the API token is configured.
          </p>
        )}
      </div>

      {/* Agent Registration Card */}
      <div className="p-5 rounded-xl border border-border/50 bg-bg-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Agent Registration
          </h3>
          {registration && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-error hover:bg-error/10 disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Delete
            </button>
          )}
        </div>

        {registrationLoading ? (
          <div className="flex items-center justify-center py-6 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading...
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My Linear Agent"
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">OAuth Client ID</label>
              <input
                required
                value={form.oauthClientId}
                onChange={(e) => setForm((f) => ({ ...f, oauthClientId: e.target.value }))}
                placeholder="client_id_..."
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">
                Webhook Secret{registration ? " (leave blank to keep current)" : ""}
              </label>
              <input
                type="password"
                required={!registration}
                value={form.webhookSecret}
                onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                placeholder={registration ? "••••••••" : "whsec_..."}
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">System Prompt</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="Optional system prompt for the agent..."
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm resize-y focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Marketplace Plugins</label>
              <div className="flex gap-2">
                <input
                  value={pluginInput}
                  onChange={(e) => setPluginInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddPlugin();
                    }
                  }}
                  placeholder="e.g. l10n@gynzy"
                  className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={handleAddPlugin}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-bg-hover"
                >
                  Add
                </button>
              </div>
              {form.marketplacePlugins.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {form.marketplacePlugins.map((plugin) => (
                    <span
                      key={plugin}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-hover text-xs font-mono"
                    >
                      {plugin}
                      <button
                        type="button"
                        onClick={() => handleRemovePlugin(plugin)}
                        className="p-0.5 rounded hover:bg-error/10 hover:text-error"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </span>
              ) : registration ? (
                "Update"
              ) : (
                "Create"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
