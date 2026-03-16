import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import pg from "pg";
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Use Neon's serverless WebSocket driver — avoids TCP idle-connection ECONNRESET
// that occurs when using standard pg Pool with Neon's pooler endpoint on Windows.
neonConfig.webSocketConstructor = ws;

const neonPool = new NeonPool({ connectionString: process.env.DATABASE_URL });

neonPool.on("error", (err: Error) => {
  console.warn("Neon pool error:", err.message);
});

// Re-export as `pool` so existing routes using `pool.query(...)` still work.
export const pool = neonPool as unknown as pg.Pool;
export const db = drizzleNeon(neonPool, { schema });
