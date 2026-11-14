import {transaction} from './accounts.mjs';

const PERIODS = ['DAY', 'MONTH'];
const SCOPES = ['GLOBAL', 'USER'];
const FIVE_HOURS=5*60*60*1000;
const DEFAULT_LIMITS={
 GLOBAL_DAY:[8_000_000,15_000_000],
 GLOBAL_MONTH:[80_000_000,100_000_000],
 USER_DAY:[1_500_000,3_000_000],
 USER_MONTH:[12_000_000,15_000_000],
 USER_5H:[500_000,1_500_000],
};
const DEFAULT_RATES={
 GOOGLE_TEXT:3_000_000,OPENROUTER_TEXT:3_000_000,
 CLOUDFLARE_IMAGE:60_000,OPENAI_IMAGE:200_000,OPENROUTER_IMAGE:200_000,TAVILY_SEARCH:10_000,
};

function positiveInteger(value) {
 if(typeof value!=='string'||!/^\d+$/.test(value))return null;
 const number=Number(value);
 return Number.isSafeInteger(number)&&number>0?number:null;
}

export function createBudget(db,env,clock) {
 const readLimit=(scope,period)=>{
  const [tokens,micros]=DEFAULT_LIMITS[scope+'_'+period];
  const key=`FOCUS_BUDGET_${scope}_${period}`;
  return {scope,period,
   tokens:positiveInteger(env[key+'_TOKENS']??String(tokens)),
   micros:positiveInteger(env[key+'_USD_MICROS']??String(micros)),
  };
 };
 const limits=SCOPES.flatMap(scope=>PERIODS.map(period=>readLimit(scope,period)));
 const fiveHours=readLimit('USER','5H');
 const configured=[...limits,fiveHours].every(limit=>limit.tokens&&limit.micros);
 db.exec(`
  CREATE TABLE IF NOT EXISTS provider_budget(
   owner TEXT NOT NULL, window TEXT NOT NULL, tokens INTEGER NOT NULL, micros INTEGER NOT NULL,
   PRIMARY KEY(owner, window)
  );
  CREATE INDEX IF NOT EXISTS provider_budget_window ON provider_budget(window);
  CREATE TABLE IF NOT EXISTS provider_budget_session(
   owner TEXT PRIMARY KEY, resets INTEGER NOT NULL, tokens INTEGER NOT NULL, micros INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS provider_budget_session_resets ON provider_budget_session(resets);
 `);
 const usage=db.prepare('SELECT tokens,micros FROM provider_budget WHERE owner=? AND window=?');
 const increment=db.prepare(`
  INSERT INTO provider_budget(owner,window,tokens,micros) VALUES(?,?,?,?)
  ON CONFLICT(owner,window) DO UPDATE SET tokens=tokens+excluded.tokens,micros=micros+excluded.micros
 `);
 const prune=db.prepare('DELETE FROM provider_budget WHERE window < ?');
 const active=db.prepare('SELECT resets,tokens,micros FROM provider_budget_session WHERE owner=? AND resets>?');
 const saveSession=db.prepare(`
  INSERT INTO provider_budget_session(owner,resets,tokens,micros) VALUES(?,?,?,?)
  ON CONFLICT(owner) DO UPDATE SET resets=excluded.resets,tokens=excluded.tokens,micros=excluded.micros
 `);
 const pruneSessions=db.prepare('DELETE FROM provider_budget_session WHERE resets<=?');
 const reserve=(user,{provider,tokens})=>{
  if(!configured||!Number.isSafeInteger(tokens)||tokens<0)return 'unconfigured';
  if(!Object.hasOwn(DEFAULT_RATES,provider))return 'unconfigured';
  const rate=positiveInteger(env[`FOCUS_BUDGET_${provider}_USD_MICROS`]??String(DEFAULT_RATES[provider]));
  if(rate===null)return 'unconfigured';
  // Text tariffs are USD micros per million reserved tokens. Image and search
  // tariffs are operator-set maximum USD micros per dispatch.
  const micros=tokens?Number((BigInt(tokens)*BigInt(rate)+999_999n)/1_000_000n):rate;
  if(!Number.isSafeInteger(micros))return 'unconfigured';
  const now=clock(),owner='user:'+user;
  const date=new Date(now).toISOString();
  const counters=limits.map(limit=>({
   ...limit,
   owner:limit.scope==='GLOBAL'?'global':owner,
   window:date.slice(0,limit.period==='DAY'?10:7),
  }));
  return transaction(db,()=>{
   const session=active.get(owner,now);
   if(tokens>fiveHours.tokens-(session?.tokens??0)||micros>fiveHours.micros-(session?.micros??0))return 'session_exhausted';
   for(const limit of counters){
    const used=usage.get(limit.owner,limit.window);
    if(tokens>limit.tokens-(used?.tokens??0)||micros>limit.micros-(used?.micros??0))return 'exhausted';
   }
   for(const limit of counters)increment.run(limit.owner,limit.window,tokens,micros);
   prune.run(date.slice(0,7));
   pruneSessions.run(now);
   saveSession.run(owner,session?.resets??now+FIVE_HOURS,(session?.tokens??0)+tokens,(session?.micros??0)+micros);
   return 'reserved';
  });
 };
 reserve.status=user=>{
  if(!configured)return null;
  const session=active.get('user:'+user,clock());
  const remaining=session?Math.min(1-session.tokens/fiveHours.tokens,1-session.micros/fiveHours.micros):1;
  return {remainingPercent:Math.max(0,Math.floor(100*remaining+1e-9)),resetAt:session?.resets??null,
   approximateTokenLimit:fiveHours.tokens};
 };
 return reserve;
}
