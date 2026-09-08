const socket=io();
const MAP={w:2200,h:1350};
let mode=null,roomCode='',meId=null,myRole=null,teammates=[],players={},npcs=[],started=false,timeLeft=0,totalTime=1;
let selectedTeacherFloor=1,keys={},angle=0,boostUntil=0,boostUsed=false,swingT=0,last=performance.now(),cam={x:0,y:0},joy={active:false,dx:0,dy:0};

const $=id=>document.getElementById(id),gameCanvas=$('gameCanvas'),g=gameCanvas.getContext('2d'),teacherCanvas=$('teacherCanvas'),tg=teacherCanvas.getContext('2d');
function resize(){gameCanvas.width=innerWidth;gameCanvas.height=innerHeight;teacherCanvas.width=innerWidth;teacherCanvas.height=innerHeight}
addEventListener('resize',resize);resize();

function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active')}window.showScreen=showScreen;
function toast(t){$('toast').textContent=t;$('toast').style.opacity=1;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.opacity=0,1400)}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function fmt(t){t=Math.max(0,t||0);return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`}
const SESSION_KEY='spySchoolStudentSessionV9';
function saveSession(data){localStorage.setItem(SESSION_KEY,JSON.stringify(data))}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function buildJoinUrl(code){return `${location.origin}/?room=${encodeURIComponent(code)}`}
function applyRoleUI(role, mates=[]){
 myRole=role;teammates=mates||[];
 $('roleTitle').textContent=myRole==='spy'?'🕵️ 당신은 스파이!':'🚔 당신은 경찰!';
 $('roleText').textContent=myRole==='spy'
  ?`다른 학생들과 똑같은 모습입니다. 다른 스파이: ${teammates.map(x=>x.nick).join(', ')||'없음'} — 학생처럼 걷고 멈추고 점프하고 말풍선도 쓰면서 숨어 보세요. 후반에는 10초 부스터 1회!`
  :'학생과 스파이는 외형으로 구분할 수 없습니다. 행동을 관찰하세요. 일반 학생 3회 오인 시 탈락하지만 스파이 검거 시 ❤️❤️❤️ 완전 회복!';
}
function openPlayerGame(){
 document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
 $('playerGame').style.display='block';started=true;socket.emit('requestNPCs');
}
function resumeSavedSession(){
 const sess=loadSession();if(!sess||mode==='teacher')return;
 socket.emit('resumeSession',sess,r=>{
  if(!r?.ok){clearSession();return;}
  mode='student';roomCode=sess.code;meId=r.id;
  if(r.state)applyState(r.state);
  if(r.started&&r.role){applyRoleUI(r.role,r.teammates||[]);openPlayerGame();toast('다시 연결되었습니다!')}
  else{$('waitCode').textContent=roomCode;showScreen('studentWait')}
 });
}


$('createRoom').onclick=()=>{mode='teacher';socket.emit('createRoom',{spies:+$('spies').value,minutes:+$('mins').value},r=>{if(!r.ok)return alert(r.error||'방 생성 실패');roomCode=r.code;$('roomCode').textContent=r.code;const u=buildJoinUrl(r.code);$('joinQr').src=`/api/qr?room=${encodeURIComponent(r.code)}`;$('joinUrlText').textContent=u;showScreen('teacherLobby')})};
$('joinRoom').onclick=()=>{mode='student';const code=$('joinCode').value.trim();const nick=$('nickname').value.trim();socket.emit('joinRoom',{code,nick},r=>{if(!r.ok){$('joinMessage').textContent=r.error;return}meId=r.id;roomCode=code;saveSession({code,playerId:r.id,reconnectToken:r.reconnectToken,nick});$('waitCode').textContent=roomCode;showScreen('studentWait')})};
$('startGame').onclick=()=>socket.emit('startGame',{code:roomCode},r=>{if(!r.ok)alert(r.error)});
$('copyJoinLink').onclick=async()=>{try{await navigator.clipboard.writeText(buildJoinUrl(roomCode));$('copyJoinLink').textContent='복사됨!';setTimeout(()=>$('copyJoinLink').textContent='참가 링크 복사',1200)}catch{prompt('이 링크를 복사하세요.',buildJoinUrl(roomCode))}};

socket.on('lobby',r=>{if(mode==='teacher'){$('joinCount').textContent=`참가 ${r.players.length}명`;$('joinList').innerHTML=r.players.map(p=>`<span class="chip">${p.nick}</span>`).join('')}});
socket.on('role',r=>{applyRoleUI(r.role,r.teammates||[]);showScreen('roleScreen')});

$('enterGame').onclick=openPlayerGame;
socket.on('teacherGameStarted',s=>{if(mode!=='teacher')return;document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));$('teacherGame').style.display='block';started=true;applyState(s);socket.emit('teacherRequestState',{code:roomCode})});
socket.on('teacherState',s=>{if(mode==='teacher'){applyState(s);npcs=s.npcs||[]}});

function applyState(s){timeLeft=s.timeLeft??timeLeft;totalTime=s.total??s.minutes*60??totalTime;(s.players||[]).forEach(p=>players[p.id]=p)}
socket.on('state',applyState);
socket.on('clock',c=>{timeLeft=c.timeLeft;totalTime=c.total});
socket.on('playerMoved',p=>{players[p.id]={...(players[p.id]||{}),...p}});
socket.on('autoFloorChanged',e=>{
 if(players[meId])Object.assign(players[meId],{floor:e.floor,x:e.x,y:e.y});
 toast(e.direction==='up'?`▲ ${e.floor}층으로 올라왔습니다!`:`▼ ${e.floor}층으로 내려왔습니다!`)
});
socket.on('playerJumped',e=>{if(players[e.id]){players[e.id].jumpStart=e.jumpStart;players[e.id].jumpUntil=e.jumpUntil}});
socket.on('playerBubble',e=>{if(players[e.id]){players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil}});
socket.on('npcState',arr=>{npcs=arr.map(n=>({...npcs.find(x=>x.id===n.id),...n}))});
socket.on('swingResult',r=>{whoosh();if(r.kind==='hit')setTimeout(thump,35)});
socket.on('wrongHit',e=>{const target=e.type==='npc'?npcs.find(n=>n.id===e.targetId):players[e.targetId];if(target){target.bubble=e.text;target.bubbleUntil=Date.now()+1800}if(e.by===meId)toast(`❌ 오인 공격 ${e.miss}/3`)});
socket.on('spyCaught',e=>{if(players[e.spyId]){players[e.spyId].alive=false;players[e.spyId].ghost=true;players[e.spyId].revealed=true;players[e.spyId].bubble='정체가 들켰다!';players[e.spyId].bubbleUntil=Date.now()+1800}if(e.by===meId){players[meId].miss=0;toast('🎯 스파이 검거! ❤️❤️❤️ 완전 회복!')}});
socket.on('lifeReset',()=>{if(players[meId])players[meId].miss=0;toast('❤️❤️❤️ 생명 완전 회복!')});
socket.on('policeOut',e=>{if(players[e.id]){players[e.id].alive=false;players[e.id].ghost=true}});
socket.on('boosted',e=>{if(players[e.id]){players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil;players[e.id].boostUsed=true}if(e.id===meId){boostUntil=e.until;boostUsed=true;toast('🚀 부스터 10초 발동!')}});
socket.on('gameEnded',e=>{$('playerGame').style.display='none';$('teacherGame').style.display='none';$('endTitle').textContent=e.winner==='spy'?'🕵️ 스파이 승리!':'🚔 경찰 승리!';$('endText').textContent=e.reason;showScreen('endScreen')});
socket.on('roomClosed',()=>{alert('교사가 방을 종료했습니다.');location.reload()});

$('attackBtn').onclick=attack;
function attack(){if(!started||myRole!=='police'||!players[meId]?.alive)return;swingT=.22;socket.emit('hitAttempt')}
$('boostBtn').onclick=()=>socket.emit('useBoost');
$('jumpBtn').onclick=jump;
function jump(){if(!started||!players[meId])return;const p=players[meId],now=Date.now();if((p.jumpUntil||0)>now)return;p.jumpStart=now;p.jumpUntil=now+650;socket.emit('jump')}
$('chatToggle').onclick=()=>$('chatMenu').classList.toggle('open');
document.querySelectorAll('#chatMenu [data-msg]').forEach(b=>b.onclick=()=>{
  sendChat(b.dataset.msg);$('chatMenu').classList.remove('open');
});
$('chatSend').onclick=()=>{sendChat($('chatInput').value);$('chatInput').value='';$('chatMenu').classList.remove('open')};
$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.stopPropagation();e.preventDefault();$('chatSend').click()}});
function sendChat(text){
  text=String(text||'').trim().slice(0,24);if(!text||!started)return;
  socket.emit('playerChat',{text});
}


addEventListener('keydown',e=>{
 keys[e.key.toLowerCase()]=true;
 if(e.code==='Space'){e.preventDefault();attack()}
 if(e.key.toLowerCase()==='f')jump()
});
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);

(function setupJoystick(){
 const base=$('joystickBase'),knob=$('joystickKnob');
 const move=e=>{
  if(!joy.active)return;
  const p=e.touches?e.touches[0]:e,r=base.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  let dx=p.clientX-cx,dy=p.clientY-cy,d=Math.hypot(dx,dy),max=42;
  if(d>max){dx=dx/d*max;dy=dy/d*max}
  knob.style.transform=`translate(${dx}px,${dy}px)`;joy.dx=dx/max;joy.dy=dy/max
 };
 base.addEventListener('touchstart',e=>{joy.active=true;move(e)},{passive:false});
 base.addEventListener('touchmove',move,{passive:false});
 base.addEventListener('touchend',()=>{joy.active=false;joy.dx=joy.dy=0;knob.style.transform='translate(0,0)'})
})();

function audioCtx(){if(!window._ac)window._ac=new (window.AudioContext||window.webkitAudioContext)();return window._ac}
function whoosh(){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain();o.type='sawtooth';o.frequency.setValueAtTime(650,ac.currentTime);o.frequency.exponentialRampToValueAtTime(120,ac.currentTime+.12);v.gain.setValueAtTime(.07,ac.currentTime);v.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.13);o.connect(v).connect(ac.destination);o.start();o.stop(ac.currentTime+.14)}catch{}}
function thump(){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain();o.type='square';o.frequency.setValueAtTime(110,ac.currentTime);o.frequency.exponentialRampToValueAtTime(45,ac.currentTime+.09);v.gain.setValueAtTime(.13,ac.currentTime);v.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.12);o.connect(v).connect(ac.destination);o.start();o.stop(ac.currentTime+.13)}catch{}}

function jumpOffset(o){
 const now=Date.now(),start=o?.jumpStart||0,end=o?.jumpUntil||0;
 if(now<start||now>end||end<=start)return 0;
 return Math.sin(Math.PI*((now-start)/(end-start)))*34
}
function rounded(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.stroke()}}
function drawDesk(ctx,x,y){rounded(ctx,x,y,68,35,5,'#c58d55','#875d38');ctx.fillStyle='#79512f';ctx.fillRect(x+6,y+35,6,12);ctx.fillRect(x+56,y+35,6,12)}
function drawLockerBank(ctx,x,y,count=6){for(let i=0;i<count;i++){ctx.fillStyle=i%2?'#91b5c9':'#84a9bd';ctx.fillRect(x+i*31,y,28,66);ctx.strokeStyle='#526f7d';ctx.strokeRect(x+i*31,y,28,66);ctx.fillStyle='#dce7ec';ctx.beginPath();ctx.arc(x+i*31+21,y+34,2,0,Math.PI*2);ctx.fill()}}
function drawPlant(ctx,x,y){ctx.fillStyle='#9a673c';ctx.fillRect(x-10,y,20,18);ctx.fillStyle='#4b8d54';for(let i=0;i<5;i++){ctx.beginPath();ctx.ellipse(x+(i-2)*5,y-8-Math.abs(i-2)*4,7,15,(i-2)*.2,0,Math.PI*2);ctx.fill()}}

function drawSchool(ctx,floor){
 const grad=ctx.createLinearGradient(0,0,0,MAP.h);grad.addColorStop(0,'#eef4ef');grad.addColorStop(1,'#d8dfd5');ctx.fillStyle=grad;ctx.fillRect(0,0,MAP.w,MAP.h);
 ctx.fillStyle='#a9c3d2';ctx.fillRect(0,480,MAP.w,400);ctx.fillStyle='#8faeba';ctx.fillRect(0,660,MAP.w,55);
 for(let x=0;x<MAP.w;x+=90){ctx.strokeStyle='rgba(255,255,255,.22)';ctx.beginPath();ctx.moveTo(x,480);ctx.lineTo(x,880);ctx.stroke()}

 const labels={
  1:['1-1 교실','1-2 교실','행정실','급식실','도서관','보건실'],
  2:['2-1 교실','컴퓨터실','과학실','영어실','미술실','교무실'],
  3:['3-1 교실','방송실','음악실','회의실','상담실','자료실']
 }[floor],xs=[70,755,1440],ys=[70,930];

 let idx=0;
 for(const y of ys)for(const x of xs){
  ctx.fillStyle='#fff9e9';ctx.fillRect(x,y,600,300);ctx.strokeStyle='#66736e';ctx.lineWidth=7;ctx.strokeRect(x,y,600,300);
  ctx.fillStyle='#4b605b';ctx.fillRect(x,y,600,44);ctx.fillStyle='#fff';ctx.font='bold 20px sans-serif';ctx.fillText(labels[idx],x+18,y+29);
  for(let k=0;k<3;k++){ctx.fillStyle='#bde0ef';ctx.fillRect(x+350+k*70,y+62,58,62);ctx.strokeStyle='#7fa4b1';ctx.strokeRect(x+350+k*70,y+62,58,62)}

  if(labels[idx].includes('도서관')){
   ctx.fillStyle='#93673f';for(let s=0;s<4;s++)ctx.fillRect(x+50+s*130,y+85,88,115);ctx.fillStyle='#5e8a5b';ctx.fillRect(x+60,y+225,470,25)
  }else if(labels[idx].includes('컴퓨터')){
   for(let r=0;r<2;r++)for(let c=0;c<4;c++){drawDesk(ctx,x+55+c*125,y+90+r*90);ctx.fillStyle='#253747';ctx.fillRect(x+70+c*125,y+80+r*90,38,24)}
  }else if(labels[idx].includes('급식')){
   for(let r=0;r<2;r++){ctx.fillStyle='#d5b06d';ctx.fillRect(x+70,y+105+r*85,460,38)}
  }else{
   for(let r=0;r<2;r++)for(let c=0;c<4;c++)drawDesk(ctx,x+55+c*125,y+90+r*82)
  }
  drawPlant(ctx,x+545,y+250);
  ctx.fillStyle='#8d5c3d';ctx.fillRect(x+268,y+(y<500?292:-10),66,18);idx++
 }

 drawLockerBank(ctx,475,555,8);drawLockerBank(ctx,1420,555,8);
 ctx.fillStyle='#f7e3a0';ctx.fillRect(910,535,380,85);ctx.strokeStyle='#a98d48';ctx.strokeRect(910,535,380,85);
 ctx.fillStyle='#654';ctx.font='bold 18px sans-serif';ctx.fillText('학교 알림판 · 오늘도 즐거운 하루!',940,585);
 ctx.fillStyle='#9e7046';ctx.fillRect(680,790,250,28);ctx.fillRect(1280,790,250,28);

 // stair blocks
 for(const x of [75,MAP.w-365]){
  rounded(ctx,x,555,290,245,18,'#38566b','#243a49');
  // upper portal
  rounded(ctx,x+20,575,250,78,12, floor<3?'#5f879d':'#445b67','#d7edf7');
  // lower portal
  rounded(ctx,x+20,705,250,78,12, floor>1?'#765c79':'#4c4550','#eaddeb');
  ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';
  ctx.fillText(floor<3?'▲ 위층으로':'▲ 막힘',x+78,625);
  ctx.fillText(floor>1?'▼ 아래층으로':'▼ 막힘',x+67,755);
 }
 ctx.fillStyle='#42565a';ctx.font='bold 30px sans-serif';ctx.fillText(`${floor}층 중앙 복도`,990,690);
 ctx.fillStyle='#e5f2f6';ctx.fillRect(400,825,170,45);ctx.fillRect(1630,825,170,45);ctx.fillStyle='#39596a';ctx.font='bold 17px sans-serif';ctx.fillText('🚻 화장실',438,854);ctx.fillText('🚻 화장실',1668,854)
}

function drawShadow(ctx,x,y,j){ctx.save();ctx.globalAlpha=.22*(1-j/60);ctx.fillStyle='#111';ctx.beginPath();ctx.ellipse(x,y+38,16+Math.max(0,j)*.12,6,0,0,Math.PI*2);ctx.fill();ctx.restore()}

function drawHair(ctx,x,y,a){
 ctx.fillStyle=a.hairColor||'#2d241e';
 const h=a.hair||'short';
 if(h==='short'){ctx.beginPath();ctx.arc(x,y-23,11,Math.PI,Math.PI*2);ctx.fill()}
 else if(h==='side'){ctx.beginPath();ctx.arc(x-2,y-23,11,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x-10,y-25,7,11)}
 else if(h==='bob'){ctx.beginPath();ctx.arc(x,y-22,12,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x-11,y-23,5,15);ctx.fillRect(x+6,y-23,5,15)}
 else if(h==='spiky'){for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(x+i*5-4,y-20);ctx.lineTo(x+i*5,y-34-Math.abs(i)*2);ctx.lineTo(x+i*5+4,y-20);ctx.fill()}}
 else if(h==='cap'){ctx.beginPath();ctx.arc(x,y-24,11,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x,y-25,14,4)}
 else if(h==='ponytail'){ctx.beginPath();ctx.arc(x,y-23,11,Math.PI,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(x+13,y-20,6,0,Math.PI*2);ctx.fill()}
}

function drawStudentAppearance(ctx,x,y,a,jump,ghost=false){
 const ap=a||{skin:'#efbd98',shirt:'#3f78a9',pants:'#24313d',bag:'#7a4f33',hair:'short',hairColor:'#251c18'};
 drawShadow(ctx,x,y,jump);y-=jump;ctx.save();ctx.globalAlpha=ghost?.38:1;
 // backpack first
 ctx.fillStyle=ap.bag;ctx.fillRect(x-14,y-5,28,23);
 // face
 ctx.fillStyle=ap.skin;ctx.beginPath();ctx.arc(x,y-18,11,0,Math.PI*2);ctx.fill();
 drawHair(ctx,x,y,ap);
 // shirt
 ctx.fillStyle=ap.shirt;ctx.fillRect(x-11,y-7,22,29);
 // pants
 ctx.fillStyle=ap.pants;ctx.fillRect(x-10,y+22,8,19);ctx.fillRect(x+2,y+22,8,19);
 // arms
 ctx.strokeStyle=ap.skin;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x-10,y);ctx.lineTo(x-18,y+13);ctx.moveTo(x+10,y);ctx.lineTo(x+18,y+13);ctx.stroke();
 ctx.restore()
}

function drawPerson(ctx,x,y,opt={}){
 const{revealedSpy=false,police=false,ghost=false,name='',showName=false,jump=0,appearance=null}=opt;

 if(police){
  drawShadow(ctx,x,y,jump);y-=jump;ctx.save();ctx.globalAlpha=ghost?.38:1;
  ctx.fillStyle='#efbd98';ctx.beginPath();ctx.arc(x,y-18,11,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#253b51';ctx.beginPath();ctx.arc(x,y-23,10,Math.PI,Math.PI*2);ctx.fill();
  ctx.fillStyle='#244b78';ctx.fillRect(x-11,y-7,22,29);ctx.fillStyle='#1f2d38';ctx.fillRect(x-10,y+22,8,19);ctx.fillRect(x+2,y+22,8,19);
  ctx.fillStyle='#f4d03f';ctx.fillRect(x-5,y-30,10,5);
  if(ghost){ctx.globalAlpha=.9;ctx.font='20px sans-serif';ctx.fillText('👻',x-10,y-41)}
  ctx.restore();
 }else if(revealedSpy){
  drawShadow(ctx,x,y,jump);y-=jump;ctx.save();ctx.globalAlpha=ghost?.38:1;
  ctx.fillStyle='#222';ctx.beginPath();ctx.arc(x,y-18,11,0,Math.PI*2);ctx.fill();ctx.fillStyle='#111';ctx.beginPath();ctx.arc(x,y-23,10,Math.PI,Math.PI*2);ctx.fill();
  ctx.fillStyle='#661f1f';ctx.fillRect(x-11,y-7,22,29);ctx.fillStyle='#222';ctx.fillRect(x-10,y+22,8,19);ctx.fillRect(x+2,y+22,8,19);
  ctx.fillStyle='#e22';ctx.font='bold 11px sans-serif';ctx.fillText('SPY',x-12,y+9);
  if(ghost){ctx.globalAlpha=.9;ctx.font='20px sans-serif';ctx.fillText('👻',x-10,y-41)}
  ctx.restore();
 }else{
  // Critical rule: unrevealed spy and NPC use the exact same renderer.
  drawStudentAppearance(ctx,x,y,appearance,jump,ghost);
 }

 if(showName&&name){ctx.save();ctx.fillStyle=revealedSpy?'#8b0016':'#172228';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(name,x,y-jump-43);ctx.restore()}
}

function bubble(ctx,o){
 if(!o?.bubble||o.bubbleUntil<Date.now())return;
 const j=jumpOffset(o),yy=o.y-j;ctx.font='bold 13px sans-serif';const w=ctx.measureText(o.bubble).width+18;
 ctx.fillStyle='#fff';ctx.strokeStyle='#26343d';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(o.x-w/2,yy-73,w,29,8);ctx.fill();ctx.stroke();ctx.fillStyle='#222';ctx.fillText(o.bubble,o.x-w/2+9,yy-53)
}

function loop(t){
 const dt=Math.min(.035,(t-last)/1000);last=t;
 if(started&&mode==='student'&&players[meId]){
  const p=players[meId];let dx=0,dy=0;
  if(keys.w||keys.arrowup)dy--;if(keys.s||keys.arrowdown)dy++;if(keys.a||keys.arrowleft)dx--;if(keys.d||keys.arrowright)dx++;
  if(Math.abs(joy.dx)+Math.abs(joy.dy)>.05){dx=joy.dx;dy=joy.dy}
  if(dx||dy){
   const l=Math.hypot(dx,dy);dx/=l;dy/=l;angle=Math.atan2(dy,dx);
   const speed=(Date.now()<boostUntil?1.8:1)*(p.ghost?285:235);
   p.x=clamp(p.x+dx*speed*dt,20,MAP.w-20);p.y=clamp(p.y+dy*speed*dt,20,MAP.h-20);p.angle=angle;
   socket.emit('move',{x:p.x,y:p.y,angle:p.angle,floor:p.floor})
  }
  if(swingT>0)swingT-=dt;drawPlayerView()
 }
 if(started&&mode==='teacher')drawTeacherView();
 requestAnimationFrame(loop)
}
requestAnimationFrame(loop);

function drawPlayerView(){
 const p=players[meId];if(!p)return;
 cam.x=clamp(p.x-gameCanvas.width/2,0,Math.max(0,MAP.w-gameCanvas.width));cam.y=clamp(p.y-gameCanvas.height/2,0,Math.max(0,MAP.h-gameCanvas.height));
 g.clearRect(0,0,gameCanvas.width,gameCanvas.height);g.save();g.translate(-cam.x,-cam.y);drawSchool(g,p.floor);

 for(const n of npcs.filter(n=>n.floor===p.floor)){drawPerson(g,n.x,n.y,{appearance:n.appearance,jump:jumpOffset(n)});bubble(g,n)}

 for(const q of Object.values(players).filter(q=>q.floor===p.floor)){
  const police=q.role==='police';
  const unrevealedSpy=q.role==='spy'&&!q.revealed;
  drawPerson(g,q.x,q.y,{
   revealedSpy:q.revealed,police,ghost:q.ghost,name:q.nick,
   showName:myRole==='spy'&&q.role==='spy'&&q.alive,
   jump:jumpOffset(q),
   appearance:unrevealedSpy?q.appearance:q.appearance
  });
  bubble(g,q)
 }

 if(myRole==='police'&&p.alive){
  const j=jumpOffset(p);g.save();g.translate(p.x,p.y-j);let a=p.angle||angle;
  if(swingT>0){const prog=1-swingT/.22;a+=-1.05+prog*2}
  g.rotate(a);g.fillStyle='#6c4020';g.fillRect(13,-4,55,8);g.restore()
 }
 g.restore();

 $('timerHud').textContent=fmt(timeLeft);$('floorHud').textContent=`${p.floor}층`;
 $('spyHud').textContent=`스파이 ${Object.values(players).filter(x=>x.role==='spy'&&x.alive).length}`;
 $('jumpBtn').style.display='block';

 if(myRole==='police'){
  $('roleHud').textContent=`🚔 ${'❤️'.repeat(Math.max(0,3-(p.miss||0)))}${'🖤'.repeat(Math.min(3,p.miss||0))}`;
  $('attackBtn').style.display='block';$('boostBtn').style.display='none'
 }else{
  $('roleHud').textContent=p.ghost?'🕵️👻 유령':'🕵️ 스파이';$('attackBtn').style.display='none';
  $('boostBtn').style.display=(p.alive&&timeLeft<=totalTime/2&&!boostUsed)?'block':'none'
 }
}

function drawTeacherView(){
 tg.clearRect(0,0,teacherCanvas.width,teacherCanvas.height);
 const scale=Math.min(teacherCanvas.width/MAP.w,teacherCanvas.height/MAP.h)*.92,ox=(teacherCanvas.width-MAP.w*scale)/2,oy=(teacherCanvas.height-MAP.h*scale)/2;
 tg.save();tg.translate(ox,oy);tg.scale(scale,scale);drawSchool(tg,selectedTeacherFloor);

 for(const n of npcs.filter(n=>n.floor===selectedTeacherFloor))drawPerson(tg,n.x,n.y,{appearance:n.appearance,jump:jumpOffset(n)});
 for(const p of Object.values(players).filter(p=>p.floor===selectedTeacherFloor)){
  drawPerson(tg,p.x,p.y,{
   revealedSpy:p.role==='spy',police:p.role==='police',ghost:p.ghost,name:p.nick,showName:true,
   jump:jumpOffset(p),appearance:p.appearance
  })
 }
 tg.restore();

 $('teacherTimer').textContent=fmt(timeLeft);
 $('teacherStats').textContent=`경찰 ${Object.values(players).filter(p=>p.role==='police'&&p.alive).length}명 · 스파이 ${Object.values(players).filter(p=>p.role==='spy'&&p.alive).length}명 · 학생 ${npcs.length}명`
}
document.querySelectorAll('#floorTabs button').forEach(b=>b.onclick=()=>selectedTeacherFloor=+b.dataset.floor);


// QR 참가 링크로 열면 방 코드를 자동 입력하고 학생 참가 화면을 연다.
(function initJoinFromUrl(){
 const q=new URLSearchParams(location.search),room=q.get('room');
 if(room){$('joinCode').value=room.replace(/\D/g,'').slice(0,4);mode='student';showScreen('studentJoin')}
})();

// 화면 잠금, 네트워크 전환, 새로고침 뒤에도 저장된 참가 정보로 복귀한다.
socket.on('connect',()=>{setTimeout(resumeSavedSession,80)});
setTimeout(resumeSavedSession,250);
