# PyCode Runner

## Overview

PyCode Runner is a web-based Python code snippet editor and executor. Users can write Python code in a browser-based editor with syntax highlighting, execute it on the server, and save/manage their snippets. The app has a dark-mode IDE aesthetic with a resizable panel layout — a snippet sidebar on the left and a code editor with output panel on the right.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript, bundled by Vite
- **Routing**: Wouter (lightweight client-side router)
- **State/Data Fetching**: TanStack React Query for server state management
- **UI Components**: shadcn/ui (new-york style) built on Radix UI primitives with Tailwind CSS
- **Code Editor**: `react-simple-code-editor` with PrismJS for Python syntax highlighting
- **Layout**: Resizable panels (`react-resizable-panels`) with mobile-responsive sheet/drawer for the sidebar
- **Styling**: Tailwind CSS with CSS variables for theming, dark mode by default. Custom fonts: JetBrains Mono (code), Inter (UI), DM Sans, Geist Mono
- **Path Aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend
- **Framework**: Express 5 on Node.js with TypeScript (run via `tsx`)
- **API Pattern**: RESTful JSON API under `/api/` prefix
- **Code Execution**: Server-side Python execution via `child_process.exec` — writes code to a temp file, runs it with Python, returns stdout/stderr
- **Development**: Vite dev server middleware with HMR in development; static file serving in production
- **Build**: Custom build script using esbuild (server) + Vite (client), outputs to `dist/`

### Shared Layer (`shared/`)
- **Schema**: Drizzle ORM schema definitions (`shared/schema.ts`) with Zod validation via `drizzle-zod`
- **Routes**: Typed API route definitions (`shared/routes.ts`) with Zod schemas for request/response validation, shared between client and server

### Database
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Connection**: `node-postgres` (pg) Pool, configured via `DATABASE_URL` environment variable
- **Schema Push**: `drizzle-kit push` for applying schema changes (no migration files needed for dev)
- **Tables**:
  - `snippets`: `id` (serial PK), `title` (text), `code` (text), `language` (text, default "python"), `output` (text, nullable), `created_at` (timestamp)

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/snippets` | List all snippets (ordered by newest) |
| GET | `/api/snippets/:id` | Get a single snippet |
| POST | `/api/snippets` | Create a new snippet |
| DELETE | `/api/snippets/:id` | Delete a snippet |
| POST | `/api/execute` | Execute Python code and return output |

### Key Design Decisions
1. **Server-side Python execution**: Code runs on the actual server using `child_process.exec`, not simulated in the browser. This means Python must be available on the host.
2. **Shared schema + routes**: Both client and server import from `shared/` to keep types and validation in sync, reducing duplication.
3. **Dark mode only**: The app uses a single dark theme defined via CSS variables — no light mode toggle.
4. **Storage abstraction**: `IStorage` interface in `server/storage.ts` with `DatabaseStorage` implementation, making it possible to swap storage backends.

## External Dependencies

- **PostgreSQL**: Required database, connected via `DATABASE_URL` environment variable
- **Python**: Must be installed on the server for code execution (the `/api/execute` endpoint runs Python scripts)
- **Google Fonts**: JetBrains Mono, Inter, DM Sans, Geist Mono, Fira Code, Architects Daughter loaded via CDN
- **NPM packages of note**: Express 5, Drizzle ORM, TanStack React Query, shadcn/ui (Radix primitives), PrismJS, react-simple-code-editor, wouter, zod