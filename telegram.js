import {TG_API_ID,TG_API_HASH} from "./telegram-config.js";
let cache=null;
export const tgConfigured=()=>TG_API_ID!=="INSERISCI";
export const hasSession=()=>{try{return !!localStorage.getItem('tg_session')}catch(e){return false}};
export function tgClient(){
  if(cache)return cache;
  cache=(async()=>{
    const tg=await import("https://esm.sh/telegram");
    const {StringSession}=await import("https://esm.sh/telegram/sessions");
    if(!hasSession())throw new Error('NO_SESSION');
    const client=new tg.TelegramClient(new StringSession(localStorage.getItem('tg_session')),Number(TG_API_ID),TG_API_HASH,{connectionRetries:5});
    await client.connect();
    if(!(await client.checkAuthorization()))throw new Error('NO_SESSION');
    return {client,tg};
  })();
  cache.catch(()=>{cache=null});
  return cache;
}
export async function tgEntity(name){
  const {client}=await tgClient();
  const g=name.replace(/^@/,''),ds=await client.getDialogs({limit:300});
  const d=ds.find(x=>x.title===name||(x.entity&&x.entity.username===g));
  if(!d)throw new Error('NO_CHAT');
  return d.entity;
}
