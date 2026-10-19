import { forecast, summarizeForecast, compareFinancing, buildLenderPack, routeIntent, parseForecastCsv } from "./engine.js";

const $ = selector => document.querySelector(selector);
const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
const money = (amount, currency = state?.business?.currency ?? "THB") => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
let state;
let currentRows = [];
let currentMultiplier = 1;
let activity = [];
let toastTimer;
const pageLabels = { overview: "Overview", forecast: "Cash forecast", financing: "Financing options", evidence: "Evidence pack" };

async function loadCase() {
  if (window.FLOWPILOT_CASE) return window.FLOWPILOT_CASE;
  const data = await fetch("../data/sme_case.json").then(response => {
    if (!response.ok) throw new Error("Could not load the sample case. Run the local web server from the README.");
    return response.json();
  });
  try {
    const importedWeeks = JSON.parse(sessionStorage.getItem("flowpilot-weeks") || "null");
    if (Array.isArray(importedWeeks)) data.weeks = importedWeeks;
    const savedMultiplier = Number(sessionStorage.getItem("flowpilot-receipt-multiplier"));
    if ([1, 0.85, 0.7].includes(savedMultiplier)) currentMultiplier = savedMultiplier;
  } catch {}
  return data;
}

async function init() {
  state = await loadCase();
  setText("#businessName", state.business.name);
  setText("#businessSector", state.business.sector);
  setText("#chatBusiness", state.business.name);
  setText("#asOf", `Sample data as of ${state.business.dataAsOf}`);
  setText("#forecastAsOf", `Sample data as of ${state.business.dataAsOf}`);
  setText("#fundingAsOf", money(state.business.fundingNeed));
  setText("#cashToday", money(state.business.openingCash));
  setText("#reserve", money(state.business.cashReserve));
  setText("#fundingNeed", money(state.business.fundingNeed));
  if ($("#scenarioSelect")) $("#scenarioSelect").value = String(currentMultiplier);
  $("#scenarioSelect")?.addEventListener("change", event => { currentMultiplier = Number(event.target.value); sessionStorage.setItem("flowpilot-receipt-multiplier", String(currentMultiplier)); refreshForecast(); addActivity(`Scenario changed to ${Math.round((1 - currentMultiplier) * 100)}% receipts decline`); });
  $("#chatForm")?.addEventListener("submit", event => { event.preventDefault(); const input = $("#chatInput"); const value = input.value.trim(); if (!value) return; input.value = ""; ask(value); });
  document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => ask(button.dataset.prompt)));
  $("#explainAlert")?.addEventListener("click", () => ask("Explain the reserve alert"));
  $("#packButton")?.addEventListener("click", downloadPack);
  $("#downloadPack")?.addEventListener("click", downloadPack);
  $("#downloadLog")?.addEventListener("click", downloadActivity);
  $("#csvInput")?.addEventListener("change", handleCsv);
  $("#helpButton")?.addEventListener("click", showDisclaimer);
  $("#disclaimerButton")?.addEventListener("click", showDisclaimer);
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
  refreshForecast();
  renderOptions();
  loadActivity();
  if (!activity.length) addActivity("Loaded fictional café case");
}

function renderRoute() {
  const requested = window.location.hash.slice(1);
  const fallbackPage = document.body.dataset.defaultPage || "overview";
  const page = Object.hasOwn(pageLabels, requested) ? requested : fallbackPage;
  document.querySelectorAll(".page-view").forEach(view => {
    view.hidden = view.dataset.page !== page;
  });
  document.querySelectorAll("[data-page-link]").forEach(link => {
    const active = link.dataset.pageLink === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("#pageLabel").textContent = pageLabels[page];
  document.title = `${pageLabels[page]} | FlowPilot`;
  window.scrollTo(0, 0);
}

function refreshForecast() {
  currentRows = forecast(state, { receiptMultiplier: currentMultiplier });
  const summary = summarizeForecast(currentRows);
  setText("#minCash", money(summary.minimumCash));
  setText("#minWeekTag", `Week ${summary.minimumWeek}`);
  const breach = summary.firstBreach;
  if (breach) {
    $("#primaryAlert")?.classList.remove("safe");
    setText("#alertTitle", `Reserve alert · Week ${breach.week} is below the owner’s cash floor`);
    setText("#alertText", `Projected closing cash ${money(breach.closing)} vs reserve ${money(state.business.cashReserve)}. The lowest point is ${money(summary.minimumCash)} in Week ${summary.minimumWeek}.`);
    setText("#chartStatus", `First reserve breach · W${breach.week}`);
    setText("#nextStepText", `Review receipts, supplier timing, and the ${money(state.business.fundingNeed)} working-capital scenario before committing to new spending.`);
  } else {
    $("#primaryAlert")?.classList.add("safe");
    setText("#alertTitle", "Forecast remains above the owner’s cash floor");
    setText("#alertText", `Lowest projected closing cash is ${money(summary.minimumCash)} in Week ${summary.minimumWeek}, compared with the ${money(state.business.cashReserve)} reserve.`);
    setText("#chartStatus", "No reserve breach in this scenario");
    setText("#nextStepText", "Review the assumptions and confirm expected receipts and supplier due dates before relying on this scenario.");
  }
  renderChart(currentRows);
  renderTable(currentRows);
}

function renderChart(rows) {
  if (!$("#chart")) return;
  const width = 760, height = 205, left = 48, right = 14, top = 12, bottom = 28;
  const values = [...rows.map(row => row.closing), state.business.cashReserve];
  const low = Math.min(0, Math.floor(Math.min(...values) / 50000) * 50000);
  const high = Math.ceil(Math.max(...values) / 50000) * 50000;
  const span = Math.max(1, high - low);
  const x = i => left + i * (width - left - right) / Math.max(1, rows.length - 1);
  const y = value => top + (high - value) / span * (height - top - bottom);
  const points = rows.map((row, index) => `${x(index)},${y(row.closing)}`).join(" ");
  const reserveY = y(state.business.cashReserve);
  const grid = Array.from({length:4},(_,i)=>{ const val=high-i*span/3; const yy=y(val); return `<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="#edf2f2"/><text x="${left-7}" y="${yy+3}" text-anchor="end" fill="#83979e" font-size="10">${compact(val)}</text>`; }).join("");
  const labels = rows.map((row,index) => index % 2 === 0 || index === rows.length-1 ? `<text x="${x(index)}" y="${height-7}" text-anchor="middle" fill="#83979e" font-size="10">W${row.week}</text>` : "").join("");
  const dots = rows.map((row,index)=>`<circle cx="${x(index)}" cy="${y(row.closing)}" r="${row.belowReserve?3.8:2.8}" fill="${row.belowReserve?"#d99a35":"#14978b"}" stroke="white" stroke-width="1.5"><title>Week ${row.week}: ${money(row.closing)}</title></circle>`).join("");
  $("#chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Projected closing cash over ${rows.length} weeks. Dashed line marks the cash reserve.">${grid}<line x1="${left}" y1="${reserveY}" x2="${width-right}" y2="${reserveY}" stroke="#d99a35" stroke-dasharray="4 4" stroke-width="1.5"/><polyline points="${points}" fill="none" stroke="#159b8f" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
  $("#chartRange").textContent = `${money(rows[0].closing)} → ${money(rows.at(-1).closing)}`;
}

function compact(value) { return new Intl.NumberFormat("en", { notation:"compact", maximumFractionDigits:0 }).format(value); }

function renderTable(rows) {
  if (!$("#forecastRows")) return;
  $("#forecastRows").innerHTML = rows.map(row => `<tr><td>W${row.week} <span class="muted-date">${row.starting ?? ""}</span></td><td>${money(row.receipts)}</td><td>${money(row.expenses)}</td><td class="${row.belowReserve?"below":""}">${money(row.closing)}</td><td class="${row.belowReserve?"below":"ok"}">${row.belowReserve?"Below floor":"On track"}</td></tr>`).join("");
}

function renderOptions() {
  if (!$("#optionCards")) return;
  const options = compareFinancing(state);
  $("#optionCards").innerHTML = options.map((option, index) => {
    const tag = option.fullFit ? (index===0 ? "Full fit · lowest modeled cost" : "Full amount fits") : option.partialFit ? "Partial amount only" : "Check criteria";
    return `<div class="option-card ${index===0&&option.fullFit?"recommended":""}"><div class="option-name">${escapeHtml(option.name)}<small>${escapeHtml(option.type)}</small></div><div class="option-metric"><span>Coverage</span><b>${Math.round(option.coverage*100)}% · ${money(option.funded)}</b></div><div class="option-metric"><span>Monthly payment</span><b>${money(option.monthlyPayment)}</b></div><div class="option-metric"><span>Est. total cost*</span><b>${money(option.estimatedTotalCost)}</b></div><span class="fit-tag ${option.fullFit?"":"partial"}">${tag}</span></div>`;
  }).join("") + `<p class="panel-intro">*Modeled interest plus fee using the displayed APR and term. Terms are synthetic; actual pricing and eligibility vary.</p>`;
}

function ask(text) {
  appendMessage("user", text);
  const route = routeIntent(text);
  if (route.intent === "forecast") {
    const summary = summarizeForecast(currentRows);
    const message = `In the ${Math.round(currentMultiplier*100)}% receipts scenario, cash ends at ${money(summary.endingCash)}. The lowest point is ${money(summary.minimumCash)} in Week ${summary.minimumWeek}.${summary.firstBreach?` The first reserve breach is Week ${summary.firstBreach.week} at ${money(summary.firstBreach.closing)}.`:" No reserve breach appears."}`;
    appendMessage("assistant", message); addActivity("Generated 13-week forecast");
  } else if (route.intent === "stress") {
    const multiplier = Math.max(0,1-route.percent/100);
    const rows = forecast(state,{receiptMultiplier:multiplier});
    const summary = summarizeForecast(rows);
    const first = summary.firstBreach;
    appendMessage("assistant", `With receipts ${route.percent}% lower and expenses unchanged, the lowest projected cash is ${money(summary.minimumCash)} in Week ${summary.minimumWeek}. ${first?`The reserve is first breached in Week ${first.week}, at ${money(first.closing)}.`:"The forecast stays above the owner-set reserve."} This is a sensitivity scenario, not a prediction.`);
    if ($("#scenarioSelect")) $("#scenarioSelect").value = String(multiplier); currentMultiplier=multiplier; sessionStorage.setItem("flowpilot-receipt-multiplier", String(multiplier)); refreshForecast(); addActivity(`Ran receipts stress test: -${route.percent}%`);
  } else if (route.intent === "compare") {
    const amount = route.amount ?? state.business.fundingNeed;
    const options = compareFinancing(state,amount);
    const best = options.find(option=>option.fullFit);
    const partial = options.find(option=>option.partialFit);
    const summary = best ? `${best.name} covers the full ${money(amount)} request under the sample criteria, with an estimated monthly payment of ${money(best.monthlyPayment)} and modeled total cost of ${money(best.estimatedTotalCost)}. ${partial?`${partial.name} covers only ${money(partial.funded)} based on the sample receivables.`:""}` : `No illustrated option meets all sample criteria for ${money(amount)}.`;
    appendMessage("assistant", `${summary}\nI ranked simulated terms by full amount coverage, then modeled cost. These are not real offers; verify terms and affordability with a qualified provider.`);
    addActivity(`Compared illustrative financing for ${money(amount)}`);
  } else if (route.intent === "explain") {
    const row = currentRows.find(item=>item.belowReserve);
    if (!row) appendMessage("assistant", `No week falls below the ${money(state.business.cashReserve)} owner-set reserve in the current scenario. The lowest forecast balance is ${money(summarizeForecast(currentRows).minimumCash)}.`);
    else appendMessage("assistant", `The first alert is Week ${row.week} (${row.starting ?? "forecast week"}). It opens at ${money(row.opening)}, receives ${money(row.receipts)}, and pays ${money(row.expenses)} in scheduled costs, leaving ${money(row.closing)}. That is ${money(state.business.cashReserve-row.closing)} below the owner’s ${money(state.business.cashReserve)} reserve. The alert comes from the arithmetic in the forecast rows; it is not a credit assessment.`);
    addActivity("Explained reserve alert with source figures");
  } else if (route.intent === "pack") {
    appendMessage("assistant", "I’ve prepared a lender-readiness summary with the forecast, assumptions, and illustrative comparison. It is a review aid, not a loan application or credit decision."); downloadPack(); addActivity("Created synthetic lender-readiness pack");
  } else {
    appendMessage("assistant", "Try: “Show the forecast”, “What if receipts fall 15%?”, “Compare financing for THB 120000”, or “Explain the reserve alert”. I can calculate and explain scenarios; I cannot submit applications or move money.");
  }
}

function appendMessage(role,text) {
  if (!$("#chatMessages")) return;
  const wrap=document.createElement("div"); wrap.className=`message ${role}`;
  const avatar=document.createElement("span"); avatar.className="message-avatar"; avatar.textContent=role==="assistant"?"F":"You";
  const body=document.createElement("div"); body.className="message-body";
  if(role==="assistant"){const label=document.createElement("b");label.textContent="FlowPilot";body.append(label);}
  const p=document.createElement("p");p.textContent=text;body.append(p);wrap.append(avatar,body);$("#chatMessages").append(wrap);$("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;
}

function addActivity(label) {
  const item={time:new Date().toISOString(),event:label}; activity.unshift(item); activity=activity.slice(0,6);
  try { sessionStorage.setItem("flowpilot-activity", JSON.stringify(activity)); } catch {}
  renderActivity();
}

function loadActivity() {
  try { activity = JSON.parse(sessionStorage.getItem("flowpilot-activity") || "[]"); } catch { activity = []; }
  renderActivity();
}

function renderActivity() {
  const log = $("#activityLog");
  if (log) log.innerHTML=activity.map(entry=>`<div class="activity-item"><i class="activity-marker"></i><span>${escapeHtml(entry.event)}<small>${new Date(entry.time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · local session</small></span></div>`).join("");
}

function downloadPack() {
  const pack=buildLenderPack(state,currentRows,compareFinancing(state)); downloadFile("flowpilot-evidence-pack.json",JSON.stringify(pack,null,2),"application/json"); showToast("Evidence pack downloaded");
}

function downloadActivity() {
  const csv="timestamp,event\n"+activity.map(row=>`${row.time},"${row.event.replaceAll('"','""')}"`).join("\n"); downloadFile("flowpilot-activity-log.csv",csv,"text/csv"); showToast("Activity log downloaded");
}

function downloadFile(name,content,type) {
  const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function handleCsv(event) {
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>1_000_000){setText("#uploadStatus","CSV is too large (maximum 1 MB).");return;}
  try {const rows=parseForecastCsv(await file.text());if(rows.length>26)throw new Error("Upload no more than 26 forecast rows.");state.weeks=rows;sessionStorage.setItem("flowpilot-weeks",JSON.stringify(rows));currentMultiplier=1;sessionStorage.setItem("flowpilot-receipt-multiplier","1");if($("#scenarioSelect"))$("#scenarioSelect").value="1";refreshForecast();setText("#uploadStatus",`Loaded ${rows.length} rows in this browser session. No data was uploaded.`);addActivity(`Imported ${rows.length} local CSV forecast rows`);showToast("CSV loaded locally");}
  catch(error){setText("#uploadStatus",error.message);showToast("CSV could not be loaded");}
  event.target.value="";
}

function showDisclaimer(){window.alert("FlowPilot is a competition prototype using fictional demonstration data and illustrative financing terms. It is not financial advice, a lender offer, underwriting, credit scoring, or a loan application. Do not upload sensitive information. All calculations are performed locally in this browser; no backend or external service is connected.");}
function showToast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),2200);}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));}

init().catch(error=>{console.error(error);if($("#alertTitle")){setText("#alertTitle","Could not start FlowPilot");setText("#alertText",error.message);}else showToast(error.message);});
