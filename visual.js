/* Four focused spaces: record, review, allocate, trends. */
function allocationForm(t,edit){
 const r=edit?state.edit:state.rec;
 if(r?.type==='income')return '<p class="gentle-note">💰 收入记在到账月，稳定、周期和偶发照常分类。</p>';
 const c=catById(r?.categoryId),a=t?allocation(t):{start:state.rec.date.slice(0,7),months:c?.nature==='periodic'?(c.periodMonths||1):1,estimated:false};
 return '<details class="allocation-details" '+(c?.nature==='periodic'?'open':'')+'><summary>🗓️ 费用归属 <span>付款一次，按月看清</span></summary><div class="allocation-body"><div class="field"><span>开始月份</span><input id="allocStart" type="month" value="'+a.start+'" onchange="budgetPreview()"></div><div class="field"><span>覆盖月数</span><input id="allocMonths" type="number" min="1" max="120" value="'+a.months+'" oninput="budgetPreview()"></div><label class="estimate-label"><input id="allocEstimate" type="checkbox" '+(a.estimated?'checked':'')+'> 覆盖期暂为估算</label><div class="gentle-note">下一次付款不会改变这一笔的覆盖期。</div></div></details><div id="budgetPreview" class="allocation-preview"></div>';
}
function budgetPreview(){
 const el=$('#budgetPreview');if(!el)return;const r=state.edit||state.rec;if(!r||r.type==='income'){el.textContent='';return;}
 try{const a=readAllocation(r.date,r.type),amt=calcExpr(r.amount)||0;if(!amt){el.textContent='';return;}const t={date:r.date,amount:amt,allocation:a};el.textContent=a.months>1?'🗓️ '+a.start+' 至 '+shiftMonth(a.start,a.months-1)+' · 首月计入 '+fmtMoney(costIn(t,a.start))+'，尾差归最后一月':'📌 计入 '+a.start+' 的费用';}catch(e){el.textContent=e.message;}
}
renderTodaySummary=function(){
 const txs=state.transactions.filter(t=>!t.deletedAt&&t.date===todayStr());
 return '<div class="today-strip"><div><span>今天记下的支出</span><b id="todayExp">'+fmtMoney(sumOf(txs,'expense'))+'</b></div><div><span>今日收入</span><b class="today-income">'+fmtMoney(sumOf(txs,'income'))+'</b></div></div>';
};
renderRecord=function(v){
 oldRenderRecord(v);
 v.querySelector('h1').textContent='记一笔 ✍️';v.querySelector('.topbar .sub').textContent='把生活记下来，慢慢就清楚了';
 const btn=v.querySelector('.save-btn');btn.insertAdjacentHTML('beforebegin',allocationForm(null,false));btn.textContent='记好这一笔 ✓';
 const date=v.querySelector('input[type=date]');date.onchange=function(){const previous=state.rec.date.slice(0,7);state.rec.date=this.value;const a=$('#allocStart');if(a&&a.value===previous)a.value=this.value.slice(0,7);budgetPreview();};
 setAllocationDefaults();
};
const simpleRefreshCat=oldRefreshCat;
refreshCatSection=function(){simpleRefreshCat();const d=document.querySelector('.allocation-details');if(d){const before=$('#budgetPreview');if(before)before.remove();d.outerHTML=allocationForm(null,false);}else if(state.rec.type==='expense'){const b=document.querySelector('.save-btn');if(b){document.querySelector('.gentle-note')?.remove();b.insertAdjacentHTML('beforebegin',allocationForm(null,false));}}setAllocationDefaults();};
renderMonth=function(v){
 oldMonth(v);v.querySelector('.topbar .sub').textContent=monthLabel(state.month)+' · 看看钱去了哪里';
 const labels=v.querySelectorAll('.tile .lb');labels.forEach(el=>{if(el.textContent==='本月支出')el.textContent='本月归属费用';if(el.textContent==='本月结余')el.textContent='按归属计算的结余';});
 v.querySelectorAll('.tile .dl').forEach(el=>{if(el.textContent==='不摊入预算')el.textContent='按本月归属统计';});
 const cash=sumOf(txInMonth(state.month),'expense');v.insertAdjacentHTML('beforeend','<div class="card quiet-card"><h3>💳 实际付款</h3><div class="cash-line"><span>本月付出</span><strong>'+fmtMoney(cash)+'</strong></div><p class="gentle-note">付款看现金流，归属看生活成本。结余不等于账户余额。</p></div>');
};
const plainPoolCard=poolCard;
poolCard=function(letter,name,cap,used,left){return plainPoolCard(letter,name,cap,used,left).replace('pool-card ','pool-card '+(letter==='A'?'pool-a ':'pool-b '));};
const plainPoolsHTML=poolsHTML;
poolsHTML=function(m,compact){return plainPoolsHTML(m,compact).replace('我的预算池','三个池子，各有分工').replace('月总预算 · 底线','☂️ 月总预算 · 底线').replace('基本生活 · 固定池','🌿 基本生活 · 固定池').replace('额外消费 · 灵活池','🍊 额外消费 · 灵活池').replace('首次使用：请确认 A、B 划分。当前为按已有分类预算生成的建议；无分类预算时 A 暂按 ¥0。','🌱 先确认本月的池子划分，再安心记账。初始建议来自分类预算；没有参考时，A 暂按 ¥0。');};
renderBudgetPage=function(v){const m=state.month;v.innerHTML='<div class="topbar"><div><h1>预算 🎯</h1><div class="sub">生活有底，快乐有余</div></div>'+gearBtn()+'</div><div class="month-switch"><button class="btn sm" aria-label="上个月" onclick="shiftStat(-1)">‹</button><strong>'+monthLabel(m)+'</strong><button class="btn sm" aria-label="下个月" onclick="shiftStat(1)">›</button></div><div id="budgetActual"></div><details class="card budget-tools"><summary>✨ 分类预算小助手</summary><p class="gentle-note">以近12个月的归属费用为参考，帮你安排每个小池子。填充会更新本月分类计划，不会改变已确认的 A、B 额度。</p><button class="btn" onclick="fillBudgetFromSuggest()">生成分类参考</button></details>';renderBudgetActual();};
const visualTrend=renderTrend;
renderTrend=function(v){visualTrend(v);v.querySelector('h1').textContent='趋势 📈';v.querySelector('.topbar .sub').textContent=state.month.slice(0,4)+'年 · 拉远一点，看见变化';v.querySelectorAll('.lb').forEach(el=>{if(el.textContent==='年度支出')el.textContent='全年归属费用';if(el.textContent==='年度结余')el.textContent='全年归属收支差额';});v.insertAdjacentHTML('beforeend','<p class="gentle-note">🗓️ 年度费用包含已录入记录分配到本年未来月份的金额。</p>');};
function saveCheer(amt){const r=['记下啦，脑袋可以少装一件事 🧠','这笔收好，继续生活 🌱','账本又清楚了一点 ✨','好，交给我记着 📌'];return r[Math.floor(Math.random()*r.length)]+' · '+fmtMoney(amt);}
renderTabbar=function(){const tabs=[['record','每日记账','✍️'],['month','本月','📊'],['budget','预算','🎯'],['trend','趋势','📈']];$('#tabbar').innerHTML=tabs.map(([k,n,i])=>'<button aria-label="'+n+'" '+(state.view===k?'aria-current="page"':'')+' class="'+(state.view===k?'on':'')+'" onclick="go(\''+k+'\')"><span class="ti">'+i+'</span><span>'+n+'</span></button>').join('');document.body.dataset.tab=state.view;};
