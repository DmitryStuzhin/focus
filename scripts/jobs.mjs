import {error,json,readJson,trustedOrigin} from './auth-http.mjs';

const ID=/^[a-z0-9_-]{1,80}$/iu;
const MAX_BODY=1024*1024;
const TTL=7*86400000;

export function createJobs(db){
 db.exec(`
  CREATE TABLE IF NOT EXISTS focus_jobs(
   user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL,
   state TEXT NOT NULL, result TEXT, updated INTEGER NOT NULL,
   PRIMARY KEY(user_id,id)
  );
  UPDATE focus_jobs SET state='interrupted' WHERE state='running';
 `);
 const find=db.prepare('SELECT state,result,updated FROM focus_jobs WHERE user_id=? AND id=?');
 const active=db.prepare("SELECT count(*) AS total FROM focus_jobs WHERE state='running'");
 const owned=db.prepare("SELECT count(*) AS total FROM focus_jobs WHERE state='running' AND user_id=?");
 const start=db.prepare("INSERT INTO focus_jobs VALUES(?,?,'running',NULL,?)");
 const finish=db.prepare("UPDATE focus_jobs SET state=?,result=?,updated=? WHERE user_id=? AND id=? AND state='running'");
 const tidy=db.prepare("DELETE FROM focus_jobs WHERE state<>'running' AND updated<?");
 const trim=db.prepare(`DELETE FROM focus_jobs WHERE user_id=? AND state<>'running' AND id NOT IN
  (SELECT id FROM focus_jobs WHERE user_id=? ORDER BY updated DESC LIMIT 30)`);
 const controllers=new Map();
 let closed=false;
 const view=(id,row)=>({id,state:row.state,updated:row.updated,...(row.result?{result:JSON.parse(row.result)}:{})});
 const response=(id,user)=>{const row=find.get(user,id);return row?json(view(id,row)):error('Задача не найдена.',404);};
 return {
  async handle(request,url,user,now,run){
   if(url.pathname!=='/api/jobs')return null;
   if(!user)return error('Войди в Focus, чтобы продолжить.',401);
   if(request.method==='GET'){
    const id=url.searchParams.get('id');
    return id&&ID.test(id)?response(id,user.id):error('Укажи номер задачи.',400);
   }
   if(request.method!=='POST')return error('Метод не поддерживается.',405);
   if(!trustedOrigin(request,url))return error('Запрос отклонён.',403);
   const body=await readJson(request,MAX_BODY);
   if(!body||typeof body.id!=='string'||!ID.test(body.id))return error('Не удалось прочитать задачу.',400);
   const id=body.id,key=user.id+':'+id;
   if(body.action==='cancel'){
    finish.run('cancelled',null,now,user.id,id);
    controllers.get(key)?.abort();
    return response(id,user.id);
   }
   if(body.action!=='start'||!Array.isArray(body.input?.messages)||typeof run!=='function'||(body.research!=null&&typeof body.research!=='object')){
    return error('Не удалось запустить задачу.',400);
   }
   if(find.get(user.id,id))return response(id,user.id);
   if(owned.get(user.id).total>=2||active.get().total>=6)return error('Лимит фоновых задач достигнут.',429);
   tidy.run(now-TTL);
   trim.run(user.id,user.id);
   start.run(user.id,id,now);
   const controller=new AbortController();
   controllers.set(key,controller);
   void (async()=>{
    try{
     const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
     const result=await run(body.input,body.research,signal,user.id);
     const data=await result.json();
     const encoded=JSON.stringify(data);
     if(Buffer.byteLength(encoded)>MAX_BODY)throw new Error('result too large');
     if(!closed)finish.run(result.ok?'done':'failed',encoded,Date.now(),user.id,id);
    }catch{
     if(!closed)finish.run('failed',JSON.stringify({error:'Фоновая задача прервалась. Можно запустить её снова.'}),Date.now(),user.id,id);
    }finally{controllers.delete(key);}
   })();
   return json({id,state:'running'},202);
  },
  close(){closed=true;for(const controller of controllers.values())controller.abort();}
 };
}
