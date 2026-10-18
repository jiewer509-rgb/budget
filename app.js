
"use strict";
/* =========================================================================
 * 收支账本 —— 单文件本地记账（IndexedDB，无服务器/无广告/无联网）
 * 数据完全存于本机浏览器；支持一键导出/导入 JSON 备份。
 * 未来可架到本地小服务器实现"全自动写盘 + 历史版本"，数据无缝迁移。
 * ========================================================================= */

/* ---------------- 常量：可视化调色板（dataviz 参考盘，CVD 安全） ---------------- */
const CAT_COLORS = ["var(--s1)","var(--s2)","var(--s3)","var(--s4)","var(--s5)","var(--s6)","var(--s7)","var(--s8)"];

/* ---------------- 默认分类 ---------------- */
const DEFAULT_CATEGORIES = [
  // 收入
  {id:"inc_salary", type:"income", nature:"recurring", name:"工资", icon:"💰", sort:1},
  {id:"inc_bonus",  type:"income", nature:"recurring", name:"奖金/兼职", icon:"🎁", sort:2},
  {id:"inc_invest", type:"income", nature:"recurring", name:"理财收益", icon:"📈", sort:3},
  {id:"inc_other",  type:"income", nature:"recurring", name:"其他收入", icon:"➕", sort:4},
  // 支出-每日固定
  {id:"exp_food",  type:"expense", nature:"recurring", name:"餐饮", icon:"🍜", sort:10},
  {id:"exp_trans", type:"expense", nature:"recurring", name:"交通", icon:"🚌", sort:11},
  {id:"exp_daily", type:"expense", nature:"recurring", name:"日用", icon:"🧻", sort:12},
  {id:"exp_comm",  type:"expense", nature:"recurring", name:"通讯", icon:"📱", sort:13},
  {id:"exp_fun",   type:"expense", nature:"recurring", name:"娱乐", icon:"🎮", sort:14},
  {id:"exp_med",   type:"expense", nature:"recurring", name:"医疗", icon:"💊", sort:15},
  {id:"exp_edu",   type:"expense", nature:"recurring", name:"教育", icon:"📚", sort:16},
  // 支出-周期性（摊销）
  {id:"exp_rent",  type:"expense", nature:"periodic", periodMonths:2,  name:"房租", icon:"🏠", sort:20},
  {id:"exp_insur", type:"expense", nature:"periodic", periodMonths:12, name:"保险/物业", icon:"🛡️", sort:21},
  // 支出-偶发
  {id:"exp_shop",  type:"expense", nature:"oneoff", name:"大额购物(衣物)", icon:"🛍️", sort:30},
  {id:"exp_gift",  type:"expense", nature:"oneoff", name:"人情往来", icon:"🧧", sort:31},
  {id:"exp_travel",type:"expense", nature:"oneoff", name:"旅行", icon:"✈️", sort:32},
  {id:"exp_elec",  type:"expense", nature:"oneoff", name:"数码家电", icon:"💻", sort:33},
  {id:"exp_other", type:"expense", nature:"oneoff", name:"其他偶发", icon:"📦", sort:34},
];
const NATURE_LABEL = {recurring:"每日固定", periodic:"周期性", oneoff:"偶发"};
const INCOME_LABEL = {recurring:"稳定", periodic:"周期", oneoff:"偶发"};
function natureLabel(c){return (c&&c.type==='income'?INCOME_LABEL:NATURE_LABEL)[c.nature]||'';}
const TOTAL_CAP = 0; // 本月总预算上限（预算页超支提醒 + 记账页日均参考）
const DEFAULT_FIXED = {};
const ARCHIVE_BEFORE = '2023-01'; // 2023年以前的数据算历史归档，不参与预算计算
const AMORTIZE_FROM = '2026-09'; // 2026-09 起，周期性支出的当月金额按摊销计算（周期内总金额/周期时长）

/* ---------------- 工具函数 ---------------- */
const $=s=>document.querySelector(s);
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function uid(){return (crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));}
function fmtMoney(n){
  n=Number(n||0); const neg=n<0; n=Math.abs(n);
  let s=n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/\.00$/,'');
  return (neg?'-':'')+'¥'+s;
}
function fmtNum(n){return Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:2});}
const pad=n=>String(n).padStart(2,'0');
function todayStr(){const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function monthStr(d){return d.getFullYear()+'-'+pad(d.getMonth()+1);}
const curMonth=()=>monthStr(new Date());
const WD=['周日','周一','周二','周三','周四','周五','周六'];
function weekdayOf(s){const d=new Date(s+'T00:00:00');return isNaN(d)?'':WD[d.getDay()];}
function shiftDay(s,delta){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+delta);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}

/* ---------------- 交互手感：震动 / 动效 / 数字滚动 ---------------- */
const REDUCE=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function haptic(pattern){
  try{ if(navigator.vibrate) navigator.vibrate(pattern==null?8:pattern); }catch(e){}
}
function animateNumber(el,from,to,dur){
  if(!el)return;
  if(REDUCE||from===to){el.textContent=fmtMoney(to);return;}
  const t0=performance.now(), d=dur||620;
  (function step(now){
    const p=Math.min(1,(now-t0)/d);
    const e=1-Math.pow(1-p,3); // easeOutCubic
    el.textContent=fmtMoney(from+(to-from)*e);
    if(p<1)requestAnimationFrame(step); else el.textContent=fmtMoney(to);
  })(t0);
}
function dayExpenseTotal(ds){
  return state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.date===ds)
    .reduce((s,t)=>s+Number(t.amount||0),0);
}
function todayExpenseTotal(){return dayExpenseTotal(todayStr());}
function dayVibe(v){
  const daily=TOTAL_CAP/30;
  if(v<=0)return '今天还没有支出，静悄悄的 🌙';
  const r=v/daily;
  if(r<0.5)return '今天很克制 🌱';
  if(r<0.9)return '在预算节奏里 ✓';
  if(r<1.25)return '今天花得有点满 ⚖️';
  if(r<2)return '今天稍微放飞了一下 🍃';
  return '今天大出血，明天悠着点 💸';
}
function shiftMonth(m,delta){const[y,mo]=m.split('-').map(Number);const d=new Date(y,mo-1+delta,1);return monthStr(d);}
function monthLabel(m){const[y,mo]=m.split('-').map(Number);return y+'年'+mo+'月';}
function toast(msg,actionLabel,actionFn){
  const t=$('#toast'); t.innerHTML='<span>'+esc(msg)+'</span>';
  if(actionLabel){const b=document.createElement('button');b.className='act';b.textContent=actionLabel;
    b.onclick=()=>{actionFn();hideToast();};t.appendChild(b);}
  t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(hideToast, actionLabel?6000:2600);
}
function hideToast(){$('#toast').classList.remove('show');}
function modal(html){
  return new Promise(res=>{
    const m=$('#modal'); m.innerHTML='<div class="box">'+html+'</div>';
    m.onclick=e=>{if(e.target===m){m.style.display='none';res(null);}};
    m.style.display='flex';
    m._resolve=res;
  });
}
function closeModal(v){const m=$('#modal');m.style.display='none';if(m._resolve)m._resolve(v);}
function confirmDialog(title,text,okLabel='确定',danger=false){
  return modal(
    '<h3>'+esc(title)+'</h3><p>'+esc(text)+'</p>'+
    '<div class="mrow"><button class="btn" onclick="closeModal(false)">取消</button>'+
    '<button class="btn '+(danger?'danger':'primary')+'" onclick="closeModal(true)">'+esc(okLabel)+'</button></div>'
  );
}

/* ---------------- 数据层（IndexedDB） ---------------- */
const DB_NAME='budget-portfolio', DB_VER=1;
let db;
function openDB(){return new Promise((res,rej)=>{
  const r=indexedDB.open(DB_NAME,DB_VER);
  r.onupgradeneeded=e=>{const d=e.target.result;
    if(!d.objectStoreNames.contains('main'))d.createObjectStore('main');
    if(!d.objectStoreNames.contains('backup'))d.createObjectStore('backup');};
  r.onsuccess=e=>{db=e.target.result;res(db);};
  r.onerror=e=>rej(e);
});}
function kvGet(store,key){return new Promise((res,rej)=>{
  const tx=db.transaction(store,'readonly').objectStore(store).get(key);
  tx.onsuccess=()=>res(tx.result); tx.onerror=e=>rej(e);});
}
function kvSet(store,key,val){return new Promise((res,rej)=>{
  const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put(val,key);
  tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);});
}
function kvDel(store,key){return new Promise((res,rej)=>{
  const tx=db.transaction(store,'readwrite'); tx.objectStore(store).delete(key);
  tx.oncomplete=()=>res(); tx.onerror=e=>rej(e);});
}

/* ---------------- 状态 ---------------- */
let state={
  categories:[],
  transactions:[],
  budgets:{},       // { '2026-10': { items:{catId:amount} } }
  meta:{ lastExportAt:null, remindDays:14 },
  view:'record',
  month:curMonth(),
  rec:{type:'expense',categoryId:null,amount:'',date:todayStr(),note:''},
  edit:null,        // 底部抽屉正在编辑的那一条
  statCat:null,     // 统计页下钻的分类 id
  catExpanded:false,
  catSearch:'',
  searchQuery:'',
};

/* ---------------- 持久化（主库 + 双副本） ---------------- */
let saveTimer=null;
function saveAll(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    const tx=JSON.parse(JSON.stringify(state.transactions));
    const cats=JSON.parse(JSON.stringify(state.categories));
    const budgets=JSON.parse(JSON.stringify(state.budgets));
    const meta=JSON.parse(JSON.stringify(state.meta));
    await kvSet('main','transactions',tx);
    await kvSet('main','categories',cats);
    await kvSet('main','budgets',budgets);
    await kvSet('main','meta',meta);
    // 双副本（防主表损坏）
    await kvSet('backup','transactions',tx);
    await kvSet('backup','categories',cats);
    await kvSet('backup','budgets',budgets);
    await kvSet('backup','meta',meta);
  },150);
}

/* ---------------- 分类工具 ---------------- */
function catById(id){return state.categories.find(c=>c.id===id);}
function catsOf(type,nature){return state.categories.filter(c=>c.type===type&&(!nature||c.nature===nature)).sort((a,b)=>a.sort-b.sort);}
function activeCats(type,nature){return catsOf(type,nature).filter(c=>!c.retired);}
function budgetedCats(){return state.categories.filter(c=>c.type==='expense'&&c.nature!=='oneoff').sort((a,b)=>a.sort-b.sort);}
function oneoffCats(){return state.categories.filter(c=>c.type==='expense'&&c.nature==='oneoff').sort((a,b)=>a.sort-b.sort);}

/* ---------------- 聚合 ---------------- */
function txInMonth(m){return state.transactions.filter(t=>!t.deletedAt&&t.date&&t.date.startsWith(m));}
function sumOf(list,type){return list.filter(t=>t.type===type).reduce((s,t)=>s+Number(t.amount||0),0);}
function catSum(list,catId){return list.filter(t=>t.categoryId===catId).reduce((s,t)=>s+Number(t.amount||0),0);}
function monthIncome(m){return sumOf(txInMonth(m),'income');}
function effExpByCat(m,catId){
  const c=catById(catId);
  if(c&&c.nature==='periodic'&&m>=AMORTIZE_FROM)return periodicAvg(m,c);
  return monthExpenseByCat(m,catId);
}
function monthExpense(m){
  if(m<AMORTIZE_FROM)return sumOf(txInMonth(m),'expense');
  return state.categories.filter(c=>c.type==='expense').reduce((s,c)=>s+effExpByCat(m,c.id),0);
}
function monthExpenseByCat(m,catId){return catSum(txInMonth(m),catId);}
function monthDiff(a,b){const[y1,m1]=a.split('-').map(Number),[y2,m2]=b.split('-').map(Number);return (y2-y1)*12+(m2-m1);}
function periodicAvg(m,cat){
  // 动态摊销：每笔支出摊到「下一次同分类支出」之前；下次支出录入后自动重算
  const byMonth={};
  state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.categoryId===cat.id).forEach(t=>{
    const mo=t.date.slice(0,7); byMonth[mo]=(byMonth[mo]||0)+Number(t.amount||0);
  });
  const months=Object.keys(byMonth).sort();
  let payMonth=null;
  for(const mo of months){ if(mo<=m) payMonth=mo; else break; }
  if(payMonth===null) return 0;
  const next=months[months.indexOf(payMonth)+1]||null;
  const span=Math.max(next?monthDiff(payMonth,next):(cat.periodMonths||1),1);
  if(monthDiff(payMonth,m)>=span) return 0; // 这笔的覆盖期已过
  return (byMonth[payMonth])/span;
}
function yearIncome(m){const y=m.split('-')[0];let s=0;state.transactions.forEach(t=>{if(!t.deletedAt&&t.type==='income'&&t.date.startsWith(y))s+=Number(t.amount||0);});return s;}
function yearExpense(m){const y=m.split('-')[0];let s=0;
  state.categories.filter(c=>c.type==='expense').forEach(c=>{
    for(let i=1;i<=12;i++){const mm=y+'-'+pad(i);
      s+=(c.nature==='periodic')?periodicAvg(mm,c):monthExpenseByCat(mm,c.id);
    }
  });
  return s;}

/* ---------------- 渲染分发 ---------------- */
function render(){
  renderTabbar();
  const v=$('#view');
  if(state.view==='record')renderRecord(v);
  else if(state.view==='month')renderMonth(v);
  else if(state.view==='budget')renderBudgetPage(v);
  else if(state.view==='trend')renderTrend(v);
  else if(state.view==='search')renderSearch(v);
  else if(state.view==='settings')renderSettings(v);
}
function renderTabbar(){
  const tabs=[['record','每日记账','✍️'],['month','本月','📊'],['budget','预算','🎯'],['trend','趋势','📈']];
  $('#tabbar').innerHTML=tabs.map(([k,n,i])=>'<button class="'+(state.view===k?'on':'')+'" onclick="go(\''+k+'\')"><span class="ti">'+i+'</span>'+n+'</button>').join('');
}
function go(k){
  if(k==='search'&&state.view!=='search')state.searchQuery='';  // 每次进来先看最近记录
  if(state.edit)closeSheet();                                   // 切页时收起抽屉
  state.view=k;state.statCat=null;render();window.scrollTo(0,0);
}
function gearBtn(){return '<button class="btn sm ghost" style="padding:4px 8px;font-size:16px" onclick="go(\'search\')">🔍</button><button class="btn sm ghost" style="padding:4px 8px;font-size:18px" onclick="go(\'settings\')">⚙️</button>';}

/* =========================================================================
 * 记账页
 * ========================================================================= */
function renderRecord(v){
  const rec=state.rec;
  const cats=activeCats(rec.type);
  if(!rec.categoryId && cats[0])rec.categoryId=cats[0].id;
  v.innerHTML=
    '<div class="topbar"><div><h1>记一笔</h1><div class="sub">'+monthLabel(curMonth())+'</div></div>'+gearBtn()+'</div>'+
    '<div class="card">'+
      '<div class="seg">'+
        '<button class="'+(rec.type==='expense'?'on expense':'')+'" onclick="setRecType(\'expense\')">支出</button>'+
        '<button class="'+(rec.type==='income'?'on income':'')+'" onclick="setRecType(\'income\')">收入</button>'+
      '</div>'+
      '<div class="amount-box" id="amountBox">'+
        '<div class="amount-wrap"><span class="cur">¥</span><input id="amount" type="text" inputmode="decimal" placeholder="0" value="'+esc(rec.amount)+'" oninput="state.rec.amount=this.value;renderAmountPreview()"></div>'+
        '<div id="amountPreview"></div>'+
      '</div>'+
      '<div class="calc-row">'+
        '<button type="button" class="calc-op" onclick="insertOp(\'+\')">＋</button>'+
        '<button type="button" class="calc-op" onclick="insertOp(\'-\')">−</button>'+
        '<button type="button" class="calc-op" onclick="insertOp(\'*\')">×</button>'+
        '<button type="button" class="calc-op" onclick="insertOp(\'/\')">÷</button>'+
        '<button type="button" class="calc-op" onclick="insertOp(\'(\')">(</button>'+
        '<button type="button" class="calc-op" onclick="insertOp(\')\')">)</button>'+
      '</div>'+
      '<div id="catSection">'+catSectionHTML()+'</div>'+
      '<div class="field"><span>日期</span><input type="date" value="'+esc(rec.date)+'" onchange="state.rec.date=this.value"></div>'+
      '<div class="field"><span>备注</span><input type="text" placeholder="选填" value="'+esc(rec.note)+'" oninput="state.rec.note=this.value"></div>'+
      '<button class="save-btn" onclick="saveTx()">保存</button>'+
    '</div>'+
    '<div id="todayWrap">'+renderTodaySummary()+'</div>'+
    '<div id="recentWrap">'+recentListHTML()+'</div>';
  renderAmountPreview();
}
// 删除后只重绘这两块，不整页重渲染（保住滚动位置）
function refreshRecordLists(fromTodayExp){
  const tw=$('#todayWrap');
  if(tw){
    tw.innerHTML=renderTodaySummary();
    if(fromTodayExp!=null)animateNumber($('#todayExp'),fromTodayExp,todayExpenseTotal());
  }
  const rw=$('#recentWrap');
  if(rw)rw.innerHTML=recentListHTML();
}

function setRecType(t){
  if(state.rec.type===t)return;
  state.rec.type=t;state.rec.categoryId=(activeCats(t)[0]||{}).id;
  haptic(8);render();
}

/* ---------------- 分类选择（局部刷新，避免整页闪） ---------------- */
function catSectionHTML(){
  const cats=activeCats(state.rec.type);
  if(!state.rec.categoryId && cats[0])state.rec.categoryId=cats[0].id;
  const selectedCat=cats.find(c=>c.id===state.rec.categoryId);
  return '<div class="field" style="justify-content:space-between;margin-bottom:6px"><span style="font-weight:600;color:var(--ink)">分类</span>'+
      '<button class="btn sm ghost" style="padding:3px 8px" onclick="toggleCat()">'+(state.catExpanded?'收起 ▴':'选择 ▾')+'</button></div>'+
    (state.catExpanded
      ? '<div class="field" style="margin-bottom:4px"><input type="text" placeholder="搜索分类..." value="'+esc(state.catSearch||'')+'" oninput="state.catSearch=this.value;renderCatGrid()" style="flex:1;border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--surface);color:var(--ink);font-size:14px"></div>'+
        '<div id="catGrid">'+catGridHTML(cats)+'</div>'
      : '<div style="display:flex;align-items:center;gap:8px;padding:2px 0 8px">'+
          '<span style="font-size:22px">'+(selectedCat?selectedCat.icon:'❓')+'</span>'+
          '<span style="font-weight:600;font-size:15px">'+(selectedCat?esc(selectedCat.name):'请选择分类')+'</span>'+
          '<span class="badge">'+(selectedCat?natureLabel(selectedCat):'')+'</span>'+
        '</div>');
}
function refreshCatSection(){
  const el=$('#catSection'); if(!el)return;
  el.innerHTML=catSectionHTML();
}
function pickCat(id,el){
  if(state.rec.categoryId===id && !state.catExpanded)return;
  state.rec.categoryId=id;
  haptic(8);
  const grid=$('#catGrid');
  if(grid){
    // 先就地播放选中回弹，再收起——不打断手指下的反馈
    grid.querySelectorAll('.on').forEach(x=>x.classList.remove('on'));
    const cell=el||grid.querySelector('[data-cat="'+id+'"]');
    if(cell)cell.classList.add('on','pop');
    setTimeout(()=>{state.catExpanded=false;state.catSearch='';refreshCatSection();},210);
  }else{
    state.catExpanded=false;state.catSearch='';refreshCatSection();
  }
}
function toggleCat(){
  state.catExpanded=!state.catExpanded;
  if(!state.catExpanded)state.catSearch='';
  haptic(6);refreshCatSection();
}
function catCell(c,compact,opts){
  opts=opts||{};
  const selId=('selId' in opts)?opts.selId:state.rec.categoryId;
  const click=(opts.fn||'pickCat')+'(\''+c.id+'\',this)';
  const on=selId===c.id?' on':'';
  if(compact)return '<div class="chip'+on+'" data-cat="'+esc(c.id)+'" onclick="'+click+'"><span class="ico">'+c.icon+'</span><span class="nm">'+esc(c.name)+'</span></div>';
  return '<div class="cat'+on+'" data-cat="'+esc(c.id)+'" onclick="'+click+'"><span class="ico">'+c.icon+'</span><span class="nm">'+esc(c.name)+'</span><span class="badge">'+natureLabel(c)+'</span></div>';
}
function catGridHTML(cats,opts){
  opts=opts||{};
  const isIncome=(opts.type||state.rec.type)==='income';
  const groups=isIncome
    ? [['recurring','稳定'],['periodic','周期'],['oneoff','偶发']]
    : [['recurring','每日固定'],['periodic','周期'],['oneoff','偶发']];
  let html='';
  groups.forEach(([nature,label])=>{
    const g=cats.filter(c=>c.nature===nature);
    if(!g.length)return;
    html+='<div class="section-title" style="margin:8px 0 4px;font-size:11px">'+label+'</div>'+
      '<div class="cat-grid" style="margin-bottom:6px">'+g.map(c=>catCell(c,false,opts)).join('')+'</div>';
  });
  if(!cats.length)html+='<div class="empty" style="padding:12px">无匹配分类</div>';
  return html;
}
function renderCatGrid(){
  const el=document.getElementById('catGrid'); if(!el)return;
  const q=(state.catSearch||'').trim();
  const cats=activeCats(state.rec.type).filter(c=>!q||c.name.includes(q));
  el.innerHTML=catGridHTML(cats);
}

function calcExpr(s){
  const str=String(s==null?'':s).trim();
  if(!str)return null;
  if(!/^[0-9+\-*/().\s]+$/.test(str))return null;
  try{
    const v=Function('"use strict";return('+str+')')();
    return (typeof v==='number'&&isFinite(v))?v:null;
  }catch(e){return null;}
}
/* ---------------- 算式输入（顶部表单 & 底部抽屉共用） ---------------- */
function insertOpInto(inputId,op,which){
  const el=document.getElementById(inputId);
  if(!el)return;
  const pos=(el.selectionStart!=null?el.selectionStart:el.value.length);
  el.value=el.value.slice(0,pos)+op+el.value.slice(pos);
  if(which==='edit'){ if(state.edit)state.edit.amount=el.value; }
  else state.rec.amount=el.value;
  haptic(7);
  el.focus();
  const after=pos+op.length;
  try{ el.setSelectionRange(after,after); }catch(e){}
  if(which==='edit')renderSheetPreview(); else renderAmountPreview();
}
function insertOp(op){insertOpInto('amount',op,'rec');}
function insertOpSheet(op){insertOpInto('sheetAmount',op,'edit');}
function renderAmountPreview(){
  const p=$('#amountPreview');
  if(!p)return;
  const s=String(state.rec.amount||'').trim();
  const v=calcExpr(s);
  p.innerHTML=(v!==null&&/[+\-*/]/.test(s))?'= '+fmtMoney(v):'';
}
const CHEER=['记下啦','又省下一笔 🎉','钱包：稳住了 😌','干净利落','这笔我记住了 📌','好，继续','已入账 ✓'];
function saveCheer(amt){
  let line;
  if(amt>=500)line='这笔不小，记好了 👀';
  else if(amt<=10)line='小钱也是钱 💧';
  else line=CHEER[Math.floor(Math.random()*CHEER.length)];
  const n=state.transactions.filter(t=>!t.deletedAt&&t.date===todayStr()).length;
  return line+' '+fmtMoney(amt)+' · 今日第 '+n+' 笔';
}
// 保存反馈：金额区弹一下 + 一枚「✓ 金额」浮起 + 今日支出数字滚动增长
function playSavedFx(amt,from,to){
  const box=$('#amountBox');
  if(box&&!REDUCE){
    box.classList.add('bump');
    const pill=document.createElement('div');
    pill.className='saved-pill'; pill.textContent='✓ '+fmtMoney(amt);
    box.appendChild(pill);
    setTimeout(()=>pill.classList.add('out'),520);
    setTimeout(()=>{pill.remove();box.classList.remove('bump');},1400);
  }
  animateNumber($('#todayExp'),from,to);
}
function saveTx(){
  const amt=calcExpr(state.rec.amount);
  if(!amt||amt<=0){haptic([18,40,18]);toast('请输入金额');return;}
  if(!state.rec.categoryId){haptic([18,40,18]);toast('请选择分类');return;}
  if(!state.rec.date){haptic([18,40,18]);toast('请选择日期');return;}
  const before=todayExpenseTotal();
  state.transactions.push({id:uid(),type:state.rec.type,categoryId:state.rec.categoryId,amount:amt,date:state.rec.date,note:state.rec.note.trim(),createdAt:Date.now(),updatedAt:Date.now(),deletedAt:null});
  state.rec={type:state.rec.type,categoryId:state.rec.categoryId,amount:'',date:todayStr(),note:''};
  saveAll();render();
  haptic([14,28,14]);
  playSavedFx(amt,before,todayExpenseTotal());
  toast(saveCheer(amt));
}

/* ---------------- 底部抽屉：就地改/删一条记录，不跳页、不丢位置 ---------------- */
function openEditSheet(id){
  const t=state.transactions.find(x=>x.id===id);
  if(!t||t.deletedAt)return;
  state.edit={id:t.id,type:t.type,categoryId:t.categoryId,amount:String(t.amount),date:t.date,
    note:t.note||'',catOpen:false};
  haptic(8);
  renderSheet();
  $('#sheetWrap').classList.add('show');
  haptic(8);
  setTimeout(()=>{const el=document.getElementById('sheetAmount');if(el)el.focus();},280);
}
function closeSheet(){
  const w=$('#sheetWrap'); if(!w)return;
  w.classList.remove('show');
  state.edit=null;
}
function sheetToggleCat(){ state.edit.catOpen=!state.edit.catOpen; haptic(6); refreshSheetCat(); }
function refreshSheetCat(){
  const el=$('#sheetCat'); if(el)el.innerHTML=sheetCatHTML();
}
function sheetType(t){
  if(state.edit.type===t)return;
  state.edit.type=t;
  state.edit.categoryId=(activeCats(t)[0]||{}).id;
  state.edit.catOpen=false;
  haptic(8);renderSheet();
}
function sheetCatHTML(){
  const e=state.edit; if(!e)return '';
  const cats=activeCats(e.type);
  if(!e.categoryId&&cats[0])e.categoryId=cats[0].id;
  const sel=cats.find(c=>c.id===e.categoryId);
  return '<div class="field" style="justify-content:space-between;margin-bottom:6px">'+
      '<span style="font-weight:600;color:var(--ink)">分类</span>'+
      '<button class="btn sm ghost" style="padding:3px 8px" onclick="sheetToggleCat()">'+(e.catOpen?'收起 ▴':'选择 ▾')+'</button></div>'+
    (e.catOpen
      ? '<div id="sheetCatGrid">'+catGridHTML(cats,{selId:e.categoryId,fn:'sheetPickCat',type:e.type})+'</div>'
      : '<div style="display:flex;align-items:center;gap:8px;padding:2px 0 8px">'+
          '<span style="font-size:22px">'+(sel?sel.icon:'❓')+'</span>'+
          '<span style="font-weight:600;font-size:15px">'+(sel?esc(sel.name):'请选择分类')+'</span>'+
          '<span class="badge">'+(sel?natureLabel(sel):'')+'</span></div>');
}
function sheetPickCat(id,el){
  if(state.edit.categoryId===id&&!state.edit.catOpen)return;
  state.edit.categoryId=id;
  haptic(8);
  const grid=$('#sheetCatGrid');
  if(grid){
    grid.querySelectorAll('.on').forEach(x=>x.classList.remove('on'));
    const cell=el||grid.querySelector('[data-cat="'+id+'"]');
    if(cell)cell.classList.add('on','pop');
    setTimeout(()=>{state.edit.catOpen=false;refreshSheetCat();},210);
  }else{
    state.edit.catOpen=false;refreshSheetCat();
  }
}
function sheetCalcRow(){
  const o=['+','-','*','/','(',')'].map((op,i)=>{
    const label=['＋','−','×','÷','(',')'][i];
    return '<button type="button" class="calc-op" onclick="insertOpSheet(\''+op+'\')">'+label+'</button>';
  }).join('');
  return '<div class="calc-row">'+o+'</div>';
}
function renderSheetPreview(){
  const p=$('#sheetPreview'); if(!p||!state.edit)return;
  const s=String(state.edit.amount||'').trim();
  const v=calcExpr(s);
  p.innerHTML=(v!==null&&/[+\-*/]/.test(s))?'= '+fmtMoney(v):'';
}
function renderSheet(){
  const el=$('#sheet'); if(!el||!state.edit)return;
  const e=state.edit;
  el.innerHTML=
    '<div class="sheet-grab"></div>'+
    '<div class="sheet-head"><h3>修改记录</h3>'+
      '<button class="btn sm ghost" style="padding:4px 10px;font-size:17px" onclick="closeSheet()">✕</button></div>'+
    '<div class="seg">'+
      '<button class="'+(e.type==='expense'?'on expense':'')+'" onclick="sheetType(\'expense\')">支出</button>'+
      '<button class="'+(e.type==='income'?'on income':'')+'" onclick="sheetType(\'income\')">收入</button>'+
    '</div>'+
    '<div class="amount-wrap"><span class="cur">¥</span><input id="sheetAmount" type="text" inputmode="decimal" placeholder="0" value="'+esc(e.amount)+'" oninput="state.edit.amount=this.value;renderSheetPreview()"></div>'+
    sheetCalcRow()+
    '<div id="sheetPreview" style="font-size:13px;color:var(--good);font-weight:600;min-height:18px;margin:-4px 0 10px"></div>'+
    '<div id="sheetCat">'+sheetCatHTML()+'</div>'+
    '<div class="field"><span>日期</span><input type="date" value="'+esc(e.date)+'" onchange="state.edit.date=this.value"></div>'+
    '<div class="field"><span>备注</span><input type="text" placeholder="选填" value="'+esc(e.note)+'" oninput="state.edit.note=this.value"></div>'+
    '<div style="display:flex;gap:8px;margin-top:14px">'+
      '<button class="sheet-del" onclick="deleteFromSheet()">删除</button>'+
      '<button class="sheet-save" onclick="saveSheet()">保存修改</button>'+
    '</div>';
  renderSheetPreview();
}
// 改完只刷新当前页面上受影响的那一块，不整页重渲染
function refreshAfterEdit(fromTodayExp){
  if(state.view==='record')refreshRecordLists(fromTodayExp);
  else if(state.view==='search')renderSearchResults();
  else render();
}
function saveSheet(){
  const e=state.edit; if(!e)return;
  const amt=calcExpr(e.amount);
  if(!amt||amt<=0){haptic([18,40,18]);toast('请输入金额');return;}
  if(!e.categoryId){haptic([18,40,18]);toast('请选择分类');return;}
  const t=state.transactions.find(x=>x.id===e.id);
  if(!t){closeSheet();return;}
  const before=todayExpenseTotal();
  t.type=e.type;t.categoryId=e.categoryId;t.amount=amt;t.date=e.date;t.note=(e.note||'').trim();t.updatedAt=Date.now();
  saveAll();
  closeSheet();
  haptic([10,30,10]);
  refreshAfterEdit(before);
  toast('改好了 ✓');
}
function deleteFromSheet(){
  const e=state.edit; if(!e)return;
  const t=state.transactions.find(x=>x.id===e.id);
  if(!t)return;
  const before=todayExpenseTotal();
  t.deletedAt=Date.now();
  saveAll();
  closeSheet();
  haptic([12,26,12]);
  refreshAfterEdit(before);
  toast('已删除','撤销',()=>{t.deletedAt=null;saveAll();refreshAfterEdit();toast('已恢复');});
}

function renderTodaySummary(){
  const today=todayStr();
  const txs=state.transactions.filter(t=>!t.deletedAt&&t.date===today);
  const exp=txs.filter(t=>t.type==='expense');
  const inc=txs.filter(t=>t.type==='income');
  const byCat={};
  exp.forEach(t=>{byCat[t.categoryId]=(byCat[t.categoryId]||0)+Number(t.amount||0);});
  const items=Object.entries(byCat).map(([cid,val])=>{const c=catById(cid);return{c,val};}).sort((a,b)=>b.val-a.val);
  const todayExp=sumOf(exp,'expense');
  const wd=weekdayOf(today);

  // 与昨天对比：昨天完全没记过账就不提，免得出现「↓100%」这种假信号
  const yd=shiftDay(today,-1);
  const yExp=dayExpenseTotal(yd);
  const hasYd=state.transactions.some(t=>!t.deletedAt&&t.date===yd);
  let cmp='';
  if(hasYd&&yExp>0){
    const d=(todayExp-yExp)/yExp*100;
    if(Math.abs(d)>=1){
      const up=d>0;
      cmp='<span class="dn-cmp '+(up?'up':'down')+'">'+(up?'↑':'↓')+' '+Math.abs(Math.round(d))+'% 比昨天</span>';
    }else{
      cmp='<span class="dn-cmp">≈ 和昨天持平</span>';
    }
  }

  let html='<div class="card"><h3>今日（'+today+(wd?' '+wd:'')+'）</h3>'+
    '<div class="tiles">'+
      '<div class="tile"><div class="lb">今日支出</div><div class="vl expense" id="todayExp">'+fmtMoney(todayExp)+'</div></div>'+
      '<div class="tile"><div class="lb">今日收入</div><div class="vl income">'+fmtMoney(sumOf(inc,'income'))+'</div></div>'+
    '</div>'+
    '<div class="day-note"><span>'+dayVibe(todayExp)+'</span>'+cmp+'</div>'+
    '<div class="dn-sub">日均参考 '+fmtMoney(Math.round(TOTAL_CAP/30))+'（月总预算 '+fmtMoney(TOTAL_CAP)+' ÷ 30 天）</div>';
  if(!items.length){
    html+='<div class="empty">今天还没有支出记录</div>';
  }else{
    html+='<div class="section-title" style="margin-top:4px">支出分类</div>';
    html+=items.map(({c,val})=>'<div class="row">'+
      '<span class="ico">'+(c?c.icon:'❓')+'</span>'+
      '<div class="mid"><div class="nm">'+(c?esc(c.name):'未知')+'</div></div>'+
      '<div class="amt out">-'+fmtMoney(val)+'</div>'+
    '</div>').join('');
  }
  html+='</div>';
  return html;
}

/* ---------------- 最近记录：点一条改，✕ 直接删 ---------------- */
const RECENT_LIMIT=10;
function recentTxs(limit){
  return state.transactions.filter(t=>!t.deletedAt)
    .sort((a,b)=>txKey(b).localeCompare(txKey(a)))
    .slice(0,limit);
}
function txKey(t){return String(t.date||'')+'#'+String(t.createdAt||0).padStart(14,'0');}
function txRowHTML(t,showDate){
  const c=catById(t.categoryId);
  return '<div class="row rec-row" onclick="openEditSheet(\''+t.id+'\')">'+
    '<span class="ico">'+(c?c.icon:'❓')+'</span>'+
    '<div class="mid"><div class="nm">'+(c?esc(c.name):'未知')+
      (t.note?'<span class="rec-note">'+esc(t.note)+'</span>':'')+
      (t.date<ARCHIVE_BEFORE?'<span class="badge" style="margin-left:5px">历史</span>':'')+
      (showDate?'<span class="rec-note" style="opacity:.75">'+esc(t.date)+'</span>':'')+
    '</div></div>'+
    '<div class="amt '+(t.type==='income'?'in':'out')+'">'+(t.type==='income'?'+':'-')+fmtMoney(t.amount)+'</div>'+
    '<button class="del-x" aria-label="删除" onclick="event.stopPropagation();deleteTxById(\''+t.id+'\')">✕</button>'+
  '</div>';
}
function recentListHTML(){
  const list=recentTxs(RECENT_LIMIT);
  let html='<div class="card">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
      '<h3 style="margin:0">最近记录</h3>'+
      '<button class="btn sm ghost" style="padding:3px 8px" onclick="go(\'search\')">全部 ›</button>'+
    '</div>';
  if(!list.length){
    return html+'<div class="empty">还没有记录，上面记一笔试试</div></div>';
  }
  html+='<div class="rec-hint">点任意一条可修改，点 ✕ 删除（可撤销）</div>';
  let lastDay='';
  list.forEach(t=>{
    if(t.date!==lastDay){
      lastDay=t.date;
      const daySum=dayExpenseTotal(t.date);
      html+='<div class="rec-day"><span>'+esc(t.date)+(weekdayOf(t.date)?' '+weekdayOf(t.date):'')+'</span>'+
        '<span class="dsum">'+fmtMoney(daySum)+'</span></div>';
    }
    html+=txRowHTML(t);
  });
  return html+'</div>';
}
function deleteTxById(id){
  const t=state.transactions.find(x=>x.id===id);
  if(!t||t.deletedAt)return;
  const before=todayExpenseTotal();
  t.deletedAt=Date.now();
  haptic([12,26,12]);
  saveAll();
  refreshRecordLists(before);
  if(state.view==='search')renderSearchResults();
  toast('已删除','撤销',()=>{
    t.deletedAt=null;saveAll();
    if(state.view==='record')refreshRecordLists();else render();
    toast('已恢复');
  });
}

/* =========================================================================
 * 本月页（当月收支统计 + 预算）
 * ========================================================================= */
function renderMonth(v){
  const m=state.month;
  const inc=monthIncome(m), exp=monthExpense(m), bal=inc-exp;
  const oneoffSum=oneoffCats().reduce((s,c)=>s+monthExpenseByCat(m,c.id),0);
  v.innerHTML=
    '<div class="topbar"><div><h1>本月</h1><div class="sub">'+monthLabel(m)+'</div></div>'+
    '<div style="display:flex;gap:6px;align-items:center">'+
      '<button class="btn sm" onclick="shiftStat(-1)">‹</button>'+
      (m===curMonth()?'':'<button class="btn sm" onclick="shiftStat(1)">›</button>')+
      gearBtn()+
    '</div></div>'+

    '<div class="tiles">'+
      '<div class="tile"><div class="lb">本月收入</div><div class="vl income">'+fmtMoney(inc)+'</div></div>'+
      '<div class="tile"><div class="lb">本月支出</div><div class="vl expense">'+fmtMoney(exp)+'</div></div>'+
    '</div>'+
    '<div class="tiles">'+
      '<div class="tile"><div class="lb">本月结余</div><div class="vl '+(bal>=0?'income':'expense')+'">'+fmtMoney(bal)+'</div></div>'+
      '<div class="tile"><div class="lb">偶发支出</div><div class="vl expense">'+fmtMoney(oneoffSum)+'</div><div class="dl">不摊入预算</div></div>'+
    '</div>'+

    '<div class="card"><h3>收入分类 · 点色块看明细</h3><div id="incomeDonut"></div></div>'+
    '<div class="card"><h3>支出分类 · 点色块看明细</h3><div id="donut"></div></div>';

  renderMonthIncomeDonut();
  renderMonthDonut();
}
function shiftStat(d){state.month=shiftMonth(state.month,d);state.statCat=null;render();}

/* =========================================================================
 * 趋势页（近半年趋势 + 年度统计）
 * ========================================================================= */
function renderTrend(v){
  const m=state.month, y=m.split('-')[0];
  const yInc=yearIncome(m), yExp=yearExpense(m);
  v.innerHTML=
    '<div class="topbar"><div><h1>趋势</h1><div class="sub">'+y+'年</div></div>'+gearBtn()+'</div>'+
    '<div class="card"><h3>近 6 个月收支趋势</h3><div id="bars"></div></div>'+
    '<div class="card"><h3>年度收支统计（'+y+'年）</h3>'+
      '<div class="tiles">'+
        '<div class="tile"><div class="lb">年度收入</div><div class="vl income">'+fmtMoney(yInc)+'</div></div>'+
        '<div class="tile"><div class="lb">年度支出</div><div class="vl expense">'+fmtMoney(yExp)+'</div></div>'+
      '</div>'+
      '<div class="tile" style="margin-bottom:10px"><div class="lb">年度结余</div><div class="vl '+(yInc-yExp>=0?'income':'expense')+'">'+fmtMoney(yInc-yExp)+'</div></div>'+
      '<div class="section-title" style="margin:14px 0 4px">收入分类</div><div id="annualIncomeDonut"></div>'+
      '<div class="section-title" style="margin:14px 0 4px">支出分类</div><div id="annualDonut"></div>'+
    '</div>';
  renderBars();
  renderAnnualIncomeDonut();
  renderAnnualDonut();
}

/* ---------------- 环形图（点色块看明细） ---------------- */
function donutSVG(items, total, centerLabel){
  const size=200,th=26,r=(size-th)/2,C=2*Math.PI*r,gap=items.length>18?1:2.5,cx=size/2,cy=size/2;
  let off=0,segs='';
  items.forEach((it,i)=>{
    const len=it.value/total*C, dash=Math.max(len-gap,0.8);
    segs+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+it.color+'" stroke-width="'+th+'" '+
      'stroke-dasharray="'+dash+' '+(C-dash)+'" stroke-dashoffset="'+(-off)+'" data-i="'+i+'" style="cursor:pointer"></circle>';
    off+=len;
  });
  return '<div class="donut-wrap"><svg viewBox="0 0 '+size+' '+size+'">'+
    '<g transform="rotate(-90 '+cx+' '+cy+')">'+segs+'</g>'+
    '<text x="'+cx+'" y="'+cy+'" text-anchor="middle" class="donut-center">'+fmtMoney(total)+'</text>'+
    '<text x="'+cx+'" y="'+(cy+14)+'" text-anchor="middle" class="donut-cap">'+centerLabel+'</text></svg>'+
    '<div class="legend donut-lg">'+donutLegend(items)+'</div></div>';
}
function donutLegend(items){
  // items 已按性质→金额降序排好；这里按性质分组渲染，组内保持金额降序
  const type=(items[0]&&items[0].type)||'expense';
  const groups=[['recurring',type==='income'?'稳定':'固定'],['periodic','周期'],['oneoff','偶发']];
  let html='';
  groups.forEach(([nat,label])=>{
    const idx=[];items.forEach((it,i)=>{if(it.nature===nat)idx.push(i);});
    if(!idx.length)return;
    const gSum=idx.reduce((s,i)=>s+items[i].value,0);
    html+='<div class="lg-head"><span>'+label+'</span><span>'+fmtNum(gSum)+'</span></div>';
    idx.forEach(i=>{
      const it=items[i];
      const pct=gSum>0?Math.round(it.value/gSum*100):0;
      html+='<div class="lg" data-i="'+i+'" style="cursor:pointer">'+
        '<span class="sw" style="background:'+it.color+'"></span>'+
        '<span class="lg-nm">'+it.icon+' '+esc(it.name)+'</span>'+
        '<span class="lg-amt">'+fmtNum(it.value)+'</span>'+
        '<span class="lg-bar"><i style="width:'+Math.max(pct,2)+'%;background:'+it.color+'"></i></span>'+
      '</div>';
    });
  });
  return html;
}
function bindDonutTap(el, items, onTap){
  el.querySelectorAll('[data-i]').forEach(n=>{
    n.addEventListener('click',()=>{
      const i=parseInt(n.dataset.i);
      el.querySelectorAll('.lg').forEach((lg,j)=>lg.classList.toggle('on',j===i));
      onTap(items[i]);
    });
  });
}
function aggregateByCat(txs){
  const by={};txs.forEach(t=>{by[t.categoryId]=(by[t.categoryId]||0)+Number(t.amount||0);});
  let items=Object.entries(by).map(([cid,val])=>{const c=catById(cid);return{id:cid,name:c?c.name:cid,value:val,type:c?c.type:'expense',nature:c?c.nature:'oneoff',icon:c?c.icon:'❓'};});
  const natureOrder={recurring:0,periodic:1,oneoff:2};
  items.sort((a,b)=>(natureOrder[a.nature]-natureOrder[b.nature])||(b.value-a.value));
  // 先按性质分组（收入:稳定/周期/偶发，支出:固定/周期/偶发），组内按金额降序；颜色用黄金角均匀取色
  return items.map((it,i)=>({...it,color:'hsl('+Math.round((i*137.508)%360)+', 60%, 46%)'}));
}
function natureShort(type,nature){return (type==='income'?INCOME_LABEL:NATURE_LABEL)[nature]||'';}
function renderMonthDonut(){
  const el=$('#donut'); if(!el)return;
  const m=state.month;
  const txs=txInMonth(m).filter(t=>t.type==='expense');
  const shown=[];
  state.categories.filter(c=>c.type==='expense').forEach(c=>{
    const v=effExpByCat(m,c.id);
    if(v>0)shown.push({id:c.id,name:c.name,value:v,type:'expense',nature:c.nature,icon:c.icon});
  });
  const natureOrder={recurring:0,periodic:1,oneoff:2};
  shown.sort((a,b)=>(natureOrder[a.nature]-natureOrder[b.nature])||(b.value-a.value));
  shown.forEach((it,i)=>it.color='hsl('+Math.round((i*137.508)%360)+', 60%, 46%)');
  if(!shown.length){el.innerHTML='<div class="empty">本月暂无支出</div>';return;}
  const total=shown.reduce((s,x)=>s+x.value,0);
  el.innerHTML=donutSVG(shown,total,'本月支出');
  bindDonutTap(el, shown, it=>{
    const c=catById(it.id);
    const list=(c&&c.nature==='periodic')?state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.categoryId===it.id):txs;
    showTxDetail(it, list);
  });
}
function yearExpenseItems(y){
  const items=[];
  state.categories.filter(c=>c.type==='expense').forEach(c=>{
    let v=0;
    for(let i=1;i<=12;i++){const mm=y+'-'+pad(i);
      v+=(c.nature==='periodic')?periodicAvg(mm,c):monthExpenseByCat(mm,c.id);
    }
    if(v>0)items.push({id:c.id,name:c.name,value:v,type:'expense',nature:c.nature,icon:c.icon});
  });
  const natureOrder={recurring:0,periodic:1,oneoff:2};
  items.sort((a,b)=>(natureOrder[a.nature]-natureOrder[b.nature])||(b.value-a.value));
  return items.map((it,i)=>({...it,color:'hsl('+Math.round((i*137.508)%360)+', 60%, 46%)'}));
}
function renderAnnualDonut(){
  const el=$('#annualDonut'); if(!el)return;
  const y=state.month.split('-')[0];
  const txs=state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.date.startsWith(y));
  const shown=yearExpenseItems(y);
  if(!shown.length){el.innerHTML='<div class="empty">本年度暂无支出</div>';return;}
  const total=shown.reduce((s,x)=>s+x.value,0);
  el.innerHTML=donutSVG(shown,total,'年度支出');
  bindDonutTap(el, shown, it=>{
    const c=catById(it.id);
    const list=(c&&c.nature==='periodic')?state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.categoryId===it.id):txs;
    showTxDetail(it, list);
  });
}
function renderMonthIncomeDonut(){
  const el=$('#incomeDonut'); if(!el)return;
  const txs=txInMonth(state.month).filter(t=>t.type==='income');
  if(!txs.length){el.innerHTML='<div class="empty">本月暂无收入</div>';return;}
  const shown=aggregateByCat(txs);
  const total=shown.reduce((s,x)=>s+x.value,0);
  el.innerHTML=donutSVG(shown,total,'本月收入');
  bindDonutTap(el, shown, it=>showTxDetail(it, txs));
}
function renderAnnualIncomeDonut(){
  const el=$('#annualIncomeDonut'); if(!el)return;
  const y=state.month.split('-')[0];
  const txs=state.transactions.filter(t=>!t.deletedAt&&t.type==='income'&&t.date.startsWith(y));
  if(!txs.length){el.innerHTML='<div class="empty">本年度暂无收入</div>';return;}
  const shown=aggregateByCat(txs);
  const total=shown.reduce((s,x)=>s+x.value,0);
  el.innerHTML=donutSVG(shown,total,'年度收入');
  bindDonutTap(el, shown, it=>showTxDetail(it, txs));
}
function showTxDetail(it, allTxs){
  if(!it)return;
  const isInc=it.type==='income';
  const list=allTxs.filter(t=>t.categoryId===it.id).sort((a,b)=>(b.date+a.createdAt).localeCompare(a.date+a.createdAt)).slice(0,200);
  const total=list.reduce((s,t)=>s+Number(t.amount||0),0);
  modal('<h3>'+esc(it.name)+'</h3><p>共 '+list.length+' 笔 · 合计 '+fmtMoney(total)+'</p>'+
    (list.length?list.map(t=>'<div class="row"><div class="mid"><div class="nm">'+esc(t.date)+'</div><div class="sub">'+(t.note?esc(t.note):'')+'</div></div><div class="amt '+(isInc?'in':'out')+'">'+(isInc?'+':'-')+fmtMoney(t.amount)+'</div></div>').join(''):'<div class="empty">无记录</div>')+
    '<div class="mrow"><button class="btn" onclick="closeModal(null)">关闭</button></div>');
}

/* =========================================================================
 * 图表：近6个月收入 vs 支出（分组柱状）
 * ========================================================================= */
function renderBars(){
  const el=$('#bars');if(!el)return;
  const labels=[],inc=[],exp=[];
  for(let i=5;i>=0;i--){const mm=shiftMonth(state.month,-i);labels.push(mm.slice(2).replace('-','/')+'月');inc.push(monthIncome(mm));exp.push(monthExpense(mm));}
  const totalData=inc.reduce((s,x)=>s+x,0)+exp.reduce((s,x)=>s+x,0);
  if(totalData===0){el.innerHTML='<div class="empty">暂无收支数据</div>';return;}
  const max=Math.max(1,...inc,...exp);
  const W=340,H=170,padL=44,padB=22,padT=12,padR=8;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const group=plotW/labels.length, barW=Math.min(24,(group-14)/2);
  let g='',ticks='';
  const niceMax=niceCeil(max);
  for(let k=0;k<=4;k++){const v=niceMax*k/4, y=padT+plotH-v/niceMax*plotH;
    ticks+='<line class="grid" x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'"></line>';
    ticks+='<text class="tick" x="'+(padL-6)+'" y="'+(y+3)+'" text-anchor="end">'+fmtNum(v)+'</text>';}
  labels.forEach((lb,i)=>{
    const gx=padL+i*group+group/2;
    const hi=inc[i]/niceMax*plotH, he=exp[i]/niceMax*plotH;
    const bx1=gx-barW-1, bx2=gx+1;
    g+='<rect class="bar-income" x="'+bx1+'" y="'+(padT+plotH-hi)+'" width="'+barW+'" height="'+hi+'" rx="3"></rect>';
    g+='<rect class="bar-expense" x="'+bx2+'" y="'+(padT+plotH-he)+'" width="'+barW+'" height="'+he+'" rx="3"></rect>';
    g+='<text class="tick" x="'+gx+'" y="'+(H-6)+'" text-anchor="middle">'+lb+'</text>';
  });
  const svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%">'+ticks+g+
    '<line class="axis" x1="'+padL+'" y1="'+(padT+plotH)+'" x2="'+(W-padR)+'" y2="'+(padT+plotH)+'"></line></svg>'+
    '<div class="legend"><div class="lg"><span class="sw" style="background:var(--income)"></span>收入</div>'+
    '<div class="lg"><span class="sw" style="background:var(--expense)"></span>支出</div></div>';
  el.innerHTML=svg;
}
function niceCeil(x){if(x<=100)return Math.max(100,Math.ceil(x/50)*50);
  const pow=Math.pow(10,Math.floor(Math.log10(x)));const f=x/pow;
  const nf=f<=1?1:f<=2?2:f<=5?5:10;return nf*pow;}

/* =========================================================================
 * 图表：折线（分类下钻趋势）
 * ========================================================================= */
function renderLine(el,labels,vals,color){
  if(!el)return;
  const max=Math.max(1,...vals), W=340,H=150,padL=40,padB=20,padT=14,padR=10;
  const plotW=W-padL-padR,plotH=H-padT-padB, nc=niceCeil(max);
  let grid='';for(let k=0;k<=3;k++){const v=nc*k/3,y=padT+plotH-v/nc*plotH;
    grid+='<line class="grid" x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'"></line>'+
    '<text class="tick" x="'+(padL-6)+'" y="'+(y+3)+'" text-anchor="end">'+fmtNum(v)+'</text>';}
  const pts=vals.map((v,i)=>{const x=padL+(labels.length===1?plotW/2:i/(labels.length-1)*plotW);
    const y=padT+plotH-v/nc*plotH;return [x,y];});
  const path=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const area=path+' L'+pts[pts.length-1][0].toFixed(1)+' '+(padT+plotH)+' L'+pts[0][0].toFixed(1)+' '+(padT+plotH)+' Z';
  const last=pts[pts.length-1];
  let labelsvg='';pts.forEach((p,i)=>{
    labelsvg+='<text class="tick" x="'+p[0]+'" y="'+(H-5)+'" text-anchor="middle">'+esc(labels[i])+'</text>';
  });
  const svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%">'+grid+
    '<path d="'+area+'" fill="'+color+'" opacity="0.1"></path>'+
    '<path d="'+path+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>'+
    '<circle cx="'+last[0]+'" cy="'+last[1]+'" r="4" fill="'+color+'" stroke="var(--surface)" stroke-width="2"></circle>'+
    labelsvg+'<line class="axis" x1="'+padL+'" y1="'+(padT+plotH)+'" x2="'+(W-padR)+'" y2="'+(padT+plotH)+'"></line></svg>';
  el.innerHTML=svg;
}

/* =========================================================================
 * 预算页（独立 tab：分组、排序、点分类看明细）
 * ========================================================================= */
function renderBudgetPage(v){
  const m=state.month;
  v.innerHTML=
    '<div class="topbar"><div><h1>预算</h1><div class="sub">'+monthLabel(m)+'</div></div>'+
    '<div style="display:flex;gap:6px;align-items:center">'+
      '<button class="btn sm" onclick="shiftStat(-1)">‹</button>'+
      (m===curMonth()?'':'<button class="btn sm" onclick="shiftStat(1)">›</button>')+
      gearBtn()+
    '</div></div>'+
    '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">预算 vs 实际</h3><button class="btn sm primary" onclick="fillBudgetFromSuggest()">✨ 一键填充</button></div><div id="budgetActual"></div></div>';
  renderBudgetActual();
}

/* 偶发的灵活额度提醒
 * 偶发支出不摊入固定预算，但每月仍要在总预算里留出一笔灵活额度，
 * 所以：灵活额度 = 月总预算(TOTAL_CAP) − 已设预算合计（固定 + 周期的预算）。
 * 只做提醒，不新增要填的字段：额度是从已设预算推出来的，改了预算它自己就跟着变。 */
function flexBudgetHTML(used,totalBudget,setCount){
  const cap=TOTAL_CAP-totalBudget;
  const left=cap-used;
  const ratio=cap>0?used/cap:(used>0?2:0);
  const cls=left<0?'over':(ratio>=0.8?'warn':'');
  const head=left<0?'已超灵活额度':'还可灵活花';
  const hint = cap<=0
    ? '已设预算合计已经占满月总预算 '+fmtMoney(TOTAL_CAP)+'，没有留出灵活空间'
    : '月总预算 '+fmtMoney(TOTAL_CAP)+' − 已设预算合计 '+fmtMoney(totalBudget)+
      (setCount?'':'（还没设固定预算，暂按全额计）');
  return '<div class="flex-box '+cls+'">'+
    '<div class="flex-top"><span class="flex-lb">灵活额度</span><span class="flex-amt">'+fmtMoney(cap)+'</span></div>'+
    '<div class="flex-line">偶发已用 <b>'+fmtMoney(used)+'</b> · '+head+
      ' <b class="'+(left<0?'bad':'good')+'">'+fmtMoney(Math.abs(left))+'</b></div>'+
    '<div class="meter"><div class="fill '+cls+'" style="width:'+Math.min(ratio*100,100)+'%"></div></div>'+
    '<div class="flex-hint">偶发不摊入固定预算，所以每月先在总预算里留出这笔 · '+hint+'</div>'+
  '</div>';
}
function renderBudgetActual(){
  const el=$('#budgetActual'); if(!el)return;
  const m=state.month;
  const items=(state.budgets[m]&&state.budgets[m].items)||{};
  const groups=[['recurring','每日固定'],['periodic','周期'],['oneoff','偶发（不摊入预算）']];
  // 已设预算合计要提前算：偶发那一段的「灵活额度 = 月总预算 − 已设预算合计」要用到它
  const budgetedIds=state.categories.filter(c=>c.type==='expense'&&c.nature!=='oneoff').map(c=>c.id);
  const totalBudget=budgetedIds.reduce((s,id)=>s+Number(items[id]||0),0);
  let totalActual=0, setCount=0, topOver=null;
  let html='';
  groups.forEach(([nature,label])=>{
    const cats=state.categories.filter(c=>c.type==='expense'&&c.nature===nature).sort((a,b)=>a.sort-b.sort);
    if(!cats.length)return;
    const rows=cats.map(c=>{
      const b=Number(items[c.id]||0);
      const actual=monthExpenseByCat(m,c.id);
      const effectiveActual=(c.nature==='periodic')?periodicAvg(m,c):actual;
      const ratio=b>0?effectiveActual/b:0;
      const over=b>0&&ratio>1;
      return {c,b,effectiveActual,ratio,over,overshoot:over?effectiveActual-b:0};
    });
    rows.sort((a,b)=>b.effectiveActual-a.effectiveActual);
    rows.forEach(r=>{
      totalActual+=r.effectiveActual;
      if(r.b>0)setCount++;
      if(r.over&&(!topOver||r.overshoot>topOver.overshoot))topOver=r;
    });
    if(nature==='oneoff'){
      const total=rows.reduce((s,r)=>s+r.effectiveActual,0);
      html+='<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">'+
        '<span>'+label+'</span>'+
        '<span style="color:var(--expense);font-weight:700;font-size:16px;letter-spacing:-.01em">'+fmtMoney(total)+'</span>'+
      '</div>'+
      flexBudgetHTML(total,totalBudget,setCount)+
      '<div class="oo-list">'+
        rows.map(r=>'<div class="oo-row" onclick="showBudgetDetail(\''+r.c.id+'\')">'+
          '<span class="ico">'+r.c.icon+'</span>'+
          '<span class="nm">'+esc(r.c.name)+'</span>'+
          '<span class="amt">'+fmtMoney(r.effectiveActual)+'</span>'+
        '</div>').join('')+
      '</div>';
      return;
    }
    html+='<div class="section-title">'+label+'</div><div class="budget-grid">'+
      rows.map(r=>{
        const cls=r.over?'over':(r.b>0&&r.ratio>=0.85?'warn':'');
        return '<div class="btile '+cls+'" onclick="showBudgetDetail(\''+r.c.id+'\')">'+
          '<div class="tn">'+r.c.icon+' '+esc(r.c.name)+(state.meta.fixedBudgets&&state.meta.fixedBudgets[r.c.name]?' <span class="badge" style="font-size:9px">固定</span>':'')+(r.over?' <span style="color:var(--critical)">超支</span>':'')+'</div>'+
          '<div class="tv">'+fmtMoney(r.effectiveActual)+'<span class="b"> / '+fmtMoney(r.b)+'</span></div>'+
          '<div class="meter"><div class="fill '+cls+'" style="width:'+Math.min(r.ratio*100,100)+'%"></div></div>'+
        '</div>';
      }).join('')+'</div>';
  });
  let summary;
  if(totalActual>TOTAL_CAP){
    summary='<div class="bud-hero critical">⚠ 超支 '+fmtMoney(totalActual-TOTAL_CAP)+'</div>'+
      (topOver?'<div class="bud-sub">超支最多：'+topOver.c.icon+' '+esc(topOver.c.name)+'（超 '+fmtMoney(topOver.overshoot)+'）</div>':'');
  }else{
    summary='<div class="bud-hero good">✓ 本月剩余额度 '+fmtMoney(TOTAL_CAP-totalActual)+'</div>';
  }
  el.innerHTML=summary+
    '<div class="bud-meta">已设 '+setCount+' 项 · 预算合计 '+fmtMoney(totalBudget)+' / ¥'+TOTAL_CAP+' · 点卡片看明细 / 改预算</div>'+html;
}

function showBudgetDetail(catId){
  const m=state.month;
  const c=catById(catId); if(!c)return;
  const fb=state.meta.fixedBudgets&&state.meta.fixedBudgets[c.name];
  const b=Number((state.budgets[m]&&state.budgets[m].items)?state.budgets[m].items[catId]:0);
  const txs=txInMonth(m).filter(t=>t.type==='expense'&&t.categoryId===catId).sort((a,b)=>(b.date+a.createdAt).localeCompare(a.date+a.createdAt));
  const total=txs.reduce((s,t)=>s+Number(t.amount||0),0);
  modal('<h3>'+c.icon+' '+esc(c.name)+'</h3>'+
    (c.nature!=='oneoff'
      ? '<div class="field"><span>本月预算</span><input type="number" id="bd_input" min="0" step="1" placeholder="未设" value="'+(b||'')+'" inputmode="decimal"></div>'+
        '<div class="field"><span>固定预算</span><input type="number" id="bd_fixed" min="0" step="1" placeholder="未设" value="'+(fb||'')+'" inputmode="decimal"></div>'
      : '')+
    '<p>'+monthLabel(m)+' · 共 '+txs.length+' 笔 · 合计 '+fmtMoney(total)+'</p>'+
    (txs.length?txs.slice(0,200).map(t=>'<div class="row"><div class="mid"><div class="nm">'+esc(t.date)+'</div><div class="sub">'+(t.note?esc(t.note):'')+'</div></div><div class="amt out">-'+fmtMoney(t.amount)+'</div></div>').join(''):'<div class="empty">本月无记录</div>')+
    '<div class="mrow"><button class="btn" onclick="closeModal(null)">取消</button>'+
    (c.nature!=='oneoff'?'<button class="btn primary" onclick="saveBudgetFromModal(\''+catId+'\')">保存</button>':'')+
    '</div>');
}
function saveBudgetFromModal(catId){
  const c=catById(catId);
  const fEl=document.getElementById('bd_fixed');
  if(fEl&&c){const f=parseFloat(fEl.value)||0; setFixedBudget(c.name,f);}
  const v=parseFloat(document.getElementById('bd_input').value)||0;
  setBudget(catId,v);
  closeModal(null);
}

/* ---------------- 预算建议（近12个月 P75；周期类摊销） ---------------- */
function suggestBudget(cat, refMonth){
  // 只统计 2023-01 及以后（2023年以前算历史归档，不参与预算）
  let total=0, months=0;
  const vals=[];
  for(let i=1;;i++){
    const mm=shiftMonth(refMonth,-i);
    if(mm<ARCHIVE_BEFORE) break;
    const v=monthExpenseByCat(mm,cat.id);
    total+=v; months++; vals.push(v);
  }
  if(!months) return 0;
  if(cat.nature==='periodic') return total/months; // 周期类摊销到月
  const sorted=vals.filter(v=>v>0).sort((a,b)=>a-b);
  if(!sorted.length) return total/months;
  return sorted[Math.min(sorted.length-1, Math.floor(sorted.length*0.75))];
}
function fillBudgetFromSuggest(){
  const m=state.month;
  let n=0;
  budgetedCats().forEach(c=>{
    const fb=state.meta.fixedBudgets&&state.meta.fixedBudgets[c.name];
    const s=fb||suggestBudget(c,m);
    if(s>0){if(!state.budgets[m])state.budgets[m]={items:{}}; state.budgets[m].items[c.id]=Math.round(s); n++;}
  });
  saveAll();render();toast('已为 '+monthLabel(m)+' 填充 '+n+' 项预算（含固定预算）');
}
function setFixedBudget(name,val){
  state.meta.fixedBudgets=state.meta.fixedBudgets||{};
  const v=parseFloat(val)||0;
  if(v>0)state.meta.fixedBudgets[name]=v; else delete state.meta.fixedBudgets[name];
  saveAll();
}
function setBudget(catId,val){
  const m=state.month;const v=parseFloat(val)||0;
  if(!state.budgets[m])state.budgets[m]={items:{}};
  if(v>0)state.budgets[m].items[catId]=v; else delete state.budgets[m].items[catId];
  saveAll();render();
}

/* =========================================================================
 * 设置页
 * ========================================================================= */
function renderSettings(v){
  v.innerHTML=
    '<div class="topbar"><div><h1>设置</h1><div class="sub">数据完全保存在本机</div></div></div>'+
    '<div id="remind"></div>'+

    '<div class="section-title">数据备份</div>'+
    '<div class="card">'+
      '<div class="kv"><span class="k">最近导出</span><span class="v">'+(state.meta.lastExportAt?new Date(state.meta.lastExportAt).toLocaleString('zh-CN'):'从未')+'</span></div>'+
      '<button class="btn primary" style="width:100%;margin-top:10px" onclick="exportData()">⬇ 一键导出 JSON</button>'+
      '<button class="btn" style="width:100%;margin-top:8px" onclick="document.getElementById(\'importFile\').click()">⬆ 导入 JSON 备份</button>'+
      '<input type="file" id="importFile" accept=".json,application/json" class="hidden" onchange="importData(this.files[0])">'+
    '</div>'+

    '<div class="section-title">回收站（误删可恢复）</div>'+
    '<div class="card" id="trash"></div>'+

    '<div class="section-title">分类管理</div>'+
    '<div class="card" id="catManage"></div>'+

    '<div class="section-title">关于</div>'+
    '<div class="card">'+
      '<div class="kv"><span class="k">存储</span><span class="v">本机 IndexedDB（无服务器/无广告）</span></div>'+
      '<div class="kv"><span class="k">备份</span><span class="v">导出 JSON + 本机双副本</span></div>'+
      '<div style="margin-top:10px;font-size:12px;color:var(--muted);line-height:1.6">'
        +'如需"全自动写盘 + 历史版本"备份，可将本文件架到本地小服务器（数据无缝迁移）。'
        +'记账数据属你个人所有，请定期导出备份。'
      +'</div>'+
    '</div>';

  renderRemind();
  renderTrash();
  renderCatManage();
}

function renderRemind(){
  const el=$('#remind');if(!el)return;
  const days=state.meta.remindDays||14;
  if(!state.meta.lastExportAt){
    el.innerHTML='<div class="banner"><b>提示：</b>账本数据存在本机浏览器中，建议尽早导出一次备份，避免换设备或清理浏览器时丢失。'+
      '<div class="acts"><button class="btn sm primary" onclick="exportData()">立即导出</button></div></div>';
    return;
  }
  const since=Math.floor((Date.now()-state.meta.lastExportAt)/86400000);
  if(since>=days){
    el.innerHTML='<div class="banner"><b>已 '+since+' 天未备份</b>，建议现在导出，防止误删或换设备丢失。'+
      '<div class="acts"><button class="btn sm primary" onclick="exportData()">立即导出</button></div></div>';
  }else el.innerHTML='';
}

function renderTrash(){
  const el=$('#trash');if(!el)return;
  const trash=state.transactions.filter(t=>t.deletedAt).sort((a,b)=>b.deletedAt-a.deletedAt).slice(0,50);
  // 自动清理超过 30 天的回收站项
  const cutoff=Date.now()-30*86400000;
  const expired=state.transactions.filter(t=>t.deletedAt&&t.deletedAt<cutoff);
  if(expired.length){state.transactions=state.transactions.filter(t=>!expired.includes(t));saveAll();}
  if(!trash.length){el.innerHTML='<div class="empty">回收站为空</div>';return;}
  el.innerHTML=trash.map(t=>{
    const c=catById(t.categoryId);
    return '<div class="row"><span class="ico">'+(c?c.icon:'🗑️')+'</span>'+
      '<div class="mid"><div class="nm">'+esc(c?c.name:'未知')+'</div><div class="sub">'+esc(t.date)+' · '+fmtMoney(t.amount)+'</div></div>'+
      '<button class="btn sm" onclick="restoreTx(\''+t.id+'\')">恢复</button>'+
      '<button class="btn sm danger" onclick="purgeTx(\''+t.id+'\')">彻底删除</button></div>';
  }).join('');
}
function restoreTx(id){const t=state.transactions.find(x=>x.id===id);if(t){t.deletedAt=null;saveAll();render();toast('已恢复');}}
async function purgeTx(id){const ok=await confirmDialog('彻底删除','该记录将无法恢复，确定？','删除',true);if(!ok)return;
  state.transactions=state.transactions.filter(x=>x.id!==id);saveAll();render();toast('已彻底删除');}

function renderCatManage(){
  const el=$('#catManage');if(!el)return;
  el.innerHTML='<button class="btn" style="width:100%;margin-bottom:6px" onclick="addCatDialog()">＋ 添加分类</button>'+
    '<div class="section-title" style="margin-top:0">收入</div>'+catRows('income')+
    '<div class="section-title">支出 · 点下拉切换「每日固定/周期/偶发」</div>'+catRows('expense');
}
function addCatDialog(){
  const html='<h3>添加分类</h3>'+
    '<div class="field"><span>名称</span><input id="nc_name" type="text" placeholder="如：宠物"></div>'+
    '<div class="field"><span>图标</span><input id="nc_icon" type="text" placeholder="emoji，如 🐱" maxlength="4"></div>'+
    '<div class="field"><span>类型</span><select id="nc_type" style="flex:1;padding:9px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--ink)"><option value="expense">支出</option><option value="income">收入</option></select></div>'+
    '<div class="field"><span>性质</span><select id="nc_nature" style="flex:1;padding:9px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--ink)"><option value="recurring">每日固定</option><option value="periodic">周期性（摊销）</option><option value="oneoff">偶发</option></select></div>'+
    '<div class="field" id="nc_period_wrap" style="display:none"><span>每几月</span><input id="nc_period" type="number" min="1" max="12" value="2"></div>'+
    '<div class="mrow"><button class="btn" onclick="closeModal(null)">取消</button><button class="btn primary" onclick="doAddCat()">添加</button></div>';
  modal(html);
  const ns=document.getElementById('nc_nature');
  if(ns)ns.onchange=e=>{const w=document.getElementById('nc_period_wrap');if(w)w.style.display=e.target.value==='periodic'?'flex':'none';};
}
function doAddCat(){
  const name=document.getElementById('nc_name').value.trim();
  const icon=document.getElementById('nc_icon').value.trim()||'📌';
  const type=document.getElementById('nc_type').value;
  const nature=document.getElementById('nc_nature').value;
  const period=parseInt(document.getElementById('nc_period').value)||1;
  if(!name){toast('请输入名称');return;}
  const maxSort=state.categories.reduce((s,c)=>Math.max(s,c.sort||0),0);
  const c={id:uid(),type,name,icon,nature,sort:maxSort+1};
  if(nature==='periodic')c.periodMonths=Math.max(1,Math.min(12,period));
  state.categories.push(c);saveAll();closeModal(null);render();toast('已添加');
}
function catRows(type){
  const list=catsOf(type);
  return list.map(c=>{
    const opts=type==='income'
      ? [['recurring','稳定'],['periodic','周期'],['oneoff','偶发']]
      : [['recurring','每日固定'],['periodic','周期'],['oneoff','偶发']];
    const sel='<select onchange="setCatNature(\''+c.id+'\',this.value)" style="padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink);font-size:12px">'+
      opts.map(([v,l])=>'<option value="'+v+'"'+(c.nature===v?' selected':'')+'>'+l+'</option>').join('')+'</select>';
    const p=c.nature==='periodic'?'<input type="number" min="1" max="12" value="'+(c.periodMonths||1)+'" title="每N月" style="width:40px;text-align:center;border:1px solid var(--border);border-radius:6px;padding:3px;background:var(--surface);color:var(--ink)" onchange="setCatPeriod(\''+c.id+'\',this.value)"> 月':'';
    return '<div class="row"><span class="ico">'+c.icon+'</span>'+
      '<div class="mid"><div class="nm">'+esc(c.name)+(c.retired?' <span class="badge">历史</span>':'')+'</div></div>'+
      sel+p+
      '<button class="btn sm danger" onclick="delCat(\''+c.id+'\')">删</button></div>';
  }).join('');
}
function setCatNature(id,v){
  const c=catById(id); if(!c)return;
  c.nature=v;
  if(v==='periodic'&&!c.periodMonths)c.periodMonths=1;
  saveAll();render();toast('已改为 '+NATURE_LABEL[v]);
}
function setCatPeriod(id,v){const c=catById(id);if(c){c.periodMonths=Math.max(1,Math.min(12,parseInt(v)||1));saveAll();render();}}
async function delCat(id){
  const used=state.transactions.some(t=>!t.deletedAt&&t.categoryId===id);
  if(used){toast('该分类已有记录，不能删除');return;}
  const ok=await confirmDialog('删除分类','确定删除该分类？','删除',true);if(!ok)return;
  state.categories=state.categories.filter(c=>c.id!==id);saveAll();render();
}

/* =========================================================================
 * 导入 / 导出
 * ========================================================================= */
function exportData(){
  const data={version:1,exportedAt:new Date().toISOString(),categories:state.categories,transactions:state.transactions,budgets:state.budgets,meta:state.meta};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='收支账本_'+todayStr().replace(/-/g,'')+'.json';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  state.meta.lastExportAt=Date.now();saveAll();render();toast('已导出');
}
function importData(file){
  if(!file)return;
  const rd=new FileReader();
  rd.onload=async()=>{
    try{
      const data=JSON.parse(rd.result);
      if(!data.transactions||!data.categories){toast('文件格式不正确');return;}
      const mode=await importModeDialog(data);
      if(mode==='replace'){state.categories=data.categories;state.transactions=data.transactions;state.budgets=data.budgets||{};state.meta=data.meta||state.meta;}
      else if(mode==='merge'){
        const ids=new Set(state.transactions.map(t=>t.id));
        const newTx=data.transactions.filter(t=>!ids.has(t.id));
        state.transactions=state.transactions.concat(newTx);
        const catIds=new Set(state.categories.map(c=>c.id));
        state.categories=state.categories.concat(data.categories.filter(c=>!catIds.has(c.id)));
        const bm=new Set(Object.keys(state.budgets));
        Object.keys(data.budgets||{}).forEach(k=>{if(!bm.has(k))state.budgets[k]=data.budgets[k];});
      }else return;
      saveAll();render();toast('导入完成');
    }catch(e){toast('导入失败：'+e.message);}
  };
  rd.readAsText(file);
  const inp=document.getElementById('importFile');if(inp)inp.value='';
}
function importModeDialog(data){
  const n=data.transactions?data.transactions.length:0;
  return modal('<h3>导入备份</h3><p>文件含 '+n+' 条记录。选择导入方式：</p>'+
    '<div class="mrow" style="flex-direction:column">'+
    '<button class="btn primary" style="width:100%" onclick="closeModal(\'merge\')">合并（保留现有，按ID去重新增）</button>'+
    '<button class="btn" style="width:100%" onclick="closeModal(\'replace\')">覆盖（用文件内容替换全部）</button>'+
    '<button class="btn ghost" style="width:100%" onclick="closeModal(null)">取消</button></div>');
}

/* =========================================================================
 * 搜索历史记录
 * ========================================================================= */
function renderSearch(v){
  v.innerHTML=
    '<div class="topbar"><div><h1>全部记录</h1><div class="sub">默认列出最近 · 输入关键字筛选</div></div>'+gearBtn()+'</div>'+
    '<div class="card"><input type="text" placeholder="搜索备注/分类/金额/日期..." value="'+esc(state.searchQuery||'')+'" oninput="state.searchQuery=this.value;renderSearchResults()" style="width:100%;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface);color:var(--ink);font-size:15px"></div>'+
    '<div id="searchResults"></div>';
  renderSearchResults();
}
function searchTxs(q){
  const all=state.transactions.filter(t=>!t.deletedAt).sort((a,b)=>txKey(b).localeCompare(txKey(a)));
  if(!q)return all.slice(0,60);          // 不输入关键字就直接列最近记录
  q=q.toLowerCase();
  return all.filter(t=>{
    const c=catById(t.categoryId);
    return (t.note||'').toLowerCase().includes(q)||(c&&c.name.toLowerCase().includes(q))||t.date.includes(q)||String(t.amount).includes(q);
  }).slice(0,200);
}
function renderSearchResults(){
  const el=$('#searchResults'); if(!el)return;
  const q=(state.searchQuery||'').trim();
  const list=searchTxs(q);
  if(!list.length){el.innerHTML='<div class="empty">'+(q?'无匹配记录':'还没有任何记录')+'</div>';return;}
  el.innerHTML='<div class="card"><h3>'+
      (q?list.length+' 条结果'+(list.length===200?'（最多显示200）':''):'最近 '+list.length+' 条')+
    '</h3><div class="rec-hint">点任意一条可修改，点 ✕ 删除（可撤销）</div>'+
    list.map(t=>txRowHTML(t,true)).join('')+'</div>';
}

/* =========================================================================
 * 初始化
 * ========================================================================= */
async function init(){
  await openDB();
  let cats=await kvGet('main','categories');
  let tx=await kvGet('main','transactions');
  let budgets=await kvGet('main','budgets');
  let meta=await kvGet('main','meta');
  // 主库为空但备份存在 → 尝试恢复
  if(!tx){const btx=await kvGet('backup','transactions');if(btx){tx=btx;cats=await kvGet('backup','categories')||cats;budgets=await kvGet('backup','budgets')||budgets;meta=await kvGet('backup','meta')||meta;}}
  if(!cats||cats.length===0)cats=DEFAULT_CATEGORIES;
  state.categories=cats||[];
  state.transactions=tx||[];
  state.budgets=budgets||{};
  state.meta=Object.assign({lastExportAt:null,remindDays:14},meta||{});
  state.meta.fixedBudgets=Object.assign({...DEFAULT_FIXED},(meta&&meta.fixedBudgets)||{});
  state.rec.categoryId=(catsOf('expense')[0]||{}).id;
  render();
}
