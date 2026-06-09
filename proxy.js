const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing ?url= parameter' });
    }

    console.log(`[${new Date().toISOString()}] Proxying: ${targetUrl}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(targetUrl, {
            signal: controller.signal,
            redirect: 'follow'
        });

        clearTimeout(timeoutId);

        const data = await response.text();

        res.set('Content-Type', response.headers.get('content-type') || 'text/html');
        res.status(response.status).send(data);

        console.log(`[${new Date().toISOString()}] Success: ${response.status} (${data.length} bytes)`);
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
        res.status(500).json({ error: 'Proxy request failed: ' + err.message });
    }
});

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', port: PORT });
});

app.listen(PORT, () => {
    console.log(`\u{1F680} CORS Proxy running at http://localhost:${PORT}`);
    console.log(`\u{1F4A1} Use: http://localhost:${PORT}/proxy?url=<TARGET_URL>`);
});
