#!/usr/bin/env node
'use strict';
// Convert compact CS2 map2json format (dust2.json + dust2.bin) into this game's playable grid JSON.
const fs=require('fs'), path=require('path');
const {buildGrid,encodeGrid}=require('./gamegrid.cjs');
const argv=process.argv.slice(2), opt={size:128,voxel:0.5,voxelY:0.15,id:'de_dust2',name:'Dust II'};
for(let i=0;i<argv.length;i++){let a=argv[i];if(a==='--bin')opt.bin=argv[++i];else if(a==='-o')opt.out=argv[++i];else if(a==='--size')opt.size=+argv[++i];else if(a==='--voxel')opt.voxel=+argv[++i];else if(a==='--voxel-y')opt.voxelY=+argv[++i];else if(a==='--id')opt.id=argv[++i];else if(a==='--name')opt.name=argv[++i];else if(!a.startsWith('-')&&!opt.input)opt.input=a;}
if(!opt.input){console.error('Usage: node tools/packedmap2game.cjs dust2.json --bin dust2.bin -o maps/dust2_playable.json');process.exit(2)}
const meta=JSON.parse(fs.readFileSync(opt.input,'utf8')), binPath=opt.bin||path.resolve(path.dirname(opt.input),meta.bin);
const bin=fs.readFileSync(binPath), bounds=meta.bounds, [xmin,ymin,zmin]=bounds.min,[xmax,ymax,zmax]=bounds.max;
const size=opt.size, sx=size/(xmax-xmin), sz=size/(zmax-zmin), sy=Math.min(sx,sz), geoms=[];
for(const g of meta.geometries){const raw=new Uint16Array(bin.buffer,bin.byteOffset+g.pos,g.vertexCount*3),P=new Float64Array(raw.length),mn=g.posMin,rg=g.posRange;for(let i=0;i<raw.length;i+=3){P[i]=(mn[0]+raw[i]/65535*rg[0]-xmin)*sx;P[i+1]=(mn[1]+raw[i+1]/65535*rg[1]-ymin)*sy;P[i+2]=(zmax-(mn[2]+raw[i+2]/65535*rg[2]))*sz;}const IT=g.index32?Uint32Array:Uint16Array,I=new IT(bin.buffer,bin.byteOffset+g.idx,g.indexCount);geoms.push({name:g.name,P,I,inst:[{M:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]});}
console.log(`Geometry sections: ${geoms.length}; grid ${size}x${size}; voxel ${opt.voxel}m`);
const result=buildGrid(geoms,size,size,(ymax-ymin)*sy,{voxel:opt.voxel,voxelY:opt.voxelY},s=>console.log(s));
const d={id:opt.id,name:opt.name,size:[size,size],scale:1,cs2:true,theme:{sky:'#92aebd',haze:'#d9c9a6',sun:'#fff0d2',wall:'#8f795f',wall2:'#b8a58a',plaster:'#c6ad86',floor:'#c9b18a',trim:'#7f684e',shutter:'#9a825f',source:'#d8c7a0'},areas:[],ramps:[],roofs:[],crates:[],doors:[],lamps:[],props:[],grid:encodeGrid(size,size,result.heights,result.ceil),spawns:result.gameplay.spawns,yaw:result.gameplay.yaw,sites:result.gameplay.sites,buy:result.gameplay.buy,routes:result.gameplay.routes,holds:result.gameplay.holds,callouts:result.gameplay.callouts,scale:1,sourceGeometry:{format:meta.format,version:meta.version,source:meta.source,worldBounds:meta.bounds,geometrySections:meta.geometries.length,triangles:meta.stats?.storedTriangles||0,automaticNavigation:true,coordinateTransform:'world X/Z projected to grid; world Z inverted into grid Y',warnings:['Automated geometry inference. Review generated spawns, sites, and walkability in the editor.']}};
const out=opt.out||path.join(path.dirname(opt.input),opt.id+'.json');fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(d));console.log('Wrote '+out+' ('+(fs.statSync(out).size/1024).toFixed(1)+' KB)');for(const s of result.report)console.log(s);
