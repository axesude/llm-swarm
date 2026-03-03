# Gemini CLI Swarm Orchestrator — Project Context

## What We Are Building
A full-stack application that:
- Spawns multiple Gemini CLI processes as independent AI agents, each using its own OAuth credential
- Orchestrates agents in swarm patterns: parallel, pipeline, and debate
- Exposes a React/Next.js frontend chat UI with real-time streaming
- Has built-in abuse prevention safeguards to avoid Google rate limit detection and account suspension

## Tech Stack
- **Frontend:** Next.js + Tailwind CSS + WebSockets
- **Backend:** Node.js + Express + WebSocket server
- **Storage:** SQLite (quota tracking + conversation history)
- **Queue:** In-memory task queue (architected to be Redis-upgradeable)
- **Agents:** Gemini CLI processes spawned via Node.js `child_process`

## Project Folder Structure
```
/frontend
  /components        → Reusable UI components
  /pages             → Next.js pages
  /hooks             → Custom React hooks (WebSocket, agent state)
  /styles            → Tailwind config and global styles

/backend
  /agents            → Per-agent CLI wrappers
  /orchestrator      → Swarm coordination logic
  /safeguards        → Rate limiter, circuit breaker, quota tracker
  /websocket         → WebSocket server and event handlers
  /db                → SQLite schema and query helpers
  index.js           → Backend entry point

GEMINI.md            → This file (persistent project context)
TASKS.md             → Build task checklist
README.md            → Setup and usage guide (to be generated in Phase 5)
.env.example         → Environment variable template (to be generated in Phase 5)
```

## Environment Variables (use .env, never hardcode)
```
AGENT_1_CREDENTIAL_PATH=./credentials/agent1.json
AGENT_2_CREDENTIAL_PATH=./credentials/agent2.json
AGENT_3_CREDENTIAL_PATH=./credentials/agent3.json
GEMINI_CLI_PATH=/usr/local/bin/gemini
WEBSOCKET_PORT=8080
BACKEND_PORT=3001
FRONTEND_PORT=3000
SQLITE_DB_PATH=./backend/db/swarm.db
DAILY_QUOTA_LIMIT=1000
QUOTA_WARNING_THRESHOLD=0.75
MAX_REQUESTS_PER_MINUTE=10
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_COOLDOWN_MS=60000
```

---

## Abuse Prevention Rules (NON-NEGOTIABLE)
These rules MUST be applied on every single agent call, no exceptions:

1. **Token Bucket Rate Limiter** — Max 10 requests per minute per agent
2. **Random Jitter** — Add 2,000–5,000ms random delay between agent invocations (never synchronized)
3. **Circuit Breaker** — Trip after 3 consecutive failures; enforce 60-second cooldown before retry
4. **Daily Quota Cap** — Hard cap at 1,000 requests/day per OAuth account; log a warning at 75%
5. **Exponential Backoff on 429** — On rate limit errors: wait 5s → 10s → 20s → 40s before retrying
6. **No Simultaneous Blasting** — Never fire all agents at the exact same moment; stagger starts
7. **Prompt Variance** — Never send identical prompt strings repeatedly across agents or sessions
8. **Quota Persistence** — Quota counts must survive process restarts (store in SQLite)

---

## Swarm Patterns to Implement

### Parallel Mode
All agents receive the same task simultaneously (with jitter). Responses are collected and returned together. Best for: getting multiple perspectives on one question.

### Pipeline Mode
Agent 1 output → fed as input to Agent 2 → Agent 2 output → fed to Agent 3. Best for: multi-step reasoning tasks (research → draft → review).

### Debate Mode
Two agents argue opposing positions on a topic. A third agent acts as arbiter and selects or synthesizes the best response. Best for: decision-making and analysis tasks.

---

## Coding Standards (follow strictly)
- **Comments:** Explain WHY the code does something, not just what it does
- **Single Responsibility:** Each file/module handles one concern only
- **Error Handling:** Every async function must have try/catch with descriptive error messages
- **No Hardcoded Values:** All config via environment variables
- **Extensibility:** New agents and swarm patterns must be addable without rewriting core logic
- **Logging:** Use structured logging (timestamp, agent ID, event type, value) for all safeguard events
- **No Silent Failures:** Every caught error must be logged before being swallowed or rethrown

---

## Agent Call Pipeline (order of execution)
Every agent invocation MUST pass through this pipeline in order:
```
1. Quota Tracker     → Check if agent has daily budget remaining
2. Rate Limiter      → Enforce max req/min with token bucket
3. Jitter Layer      → Apply random delay (2,000–5,000ms)
4. Circuit Breaker   → Block call if agent is in OPEN/cooldown state
5. Gemini CLI Spawn  → Execute the actual child_process call
6. Error Handler     → Catch 429s and apply exponential backoff
7. Response Return   → Pass result back to orchestrator
```

---

## Key Architectural Decisions
- Each agent is **stateless** — context must be passed in per call (no shared memory between agents)
- The orchestrator is the **single source of truth** for agent state (circuit status, quota counts)
- WebSocket is used for **real-time streaming** of agent tokens to the frontend — not polling
- SQLite is used over in-memory storage so **quota data persists** across crashes and restarts
- Frontend displays **agent identity** (which agent said what) and **health indicators** (quota %, circuit state)

---

## Session Instructions for Gemini CLI
- Always re-read this file at the start of a new session
- Always check TASKS.md to know what has been completed and what is next
- Do not skip ahead — complete tasks in order and wait for review
- Do not modify GEMINI.md or TASKS.md unless explicitly instructed
- When a task is complete, mark it `[x]` in TASKS.md before stopping
