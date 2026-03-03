const { search } = require('duck-duck-scrape');

module.exports = {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo.',
    parameters: { query: 'string' },
    execute: async (args) => {
        try {
            const results = await search(args.query, { safeSearch: 'STRICT' });
            // Extract a concise set of results
            const resultsSlice = results.results.slice(0, 5).map(r => ({
                title: r.title,
                url: r.url,
                description: r.description
            }));
            return { success: true, results: resultsSlice };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
};