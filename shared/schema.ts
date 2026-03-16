import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const snippets = pgTable("snippets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  code: text("code").notNull(),
  language: text("language").default("python").notNull(),
  output: text("output"), // Optional: save the last output
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSnippetSchema = createInsertSchema(snippets).omit({ 
  id: true, 
  createdAt: true 
});

export type InsertSnippet = z.infer<typeof insertSnippetSchema>;
export type Snippet = typeof snippets.$inferSelect;
