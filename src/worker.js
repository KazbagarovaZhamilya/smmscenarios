/**
 * Cloudflare Worker: статика + опциональный прокси /preview → jsonlink.io (старый Microlink убран)
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Браузер с другого домена (Netlify + LINK_PREVIEW_PROXY_ORIGIN на Worker) шлёт preflight
    if (request.method === 'OPTIONS' && url.pathname === '/preview') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (url.pathname === '/preview') {
      const target = url.searchParams.get('url');
      if (!target) {
        return new Response(JSON.stringify({ status: 'fail', message: 'no url' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      const upstream = `https://jsonlink.io/api/extract?url=${encodeURIComponent(target)}`;
      // Без User-Agent jsonlink.io часто отвечает 403 (считает запрос «ботом с дата-центра»)
      const r = await fetch(upstream, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      const body = await r.text();
      const ct = r.headers.get('content-type') || '';
      return new Response(body, {
        status: r.status,
        headers: {
          'Content-Type': ct.includes('json') ? 'application/json' : 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
