/* Two spending envelopes; the monthly ceiling is their sum, never extra money. */
function cents(n){return Math.round(Number(n||0)*100);}
function poolConfig(m){
 const saved=state.meta.poolPlans?.[m],items=state.budgets[m]?.items||{};
 const cap=cents(state.meta.monthCaps?.[m]??(saved?saved.cap/100:0));
 const assigned=state.categories.filter(c=>c.type==='expense'&&c.nature!=='oneoff'&&!c.retired).reduce((sum,c)=>sum+cents(items[c.id]),0);
 const moves=saved?.moves||[];
 return {cap,baseA:assigned,categorySum:assigned,moves:moves.map(t=>({...t,inactive:t.inactive||((t.categorySum??saved?.categorySum??saved?.baseA)!==assigned)}))};
}
function poolStats(m,extra){
 const config=poolConfig(m),moves=config.moves||[],shift=moves.reduce((s,t)=>s+(t.inactive?0:t.toA),0);
 let usedA=0,usedB=0;
 state.transactions.filter(t=>!t.deletedAt&&t.type==='expense'&&(!extra||t.id!==extra.exclude)).forEach(t=>{
  const c=catById(t.categoryId),value=cents(costIn(t,m));if(c?.nature==='oneoff')usedB+=value;else usedA+=value;
 });
 if(extra?.transaction){const c=catById(extra.transaction.categoryId),v=cents(costIn(extra.transaction,m));if(c?.nature==='oneoff')usedB+=v;else usedA+=v;}
 const capA=config.baseA+shift,capB=config.cap-capA;
 return {config,cap:config.cap,capA,capB,usedA,usedB,leftA:capA-usedA,leftB:capB-usedB,left:config.cap-usedA-usedB};
}
function poolMoney(n){return fmtMoney(n/100);}
function poolAdvice(p){
 if(p.left<0)return '全月已超支 '+poolMoney(-p.left)+'。A、B之间调拨不能补足总额缺口。';
 if(p.leftA<0)return 'A 固定池额度不足 '+poolMoney(-p.leftA)+'；B 可调入补足，调拨后全月仍剩 '+poolMoney(p.left)+'。';
 if(p.leftB<0)return 'B 灵活池额度不足 '+poolMoney(-p.leftB)+'；A 可调入补足，调拨后全月仍剩 '+poolMoney(p.left)+'。';
 return 'A、B 均在额度内，全月还可安排 '+poolMoney(p.left)+'。';
}
function poolCard(letter,name,cap,used,left){
 const negative=left<0,ratio=cap>0?Math.min(100,used/cap*100):used>0?100:0;
 return '<div class="pool-card '+(negative?'pool-deficit':'')+'"><div class="pool-name">'+letter+' · '+name+'</div><div class="pool-caption">'+(negative?'额度不足':'可用余额')+'</div><div class="pool-number">'+poolMoney(Math.abs(left))+'</div><div class="pool-track"><i style="width:'+ratio+'%"></i></div><div class="pool-facts"><span>已用 '+poolMoney(used)+'</span><span>额度 '+poolMoney(cap)+'</span></div></div>';
}
function poolsHTML(m,compact){
 const p=poolStats(m),warn=p.leftA<0||p.leftB<0;
 let action='';
 if(p.left>=0&&p.leftA<0)action='<button class="btn primary" onclick="transferDialog(\''+m+'\',\'B\','+(-p.leftA)+')">B → A 补足 '+poolMoney(-p.leftA)+'</button>';
 if(p.left>=0&&p.leftB<0)action='<button class="btn primary" onclick="transferDialog(\''+m+'\',\'A\','+(-p.leftB)+')">A → B 补足 '+poolMoney(-p.leftB)+'</button>';
 return '<section class="pool-overview"><div class="pool-heading"><div><b>我的预算池</b><div class="sub">'+monthLabel(m)+' · 按费用归属</div></div><button class="btn sm" onclick="poolPlanDialog(\''+m+'\')">设置额度</button></div>'+
 (p.config.unconfirmed?'<div class="pool-help">首次使用：请确认 A、B 划分。当前为按已有分类预算生成的建议；无分类预算时 A 暂按 ¥5,500。</div>':'')+
 '<div class="pool-pair">'+poolCard('A','基本生活 · 固定池',p.capA,p.usedA,p.leftA)+poolCard('B','额外消费 · 灵活池',p.capB,p.usedB,p.leftB)+'</div>'+
 '<div class="pool-advice '+(p.left<0?'pool-critical':warn?'pool-attention':'')+'">'+poolAdvice(p)+'</div>'+
 '<div class="pool-total '+(p.left<0?'pool-critical':'')+'"><div><b>月总预算 · 底线</b><div class="sub">A＋B，不能重复分配</div></div><div style="text-align:right"><b>'+(p.left<0?'超支 ':'剩余 ')+poolMoney(Math.abs(p.left))+'</b><div class="sub">已用 '+poolMoney(p.usedA+p.usedB)+' / '+poolMoney(p.cap)+'</div></div></div>'+
 '<div class="pool-actions">'+action+'<button class="btn" onclick="transferDialog(\''+m+'\',\'A\')">A ↔ B 调拨</button>'+(compact?'<button class="btn ghost" onclick="state.month=\''+m+'\';go(\'budget\')">分类明细 ›</button>':'')+'</div>'+
 '<div class="pool-help">A 含每日固定＋周期性；B 含偶发性。分类超过计划不等于 A 超额；调拨只调整用途，不改变月总额。</div></section>';
}
function poolPlanDialog(m){
 const p=poolStats(m);modal('<h3>'+monthLabel(m)+' · 预算池设置</h3><p>基本生活按固定、周期类别预算自动合计，额外消费为月总预算减去基本生活。分类合计变化后，按新预算重新分配，旧调拨保留为历史。</p><div class="field"><span>月总预算</span><input id="poolCap" type="number" min="0" step="0.01" value="'+p.cap/100+'" oninput="planPreview()"></div><div class="field"><span>基本生活 · 分类预算合计</span><input id="poolBaseA" readonly type="number" min="0" step="0.01" value="'+p.config.baseA/100+'" oninput="planPreview()"></div><div id="planPreview" class="pool-help"></div><div class="mrow"><button class="btn" onclick="closeModal(null)">取消</button><button class="btn primary" onclick="savePoolPlan(\''+m+'\')">保存计划</button></div>');window.poolEditingMonth=m;planPreview();
}
function planPreview(){const m=window.poolEditingMonth,p=poolStats(m),cap=cents($('#poolCap').value),a=cents($('#poolBaseA').value),shift=p.capA-p.config.baseA;$('#planPreview').textContent='B 初始额度 '+poolMoney(cap-a)+'；计入历史调拨后 A '+poolMoney(a+shift)+'，B '+poolMoney(cap-a-shift)+'。';}
function savePoolPlan(m){
 const capVal=Number($('#poolCap').value),aVal=Number($('#poolBaseA').value),cap=cents(capVal),a=cents(aVal),old=poolConfig(m),shift=(old.moves||[]).reduce((s,t)=>s+(t.inactive?0:t.toA),0);
 if(!Number.isFinite(capVal)||!Number.isFinite(aVal)||cap<0||a<0||a>cap||a+shift<0||a+shift>cap)return toast('请输入有效金额；调拨后的 A、B 额度都不能为负');
 state.meta.poolPlans=state.meta.poolPlans||{};state.meta.poolPlans[m]={cap,baseA:a,categorySum:a,moves:old.moves||[]};state.meta.monthCaps=state.meta.monthCaps||{};state.meta.monthCaps[m]=cap/100;saveAll();closeModal(null);render();toast('月度额度已更新');
}
function transferDialog(m,from,amount){
 const p=poolStats(m);modal('<h3>A、B 之间调拨</h3><p>'+monthLabel(m)+' · 全月余额 '+poolMoney(p.left)+' 保持不变。只能调出来源池尚未使用的余额。</p><div class="field"><span>方向</span><select id="poolFrom"><option value="A" '+(from==='A'?'selected':'')+'>A 固定池 → B 灵活池</option><option value="B" '+(from==='B'?'selected':'')+'>B 灵活池 → A 固定池</option></select></div><div class="field"><span>金额</span><input id="poolMove" type="number" min="0.01" step="0.01" value="'+(amount?amount/100:'')+'"></div><div class="field"><span>原因</span><input id="poolReason" type="text" placeholder="选填，例如聚餐增加"></div><div class="pool-help">A 可调出 '+poolMoney(Math.max(0,p.leftA))+' · B 可调出 '+poolMoney(Math.max(0,p.leftB))+'</div><div class="mrow"><button class="btn" onclick="closeModal(null)">取消</button><button class="btn primary" onclick="savePoolMove(\''+m+'\')">确认调拨</button></div>');
}
function applyPoolMove(m,from,value,reason){
 const p=poolStats(m),n=cents(value);if(!Number.isFinite(Number(value))||n<=0)throw Error('请输入大于零的金额');if(from!=='A'&&from!=='B')throw Error('调拨方向无效');
 if(n>(from==='A'?p.leftA:p.leftB))throw Error('调出金额超过来源池的可用余额');
 state.meta.poolPlans=state.meta.poolPlans||{};const config=JSON.parse(JSON.stringify(p.config));delete config.unconfirmed;
 config.moves=config.moves||[];config.moves.push({categorySum:config.categorySum,id:uid(),toA:from==='A'?-n:n,reason:reason||'',at:Date.now()});state.meta.poolPlans[m]=config;
 return poolStats(m);
}
function savePoolMove(m){try{applyPoolMove(m,$('#poolFrom').value,$('#poolMove').value,$('#poolReason').value.trim());saveAll();closeModal(null);render();toast('调拨完成，月总额保持不变');}catch(e){toast(e.message);}}
function poolHistory(m){const p=poolStats(m),shift=p.capA-p.config.baseA;return '<details class="card"><summary>预算调整记录 · '+(p.config.moves||[]).length+' 次</summary><p class="pool-help">A 初始 '+poolMoney(p.config.baseA)+'，净调入 '+poolMoney(shift)+'，当前 '+poolMoney(p.capA)+'。B 初始 '+poolMoney(p.cap-p.config.baseA)+'，当前 '+poolMoney(p.capB)+'。分类参考预算不会因池间调拨而自动改写。</p>'+[...(p.config.moves||[])].reverse().map(t=>'<div class="row"><div class="mid"><div class="nm">'+(t.toA>0?'B → A':'A → B')+' '+poolMoney(Math.abs(t.toA))+'</div><div class="sub">'+esc(new Date(t.at).toLocaleString('zh-CN'))+' '+esc(t.reason)+'</div></div></div>').join('')+'</details>';}
function categoryPoolDetails(m,natures,title){
 const items=state.budgets[m]?.items||{},cats=state.categories.filter(c=>c.type==='expense'&&natures.includes(c.nature));let exceeded=0;
 const rows=cats.map(c=>{const actual=effExpByCat(m,c.id),budget=items[c.id];if(budget!==undefined&&cents(actual)>cents(budget))exceeded++;return '<div class="pool-category" onclick="showBudgetDetail(\''+c.id+'\')"><span>'+c.icon+' '+esc(c.name)+'</span><div><b>'+fmtMoney(actual)+'</b><div class="sub">'+(budget===undefined?'未设分类参考':cents(actual)>cents(budget)?'<span class="category-attention">超过分类计划 '+fmtMoney(actual-budget)+'</span>':'分类余量 '+fmtMoney(budget-actual))+'</div></div></div>';}).join('');
 return '<details class="card pool-details"><summary>'+title+' <span class="sub">'+(exceeded?exceeded+' 类超过计划':'查看分类')+'</span></summary><div class="pool-help">分类计划用于回顾消费结构；是否需要调拨，请以上方 A、B 池余额为准。</div>'+rows+'</details>';
}
renderBudgetActual=function(){const el=$('#budgetActual');if(!el)return;const m=state.month;el.innerHTML=poolsHTML(m,false)+categoryPoolDetails(m,['recurring','periodic'],'A 内部分类参考')+categoryPoolDetails(m,['oneoff'],'B 偶发消费明细')+poolHistory(m);};
renderBudgetPage=function(v){const m=state.month;v.innerHTML='<div class="topbar"><div><h1>预算池</h1><div class="sub">先看 A、B，再看分类</div></div><div><button class="btn sm" onclick="shiftStat(-1)">‹</button><span style="padding:0 6px">'+m+'</span><button class="btn sm" onclick="shiftStat(1)">›</button></div></div><div id="budgetActual"></div><button class="btn" onclick="fillBudgetFromSuggest()">按近12月成本填充分类参考</button>';renderBudgetActual();};
const beforePoolsRecord=renderRecord;
renderRecord=function(v){beforePoolsRecord(v);const m=state.lastBudgetMonth||state.rec.date.slice(0,7);v.querySelector('.topbar').insertAdjacentHTML('afterend',poolsHTML(m,true));};
const beforePoolsMonth=renderMonth;
renderMonth=function(v){beforePoolsMonth(v);v.querySelector('.topbar').insertAdjacentHTML('afterend',poolsHTML(state.month,true));};
const beforePoolsSave=saveTx;
saveTx=function(){const n=state.transactions.length,m=state.rec.date.slice(0,7);beforePoolsSave();if(state.transactions.length>n){state.lastBudgetMonth=m;render();}};
const beforePoolsPreview=budgetPreview;
budgetPreview=function(){const el=$('#budgetPreview');if(!el)return;const r=state.edit||state.rec;if(r.type!=='expense'){beforePoolsPreview();return;}
 try{const a=readAllocation(r.date,r.type),t={type:'expense',date:r.date,categoryId:r.categoryId,amount:calcExpr(r.amount)||0,allocation:a},m=a.start,p=poolStats(m,{transaction:t,exclude:state.edit?.id}),c=catById(r.categoryId),label=c?.nature==='oneoff'?'B 灵活池':'A 固定池';
 el.innerHTML='<div>本笔首月归属 '+fmtMoney(costIn(t,m))+' → '+label+'</div><div class="pool-help">'+m+' 记入后：A '+(p.leftA<0?'不足 ':'剩 ')+poolMoney(Math.abs(p.leftA))+' · B '+(p.leftB<0?'不足 ':'剩 ')+poolMoney(Math.abs(p.leftB))+' · 全月 '+(p.left<0?'超支 ':'剩 ')+poolMoney(Math.abs(p.left))+'</div>'+(a.months>1?'<div class="pool-help">覆盖 '+a.start+' 至 '+shiftMonth(a.start,a.months-1)+'，各月分别占用预算。</div>':'');
 }catch(e){el.textContent=e.message;}
};
editCap=function(){poolPlanDialog(state.month);};
const beforePoolsRefresh=refreshRecordLists;
refreshRecordLists=function(from){beforePoolsRefresh(from);const el=document.querySelector('.pool-overview');if(el)el.outerHTML=poolsHTML(state.lastBudgetMonth||state.rec.date.slice(0,7),true);budgetPreview();};
