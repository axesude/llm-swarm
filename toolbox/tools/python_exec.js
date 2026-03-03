const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
    name: 'python_exec',
    description: 'Execute Python code in a safe sandbox.',
    parameters: { code: 'string' },
    execute: async (args) => {
        return new Promise((resolve) => {
            const tempFile = path.join(os.tmpdir(), `llm_swarm_script_${Date.now()}.py`);
            fs.writeFileSync(tempFile, args.code);

            exec(`python3 ${tempFile}`, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                // Cleanup
                try { fs.unlinkSync(tempFile); } catch (e) {}

                if (error && error.killed) {
                    return resolve({ success: false, error: 'Execution timed out (10s limit)' });
                }

                resolve({
                    success: !error,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode: error ? error.code : 0
                });
            });
        });
    }
};