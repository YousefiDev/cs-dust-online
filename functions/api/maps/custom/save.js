import { MAP_DEFS } from "../../../../shared/maps.js";
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const err=(error,status=400,message=error)=>Response.json({ok:false,error,message},{status,headers:HEADERS});
const safeFile=name=>String(name||"file").split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120)||"file";
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));
function cfg(env){const token=env.GITHUB_TOKEN,owner=env.GITHUB_OWNER,repo=env.GITHUB_REPO,branch=env.GITHUB_BRANCH||"main";if(!token||!owner||!repo)return null;return {token,owner,repo,branch};}
async function githubPut(c,path,bytes,message,contentType){
 const url=`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
 const body=JSON.stringify({message,content:bytes,branch:c.branch});
 const r=await fetch(url,{method:"PUT",headers:{"authorization":`Bearer ${c.token}`,"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28","content-type":"application/json"},body});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`GitHub ${r.status}: ${d.message||"فایل ثبت نشد"}`);return d;
}
export async function onRequestPost({request,env}) {
 const c=cfg(env);if(!c)return err("github_binding_missing",503,"Secrets لازم تنظیم نشده‌اند: GITHUB_TOKEN، GITHUB_OWNER، GITHUB_REPO و در صورت نیاز GITHUB_BRANCH.");
 let form;try{form=await request.formData()}catch{return err("invalid_multipart",400,"فرم آپلود قابل خواندن نیست.")}
 const files=form.getAll("files").filter(f=>f&&typeof f.arrayBuffer==="function"&&f.name);
 const jf=files.find(f=>/\.json$/i.test(f.name)),bf=files.find(f=>/\.bin$/i.test(f.name));if(!jf||!bf)return err("both_json_and_bin_required",400,"هر دو فایل JSON و BIN را انتخاب کن.");
 if(jf.size+bf.size>68*1024*1024)return err("upload_too_large",413,"حجم مجموع فایل‌ها برای ثبت امن از طریق GitHub API زیاد است.");
 let source;try{source=JSON.parse(await jf.text())}catch{return err("invalid_json_file",400,"فایل JSON معتبر نیست.")}
 if(!Array.isArray(source.geometries)||!Array.isArray(source.materials)||!source.bounds||source.bin!==bf.name)return err("incompatible_json_bin",400,"ساختار JSON و BIN سازگار نیست؛ مقدار bin داخل JSON باید دقیقاً با نام فایل BIN یکی باشد.");
 let markers;try{markers=JSON.parse(String(form.get("markers")||"[]"))}catch{return err("invalid_markers",400,"فهرست نقاط معتبر نیست.")};if(!Array.isArray(markers)||markers.length>500)return err("invalid_markers",400,"حداکثر ۵۰۰ نقطه مجاز است.");
 const name=String(form.get("mapName")||"Custom Map").trim().slice(0,48)||"Custom Map";
 const slug=name.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-|-$/g,"").toLowerCase().slice(0,18)||"map";
 const id=`custom-${slug}-${crypto.randomUUID().slice(0,6)}`.slice(0,32),jsonName=safeFile(jf.name),binName=safeFile(bf.name),base=`public/maps/custom/${id}`;
 try{
  const jsonBytes=new Uint8Array(await jf.arrayBuffer()),binBytes=new Uint8Array(await bf.arrayBuffer());
  // GitHub Contents API accepts base64; use chunked conversion to avoid argument-stack limits.
  const b64=bytes=>{let out="";const chunk=0x6000;for(let i=0;i<bytes.length;i+=chunk)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));return btoa(out)};
  if(!MAP_DEFS.dust2)throw new Error("base_dust2_definition_missing");
  const def=structuredClone(MAP_DEFS.dust2);def.id=id;def.name=name;def.sourceMeshUrl=`/maps/custom/${id}/${encodeURIComponent(jsonName)}`;def.sourceBinUrl=`/maps/custom/${id}/${encodeURIComponent(binName)}`;
  def.originalFiles={json:jf.name,bin:bf.name,jsonBytes:jf.size,binBytes:bf.size};
  def.markers=markers.map((m,i)=>({id:i+1,name:String(m?.name||"Marker").slice(0,48),world:Array.isArray(m?.world)?m.world.slice(0,3).map(Number):[],normal:Array.isArray(m?.normal)?m.normal.slice(0,3).map(Number):[],grid:Array.isArray(m?.grid)?m.grid.slice(0,2).map(Number):[]}));
  const grid=m=>Array.isArray(m.grid)&&m.grid.length>=2?m.grid.map(Number):null,ts=def.markers.filter(m=>m.name==="T Spawn").map(grid).filter(Boolean),cts=def.markers.filter(m=>m.name==="CT Spawn").map(grid).filter(Boolean);
  if(ts.length)def.spawns.T=ts.map(([x,z])=>[Math.floor(clamp(x,0,127)),Math.floor(clamp(z,0,127))]);if(cts.length)def.spawns.CT=cts.map(([x,z])=>[Math.floor(clamp(x,0,127)),Math.floor(clamp(z,0,127))]);
  const rect=m=>{const [x,z]=grid(m)||[64,64];return[Math.floor(clamp(x-2,0,128)),Math.floor(clamp(z-2,0,128)),Math.floor(clamp(x+3,0,128)),Math.floor(clamp(z+3,0,128))]};for(const site of ["A Site","B Site"]){const m=def.markers.find(x=>x.name===site);if(m)def.sites[site[0]]=rect(m)}const callouts=def.markers.filter(m=>!["T Spawn","CT Spawn","A Site","B Site"].includes(m.name)).map(m=>[m.name,...rect(m)]);if(callouts.length)def.callouts=callouts;
  const meta=JSON.stringify(def,null,2),jsonPath=`${base}/${jsonName}`,binPath=`${base}/${binName}`,metaPath=`${base}/metadata.json`;
  // Three normal GitHub commits. A partial failure is reported, never described as success.
  await githubPut(c,jsonPath,b64(jsonBytes),`Add map JSON ${id}`);
  await githubPut(c,binPath,b64(binBytes),`Add map BIN ${id}`);
  await githubPut(c,metaPath,btoa(unescape(encodeURIComponent(meta))),`Add map metadata ${id}`);
  return Response.json({ok:true,id,name,source:def.sourceMeshUrl,jsonBytes:jf.size,binBytes:bf.size,markers:def.markers.length,repositoryPath:base,note:"files_committed_to_github; pages_rebuild_may_take_a_few_minutes"},{headers:HEADERS});
 }catch(e){console.error("GitHub custom map save failed",e);return err("save_failed",502,String(e?.message||e)+"؛ اگر بخشی از فایل‌ها ثبت شده باشد، همان مسیر مخزن را بررسی کن.")}
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{...HEADERS,"access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type"}})}
