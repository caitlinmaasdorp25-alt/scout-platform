const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
let pgPool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }, max: Number(process.env.PGPOOL_MAX || 5) });
}
const { URL } = require('url');
const { saveImage, resolveUpload, UPLOAD_DIR: STORAGE_UPLOAD_DIR } = require('./storage');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = STORAGE_UPLOAD_DIR;
const DB_FILE = path.join(DATA_DIR, 'scout.sqlite');
const APP_URL = String(process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const MAIL_MODE = String(process.env.MAIL_MODE || 'log');
const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 6)) * 1024 * 1024;
const AUTH_RATE_LIMIT = Math.max(3, Number(process.env.AUTH_RATE_LIMIT || 12));
const GENERAL_RATE_LIMIT = Math.max(30, Number(process.env.GENERAL_RATE_LIMIT || 120));
const USE_POSTGRES = Boolean(process.env.DATABASE_URL);
const LEGACY_DB_FILE = path.join(DATA_DIR, 'scout.json');
fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(UPLOAD_DIR, {recursive:true});

const seedTalent = [
  {id:'maya',name:'Maya N.',role:'Brand Designer',category:'Design',location:'Windhoek, Namibia',availability:'Available',bio:'I build visual identities and brand systems for businesses that want to look as good as the work they do.',services:['Brand Identity','Graphic Design','Art Direction'],projects:[{title:'Kora — Brand Identity'},{title:'North Studio — Campaign'},{title:'Melt — Packaging'},{title:'Aster — Digital Launch'}]},
  {id:'eli',name:'Eli K.',role:'Web Developer',category:'Technology',location:'Windhoek, Namibia',availability:'Available',bio:'Frontend developer focused on fast, thoughtful websites and digital products for growing businesses.',services:['Web Development','UI Development','Webflow'],projects:[{title:'Field Notes — Website'},{title:'Lumen — Web App'},{title:'Kite — E-commerce'},{title:'Milo — Landing Page'}]},
  {id:'sam',name:'Sam R.',role:'Photographer',category:'Photography',location:'Cape Town, South Africa',availability:'Busy until Oct',bio:'Portrait and lifestyle photographer creating natural, story-led images for people and brands.',services:['Portraits','Brand Photography','Content'],projects:[{title:'Sunday People — Editorial'},{title:'Common Ground — Campaign'},{title:'Noma — Portraits'},{title:'Afterlight — Product'}]},
  {id:'zoe',name:'Zoe M.',role:'Social Media Manager',category:'Marketing',location:'Windhoek, Namibia',availability:'Available',bio:'I help brands turn social media from a posting task into a channel people actually want to follow.',services:['Social Media','Content Strategy','Copywriting'],projects:[{title:'Mara — Social Refresh'},{title:'Good Form — Launch'},{title:'Nectar — Content System'},{title:'Cedar — Campaign'}]}
];

const baseBriefs = [
 {id:'brand-refresh',title:'Brand refresh for a growing local café',client:'Mara Coffee',location:'Windhoek, Namibia',country:'Namibia',category:'Design',mode:'In-person',budget:6500,deadline:'2026-10-18',description:'We want a warmer, more memorable identity across packaging, menus and social templates.',skills:['Brand Identity','Graphic Design'],posted:'Today'},
 {id:'website-build',title:'Build a polished website for a consulting firm',client:'Northline Advisory',location:'Johannesburg, South Africa',country:'South Africa',category:'Technology',mode:'Remote',budget:18000,deadline:'2026-11-07',description:'A fast responsive website with lead-generation forms and a CMS.',skills:['Frontend','CMS','Responsive Web'],posted:'Yesterday'},
 {id:'social-launch',title:'Social launch campaign for a new beauty brand',client:'Nia Skin',location:'Windhoek, Namibia',country:'Namibia',category:'Marketing',mode:'Remote',budget:8500,deadline:'2026-10-30',description:'Launch strategy, content direction and a first-month social rollout.',skills:['Social Strategy','Content'],posted:'2 days ago'},
 {id:'photo-campaign',title:'Lifestyle photography for a summer campaign',client:'Common Ground',location:'Cape Town, South Africa',country:'South Africa',category:'Photography',mode:'In-person',budget:12000,deadline:'2026-10-24',description:'Lifestyle imagery for a seasonal campaign across web and social.',skills:['Photography','Editing'],posted:'3 days ago'},
 {id:'copy-pitch',title:'Copywriter for a small business pitch deck',client:'Field Notes Studio',location:'Windhoek, Namibia',country:'Namibia',category:'Writing',mode:'Remote',budget:4000,deadline:'2026-10-12',description:'Clear, persuasive copy for a concise investor and client-facing pitch deck.',skills:['Copywriting','Brand Voice'],posted:'4 days ago'},
 {id:'ux-audit',title:'UX audit for an early-stage digital product',client:'Kite Labs',location:'Pretoria, South Africa',country:'South Africa',category:'Design',mode:'Remote',budget:9500,deadline:'2026-10-20',description:'Review our onboarding and core product flow and give us a practical improvement roadmap.',skills:['UX','Research'],posted:'5 days ago'}
];

const sqlite = USE_POSTGRES ? null : new DatabaseSync(DB_FILE);
if (sqlite) sqlite.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
const emptyDB = () => ({users:[],sessions:[],messages:[],briefs:[],responses:[],uploads:[],mail:[]});
function readDBLocal(){
  const row=sqlite.prepare('SELECT value FROM app_state WHERE key=?').get('state');
  if(row) { try { return JSON.parse(row.value); } catch {} }
  if(fs.existsSync(LEGACY_DB_FILE)) { try { return JSON.parse(fs.readFileSync(LEGACY_DB_FILE,'utf8')); } catch {} }
  return emptyDB();
}
let db = USE_POSTGRES ? emptyDB() : readDBLocal();
function normalizeDB(){db.users=db.users||[];db.sessions=db.sessions||[];db.messages=db.messages||[];db.briefs=db.briefs||[];db.responses=db.responses||[];db.uploads=db.uploads||[];db.mail=db.mail||[];for(const u of db.users){if(u.emailVerified===undefined)u.emailVerified=true;if(u.emailVerifiedAt===undefined)u.emailVerifiedAt=u.createdAt||new Date().toISOString();if(u.verificationTokenHash===undefined)u.verificationTokenHash=null;if(u.verificationExpiresAt===undefined)u.verificationExpiresAt=null;if(u.resetTokenHash===undefined)u.resetTokenHash=null;if(u.resetExpiresAt===undefined)u.resetExpiresAt=null;}for(const sess of db.sessions){if(!sess.tokenHash&&sess.token){sess.tokenHash=hashToken(sess.token);delete sess.token;}}}
normalizeDB();
async function initDB(){
  if(!USE_POSTGRES) return;
  await pgPool.query(`CREATE TABLE IF NOT EXISTS scout_state (id integer PRIMARY KEY CHECK (id=1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  const result=await pgPool.query('SELECT data FROM scout_state WHERE id=1');
  if(result.rows[0]) db=result.rows[0].data;
  else if(fs.existsSync(LEGACY_DB_FILE)) { try { db=JSON.parse(fs.readFileSync(LEGACY_DB_FILE,'utf8')); } catch {} }
  else db=emptyDB();
}
async function saveDB(){
  if(USE_POSTGRES){
    await pgPool.query(`INSERT INTO scout_state(id,data,updated_at) VALUES(1,$1,now()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,[JSON.stringify(db)]);
  } else {
    sqlite.prepare(`INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run('state',JSON.stringify(db));
  }
}

function send(res,status,data,headers={}){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(body);}
function parseBody(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>8e6){req.destroy();reject(new Error('Payload too large'));}});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});req.on('error',reject);});}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')};}
function verifyPassword(password,user){const hash=crypto.scryptSync(password,user.salt,64).toString('hex');return crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(user.passwordHash,'hex'));}
function token(){return crypto.randomBytes(32).toString('hex');}
function hashToken(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function randomToken(){return crypto.randomBytes(32).toString('hex');}
function validPassword(password){return typeof password==='string' && password.length>=8 && password.length<=128;}
function cleanText(value,max=2000){return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim().slice(0,max);}
function verificationRecord(type, userId){const raw=randomToken();return {type,userId,tokenHash:hashToken(raw),expiresAt:new Date(Date.now()+30*60*1000).toISOString(),createdAt:new Date().toISOString(),raw};}
async function deliverMail(to,subject,link){const entry={id:'mail_'+crypto.randomBytes(8).toString('hex'),to,subject,link,createdAt:new Date().toISOString(),mode:MAIL_MODE};db.mail=db.mail||[];db.mail.push({...entry});await saveDB();if(MAIL_MODE==='log'||process.env.NODE_ENV!=='production')console.log(`[SCOUT MAIL] ${subject} -> ${to}\n${link}`);return entry;}
function publicUser(u){const {passwordHash,salt,...safe}=u;return safe;}
async function auth(req){const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return null;const raw=h.slice(7);if(!raw)return null;const s=db.sessions.find(x=>x.tokenHash===hashToken(raw));if(!s)return null;const maxAge=30*24*60*60*1000;if(Date.now()-new Date(s.createdAt).getTime()>maxAge){db.sessions=db.sessions.filter(x=>x.tokenHash!==s.tokenHash);await saveDB();return null;}const u=db.users.find(x=>x.id===s.userId);return u||null;}
function profileFromUser(u){return {id:u.id,name:u.name,email:u.email,emailVerified:Boolean(u.emailVerified),role:u.role,category:u.category,location:u.location,availability:u.availability,bio:u.bio,services:u.services||[],projects:u.projects||[],experience:u.experience||[],initials:(u.name||'SC').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),avatar:u.avatar||null,createdAt:u.createdAt};}
async function seedIfNeeded(){
  if(!db.briefs.length){ db.briefs=baseBriefs.map(x=>({...x,ownerId:null})); await saveDB(); }
}


const rateBuckets=new Map();
const authRateBuckets=new Map();
function rateLimit(req, limit=GENERAL_RATE_LIMIT, windowMs=60_000, store=rateBuckets){
  const key=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  const now=Date.now(); const bucket=store.get(key)||{start:now,count:0};
  if(now-bucket.start>windowMs){bucket.start=now;bucket.count=0;}
  bucket.count++; store.set(key,bucket);
  return bucket.count<=limit;
}
function authRateLimit(req){return rateLimit(req,AUTH_RATE_LIMIT,60_000,authRateBuckets);}


async function api(req,res,url){
  const method=req.method;
  const p=url.pathname;
  if(!rateLimit(req)) return send(res,429,{error:'Too many requests. Please try again shortly.'},{'Retry-After':'60'});
  try{
    if(p==='/api/health'&&method==='GET')return send(res,200,{ok:true,service:'SCOUT API',version:'0.9.0',database:USE_POSTGRES?'postgres':'sqlite',environment:process.env.NODE_ENV||'development'});
    if(p==='/api/auth/register'&&method==='POST'){
      if(!authRateLimit(req)) return send(res,429,{error:'Too many sign-up attempts. Please wait a minute and try again.'},{'Retry-After':'60'});
      const b=await parseBody(req); const email=String(b.email||'').trim().toLowerCase(); const password=String(b.password||'');
      if(!cleanText(b.name,120)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!validPassword(password))return send(res,400,{error:'Enter a valid name and email, and a password of 8–128 characters.'});
      if(db.users.some(u=>u.email===email))return send(res,409,{error:'An account with that email already exists. Try logging in or resetting the password.'});
      const pw=hashPassword(password);
      const u={id:'usr_'+crypto.randomBytes(8).toString('hex'),name:cleanText(b.name,120),email,salt:pw.salt,passwordHash:pw.hash,emailVerified:false,emailVerifiedAt:null,verificationTokenHash:null,verificationExpiresAt:null,resetTokenHash:null,resetExpiresAt:null,role:cleanText(b.role,120)||'Independent professional',category:cleanText(b.category,80)||'Other',location:cleanText(b.location,160),availability:cleanText(b.availability,80)||'Available',bio:cleanText(b.bio,1200),services:Array.isArray(b.services)?b.services.map(x=>cleanText(x,80)).filter(Boolean):[],projects:Array.isArray(b.projects)?b.projects:[],createdAt:new Date().toISOString()};
      const v=verificationRecord('verify',u.id); u.verificationTokenHash=v.tokenHash;u.verificationExpiresAt=v.expiresAt; db.users.push(u);
      await deliverMail(u.email,'Verify your SCOUT account',`${APP_URL}/verify-email.html?token=${encodeURIComponent(v.raw)}`);
      await saveDB();
      return send(res,201,{user:profileFromUser(u),emailVerificationRequired:true});
    }
    if(p==='/api/auth/login'&&method==='POST'){
      if(!authRateLimit(req)) return send(res,429,{error:'Too many login attempts. Please wait a minute and try again.'},{'Retry-After':'60'});
      const b=await parseBody(req);const u=db.users.find(x=>x.email===String(b.email||'').trim().toLowerCase());
      if(!u||!verifyPassword(String(b.password||''),u))return send(res,401,{error:'That email or password does not match.'});
      if(!u.emailVerified)return send(res,403,{error:'Please verify your email before logging in.',code:'EMAIL_NOT_VERIFIED',email:u.email});
      const raw=randomToken();db.sessions.push({tokenHash:hashToken(raw),userId:u.id,createdAt:new Date().toISOString()});await saveDB();return send(res,200,{user:profileFromUser(u),token:raw});
    }
    if(p==='/api/auth/logout'&&method==='POST'){
      const h=req.headers.authorization||'';db.sessions=db.sessions.filter(x=>x.tokenHash!==hashToken(h.replace(/^Bearer /,'')));await saveDB();return send(res,200,{ok:true});
    }
    if(p==='/api/auth/verify-email'&&method==='POST'){
      if(!authRateLimit(req)) return send(res,429,{error:'Too many verification attempts. Please wait a minute and try again.'},{'Retry-After':'60'});
      const b=await parseBody(req);const raw=String(b.token||'');const u=db.users.find(x=>x.verificationTokenHash===hashToken(raw));
      if(!u||!u.verificationExpiresAt||new Date(u.verificationExpiresAt).getTime()<Date.now())return send(res,400,{error:'That verification link is invalid or has expired.'});
      u.emailVerified=true;u.emailVerifiedAt=new Date().toISOString();u.verificationTokenHash=null;u.verificationExpiresAt=null;await saveDB();return send(res,200,{ok:true,user:profileFromUser(u)});
    }
    if(p==='/api/auth/resend-verification'&&method==='POST'){
      if(!authRateLimit(req)) return send(res,429,{error:'Too many requests. Please wait a minute and try again.'},{'Retry-After':'60'});
      const b=await parseBody(req);const email=String(b.email||'').trim().toLowerCase();const u=db.users.find(x=>x.email===email);
      if(u&&!u.emailVerified){const v=verificationRecord('verify',u.id);u.verificationTokenHash=v.tokenHash;u.verificationExpiresAt=v.expiresAt;await deliverMail(u.email,'Verify your SCOUT account',`${APP_URL}/verify-email.html?token=${encodeURIComponent(v.raw)}`);await saveDB();}
      return send(res,200,{ok:true,message:'If an account needs verification, a new verification link has been generated.'});
    }
    if(p==='/api/auth/forgot-password'&&method==='POST'){
      if(!authRateLimit(req)) return send(res,429,{error:'Too many requests. Please wait a minute and try again.'},{'Retry-After':'60'});
      const b=await parseBody(req);const email=String(b.email||'').trim().toLowerCase();const u=db.users.find(x=>x.email===email);
      if(u){const r=verificationRecord('reset',u.id);u.resetTokenHash=r.tokenHash;u.resetExpiresAt=r.expiresAt;await deliverMail(u.email,'Reset your SCOUT password',`${APP_URL}/reset-password.html?token=${encodeURIComponent(r.raw)}`);await saveDB();}
      return send(res,200,{ok:true,message:'If an account exists for that email, a password reset link has been generated.'});
    }
    if(p==='/api/auth/reset-password'&&method==='POST'){
      if(!authRateLimit(req)) return send(res,429,{error:'Too many reset attempts. Please wait a minute and try again.'},{'Retry-After':'60'});
      const b=await parseBody(req);const raw=String(b.token||'');const password=String(b.password||'');const u=db.users.find(x=>x.resetTokenHash===hashToken(raw));
      if(!u||!u.resetExpiresAt||new Date(u.resetExpiresAt).getTime()<Date.now())return send(res,400,{error:'That password reset link is invalid or has expired.'});
      if(!validPassword(password))return send(res,400,{error:'Password must be 8–128 characters.'});
      const pw=hashPassword(password);u.salt=pw.salt;u.passwordHash=pw.hash;u.resetTokenHash=null;u.resetExpiresAt=null;db.sessions=db.sessions.filter(x=>x.userId!==u.id);await saveDB();return send(res,200,{ok:true});
    }
    if(p==='/api/dev/mail'&&method==='GET'&&process.env.NODE_ENV!=='production')return send(res,200,{mail:(db.mail||[]).slice(-20)});
    if(p==='/api/me'&&method==='GET'){const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});return send(res,200,{user:profileFromUser(u)});}
    if(p==='/api/me'&&method==='PUT'){
      const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});const b=await parseBody(req);
      for(const k of ['name','role','category','location','availability','bio'])if(b[k]!==undefined)u[k]=String(b[k]);
      if(b.services!==undefined)u.services=Array.isArray(b.services)?b.services:String(b.services).split(',').map(x=>x.trim()).filter(Boolean);
      if(b.projects!==undefined)u.projects=Array.isArray(b.projects)?b.projects:[];
      if(b.experience!==undefined)u.experience=Array.isArray(b.experience)?b.experience:[];
      await saveDB();return send(res,200,{user:profileFromUser(u)});
    }
    if(p==='/api/me/avatar'&&method==='POST'){
      const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});const b=await parseBody(req);if(!b.data||!String(b.data).startsWith('data:image/'))return send(res,400,{error:'Send an image data URL.'});
      const match=String(b.data).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);if(!match)return send(res,400,{error:'Unsupported image format.'});
      const ext=match[1]==='jpeg'?'jpg':match[1];const image=Buffer.from(match[2],'base64');if(image.length>MAX_UPLOAD_BYTES)return send(res,413,{error:`Image must be ${process.env.MAX_UPLOAD_MB||6}MB or smaller.`});const file=`${u.id}-${Date.now()}.${ext}`;await saveImage({filename:file,buffer:image});u.avatar=`/uploads/${file}`;db.uploads.push({userId:u.id,file,url:u.avatar,createdAt:new Date().toISOString()});await saveDB();return send(res,200,{avatar:u.avatar});
    }
    if(p==='/api/me/portfolio-image'&&method==='POST'){
      const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});const b=await parseBody(req);
      const index=Number(b.index);if(!Number.isInteger(index)||index<0||index>20)return send(res,400,{error:'Invalid project index.'});
      if(!b.data||!String(b.data).startsWith('data:image/'))return send(res,400,{error:'Send an image data URL.'});
      const match=String(b.data).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);if(!match)return send(res,400,{error:'Unsupported image format.'});
      u.projects=u.projects||[];if(!u.projects[index])return send(res,404,{error:'Project not found.'});
      const ext=match[1]==='jpeg'?'jpg':match[1];const image=Buffer.from(match[2],'base64');if(image.length>MAX_UPLOAD_BYTES)return send(res,413,{error:`Image must be ${process.env.MAX_UPLOAD_MB||6}MB or smaller.`});const file=`${u.id}-work-${index}-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR,file),Buffer.from(match[2],'base64'));u.projects[index].image=`/uploads/${file}`;
      db.uploads.push({userId:u.id,file,url:u.projects[index].image,type:'portfolio',projectIndex:index,createdAt:new Date().toISOString()});await saveDB();return send(res,200,{project:u.projects[index]});
    }
    if(p==='/api/talent'&&method==='GET'){
      const q=String(url.searchParams.get('q')||'').toLowerCase(),cat=url.searchParams.get('category')||'All',country=url.searchParams.get('country')||'All',id=url.searchParams.get('id')||'';
      const users=db.users.map(profileFromUser);const combined=[...seedTalent,...users];const filtered=combined.filter(t=>(!id||t.id===id)&&(cat==='All'||t.category===cat)&&(country==='All'||String(t.location).includes(country))&&(!q||`${t.name} ${t.role} ${t.location} ${t.category} ${(t.services||[]).join(' ')}`.toLowerCase().includes(q)));return send(res,200,{talent:filtered});
    }
    if(p==='/api/messages'&&method==='GET'){
      const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});return send(res,200,{messages:db.messages.filter(m=>m.fromId===u.id||m.toId===u.id)});
    }
    if(p==='/api/messages'&&method==='POST'){
      const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});const b=await parseBody(req);if(!b.toId||!b.text)return send(res,400,{error:'Recipient and message are required.'});
      const m={id:'msg_'+crypto.randomBytes(8).toString('hex'),fromId:u.id,toId:b.toId,text:String(b.text).trim(),createdAt:new Date().toISOString()};db.messages.push(m);await saveDB();return send(res,201,{message:m});
    }
    if(p==='/api/projects'&&method==='GET')return send(res,200,{projects:db.briefs});
    if(p==='/api/projects'&&method==='POST'){
      const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});const b=await parseBody(req);if(!b.title||!b.category)return send(res,400,{error:'Title and category are required.'});
      const project={id:'brief_'+crypto.randomBytes(8).toString('hex'),title:String(b.title),client:u.name,clientId:u.id,location:String(b.location||u.location||''),country:(b.country?String(b.country):(String(b.location||'').includes('South Africa')?'South Africa':'Namibia')),category:String(b.category),mode:String(b.mode||'Remote'),budget:Number(b.budget)||0,deadline:String(b.deadline||''),description:String(b.description||''),skills:Array.isArray(b.skills)?b.skills:String(b.skills||'').split(',').map(x=>x.trim()).filter(Boolean),posted:'Just now',ownerId:u.id};db.briefs.unshift(project);await saveDB();return send(res,201,{project});
    }
    const responseMatch=p.match(/^\/api\/projects\/([^/]+)\/responses$/);if(responseMatch&&method==='POST'){
      const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});const b=await parseBody(req);const project=db.briefs.find(x=>x.id===responseMatch[1]);if(!project)return send(res,404,{error:'Project not found'});
      const r={id:'resp_'+crypto.randomBytes(8).toString('hex'),projectId:project.id,professionalId:u.id,clientId:project.ownerId||null,message:String(b.message||''),budget:b.budget||'',createdAt:new Date().toISOString()};db.responses.push(r);if(project.ownerId&&project.ownerId!==u.id){db.messages.push({id:'msg_'+crypto.randomBytes(8).toString('hex'),fromId:u.id,toId:project.ownerId,text:`Hi ${project.client}, I’m interested in your brief “${project.title}”. I’ve sent my response through SCOUT and would love to discuss the project further.`,createdAt:new Date().toISOString()});}await saveDB();return send(res,201,{response:r});
    }
    if(p==='/api/projects/mine'&&method==='GET'){const u=await auth(req);if(!u)return send(res,401,{error:'Not authenticated'});return send(res,200,{projects:db.briefs.filter(x=>x.ownerId===u.id),responses:db.responses.filter(x=>x.professionalId===u.id||x.clientId===u.id)});}
    return send(res,404,{error:'API route not found'});
  }catch(e){console.error(e);return send(res,500,{error:'Server error'});}
}

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
function staticFile(req,res,url){let pathname=decodeURIComponent(url.pathname);if(pathname==='/' )pathname='/index.html';if(pathname.startsWith('/api/'))return api(req,res,url);if(pathname.startsWith('/uploads/')){const file=resolveUpload(path.basename(pathname));if(!fs.existsSync(file)){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'public,max-age=31536000'});return fs.createReadStream(file).pipe(res);}let file=path.join(ROOT,pathname);if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found');}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);}
const server=http.createServer((req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Resource-Policy','same-origin');const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);staticFile(req,res,url);});
const PORT=process.env.PORT||3000;
(async()=>{
  await initDB();
  normalizeDB();
  await saveDB();
  await seedIfNeeded();
  server.listen(PORT,'0.0.0.0',()=>console.log(`SCOUT running at http://0.0.0.0:${PORT}`));
})().catch(err=>{console.error('SCOUT startup failed',err);process.exit(1);});

