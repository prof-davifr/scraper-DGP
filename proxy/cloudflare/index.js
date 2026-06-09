const ALLOWED_HOSTNAME = 'dgp.cnpq.br';

export default {
    async fetch(request) {
        // Responde a preflight CORS
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const url = new URL(request.url);
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl) {
            return new Response('Missing ?url= parameter', {
                status: 400, headers: corsHeaders()
            });
        }

        let parsed;
        try { parsed = new URL(targetUrl); } catch {
            return new Response('Invalid URL', { status: 400, headers: corsHeaders() });
        }

        if (parsed.hostname !== ALLOWED_HOSTNAME) {
            return new Response(
                `Forbidden: only requests to ${ALLOWED_HOSTNAME} are allowed`,
                { status: 403, headers: corsHeaders() }
            );
        }

        try {
            const resp = await fetch(targetUrl, {
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Coletor-DGP/1.0)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9'
                }
            });

            const body = await resp.text();
            return new Response(body, {
                status: resp.status,
                headers: {
                    'Content-Type': resp.headers.get('content-type') || 'text/html; charset=utf-8',
                    ...corsHeaders()
                }
            });
        } catch (e) {
            return new Response('Proxy error: ' + e.message, {
                status: 500, headers: corsHeaders()
            });
        }
    }
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}
