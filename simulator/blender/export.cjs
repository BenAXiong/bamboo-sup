// Headless export of the raft for Blender. Needs `playwright` and a built scene:
//   npm run build:scene && node blender/export.cjs out/scene EXPORT_DIR [extra-query, e.g. sailing]

const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = process.argv[2]; const out = process.argv[3];
const types = {'.html':'text/html','.js':'text/javascript'};
const srv = http.createServer((q,r)=>{ let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p+='index.html';
  fs.readFile(p,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'}); r.end(d);});}).listen(5180);
(async()=>{
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const pg = await b.newPage({viewport:{width:640,height:360}});
  pg.on('pageerror', e=>console.log('pageerror:', e.message));
  await pg.goto('http://localhost:5180/index.html?still' + (process.argv[4] ? '&' + process.argv[4] : ''));
  await pg.waitForFunction(()=>window.__ready===true,{timeout:240000});
  const res = await pg.evaluate(async()=>await window.exportForBlender());
  fs.writeFileSync(path.join(out,'raft.glb'), Buffer.from(res.glb,'base64'));
  fs.mkdirSync(path.join(out,'tex'),{recursive:true});
  for (const [k,v] of Object.entries(res.textures)) fs.writeFileSync(path.join(out,'tex',k+'.png'), Buffer.from(v.split(',')[1],'base64'));
  fs.writeFileSync(path.join(out,'scene.json'), JSON.stringify({views:res.views, spec:res.spec, fov:res.fov}, null, 1));
  console.log('ok', fs.statSync(path.join(out,'raft.glb')).size, Object.keys(res.textures));
  await b.close(); srv.close();
})();
