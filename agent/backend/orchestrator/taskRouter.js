// /backend/orchestrator/taskRouter.js

/**
 * @fileoverview Main routing logic for swarm requests.
 */

const { runParallelSwarm } = require('./parallelSwarm');
const { runPipelineSwarm } = require('./pipelineSwarm');
const { runDebateSwarm } = require('./debateSwarm');
const { runHierarchySwarm } = require('./hierarchySwarm');
const { runMoeSwarm } = require('./moeSwarm');

/**
 * Validates and routes a swarm task to the correct handler.
 * 
 * @param {object} task - The task definition.
 * @param {'parallel'|'pipeline'|'debate'|'hierarchy'|'moe'} task.mode - The swarm pattern.
 * @param {string[]} task.agentIds - List of agents to use.
 * @param {string} task.prompt - The user's input.
 * @param {string} [task.workspaceId] - Optional persistent workspace folder.
 * @param {object} [task.hierarchy] - Visual structure for hierarchy mode.
 * @param {Function} [onTokenCallback] - Optional callback for streaming tokens.
 * @returns {Promise<object>} The combined results of the swarm operation.
 */
async function routeTask(task, onTokenCallback) {
    if (!task || typeof task !== 'object') {
        throw new Error("Invalid task object provided.");
    }

    const { mode, agentIds, prompt, hierarchy, workspaceId, files } = task;

    // Basic Input Validation
    if (!mode || !['parallel', 'pipeline', 'debate', 'hierarchy', 'moe'].includes(mode)) {
        throw new Error(`Invalid swarm mode: ${mode}`);
    }
    if (!Array.isArray(agentIds) && mode !== 'hierarchy') {
        throw new Error("Missing or empty agentIds array.");
    }
    
    // Allow empty prompt ONLY if files are attached (multimodal)
    const hasFiles = Array.isArray(files) && files.length > 0;
    if ((!prompt || prompt.trim() === '') && !hasFiles) {
        throw new Error("Prompt cannot be empty.");
    }

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `Routing task to ${mode} mode`,
        agentCount: agentIds ? agentIds.length : (hierarchy ? hierarchy.nodes.length : 0),
        workspace: workspaceId || 'none'
    }));

    let result;
    switch (mode) {
        case 'parallel':
            result = await runParallelSwarm(agentIds, prompt, onTokenCallback, workspaceId, files);
            break;
        case 'pipeline':
            result = await runPipelineSwarm(agentIds, prompt, onTokenCallback, workspaceId, files);
            break;
        case 'debate':
            result = await runDebateSwarm(agentIds, prompt, onTokenCallback, workspaceId, files);
            break;
        case 'hierarchy':
            if (!hierarchy) throw new Error("Hierarchy mode requires visual structure data.");
            result = await runHierarchySwarm(hierarchy, prompt, onTokenCallback, workspaceId, files);
            break;
        case 'moe':
            result = await runMoeSwarm(agentIds, prompt, onTokenCallback, workspaceId, files);
            break;
        default:
            throw new Error(`Unhandled swarm mode implementation: ${mode}`);
    }

    return {
        mode,
        result,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    routeTask
};
