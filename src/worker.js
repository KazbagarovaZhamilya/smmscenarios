/**
 * Cloudflare Worker: раздача статики + прокси Microlink по пути /preview
 * Браузер бьёт на свой домен → меньше странностей с лимитами, чем прямой api.microlink.io
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
      const microlinkUrl = `https://api.microlink.io/?url=${encodeURIComponent(target)}&meta=true`;
      const r = await fetch(microlinkUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
