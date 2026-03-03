// /backend/agents/toolboxClient.js

/**
 * @fileoverview Client for communicating with the standalone "Body" service.
 */

const http = require('http');

const TOOLBOX_URL = process.env.TOOLBOX_URL || 'http://localhost:3002';

/**
 * Fetches the list of available tools from the Toolbox service.
 */
async function fetchAvailableTools() {
    return new Promise((resolve) => {
        http.get(`${TOOLBOX_URL}/tools`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).tools || []);
                } catch (e) {
                    console.error('[BRAIN] Failed to parse tools from Body', e);
                    resolve([]);
                }
            });
        }).on('error', (err) => {
            console.warn('[BRAIN] Toolbox service (Body) not reachable at:', TOOLBOX_URL);
            resolve([]);
        });
    });
}

/**
 * Executes a tool call in the Toolbox service.
 * 
 * @param {string} tool - Tool name.
 * @param {object} args - Tool arguments.
 */
async function executeTool(tool, args) {
    const postData = JSON.stringify({ tool, args });
    
    return new Promise((resolve, reject) => {
        const req = http.request(`${TOOLBOX_URL}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse execution result'));
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.write(postData);
        req.end();
    });
}

module.exports = {
    fetchAvailableTools,
    executeTool
};
