// Supabase Edge Function: link-preview
// Простыми словами: браузер вызывает ЭТУ функцию, а уже она (на сервере) ходит в Microlink.
// Так мы не упираемся в CORS и можем контролировать лимиты.
//
// Дополнительно: после получения картинки от Microlink — скачиваем её и сразу
// перекладываем в Supabase Storage (bucket "media"), чтобы вернуть фронту
// постоянный URL. Иначе ссылки от Instagram CDN протухают через несколько часов
// и превью в календаре пропадают.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STORAGE_BUCKET = "media";

// Скачивает картинку с произвольного URL и кладёт её в Supabase Storage.
// Возвращает постоянный public-URL. Если что-то пошло не так — возвращает
// исходный URL (тогда фронт хотя бы один раз увидит картинку до её протухания).
async function cacheImageInStorage(imageUrl: string): Promise<string> {
  if (!imageUrl) return "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) return imageUrl;

  try {
    const imgRes = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!imgRes.ok) return imageUrl;

    const contentType =
      imgRes.headers.get("content-type") || "image/jpeg";
    // Не кэшируем то, что Microlink/CDN отдал как HTML (бывает при ошибках)
    if (!contentType.startsWith("image/")) return imageUrl;

    let ext = "jpg";
    if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("webp")) ext = "webp";
    else if (contentType.includes("gif")) ext = "gif";

    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    // Эвристическая защита: пустые/слишком маленькие "картинки" не сохраняем
    if (bytes.byteLength < 200) return imageUrl;

    const name = `link-previews/${Date.now()}_${
      Math.random().toString(36).slice(2)
    }.${ext}`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${name}`,
      {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: bytes,
      },
    );
    if (!uploadRes.ok) return imageUrl;

    return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${name}`;
  } catch (_e) {
    return imageUrl;
  }
}

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

    // Microlink сам достаёт мета-инфу и картинку превью.
    // Для Instagram часто "image" бывает пустой, поэтому просим ещё screenshot=true
    // и ниже используем fallback на screenshot.url.
    const res = await fetch(
      `https://api.microlink.io/?url=${
        encodeURIComponent(url)
      }&meta=true&screenshot=true`,
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

    // Берём картинку: сначала обычный image.url, иначе screenshot.url
    const rawImage =
      (d.image && d.image.url) ||
      (d.screenshot && d.screenshot.url) ||
      "";

    // Перекладываем картинку в наш Storage, чтобы она не протухла
    const image = rawImage ? await cacheImageInStorage(rawImage) : "";

    return new Response(
      JSON.stringify({
        title: d.title || d.publisher || domain || url,
        image,
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
