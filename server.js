const express=require('express');
const http=require('http');
const crypto=require('crypto');
const QRCode=require('qrcode');
const {Server}=require('socket.io');

const app=express();
app.set('trust proxy',1);
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'},pingInterval:10000,pingTimeout:30000});
app.use(express.static('public'));
app.get('/health',(_,res)=>res.status(200).send('ok'));
app.get('/api/qr',async(req,res)=>{
  try{
    const room=String(req.query.room||'');
    const joinUrl=`${req.protocol}://${req.get('host')}/?room=${encodeURIComponent(room)}`;
    const png=await QRCode.toBuffer(joinUrl,{type:'png',width:1000,margin:2,errorCorrectionLevel:'M'});
    res.type('png').send(png);
  }catch(e){res.status(500).send('QR error')}
});

const rooms=new Map();
const MAP={w:3200,h:2000,floors:3};
const SPEED=240;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rand=(a,b)=>Math.random()*(b-a)+a;
const choice=a=>a[Math.floor(Math.random()*a.length)];

const TAUNTS=['나 잡아봐라! 😜','약오르지롱~','메롱~ 😝','여기 있지롱!','잡을 수 있겠어?'];
const NPC_CHAT=['오늘 급식 뭐지?','수업 끝났다!','같이 가자~','숙제 했어?','쉬는 시간이다!','운동장 갈래?','매점 갈 사람?','졸려~'];
const NPC_REPLY=['그러게!','좋아!','나도!','진짜?','ㅋㅋㅋ','같이 가자!','알겠어~'];

const SKINS=['#f7caa5','#eab58b','#cd936d','#a36f54','#79503d'];
const SHIRTS=['#3f78a9','#4e9a71','#8d68aa','#c66c64','#d19b42','#5178b8','#5f9fa4','#9b6d4f'];
const PANTS=['#24313d','#334f67','#4a4458','#5b4b38','#2f3a32'];
const BAGS=['#7a4f33','#395d78','#6b4f87','#8b5b63','#4a754d','#9a7438'];

const INDOOR_CORRIDOR=[
 {x1:360,x2:2840,y1:650,y2:1190},
 {x1:480,x2:870,y1:260,y2:520},{x1:1190,x2:1580,y1:260,y2:520},{x1:1900,x2:2290,y1:260,y2:520},
 {x1:480,x2:870,y1:1480,y2:1740},{x1:1190,x2:1580,y1:1480,y2:1740},{x1:1900,x2:2290,y1:1480,y2:1740}
];
const YARD_ZONES=[
 {x1:180,x2:950,y1:300,y2:900},{x1:1020,x2:3020,y1:260,y2:920},
 {x1:180,x2:1100,y1:1080,y2:1820},{x1:1220,x2:3000,y1:1070,y2:1830}
];

function randomAppearance(gender='any'){
 const g=gender==='boy'||gender==='girl'?gender:(Math.random()<.5?'boy':'girl');
 const hair=g==='girl'?choice(['bob','ponytail','long','side']):choice(['short','side','spiky','cap']);
 return{gender:g,skin:choice(SKINS),shirt:choice(SHIRTS),pants:choice(PANTS),bag:choice(BAGS),hair,hairColor:choice(['#251c18','#44332b','#1d1d1d','#5a4032'])};
}
function newCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(rooms.has(c));return c}
function pointFrom(zones){const z=choice(zones);return{x:rand(z.x1,z.x2),y:rand(z.y1,z.y2)}}
function spawn(area=1){
 const p=pointFrom(area===0?YARD_ZONES:INDOOR_CORRIDOR);
 return{x:p.x,y:p.y,floor:area};
}
function makeNPC(i,area){
 const s=spawn(area),t=pointFrom(area===0?YARD_ZONES:INDOOR_CORRIDOR);
 const idle=Math.random()<.26;
 return{
  id:'n'+i,x:s.x,y:s.y,floor:area,tx:t.x,ty:t.y,
  speed:SPEED,pause:idle?rand(2.0,5.5):rand(0,.5),bubble:'',bubbleUntil:0,
  activity:idle?'idle':'walk',activityUntil:Date.now()+rand(1800,5200),
  jumpStart:0,jumpUntil:0,appearance:randomAppearance(),
  stairCooldownUntil:0,groupId:null,leaderId:null,chatPartner:null
 };
}
function playerView(p){
 return{
  id:p.id,nick:p.nick,role:p.role,alive:p.alive,ghost:p.ghost,revealed:p.revealed,miss:p.miss,
  x:p.x,y:p.y,floor:p.floor,angle:p.angle,boostUsed:p.boostUsed,boostUntil:p.boostUntil,
  bubble:p.bubble,bubbleUntil:p.bubbleUntil,jumpStart:p.jumpStart||0,jumpUntil:p.jumpUntil||0,
  appearance:p.appearance,connected:p.connected,score:p.score||0
 };
}
function lobby(r){
 return{
  code:r.code,spies:r.spies,minutes:r.minutes,phase:r.phase,
  players:[...r.players.values()].map(p=>({id:p.id,nick:p.nick,connected:p.connected,score:p.score||0}))
 };
}
function state(r){
 return{
  code:r.code,spies:r.spies,minutes:r.minutes,timeLeft:r.timeLeft,total:r.minutes*60,
  players:[...r.players.values()].map(playerView),phase:r.phase
 };
}
function scoreBoard(r){
 return [...r.players.values()].map(p=>({id:p.id,nick:p.nick,score:p.score||0,connected:p.connected,role:p.role}))
 .sort((a,b)=>b.score-a.score||a.nick.localeCompare(b.nick));
}
function pushLobby(r){io.to(r.code).emit('lobby',lobby(r))}
function pushState(r){io.to(r.code).emit('state',state(r))}
function clearLoops(r){clearInterval(r.timer);clearInterval(r.npcTimer);clearTimeout(r.revealTimer)}

const EXIT_PORTALS=[
 {name:'왼쪽 출입구',x1:970,x2:1090},
 {name:'가운데 출입구',x1:1950,x2:2070},
 {name:'오른쪽 출입구',x1:2960,x2:3120}
];

function roomWalls(){
 const rects=[];
 const xs=[130,1110,2090],topY=90,bottomY=1370,w=820,h=360,t=18,door=100;
 for(const x of xs){
  // 윗줄 교실: 복도 쪽(아래)에 문 하나
  rects.push({x,y:topY,w,h:t},{x,y:topY,w:t,h},{x:x+w-t,y:topY,w:t,h});
  const dg=x+w/2-door/2;
  rects.push({x,y:topY+h-t,w:dg-x,h:t},{x:dg+door,y:topY+h-t,w:x+w-(dg+door),h:t});
  // 아랫줄 교실: 복도 쪽(위)에 문 하나
  rects.push({x,y:bottomY,w,h:t},{x,y:bottomY,w:t,h},{x:x+w-t,y:bottomY,w:t,h});
  const dg2=x+w/2-door/2;
  rects.push({x,y:bottomY,w:dg2-x,h:t},{x:dg2+door,y:bottomY,w:x+w-(dg2+door),h:t});
 }
 return rects;
}
const ROOM_WALLS=roomWalls();

// 운동장 학교 건물 외벽. 3개 출입구 부분만 실제로 비어 있음.
const SCHOOL_YARD_WALLS=[
 {x:650,y:40,w:320,h:300},
 {x:1090,y:40,w:860,h:300},
 {x:2070,y:40,w:890,h:300},
 {x:3120,y:40,w:30,h:300}
];

// 농구장 울타리: 점프 중에만 통과 가능. 그림과 완전히 같은 좌표 사용.
const FENCE_RECTS=[
 {x:160,y:1120,w:920,h:14},
 {x:160,y:1820,w:920,h:14},
 {x:160,y:1120,w:14,h:714},
 {x:1066,y:1120,w:14,h:714}
];

// 놀이터의 실제 단단한 구조물
const PLAYGROUND_SOLIDS=[
 {x:270,y:420,w:120,h:36},   // 미끄럼틀 바닥
 {x:500,y:420,w:22,h:150},   // 그네 기둥
 {x:760,y:420,w:22,h:150},   // 그네 기둥
 {x:470,y:555,w:340,h:24}    // 모래놀이터 테두리 일부
];

function rectContains(r,x,y,rad=18){return x+rad>r.x&&x-rad<r.x+r.w&&y+rad>r.y&&y-rad<r.y+r.h}
function isBlocked(floor,x,y,jumping=false){
 if(x<28||x>MAP.w-28||y<28||y>MAP.h-28)return true;
 if(floor>0)return ROOM_WALLS.some(r=>rectContains(r,x,y,17));
 if(SCHOOL_YARD_WALLS.some(r=>rectContains(r,x,y,17)))return true;
 if(PLAYGROUND_SOLIDS.some(r=>rectContains(r,x,y,17)))return true;
 if(!jumping&&FENCE_RECTS.some(r=>rectContains(r,x,y,17)))return true;
 return false;
}

// X/Y축을 따로 판정해 벽 모서리에 '붙잡히는' 현상을 줄인다.
function safeMove(p,nx,ny){
 const jumping=Date.now()<(p.jumpUntil||0);
 let moved=false;
 if(!isBlocked(p.floor,nx,p.y,jumping)){p.x=nx;moved=true}
 if(!isBlocked(p.floor,p.x,ny,jumping)){p.y=ny;moved=true}
 return moved;
}

function finish(r,winner,reason){
 if(r.phase==='ended')return;
 r.phase='ended';clearLoops(r);
 for(const p of r.players.values())if(p.role===winner)p.score=(p.score||0)+1;
 const scores=scoreBoard(r);
 io.to(r.code).emit('gameEnded',{winner,reason,scores});
 io.to(r.code).emit('scoreBoard',scores);
 pushState(r);
}

function forceFinish(r,reason='교사가 게임을 종료했습니다.'){
 if(r.phase==='ended')return;
 r.phase='ended';
 clearLoops(r);
 const scores=scoreBoard(r);
 io.to(r.code).emit('gameForceEnded',{reason,scores});
 io.to(r.code).emit('scoreBoard',scores);
 pushState(r);
}


function startNpcConversation(a,b,now){
 a.activity='chat';b.activity='chat';a.pause=rand(2.2,5.0);b.pause=a.pause;
 a.bubble=choice(NPC_CHAT);b.bubble=choice(NPC_REPLY);
 a.bubbleUntil=now+a.pause*1000;b.bubbleUntil=now+b.pause*1000;
 a.activityUntil=a.bubbleUntil;b.activityUntil=b.bubbleUntil;
 a.chatPartner=b.id;b.chatPartner=a.id;
}
function maybeFormGroup(r,now){
 if(Math.random()>.07)return;
 const candidates=r.npcs.filter(n=>n.activity==='walk'&&n.pause<=0);
 if(candidates.length<3)return;
 const leader=choice(candidates);
 const near=candidates.filter(n=>n.id!==leader.id&&n.floor===leader.floor&&Math.hypot(n.x-leader.x,n.y-leader.y)<340).slice(0,3);
 if(!near.length)return;
 const gid='g'+now+Math.floor(Math.random()*999);
 leader.groupId=gid;leader.leaderId=leader.id;
 near.forEach(n=>{n.groupId=gid;n.leaderId=leader.id;n.activity='group';n.activityUntil=now+rand(3200,7200)});
 leader.activity='group';leader.activityUntil=now+rand(3200,7200);
 const q=pointFrom(leader.floor===0?YARD_ZONES:INDOOR_CORRIDOR);leader.tx=q.x;leader.ty=q.y;
}
function pickNPCActivity(n,now){
 n.groupId=null;n.leaderId=null;n.chatPartner=null;n.speed=SPEED;n.pause=0;n.bubble='';n.bubbleUntil=0;
 const roll=Math.random();
 if(roll<.27){
  const t=pointFrom(n.floor===0?YARD_ZONES:INDOOR_CORRIDOR);n.tx=t.x;n.ty=t.y;n.activity='walk';n.activityUntil=now+rand(2200,5200);
 }else if(roll<.53){
  n.activity='idle';n.pause=rand(2.0,5.5);n.activityUntil=now+n.pause*1000;
 }else if(roll<.70){
  n.activity='chat';n.pause=rand(2.2,5.0);n.bubble=choice(NPC_CHAT);n.bubbleUntil=now+n.pause*1000;n.activityUntil=n.bubbleUntil;
 }else if(roll<.82){
  const t=pointFrom(n.floor===0?YARD_ZONES:INDOOR_CORRIDOR);n.tx=t.x;n.ty=t.y;n.activity='run';n.activityUntil=now+rand(1100,2400);
 }else if(roll<.92){
  n.activity='jump';n.jumpStart=now;n.jumpUntil=now+650;n.pause=rand(.7,1.5);n.activityUntil=now+rand(1000,2200);
 }else{
  const t=pointFrom(n.floor===0?YARD_ZONES:INDOOR_CORRIDOR);n.tx=t.x;n.ty=t.y;n.activity='walk';n.activityUntil=now+rand(1800,4200);
 }
}

function distributeNPCs(r){
 const total=r.spies*7;
 r.npcs=[];
 for(let i=0;i<total;i++){
   const area=i%4; // exactly balanced across yard, floors 1,2,3 (difference <=1)
   r.npcs.push(makeNPC(i,area));
 }
}

function prepareRound(r){
 const list=[...r.players.values()];
 if(list.length<r.spies+1)return{ok:false,error:`최소 ${r.spies+1}명 이상 참가해야 합니다.`};
 clearLoops(r);
 const shuffled=[...list].sort(()=>Math.random()-.5);
 shuffled.forEach((p,i)=>{
  p.role=i<r.spies?'spy':'police';p.alive=true;p.ghost=false;p.revealed=false;p.miss=0;
  p.boostUsed=false;p.boostUntil=0;p.bubble='';p.bubbleUntil=0;p.jumpStart=0;p.jumpUntil=0;
  Object.assign(p,spawn(i%4));
 });
 distributeNPCs(r);
 r.timeLeft=r.minutes*60;r.phase='reveal';r.lastTick=Date.now();
 io.to(r.code).emit('clearFeed');r.warned30=false;

 for(const p of shuffled){
   const same=shuffled.filter(x=>x.role===p.role).map(x=>({id:x.id,nick:x.nick}));
   if(p.socketId)io.to(p.socketId).emit('role',{role:p.role,teammates:same});
 }
 io.to(r.code).emit('teamRevealStarted',{seconds:10});
 io.to(r.teacherId).emit('teacherGameStarted',{...state(r),npcs:r.npcs});
 io.to(r.code).emit('scoreBoard',scoreBoard(r));
 pushState(r);

 r.revealTimer=setTimeout(()=>startRound(r),10000);
 return{ok:true};
}

function startRound(r){
 if(r.phase!=='reveal')return;
 r.phase='playing';r.lastTick=Date.now();
 io.to(r.code).emit('gameStarted',{message:'게임 시작!'});
 pushState(r);

 r.timer=setInterval(()=>{
  if(r.phase!=='playing')return;
  const now=Date.now(),dt=(now-r.lastTick)/1000;r.lastTick=now;
  r.timeLeft=Math.max(0,r.timeLeft-dt);
  if(!r.warned30&&r.timeLeft<=30){r.warned30=true;io.to(r.code).emit('thirtySecondWarning',{text:'게임 30초 남았습니다!'});}
  if(r.timeLeft<=0){
    const alive=[...r.players.values()].filter(p=>p.role==='spy'&&p.alive).length;
    return finish(r,alive>0?'spy':'police',alive>0?'제한시간 동안 스파이가 살아남았습니다.':'모든 스파이가 검거되었습니다.');
  }
  io.to(r.code).emit('clock',{timeLeft:r.timeLeft,total:r.minutes*60});
 },250);

 r.npcTimer=setInterval(()=>{
  if(r.phase!=='playing')return;
  const dt=.08,now=Date.now();
  maybeFormGroup(r,now);

  if(Math.random()<.05){
   const pool=r.npcs.filter(n=>n.pause<=0&&!n.groupId);
   if(pool.length>1){
    const a=choice(pool);
    const b=pool.find(n=>n.id!==a.id&&n.floor===a.floor&&Math.hypot(n.x-a.x,n.y-a.y)<145);
    if(b)startNpcConversation(a,b,now);
   }
  }

  for(const n of r.npcs){
    if(now>=n.activityUntil)pickNPCActivity(n,now);

    if(n.activity==='group'&&n.leaderId&&n.leaderId!==n.id){
      const leader=r.npcs.find(x=>x.id===n.leaderId);
      if(leader&&leader.floor===n.floor){
        const off=(parseInt(n.id.slice(1))%2===0?1:-1)*46;
        n.tx=leader.x+off;n.ty=leader.y+58;
      }
    }

    if(n.pause>0){n.pause=Math.max(0,n.pause-dt);continue}

    const dx=n.tx-n.x,dy=n.ty-n.y,d=Math.hypot(dx,dy);
    if(d<24){
      const q=pointFrom(n.floor===0?YARD_ZONES:INDOOR_CORRIDOR);n.tx=q.x;n.ty=q.y;
      if(Math.random()<.42)n.pause=rand(1.1,3.8);
    }else{
      const nx=n.x+dx/d*SPEED*dt,ny=n.y+dy/d*SPEED*dt;
      if(!safeMove(n,nx,ny)){
        const q=pointFrom(n.floor===0?YARD_ZONES:INDOOR_CORRIDOR);n.tx=q.x;n.ty=q.y;n.pause=rand(.4,1.2);
      }
    }
    if(n.jumpUntil<now&&Math.random()<.0023){n.jumpStart=now;n.jumpUntil=now+620}
  }

  io.to(r.code).emit('npcState',r.npcs.map(n=>({
   id:n.id,x:n.x,y:n.y,floor:n.floor,bubble:n.bubble,bubbleUntil:n.bubbleUntil,
   activity:n.activity,jumpStart:n.jumpStart,jumpUntil:n.jumpUntil,appearance:n.appearance
  })));
 },80);
}

io.on('connection',socket=>{
 socket.on('createRoom',({spies,minutes},cb)=>{
  spies=clamp(+spies||1,1,15);minutes=clamp(+minutes||5,1,20);
  const code=newCode();
  const r={code,spies,minutes,teacherId:socket.id,players:new Map(),npcs:[],phase:'lobby',
   timeLeft:minutes*60,timer:null,npcTimer:null,revealTimer:null,lastTick:Date.now(),warned30:false};
  rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.teacher=true;
  cb?.({ok:true,code});pushLobby(r);
 });

 socket.on('joinRoom',({code,nick,gender},cb)=>{
  const r=rooms.get(String(code||''));
  if(!r)return cb?.({ok:false,error:'방을 찾을 수 없습니다.'});
  if(r.phase!=='lobby')return cb?.({ok:false,error:'게임이 진행 중입니다. 기존 참가자는 QR을 다시 찍어 복귀할 수 있습니다.'});
  nick=String(nick||'').trim().slice(0,12);
  if(!nick)return cb?.({ok:false,error:'닉네임을 입력하세요.'});
  if([...r.players.values()].some(p=>p.nick===nick))return cb?.({ok:false,error:'이미 사용 중인 닉네임입니다.'});
  const s=spawn(1),id=crypto.randomUUID(),token=crypto.randomUUID();
  const p={id,socketId:socket.id,reconnectToken:token,nick,role:null,alive:true,ghost:false,revealed:false,miss:0,
   x:s.x,y:s.y,floor:1,angle:0,boostUsed:false,boostUntil:0,bubble:'',bubbleUntil:0,jumpStart:0,jumpUntil:0,
   appearance:randomAppearance(gender),lastChatAt:0,connected:true,score:0};
  r.players.set(id,p);socket.join(r.code);socket.data.room=r.code;socket.data.playerId=id;socket.data.teacher=false;
  cb?.({ok:true,id,reconnectToken:token,roomCode:r.code,nick:p.nick,score:p.score,state:state(r)});
  pushLobby(r);pushState(r);io.to(r.code).emit('scoreBoard',scoreBoard(r));
 });

 socket.on('resumeSession',({code,playerId,reconnectToken},cb)=>{
  const r=rooms.get(String(code||'')),p=r?.players.get(String(playerId||''));
  if(!r||!p||p.reconnectToken!==reconnectToken)return cb?.({ok:false,error:'기존 참가 정보를 찾을 수 없습니다.'});
  p.socketId=socket.id;p.connected=true;socket.join(r.code);
  socket.data.room=r.code;socket.data.playerId=p.id;socket.data.teacher=false;
  const same=p.role?[...r.players.values()].filter(x=>x.role===p.role).map(x=>({id:x.id,nick:x.nick})):[];
  cb?.({ok:true,id:p.id,nick:p.nick,phase:r.phase,role:p.role,state:state(r),teammates:same,score:p.score||0});
  socket.emit('npcState',r.npcs);socket.emit('scoreBoard',scoreBoard(r));pushLobby(r);pushState(r);
 });

 socket.on('startGame',({code},cb)=>{
  const r=rooms.get(String(code||''));
  if(!r||socket.id!==r.teacherId)return cb?.({ok:false,error:'교사만 시작할 수 있습니다.'});
  cb?.(prepareRound(r));
 });
 socket.on('restartGame',({code},cb)=>{
  const r=rooms.get(String(code||''));
  if(!r||socket.id!==r.teacherId)return cb?.({ok:false,error:'교사만 새 게임을 시작할 수 있습니다.'});
  cb?.(prepareRound(r));
 });

 socket.on('move',({x,y,angle,floor})=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||!['lobby','playing'].includes(r.phase))return;
  if(+floor>=0&&+floor<=3)p.floor=+floor;
  const nx=clamp(+x||p.x,20,MAP.w-20),ny=clamp(+y||p.y,20,MAP.h-20);
  safeMove(p,nx,ny);p.angle=+angle||0;
  socket.to(r.code).emit('playerMoved',{id:p.id,x:p.x,y:p.y,angle:p.angle,floor:p.floor});
 });

 socket.on('portalTransition',({floor,x,y,label},cb)=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||r.phase!=='playing')return;
  floor=clamp(+floor,0,3);x=clamp(+x,30,MAP.w-30);y=clamp(+y,30,MAP.h-30);
  p.floor=floor;p.x=x;p.y=y;
  io.to(r.code).emit('playerMoved',{id:p.id,x:p.x,y:p.y,angle:p.angle,floor:p.floor});
  cb?.({ok:true});
 });

 socket.on('jump',()=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||!['lobby','playing'].includes(r.phase))return;
  const now=Date.now();if((p.jumpUntil||0)>now)return;
  p.jumpStart=now;p.jumpUntil=now+650;
  io.to(r.code).emit('playerJumped',{id:p.id,jumpStart:p.jumpStart,jumpUntil:p.jumpUntil});
 });

 socket.on('teacherChat',({code,text})=>{
  const r=rooms.get(String(code||''));
  if(!r||socket.id!==r.teacherId)return;
  text=String(text||'').trim().replace(/\s+/g,' ').slice(0,40);
  if(!text)return;
  io.to(r.code).emit('chatFeed',{kind:'teacher',nick:'교사',text});
 });

 socket.on('playerChat',({text})=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||!['lobby','playing'].includes(r.phase))return;
  const now=Date.now();if(now-(p.lastChatAt||0)<1800)return;
  text=String(text||'').trim().replace(/\s+/g,' ').slice(0,24);if(!text)return;
  p.lastChatAt=now;p.bubble=text;p.bubbleUntil=now+3000;
  io.to(r.code).emit('playerBubble',{id:p.id,text:p.bubble,bubbleUntil:p.bubbleUntil});
  io.to(r.code).emit('chatFeed',{kind:'chat',nick:p.nick,text});
 });

 socket.on('hitAttempt',()=>{
  const r=rooms.get(socket.data.room),att=r?.players.get(socket.data.playerId);
  if(!r||!att||r.phase!=='playing'||!att.alive||att.role!=='police')return;
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
    io.to(r.code).emit('spyCaught',{spyId:best.id,by:att.id,spyNick:best.nick,policeNick:att.nick,policeMissReset:true});
    io.to(r.code).emit('chatFeed',{kind:'death',nick:best.nick,text:'스파이가 잡혀 탈락했습니다.'});
    io.to(att.socketId).emit('lifeReset',{miss:0});
    const left=[...r.players.values()].filter(p=>p.role==='spy'&&p.alive).length;if(left===0)finish(r,'police','모든 스파이를 검거했습니다.');
  }else{
    att.miss++;
    const text=choice(['윽! 왜 때려?','나 학생이야!','아야! 억울해!','저 아니라고요!','왜 저를 쳐요?!']);
    best.bubble=text;best.bubbleUntil=Date.now()+1800;
    io.to(r.code).emit('wrongHit',{targetId:best.id,by:att.id,miss:att.miss,type,text});
    if(att.miss>=3){
      att.alive=false;att.ghost=true;
      io.to(r.code).emit('policeOut',{id:att.id,nick:att.nick});
      io.to(r.code).emit('chatFeed',{kind:'death',nick:att.nick,text:'경찰이 탈락했습니다.'});
      const alivePolice=[...r.players.values()].filter(p=>p.role==='police'&&p.alive).length;if(alivePolice===0)finish(r,'spy','모든 경찰이 탈락했습니다.');
    }
  }
 });

 socket.on('useBoost',()=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||r.phase!=='playing'||!p.alive||p.role!=='spy'||p.boostUsed||r.timeLeft>r.minutes*60/2)return;
  p.boostUsed=true;p.boostUntil=Date.now()+10000;p.bubble=choice(TAUNTS);p.bubbleUntil=p.boostUntil;
  io.to(r.code).emit('boosted',{id:p.id,until:p.boostUntil,text:p.bubble,bubbleUntil:p.bubbleUntil});
 });

 socket.on('forceEndGame',({code},cb)=>{
  const r=rooms.get(String(code||''));
  if(!r||socket.id!==r.teacherId)return cb?.({ok:false,error:'교사만 게임을 종료할 수 있습니다.'});
  if(!['reveal','playing'].includes(r.phase))return cb?.({ok:false,error:'현재 종료할 게임이 없습니다.'});
  forceFinish(r,'교사가 게임을 강제로 종료했습니다.');
  cb?.({ok:true});
 });

 socket.on('requestNPCs',()=>{const r=rooms.get(socket.data.room);if(r)socket.emit('npcState',r.npcs)});
 socket.on('teacherRequestState',({code})=>{
  const r=rooms.get(String(code||''));if(r&&socket.id===r.teacherId){socket.emit('teacherState',{...state(r),npcs:r.npcs});socket.emit('scoreBoard',scoreBoard(r))}
 });
 socket.on('disconnect',()=>{
  const r=rooms.get(socket.data.room);if(!r)return;
  if(socket.id===r.teacherId){clearLoops(r);io.to(r.code).emit('roomClosed');rooms.delete(r.code)}
  else{
    const p=r.players.get(socket.data.playerId);if(p&&p.socketId===socket.id){p.connected=false;p.socketId=null}
    pushLobby(r);pushState(r);
  }
 });
});

server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Spy School v12 server started'));
