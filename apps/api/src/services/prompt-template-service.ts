import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { promptTemplates } from "../db/schema.js";
import { DEFAULT_PROMPT_TEMPLATE } from "@optio/shared";

/**
 * Get the prompt template for a repo. Falls back to the global default.
 */
export async function getPromptTemplate(repoUrl?: string): Promise<{
  id: string;
  template: string;
  autoMerge: boolean;
}> {
  // Try repo-specific first
  if (repoUrl) {
    const [repoTemplate] = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.repoUrl, repoUrl));
    if (repoTemplate) {
      return {
        id: repoTemplate.id,
        template: repoTemplate.template,
        autoMerge: repoTemplate.autoMerge,
      };
    }
  }

  // Fall back to global default
  const [defaultTemplate] = await db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.isDefault, true), isNull(promptTemplates.repoUrl)));

  if (defaultTemplate) {
    return {
      id: defaultTemplate.id,
      template: defaultTemplate.template,
      autoMerge: defaultTemplate.autoMerge,
    };
  }

  // No template in DB — use hardcoded default
  return {
    id: "builtin",
    template: DEFAULT_PROMPT_TEMPLATE,
    autoMerge: false,
  };
}

/**
 * Save or update the global default prompt template.
 */
export async function saveDefaultPromptTemplate(
  template: string,
  autoMerge: boolean,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.isDefault, true), isNull(promptTemplates.repoUrl)));

  if (existing) {
    await db
      .update(promptTemplates)
      .set({ template, autoMerge, updatedAt: new Date() })
      .where(eq(promptTemplates.id, existing.id));
  } else {
    await db.insert(promptTemplates).values({
      name: "default",
      template,
      isDefault: true,
      autoMerge,
    });
  }
}

/**
 * Save or update a repo-specific prompt template.
 */
export async function saveRepoPromptTemplate(
  repoUrl: string,
  template: string,
  autoMerge: boolean,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.repoUrl, repoUrl));

  if (existing) {
    await db
      .update(promptTemplates)
      .set({ template, autoMerge, updatedAt: new Date() })
      .where(eq(promptTemplates.id, existing.id));
  } else {
    await db.insert(promptTemplates).values({
      name: `repo:${repoUrl}`,
      template,
      repoUrl,
      autoMerge,
    });
  }
}

/**
 * List all prompt templates.
 */
export async function listPromptTemplates() {
  return db.select().from(promptTemplates);
}
