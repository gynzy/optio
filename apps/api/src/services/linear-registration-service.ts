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
 * Get the single registration for a workspace (never exposes the webhook secret).
 * Returns the first (and only expected) registration, or null if none exists.
 */
export async function getRegistration(
  workspaceId?: string | null,
): Promise<RegistrationRecord | null> {
  const rows = workspaceId
    ? await db
        .select()
        .from(linearAgentRegistrations)
        .where(eq(linearAgentRegistrations.workspaceId, workspaceId))
        .orderBy(desc(linearAgentRegistrations.createdAt))
        .limit(1)
    : await db
        .select()
        .from(linearAgentRegistrations)
        .orderBy(desc(linearAgentRegistrations.createdAt))
        .limit(1);
  return rows[0] ? mapRow(rows[0]) : null;
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
 * Create or update the single registration. If one already exists for the
 * workspace it is updated; otherwise a new row is inserted.
 * The webhook secret is encrypted at rest.
 */
export async function saveRegistration(
  input: CreateRegistrationInput,
  workspaceId?: string | null,
): Promise<RegistrationRecord> {
  const existing = await getRegistration(workspaceId);

  if (existing) {
    // Update the existing registration
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (input.name !== undefined) updates.name = input.name;
    if (input.oauthClientId !== undefined) updates.oauthClientId = input.oauthClientId;
    if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt;
    if (input.selectedSkillIds !== undefined) updates.selectedSkillIds = input.selectedSkillIds;
    if (input.selectedMcpServerIds !== undefined)
      updates.selectedMcpServerIds = input.selectedMcpServerIds;
    if (input.marketplacePlugins !== undefined)
      updates.marketplacePlugins = input.marketplacePlugins;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    if (input.webhookSecret) {
      const { encrypted, iv, authTag } = encrypt(input.webhookSecret);
      updates.encryptedWebhookSecret = encrypted;
      updates.secretIv = iv;
      updates.secretAuthTag = authTag;
    }

    const [row] = await db
      .update(linearAgentRegistrations)
      .set(updates)
      .where(eq(linearAgentRegistrations.id, existing.id))
      .returning();

    return mapRow(row);
  }

  // Create new registration
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
 * Delete the single registration (by ID) and clean up any agent-scoped skills
 * and MCP servers that were attached to it.
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
