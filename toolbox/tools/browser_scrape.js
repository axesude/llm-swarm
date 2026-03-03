const puppeteer = require('puppeteer-core');

module.exports = {
    name: 'browser_scrape',
    description: 'Fetch the text content of a webpage.',
    parameters: { url: 'string' },
    execute: async (args) => {
        let browser;
        try {
            // Check for potential browser paths on Linux
            const executablePath = '/usr/bin/google-chrome-stable' || '/usr/bin/chromium' || '/usr/bin/brave';
            
            browser = await puppeteer.launch({ 
                executablePath,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Extract text from body, ignoring script and style tags
            const content = await page.evaluate(() => {
                const body = document.body.cloneNode(true);
                const toRemove = body.querySelectorAll('script, style, nav, footer, header, iframe');
                toRemove.forEach(el => el.remove());
                return body.innerText.replace(/\s+/g, ' ').trim();
            });
            
            await browser.close();
            return { success: true, url: args.url, text: content.slice(0, 10000) }; // Truncate for tokens
        } catch (e) {
            if (browser) await browser.close();
            return { success: false, error: e.message };
        }
    }
};