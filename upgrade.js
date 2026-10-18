/* Monthly cost allocation: immutable per-transaction coverage. */
function allocation(t){
  if(t.allocation)return t.allocation;
  const c=catById(t.categoryId);
  return {start:t.date.slice(0,7),months:t.type==='expense'&&c&&c.nature==='periodic'?(c.periodMonths||1):1,estimated:t.type==='expense'&&c&&c.nature==='periodic',legacy:true};
}
function costIn(t,m){
  const a=allocation(t),n=Math.max(1,Number(a.months)||1),i=monthDiff(a.start,m);
  if(i<0||i>=n)return 0;
  const cents=Math.round(Number(t.amount)*100),base=Math.floor(cents/n);
  return (base+(i===n-1?cents-base*n:0))/100;
}
function periodicAvg(m,c){return state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.categoryId===c.id).reduce((s,t)=>s+costIn(t,m),0);}
function effExpByCat(m,id){return state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.categoryId===id).reduce((s,t)=>s+costIn(t,m),0);}
function monthExpense(m){return state.categories.filter(c=>c.type==='expense').reduce((s,c)=>s+effExpByCat(m,c.id),0);}
function yearExpense(m){let s=0;for(let i=1;i<=12;i++)s+=monthExpense(m.slice(0,4)+'-'+pad(i));return s;}
function allocationForm(t,edit){
 const a=t?allocation(t):{start:state.rec.date.slice(0,7),months:1,estimated:false};
 return '<div class="card" style="margin-top:12px;background:var(--surface-2)"><h3>费用归属 · 收入默认按到账月</h3><div class="field"><span>开始月份</span><input id="allocStart" type="month" value="'+a.start+'" onchange="budgetPreview()"></div><div class="field"><span>覆盖月数</span><input id="allocMonths" type="number" min="1" max="120" value="'+a.months+'" oninput="budgetPreview()"></div><label><input id="allocEstimate" type="checkbox" '+(a.estimated?'checked':'')+'> 覆盖期暂为估算</label><div class="sub" style="margin-top:8px">下一笔付款不会改变本笔。尾差归最后一个月。</div><div id="budgetPreview" style="margin-top:10px;font-weight:600"></div></div>';
}
function readAllocation(date,type){
 const start=$('#allocStart')?.value||date.slice(0,7),months=Number($('#allocMonths')?.value||1);
 if(!/^\d{4}-\d{2}$/.test(start)||!Number.isInteger(months)||months<1||months>120)throw Error('请填写有效开始月份和1—120的整数月数');
 return {start:type==='income'?date.slice(0,7):start,months:type==='income'?1:months,estimated:type==='expense'&&!!$('#allocEstimate')?.checked};
}
function budgetPreview(){
 const el=$('#budgetPreview');if(!el)return;const r=state.edit||state.rec;
 if(r.type!=='expense'){el.textContent='收入按到账月份统计，保留稳定／周期／偶发分类。';return;}
 try{const a=readAllocation(r.date,r.type),amt=calcExpr(r.amount)||0,id=r.categoryId,b=state.budgets[a.start]?.items?.[id],current=effExpByCat(a.start,id)-(state.edit?costIn(state.transactions.find(t=>t.id===r.id),a.start):0),share=costIn({amount:amt,date:r.date,allocation:a},a.start),left=Number(b||0)-current-share;
 el.textContent='首月归属 '+fmtMoney(share)+' · '+(b===undefined?'本类未设预算':left<0?'记入后本类超支 '+fmtMoney(-left):'记入后本类剩余 '+fmtMoney(left))+'（完整分配见明细）';
 }catch(e){el.textContent=e.message;}
}
const oldRenderRecord=renderRecord;
renderRecord=function(v){oldRenderRecord(v);const btn=v.querySelector('.save-btn');btn.insertAdjacentHTML('beforebegin',allocationForm(null));setAllocationDefaults();};
function setAllocationDefaults(){if(state.edit)return;const c=catById(state.rec.categoryId);if($('#allocMonths'))$('#allocMonths').value=state.rec.type==='expense'&&c?.nature==='periodic'?(c.periodMonths||1):1;if($('#allocEstimate'))$('#allocEstimate').checked=false;budgetPreview();}
const oldRefreshCat=refreshCatSection;
refreshCatSection=function(){oldRefreshCat();setAllocationDefaults();};
const oldAmountPreview=renderAmountPreview;
renderAmountPreview=function(){oldAmountPreview();budgetPreview();};
const oldRenderSheet=renderSheet;
renderSheet=function(){oldRenderSheet();if(state.edit){const t=state.transactions.find(t=>t.id===state.edit.id);$('#sheetPreview').insertAdjacentHTML('afterend',allocationForm(t,true));budgetPreview();}};
const oldSheetPreview=renderSheetPreview;
renderSheetPreview=function(){oldSheetPreview();budgetPreview();};
const oldSaveTx=saveTx;
saveTx=function(){let a;try{a=readAllocation(state.rec.date,state.rec.type);}catch(e){toast(e.message);return;}const n=state.transactions.length;oldSaveTx();if(state.transactions.length>n){state.transactions.at(-1).allocation=a;saveAll();render();}};
const oldSaveSheet=saveSheet;
saveSheet=function(){let a;try{a=readAllocation(state.edit.date,state.edit.type);}catch(e){toast(e.message);return;}if(!(calcExpr(state.edit.amount)>0))return;const t=state.transactions.find(t=>t.id===state.edit.id);t.allocation=a;oldSaveSheet();render();};
function monthCap(){return Number(state.meta.monthCaps?.[state.month]??0);}
function editCap(){modal('<h3>本月总预算</h3><div class="field"><input id="capInput" type="number" min="0" value="'+monthCap()+'"></div><button class="btn primary" onclick="saveCap()">保存</button>');}
function saveCap(){const n=Number($('#capInput').value);if(!Number.isFinite(n)||n<0)return toast('请输入非负预算');state.meta.monthCaps=state.meta.monthCaps||{};state.meta.monthCaps[state.month]=n;saveAll();closeModal(null);render();}
function renderBudgetActual(){
 const el=$('#budgetActual'),m=state.month;if(!el)return;const items=state.budgets[m]?.items||{},total=monthExpense(m),cap=monthCap();
 el.innerHTML='<div class="bud-hero '+(total>cap?'critical':'good')+'">'+(total>cap?'本月超支 '+fmtMoney(total-cap):'本月剩余 '+fmtMoney(cap-total))+'</div><p class="sub">按费用归属计算 · <button class="btn sm" onclick="editCap()">总预算 '+fmtMoney(cap)+' ✎</button></p>'+['recurring','periodic','oneoff'].map(n=>'<div class="section-title">'+NATURE_LABEL[n]+'</div><div class="budget-grid">'+state.categories.filter(c=>c.type==='expense'&&c.nature===n).map(c=>{const v=effExpByCat(m,c.id),b=items[c.id],left=Number(b||0)-v;return '<div class="btile '+(b!==undefined&&left<0?'over':'')+'" onclick="showBudgetDetail(\''+c.id+'\')"><div class="tn">'+c.icon+' '+esc(c.name)+'</div><div class="tv">'+fmtMoney(v)+'</div><div class="sub">'+(b===undefined?'未设预算':(left<0?'超支 ':'剩余 ')+fmtMoney(Math.abs(left))+' · 预算 '+fmtMoney(b))+'</div></div>';}).join('')+'</div>').join('');
}
function setBudget(id,val){const n=Number(val);if(!Number.isFinite(n)||n<0)return toast('预算须为非负金额');state.budgets[state.month]=state.budgets[state.month]||{items:{}};state.budgets[state.month].items[id]=n;saveAll();render();}
function showBudgetDetail(id){
 const c=catById(id),m=state.month,b=state.budgets[m]?.items?.[id];let sum=0;
 const tx=state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.categoryId===id&&costIn(t,m)>0).sort((a,b)=>txKey(a).localeCompare(txKey(b)));
 modal('<h3>'+c.icon+' '+esc(c.name)+' · '+monthLabel(m)+'</h3><div class="field"><span>本月预算</span><input id="detailBudget" type="number" min="0" placeholder="未设" value="'+(b??'')+'"></div><button class="btn primary" onclick="setBudget(\''+id+'\',document.getElementById(\'detailBudget\').value);closeModal(null)">保存预算</button><p style="margin-top:12px">本月归属 '+fmtMoney(effExpByCat(m,id))+' · 点记录编辑覆盖期</p>'+tx.map(t=>{const v=costIn(t,m),a=allocation(t),prev=sum;sum+=v;const over=b===undefined?0:Math.max(0,sum-b)-Math.max(0,prev-b);return '<div class="row" onclick="closeModal(null);openEditSheet(\''+t.id+'\')"><div class="mid"><div class="nm">'+fmtMoney(v)+(a.estimated?' · 估算':'')+'</div><div class="sub">'+esc(t.note||'')+' · '+t.date+' 付款 '+fmtMoney(t.amount)+'<br>覆盖 '+a.start+' 至 '+shiftMonth(a.start,a.months-1)+(a.legacy?' · 旧记录请核对':'')+'<br>'+ (b===undefined?'未设预算':over>0?'本笔预算外 '+fmtMoney(over):'本笔后剩余 '+fmtMoney(Math.max(0,b-sum)))+'</div></div></div>';}).join('')+'<button class="btn" style="margin-top:12px" onclick="closeModal(null)">关闭</button>');
}
const oldTxRow=txRowHTML;
txRowHTML=function(t,d){let h=oldTxRow(t,d);if(t.type==='expense'){const a=allocation(t);if(a.months>1)h=h.replace('</div></div>','<div class="sub">归属 '+a.start+' 起 '+a.months+'个月'+(a.estimated?' · 估算':'')+(a.legacy?' · 待核对':'')+'</div></div></div>');}return h;};
const oldMonth=renderMonth;
renderMonth=function(v){oldMonth(v);const m=state.month,cash=sumOf(txInMonth(m),'expense');v.insertAdjacentHTML('beforeend','<div class="card"><h3>实际付款 · 与归属成本分别查看</h3><div class="kv"><span>本月实际付出</span><b>'+fmtMoney(cash)+'</b></div><div class="sub">上方支出与结余按费用归属计算，不等于账户余额。</div></div>');};
function yearExpenseItems(y){return state.categories.filter(c=>c.type==='expense').map((c,i)=>{let value=0;for(let n=1;n<=12;n++)value+=effExpByCat(y+'-'+pad(n),c.id);return {...c,value,color:'hsl('+Math.round(i*137.508%360)+',60%,46%)'};}).filter(c=>c.value>0);}
function suggestBudget(c,m){const tx=state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&t.categoryId===c.id);if(!tx.length)return 0;const first=tx.map(t=>allocation(t).start).sort()[0];let n=0,total=0;for(let i=1;i<=12;i++){const mm=shiftMonth(m,-i);if(mm<first)break;n++;total+=effExpByCat(mm,c.id);}return n?total/n:0;}
const oldSettings=renderSettings;
renderSettings=function(v){oldSettings(v);v.insertAdjacentHTML('afterbegin','<div class="banner">新版以费用归属统计支出。旧周期记录暂按付款月＋分类周期估算，请逐笔核对覆盖期。换网址或设备时，请从旧账本导出 JSON，再在此导入；数据不会自动同步。</div>');};
const oldRender=render;
render=function(){let changed=false;state.transactions.forEach(t=>{if(!t.allocation){t.allocation=allocation(t);changed=true;}});if(changed)saveAll();oldRender();};
