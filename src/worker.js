/**
 * Cloudflare Worker: статика + опциональный прокси /preview → jsonlink.io (старый Microlink убран)
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
      const upstream = `https://jsonlink.io/api/extract?url=${encodeURIComponent(target)}`;
      const r = await fetch(upstream);
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
