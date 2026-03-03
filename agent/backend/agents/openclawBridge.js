const axios = require('axios');

/**
 * Skill: OpenClaw Bridge
 * Allows the Swarm UI to command the OpenClaw Enterprise Army.
 */
async function callOpenClaw(prompt, agentId = 'coordinator') {
    try {
        const response = await axios.post('http://localhost:18789/v1/chat/completions', {
            model: agentId,
            messages: [{ role: 'user', content: prompt }],
            stream: false
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        return `Error connecting to OpenClaw: ${error.message}. Ensure OpenClaw is running on port 18789.`;
    }
}

module.exports = { callOpenClaw };
