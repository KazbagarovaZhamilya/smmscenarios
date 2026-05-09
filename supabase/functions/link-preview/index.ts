// Supabase Edge Function: link-preview
// Простыми словами: браузер вызывает ЭТУ функцию, а уже она (на сервере) ходит в Microlink.
// Так мы не упираемся в CORS и можем контролировать лимиты.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Для CORS: браузер сначала делает OPTIONS-запрос
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!url) {
      return new Response(JSON.stringify({ error: "url required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Microlink сам достаёт мета-инфу и картинку превью
    const res = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(url)}&meta=true`,
      {
        headers: {
          // Иногда помогает получать данные стабильнее
          "User-Agent": "Mozilla/5.0",
        },
      },
    );

    // Если Microlink лимитит — отдаём 429, чтобы фронт мог поставить паузу
    if (res.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json().catch(() => null);
    if (!json || json.status !== "success" || !json.data) {
      return new Response(JSON.stringify({ error: "preview failed" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const d = json.data;
    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      domain = "";
    }

    return new Response(
      JSON.stringify({
        title: d.title || d.publisher || domain || url,
        image: (d.image && d.image.url) || "",
        domain,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

