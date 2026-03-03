const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// Redirect console.log to stderr to keep stdout clean for MCP
const originalLog = console.log;
console.log = (...args) => {
    process.stderr.write(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ') + '\n');
};

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

const TOOL_REGISTRY = {};
const EXTENSIONS_DIR = path.join(__dirname, "extensions");

// Load built-in tools
const loadToolsFromDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
        if (file.endsWith(".js")) {
            const tool = require(path.join(dir, file));
            if (tool.name && tool.execute) {
                TOOL_REGISTRY[tool.name] = tool;
                console.log(`[BODY] Loaded tool: ${tool.name}`);
            }
        }
    });
};

loadToolsFromDir(path.join(__dirname, "tools"));

// Load extensions recursively
const loadExtensions = () => {
    if (!fs.existsSync(EXTENSIONS_DIR)) return;
    fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true }).forEach(dirent => {
        if (dirent.isDirectory()) {
            const extPath = path.join(EXTENSIONS_DIR, dirent.name, "index.js");
            if (fs.existsSync(extPath)) {
                const tools = require(extPath);
                if (Array.isArray(tools)) {
                    tools.forEach(t => {
                        TOOL_REGISTRY[t.name] = t;
                        console.log(`[BODY] Loaded extension tool: ${t.name}`);
                    });
                }
            }
        }
    });
};

loadExtensions();

// Express endpoints
app.get("/tools", (req, res) => {
    const list = Object.keys(TOOL_REGISTRY).map(name => ({
        name,
        description: TOOL_REGISTRY[name].description,
        parameters: TOOL_REGISTRY[name].parameters
    }));
    res.json({ tools: list });
});

app.get("/api/extensions", (req, res) => {
    const registryPath = path.join(__dirname, "extensions.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    res.json({ extensions: registry });
});

app.post("/execute", async (req, res) => {
    const { tool, args } = req.body;
    if (!TOOL_REGISTRY[tool]) return res.status(404).json({ error: "Tool not found" });
    try {
        const result = await TOOL_REGISTRY[tool].execute(args);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// MCP Server Implementation
const mcp = new McpServer({
    name: "llm-swarm-toolbox",
    version: "1.0.0"
});

// Helper to convert parameters to Zod schema shape
function convertToZodShape(parameters) {
    if (!parameters) return {};
    const shape = {};

    if (parameters.type === 'object' && parameters.properties) {
        Object.keys(parameters.properties).forEach(key => {
            const prop = parameters.properties[key];
            let zType;
            if (prop.type === 'string') {
                zType = (prop.enum && prop.enum.length > 0) ? z.enum(prop.enum) : z.string();
            } else if (prop.type === 'number') {
                zType = z.number();
            } else if (prop.type === 'boolean') {
                zType = z.boolean();
            } else if (prop.type === 'array') {
                zType = z.array(z.any());
            } else {
                zType = z.any();
            }

            if (prop.description) zType = zType.describe(prop.description);
            
            if (parameters.required && !parameters.required.includes(key)) {
                zType = zType.optional();
            }
            shape[key] = zType;
        });
    } else {
        // Simple { key: 'type' } fallback
        Object.keys(parameters).forEach(key => {
            const type = parameters[key];
            if (type === 'string') shape[key] = z.string();
            else if (type === 'number') shape[key] = z.number();
            else if (type === 'boolean') shape[key] = z.boolean();
            else shape[key] = z.any();
        });
    }
    return shape;
}

// Register tools to MCP
Object.keys(TOOL_REGISTRY).forEach(name => {
    const tool = TOOL_REGISTRY[name];
    const zodShape = convertToZodShape(tool.parameters);

    mcp.tool(name, tool.description, zodShape, async (args) => {
        console.log(`[MCP] Executing tool: ${name} with args:`, args);
        try {
            const result = await tool.execute(args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: error.message }]
            };
        }
    });
});

// Start MCP server over stdio
const transport = new StdioServerTransport();
mcp.connect(transport).then(() => {
    console.log("[MCP] Swarm Toolbox MCP Server connected via stdio");
}).catch(err => {
    process.stderr.write(`[MCP] Failed to connect: ${err.message}\n`);
});

app.listen(PORT, () => console.log("[BODY] LLM Swarm Toolbox Express online at http://localhost:" + PORT));
