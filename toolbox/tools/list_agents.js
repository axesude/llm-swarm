const fs = require('fs').promises;
const path = require('path');

module.exports = {
  name: "list_agents",
  description: "List all available agents in the LLM Swarm Fleet.",
  parameters: {
    type: "object",
    properties: {}
  },
  async execute() {
    try {
      const AGENT_CREDENTIALS_BASE_PATH = path.resolve(__dirname, '../../credentials');
      const files = await fs.readdir(AGENT_CREDENTIALS_BASE_PATH);
      const agents = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
      
      return { success: true, agents };
    } catch (err) {
      return { success: false, error: "Failed to list agents from Swarm Fleet: " + err.message };
    }
  }
};
