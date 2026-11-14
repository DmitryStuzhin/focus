import {transaction} from './accounts.mjs';

const PERIODS = ['DAY', 'MONTH'];
const SCOPES = ['GLOBAL', 'USER'];

function positiveInteger(value) {
 if(typeof value!=='string'||!/^\d+$/.test(value))return null;
 const number=Number(value);
 return Number.isSafeInteger(number)&&number>0?number:null;
}

export function createBudget(db,env,clock) {
 const limits = SCOPES.flatMap(scope=>PERIODS.map(period=>({
  scope,period,
  tokens:positiveInteger(env[`FOCUS_BUDGET_${scope}_${period}_TOKENS`]),
  micros:positiveInteger(env[`FOCUS_BUDGET_${scope}_${period}_USD_MICROS`]),
 })));
 const configured=limits.every(limit=>limit.tokens&&limit.micros);
 db.exec(`
  CREATE TABLE IF NOT EXISTS provider_budget(
   owner TEXT NOT NULL, window TEXT NOT NULL, tokens INTEGER NOT NULL, micros INTEGER NOT NULL,
   PRIMARY KEY(owner, window)
  );
  CREATE INDEX IF NOT EXISTS provider_budget_window ON provider_budget(window);
 `);
 const usage=db.prepare('SELECT tokens,micros FROM provider_budget WHERE owner=? AND window=?');
 const increment=db.prepare(`
  INSERT INTO provider_budget(owner,window,tokens,micros) VALUES(?,?,?,?)
  ON CONFLICT(owner,window) DO UPDATE SET tokens=tokens+excluded.tokens,micros=micros+excluded.micros
 `);
 const prune=db.prepare('DELETE FROM provider_budget WHERE window < ?');
 return (user,{provider,tokens})=>{
  if(!configured||!Number.isSafeInteger(tokens)||tokens<0)return 'unconfigured';
  const rate=positiveInteger(env[`FOCUS_BUDGET_${provider}_USD_MICROS`]);
  if(rate===null)return 'unconfigured';
  // Text tariffs are USD micros per million reserved tokens. Image and search
  // tariffs are operator-set maximum USD micros per dispatch.
  const micros=tokens?Number((BigInt(tokens)*BigInt(rate)+999_999n)/1_000_000n):rate;
  if(!Number.isSafeInteger(micros))return 'unconfigured';
  const date=new Date(clock()).toISOString();
  const counters=limits.map(limit=>({
   ...limit,
   owner:limit.scope==='GLOBAL'?'global':`user:${user}`,
   window:date.slice(0,limit.period==='DAY'?10:7),
  }));
  return transaction(db,()=>{
   for(const limit of counters){
    const used=usage.get(limit.owner,limit.window);
    if(tokens>limit.tokens-(used?.tokens??0)||micros>limit.micros-(used?.micros??0))return 'exhausted';
   }
   for(const limit of counters)increment.run(limit.owner,limit.window,tokens,micros);
   prune.run(date.slice(0,7));
   return 'reserved';
  });
 };
}
