export async function onRequestGet({params,env}) {
  if(!env.MAP_ASSETS)return new Response("R2 binding MAP_ASSETS is not configured",{status:503});
  const id=String(params.id||""), file=String(params.file||"");
  if(!/^custom-[a-z0-9-]{1,28}$/.test(id)||!/^[a-zA-Z0-9._-]{1,120}$/.test(file)||file==="metadata.json")return new Response("Not found",{status:404});
  const object=await env.MAP_ASSETS.get(`custom-maps/${id}/${file}`);if(!object)return new Response("Not found",{status:404});
  const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);headers.set("cache-control","public, max-age=31536000, immutable");headers.set("access-control-allow-origin","*");
  return new Response(object.body,{headers});
}
