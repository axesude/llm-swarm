// /backend/orchestrator/parallelSwarm.js

/**
 * @fileoverview Parallel Swarm execution mode.
 */

const { callAgent } = require('../agents/agentPipeline');

// Configuration for staggered starts
const STAGGER_MIN_MS = 100;
const STAGGER_MAX_MS = 500;

/**
 * Randomizes the start delay for an agent.
 */
function getRandomStaggerDelay() {
    return Math.floor(Math.random() * (STAGGER_MAX_MS - STAGGER_MIN_MS + 1)) + STAGGER_MIN_MS;
}

/**
 * Executes the same task across multiple agents in parallel.
 * 
 * @param {string[]} agentIds - IDs of agents to involve.
 * @param {string} prompt - The prompt to send to all agents.
 * @param {Function} [onTokenCallback] - Callback for real-time streaming results.
 * @param {string} [workspaceId] - Optional persistent workspace folder.
 * @returns {Promise<Array<object>>} Collection of all results.
 */
async function runParallelSwarm(agentIds, prompt, onTokenCallback, workspaceId = null, files = []) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'Initiating parallel swarm mode',
        agentIds: agentIds,
        workspace: workspaceId,
        fileCount: files.length
    }));

    const agentPromises = agentIds.map(async (agentId, index) => {
        // Apply staggered start based on agent index
        const staggerDelay = getRandomStaggerDelay();
        await new Promise(resolve => setTimeout(resolve, staggerDelay * index));

        try {
            const response = await callAgent(agentId, prompt, onTokenCallback, workspaceId, 0, files);
            return { agentId, status: 'fulfilled', value: response };
        } catch (error) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'ERROR',
                message: `Agent ${agentId} failed in parallel swarm`,
                agentId: agentId,
                error: error.message
            }));
            return { agentId, status: 'rejected', reason: error };
        }
    });

    const results = await Promise.allSettled(agentPromises);

    return results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            return { agentId: agentIds[index], status: 'rejected', reason: result.reason };
        }
    });
}

module.exports = {
    runParallelSwarm
};
