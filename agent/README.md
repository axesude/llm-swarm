# LLM Swarm Orchestrator

A powerful full-stack application designed to orchestrate multiple independent Gemini CLI processes as a unified agent swarm. This system allows for complex multi-agent reasoning patterns while enforcing strict abuse prevention safeguards to ensure account safety and stability.

## 🚀 Key Features

- **Multi-Agent Orchestration**: Spawn and manage multiple independent agents, each with its own OAuth credentials.
- **Swarm Patterns**:
  - **Parallel**: Gather multiple perspectives simultaneously.
  - **Pipeline**: Sequential reasoning where output feeds into the next agent.
  - **Debate**: Two agents argue opposing views with a third agent acting as arbiter.
- **Real-Time Streaming**: Tokens are streamed from the Gemini CLI directly to the frontend via WebSockets.
- **Abuse Prevention**: Built-in rate limiting (token bucket), random jitter, circuit breakers, and daily quota tracking.
- **Health Dashboard**: Monitor agent status, circuit states, and quota usage in real-time.

## 🏗️ Architecture

```text
[ Frontend: Next.js + Tailwind ]
           |
           v (WebSocket / JSON)
           |
[ Backend: Node.js + Express + WS Server ]
           |
           +--> [ Orchestrator Layer ]
           |         (Parallel, Pipeline, Debate)
           |
           +--> [ Safeguard Pipeline ]
           |         (Quota -> Rate Limit -> Jitter -> Circuit Breaker)
           |
           +--> [ Agent Runner ]
           |         (Spawn Gemini CLI child_process)
           |
           +--> [ Storage: SQLite ]
                     (Quota Persistence)
```

## 📋 Prerequisites

- **Node.js**: v18.x or higher
- **NPM**: v9.x or higher
- **Gemini CLI**: Installed and accessible via your system PATH (e.g., `/usr/local/bin/gemini`)
- **Google OAuth Credentials**: Multiple JSON credential files (one per agent).

## 🛠️ Setup Instructions

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd gemini-multi-agent
   ```

2. **Backend Setup**:
   - Navigate to the backend directory: `cd backend`
   - Install dependencies: `npm install`
   - Create a `.env` file (see `.env.example` for details).
   - Create a `credentials/` folder and place your Google OAuth `.json` files there (e.g., `agent1.json`, `agent2.json`).

3. **Frontend Setup**:
   - Navigate to the frontend directory: `cd ../frontend`
   - Install dependencies: `npm install`

## 🏃 Running the Application

1. **Start the Backend**:
   - From the `backend/` directory:
   ```bash
   npm start
   ```
   The server will start on port `3001` (by default) and the WebSocket server on port `8080`.

2. **Start the Frontend**:
   - From the `frontend/` directory:
   ```bash
   npm run dev
   ```
   The Next.js app will be available at `http://localhost:3000`.

## 🤖 Adding More Agents

To add a new agent to the swarm:
1. Obtain a new Google OAuth JSON credential file.
2. Save it in `backend/credentials/` as `<agent_id>.json`.
3. The system will automatically recognize the new agent when passed its ID in a swarm request.

## 🧩 Swarm Mode Examples

### Parallel Mode
All agents are sent the same prompt.
- **Request**: `{ "mode": "parallel", "agentIds": ["agent1", "agent2"], "prompt": "Explain quantum entanglement." }`

### Pipeline Mode
Output of Agent 1 becomes the input for Agent 2.
- **Request**: `{ "mode": "pipeline", "agentIds": ["agent1", "agent2"], "prompt": "Research solar flares." }`

### Debate Mode
Agent 1 argues FOR, Agent 2 argues AGAINST, Agent 3 arbitrates.
- **Request**: `{ "mode": "debate", "agentIds": ["agent1", "agent2", "agent3"], "prompt": "Remote work is superior to office work." }`

## 🛡️ Safeguard Details

- **Rate Limiter**: Maximum 10 requests per minute per agent (Token Bucket).
- **Jitter**: 2,000–5,000ms random delay added to every call.
- **Circuit Breaker**: Trips to OPEN after 3 consecutive failures; 60s cooldown.
- **Daily Quota**: Hard cap of 1,000 requests per day per agent (persisted in SQLite).
- **Backoff**: Exponential backoff (5s, 10s, 20s, 40s) on retryable errors.

---
Built with ❤️ for Gemini CLI power users.
