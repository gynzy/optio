"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp, Code } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ParamField {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  description: string;
  required: boolean;
  enumValues: string; // comma-separated
}

interface ParamsSchemaEditorProps {
  /** JSON string of the schema (e.g., '{"type":"object","properties":{...}}') */
  value: string;
  onChange: (value: string) => void;
  /** Detected params from the prompt template — used for auto-detect */
  detectedParams?: string[];
}

const PARAM_TYPES = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "integer", label: "Integer" },
  { value: "boolean", label: "Boolean" },
] as const;

const INPUT_CLASS =
  "w-full px-2.5 py-1.5 rounded-md bg-bg-card border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors";

// ── Schema ↔ Fields conversion ─────────────────────────────────────────────────

function schemaToFields(jsonStr: string): ParamField[] {
  if (!jsonStr.trim()) return [];
  try {
    const schema = JSON.parse(jsonStr);
    if (schema.type !== "object" || !schema.properties) return [];
    const required = new Set<string>(schema.required ?? []);
    return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
      name,
      type: prop.type ?? "string",
      description: prop.description ?? "",
      required: required.has(name),
      enumValues: Array.isArray(prop.enum) ? prop.enum.join(", ") : "",
    }));
  } catch {
    return [];
  }
}

function fieldsToSchema(fields: ParamField[]): string {
  if (fields.length === 0) return "";
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    if (!field.name.trim()) continue;
    const prop: Record<string, any> = { type: field.type };
    if (field.description) prop.description = field.description;
    if (field.enumValues.trim()) {
      prop.enum = field.enumValues
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    properties[field.name] = prop;
    if (field.required) required.push(field.name);
  }

  if (Object.keys(properties).length === 0) return "";
  const schema: Record<string, any> = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return JSON.stringify(schema, null, 2);
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ParamsSchemaEditor({ value, onChange, detectedParams }: ParamsSchemaEditorProps) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [fields, setFields] = useState<ParamField[]>(() => schemaToFields(value));

  const syncToParent = useCallback(
    (updated: ParamField[]) => {
      setFields(updated);
      onChange(fieldsToSchema(updated));
    },
    [onChange],
  );

  const addField = (name = "") => {
    syncToParent([
      ...fields,
      { name, type: "string", description: "", required: true, enumValues: "" },
    ]);
  };

  const removeField = (index: number) => {
    syncToParent(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<ParamField>) => {
    syncToParent(fields.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  const handleAutoDetect = () => {
    if (!detectedParams?.length) return;
    const existingNames = new Set(fields.map((f) => f.name));
    const newFields = detectedParams
      .filter((p) => !existingNames.has(p))
      .map((name) => ({
        name,
        type: "string" as const,
        description: "",
        required: true,
        enumValues: "",
      }));
    if (newFields.length > 0) {
      syncToParent([...fields, ...newFields]);
    }
  };

  // Handle raw JSON editing
  const handleRawJsonChange = (json: string) => {
    onChange(json);
    const parsed = schemaToFields(json);
    setFields(parsed);
  };

  if (showRawJson) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowRawJson(false)}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors"
          >
            <ChevronUp className="w-3 h-3" /> Visual Editor
          </button>
        </div>
        <textarea
          rows={8}
          value={value}
          onChange={(e) => handleRawJsonChange(e.target.value)}
          placeholder={`{\n  "type": "object",\n  "properties": {\n    "PARAM": { "type": "string" }\n  },\n  "required": ["PARAM"]\n}`}
          className={`${INPUT_CLASS} font-mono text-xs resize-y`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {detectedParams && detectedParams.length > 0 && (
            <button
              type="button"
              onClick={handleAutoDetect}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors"
            >
              <Plus className="w-3 h-3" /> Auto-detect from prompt
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowRawJson(true)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
        >
          <Code className="w-3 h-3" /> Raw JSON
        </button>
      </div>

      {fields.length === 0 ? (
        <div className="text-center py-4 border border-dashed border-border rounded-lg">
          <p className="text-xs text-text-muted mb-2">No parameters defined</p>
          <button
            type="button"
            onClick={() => addField()}
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Parameter
          </button>
        </div>
      ) : (
        <>
          {/* Header row */}
          <div className="grid grid-cols-[1fr_100px_1fr_60px_32px] gap-2 text-[11px] text-text-muted font-medium px-1">
            <span>Name</span>
            <span>Type</span>
            <span>Description</span>
            <span className="text-center">Required</span>
            <span />
          </div>

          {fields.map((field, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_100px_1fr_60px_32px] gap-2 items-center"
            >
              <input
                type="text"
                value={field.name}
                onChange={(e) =>
                  updateField(index, {
                    name: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                  })
                }
                placeholder="PARAM_NAME"
                className={`${INPUT_CLASS} font-mono text-xs py-1.5`}
              />
              <select
                value={field.type}
                onChange={(e) => updateField(index, { type: e.target.value as ParamField["type"] })}
                className={`${INPUT_CLASS} text-xs py-1.5`}
              >
                {PARAM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={field.description}
                onChange={(e) => updateField(index, { description: e.target.value })}
                placeholder="Description"
                className={`${INPUT_CLASS} text-xs py-1.5`}
              />
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(index, { required: e.target.checked })}
                  className="rounded"
                />
              </div>
              <button
                type="button"
                onClick={() => removeField(index)}
                className="p-1 rounded-md text-text-muted hover:text-error hover:bg-error/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => addField()}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Parameter
          </button>
        </>
      )}
    </div>
  );
}
