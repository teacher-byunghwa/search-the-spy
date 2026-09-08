const express=require('express');
const http=require('http');
const crypto=require('crypto');
const QRCode=require('qrcode');
const {Server}=require('socket.io');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'}});
app.use(express.static('public'));
app.get('/health',(_,res)=>res.status(200).send('ok'));
app.get('/api/qr',async(req,res)=>{
  try{
    const room=String(req.query.room||'');
    const joinUrl=`${req.protocol}://${req.get('host')}/?room=${encodeURIComponent(room)}`;
    const png=await QRCode.toBuffer(joinUrl,{type:'png',width:900,margin:2,errorCorrectionLevel:'M'});
    res.type('png').send(png);
  }catch(e){res.status(500).send('QR error')}
});

const rooms=new Map();
const MAP={w:2500,h:1550,floors:3};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rand=(a,b)=>Math.random()*(b-a)+a;
const choice=a=>a[Math.floor(Math.random()*a.length)];

const TAUNTS=['나 잡아봐라! 😜','약오르지롱~','메롱~ 😝','여기 있지롱!','잡을 수 있겠어?'];
const NPC_CHAT=['오늘 급식 뭐지?','수업 끝났다!','같이 가자~','숙제 했어?','쉬는 시간이다!','운동장 갈래?','매점 갈 사람?','졸려~'];
const NPC_REPLY=['그러게!','좋아!','나도!','진짜?','ㅋㅋㅋ','같이 가자!','알겠어~'];

const ZONES=[
 {x1:150,x2:690,y1:150,y2:440},{x1:900,x2:1450,y1:150,y2:440},{x1:1700,x2:2320,y1:150,y2:440},
 {x1:150,x2:690,y1:1080,y2:1370},{x1:900,x2:1450,y1:1080,y2:1370},{x1:1700,x2:2320,y1:1080,y2:1370},
 {x1:420,x2:2080,y1:575,y2:930}
];
const YARD_ZONES=[
 {x1:120,x2:840,y1:180,y2:650},{x1:930,x2:2360,y1:170,y2:730},
 {x1:160,x2:850,y1:900,y2:1390},{x1:970,x2:2330,y1:920,y2:1390}
];

const SKINS=['#f7caa5','#eab58b','#cd936d','#a36f54','#79503d'];
const SHIRTS=['#3f78a9','#4e9a71','#8d68aa','#c66c64','#d19b42','#5178b8','#5f9fa4','#9b6d4f'];
const PANTS=['#24313d','#334f67','#4a4458','#5b4b38','#2f3a32'];
const BAGS=['#7a4f33','#395d78','#6b4f87','#8b5b63','#4a754d','#9a7438'];

function randomAppearance(gender='any'){
 const g=gender==='boy'||gender==='girl'?gender:(Math.random()<.5?'boy':'girl');
 const hair=g==='girl'?choice(['bob','ponytail','long','side']):choice(['short','side','spiky','cap']);
 return{gender:g,skin:choice(SKINS),shirt:choice(SHIRTS),pants:choice(PANTS),bag:choice(BAGS),hair,hairColor:choice(['#251c18','#44332b','#1d1d1d','#5a4032'])};
}
function newCode(){let c;do c=String(Math.floor(1000+Math.random()*9000));while(rooms.has(c));return c}
function pointFrom(zones){const z=choice(zones);return{x:rand(z.x1,z.x2),y:rand(z.y1,z.y2)}}
function spawn(area){const p=pointFrom(area===0?YARD_ZONES:ZONES);return{x:p.x,y:p.y,floor:area}}
function makeNPC(i,area){
 const s=spawn(area),t=pointFrom(area===0?YARD_ZONES:ZONES);
 return{
  id:'n'+i,x:s.x,y:s.y,floor:area,tx:t.x,ty:t.y,
  baseSpeed:rand(175,220),speed:rand(175,220),pause:rand(0,2.0),
  bubble:'',bubbleUntil:0,activity:Math.random()<.18?'idle':'walk',
  activityUntil:Date.now()+rand(1600,5200),jumpStart:0,jumpUntil:0,
  appearance:randomAppearance(),stairCooldownUntil:0,groupId:null,leaderId:null,chatPartner:null
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
 return [...r.players.values()]
   .map(p=>({id:p.id,nick:p.nick,score:p.score||0,connected:p.connected,role:p.role}))
   .sort((a,b)=>b.score-a.score||a.nick.localeCompare(b.nick));
}
function pushLobby(r){io.to(r.code).emit('lobby',lobby(r))}
function pushState(r){io.to(r.code).emit('state',state(r))}
function clearGameLoops(r){clearInterval(r.timer);clearInterval(r.npcTimer);clearTimeout(r.countdownTimer)}

function finish(r,winner,reason){
 if(r.phase==='ended')return;
 r.phase='ended';
 clearGameLoops(r);
 for(const p of r.players.values()){
   if(p.role===winner)p.score=(p.score||0)+1;
 }
 const scores=scoreBoard(r);
 io.to(r.code).emit('gameEnded',{winner,reason,scores});
 io.to(r.code).emit('scoreBoard',scores);
 pushState(r);
}

function stairPortalAt(x,y){
 const left=x>=135&&x<=225,right=x>=2275&&x<=2365;
 if(!left&&!right)return null;
 if(y>=675&&y<=709)return{direction:'up',side:left?'left':'right'};
 if(y>=780&&y<=814)return{direction:'down',side:left?'left':'right'};
 return null;
}
function landAfterStairs(p,side,direction){
 p.x=side==='left'?315:MAP.w-315;
 p.y=direction==='up'?795:690;
}
function yardPortalAt(p){
 if(p.floor===1&&p.x>=1140&&p.x<=1360&&p.y>=1460)return'yard';
 if(p.floor===0&&p.x>=1140&&p.x<=1360&&p.y<=100)return'school';
 return null;
}

function startNpcConversation(a,b,now){
 a.activity='chat';b.activity='chat';
 a.pause=rand(2.2,5.0);b.pause=a.pause;
 a.bubble=choice(NPC_CHAT);b.bubble=choice(NPC_REPLY);
 a.bubbleUntil=now+a.pause*1000;b.bubbleUntil=now+b.pause*1000;
 a.activityUntil=a.bubbleUntil;b.activityUntil=b.bubbleUntil;
 a.chatPartner=b.id;b.chatPartner=a.id;
}
function maybeFormGroup(r,now){
 if(Math.random()>.08)return;
 const candidates=r.npcs.filter(n=>n.activity==='walk'&&n.pause<=0);
 if(candidates.length<3)return;
 const leader=choice(candidates);
 const near=candidates.filter(n=>n.id!==leader.id&&n.floor===leader.floor&&Math.hypot(n.x-leader.x,n.y-leader.y)<310).slice(0,3);
 if(!near.length)return;
 const gid='g'+now+Math.floor(Math.random()*999);
 leader.groupId=gid;leader.leaderId=leader.id;
 near.forEach(n=>{n.groupId=gid;n.leaderId=leader.id;n.activity='group';n.activityUntil=now+rand(3200,7200)});
 leader.activity='group';leader.activityUntil=now+rand(3200,7200);
 const q=pointFrom(leader.floor===0?YARD_ZONES:ZONES);leader.tx=q.x;leader.ty=q.y;
}
function pickNPCActivity(n,now){
 n.groupId=null;n.leaderId=null;n.chatPartner=null;n.speed=n.baseSpeed;n.pause=0;n.bubble='';n.bubbleUntil=0;
 const roll=Math.random();
 if(roll<.25){
  const t=pointFrom(n.floor===0?YARD_ZONES:ZONES);n.tx=t.x;n.ty=t.y;n.activity='walk';n.activityUntil=now+rand(2200,5200);
 }else if(roll<.50){
  n.activity='idle';n.pause=rand(2.0,5.5);n.activityUntil=now+n.pause*1000;
 }else if(roll<.68){
  n.activity='chat';n.pause=rand(2.2,5.0);n.bubble=choice(NPC_CHAT);n.bubbleUntil=now+n.pause*1000;n.activityUntil=n.bubbleUntil;
 }else if(roll<.80){
  const t=pointFrom(n.floor===0?YARD_ZONES:ZONES);n.tx=t.x;n.ty=t.y;n.activity='run';n.speed=n.baseSpeed*1.25;n.activityUntil=now+rand(1100,2400);
 }else if(roll<.90){
  n.activity='jump';n.jumpStart=now;n.jumpUntil=now+650;n.pause=rand(.7,1.5);n.activityUntil=now+rand(1000,2200);
 }else if(n.floor===0){
  n.activity='yardReturn';n.tx=1250;n.ty=75;n.activityUntil=now+5500;
 }else{
  n.activity='stairs';
  const side=Math.random()<.5?'left':'right';
  let dir;if(n.floor===1)dir='up';else if(n.floor===3)dir='down';else dir=Math.random()<.5?'up':'down';
  n.tx=side==='left'?180:MAP.w-180;n.ty=dir==='up'?692:797;
  n.stairIntent=dir;n.stairSide=side;n.activityUntil=now+5000;
 }
}

function prepareRound(r){
 const list=[...r.players.values()];
 if(list.length<r.spies+1)return{ok:false,error:`최소 ${r.spies+1}명 이상 참가해야 합니다.`};
 const shuffled=[...list].sort(()=>Math.random()-.5);
 shuffled.forEach((p,i)=>{
   p.role=i<r.spies?'spy':'police';
   p.alive=true;p.ghost=false;p.revealed=false;p.miss=0;
   p.boostUsed=false;p.boostUntil=0;p.bubble='';p.bubbleUntil=0;
   p.jumpStart=0;p.jumpUntil=0;p.stairCooldownUntil=0;
   Object.assign(p,spawn(Math.random()<.12?0:Math.floor(rand(1,4))));
 });
 r.npcs=[];
 for(let i=0;i<r.spies*7;i++){
   const area=i%11===0?0:(i%3)+1;
   r.npcs.push(makeNPC(i,area));
 }
 r.timeLeft=r.minutes*60;r.lastTick=Date.now();r.phase='countdown';

 for(const p of shuffled){
  if(p.socketId)io.to(p.socketId).emit('role',{
    role:p.role,
    teammates:p.role==='spy'?shuffled.filter(x=>x.role==='spy'&&x.id!==p.id).map(x=>({id:x.id,nick:x.nick})):[]
  });
 }
 io.to(r.code).emit('countdownStarted',{seconds:5});
 io.to(r.teacherId).emit('teacherGameStarted',{...state(r),npcs:r.npcs});
 io.to(r.code).emit('scoreBoard',scoreBoard(r));
 pushState(r);

 clearGameLoops(r);
 r.countdownTimer=setTimeout(()=>startRoundLoops(r),5000);
 return{ok:true};
}

function startRoundLoops(r){
 if(r.phase!=='countdown')return;
 r.phase='playing';r.lastTick=Date.now();
 io.to(r.code).emit('gameStarted',{npcCount:r.npcs.length});
 pushState(r);

 r.timer=setInterval(()=>{
  if(r.phase!=='playing')return;
  const now=Date.now(),dt=(now-r.lastTick)/1000;r.lastTick=now;
  r.timeLeft=Math.max(0,r.timeLeft-dt);
  if(r.timeLeft<=0){
    const alive=[...r.players.values()].filter(p=>p.role==='spy'&&p.alive).length;
    return finish(r,alive>0?'spy':'police',alive>0?'제한시간 동안 스파이가 살아남았습니다.':'모든 스파이가 검거되었습니다.');
  }
  io.to(r.code).emit('clock',{timeLeft:r.timeLeft,total:r.minutes*60});
 },250);

 r.npcTimer=setInterval(()=>{
  if(r.phase!=='playing')return;
  const dt=.12,now=Date.now();
  maybeFormGroup(r,now);

  if(Math.random()<.06){
   const pool=r.npcs.filter(n=>n.pause<=0&&n.activity!=='stairs'&&!n.groupId);
   if(pool.length>1){
    const a=choice(pool);
    const b=pool.find(n=>n.id!==a.id&&n.floor===a.floor&&Math.hypot(n.x-a.x,n.y-a.y)<135);
    if(b)startNpcConversation(a,b,now);
   }
  }

  for(const n of r.npcs){
   if(now>=n.activityUntil)pickNPCActivity(n,now);

   if(n.activity==='group'&&n.leaderId&&n.leaderId!==n.id){
    const leader=r.npcs.find(x=>x.id===n.leaderId);
    if(leader&&leader.floor===n.floor){
      const offset=(parseInt(n.id.slice(1))%2===0?1:-1)*46;
      n.tx=leader.x+offset;n.ty=leader.y+55;
    }
   }

   if(n.pause>0){n.pause=Math.max(0,n.pause-dt);continue}

   let dx=n.tx-n.x,dy=n.ty-n.y,d=Math.hypot(dx,dy);
   if(d<22){
    if(n.activity==='stairs'&&n.stairIntent&&now>n.stairCooldownUntil){
      const valid=(n.stairIntent==='up'&&n.floor<3)||(n.stairIntent==='down'&&n.floor>1);
      if(valid){
        n.floor+=n.stairIntent==='up'?1:-1;
        landAfterStairs(n,n.stairSide,n.stairIntent);
        n.stairCooldownUntil=now+1000;
      }
      n.stairIntent=null;const q=pointFrom(ZONES);n.tx=q.x;n.ty=q.y;n.activity='walk';n.activityUntil=now+rand(1800,4200);
    }else if(n.activity==='yardReturn'){
      n.floor=1;n.x=1250;n.y=1410;
      const q=pointFrom(ZONES);n.tx=q.x;n.ty=q.y;n.activity='walk';n.activityUntil=now+3500;
    }else if(n.activity==='group'&&n.leaderId===n.id){
      const q=pointFrom(n.floor===0?YARD_ZONES:ZONES);n.tx=q.x;n.ty=q.y;
    }else{
      const q=pointFrom(n.floor===0?YARD_ZONES:ZONES);n.tx=q.x;n.ty=q.y;
      if(Math.random()<.42)n.pause=rand(1.2,3.5);
    }
   }else{
    n.x=clamp(n.x+dx/d*n.speed*dt,30,MAP.w-30);
    n.y=clamp(n.y+dy/d*n.speed*dt,40,MAP.h-40);
   }
   if(n.jumpUntil<now&&Math.random()<.0028){n.jumpStart=now;n.jumpUntil=now+620}
  }

  io.to(r.code).emit('npcState',r.npcs.map(n=>({
   id:n.id,x:n.x,y:n.y,floor:n.floor,bubble:n.bubble,bubbleUntil:n.bubbleUntil,
   activity:n.activity,jumpStart:n.jumpStart,jumpUntil:n.jumpUntil,appearance:n.appearance
  })));
 },120);
}

io.on('connection',socket=>{
 socket.on('createRoom',({spies,minutes},cb)=>{
  spies=clamp(+spies||1,1,15);minutes=clamp(+minutes||5,1,20);
  const code=newCode();
  const r={
    code,spies,minutes,teacherId:socket.id,players:new Map(),npcs:[],phase:'lobby',
    timeLeft:minutes*60,timer:null,npcTimer:null,countdownTimer:null,lastTick:Date.now()
  };
  rooms.set(code,r);socket.join(code);socket.data.room=code;socket.data.teacher=true;
  cb?.({ok:true,code});pushLobby(r);
 });

 socket.on('joinRoom',({code,nick,gender},cb)=>{
  const r=rooms.get(String(code||''));
  if(!r)return cb?.({ok:false,error:'방을 찾을 수 없습니다.'});
  if(r.phase!=='lobby')return cb?.({ok:false,error:'이미 게임이 시작되었습니다. 기존 참가자는 QR로 다시 접속해 주세요.'});
  nick=String(nick||'').trim().slice(0,12);
  if(!nick)return cb?.({ok:false,error:'닉네임을 입력하세요.'});
  if([...r.players.values()].some(p=>p.nick===nick))return cb?.({ok:false,error:'이미 사용 중인 닉네임입니다.'});
  const s=spawn(1),id=crypto.randomUUID(),token=crypto.randomUUID();
  const p={
    id,socketId:socket.id,reconnectToken:token,nick,role:null,alive:true,ghost:false,revealed:false,miss:0,
    x:s.x,y:s.y,floor:s.floor,angle:0,boostUsed:false,boostUntil:0,bubble:'',bubbleUntil:0,
    jumpStart:0,jumpUntil:0,appearance:randomAppearance(gender),stairCooldownUntil:0,lastChatAt:0,
    connected:true,score:0
  };
  r.players.set(id,p);socket.join(r.code);socket.data.room=r.code;socket.data.playerId=id;socket.data.teacher=false;
  cb?.({ok:true,id,reconnectToken:token,roomCode:r.code,nick:p.nick,score:p.score});
  pushLobby(r);io.to(r.code).emit('scoreBoard',scoreBoard(r));
 });

 socket.on('resumeSession',({code,playerId,reconnectToken},cb)=>{
  const r=rooms.get(String(code||'')),p=r?.players.get(String(playerId||''));
  if(!r||!p||p.reconnectToken!==reconnectToken)return cb?.({ok:false,error:'기존 참가 정보를 찾을 수 없습니다.'});
  p.socketId=socket.id;p.connected=true;socket.join(r.code);
  socket.data.room=r.code;socket.data.playerId=p.id;socket.data.teacher=false;
  cb?.({
    ok:true,id:p.id,nick:p.nick,phase:r.phase,role:p.role,state:state(r),
    teammates:p.role==='spy'?[...r.players.values()].filter(x=>x.role==='spy'&&x.id!==p.id).map(x=>({id:x.id,nick:x.nick})):[],
    score:p.score||0
  });
  socket.emit('npcState',r.npcs);socket.emit('scoreBoard',scoreBoard(r));
  pushLobby(r);pushState(r);
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

 socket.on('updateSettings',({code,spies,minutes},cb)=>{
  const r=rooms.get(String(code||''));
  if(!r||socket.id!==r.teacherId)return cb?.({ok:false});
  r.spies=clamp(+spies||r.spies,1,15);r.minutes=clamp(+minutes||r.minutes,1,20);
  cb?.({ok:true});
 });

 socket.on('move',({x,y,angle,floor})=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||r.phase!=='playing')return;
  p.x=clamp(+x||p.x,20,MAP.w-20);p.y=clamp(+y||p.y,20,MAP.h-20);p.angle=+angle||0;
  if(+floor>=0&&+floor<=3)p.floor=+floor;
  const now=Date.now();

  if(p.floor>0){
    const portal=stairPortalAt(p.x,p.y);
    if(portal&&now>(p.stairCooldownUntil||0)){
      if(portal.direction==='up'&&p.floor<3){
        p.floor++;landAfterStairs(p,portal.side,'up');p.stairCooldownUntil=now+900;
        io.to(p.socketId).emit('autoAreaChanged',{floor:p.floor,x:p.x,y:p.y,label:`${p.floor}층`});
      }else if(portal.direction==='down'&&p.floor>1){
        p.floor--;landAfterStairs(p,portal.side,'down');p.stairCooldownUntil=now+900;
        io.to(p.socketId).emit('autoAreaChanged',{floor:p.floor,x:p.x,y:p.y,label:`${p.floor}층`});
      }
    }
  }

  const yp=yardPortalAt(p);
  if(yp==='yard'){
    p.floor=0;p.x=1250;p.y=170;p.stairCooldownUntil=now+900;
    io.to(p.socketId).emit('autoAreaChanged',{floor:0,x:p.x,y:p.y,label:'운동장'});
  }else if(yp==='school'){
    p.floor=1;p.x=1250;p.y=1410;p.stairCooldownUntil=now+900;
    io.to(p.socketId).emit('autoAreaChanged',{floor:1,x:p.x,y:p.y,label:'1층'});
  }

  socket.to(r.code).emit('playerMoved',{id:p.id,x:p.x,y:p.y,angle:p.angle,floor:p.floor});
 });

 socket.on('jump',()=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||r.phase!=='playing')return;
  const now=Date.now();if((p.jumpUntil||0)>now)return;
  p.jumpStart=now;p.jumpUntil=now+650;
  io.to(r.code).emit('playerJumped',{id:p.id,jumpStart:p.jumpStart,jumpUntil:p.jumpUntil});
 });

 socket.on('playerChat',({text})=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||r.phase!=='playing')return;
  const now=Date.now();if(now-(p.lastChatAt||0)<1800)return;
  text=String(text||'').trim().replace(/\s+/g,' ').slice(0,24);
  if(!text)return;
  p.lastChatAt=now;p.bubble=text;p.bubbleUntil=now+3000;
  io.to(r.code).emit('playerBubble',{id:p.id,text:p.bubble,bubbleUntil:p.bubbleUntil});
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

  io.to(att.socketId).emit('swingResult',{kind:best?'hit':'miss'});
  if(!best)return;

  if(type==='player'&&best.role==='spy'){
    best.alive=false;best.ghost=true;best.revealed=true;
    best.bubble='정체가 들켰다!';best.bubbleUntil=Date.now()+1800;
    att.miss=0;
    io.to(r.code).emit('spyCaught',{spyId:best.id,by:att.id,policeMissReset:true});
    io.to(att.socketId).emit('lifeReset',{miss:0});
    const left=[...r.players.values()].filter(p=>p.role==='spy'&&p.alive).length;
    if(left===0)finish(r,'police','모든 스파이를 검거했습니다.');
  }else{
    att.miss++;
    const text=choice(['윽! 왜 때려?','나 학생이야!','아야! 억울해!','저 아니라고요!','왜 저를 쳐요?!']);
    best.bubble=text;best.bubbleUntil=Date.now()+1800;
    io.to(r.code).emit('wrongHit',{targetId:best.id,by:att.id,miss:att.miss,type,text});
    if(att.miss>=3){
      att.alive=false;att.ghost=true;io.to(r.code).emit('policeOut',{id:att.id});
      const alivePolice=[...r.players.values()].filter(p=>p.role==='police'&&p.alive).length;
      if(alivePolice===0)finish(r,'spy','모든 경찰이 탈락했습니다.');
    }
  }
 });

 socket.on('useBoost',()=>{
  const r=rooms.get(socket.data.room),p=r?.players.get(socket.data.playerId);
  if(!r||!p||r.phase!=='playing'||!p.alive||p.role!=='spy'||p.boostUsed||r.timeLeft>r.minutes*60/2)return;
  p.boostUsed=true;p.boostUntil=Date.now()+10000;p.bubble=choice(TAUNTS);p.bubbleUntil=p.boostUntil;
  io.to(r.code).emit('boosted',{id:p.id,until:p.boostUntil,text:p.bubble,bubbleUntil:p.bubbleUntil});
 });

 socket.on('requestNPCs',()=>{const r=rooms.get(socket.data.room);if(r)socket.emit('npcState',r.npcs)});
 socket.on('teacherRequestState',({code})=>{
  const r=rooms.get(String(code||''));
  if(r&&socket.id===r.teacherId){
    socket.emit('teacherState',{...state(r),npcs:r.npcs});
    socket.emit('scoreBoard',scoreBoard(r));
  }
 });

 socket.on('disconnect',()=>{
  const r=rooms.get(socket.data.room);if(!r)return;
  if(socket.id===r.teacherId){
    clearGameLoops(r);io.to(r.code).emit('roomClosed');rooms.delete(r.code);
  }else{
    const p=r.players.get(socket.data.playerId);
    if(p&&p.socketId===socket.id){p.connected=false;p.socketId=null}
    pushLobby(r);pushState(r);
  }
 });
});

server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Spy School v11 server started'));
