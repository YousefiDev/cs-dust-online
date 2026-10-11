const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
export async function onRequestGet({ env }) {
  if (!env.MAP_ASSETS) return Response.json({ ok:false, error:"r2_binding_missing", message:"اتصال R2 با نام MAP_ASSETS تنظیم نشده است." }, { status:503, headers:HEADERS });
  const maps = {}; let cursor;
  do {
    const page = await env.MAP_ASSETS.list({ prefix:"custom-maps/", cursor, limit:1000 });
    for (const item of page.objects || []) {
      if (!item.key.endsWith("/metadata.json")) continue;
      const object = await env.MAP_ASSETS.get(item.key); if (!object) continue;
      try { const def = await object.json(); if (def && typeof def.id === "string") maps[def.id] = def; }
      catch (error) { console.error("invalid map metadata", item.key, error); }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return Response.json(maps, { headers:HEADERS });
}
export async function onRequestOptions() { return new Response(null,{status:204,headers:{...HEADERS,"access-control-allow-methods":"GET,OPTIONS","access-control-allow-headers":"content-type"}}); }
