import { db } from "./db";
import { snippets, type Snippet, type InsertSnippet } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getSnippets(): Promise<Snippet[]>;
  getSnippet(id: number): Promise<Snippet | undefined>;
  createSnippet(snippet: InsertSnippet): Promise<Snippet>;
  updateSnippet(id: number, snippet: Partial<InsertSnippet>): Promise<Snippet | undefined>;
  deleteSnippet(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getSnippets(): Promise<Snippet[]> {
    return await db.select().from(snippets).orderBy(desc(snippets.createdAt));
  }

  async getSnippet(id: number): Promise<Snippet | undefined> {
    const [snippet] = await db.select().from(snippets).where(eq(snippets.id, id));
    return snippet;
  }

  async createSnippet(insertSnippet: InsertSnippet): Promise<Snippet> {
    const [snippet] = await db.insert(snippets).values(insertSnippet).returning();
    return snippet;
  }

  async updateSnippet(id: number, insertSnippet: Partial<InsertSnippet>): Promise<Snippet | undefined> {
    const [snippet] = await db
      .update(snippets)
      .set(insertSnippet)
      .where(eq(snippets.id, id))
      .returning();
    return snippet;
  }

  async deleteSnippet(id: number): Promise<void> {
    await db.delete(snippets).where(eq(snippets.id, id));
  }
}

export const storage = new DatabaseStorage();
