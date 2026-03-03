const { exec } = require('child_process');

module.exports = {
    name: 'shell_exec',
    description: 'Execute a command in the workspace folder.',
    parameters: { command: 'string' },
    execute: async (args) => {
        return new Promise((resolve) => {
            const forbidden = ['rm', 'mv', 'sudo', 'chmod', 'chown', 'wget', 'curl'];
            if (forbidden.some(word => args.command.includes(word))) {
                return resolve({ success: false, error: 'Forbidden command detected.' });
            }
            exec(args.command, { 
                cwd: '/home/axesude/LLM Swarm Agent/backend/workspaces',
                timeout: 5000 
            }, (error, stdout, stderr) => {
                resolve({
                    success: !error,
                    stdout,
                    stderr,
                    error: error ? error.message : null
                });
            });
        });
    }
};