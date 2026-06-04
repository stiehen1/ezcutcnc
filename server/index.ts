import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Body parsers must NOT touch multipart/form-data — that's multer's job.
// The express.json verify hook buffers the whole request stream; if it runs
// on a file upload it can leave the stream half-consumed so multer waits
// forever for a body that's already drained, the route never fires, and the
// client aborts after its timeout. Skip multipart so multer gets a clean stream.
const isMultipart = (req: Request) =>
  (req.headers["content-type"] || "").includes("multipart/form-data");

const jsonParser = express.json({
  limit: "10mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
});
const urlencodedParser = express.urlencoded({ extended: false, limit: "10mb" });

app.use((req, res, next) => (isMultipart(req) ? next() : jsonParser(req, res, next)));
app.use((req, res, next) => (isMultipart(req) ? next() : urlencodedParser(req, res, next)));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // A client that aborts mid-upload (e.g. the PDF extract POST hitting its
    // AbortSignal.timeout) surfaces here as "Request aborted". The socket is
    // already gone, so trying to write a JSON response throws again and can
    // take the process down. Log it lightly and bail — there's no client to
    // answer to.
    if (err?.message === "Request aborted" || err?.code === "ECONNABORTED" || (req as any).aborted) {
      console.warn(`[abort] ${req.method} ${req.path} — client aborted before response`);
      return;
    }

    console.error("Internal Server Error:", err);

    if (res.headersSent || !res.writable) {
      return next(err);
    }

    try {
      return res.status(status).json({ message });
    } catch {
      // socket already closed — nothing to send
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

  // Graceful shutdown: when Replit recycles the container (SIGTERM), stop
  // accepting new connections but let in-flight requests finish instead of
  // hard-killing them mid-upload. Prevents "Request aborted" churn on restart.
  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${sig} — draining connections`, "shutdown");
    httpServer.close(() => {
      log("closed — exiting", "shutdown");
      process.exit(0);
    });
    // Hard cap so we never hang the platform's restart.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    async () => {
      log(`serving on port ${port}`);
      // ── DB size check on startup ──────────────────────────────────────────
      try {
        const { pool } = await import("./db");
        const r = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database()) AS bytes`);
        const { size, bytes } = r.rows[0];
        const pct = ((parseInt(bytes) / (500 * 1024 * 1024)) * 100).toFixed(1);
        const warn = parseInt(bytes) > 400 * 1024 * 1024 ? " ⚠️  APPROACHING FREE TIER LIMIT — consider upgrading Neon plan" : "";
        log(`DB size: ${size} (${pct}% of 500 MB free tier)${warn}`);
      } catch (e: any) {
        log(`DB size check failed: ${e?.message}`);
      }
    }
  );
})();
