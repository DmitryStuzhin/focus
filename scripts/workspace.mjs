import {randomBytes} from 'node:crypto';
import {validBackup} from '../public/store.js';
import {error,json,readJson,trustedOrigin} from './auth-http.mjs';

const MAX_SNAPSHOT=8*1024*1024;
const PAGE_ROUTE=/^\/p\/([A-Za-z0-9_-]{32})$/u;
const ID=/^[A-Za-z0-9_-]{1,80}$/u;
const PAGE_LIMIT=30;
const PAGE_CSP="sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

function validSnapshot(snapshot){
 if(!snapshot||!snapshot.blobs||Array.isArray(snapshot.blobs)||typeof snapshot.blobs!=='object')return false;
 return validBackup(snapshot);
}

export function createWorkspace(db){
 db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces(
   user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL,
   snapshot TEXT NOT NULL, updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS published_pages(
   id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
   chat_id TEXT NOT NULL, version TEXT NOT NULL, title TEXT NOT NULL,
   html TEXT NOT NULL, created INTEGER NOT NULL,
   UNIQUE(user_id,chat_id,version)
  );
 `);
 const workspace=db.prepare('SELECT revision,snapshot,updated FROM workspaces WHERE user_id=?');
 const revision=db.prepare('SELECT revision FROM workspaces WHERE user_id=?');
 const insert=db.prepare('INSERT OR IGNORE INTO workspaces VALUES(?,1,?,?)');
 const update=db.prepare('UPDATE workspaces SET revision=revision+1,snapshot=?,updated=? WHERE user_id=? AND revision=?');
 const publicPage=db.prepare('SELECT html FROM published_pages WHERE id=?');
 const pages=db.prepare('SELECT id,chat_id AS chatId,version,title,created FROM published_pages WHERE user_id=? ORDER BY created DESC');
 const existing=db.prepare('SELECT id FROM published_pages WHERE user_id=? AND chat_id=? AND version=?');
 const publish=db.prepare(`INSERT OR IGNORE INTO published_pages
  SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM published_pages WHERE user_id=?) < ?`);
 const unpublish=db.prepare('DELETE FROM published_pages WHERE id=? AND user_id=?');

 return async function workspaceRequest(request,url,user,now){
  const {pathname:path}=url;
  const {method}=request;
  const match=PAGE_ROUTE.exec(path);
  if(match){
   if(!['GET','HEAD'].includes(method))return error('Метод не поддерживается.',405);
   const page=publicPage.get(match[1]);
   if(!page)return error('Публикация недоступна.',404);
   return new Response(method==='HEAD'?null:page.html,{headers:{
    'content-type':'text/html; charset=utf-8','content-security-policy':PAGE_CSP,
    'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
    'x-robots-tag':'noindex, nofollow'
   }});
  }
  if(path!=='/api/workspace'&&path!=='/api/publications')return null;
  if(!user)return error('Войди в Focus, чтобы продолжить.',401);
  if(method==='GET'){
   if(path==='/api/publications')return json({pages:pages.all(user.id)});
   const row=workspace.get(user.id);
   return json(row?{...row,snapshot:JSON.parse(row.snapshot)}:{revision:0,snapshot:null});
  }
  if(method!=='POST')return error('Метод не поддерживается.',405);
  if(!trustedOrigin(request,url))return error('Запрос отклонён.',403);
  if(path==='/api/workspace'){
   const body=await readJson(request,MAX_SNAPSHOT);
   if(!body||!Number.isSafeInteger(body.revision)||body.revision<0||!validSnapshot(body.snapshot)){
    return error('Не удалось сохранить пространство. Проверьте формат и лимит в 8 МБ.',400);
   }
   const encoded=JSON.stringify(body.snapshot);
   const result=body.revision===0?insert.run(user.id,encoded,now):update.run(encoded,now,user.id,body.revision);
   if(!result.changes)return json({error:'Пространство изменилось на другом устройстве.',revision:revision.get(user.id)?.revision??0},409);
   return json({revision:body.revision+1,updated:now});
  }
  const body=await readJson(request,512*1024);
  if(!body)return error('Не удалось прочитать публикацию.',400);
  if(body.action==='remove'){
   if(typeof body.id!=='string'||!PAGE_ROUTE.test('/p/'+body.id))return error('Некорректная ссылка.',400);
   return unpublish.run(body.id,user.id).changes?json({ok:true}):error('Публикация недоступна.',404);
  }
  const {chatId,version,title,html}=body;
  if(body.action!=='create'||typeof chatId!=='string'||!ID.test(chatId)||typeof version!=='string'||!ID.test(version)||
   typeof title!=='string'||!title.trim()||title.length>120||typeof html!=='string'||html.length>110000||
   !/^\s*(?:<!doctype\s+html\b|<html(?:\s|>))/iu.test(html))return error('Для публикации нужен полный HTML-документ.',400);
  const id=randomBytes(24).toString('base64url');
  const saved=publish.run(id,user.id,chatId,version,title,html,now,user.id,PAGE_LIMIT);
  const pageId=saved.changes?id:existing.get(user.id,chatId,version)?.id;
  return pageId?json({id:pageId,path:'/p/'+pageId}):error('Достигнут лимит в 30 опубликованных версий.',409);
 };
}
