"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Link2,
  Plus,
  Trash2,
  Check,
  Copy,
  Loader2,
  Bot,
  Pencil,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

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

export function LinearAgentsSettings() {
  // Global config state
  const [tokenValue, setTokenValue] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [configLoading, setConfigLoading] = useState(true);
  const [savingToken, setSavingToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Registrations state
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<RegistrationForm>({ ...emptyForm });
  const [pluginInput, setPluginInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const loadRegistrations = async () => {
    try {
      const res = await api.listLinearRegistrations();
      setRegistrations(res.registrations);
    } catch {
      // Registrations endpoint may not be available yet
    } finally {
      setRegistrationsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
    loadRegistrations();
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

  const handleStartEdit = (reg: Registration) => {
    setEditingId(reg.id);
    setShowAddForm(false);
    setForm({
      name: reg.name,
      oauthClientId: reg.oauthClientId,
      webhookSecret: "",
      systemPrompt: reg.systemPrompt || "",
      marketplacePlugins: reg.marketplacePlugins || [],
    });
    setPluginInput("");
    setExpandedId(reg.id);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setShowAddForm(false);
    setForm({ ...emptyForm });
    setPluginInput("");
  };

  const handleStartAdd = () => {
    setShowAddForm(true);
    setEditingId(null);
    setForm({ ...emptyForm });
    setPluginInput("");
  };

  const handleSaveRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingId) {
        const update: Record<string, unknown> = {
          name: form.name,
          oauthClientId: form.oauthClientId,
          systemPrompt: form.systemPrompt || undefined,
          marketplacePlugins: form.marketplacePlugins,
        };
        if (form.webhookSecret) {
          update.webhookSecret = form.webhookSecret;
        }
        await api.updateLinearRegistration(editingId, update);
        toast.success("Registration updated");
      } else {
        if (!form.webhookSecret) {
          toast.error("Webhook secret is required for new registrations");
          setSubmitting(false);
          return;
        }
        await api.createLinearRegistration({
          name: form.name,
          oauthClientId: form.oauthClientId,
          webhookSecret: form.webhookSecret,
          systemPrompt: form.systemPrompt || undefined,
          marketplacePlugins:
            form.marketplacePlugins.length > 0 ? form.marketplacePlugins : undefined,
        });
        toast.success("Registration created");
      }
      handleCancelEdit();
      loadRegistrations();
    } catch (err) {
      toast.error("Failed to save registration", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRegistration = async (id: string) => {
    try {
      await api.deleteLinearRegistration(id);
      toast.success("Registration deleted");
      if (editingId === id) handleCancelEdit();
      loadRegistrations();
    } catch (err) {
      toast.error("Failed to delete registration", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleToggleEnabled = async (reg: Registration) => {
    try {
      await api.updateLinearRegistration(reg.id, { enabled: !reg.enabled });
      loadRegistrations();
    } catch {
      toast.error("Failed to update registration");
    }
  };

  const truncate = (str: string, len: number) =>
    str.length > len ? str.slice(0, len) + "..." : str;

  const renderRegistrationForm = () => (
    <form onSubmit={handleSaveRegistration} className="space-y-3 mt-3">
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
          Webhook Secret{editingId ? " (leave blank to keep current)" : ""}
        </label>
        <input
          type="password"
          required={!editingId}
          value={form.webhookSecret}
          onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
          placeholder={editingId ? "••••••••" : "whsec_..."}
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
      <div className="flex gap-2 pt-1">
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
          ) : (
            "Save"
          )}
        </button>
        <button
          type="button"
          onClick={handleCancelEdit}
          className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-bg-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  );

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
      {/* Global Configuration Card */}
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

      {/* Agent Registrations Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Agent Registrations</h3>
          <button
            onClick={handleStartAdd}
            disabled={showAddForm}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        {showAddForm && (
          <div className="p-5 rounded-xl border border-border/50 bg-bg-card">
            <h4 className="text-sm font-medium">New Registration</h4>
            {renderRegistrationForm()}
          </div>
        )}

        {registrationsLoading ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading registrations...
          </div>
        ) : registrations.length === 0 && !showAddForm ? (
          <div className="text-center py-8 text-text-muted border border-dashed border-border rounded-lg">
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No agent registrations</p>
            <p className="text-xs mt-1">Add a registration to connect Linear agents to Optio.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {registrations.map((reg) => (
              <div key={reg.id} className="p-4 rounded-xl border border-border/50 bg-bg-card">
                {editingId === reg.id ? (
                  <div>
                    <h4 className="text-sm font-medium">Edit Registration</h4>
                    {renderRegistrationForm()}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setExpandedId(expandedId === reg.id ? null : reg.id)}
                          className="p-0.5 rounded hover:bg-bg-hover"
                        >
                          {expandedId === reg.id ? (
                            <ChevronUp className="w-4 h-4 text-text-muted" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-text-muted" />
                          )}
                        </button>
                        <div>
                          <span className="text-sm font-medium">{reg.name}</span>
                          <span className="ml-3 font-mono text-xs text-text-muted">
                            {truncate(reg.oauthClientId, 24)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleEnabled(reg)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            reg.enabled ? "bg-primary" : "bg-border"
                          }`}
                          title={reg.enabled ? "Disable" : "Enable"}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                              reg.enabled ? "translate-x-4.5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                        <button
                          onClick={() => handleStartEdit(reg)}
                          className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteRegistration(reg.id)}
                          className="p-1.5 rounded-md hover:bg-error/10 text-text-muted hover:text-error"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {expandedId === reg.id && (
                      <div className="mt-3 pt-3 border-t border-border/50 space-y-2 text-xs text-text-muted">
                        {reg.systemPrompt && (
                          <div>
                            <span className="font-medium text-text">System Prompt:</span>
                            <p className="mt-0.5 whitespace-pre-wrap">{reg.systemPrompt}</p>
                          </div>
                        )}
                        {reg.marketplacePlugins && reg.marketplacePlugins.length > 0 && (
                          <div>
                            <span className="font-medium text-text">Plugins:</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {reg.marketplacePlugins.map((plugin) => (
                                <span
                                  key={plugin}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-bg-hover font-mono"
                                >
                                  {plugin}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {!reg.systemPrompt &&
                          (!reg.marketplacePlugins || reg.marketplacePlugins.length === 0) && (
                            <p className="italic">No additional configuration.</p>
                          )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
