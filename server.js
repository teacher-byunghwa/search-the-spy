const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const crypto=require('crypto');
const QRCode=require('qrcode');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'}});
app.use(express.static('public'));
app.get('/health',(_,res)=>res.status(200).send('ok'));
app.get('/api/qr',async(req,res)=>{
 try{
  const room=String(req.query.room||'').replace(/\D/g,'').slice(0,4);
  if(!room)return res.status(400).send('room required');
  const joinUrl=`${req.protocol}://${req.get('host')}/?room=${room}`;
  const png=await QRCode.toBuffer(joinUrl,{type:'png',width:320,margin:2,errorCorrectionLevel:'M'});
  res.type('png').send(png);
 }catch(e){res.status(500).send('QR error')}
});

const rooms=new Map();
const MAP={w:2200,h:1350,floors:3};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rand=(a,b)=>Math.random()*(b-a)+a;
const choice=a=>a[Math.floor(Math.random()*a.length)];

const TAUNTS=['나 잡아봐라! 😜','약오르지롱~','메롱~ 😝','여기 있지롱!','잡을 수 있겠어?'];
const NPC_CHAT=['오늘 급식 뭐지?','수업 끝났다!','같이 가자~','숙제 했어?','쉬는 시간이다!','운동장 갈래?','매점 갈 사람?','졸려~'];
const NPC_REPLY=['그러게!','좋아!','나도!','진짜?','ㅋㅋㅋ','같이 가자!','알겠어~'];

const ZONES=[
 {x1:110,x2:580,y1:120,y2:390},{x1:790,x2:1260,y1:120,y2:390},{x1:1470,x2:1940,y1:120,y2:390},
 {x1:110,x2:580,y1:950,y2:1210},{x1:790,x2:1260,y1:950,y2:1210},{x1:1470,x2:1940,y1:950,y2:1210},
 {x1:390,x2:1810,y1:540,y2:820}
];

const SKINS=['#f4c7a1','#e8b184','#c98f68','#9d684e','#704535'];
const SHIRTS=['#3f78a9','#4e9a71','#8d68aa','#c66c64','#d19b42','#5178b8','#5f9fa4','#9b6d4f'];
const PANTS=['#24313d','#334f67','#4a4458','#5b4b38','#2f3a32'];
const BAGS=['#7a4f33','#395d78','#6b4f87','#8b5b63','#4a754d','#9a7438'];
const HAIR=['short','side','bob','spiky','cap','ponytail'];

function randomAppearance(){
 return{skin:choice(SKINS),shirt:choice(SHIRTS),pants:choice(PANTS),bag:choice(BAGS),hair:choice(HAIR),hairColor:choice(['#251c18','#44332b','#1d1d1d','#5a4032'])};
}
function newCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(rooms.has(c));return c}
function zonePoint(){const z=choice(ZONES);return{x:rand(z.x1,z.x2),y:rand(z.y1,z.y2)}}
function spawn(floor){const p=zonePoint();return{x:p.x,y:p.y,floor}}

function makeNPC(i,floor){
 const s=spawn(floor),t=zonePoint();
 return{
  id:'n'+i,x:s.x,y:s.y,floor,tx:t.x,ty:t.y,
  baseSpeed:rand(48,76),speed:rand(48,76),pause:rand(0,.8),
  bubble:'',bubbleUntil:0,activity:'walk',activityUntil:Date.now()+rand(1500,5000),
  jumpStart:0,jumpUntil:0,appearance:randomAppearance(),stairCooldownUntil:0,
  groupId:null,leaderId:null,chatPartner:null
 };
}
function playerView(p){
 return{
  id:p.id,nick:p.nick,role:p.role,alive:p.alive,ghost:p.ghost,revealed:p.revealed,miss:p.miss,
  x:p.x,y:p.y,floor:p.floor,angle:p.angle,boostUsed:p.boostUsed,boostUntil:p.boostUntil,
  bubble:p.bubble,bubbleUntil:p.bubbleUntil,jumpStart:p.jumpStart||0,jumpUntil:p.jumpUntil||0,appearance:p.appearance,connected:p.connected!==false
 };
}
function lobby(r){return{code:r.code,spies:r.spies,minutes:r.minutes,npcCount:r.spies*7,players:[...r.players.values()].map(p=>({id:p.id,nick:p.nick}))}}
function state(r){return{code:r.code,spies:r.spies,minutes:r.minutes,timeLeft:r.timeLeft,total:r.minutes*60,players:[...r.players.values()].map(playerView)}}
function pushLobby(r){io.to(r.code).emit('lobby',lobby(r))}
function pushState(r){io.to(r.code).emit('state',state(r))}
function finish(r,winner,reason){if(r.ended)return;r.ended=true;r.started=false;clearInterval(r.timer);clearInterval(r.npcTimer);io.to(r.code).emit('gameEnded',{winner,reason})}

function stairPortalAt(x,y){
 const left=x>=95&&x<=345,right=x>=1855&&x<=2105;
 if(!left&&!right)return null;
 if(y>=575&&y<=655)return{direction:'up',side:left?'left':'right'};
 if(y>=705&&y<=785)return{direction:'down',side:left?'left':'right'};
 return null;
}
function landAfterStairs(p,side,direction){p.x=side==='left'?220:MAP.w-220;p.y=direction==='up'?742:620}

function startNpcConversation(a,b,now){
 a.activity='chat';b.activity='chat';
 a.pause=2.2;b.pause=2.2;
 a.bubble=choice(NPC_CHAT);b.bubble=choice(NPC_REPLY);
 a.bubbleUntil=now+2200;b.bubbleUntil=now+2200;
 a.activityUntil=now+2400;b.activityUntil=now+2400;
 a.chatPartner=b.id;b.chatPartner=a.id;
}
function maybeFormGroup(r,now){
 if(Math.random()>0.12)return;
 const candidates=r.npcs.filter(n=>n.activity==='walk'&&n.pause<=0);
 if(candidates.length<3)return;
 const leader=choice(candidates);
 const near=candidates.filter(n=>n.id!==leader.id&&n.floor===leader.floor&&Math.hypot(n.x-leader.x,n.y-leader.y)<260).slice(0,2);
 if(!near.length)return;
 const gid='g'+now+Math.floor(Math.random()*999);
 leader.groupId=gid;leader.leaderId=leader.id;
 near.forEach(n=>{n.groupId=gid;n.leaderId=leader.id;n.activity='group';n.activityUntil=now+rand(3500,6500)});
 leader.activity='group';leader.activityUntil=now+rand(3500,6500);
 const q=zonePoint();leader.tx=q.x;leader.ty=q.y;
}
function pickNPCActivity(n,now){
 n.groupId=null;n.leaderId=null;n.chatPartner=null;
 const roll=Math.random(),t=zonePoint();
 n.tx=t.x;n.ty=t.y;n.speed=n.baseSpeed;n.pause=0;n.bubble='';n.bubbleUntil=0;
 if(roll<.37){n.activity='walk';n.activityUntil=now+rand(2500,6500)}
 else if(roll<.51){n.activity='idle';n.pause=rand(1.0,3.0);n.activityUntil=now+n.pause*1000}
 else if(roll<.63){n.activity='chat';n.pause=rand(1.7,3.6);n.bubble=choice(NPC_CHAT);n.bubbleUntil=now+n.pause*1000;n.activityUntil=n.bubbleUntil}
 else if(roll<.76){n.activity='run';n.speed=n.baseSpeed*1.65;n.activityUntil=now+rand(1200,2600)}
 else if(roll<.88){n.activity='jump';n.jumpStart=now;n.jumpUntil=now+650;n.activityUntil=now+rand(900,1800)}
 else{
  n.activity='stairs';
  const side=Math.random()<.5?'left':'right';
  let dir;if(n.floor===1)dir='up';else if(n.floor===3)dir='down';else dir=Math.random()<.5?'up':'down';
  n.tx=side==='left'?220:MAP.w-220;n.ty=dir==='up'?615:745;n.stairIntent=dir;n.stairSide=side;n.activityUntil=now+rand(3500,6500)
 }
}

io.on('connection',socket=>{
 socket.on('createRoom',({spies,minutes},cb)=>{
  spies=clamp(+spies||1,1,15);minutes=clamp(+minutes||5,1,20);
  const code=newCode();
  const r={code,spies,minutes,teacherId:socket.id,players:new Map(),npcs:[],started:false,ended:false,timeLeft:minutes*60,timer:null,npcTimer:null,lastTick:Date.now()};
  rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.teacher=true;cb?.({ok:true,code,npcCount:spies*7});pushLobby(r)
 });

 socket.on('joinRoom',({code,nick},cb)=>{
  const r=rooms.get(String(code||''));if(!r)return cb?.({ok:false,error:'방을 찾을 수 없습니다.'});
  if(r.started)return cb?.({ok:false,error:'이미 게임이 시작되었습니다.'});
  nick=String(nick||'').trim().slice(0,12);if(!nick)return cb?.({ok:false,error:'닉네임을 입력하세요.'});
  if([...r.players.values()].some(p=>p.nick===nick))return cb?.({ok:false,error:'이미 사용 중인 닉네임입니다.'});
  const s=spawn(Math.floor(rand(1,4)));
  const playerId=crypto.randomUUID();
  const reconnectToken=crypto.randomUUID();
  const p={id:playerId,socketId:socket.id,reconnectToken,nick,role:null,alive:true,ghost:false,revealed:false,miss:0,x:s.x,y:s.y,floor:s.floor,angle:0,
   boostUsed:false,boostUntil:0,bubble:'',bubbleUntil:0,jumpStart:0,jumpUntil:0,appearance:randomAppearance(),stairCooldownUntil:0,lastChatAt:0,connected:true};
  r.players.set(playerId,p);socket.join(r.code);socket.data.room=r.code;socket.data.playerId=playerId;socket.data.teacher=false;
  cb?.({ok:true,id:p.id,reconnectToken,roomCode:r.code,nick:p.nick,started:r.started});pushLobby(r)
 });

 socket.on('resumeSession',({code,playerId,reconnectToken},cb)=>{
  const r=rooms.get(String(code||''));
  const p=r?.players.get(String(playerId||''));
  if(!r||!p||p.reconnectToken!==reconnectToken)return cb?.({ok:false,error:'기존 참가 정보를 찾을 수 없습니다.'});
  p.socketId=socket.id;p.connected=true;
  socket.join(r.code);socket.data.room=r.code;socket.data.playerId=p.id;socket.data.teacher=false;
  cb?.({ok:true,id:p.id,nick:p.nick,started:r.started,role:p.role,state:state(r),teammates:p.role==='spy'?[...r.players.values()].filter(x=>x.role==='spy'&&x.id!==p.id).map(x=>({id:x.id,nick:x.nick})):[]});
  if(r.started){socket.emit('npcState',r.npcs);}
  pushLobby(r);pushState(r);
 });

 socket.on('startGame',({code},cb)=>{
  const r=rooms.get(String(code||''));if(!r||socket.id!==r.teacherId)return cb?.({ok:false,error:'교사만 시작할 수 있습니다.'});
  if(r.players.size<r.spies+1)return cb?.({ok:false,error:`최소 ${r.spies+1}명 이상 참가해야 합니다.`});

  const list=[...r.players.values()].sort(()=>Math.random()-.5);

  // FIXED: correctly close Object.assign(), block, and forEach()
  list.forEach((p,i)=>{
    p.role=i<r.spies?'spy':'police';
    p.alive=true;
    p.ghost=false;
    p.revealed=false;
    p.miss=0;
    p.boostUsed=false;
    p.boostUntil=0;
    p.bubble='';
    p.bubbleUntil=0;
    p.jumpStart=0;
    p.jumpUntil=0;
    p.stairCooldownUntil=0;
    Object.assign(p,spawn(Math.floor(rand(1,4))));
  });

  r.npcs=Array.from({length:r.spies*7},(_,i)=>makeNPC(i,(i%3)+1));
  r.started=true;r.ended=false;r.timeLeft=r.minutes*60;r.lastTick=Date.now();

  for(const p of list)io.to(p.socketId).emit('role',{role:p.role,teammates:p.role==='spy'?list.filter(x=>x.role==='spy'&&x.id!==p.id).map(x=>({id:x.id,nick:x.nick})):[]});
  io.to(r.code).emit('gameStarted',{npcCount:r.npcs.length});io.to(r.teacherId).emit('teacherGameStarted',{...state(r),npcs:r.npcs});pushState(r);

  clearInterval(r.timer);
  r.timer=setInterval(()=>{
   if(!r.started)return;const now=Date.now(),dt=(now-r.lastTick)/1000;r.lastTick=now;r.timeLeft=Math.max(0,r.timeLeft-dt);
   if(r.timeLeft<=0){const alive=[...r.players.values()].filter(p=>p.role==='spy'&&p.alive).length;return finish(r,alive>0?'spy':'police',alive>0?'제한시간 동안 스파이가 살아남았습니다.':'모든 스파이가 검거되었습니다.')}
   io.to(r.code).emit('clock',{timeLeft:r.timeLeft,total:r.minutes*60})
  },250);

  clearInterval(r.npcTimer);
  r.npcTimer=setInterval(()=>{
   if(!r.started)return;const dt=.12,now=Date.now();

   maybeFormGroup(r,now);

   if(Math.random()<0.045){
    const pool=r.npcs.filter(n=>n.pause<=0&&n.activity!=='stairs'&&!n.groupId);
    if(pool.length>1){
      const a=choice(pool);
      const b=pool.find(n=>n.id!==a.id&&n.floor===a.floor&&Math.hypot(n.x-a.x,n.y-a.y)<110);
      if(b)startNpcConversation(a,b,now);
    }
   }

   for(const n of r.npcs){
    if(now>=n.activityUntil)pickNPCActivity(n,now);

    if(n.activity==='group'&&n.leaderId&&n.leaderId!==n.id){
      const leader=r.npcs.find(x=>x.id===n.leaderId);
      if(leader&&leader.floor===n.floor){
        const offset=(parseInt(n.id.replace('n',''))%2===0?1:-1)*35;
        n.tx=leader.x+offset;n.ty=leader.y+45;
      }
    }

    if(n.pause>0){n.pause=Math.max(0,n.pause-dt);continue}
    let dx=n.tx-n.x,dy=n.ty-n.y,d=Math.hypot(dx,dy);

    if(d<20){
      if(n.activity==='stairs'&&n.stairIntent&&now>n.stairCooldownUntil){
        const valid=(n.stairIntent==='up'&&n.floor<3)||(n.stairIntent==='down'&&n.floor>1);
        if(valid){n.floor+=n.stairIntent==='up'?1:-1;landAfterStairs(n,n.stairSide,n.stairIntent);n.stairCooldownUntil=now+1300}
        n.stairIntent=null;const q=zonePoint();n.tx=q.x;n.ty=q.y;n.activity='walk';n.activityUntil=now+rand(2200,5000)
      }else if(n.activity==='group'&&n.leaderId===n.id){
        const q=zonePoint();n.tx=q.x;n.ty=q.y
      }else{
        const q=zonePoint();n.tx=q.x;n.ty=q.y;if(Math.random()<.24)n.pause=rand(.3,1.3)
      }
    }else{
      n.x=clamp(n.x+dx/d*n.speed*dt,30,MAP.w-30);n.y=clamp(n.y+dy/d*n.speed*dt,40,MAP.h-40)
    }
    if(n.jumpUntil<now&&Math.random()<0.0018){n.jumpStart=now;n.jumpUntil=now+620}
   }

   io.to(r.code).emit('npcState',r.npcs.map(n=>({
    id:n.id,x:n.x,y:n.y,floor:n.floor,bubble:n.bubble,bubbleUntil:n.bubbleUntil,
    activity:n.activity,jumpStart:n.jumpStart,jumpUntil:n.jumpUntil,appearance:n.appearance
   })))
  },120);
  cb?.({ok:true})
 });

 socket.on('move',({x,y,angle,floor})=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);if(!r?.started||!p)return;
  p.x=clamp(+x||p.x,20,MAP.w-20);p.y=clamp(+y||p.y,20,MAP.h-20);p.angle=+angle||0;if(+floor>=1&&+floor<=3)p.floor=+floor;

  const now=Date.now(),portal=stairPortalAt(p.x,p.y);
  if(portal&&now>(p.stairCooldownUntil||0)){
   if(portal.direction==='up'&&p.floor<3){p.floor++;landAfterStairs(p,portal.side,'up');p.stairCooldownUntil=now+1200;io.to(p.socketId).emit('autoFloorChanged',{floor:p.floor,x:p.x,y:p.y,direction:'up'})}
   else if(portal.direction==='down'&&p.floor>1){p.floor--;landAfterStairs(p,portal.side,'down');p.stairCooldownUntil=now+1200;io.to(p.socketId).emit('autoFloorChanged',{floor:p.floor,x:p.x,y:p.y,direction:'down'})}
  }
  socket.to(r.code).emit('playerMoved',{id:p.id,x:p.x,y:p.y,angle:p.angle,floor:p.floor})
 });

 socket.on('jump',()=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);if(!r?.started||!p)return;
  const now=Date.now();if((p.jumpUntil||0)>now)return;p.jumpStart=now;p.jumpUntil=now+650;
  io.to(r.code).emit('playerJumped',{id:p.id,jumpStart:p.jumpStart,jumpUntil:p.jumpUntil})
 });

 socket.on('playerChat',({text})=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);if(!r?.started||!p)return;
  const now=Date.now();
  if(now-(p.lastChatAt||0)<1800)return;
  text=String(text||'').trim().replace(/\s+/g,' ').slice(0,24);
  if(!text)return;
  p.lastChatAt=now;p.bubble=text;p.bubbleUntil=now+3000;
  io.to(r.code).emit('playerBubble',{id:p.id,text:p.bubble,bubbleUntil:p.bubbleUntil})
 });

 socket.on('hitAttempt',()=>{
  const r=rooms.get(socket.data.room),att=r?.players.get(socket.data.playerId);if(!r?.started||!att?.alive||att.role!=='police')return;
  let best=null,dist=Infinity,type=null;
  for(const p of r.players.values()){
   if(p.id===att.id||!p.alive||p.floor!==att.floor)continue;
   const dx=p.x-att.x,dy=p.y-att.y,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx),da=Math.atan2(Math.sin(a-att.angle),Math.cos(a-att.angle));
   if(d<92&&Math.abs(da)<.78&&d<dist){best=p;dist=d;type='player'}
  }
  for(const n of r.npcs){
   if(n.floor!==att.floor)continue;
   const dx=n.x-att.x,dy=n.y-att.y,d=Math.hypot(dx,dy),a=Math.atan2(dy,dx),da=Math.atan2(Math.sin(a-att.angle),Math.cos(a-att.angle));
   if(d<92&&Math.abs(da)<.78&&d<dist){best=n;dist=d;type='npc'}
  }
  io.to(att.socketId).emit('swingResult',{kind:best?'hit':'miss'});if(!best)return;

  if(type==='player'&&best.role==='spy'){
   best.alive=false;best.ghost=true;best.revealed=true;best.bubble='정체가 들켰다!';best.bubbleUntil=Date.now()+1800;att.miss=0;
   io.to(r.code).emit('spyCaught',{spyId:best.id,by:att.id,policeMissReset:true});io.to(att.socketId).emit('lifeReset',{miss:0});
   const left=[...r.players.values()].filter(p=>p.role==='spy'&&p.alive).length;if(left===0)finish(r,'police','모든 스파이를 검거했습니다.')
  }else{
   att.miss++;const text=choice(['윽! 왜 때려?','나 학생이야!','아야! 억울해!','저 아니라고요!','왜 저를 쳐요?!']);best.bubble=text;best.bubbleUntil=Date.now()+1800;
   io.to(r.code).emit('wrongHit',{targetId:best.id,by:att.id,miss:att.miss,type,text});
   if(att.miss>=3){att.alive=false;att.ghost=true;io.to(r.code).emit('policeOut',{id:att.id});const alivePolice=[...r.players.values()].filter(p=>p.role==='police'&&p.alive).length;if(alivePolice===0)finish(r,'spy','모든 경찰이 탈락했습니다.')}
  }
 });

 socket.on('useBoost',()=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);if(!r?.started||!p?.alive||p.role!=='spy'||p.boostUsed||r.timeLeft>r.minutes*60/2)return;
  p.boostUsed=true;p.boostUntil=Date.now()+10000;p.bubble=choice(TAUNTS);p.bubbleUntil=p.boostUntil;
  io.to(r.code).emit('boosted',{id:p.id,until:p.boostUntil,text:p.bubble,bubbleUntil:p.bubbleUntil})
 });

 socket.on('requestNPCs',()=>{const r=rooms.get(socket.data.room);if(r)socket.emit('npcState',r.npcs)});
 socket.on('teacherRequestState',({code})=>{const r=rooms.get(String(code||''));if(r&&socket.id===r.teacherId)socket.emit('teacherState',{...state(r),npcs:r.npcs})});
 socket.on('disconnect',()=>{const r=rooms.get(socket.data.room);if(!r)return;if(socket.id===r.teacherId){clearInterval(r.timer);clearInterval(r.npcTimer);io.to(r.code).emit('roomClosed');rooms.delete(r.code)}else{const p=r.players.get(socket.data.playerId);if(p&&p.socketId===socket.id){p.connected=false;p.socketId=null;}pushLobby(r);if(r.started)pushState(r)}})
});

server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Spy School v8 fixed server started'));
