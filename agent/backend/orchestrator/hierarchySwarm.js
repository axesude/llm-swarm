// /backend/orchestrator/hierarchySwarm.js

const { callAgent } = require('../agents/agentPipeline');

/**
 * Runs agents in hierarchy mode based on a visual structure.
 * 
 * @param {object} hierarchy - The structure containing nodes and edges.
 * @param {string} prompt - The initial task prompt.
 * @param {Function} [onTokenCallback] - Streaming callback.
 * @param {string} [workspaceId] - Optional persistent workspace folder.
 * @returns {Promise<object>} The final result map.
 */
async function runHierarchySwarm(hierarchy, prompt, onTokenCallback, workspaceId = null, files = []) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: 'Initiating hierarchy swarm mode',
        nodeCount: hierarchy.nodes.length,
        workspace: workspaceId,
        fileCount: files.length
    }));

    if (!hierarchy || !hierarchy.nodes || hierarchy.nodes.length === 0) {
        throw new Error("Hierarchy swarm requires at least one agent node in the canvas.");
    }

    const nodes = hierarchy.nodes;
    const edges = hierarchy.edges;
    const results = new Map(); // Map<nodeId, response>

    const getParents = (nodeId) => edges.filter(e => e.target === nodeId).map(e => e.source);
    const getNode = (nodeId) => nodes.find(n => n.id === nodeId);

    async function executeNode(nodeId) {
        if (results.has(nodeId)) return results.get(nodeId);

        const node = getNode(nodeId);
        const parentIds = getParents(nodeId);

        const parentResponses = await Promise.all(parentIds.map(pid => executeNode(pid)));

        let agentPrompt = `TASK: ${prompt}\n\nYOUR ROLE: ${node.role || 'Contributor'}\n`;
        
        if (parentResponses.length > 0) {
            agentPrompt += `\nINSTRUCTIONS FROM SUPERIORS:\n`;
            parentResponses.forEach((res, i) => {
                const parentNode = getNode(parentIds[i]);
                agentPrompt += `--- From ${parentNode.agentId} (${parentNode.role}): ---\n${res}\n`;
            });
            agentPrompt += `\nBased on your role, please process the above information and fulfill your part of the task.`;
        } else {
            agentPrompt += `\nYou are at the top of the hierarchy. Please set the initial direction or complete the task based on your role.`;
        }

        const response = await callAgent(node.agentId, agentPrompt, onTokenCallback, workspaceId, 0, parentResponses.length === 0 ? files : []);
        results.set(nodeId, response);
        return response;
    }

    await Promise.all(nodes.map(n => executeNode(n.id)));

    const finalOutput = {};
    nodes.forEach(n => {
        finalOutput[n.id] = {
            agentId: n.agentId,
            role: n.role,
            response: results.get(n.id)
        };
    });

    return finalOutput;
}

module.exports = {
    runHierarchySwarm
};
