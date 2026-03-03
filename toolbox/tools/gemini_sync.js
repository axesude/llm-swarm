const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = {
  name: "gemini_sync",
  description: "Synchronize and bridge Gemini CLI extensions into the LLM Swarm.",
  parameters: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["list", "sync_all", "install"], 
        description: "Action to perform: list available extensions, sync them all to swarm, or install a new official extension." 
      },
      source: {
        type: "string",
        description: "The source URL or name of the extension to install (e.g., https://github.com/...) - Required for 'install' action."
      }
    },
    required: ["action"]
  },
  async execute({ action, source }) {
    const GEMINI_EXT_DIR = path.join(process.env.HOME, '.gemini/extensions');
    const SWARM_EXT_JSON = path.join(__dirname, '../extensions.json');

    try {
      if (action === "install") {
        if (!source) return { error: "Source URL is required for install action." };
        // Use the actual gemini CLI to install it so it goes into the right folder
        const { execSync } = require('child_process');
        console.log(`[BODY] Running: gemini extensions install ${source}`);
        const output = execSync(`/usr/bin/gemini extensions install ${source} --auto-update`).toString();
        
        // After install, trigger a sync to make it available to the swarm
        const syncResult = await this.execute({ action: "sync_all" });
        return { 
          success: true, 
          message: `Extension installed and synced: ${output.trim()}`,
          sync: syncResult
        };
      }

      if (!fs.existsSync(GEMINI_EXT_DIR)) {
        return { error: "Gemini extensions directory not found." };
      }

      const extensions = fs.readdirSync(GEMINI_EXT_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => {
          const extPath = path.join(GEMINI_EXT_DIR, dirent.name);
          const manifestPath = path.join(extPath, 'gemini-extension.json');
          let manifest = {};
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          }
          return {
            name: dirent.name,
            version: manifest.version || 'unknown',
            description: manifest.description || 'Gemini CLI Extension',
            mcpServers: manifest.mcpServers || {}
          };
        });

      if (action === "list") {
        return { success: true, extensions };
      }

      if (action === "sync_all") {
        const currentSwarmExts = JSON.parse(fs.readFileSync(SWARM_EXT_JSON, 'utf8'));
        let addedCount = 0;

        extensions.forEach(ext => {
          const exists = currentSwarmExts.some(se => se.name === `gemini-${ext.name}`);
          if (!exists) {
            currentSwarmExts.push({
              name: `gemini-${ext.name}`,
              repoUrl: `local://${GEMINI_EXT_DIR}/${ext.name}`,
              installedAt: new Date().toISOString(),
              isGeminiBridge: true
            });
            addedCount++;
          }
        });

        fs.writeFileSync(SWARM_EXT_JSON, JSON.stringify(currentSwarmExts, null, 2));
        return { 
          success: true, 
          message: `Synced ${addedCount} new extensions from Gemini CLI.`,
          totalGeminiExtensions: extensions.length
        };
      }

    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};
