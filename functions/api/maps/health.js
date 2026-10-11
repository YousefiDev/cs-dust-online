export async function onRequestGet({env}) {
  const ready=!!env.MAP_ASSETS;
  return Response.json({ok:ready,storageConfigured:ready,storage:ready?"r2":"missing",message:ready?"Map API is ready":"Create an R2 bucket and bind it as MAP_ASSETS"},{status:ready?200:503,headers:{"cache-control":"no-store"}});
}
