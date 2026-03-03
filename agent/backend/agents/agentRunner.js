// /backend/agents/agentRunner.js

/**
 * @fileoverview Universal runner for both Gemini CLI and Ollama agents.
 * 
 * WHY:
 * To support a "Hybrid Swarm," we need to handle different execution strategies:
 * 1. Gemini: Spawns an isolated child process with environment overrides.
 * 2. Ollama: Communicates with a local REST API via HTTP streaming.
 */

const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const http = require('http');

// Configuration
const geminiCliPath = process.env.GEMINI_CLI_PATH || '/usr/bin/gemini';
const WORKSPACES_ROOT = path.resolve(__dirname, '../workspaces');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;

const { callOpenClaw } = require('./openclawBridge');

/**
 * Universal agent runner.
 *
 * @param {string} prompt - The prompt to send.
 * @param {string} credentialPath - Path to Gemini JSON (ignored for Ollama/OpenClaw).
 * @param {string} [workspaceId] - Folder to run in.
 * @param {string} [agentIdOverride] - Explicit ID (needed for Ollama/OpenClaw).
 * @param {string[]} [filePaths] - List of absolute file paths to input (multimodal).
 * @returns {object} { promise, emitter, kill }
 */
function agentRunner(prompt, credentialPath, workspaceId = null, agentIdOverride = null, filePaths = []) {
    // --- PROMPT HARDENING ---
    // Force prompt to string to prevent [object Object] errors in models
    if (prompt === null || prompt === undefined) prompt = '';
    if (typeof prompt !== 'string') {
        try {
            // If it's the task object itself, try to extract the specific prompt field
            if (prompt.prompt && typeof prompt.prompt === 'string') {
                prompt = prompt.prompt;
            } else {
                prompt = JSON.stringify(prompt);
            }
        } catch (e) {
            prompt = String(prompt);
        }
    }

    const emitter = new EventEmitter();
    let fullResponse = '';
    const agentId = agentIdOverride || (credentialPath ? path.basename(credentialPath, '.json') : 'unknown');

    // --- OPENCLAW PROVIDER LOGIC ---
    if (agentId.startsWith('openclaw:')) {
        const openClawId = agentId.replace('openclaw:', '');
        let isAborted = false;

        const runOpenClaw = async () => {
            try {
                emitter.emit('token', `[Connecting to OpenClaw ${openClawId}...]\n`);
                const response = await callOpenClaw(prompt, openClawId);
                if (!isAborted) {
                    fullResponse = response;
                    emitter.emit('token', response);
                    emitter.emit('done', { success: true, response: fullResponse });
                }
            } catch (err) {
                if (!isAborted) emitter.emit('done', { success: false, error: err });
            }
        };

        runOpenClaw();

        const promise = new Promise((resolve, reject) => {
            emitter.on('done', ({ success, error, response }) => {
                if (success) resolve(response);
                else reject(error);
            });
        });

        return {
            promise,
            emitter,
            kill: () => { isAborted = true; }
        };
    }

    // --- OLLAMA PROVIDER LOGIC ---
    if (agentId.startsWith('ollama:')) {
        const modelName = agentId.replace('ollama:', '');
        let isAborted = false;
        let request = null;

        const runOllama = async () => {
            try {
                const postData = JSON.stringify({
                    model: modelName,
                    prompt: prompt,
                    stream: true
                });

                const options = {
                    hostname: OLLAMA_HOST,
                    port: OLLAMA_PORT,
                    path: '/api/generate',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: 60000 // 60 seconds timeout
                };

                request = http.request(options, (res) => {
                    if (res.statusCode !== 200) {
                        emitter.emit('done', { success: false, error: new Error(`Ollama returned status ${res.statusCode}`) });
                        return;
                    }

                    let lineBuffer = '';

                    res.on('data', (chunk) => {
                        if (isAborted) return;
                        lineBuffer += chunk.toString();
                        
                        const lines = lineBuffer.split('\n');
                        lineBuffer = lines.pop() || ''; // Keep the last partial line in the buffer

                        for (const line of lines) {
                            if (!line.trim()) continue;
                            try {
                                const json = JSON.parse(line);
                                if (json.response) {
                                    fullResponse += json.response;
                                    emitter.emit('token', json.response);
                                }
                                if (json.done) {
                                    emitter.emit('done', { success: true, response: fullResponse });
                                }
                            } catch (e) {
                                console.error(`[OLLAMA] Failed to parse JSON line: ${line}`);
                            }
                        }
                    });

                    res.on('end', () => {
                        // Handle any remaining content in buffer if it looks like JSON
                        if (lineBuffer.trim()) {
                            try {
                                const json = JSON.parse(lineBuffer);
                                if (json.response) {
                                    fullResponse += json.response;
                                    emitter.emit('token', json.response);
                                }
                                if (json.done) {
                                    emitter.emit('done', { success: true, response: fullResponse });
                                }
                            } catch (e) {}
                        }
                    });
                });

                request.on('error', (e) => {
                    if (!isAborted) emitter.emit('done', { success: false, error: e });
                });

                request.write(postData);
                request.end();
            } catch (err) {
                emitter.emit('done', { success: false, error: err });
            }
        };

        runOllama();

        const promise = new Promise((resolve, reject) => {
            emitter.on('done', ({ success, error, response }) => {
                if (success) resolve(response);
                else reject(error);
            });
        });

        return {
            promise,
            emitter,
            kill: () => {
                isAborted = true;
                if (request) request.destroy();
                console.log(`[ABORT] Terminated Ollama request for ${agentId}`);
            }
        };
    }

    // --- GEMINI PROVIDER LOGIC ---
    let spawnError = null;
    let childProcess = null;

    const runGemini = async () => {
        const tempHome = path.join(os.tmpdir(), 'gemini-swarm', `${agentId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
        const geminiDir = path.join(tempHome, '.gemini');

        try {
            await fs.mkdir(geminiDir, { recursive: true });
            const credsDataRaw = await fs.readFile(credentialPath, 'utf8');
            
            await fs.writeFile(path.join(geminiDir, 'oauth_creds.json'), credsDataRaw);
            const settings = { security: { auth: { selectedType: "oauth-personal" } } };
            await fs.writeFile(path.join(geminiDir, 'settings.json'), JSON.stringify(settings));

            const commandArgs = ['--output-format', 'text', '--prompt', '']; // Pass empty prompt flag, actual content via stdin
            
            // Pass multimodal files
            if (Array.isArray(filePaths)) {
                filePaths.forEach(fp => {
                    commandArgs.push('--file', fp);
                });
            }

            let cwd = process.cwd();
            if (workspaceId) {
                cwd = path.join(WORKSPACES_ROOT, workspaceId);
                await fs.mkdir(cwd, { recursive: true });
            }

            childProcess = spawn(geminiCliPath, commandArgs, {
                shell: false,
                cwd: cwd,
                env: { ...process.env, HOME: tempHome, GEMINI_CLI: '1', GEMINI_CLI_NO_RELAUNCH: 'true' }
            });

            // Write the prompt to stdin and close it
            childProcess.stdin.write(prompt);
            childProcess.stdin.end();

            childProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                if (!chunk.includes('Loaded cached credentials')) {
                    fullResponse += chunk;
                    emitter.emit('token', chunk);
                }
            });

            childProcess.on('close', async (code, signal) => {
                try { await fs.rm(tempHome, { recursive: true, force: true }); } catch (e) {}
                if (signal === 'SIGTERM') {
                    emitter.emit('done', { success: false, error: new Error('Aborted by user'), exitCode: code });
                } else if (code !== 0) {
                    emitter.emit('done', { success: false, error: new Error(`Exit code ${code}`), exitCode: code });
                } else {
                    emitter.emit('done', { success: true, response: fullResponse });
                }
            });
        } catch (err) {
            emitter.emit('done', { success: false, error: err });
        }
    };

    runGemini();

    const promise = new Promise((resolve, reject) => {
        emitter.on('done', ({ success, error, response, exitCode }) => {
            if (success) resolve(response);
            else {
                const finalError = error instanceof Error ? error : new Error(error);
                finalError.exitCode = exitCode;
                reject(finalError);
            }
        });
    });

    return {
        promise,
        emitter,
        kill: () => {
            if (childProcess) childProcess.kill('SIGTERM');
        }
    };
}

module.exports = agentRunner;
