// /backend/orchestrator/pipelineSwarm.js

/**
 * @fileoverview Pipeline Swarm execution mode.
 */

const { callAgent } = require('../agents/agentPipeline');

/**
 * Executes a sequential chain of agent calls.
 * 
 * @param {string[]} agentIds - IDs of agents in sequence order.
 * @param {string} initialPrompt - The starting prompt for the first agent.
 * @param {Function} [onTokenCallback] - Callback for real-time streaming.
 * @param {string} [workspaceId] - Optional persistent workspace folder.
 * @returns {Promise<object>} The final agent's response in the chain.
 */
async function runPipelineSwarm(agentIds, initialPrompt, onTokenCallback, workspaceId = null, files = []) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'Initiating pipeline swarm mode',
        agentIds: agentIds,
        workspace: workspaceId,
        fileCount: files.length
    }));

    if (!agentIds || agentIds.length === 0) {
        throw new Error("Pipeline swarm requires at least one agentId.");
    }

    let currentPrompt = initialPrompt;
    let finalResponse = '';

    for (let i = 0; i < agentIds.length; i++) {
        const agentId = agentIds[i];
        try {
            // Pass files to the first agent in the pipeline
            const agentFiles = i === 0 ? files : [];
            const response = await callAgent(agentId, currentPrompt, onTokenCallback, workspaceId, 0, agentFiles);
            currentPrompt = response; 
            finalResponse = response;
        } catch (error) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'ERROR',
                message: `Agent ${agentId} failed in pipeline.`,
                agentId: agentId,
                error: error.message
            }));
            throw new Error(`PipelineSwarmError: Sequence broken at ${agentId}. ${error.message}`);
        }
    }

    return { agentId: agentIds[agentIds.length - 1], response: finalResponse };
}

module.exports = {
    runPipelineSwarm
};
