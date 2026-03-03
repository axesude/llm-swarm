const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

console.log('[PROXY] Initializing robust bridge...');

const app = express();
const PORT = 3003;
const TARGET_URL = 'http://127.0.0.1:3001/v1/chat/completions';

app.use(cors());
app.use(bodyParser.json());

// Log all requests
app.use((req, res, next) => {
    console.log(`[PROXY] ${req.method} ${req.url}`);
    next();
});

// Helper to format Anthropic SSE events
const sendAnthropicEvent = (res, event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
};

app.post('/v1/messages', async (req, res) => {
    console.log('[PROXY] Processing /v1/messages');
    try {
        const { messages, system, model, max_tokens, temperature, stream } = req.body;
        console.log(`[PROXY] Model: ${model}, Stream: ${stream}`);

        // 1. Transform Anthropic to OpenAI
        const openAIMessages = [];
        if (system) openAIMessages.push({ role: 'system', content: system });
        
        messages.forEach(msg => {
            if (typeof msg.content === 'string') {
                openAIMessages.push({ role: msg.role, content: msg.content });
            } else if (Array.isArray(msg.content)) {
                const text = msg.content
                    .filter(p => p.type === 'text')
                    .map(p => p.text)
                    .join('\n');
                openAIMessages.push({ role: msg.role, content: text });
            }
        });

        const swarmRequest = {
            model: 'swarm-agent',
            messages: openAIMessages,
            max_tokens: max_tokens || 4096,
            temperature: temperature || 0.7,
            stream: stream || false
        };

        if (stream) {
            console.log('[PROXY] Initiating stream to backend...');
            const response = await axios.post(TARGET_URL, swarmRequest, {
                responseType: 'stream'
            });

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Send initial Anthropic framing
            const msgId = `msg_swarm_${Date.now()}`;
            sendAnthropicEvent(res, 'message_start', {
                type: 'message_start',
                message: {
                    id: msgId,
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model: model,
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 }
                }
            });

            sendAnthropicEvent(res, 'content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' }
            });

            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.replace('data: ', '').trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(dataStr);
                            const text = data.choices[0]?.delta?.content;
                            if (text) {
                                sendAnthropicEvent(res, 'content_block_delta', {
                                    type: 'content_block_delta',
                                    index: 0,
                                    delta: { type: 'text_delta', text: text }
                                });
                            }
                        } catch (e) {
                            // Ignore parse errors for incomplete chunks
                        }
                    }
                }
            });

            response.data.on('end', () => {
                sendAnthropicEvent(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
                sendAnthropicEvent(res, 'message_delta', {
                    type: 'message_delta',
                    delta: { stop_reason: 'end_turn', stop_sequence: null },
                    usage: { output_tokens: 0 }
                });
                sendAnthropicEvent(res, 'message_stop', { type: 'message_stop' });
                res.end();
            });

            response.data.on('error', (err) => {
                console.error('[PROXY] Stream error:', err.message);
                res.end();
            });

        } else {
            console.log('[PROXY] Sending blocking request to backend...');
            const response = await axios.post(TARGET_URL, swarmRequest);
            const content = response.data.choices[0].message.content;
            
            res.json({
                id: `msg_swarm_${Date.now()}`,
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: content }],
                model: model,
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 }
            });
        }
    } catch (error) {
        console.error('[PROXY] Request failed:', error.message);
        if (error.response) {
            console.error('[PROXY] Backend error:', error.response.status, error.response.data);
            res.status(error.response.status).json({ error: { type: 'api_error', message: JSON.stringify(error.response.data) } });
        } else {
            res.status(500).json({ error: { type: 'overloaded_error', message: error.message } });
        }
    }
});

// Fallback for other Anthropic endpoints
app.use((req, res) => {
    console.log(`[PROXY] Unhandled endpoint: ${req.method} ${req.url}`);
    res.status(404).json({ error: { type: 'not_found_error', message: 'Endpoint not bridged' } });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[PROXY] Robust bridge listening on port ${PORT}`);
});
