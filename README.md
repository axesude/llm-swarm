# 🐝 LLM Swarm: Multi-Agent Orchestration Framework

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.x-green.svg)](https://nodejs.org)
[![Architecture: Decoupled Brain/Body](https://img.shields.io/badge/Architecture-Brain%2FBody-orange.svg)](#architecture)

**LLM Swarm** is a professional-grade, full-stack orchestration framework designed to transform independent Gemini CLI processes into a unified, high-intelligence agent swarm. It features a decoupled **Brain/Body** architecture, hardened abuse prevention safeguards, and a real-time visual hierarchy canvas.

---

## 🏗️ Architecture: The Brain & The Body

LLM Swarm is architected for scalability and isolation, separating high-level reasoning from low-level system execution.

### 🧠 The Brain (`/agent`)
The "Executive Branch" of the swarm. It handles:
*   **Orchestration:** Coordinating Parallel, Pipeline, Debate, and Hierarchy patterns.
*   **Safeguard Pipeline:** A 7-stage middleware that enforces Google’s safety boundaries (Rate limiting, Jitter, Circuit Breakers).
*   **Anthropic Bridge:** A high-performance proxy (`mini_proxy.js`) that allows tools like **Claude Code** to use your local swarm as a drop-in backend.
*   **Frontend UI:** A Next.js 16/15 interface with real-time token streaming and a visual hierarchy canvas.

### 🦴 The Body (`/toolbox`)
The "Action Branch" of the swarm. It provides:
*   **Tool Execution:** A standalone service (Port 3002) for Puppeteer browsing, Python sandboxing, and file manipulation.
*   **MCP Integration:** Full support for the **Model Context Protocol (MCP)**, allowing agents to connect to any external tool server.
*   **Extension System:** A dynamic plugin architecture to add new "limbs" (capabilities) to the swarm.

---

## 🤖 Swarm Intelligence Patterns

*   **Parallel Mode:** Consolidates perspectives from multiple agents simultaneously.
*   **Pipeline Mode:** Sequential reasoning (Agent A → Agent B → Agent C) for complex multi-step tasks.
*   **Debate Mode:** Two agents argue opposing views while a third acts as an impartial Arbiter.
*   **Hierarchy Mode:** A visual, drag-and-drop canvas to build organizational structures with parent-child reporting lines.
*   **MoE (Mixture of Experts):** A "Router" agent dynamically selects and activates the most qualified specialized agent for the task.

---

## 🛡️ Hardened Abuse Prevention
To ensure account safety and prevent Google rate-limit detection, every agent call passes through a non-negotiable pipeline:
1.  **Quota Tracker:** Hard daily cap (1,000 req/day) persisted in SQLite.
2.  **Token Bucket Rate Limiter:** Maximum 10 requests per minute per agent.
3.  **Jitter Layer:** Random 2s–5s delays between invocations to prevent bot-pattern detection.
4.  **Circuit Breaker:** Automatically trips to `OPEN` after 3 consecutive failures.
5.  **Exponential Backoff:** Intelligent retry logic (5s → 10s → 20s → 40s) for 429 errors.

---

## 🚀 Quick Start

### 1. Prerequisites
*   [Node.js](https://nodejs.org/) v18+
*   [Gemini CLI](https://github.com/google/gemini-cli) installed and authenticated.
*   Multiple Google OAuth JSON credentials (stored in `agent/credentials/`).

### 2. Installation
```bash
git clone https://github.com/axesude/llm-swarm.git
cd llm-swarm

# Install Agent dependencies
cd agent/backend && npm install
cd ../frontend && npm install

# Install Toolbox dependencies
cd ../../toolbox && npm install
```

### 3. Launching the Swarm
The root directory includes a unified launcher that handles all services, proxies, and logging.
```bash
chmod +x agent/launch_swarm.sh
./agent/launch_swarm.sh
```
*   **UI:** `http://localhost:3000`
*   **Backend:** `http://localhost:3001`
*   **Toolbox:** `http://localhost:3002`
*   **Claude Bridge:** `http://localhost:3003`

---

## 🌉 Claude Code Integration
LLM Swarm includes a specialized Anthropic-compatible bridge. To use the swarm with Claude Code:
1. Launch the swarm using `./agent/launch_swarm.sh`.
2. Run Claude Code with the custom endpoint:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:3003"
export ANTHROPIC_API_KEY="sk-swarm-key"
claude
```

---

## 📂 Project Structure
```text
/agent
  /backend       → Node.js/Express orchestration & safeguards
  /frontend      → Next.js + Tailwind UI + Hierarchy Canvas
  launch_swarm.sh → Unified multi-service launcher
/toolbox
  /tools         → Built-in capabilities (Python, Scrape, etc.)
  /extensions    → Dynamic MCP and local plugins
  index.js       → Standalone tool execution service
```

---

## 📜 License
This project is licensed under the ISC License. See the [LICENSE](LICENSE) file for details.

Built with ❤️ by **Axesude** for the Gemini CLI community.
