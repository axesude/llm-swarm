const { callAgent } = require("../agents/agentPipeline");

/**
 * MoE Swarm Mode: Uses a "Router" agent to select the best "Expert" for a task.
 * Upgraded with "Armed Failover Chain" - if an expert hits a breaker or limit, 
 * it automatically cycles through other armed experts.
 */
async function runMoeSwarm(agentIds, prompt, onTokenCallback, workspaceId = null, files = []) {
    if (!agentIds || agentIds.length < 2) {
        throw new Error("MoE mode requires at least 2 agents (1 Router, 1+ Experts).");
    }

    const routerAgentId = agentIds[0];
    const expertAgents = agentIds.slice(1);

    const routingPrompt = `
    Analyze the user task and rank the most suitable experts from this list in order of priority (most suitable first): ${expertAgents.join(", ")}.
    Respond ONLY with a comma-separated list of agent IDs.
    
    TASK: ${prompt}
    `;

    if (onTokenCallback) {
        onTokenCallback({ type: "token", agentId: "SYSTEM", token: "🔍 [MoE Router] Strategic routing in progress...\n" });
    }

    // 1. Get prioritized routing list from the router
    let rankedExperts;
    try {
        const routerResponse = await callAgent(routerAgentId, routingPrompt, null, workspaceId, 0, files);
        rankedExperts = routerResponse.split(',')
            .map(id => id.trim().replace(/[^a-zA-Z0-9:-]/g, ""))
            .filter(id => expertAgents.includes(id));
        
        if (rankedExperts.length === 0) rankedExperts = expertAgents;
    } catch (e) {
        console.warn("[MOE] Router failed, using default sequence", e.message);
        rankedExperts = expertAgents;
    }

    // 2. Recursive Execution with Armed Failover
    async function tryExpert(index) {
        if (index >= rankedExperts.length) {
            throw new Error("All armed experts exhausted or blocked by safeguards.");
        }

        const currentExpert = rankedExperts[index];
        
        if (onTokenCallback) {
            onTokenCallback({ type: "token", agentId: "SYSTEM", token: `⚡ [MoE] Deploying Expert: ${currentExpert} (Attempt ${index + 1}/${rankedExperts.length})\n` });
        }

        try {
            const response = await callAgent(currentExpert, prompt, onTokenCallback, workspaceId, 0, files);
            return { selectedExpert: currentExpert, response };
        } catch (error) {
            const isSafeguardBlock = error.message.includes('Quota') || error.message.includes('rate limit') || error.message.includes('Circuit breaker');
            
            if (onTokenCallback) {
                const reason = isSafeguardBlock ? "SAFEGUARD BLOCK" : "FAILURE";
                onTokenCallback({ type: "token", agentId: "SYSTEM", token: `⚠️ [MoE] Expert ${currentExpert} hit ${reason}. Redirecting to next armed limb...\n` });
            }
            
            return tryExpert(index + 1);
        }
    }

    return await tryExpert(0);
}

module.exports = { runMoeSwarm };