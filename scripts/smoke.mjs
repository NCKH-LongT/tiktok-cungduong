import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const base=process.env.SMOKE_BASE_URL??'http://localhost:8080';
const email=process.env.ADMIN_EMAIL,password=process.env.ADMIN_PASSWORD;
if(!email||!password)throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD required');
let cookie='';
async function request(path,init={}){const response=await fetch(base+'/api'+path,{...init,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...init.headers}});const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];let data=await response.json();return {status:response.status,data};}
const ready=await request('/ready');assert.equal(ready.status,200);
const bad=await request('/auth/login',{method:'POST',body:JSON.stringify({login:email,password:'wrong'})});assert.equal(bad.status,401);
const login=await request('/auth/login',{method:'POST',body:JSON.stringify({login:email,password})});assert.equal(login.status,201);
const suffix=randomUUID().slice(0,8);
const created=await request('/lives',{method:'POST',body:JSON.stringify({uniqueId:'smoke_'+suffix,title:'Smoke '+suffix})});assert.equal(created.status,201);
const id=created.data.id;
let socket;
try{
 const voice=await request(`/lives/${id}/audio-config`,{method:'PUT',body:JSON.stringify({voiceId:'vi-VN-Standard-D',speakingRate:1.1,pitch:1,ttsVolume:70})});assert.equal(voice.status,200);assert.equal(voice.data.voiceId,'vi-VN-Standard-D');
 const rotated=await request(`/lives/${id}/overlay-token/rotate`,{method:'POST'});assert.equal(rotated.status,201);
 const overlay=new URL(rotated.data.url);
 socket=io(process.env.SMOKE_SOCKET_URL??base,{auth:{liveId:id,overlayToken:overlay.searchParams.get('token')},transports:['websocket']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket connect timeout')),5000);socket.once('connect',()=>{clearTimeout(timer);resolve()});socket.once('connect_error',error=>{clearTimeout(timer);reject(error)})});
 const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket event timeout')),5000);socket.once('live.event',event=>{clearTimeout(timer);resolve(event)})});
 const joined=await request(`/lives/${id}/simulate`,{method:'POST',body:JSON.stringify({eventType:'viewer.join',user:{id:'viewer-1',nickname:'Minh'},payload:{}})});assert.equal(joined.status,201);
 assert.equal((await received).eventId,joined.data.eventId);
 const gift=await request(`/lives/${id}/simulate`,{method:'POST',body:JSON.stringify({eventType:'gift.received',user:{id:'viewer-1',nickname:'Minh'},payload:{giftName:'Hoa hồng',giftId:'rose',quantity:1}})});assert.equal(gift.status,201);
 const adminCookie=cookie;
 const secondaryPassword=randomUUID()+randomUUID();
 const secondary=await request('/users',{method:'POST',body:JSON.stringify({email:`smoke_${suffix}@example.invalid`,username:`smoke_${suffix}`,password:secondaryPassword})});assert.equal(secondary.status,201);
 try{
  const secondaryLogin=await request('/auth/login',{method:'POST',body:JSON.stringify({login:`smoke_${suffix}@example.invalid`,password:secondaryPassword})});assert.equal(secondaryLogin.status,201);
  const forbidden=await request(`/lives/${id}`);assert.equal(forbidden.status,404);
  const forbiddenWrite=await request(`/lives/${id}/simulate`,{method:'POST',body:JSON.stringify({eventType:'viewer.join',user:{id:'x',nickname:'x'},payload:{}})});assert.equal(forbiddenWrite.status,404);
 }finally{cookie=adminCookie;await request('/users/'+secondary.data.id,{method:'DELETE'})}
 const snapshot=await request(`/overlay/${id}/snapshot?token=${encodeURIComponent(overlay.searchParams.get('token'))}`);assert.equal(snapshot.status,200);assert(snapshot.data.events.length>=2);assert.equal(snapshot.data.leaderboard.length,0);assert.equal(snapshot.data.audio.voiceId,'vi-VN-Standard-D');
 const analytics=await request(`/lives/${id}/analytics`);assert.equal(analytics.status,200);assert.equal(Object.keys(analytics.data.counts).length,0);
 await request(`/lives/${id}/overlay-token/revoke`,{method:'POST'});
 const revoked=await request(`/overlay/${id}/snapshot?token=${encodeURIComponent(overlay.searchParams.get('token'))}`);assert.equal(revoked.status,401);
 console.log('Smoke passed: auth, tenant isolation, LIVE, voice config, simulator, Socket.IO, snapshot, analytics isolation, token revoke');
}finally{socket?.disconnect();await request(`/lives/${id}`,{method:'DELETE'})}
