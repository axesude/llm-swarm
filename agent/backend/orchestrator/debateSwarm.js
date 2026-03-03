// /backend/orchestrator/debateSwarm.js

/**
 * @fileoverview Debate Swarm execution mode.
 */

const { callAgent } = require('../agents/agentPipeline');

/**
 * Executes a debate between two agents with a third as arbiter.
 * 
 * @param {string[]} agentIds - [proAgentId, conAgentId, arbiterAgentId].
 * @param {string} topic - The subject of the debate.
 * @param {Function} [onTokenCallback] - Callback for streaming events.
 * @param {string} [workspaceId] - Optional persistent workspace folder.
 * @returns {Promise<object>} Collected responses.
 */
async function runDebateSwarm(agentIds, topic, onTokenCallback, workspaceId = null, files = []) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'Initiating debate swarm mode',
        agentIds: agentIds,
        workspace: workspaceId,
        fileCount: files.length
    }));

    if (!agentIds || agentIds.length !== 3) {
        throw new Error("Debate swarm requires exactly three agents: [pro, con, arbiter].");
    }

    const [proAgentId, conAgentId, arbiterAgentId] = agentIds;

    try {
        const proPrompt = `Topic: "${topic}". Argue strongly FOR this position.`;
        const proResponse = await callAgent(proAgentId, proPrompt, onTokenCallback, workspaceId, 0, files);

        const conPrompt = `Topic: "${topic}". Argue strongly AGAINST this position.`;
        const conResponse = await callAgent(conAgentId, conPrompt, onTokenCallback, workspaceId, 0, files);

        const arbiterPrompt = `Topic: "${topic}"\n\nArgument FOR:\n${proResponse}\n\nArgument AGAINST:\n${conResponse}\n\nGiven these arguments, provide a final verdict or synthesis.`;
        const arbiterVerdict = await callAgent(arbiterAgentId, arbiterPrompt, onTokenCallback, workspaceId);

        return {
            proAgentId,
            proResponse,
            conAgentId,
            conResponse,
            arbiterAgentId,
            arbiterVerdict,
        };
    } catch (error) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message: 'Debate swarm logic failed.',
            error: error.message
        }));
        throw error;
    }
}

module.exports = {
    runDebateSwarm
};
