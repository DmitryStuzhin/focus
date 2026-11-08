import {readFile,readdir,mkdir,writeFile,rm} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',zip:'application/zip'};
const assets={};
for(const name of await readdir(new URL('public/',root))){
 const extension=name.split('.').pop();
 const binary=extension==='zip';
 assets['/'+name]={type:types[extension]||'application/octet-stream',body:await readFile(new URL('public/'+name,root),binary?'base64':'utf8'),...(binary?{encoding:'base64'}:{})};
}
assets['/']=assets['/index.html'];
assets['/login']=assets['/login.html'];
assets['/admin']=assets['/admin.html'];
let source=await readFile(new URL('worker/api.js',root),'utf8');
for(const [name,file] of [['resolveAction,SPLIT_ACTIONS','action-phrases.js'],['codeFollowUpIntent,localIntent,taskIntent','work-intent.js'],['imageAspectRatio,imageIntent','image-intent.js'],['compareText','text-diff.js'],['buildIntent,isPreviewBlock,nativeBuildIntent','site-preview.js']]){
 const shared=assets['/'+file].body.replace(/^export /gm,'');
 source=source.replace("import {"+name+"} from '../public/"+file+"';",()=>shared);
}
const draft=(await readFile(new URL('worker/site-draft.js',root),'utf8')).replace(/^export /gm,'');
source=source.replace("import {createSiteDraft,createGameDraft} from './site-draft.js';",()=>draft);
const capabilities=(await readFile(new URL('worker/focus-capabilities.js',root),'utf8')).replace(/^export /gm,'');
source=source.replace("import {capabilityReply,capabilityInstructions,ANSWER_FORMAT} from './focus-capabilities.js';",()=>capabilities);
await rm(new URL('dist/',root),{recursive:true,force:true});
await mkdir(new URL('dist/server/',root),{recursive:true});
await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),'const ASSETS='+JSON.stringify(assets)+';\n'+source);
await writeFile(new URL('dist/.openai/hosting.json',root),await readFile(new URL('.openai/hosting.json',root)));
console.log('Built self-contained Worker with '+Object.keys(assets).length+' local assets');

