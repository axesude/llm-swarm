const fs = require('fs').promises;
const path = require('path');

module.exports = {
    name: 'file_read',
    description: 'Read a file in the workspace.',
    parameters: { path: 'string' },
    execute: async (args) => {
        const safePath = path.join('/home/axesude/LLM Swarm Agent/backend/workspaces', args.path);
        try {
            const content = await fs.readFile(safePath, 'utf8');
            return { success: true, content };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
};