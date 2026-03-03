// /backend/agents/agentPipeline.js

/**
 * @fileoverview Orchestrates the safeguard pipeline for a single agent call.
 */

const agentRunner = require('./agentRunner');
const quotaTracker = require('../safeguards/quotaTracker');
const { createRateLimiter } = require('../safeguards/rateLimiter');
const { createCircuitBreaker } = require('../safeguards/circuitBreaker');
const { createBackoffHandler } = require('../safeguards/backoffHandler');
const path = require('path');
const fs = require('fs').promises;
const toolboxClient = require('./toolboxClient');
const chatMemory = require('../safeguards/chatMemory');

// Singletons for safeguards to maintain state across the entire backend session
const rateLimiter = createRateLimiter(); 
const circuitBreaker = createCircuitBreaker(); 
const backoffHandler = createBackoffHandler(); 

// Registry to track active runner handles for abortion
const activeRunners = new Set();

// Configuration for credential discovery
const AGENT_CREDENTIALS_BASE_PATH = process.env.AGENT_CREDENTIALS_BASE_PATH || path.resolve(__dirname, '../../credentials');

/**
 * Helper to map an agentId to a physical file on disk.
 */
function getCredentialPath(agentId) {
    return path.join(AGENT_CREDENTIALS_BASE_PATH, `${agentId}.json`);
}

/**
 * Discovers available agents in the Fleet.
 */
async function getAvailableFleetAgents() {
    try {
        const files = await fs.readdir(AGENT_CREDENTIALS_BASE_PATH);
        return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    } catch (e) {
        return [];
    }
}

/**
 * The primary entry point for calling an agent with full safeguard protection.
 */
async function callAgent(agentId, prompt, onTokenCallback, workspaceId = null, retryCount = 0, files = []) {
    // --- PROMPT HARDENING ---
    if (prompt === null || prompt === undefined) prompt = '';
    if (typeof prompt !== 'string') {
        if (prompt.prompt && typeof prompt.prompt === 'string') {
            prompt = prompt.prompt;
        } else {
            try { prompt = JSON.stringify(prompt); } catch (e) { prompt = String(prompt); }
        }
    }

    const MAX_RETRIES = 2; // Failover to 2 other agents if needed
    const credentialPath = getCredentialPath(agentId);

    // --- FILE ATTACHMENT LOGIC ---
    let fileInfoPrompt = '';
    const savedFilePaths = [];
    if (files && files.length > 0) {
        fileInfoPrompt = '\n\n[SYSTEM: ATTACHED FILES]\n';
        const WORKSPACES_ROOT = path.resolve(__dirname, '../workspaces');
        const targetDir = workspaceId ? path.join(WORKSPACES_ROOT, workspaceId) : null;

        for (const file of files) {
            fileInfoPrompt += `- ${file.name} (${file.mime}, ${file.size} bytes)\n`;
            
            // If we have a workspace, save the file there so tools can access it
            if (targetDir) {
                try {
                    await fs.mkdir(targetDir, { recursive: true });
                    const filePath = path.join(targetDir, file.name);
                    await fs.writeFile(filePath, Buffer.from(file.data, 'base64'));
                    savedFilePaths.push(filePath);
                    console.log(`[PIPELINE] Saved attachment to workspace: ${filePath}`);
                } catch (e) {
                    console.error(`[PIPELINE] Failed to save file ${file.name}: ${e.message}`);
                }
            }
        }
        fileInfoPrompt += 'These files have been saved to your current workspace. Use "file_read" to inspect them if needed.\n';
    }

    // Fetch available tools from the Body for dynamic prompt injection
    const tools = await toolboxClient.fetchAvailableTools();
    const isSmallModel = agentId.includes('0.5b');
    let systemPrompt = '';
    
    // --- CHAT MEMORY INJECTION ---
    const history = chatMemory.getHistoryString(agentId);
    if (history) {
        systemPrompt += `\n[RECENT CONVERSATION HISTORY]\n${history}\n---\n`;
    }

    // CRITICAL: 0.5B models cannot handle tool-use instructions and complex system prompts reliably.
    // We bypass tool logic entirely for them to maintain stability.
    if (tools.length > 0 && !isSmallModel) {
        systemPrompt += `\n[SYSTEM: TOOLBOX & EXTENSIONS]\nYou are equipped with a powerful Toolbox (the "Body") that grants you agency in the real world.\nUse these capabilities to answer questions, browse the web, or manipulate files. Do not Hallucinate answers if a tool can provide the truth.\n\nAVAILABLE TOOLS:\n${tools.map(t => {
    const type = t.name.startsWith('mcp_') ? '[MCP SERVER]' : '[STANDARD]';
    return `- ${type} ${t.name}: ${t.description} (Args: ${JSON.stringify(t.parameters)})`;
}).join('\n')}\n\nINSTRUCTIONS:\n1. To use a Standard Tool or Extension:\n   Use the format: [CALL: tool_name {"arg": "actual_search_query"}]\n   Example: [CALL: web_search {"query": "current status of LLM project"}]\n   CRITICAL: Do not use the word "string" as a value. Replace it with your actual intent.\n\n2. To use an MCP Server (Model Context Protocol):\n   Use the 'mcp_call' tool with the 'serverName' and 'tool' arguments.\n   Example: [CALL: mcp_call {"serverName": "github", "tool": "search_issues", "arguments": {"query": "bug"}}]\n\nALWAYS end your turn with a tool call if you need more information.\n---\n`;
    }

    let currentPrompt = systemPrompt ? `${systemPrompt}\nUser Query: ${prompt}` : prompt;
    if (fileInfoPrompt) currentPrompt = fileInfoPrompt + currentPrompt;

    // --- SMALL MODEL PROMPT CLEANUP ---
    if (isSmallModel) {
        // Strip out the "Conversation info (untrusted metadata)" header if it exists
        // as it confuses the 0.5B model.
        currentPrompt = currentPrompt.replace(/Conversation info \(untrusted metadata\):[\s\S]*?(\n\n|$)/g, "");
        // Wrap in clear markers for better coherence
        currentPrompt = `USER: ${currentPrompt}\nASSISTANT: `;
    }

    let loopCount = 0;
    const MAX_TOOL_LOOPS = isSmallModel ? 0 : 5; // Reduced from 15 to 5 for faster response

    try {
        // Wrap the entire pipeline in the backoff handler for resilience
        const finalResponse = await backoffHandler(agentId, async () => {
            
            while (loopCount < MAX_TOOL_LOOPS) {
                // Step 1: Pre-call quota check
                await quotaTracker.checkQuota(agentId);

                // Step 2: Rate limit enforcement
                await rateLimiter(agentId); 

                // Step 3: Circuit Breaker execution
                const response = await circuitBreaker(agentId, async () => {
                    const runner = agentRunner(currentPrompt, credentialPath, workspaceId, null, savedFilePaths);
                    activeRunners.add(runner);

                    if (onTokenCallback && typeof onTokenCallback === 'function') {
                        runner.emitter.on('token', (token) => {
                            onTokenCallback({ type: 'token', agentId, token });
                        });
                    }

                    try {
                        const res = await runner.promise;
                        await quotaTracker.incrementQuota(agentId);
                        return res;
                    } finally {
                        activeRunners.delete(runner);
                    }
                });

                // --- Tool Extraction Logic ---
                // Improved regex to handle trailing spaces [CALL: name {args} ] and multi-line JSON
                const toolMatch = response.match(/\[CALL:\s*(\w+)\s*({[\s\S]*?})\s*\]/);
                
                if (toolMatch) {
                    const toolName = toolMatch[1];
                    const toolArgs = JSON.parse(toolMatch[2]);
                    
                    console.log(`[BRAIN] Intercepted tool call from ${agentId}: ${toolName}`, toolArgs);
                    
                    if (onTokenCallback) {
                        onTokenCallback({ type: 'token', agentId, token: `\n[System: Executing ${toolName}...]\n` });
                    }

                    try {
                        const toolResult = await toolboxClient.executeTool(toolName, toolArgs);
                        const resultString = JSON.stringify(toolResult);
                        
                        // Update prompt with tool output for the next turn
                        currentPrompt = `${currentPrompt}\n\nAgent: ${response}\n[TOOL_RESULT: ${resultString}]\nPlease continue your analysis based on this result.`;
                        loopCount++;
                        continue; // Run the loop again to let the agent process the tool result
                    } catch (toolError) {
                        currentPrompt = `${currentPrompt}\n\nAgent: ${response}\n[TOOL_ERROR: ${toolError.message}]\nPlease try another way.`;
                        loopCount++;
                        continue;
                    }
                }

                // If no tool call, this is the final answer
                if (onTokenCallback) {
                    onTokenCallback({ type: 'done', agentId, fullResponse: response });
                }

                // Save context for the next turn
                chatMemory.addMessage(agentId, 'user', prompt);
                chatMemory.addMessage(agentId, 'assistant', response);
                
                return response;
            }
            
            throw new Error(`Exceeded maximum tool call loops (${MAX_TOOL_LOOPS})`);
        });
        
        return finalResponse;

    } catch (error) {
        // --- FLEET VITALIS FAILOVER LOGIC ---
        if (error.message.includes('Exceeded maximum tool call loops') && retryCount < MAX_RETRIES) {
            console.log(`[VITALIS] Agent ${agentId} exhausted loops. Activating Failover...`);
            
            const fleet = await getAvailableFleetAgents();
            const nextAgent = fleet.find(id => id !== agentId); // Simple selection for now

            if (nextAgent) {
                if (onTokenCallback) {
                    onTokenCallback({ 
                        type: 'token', 
                        agentId: 'SYSTEM', 
                        token: `\n\n[FLEET VITALIS: Failover to ${nextAgent}...]\n` 
                    });
                }
                return callAgent(nextAgent, prompt, onTokenCallback, workspaceId, retryCount + 1, files);
            }
        }

        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message: `Agent pipeline execution failed for ${agentId}`,
            agentId: agentId,
            error: error.message
        }));
        
        if (onTokenCallback) {
            onTokenCallback({ type: 'error', agentId, message: `Failure: ${error.message}` });
        }
        throw error;
    }
}

/**
 * Terminates all currently active Gemini CLI processes.
 */
function abortAllAgents() {
    console.log(`[ABORT] Terminating ${activeRunners.size} active agents...`);
    for (const runner of activeRunners) {
        runner.kill();
    }
    activeRunners.clear();
}

module.exports = {
    callAgent,
    abortAllAgents
};
