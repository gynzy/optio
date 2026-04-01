import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { linearAgentRegistrations, customSkills, mcpServers } from "../db/schema.js";
import { encrypt, decrypt, retrieveSecret } from "./secret-service.js";
import { logger } from "../logger.js";
import { LinearClient } from "@linear/sdk";

export interface RegistrationRecord {
  id: string;
  name: string;
  oauthClientId: string;
  systemPrompt: string;
  selectedSkillIds: string[];
  selectedMcpServerIds: string[];
  marketplacePlugins: string[];
  enabled: boolean;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRegistrationInput {
  name: string;
  oauthClientId: string;
  webhookSecret: string;
  systemPrompt?: string;
  selectedSkillIds?: string[];
  selectedMcpServerIds?: string[];
  marketplacePlugins?: string[];
  enabled?: boolean;
}

export interface UpdateRegistrationInput {
  name?: string;
  oauthClientId?: string;
  webhookSecret?: string;
  systemPrompt?: string;
  selectedSkillIds?: string[];
  selectedMcpServerIds?: string[];
  marketplacePlugins?: string[];
  enabled?: boolean;
}

function mapRow(row: typeof linearAgentRegistrations.$inferSelect): RegistrationRecord {
  return {
    id: row.id,
    name: row.name,
    oauthClientId: row.oauthClientId,
    systemPrompt: row.systemPrompt,
    selectedSkillIds: row.selectedSkillIds,
    selectedMcpServerIds: row.selectedMcpServerIds,
    marketplacePlugins: row.marketplacePlugins,
    enabled: row.enabled,
    workspaceId: row.workspaceId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * List all registrations for a workspace (never exposes the webhook secret).
 */
export async function listRegistrations(
  workspaceId?: string | null,
): Promise<RegistrationRecord[]> {
  const rows = workspaceId
    ? await db
        .select()
        .from(linearAgentRegistrations)
        .where(eq(linearAgentRegistrations.workspaceId, workspaceId))
        .orderBy(desc(linearAgentRegistrations.createdAt))
    : await db
        .select()
        .from(linearAgentRegistrations)
        .orderBy(desc(linearAgentRegistrations.createdAt));
  return rows.map(mapRow);
}

/**
 * Get a single registration by ID (no webhook secret exposed).
 */
export async function getRegistration(id: string): Promise<RegistrationRecord | null> {
  const [row] = await db
    .select()
    .from(linearAgentRegistrations)
    .where(eq(linearAgentRegistrations.id, id));
  return row ? mapRow(row) : null;
}

/**
 * Look up a registration by OAuth client ID and decrypt + return the webhook secret.
 * Used during webhook validation.
 */
export async function getRegistrationByClientId(
  oauthClientId: string,
): Promise<(RegistrationRecord & { webhookSecret: string }) | null> {
  const [row] = await db
    .select()
    .from(linearAgentRegistrations)
    .where(eq(linearAgentRegistrations.oauthClientId, oauthClientId));
  if (!row) return null;

  const webhookSecret = decrypt(row.encryptedWebhookSecret, row.secretIv, row.secretAuthTag);

  return { ...mapRow(row), webhookSecret };
}

/**
 * Create a new registration. The webhook secret is encrypted at rest.
 */
export async function createRegistration(
  input: CreateRegistrationInput,
  workspaceId?: string | null,
): Promise<RegistrationRecord> {
  const { encrypted, iv, authTag } = encrypt(input.webhookSecret);

  const [row] = await db
    .insert(linearAgentRegistrations)
    .values({
      name: input.name,
      oauthClientId: input.oauthClientId,
      encryptedWebhookSecret: encrypted,
      secretIv: iv,
      secretAuthTag: authTag,
      systemPrompt: input.systemPrompt ?? "",
      selectedSkillIds: input.selectedSkillIds ?? [],
      selectedMcpServerIds: input.selectedMcpServerIds ?? [],
      marketplacePlugins: input.marketplacePlugins ?? [],
      enabled: input.enabled ?? true,
      workspaceId: workspaceId ?? null,
    })
    .returning();

  return mapRow(row);
}

/**
 * Update an existing registration. If `webhookSecret` is provided it will be
 * re-encrypted; otherwise the existing ciphertext is left untouched.
 */
export async function updateRegistration(
  id: string,
  input: UpdateRegistrationInput,
): Promise<RegistrationRecord | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined) updates.name = input.name;
  if (input.oauthClientId !== undefined) updates.oauthClientId = input.oauthClientId;
  if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt;
  if (input.selectedSkillIds !== undefined) updates.selectedSkillIds = input.selectedSkillIds;
  if (input.selectedMcpServerIds !== undefined)
    updates.selectedMcpServerIds = input.selectedMcpServerIds;
  if (input.marketplacePlugins !== undefined) updates.marketplacePlugins = input.marketplacePlugins;
  if (input.enabled !== undefined) updates.enabled = input.enabled;

  if (input.webhookSecret !== undefined) {
    const { encrypted, iv, authTag } = encrypt(input.webhookSecret);
    updates.encryptedWebhookSecret = encrypted;
    updates.secretIv = iv;
    updates.secretAuthTag = authTag;
  }

  const [row] = await db
    .update(linearAgentRegistrations)
    .set(updates)
    .where(eq(linearAgentRegistrations.id, id))
    .returning();

  return row ? mapRow(row) : null;
}

/**
 * Delete a registration and clean up any agent-scoped skills and MCP servers
 * that were attached to it.
 */
export async function deleteRegistration(id: string): Promise<boolean> {
  const scope = `linear-agent:${id}`;

  // Clean up agent-scoped resources
  await db.delete(customSkills).where(eq(customSkills.scope, scope));
  await db.delete(mcpServers).where(eq(mcpServers.scope, scope));

  const result = await db
    .delete(linearAgentRegistrations)
    .where(eq(linearAgentRegistrations.id, id))
    .returning();

  return result.length > 0;
}

/**
 * Verify that `LINEAR_API_TOKEN` is configured and works by calling `client.viewer`.
 * Returns `true` on success, `false` on auth/network failure.
 */
export async function testConnection(): Promise<boolean> {
  try {
    const token = await retrieveSecret("LINEAR_API_TOKEN");
    if (!token) return false;

    const client = new LinearClient({ apiKey: token });
    await client.viewer;
    return true;
  } catch (err) {
    logger.warn({ err }, "Linear connection test failed");
    return false;
  }
}

/**
 * Returns high-level config status for the Linear integration.
 */
export async function getConfigStatus(webhookUrl: string): Promise<{
  tokenConfigured: boolean;
  connected: boolean;
  webhookUrl: string;
}> {
  let tokenConfigured = false;
  let connected = false;

  try {
    const token = await retrieveSecret("LINEAR_API_TOKEN");
    tokenConfigured = Boolean(token);
  } catch {
    tokenConfigured = false;
  }

  if (tokenConfigured) {
    connected = await testConnection();
  }

  return { tokenConfigured, connected, webhookUrl };
}
