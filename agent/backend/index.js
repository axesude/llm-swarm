// /backend/index.js

/**
 * @fileoverview Main entry point for the LLM Swarm Backend.
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { spawn } = require('child_process');

// Load environment variables from .env file
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const { startWsServer } = require('./websocket/wsServer');
const { callAgent } = require('./agents/agentPipeline');
const quotaTracker = require('./safeguards/quotaTracker');
const circuitBreaker = require('./safeguards/circuitBreaker');
const rateLimiter = require('./safeguards/rateLimiter');

const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

/**
 * OpenAI-compatible endpoint for OpenClaw integration.
 * Routes all requests through the Brain's Safeguard Pipeline.
 */
app.post('/v1/chat/completions', async (req, res) => {
    try {
        let { model, messages, stream, workspaceId } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "Messages array is required." });
        }

        const prompt = messages[messages.length - 1].content || "";

        // --- MODEL RESOLVER ---
        // Map generic request IDs to actual active agents
        let agentId = model;
        if (!agentId || agentId === 'swarm-agent' || agentId === 'gpt-4o' || agentId === 'Axesude') {
            // Default to Darvel_Lagoon if available, otherwise the first agent
            const files = await fs.readdir(AGENT_CREDENTIALS_BASE_PATH);
            const availableAgents = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
            agentId = availableAgents.includes('Darvel_Lagoon') ? 'Darvel_Lagoon' : availableAgents[0];
        }

        console.log(`[GATEKEEPER] Request: ${agentId} (via ${model}) | Prompt Length: ${prompt.length}`);

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const onToken = (data) => {
                if (data.type === 'token') {
                    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: data.token } }] })}\n\n`);
                }
            };

            await callAgent(agentId, prompt, onToken, workspaceId);
            res.write(`data: [DONE]\n\n`);
            res.end();
        } else {
            const response = await callAgent(agentId, prompt, null, workspaceId);
            res.json({
                id: `swarm-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: agentId,
                choices: [{
                    message: { role: 'assistant', content: response },
                    finish_reason: 'stop'
                }]
            });
        }
    } catch (error) {
        console.error(`[GATEKEEPER] Error: ${error.message}`);
        const status = error.message.includes('Quota') ? 429 : 500;
        res.status(status).json({
            error: { 
                message: error.message, 
                type: status === 429 ? 'quota_exceeded' : 'internal_error' 
            }
        });
    }
});
const BACKEND_PORT = process.env.BACKEND_PORT || 3001;
const AGENT_CREDENTIALS_BASE_PATH = process.env.AGENT_CREDENTIALS_BASE_PATH || path.resolve(__dirname, 'credentials');
const WORKSPACES_ROOT = path.resolve(__dirname, 'workspaces');

// Store pending login processes
const pendingLogins = new Map(); // Map<agentId, { process, tempHome, geminiDir, lastOutput }>

// Middleware

// Ensure workspaces root exists
fs.mkdir(WORKSPACES_ROOT, { recursive: true }).catch(err => console.error("Failed to create workspaces root", err));

/**
 * Basic health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Agent Management Endpoints ---

/**
 * GET /api/agents/ollama-models
 * Fetches available models from local Ollama instance.
 */
app.get('/api/agents/ollama-models', async (req, res) => {
    try {
        const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
        const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;
        
        // Use http.get to fetch from Ollama
        const http = require('http');
        const options = {
            hostname: OLLAMA_HOST,
            port: OLLAMA_PORT,
            path: '/api/tags',
            method: 'GET',
            timeout: 2000
        };

        const request = http.request(options, (response) => {
            let data = '';
            response.on('data', (chunk) => data += chunk);
            response.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    res.json({ models: json.models || [] });
                } catch (e) {
                    res.status(500).json({ error: 'Failed to parse Ollama response' });
                }
            });
        });

        request.on('error', (err) => {
            res.status(503).json({ error: 'Ollama is not reachable', details: err.message });
        });

        request.on('timeout', () => {
            request.destroy();
            res.status(504).json({ error: 'Ollama request timed out' });
        });

        request.end();
    } catch (error) {
        res.status(500).json({ error: 'Internal Error' });
    }
});

/**
 * POST /api/agents/ollama
 * Adds an Ollama model as an agent.
 */
app.post('/api/agents/ollama', async (req, res) => {
    const { modelName } = req.body;
    if (!modelName) return res.status(400).json({ error: 'modelName is required' });
    
    const agentId = `ollama:${modelName}`;
    try {
        const filePath = path.join(AGENT_CREDENTIALS_BASE_PATH, `${agentId}.json`);
        // We save a dummy JSON for Ollama agents so they show up in the list
        await fs.writeFile(filePath, JSON.stringify({ provider: 'ollama', model: modelName }, null, 2));
        res.json({ message: `Ollama agent ${agentId} added successfully` });
    } catch (error) {
        console.error('Failed to save Ollama agent', error);
        res.status(500).json({ error: 'Failed to save Ollama agent' });
    }
});

/**
 * GET /api/agents
 */
app.get('/api/agents', async (req, res) => {
    try {
        const files = await fs.readdir(AGENT_CREDENTIALS_BASE_PATH);
        const agents = files
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''));
        res.json({ agents });
    } catch (error) {
        res.status(500).json({ error: 'Failed to list agents' });
    }
});

/**
 * POST /api/agents
 */
app.post('/api/agents', async (req, res) => {
    const { agentId, credentials } = req.body;
    if (!agentId || !credentials) return res.status(400).json({ error: 'Missing agentId or credentials' });
    try {
        const filePath = path.join(AGENT_CREDENTIALS_BASE_PATH, `${agentId}.json`);
        await fs.writeFile(filePath, JSON.stringify(credentials, null, 2));
        res.json({ message: `Agent ${agentId} added successfully` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save' });
    }
});

/**
 * POST /api/agents/login
 */
app.post('/api/agents/login', async (req, res) => {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'Missing agentId' });

    const tempHome = path.join(os.tmpdir(), 'gemini-swarm-auth', `${agentId}-${Date.now()}`);
    const geminiDir = path.join(tempHome, '.gemini');

    try {
        await fs.mkdir(geminiDir, { recursive: true });
        const settings = { security: { auth: { selectedType: "oauth-personal" } } };
        await fs.writeFile(path.join(geminiDir, 'settings.json'), JSON.stringify(settings));

        console.log(`[AUTH] Starting OAuth flow for ${agentId}`);

        const loginProcess = spawn(process.env.GEMINI_CLI_PATH || '/usr/bin/gemini', ['--prompt', 'auth-init', '--output-format', 'text'], {
            env: { ...process.env, HOME: tempHome, NO_BROWSER: 'true' },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const state = { process: loginProcess, tempHome, geminiDir, lastOutput: '', urlSent: false };
        pendingLogins.set(agentId, state);

        loginProcess.stdout.on('data', (data) => {
            const output = data.toString();
            state.lastOutput += output;
            
            const urlMatch = output.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth[^\s]+/);
            if (urlMatch && !state.urlSent) {
                state.urlSent = true;
                res.json({ url: urlMatch[0] });
            }
        });

        loginProcess.on('close', () => pendingLogins.delete(agentId));

        setTimeout(() => {
            if (!state.urlSent && !res.headersSent) {
                res.status(500).json({ error: 'Failed to generate auth URL' });
                loginProcess.kill();
            }
        }, 15000);

    } catch (error) {
        res.status(500).json({ error: 'Internal Error' });
    }
});

/**
 * POST /api/agents/confirm-login
 */
app.post('/api/agents/confirm-login', async (req, res) => {
    const { agentId, code } = req.body;
    const state = pendingLogins.get(agentId);
    if (!state) return res.status(404).json({ error: 'Login session expired or not found' });

    try {
        console.log(`[AUTH] Verifying code for ${agentId}`);
        state.lastOutput = ''; // Reset output to watch for errors
        state.process.stdin.write(code + '\n');

        const credsPath = path.join(state.geminiDir, 'oauth_creds.json');
        let attempts = 0;
        const maxAttempts = 20; // 10 seconds total

        const checkAuth = async () => {
            try {
                await fs.access(credsPath);
                const credsData = await fs.readFile(credsPath, 'utf8');
                const targetPath = path.join(AGENT_CREDENTIALS_BASE_PATH, `${agentId}.json`);
                await fs.writeFile(targetPath, credsData);
                
                console.log(`[AUTH] SUCCESS: ${agentId} registered`);
                state.process.kill();
                res.json({ success: true });
                return true;
            } catch (e) {
                if (state.lastOutput.includes('Failed to authenticate') || state.lastOutput.includes('invalid_grant')) {
                    res.status(400).json({ error: 'Invalid authorization code. Please try again.' });
                    state.process.kill();
                    return true;
                }

                if (attempts++ < maxAttempts) {
                    setTimeout(checkAuth, 500);
                    return false;
                } else {
                    res.status(500).json({ error: 'Verification timed out. Please restart login.' });
                    state.process.kill();
                    return true;
                }
            }
        };

        await checkAuth();

    } catch (error) {
        res.status(500).json({ error: 'Confirmation failed' });
    }
});

/**
 * DELETE /api/agents/:agentId
 */
app.delete('/api/agents/:agentId', async (req, res) => {
    const { agentId } = req.params;
    try {
        await fs.unlink(path.join(AGENT_CREDENTIALS_BASE_PATH, `${agentId}.json`));
        await quotaTracker.removeAgent(agentId);
        circuitBreaker.removeAgent(agentId);
        rateLimiter.removeAgent(agentId);
        res.json({ message: 'Removed' });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

// --- Workspace Management Endpoints ---

/**
 * GET /api/workspaces
 * Lists all workspace folders.
 */
app.get('/api/workspaces', async (req, res) => {
    try {
        const folders = await fs.readdir(WORKSPACES_ROOT, { withFileTypes: true });
        const workspaces = folders
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        res.json({ workspaces });
    } catch (error) {
        res.status(500).json({ error: 'Failed to list workspaces' });
    }
});

/**
 * POST /api/workspaces
 * Creates a new workspace folder.
 */
app.post('/api/workspaces', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Workspace name is required' });

    // Sanitize name: alphanumeric, dashes, underscores only
    const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
    const workspacePath = path.join(WORKSPACES_ROOT, sanitizedName);

    try {
        await fs.mkdir(workspacePath, { recursive: true });
        res.json({ message: `Workspace '${sanitizedName}' created`, name: sanitizedName });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create workspace' });
    }
});

/**
 * DELETE /api/workspaces/:name
 * Deletes a workspace folder and all its contents.
 */
app.delete('/api/workspaces/:name', async (req, res) => {
    const { name } = req.params;
    const workspacePath = path.join(WORKSPACES_ROOT, name);

    // Safety: Ensure we aren't deleting something outside the root
    if (!workspacePath.startsWith(WORKSPACES_ROOT)) {
        return res.status(400).json({ error: 'Invalid workspace name' });
    }

    try {
        await fs.rm(workspacePath, { recursive: true, force: true });
        res.json({ message: `Workspace '${name}' deleted` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete workspace' });
    }
});

// --- Startup ---

try {
    startWsServer();
} catch (error) {
    process.exit(1);
}

app.listen(BACKEND_PORT, '0.0.0.0', () => {
    console.log(`[INFO] Server running on 0.0.0.0:${BACKEND_PORT}`);
});

process.on('SIGINT', async () => {
    const { closeDb } = require('./db/db');
    await closeDb();
    process.exit(0);
});
