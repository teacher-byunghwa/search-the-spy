const socket=io();
const MAP={w:3200,h:2000},SPEED=240;
let mode=null,roomCode='',meId=null,myRole=null,teammates=[],players={},npcs=[],started=false,timeLeft=0,totalTime=1,currentPhase='lobby';
let selectedTeacherFloor=1,keys={},angle=0,boostUntil=0,swingT=0,last=performance.now(),cam={x:0,y:0},joy={pointerId:null,dx:0,dy:0};
let latestScores=[],pendingJoin=null,revealCountdown=null,feed=[],teacherZoom=1,teacherPan={x:0,y:0},dragState=null,localPortalCooldown=0;
const $=id=>document.getElementById(id),gameCanvas=$('gameCanvas'),g=gameCanvas.getContext('2d'),teacherCanvas=$('teacherCanvas'),tg=teacherCanvas.getContext('2d');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const SESSION_KEY='spySchoolStudentSessionV12';

function resize(){gameCanvas.width=innerWidth;gameCanvas.height=innerHeight;teacherCanvas.width=innerWidth;teacherCanvas.height=innerHeight}
addEventListener('resize',resize);resize();
function saveSession(d){localStorage.setItem(SESSION_KEY,JSON.stringify(d))}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function fmt(t){t=Math.max(0,t||0);return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`}
function buildJoinUrl(c){return `${location.origin}/?room=${encodeURIComponent(c)}`}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function audioCtx(){if(!window._ac)window._ac=new (window.AudioContext||window.webkitAudioContext)();try{window._ac.resume()}catch{}return window._ac}
function tone(freq=440,dur=.12,type='sine',gain=.05,delay=0){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain(),t=ac.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);v.gain.setValueAtTime(gain,t);v.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(v).connect(ac.destination);o.start(t);o.stop(t+dur+.02)}catch{}}
function sceneSound(k='move'){if(k==='start'){tone(480,.1,'sine',.06);tone(680,.12,'sine',.06,.1);tone(920,.18,'sine',.06,.22)}else if(k==='floor'){tone(560,.08,'sine',.05);tone(780,.1,'sine',.05,.07)}else if(k==='end'){tone(660,.16,'triangle',.06);tone(520,.18,'triangle',.06,.16)}else tone(430,.07,'sine',.035)}
function whoosh(){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain();o.type='sawtooth';o.frequency.setValueAtTime(650,ac.currentTime);o.frequency.exponentialRampToValueAtTime(120,ac.currentTime+.12);v.gain.setValueAtTime(.07,ac.currentTime);v.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.13);o.connect(v).connect(ac.destination);o.start();o.stop(ac.currentTime+.14)}catch{}}
function thump(){tone(105,.11,'square',.11)}

function showScreen(id,quiet=false){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');if(!quiet)sceneSound()}
window.showScreen=showScreen;
function toast(t){$('toast').textContent=t;$('toast').style.opacity=1;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.opacity=0,1400)}
function setPlayerGameVisible(on){$('playerGame').style.display=on?'block':'none'}
function setTeacherGameVisible(on){$('teacherGame').style.display=on?'block':'none'}

function myScore(){const p=players[meId];if(p&&Number.isFinite(p.score))return p.score;return latestScores.find(x=>x.id===meId)?.score||0}
function renderScores(id){const el=$(id);if(!el)return;el.innerHTML=(latestScores||[]).map((p,i)=>`<div class="scoreRow"><span>${i+1}</span><b>${escapeHtml(p.nick)}</b><b>⭐ ${p.score}</b></div>`).join('')}
function updateScoreUI(){$('scoreHud').textContent=`⭐ ${myScore()}`;renderScores('teacherScoreBoard');renderScores('lobbyScores');renderScores('endScores')}
function addFeed(item){feed.push(item);if(feed.length>7)feed.shift();$('feedList').innerHTML=feed.map(x=>`<div class="feedItem ${x.kind}">${x.kind==='chat'?`<b>${escapeHtml(x.nick)}</b>: ${escapeHtml(x.text)}`:`☠ ${escapeHtml(x.nick)} · ${escapeHtml(x.text)}`}</div>`).join('')}

function applyState(s){
 currentPhase=s.phase??currentPhase;timeLeft=s.timeLeft??timeLeft;totalTime=s.total??s.minutes*60??totalTime;
 (s.players||[]).forEach(p=>{
  const old=players[p.id]||{};
  players[p.id]={...old,...p,rx:old.rx??p.x,ry:old.ry??p.y};
 });
}
function applyRoleUI(role,mates=[]){myRole=role;teammates=mates||[]}

function openPlayerWorld(){
 document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));setTeacherGameVisible(false);setPlayerGameVisible(true);started=true;socket.emit('requestNPCs');
 $('lobbyNotice').style.display=currentPhase==='lobby'?'block':'none';
}
function openTeacherWorld(){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));setPlayerGameVisible(false);setTeacherGameVisible(true);started=true}

function showTeamReveal(seconds=10){
 clearInterval(revealCountdown);
 $('teamRevealOverlay').classList.add('open');
 $('revealRoleTitle').textContent=myRole==='spy'?'🕵️ 스파이팀':'🚔 경찰팀';
 const list=(teammates||[]).map(x=>`<span class="teamMember">${escapeHtml(x.nick)}${x.id===meId?' (나)':''}</span>`).join('');
 $('revealTeamList').innerHTML=list||'<span class="teamMember">나</span>';
 let n=seconds;$('revealSeconds').textContent=n;tone(650,.08,'square',.03);
 revealCountdown=setInterval(()=>{n--;$('revealSeconds').textContent=Math.max(0,n);if(n>0)tone(650,.05,'square',.02);else clearInterval(revealCountdown)},1000);
}
function showTeacherReveal(seconds=10){
 $('teamRevealOverlay').classList.add('open');$('revealRoleTitle').textContent='학생들이 팀원을 확인 중입니다';$('revealTeamList').innerHTML='<span class="teamMember">잠시 후 게임이 시작됩니다.</span>';
 let n=seconds;$('revealSeconds').textContent=n;clearInterval(revealCountdown);revealCountdown=setInterval(()=>{n--;$('revealSeconds').textContent=Math.max(0,n);if(n<=0)clearInterval(revealCountdown)},1000)
}
function hideRevealAndGo(){
 $('teamRevealOverlay').classList.remove('open');$('goOverlay').classList.add('open');sceneSound('start');
 setTimeout(()=>$('goOverlay').classList.remove('open'),900);
}

$('createRoom').onclick=()=>{mode='teacher';audioCtx();socket.emit('createRoom',{spies:+$('spies').value,minutes:+$('mins').value},r=>{if(!r.ok)return alert(r.error);roomCode=r.code;$('roomCode').textContent=r.code;const u=buildJoinUrl(r.code);$('joinQr').src=`/api/qr?room=${r.code}`;$('joinUrlText').textContent=u;$('qrModalImage').src=`/api/qr?room=${r.code}`;$('qrModalUrl').textContent=u;showScreen('teacherLobby')})};
$('joinRoom').onclick=()=>{audioCtx();const code=$('joinCode').value.trim(),nick=$('nickname').value.trim();if(!code||!nick){$('joinMessage').textContent='방 코드와 닉네임을 입력하세요.';return}pendingJoin={code,nick};$('characterModal').classList.add('open')};
document.querySelectorAll('.characterChoice').forEach(b=>b.onclick=()=>{const gender=b.dataset.gender;$('characterModal').classList.remove('open');const{code,nick}=pendingJoin||{};if(!code||!nick)return;mode='student';socket.emit('joinRoom',{code,nick,gender},r=>{if(!r.ok){$('joinMessage').textContent=r.error;return}meId=r.id;roomCode=code;saveSession({code,playerId:r.id,reconnectToken:r.reconnectToken,nick});if(r.state)applyState(r.state);openPlayerWorld();updateScoreUI();toast('입장 완료! 친구들을 기다려 보세요.')})});
$('cancelCharacter').onclick=()=>$('characterModal').classList.remove('open');
$('startGame').onclick=()=>socket.emit('startGame',{code:roomCode},r=>{if(!r.ok)alert(r.error)});
$('restartGameBtn').onclick=()=>socket.emit('restartGame',{code:roomCode},r=>{if(!r.ok)alert(r.error)});
$('copyJoinLink').onclick=async()=>{try{await navigator.clipboard.writeText(buildJoinUrl(roomCode));toast('링크 복사 완료')}catch{prompt('복사하세요',buildJoinUrl(roomCode))}};
function openQrModal(){$('qrModalImage').src=`/api/qr?room=${roomCode}`;$('qrModalUrl').textContent=buildJoinUrl(roomCode);$('qrModal').classList.add('open')}
$('showQrInGame').onclick=openQrModal;$('endQrBtn').onclick=openQrModal;$('closeQrModal').onclick=()=>$('qrModal').classList.remove('open');

socket.on('lobby',r=>{if(mode==='teacher'){$('joinCount').textContent=`참가 ${r.players.length}명`;$('joinList').innerHTML=r.players.map(p=>`<span class="chip">${escapeHtml(p.nick)}${p.connected?'':' (연결끊김)'}</span>`).join('')}});

socket.on('scoreBoard',s=>{latestScores=s||[];(s||[]).forEach(x=>{if(players[x.id])players[x.id].score=x.score});updateScoreUI()});
socket.on('state',applyState);
socket.on('clock',c=>{timeLeft=c.timeLeft;totalTime=c.total});
socket.on('playerMoved',p=>{const old=players[p.id]||{};players[p.id]={...old,...p,rx:old.rx??p.x,ry:old.ry??p.y}});
socket.on('npcState',arr=>{npcs=arr.map(n=>{const old=npcs.find(x=>x.id===n.id)||{};return{...old,...n,rx:old.rx??n.x,ry:old.ry??n.y}})});
socket.on('playerJumped',e=>{if(players[e.id]){players[e.id].jumpStart=e.jumpStart;players[e.id].jumpUntil=e.jumpUntil}});
socket.on('playerBubble',e=>{if(players[e.id]){players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil}});
socket.on('chatFeed',addFeed);

socket.on('role',r=>{applyRoleUI(r.role,r.teammates||[])});
socket.on('teamRevealStarted',e=>{
 currentPhase='reveal';$('lobbyNotice').style.display='none';
 if(mode==='student'){openPlayerWorld();showTeamReveal(e.seconds||10)}else if(mode==='teacher'){openTeacherWorld();showTeacherReveal(e.seconds||10)}
});
socket.on('teacherGameStarted',s=>{if(mode!=='teacher')return;applyState(s);npcs=s.npcs||[];openTeacherWorld();socket.emit('teacherRequestState',{code:roomCode})});
socket.on('teacherState',s=>{if(mode==='teacher'){applyState(s);npcs=s.npcs||[]}});
socket.on('gameStarted',()=>{currentPhase='playing';started=true;hideRevealAndGo();$('lobbyNotice').style.display='none'});
socket.on('swingResult',r=>{whoosh();if(r.kind==='hit')setTimeout(thump,35)});
socket.on('wrongHit',e=>{const t=e.type==='npc'?npcs.find(n=>n.id===e.targetId):players[e.targetId];if(t){t.bubble=e.text;t.bubbleUntil=Date.now()+1800}if(e.by===meId)toast(`❌ 오인 공격 ${e.miss}/3`)});
socket.on('spyCaught',e=>{if(players[e.spyId]){players[e.spyId].alive=false;players[e.spyId].ghost=true;players[e.spyId].revealed=true}if(e.by===meId){players[meId].miss=0;toast('🎯 스파이 검거! ❤️❤️❤️ 완전 회복!')}});
socket.on('lifeReset',()=>{if(players[meId])players[meId].miss=0});
socket.on('policeOut',e=>{if(players[e.id]){players[e.id].alive=false;players[e.id].ghost=true}});
socket.on('boosted',e=>{if(players[e.id]){players[e.id].boostUntil=e.until;players[e.id].boostUsed=true;players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil}if(e.id===meId){boostUntil=e.until;toast('🚀 부스터 10초!')}});
socket.on('gameEnded',e=>showEnd(e));
socket.on('roomClosed',()=>{alert('교사가 방을 종료했습니다.');clearSession();location.reload()});

function showEnd(e){
 started=false;setPlayerGameVisible(false);setTeacherGameVisible(false);currentPhase='ended';
 if(e?.scores){latestScores=e.scores;e.scores.forEach(s=>{if(players[s.id])players[s.id].score=s.score})}
 $('endTitle').textContent=e.winner==='spy'?'🕵️ 스파이팀 승리!':'🚔 경찰팀 승리!';$('endText').textContent=e.reason;
 $('myEndScore').textContent=mode==='student'?`내 누적 점수: ⭐ ${myScore()}점`:'';
 $('teacherEndActions').style.display=mode==='teacher'?'flex':'none';$('studentEndWait').style.display=mode==='student'?'block':'none';updateScoreUI();showScreen('endScreen',true);sceneSound('end');
}

$('attackBtn').addEventListener('pointerdown',e=>{e.preventDefault();attack()});
function attack(){if(currentPhase!=='playing'||myRole!=='police'||!players[meId]?.alive)return;swingT=.22;socket.emit('hitAttempt')}
$('boostBtn').addEventListener('pointerdown',e=>{e.preventDefault();socket.emit('useBoost')});
$('jumpBtn').addEventListener('pointerdown',e=>{e.preventDefault();jump()});
function jump(){if(!['lobby','playing'].includes(currentPhase)||!players[meId])return;const p=players[meId],now=Date.now();if((p.jumpUntil||0)>now)return;p.jumpStart=now;p.jumpUntil=now+650;socket.emit('jump')}

$('chatToggle').onclick=()=>$('chatMenu').classList.toggle('open');
document.querySelectorAll('#chatMenu [data-msg]').forEach(b=>b.onclick=()=>{sendChat(b.dataset.msg);$('chatMenu').classList.remove('open')});
$('chatSend').onclick=()=>{sendChat($('chatInput').value);$('chatInput').value='';$('chatMenu').classList.remove('open')};
function sendChat(t){t=String(t||'').trim().slice(0,24);if(t)socket.emit('playerChat',{text:t})}

addEventListener('keydown',e=>{if(document.activeElement===$('chatInput'))return;keys[e.key.toLowerCase()]=true;if(e.code==='Space'){e.preventDefault();attack()}if(e.key.toLowerCase()==='f')jump()});
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);

(function setupJoystick(){
 const base=$('joystickBase'),knob=$('joystickKnob');
 function setFrom(e){
   const r=base.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
   let dx=e.clientX-cx,dy=e.clientY-cy,d=Math.hypot(dx,dy),max=r.width*.35;
   if(d>max){dx=dx/d*max;dy=dy/d*max}
   joy.dx=dx/max;joy.dy=dy/max;knob.style.transform=`translate(${dx}px,${dy}px)`;
 }
 base.addEventListener('pointerdown',e=>{
   e.preventDefault();if(joy.pointerId!==null)return;joy.pointerId=e.pointerId;base.setPointerCapture(e.pointerId);setFrom(e);
 });
 base.addEventListener('pointermove',e=>{if(e.pointerId!==joy.pointerId)return;e.preventDefault();setFrom(e)});
 function end(e){if(e.pointerId!==joy.pointerId)return;e.preventDefault();joy.pointerId=null;joy.dx=joy.dy=0;knob.style.transform='translate(0,0)'}
 base.addEventListener('pointerup',end);base.addEventListener('pointercancel',end);base.addEventListener('lostpointercapture',e=>{if(e.pointerId===joy.pointerId){joy.pointerId=null;joy.dx=joy.dy=0;knob.style.transform='translate(0,0)'}});
})();

function jumpOffset(o){const now=Date.now(),s=o?.jumpStart||0,e=o?.jumpUntil||0;if(now<s||now>e||e<=s)return 0;return Math.sin(Math.PI*((now-s)/(e-s)))*40}
const ROOM_WALLS=(()=>{
 const a=[],xs=[130,1110,2090],topY=90,bottomY=1510,w=820,h=360,t=18,door=100;
 for(const x of xs){
  a.push({x,y:topY,w,h:t},{x,y:topY,w:t,h},{x:x+w-t,y:topY,w:t,h});
  let dg=x+w/2-door/2;a.push({x,y:topY+h-t,w:dg-x,h:t},{x:dg+door,y:topY+h-t,w:x+w-(dg+door),h:t});
  a.push({x,y:bottomY,w,h:t},{x,y:bottomY,w:t,h},{x:x+w-t,y:bottomY,w:t,h});
  dg=x+w/2-door/2;a.push({x,y:bottomY,w:dg-x,h:t},{x:dg+door,y:bottomY,w:x+w-(dg+door),h:t});
 }return a;
})();
const OUTDOOR_SOLIDS=[{x:1050,y:40,w:370,h:270},{x:1780,y:40,w:370,h:270}];
const FENCES=[{x:160,y:1120,w:920,h:14},{x:160,y:1820,w:920,h:14},{x:160,y:1120,w:14,h:714},{x:1066,y:1120,w:14,h:714}];
function hitRect(r,x,y,rad=18){return x+rad>r.x&&x-rad<r.x+r.w&&y+rad>r.y&&y-rad<r.y+r.h}
function canMoveLocal(p,nx,ny){
 if(nx<28||nx>MAP.w-28||ny<28||ny>MAP.h-28)return false;
 const jumping=Date.now()<(p.jumpUntil||0);
 if(p.floor>0)return !ROOM_WALLS.some(r=>hitRect(r,nx,ny));
 if(OUTDOOR_SOLIDS.some(r=>hitRect(r,nx,ny)))return false;
 if(!jumping&&FENCES.some(r=>hitRect(r,nx,ny)))return false;
 return true;
}
function checkPortalLocal(p){
 if(currentPhase!=='playing'||Date.now()<localPortalCooldown)return;
 // compact stairs
 const left=p.x>=135&&p.x<=225,right=p.x>=2975&&p.x<=3065;
 if(p.floor>0&&(left||right)){
  const side=left?'left':'right';
  if(p.y>=675&&p.y<=709&&p.floor<3){p.floor++;p.x=side==='left'?315:MAP.w-315;p.y=795;transitionLocal(p,`${p.floor}층`);return}
  if(p.y>=780&&p.y<=814&&p.floor>1){p.floor--;p.x=side==='left'?315:MAP.w-315;p.y=690;transitionLocal(p,`${p.floor}층`);return}
 }
 if(p.floor===1&&p.x>=1450&&p.x<=1750&&p.y>=1920){p.floor=0;p.x=1600;p.y=350;transitionLocal(p,'운동장');return}
 if(p.floor===0&&p.x>=1450&&p.x<=1750&&p.y<=180){p.floor=1;p.x=1600;p.y=1860;transitionLocal(p,'1층');}
}
function transitionLocal(p,label){localPortalCooldown=Date.now()+700;sceneSound('floor');toast(`📍 ${label}`);socket.emit('portalTransition',{floor:p.floor,x:p.x,y:p.y,label})}

function lerpEntities(dt){
 const f=Math.min(1,dt*14);
 for(const p of Object.values(players)){if(p.id===meId){p.rx=p.x;p.ry=p.y}else{p.rx=(p.rx??p.x)+(p.x-(p.rx??p.x))*f;p.ry=(p.ry??p.y)+(p.y-(p.ry??p.y))*f}}
 for(const n of npcs){n.rx=(n.rx??n.x)+(n.x-(n.rx??n.x))*f;n.ry=(n.ry??n.y)+(n.y-(n.ry??n.y))*f}
}
function pos(o){return{x:o.rx??o.x,y:o.ry??o.y}}

function rounded(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.stroke()}}
function drawEyes(ctx,x,y){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x-4,y-19,3.5,0,Math.PI*2);ctx.arc(x+4,y-19,3.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#121a20';ctx.beginPath();ctx.arc(x-4,y-19,1.7,0,Math.PI*2);ctx.arc(x+4,y-19,1.7,0,Math.PI*2);ctx.fill()}
function drawHair(ctx,x,y,a){ctx.fillStyle=a?.hairColor||'#2d241e';const h=a?.hair||'short';if(h==='bob'||h==='long'){ctx.beginPath();ctx.arc(x,y-24,13,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x-12,y-24,5,h==='long'?27:18);ctx.fillRect(x+7,y-24,5,h==='long'?27:18)}else if(h==='ponytail'){ctx.beginPath();ctx.arc(x,y-24,12,Math.PI,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(x+14,y-20,6,0,Math.PI*2);ctx.fill()}else if(h==='spiky'){for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(x+i*5-4,y-21);ctx.lineTo(x+i*5,y-37);ctx.lineTo(x+i*5+4,y-21);ctx.fill()}}else{ctx.beginPath();ctx.arc(x,y-24,12,Math.PI,Math.PI*2);ctx.fill();if(h==='cap')ctx.fillRect(x,y-27,15,5)}}
function drawShadow(ctx,x,y,j){ctx.save();ctx.globalAlpha=.22*(1-j/70);ctx.fillStyle='#111';ctx.beginPath();ctx.ellipse(x,y+42,18,6,0,0,Math.PI*2);ctx.fill();ctx.restore()}
function drawStudent(ctx,x,y,a,j,ghost=false){const ap=a||{skin:'#efbd98',shirt:'#3f78a9',pants:'#24313d',bag:'#7a4f33',hair:'short',hairColor:'#251c18'};drawShadow(ctx,x,y,j);y-=j;ctx.save();ctx.globalAlpha=ghost?.38:1;rounded(ctx,x-15,y-4,30,24,6,ap.bag);ctx.fillStyle=ap.skin;ctx.beginPath();ctx.arc(x,y-20,12,0,Math.PI*2);ctx.fill();drawHair(ctx,x,y,ap);drawEyes(ctx,x,y);rounded(ctx,x-12,y-7,24,31,4,ap.shirt);ctx.fillStyle=ap.pants;ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.strokeStyle=ap.skin;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x-11,y);ctx.lineTo(x-19,y+14);ctx.moveTo(x+11,y);ctx.lineTo(x+19,y+14);ctx.stroke();if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-46)}ctx.restore()}
function drawPolice(ctx,x,y,j,ghost=false){drawShadow(ctx,x,y,j);y-=j;ctx.save();ctx.globalAlpha=ghost?.38:1;ctx.fillStyle='#efbd98';ctx.beginPath();ctx.arc(x,y-20,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#263b50';ctx.beginPath();ctx.arc(x,y-26,11,Math.PI,Math.PI*2);ctx.fill();drawEyes(ctx,x,y);rounded(ctx,x-12,y-7,24,31,4,'#244b78');ctx.fillStyle='#1f2d38';ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.fillStyle='#f4d03f';ctx.fillRect(x-5,y-33,10,5);if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-46)}ctx.restore()}
function drawSpy(ctx,x,y,j,ghost=false){drawShadow(ctx,x,y,j);y-=j;ctx.save();ctx.globalAlpha=ghost?.38:1;ctx.fillStyle='#292929';ctx.beginPath();ctx.arc(x,y-20,12,0,Math.PI*2);ctx.fill();drawEyes(ctx,x,y);rounded(ctx,x-12,y-7,24,31,4,'#661f1f');ctx.fillStyle='#222';ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.fillStyle='#e22';ctx.font='bold 11px sans-serif';ctx.fillText('SPY',x-12,y+10);if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-46)}ctx.restore()}
function drawBoost(ctx,x,y,p){
 if(Date.now()>+(p.boostUntil||0))return;
 ctx.save();const t=Date.now()/120;ctx.globalAlpha=.8;ctx.font='18px sans-serif';
 for(let i=0;i<3;i++){const ox=-24-i*13-Math.sin(t+i)*5,oy=10+(i-1)*10;ctx.fillText(i%2?'⚡':'💨',x+ox,y+oy)}ctx.restore()
}
function drawPerson(ctx,o,opt={}){
 const{x,y}=pos(o),j=jumpOffset(o);
 if(opt.police)drawPolice(ctx,x,y,j,o.ghost);else if(opt.revealed)drawSpy(ctx,x,y,j,o.ghost);else drawStudent(ctx,x,y,o.appearance,j,o.ghost);
 drawBoost(ctx,x,y,o);
 if(opt.name){ctx.save();ctx.fillStyle='#172228';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(opt.name,x,y-j-50);ctx.restore()}
}
function bubble(ctx,o){if(!o?.bubble||o.bubbleUntil<Date.now())return;const{x,y}=pos(o),j=jumpOffset(o),yy=y-j;ctx.font='bold 13px sans-serif';const w=ctx.measureText(o.bubble).width+18;ctx.fillStyle='#fff';ctx.strokeStyle='#26343d';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x-w/2,yy-80,w,30,8);ctx.fill();ctx.stroke();ctx.fillStyle='#222';ctx.fillText(o.bubble,x-w/2+9,yy-59)}

function drawClassroom(ctx,x,y,w,h,label,doorSide){
 // 2.5D shadow/extrusion
 ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(x+14,y+18,w,h);
 ctx.fillStyle='#fffaf0';ctx.fillRect(x,y,w,h);
 ctx.strokeStyle='#53666a';ctx.lineWidth=18;ctx.strokeRect(x,y,w,h);
 // top wall highlight
 ctx.strokeStyle='#91a5a8';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x+8,y+8);ctx.lineTo(x+w-8,y+8);ctx.stroke();
 ctx.fillStyle='#47605c';ctx.fillRect(x,y,w,48);ctx.fillStyle='#fff';ctx.font='bold 21px sans-serif';ctx.fillText(label,x+20,y+31);
 for(let k=0;k<5;k++){ctx.fillStyle='#aed8e9';ctx.fillRect(x+390+k*70,y+72,56,68);ctx.fillStyle='#fff8';ctx.fillRect(x+395+k*70,y+77,12,58)}
 for(let r=0;r<2;r++)for(let c=0;c<4;c++){rounded(ctx,x+70+c*145,y+145+r*88,78,36,5,'#d5a05f','#8b633f')}
 // door gap hint
 const dx=x+w/2-48;ctx.fillStyle='#8a5a3b';if(doorSide==='bottom')ctx.fillRect(dx,y+h-14,96,24);else ctx.fillRect(dx,y-10,96,24)
}
function drawSchool(ctx,floor){
 const bg=ctx.createLinearGradient(0,0,0,MAP.h);bg.addColorStop(0,'#eef7f9');bg.addColorStop(1,'#d8e3dd');ctx.fillStyle=bg;ctx.fillRect(0,0,MAP.w,MAP.h);
 ctx.fillStyle='#b8cbd5';ctx.fillRect(0,560,MAP.w,780);ctx.fillStyle='#98b2bf';ctx.fillRect(0,900,MAP.w,75);
 for(let y=580;y<1340;y+=60)for(let x=0;x<MAP.w;x+=90){ctx.strokeStyle='rgba(255,255,255,.22)';ctx.strokeRect(x,y,90,60)}
 const labels={1:['1-1 교실','1-2 교실','행정실','급식실','도서관','보건실'],2:['2-1 교실','컴퓨터실','과학실','영어실','미술실','교무실'],3:['3-1 교실','방송실','음악실','회의실','상담실','자료실']}[floor];
 const xs=[130,1110,2090];let i=0;for(const x of xs){drawClassroom(ctx,x,90,820,360,labels[i++],'bottom')}for(const x of xs){drawClassroom(ctx,x,1510,820,360,labels[i++],'top')}
 // lockers, plants, benches
 for(let i=0;i<14;i++){ctx.fillStyle=i%2?'#91b7c8':'#80a5b6';ctx.fillRect(560+i*32,650,29,78);ctx.strokeStyle='#52707c';ctx.strokeRect(560+i*32,650,29,78)}
 rounded(ctx,1200,635,800,105,12,'#f7e3a0','#a98d48');ctx.fillStyle='#654';ctx.font='bold 22px sans-serif';ctx.fillText('🏫 오늘도 즐겁고 안전한 학교생활!',1390,695);
 rounded(ctx,950,1225,330,34,7,'#9f7046','#6e4a2f');rounded(ctx,1940,1225,330,34,7,'#9f7046','#6e4a2f');
 // compact stair towers
 for(const x of [120,MAP.w-260]){ctx.fillStyle='rgba(0,0,0,.2)';rounded(ctx,x+9,645,140,230,15,'rgba(0,0,0,.18)');rounded(ctx,x,630,140,230,15,'#3a596c','#233b49');rounded(ctx,x+25,675,90,34,8,floor<3?'#5f8fa7':'#455863','#d7edf7');rounded(ctx,x+25,780,90,34,8,floor>1?'#775f7b':'#4e4750','#eaddeb');ctx.fillStyle='#fff';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillText(floor<3?'▲ 위층':'막힘',x+70,698);ctx.fillText(floor>1?'▼ 아래층':'막힘',x+70,803);ctx.textAlign='left'}
 if(floor===1){ctx.fillStyle='#315b75';ctx.fillRect(1450,1880,300,100);ctx.fillStyle='#d9eff8';ctx.fillRect(1490,1900,110,70);ctx.fillRect(1600,1900,110,70);ctx.fillStyle='#fff';ctx.font='bold 20px sans-serif';ctx.fillText('정문 → 운동장',1520,1870)}
 ctx.fillStyle='#415b60';ctx.font='bold 36px sans-serif';ctx.fillText(`${floor}층 중앙 복도`,1400,945);
}
function drawFence(ctx,r){ctx.strokeStyle='#d8dee2';ctx.lineWidth=5;ctx.setLineDash([12,7]);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.setLineDash([]);ctx.fillStyle='#72808a';for(let x=r.x;x<r.x+r.w;x+=55)ctx.fillRect(x-2,r.y-8,4,24)}
function drawYard(ctx){
 const sky=ctx.createLinearGradient(0,0,0,MAP.h);sky.addColorStop(0,'#ccebf7');sky.addColorStop(.25,'#e9f5e7');sky.addColorStop(.26,'#78ad65');sky.addColorStop(1,'#5e984c');ctx.fillStyle=sky;ctx.fillRect(0,0,MAP.w,MAP.h);
 // 2.5D school facade at top
 ctx.fillStyle='rgba(0,0,0,.2)';ctx.fillRect(1030,70,1140,280);ctx.fillStyle='#f1e3c8';ctx.fillRect(1000,35,1140,280);ctx.fillStyle='#a95247';ctx.fillRect(960,15,1220,48);
 for(let r=0;r<3;r++)for(let c=0;c<10;c++){ctx.fillStyle='#9fd1e5';ctx.fillRect(1040+c*100,85+r*64,66,44);ctx.fillStyle='#fff8';ctx.fillRect(1046+c*100,90+r*64,12,34)}
 rounded(ctx,1450,95,300,90,14,'#315b75','#23445a');ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';ctx.fillText('학교 안으로',1535,147);
 // wide track / field
 ctx.fillStyle='#b96d54';ctx.beginPath();ctx.ellipse(2050,1150,930,520,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#f4e8df';ctx.lineWidth=8;for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(2050,1150,865-i*55,455-i*38,0,0,Math.PI*2);ctx.stroke()}
 ctx.fillStyle='#70a85d';ctx.beginPath();ctx.ellipse(2050,1150,610,305,0,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#fff';ctx.lineWidth=8;ctx.strokeRect(1640,980,100,150);ctx.strokeRect(2380,980,100,150);
 // fenced basketball court - must jump over fence
 ctx.fillStyle='#c9a86a';ctx.fillRect(160,1120,920,714);ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.strokeRect(180,1140,880,674);ctx.beginPath();ctx.arc(620,1477,120,0,Math.PI*2);ctx.stroke();
 drawFence(ctx,{x:160,y:1120,w:920,h:714});
 // trees/benches
 for(let i=0;i<10;i++){const x=150+i*310;ctx.fillStyle='#7d5637';ctx.fillRect(x,420,24,82);ctx.fillStyle='#397f48';ctx.beginPath();ctx.arc(x+12,392,60,0,Math.PI*2);ctx.fill()}
 rounded(ctx,210,650,330,36,7,'#956b42','#694a30');rounded(ctx,600,650,330,36,7,'#956b42','#694a30');
 ctx.fillStyle='#fff';ctx.font='bold 40px sans-serif';ctx.fillText('운동장',1500,500);
}
function drawArea(ctx,floor){floor===0?drawYard(ctx):drawSchool(ctx,floor)}

function loop(t){
 const dt=Math.min(.035,(t-last)/1000);last=t;lerpEntities(dt);
 if(started&&mode==='student'&&players[meId]){
  const p=players[meId];let dx=0,dy=0;
  if(keys.w||keys.arrowup)dy--;if(keys.s||keys.arrowdown)dy++;if(keys.a||keys.arrowleft)dx--;if(keys.d||keys.arrowright)dx++;
  if(Math.abs(joy.dx)+Math.abs(joy.dy)>.05){dx=joy.dx;dy=joy.dy}
  if(['lobby','playing'].includes(currentPhase)&&(dx||dy)){
   const l=Math.hypot(dx,dy);dx/=l;dy/=l;angle=Math.atan2(dy,dx);
   const sp=(Date.now()<(p.boostUntil||boostUntil)?1.8:1)*SPEED;
   const nx=clamp(p.x+dx*sp*dt,20,MAP.w-20),ny=clamp(p.y+dy*sp*dt,20,MAP.h-20);
   if(canMoveLocal(p,nx,ny)){p.x=nx;p.y=ny}p.angle=angle;checkPortalLocal(p);socket.emit('move',{x:p.x,y:p.y,angle:p.angle,floor:p.floor});
  }
  if(swingT>0)swingT-=dt;drawPlayerView();
 }
 if(started&&mode==='teacher')drawTeacherView();
 requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function drawPlayerView(){
 const p=players[meId];if(!p)return;
 cam.x=clamp(p.x-gameCanvas.width/2,0,Math.max(0,MAP.w-gameCanvas.width));cam.y=clamp(p.y-gameCanvas.height/2,0,Math.max(0,MAP.h-gameCanvas.height));
 g.clearRect(0,0,gameCanvas.width,gameCanvas.height);g.save();g.translate(-cam.x,-cam.y);drawArea(g,p.floor);
 for(const n of npcs.filter(n=>n.floor===p.floor)){drawPerson(g,n);bubble(g,n)}
 for(const q of Object.values(players).filter(q=>q.floor===p.floor)){
  drawPerson(g,q,{police:q.role==='police',revealed:q.revealed,name:myRole&&q.role===myRole&&currentPhase==='reveal'?q.nick:(myRole==='spy'&&q.role==='spy'&&q.alive?q.nick:'')});bubble(g,q)
 }
 if(myRole==='police'&&p.alive&&currentPhase==='playing'){const j=jumpOffset(p);g.save();g.translate(p.x,p.y-j);let a=p.angle||angle;if(swingT>0){const prog=1-swingT/.22;a+=-1.05+prog*2}g.rotate(a);g.fillStyle='#6c4020';g.fillRect(13,-4,58,8);g.restore()}
 g.restore();

 $('floorHud').textContent=p.floor===0?'운동장':`${p.floor}층`;
 $('scoreHud').textContent=`⭐ ${myScore()}`;
 if(currentPhase==='lobby'){$('roleHud').textContent='대기 중';$('timerHud').textContent='친구 기다리는 중';$('spyHud').textContent='';$('attackBtn').style.display='none';$('boostBtn').style.display='none';$('jumpBtn').style.display='block'}
 else if(currentPhase==='playing'){
  $('timerHud').textContent=fmt(timeLeft);$('spyHud').textContent=`스파이 ${Object.values(players).filter(x=>x.role==='spy'&&x.alive).length}`;
  if(myRole==='police'){$('roleHud').textContent=`🚔 ${'❤️'.repeat(Math.max(0,3-(p.miss||0)))}${'🖤'.repeat(Math.min(3,p.miss||0))}`;$('attackBtn').style.display='block';$('boostBtn').style.display='none'}
  else{$('roleHud').textContent=p.ghost?'🕵️👻 유령':'🕵️ 스파이';$('attackBtn').style.display='none';$('boostBtn').style.display=(p.alive&&timeLeft<=totalTime/2&&!p.boostUsed)?'block':'none'}
 }
}
function drawTeacherView(){
 tg.clearRect(0,0,teacherCanvas.width,teacherCanvas.height);
 const fit=Math.min(teacherCanvas.width/MAP.w,teacherCanvas.height/MAP.h)*.90,scale=fit*teacherZoom;
 const ox=teacherCanvas.width/2-MAP.w*scale/2+teacherPan.x,oy=teacherCanvas.height/2-MAP.h*scale/2+teacherPan.y;
 tg.save();tg.translate(ox,oy);tg.scale(scale,scale);drawArea(tg,selectedTeacherFloor);
 for(const n of npcs.filter(n=>n.floor===selectedTeacherFloor))drawPerson(tg,n);
 for(const p of Object.values(players).filter(p=>p.floor===selectedTeacherFloor))drawPerson(tg,p,{police:p.role==='police',revealed:p.role==='spy',name:p.nick});
 tg.restore();
 $('teacherTimer').textContent=currentPhase==='playing'?fmt(timeLeft):(currentPhase==='reveal'?'팀 확인 10초':'대기');
 $('teacherStats').textContent=`경찰 ${Object.values(players).filter(p=>p.role==='police'&&p.alive).length}명 · 스파이 ${Object.values(players).filter(p=>p.role==='spy'&&p.alive).length}명 · 학생 ${npcs.length}명`;
 $('zoomLabel').textContent=`${Math.round(teacherZoom*100)}%`;
}

document.querySelectorAll('#floorTabs button').forEach(b=>b.onclick=()=>{selectedTeacherFloor=+b.dataset.floor;teacherPan={x:0,y:0};sceneSound('floor')});
$('zoomIn').onclick=()=>teacherZoom=clamp(teacherZoom*1.2,.55,3);$('zoomOut').onclick=()=>teacherZoom=clamp(teacherZoom/1.2,.55,3);$('zoomReset').onclick=()=>{teacherZoom=1;teacherPan={x:0,y:0}};
teacherCanvas.addEventListener('wheel',e=>{e.preventDefault();teacherZoom=clamp(teacherZoom*(e.deltaY<0?1.12:.89),.55,3)},{passive:false});
teacherCanvas.addEventListener('pointerdown',e=>{if(mode!=='teacher')return;dragState={id:e.pointerId,x:e.clientX,y:e.clientY,px:teacherPan.x,py:teacherPan.y};teacherCanvas.setPointerCapture(e.pointerId)});
teacherCanvas.addEventListener('pointermove',e=>{if(!dragState||e.pointerId!==dragState.id)return;teacherPan.x=dragState.px+(e.clientX-dragState.x);teacherPan.y=dragState.py+(e.clientY-dragState.y)});
teacherCanvas.addEventListener('pointerup',e=>{if(dragState&&e.pointerId===dragState.id)dragState=null});

function resumeSavedSession(){
 const s=loadSession();if(!s||mode==='teacher')return;
 socket.emit('resumeSession',s,r=>{if(!r?.ok)return;mode='student';roomCode=s.code;meId=r.id;if(r.state)applyState(r.state);applyRoleUI(r.role,r.teammates||[]);openPlayerWorld();if(r.phase==='reveal')showTeamReveal(10);if(r.phase==='ended'){}toast('다시 연결되었습니다!')});
}
(function initUrl(){const q=new URLSearchParams(location.search),r=q.get('room');if(r){$('joinCode').value=r.replace(/\D/g,'').slice(0,4);mode='student';showScreen('studentJoin',true)}})();
socket.on('connect',()=>setTimeout(resumeSavedSession,120));
