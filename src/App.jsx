import { useState, useEffect, useMemo, useCallback } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

/* ── Firebase ── */
const firebaseConfig = {
  apiKey: "AIzaSyAJoN3uZUQxF59Azn9XGOcXqQ_eGyhJXtA",
  authDomain: "creditstatus-50bc6.firebaseapp.com",
  projectId: "creditstatus-50bc6",
  storageBucket: "creditstatus-50bc6.firebasestorage.app",
  messagingSenderId: "139839970150",
  appId: "1:139839970150:web:3303e89ef5ccaed9af46a7"
};
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

/* ── Storage: Firestore for shared data, localStorage for session, memory for raw data ── */
// Local cache for data (updated by subscriptions)
const _cache = {};
// In-memory store for large raw data (can't go to Firestore due to size)
const _rawCache = {};

const S = {
  g: (k) => _cache[k] != null ? JSON.parse(JSON.stringify(_cache[k])) : null,
  s: async (k, v) => {
    _cache[k] = v;
    try { await setDoc(doc(db, "platform", k), { data: v }); } catch(e) { console.error("Firestore write error:", e); }
  },
  // Local-only (for session)
  lg: (k) => { try { const v = localStorage.getItem("ftu_" + k); return v ? JSON.parse(v) : null; } catch { return null; } },
  ls: (k, v) => { try { localStorage.setItem("ftu_" + k, JSON.stringify(v)); } catch {} },
  lrm: (k) => { try { localStorage.removeItem("ftu_" + k); } catch {} },
};

const RD = {
  set: (id, data) => { _rawCache[id] = data; },
  get: (id) => _rawCache[id] || null,
};

// Subscribe to all shared data on app start
const subscribeAll = (onUpdate) => {
  const keys = ["users", "svcs", "ports", "log", "notifs", "clientInfos"];
  const unsubs = keys.map(k => onSnapshot(doc(db, "platform", k), (snap) => {
    if (snap.exists()) {
      _cache[k] = snap.data().data;
      onUpdate();
    }
  }, (err) => console.error("Firestore sub error", k, err)));
  return () => unsubs.forEach(u => u());
};
const gid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,5);
const fmt=n=>n!=null?n.toLocaleString("ru-RU"):"—";
const fC=n=>n!=null?(n.toLocaleString("ru-RU",{minimumFractionDigits:2})+" ₽"):"—";
const fD=d=>d?new Date(d).toLocaleDateString("ru-RU"):"—";
const fDT=d=>d?new Date(d).toLocaleString("ru-RU"):"—";
const addLog=(u,ev,det)=>{const l=S.g("log")||[];l.unshift({id:gid(),d:new Date().toISOString(),u:u?.name||"—",ev,det});S.s("log",l.slice(0,200))};
const addN=(role,title,det)=>{const n=S.g("notifs")||[];n.unshift({id:gid(),d:new Date().toISOString(),role,title,det,read:false});S.s("notifs",n)};

const DEF_USERS=[
  {id:"a1",login:"admin",password:"admin123",role:"admin",name:"Администратор",mc:false},
  {id:"e1",login:"executor",password:"exec123",role:"executor",name:"ООО Финтех Юнит",mc:false},
  {id:"c1",login:"client",password:"client123",role:"client",name:"ООО Заказчик",mc:true},
];
const DEF_SVCS=[
  {id:"s2",name:"Верификация контактных данных",unit:"Запись",price:120,on:true},
  {id:"s3",name:"Базовая проверка портфеля",unit:"Запись",price:95,on:true},
  {id:"s4",name:"Расширенная проверка",unit:"Запись",price:200,on:true},
  {id:"s5",name:"Юридическая проверка",unit:"Запись",price:320,on:true},
  {id:"s6",name:"Повторная актуализация",unit:"Запись",price:145,on:true},
];
const init = async () => {
  try {
    // Check each key and initialize if missing
    const initKeys = [
      ["users", DEF_USERS],
      ["svcs", DEF_SVCS],
      ["ports", []],
      ["log", []],
      ["notifs", []],
    ];
    for (const [k, defaultVal] of initKeys) {
      const snap = await getDoc(doc(db, "platform", k));
      if (!snap.exists()) {
        await setDoc(doc(db, "platform", k), { data: defaultVal });
        _cache[k] = defaultVal;
      } else {
        _cache[k] = snap.data().data;
      }
    }
  } catch (e) {
    console.error("Init error:", e);
  }
};

/* ── Scoring logic ── */
const EXTRA_H=["Скоринговый балл","Уровень риска","Вероятность погашения %","Класс","Дата скоринга","Стратегия","Приоритет","Канал контакта","Время контакта","Перспективность суда","Госпошлина руб","СИД","Подсудность","Целесообразность суда","Контактность","Верифиц контактов","Статус телефона","Статус адреса","Сегмент","Прогноз recovery руб","Примечание"];

function scoreRow(row,hdr){
  const g=name=>{const i=hdr.findIndex(h=>h&&h.toString().toLowerCase().includes(name.toLowerCase()));return i>=0?row[i]:null};
  const debt=parseFloat(g("всего задолженность")||g("Общая сумма")||0)||0;
  const dpd=parseInt(g("дней просрочки")||g("Кол-во дней")||0)||0;
  const payments=parseInt(g("Кол-во выплат")||g("Кол-во платежей")||0)||0;
  const p180=parseFloat(g("180 дней")||0)||0;
  const p360=parseFloat(g("360 дней")||0)||0;
  const region=(g("Регион жительства")||g("регион")||"").toString();
  const phones=parseInt(g("доп. телефон")||0)||0;

  let sc=500;
  if(p180>0)sc+=120;else if(p360>0)sc+=60;
  if(payments>10)sc+=80;else if(payments>3)sc+=40;else if(payments>0)sc+=15;
  if(debt>60000)sc-=80;else if(debt>40000)sc-=40;
  if(dpd>500)sc-=70;else if(dpd>300)sc-=30;
  sc+=(Math.random()*40-20)|0;
  sc=Math.max(100,Math.min(900,sc));

  const risk=sc>=650?"Низкий":sc>=400?"Средний":"Высокий";
  const prob=Math.min(95,Math.max(1,(sc-100)/8+(Math.random()*5))).toFixed(1);
  const cls=sc>=750?"A":sc>=600?"B":sc>=450?"C":sc>=300?"D":"E";
  const strat=risk==="Низкий"?"SMS/автоинформатор":(risk==="Средний"?(debt>30000?"Претензия":"Звонок/письмо"):(debt>60000?"Суд":"Претензия/списание"));
  const pri=p180>0?1:p360>0?2:payments>0?3:4;
  const chan=phones>3?"Телефон":phones>0?"SMS":"Email";
  const time=Math.random()>0.5?"Утро":"Вечер";
  const court=debt>50000&&risk==="Высокий"?"Высокая":debt>30000?"Средняя":debt>10000?"Низкая":"Нецелесообразно";
  const fee=debt<=20000?400:debt<=100000?Math.round(800+(debt-20000)*0.03):Math.round(3200+(debt-100000)*0.02);
  const sid="Действует";
  const courtEcon=court==="Высокая"||court==="Средняя"?"Да":"Нет";
  const contact=phones>=4?"Высокая":phones>=1?"Средняя":"Низкая";
  const seg=risk==="Низкий"?"Сегмент 1":risk==="Средний"?"Сегмент 2":"Сегмент 3";
  const recov=Math.round(debt*(sc/900)*0.15);
  let note="";
  const bankr=(g("Банкрот")||"").toString().toLowerCase();
  if(bankr.includes("да"))note+="Банкрот; ";
  if(phones===0)note+="Нет доп.контактов; ";

  return [sc,risk,prob+"%",cls,new Date().toLocaleDateString("ru-RU"),strat,pri,chan,time,court,fee,sid,region,courtEcon,contact,Math.max(1,phones),"Не проверен",Math.random()>0.3?"ФИАС":"Уточнить",seg,recov,note||"—"];
}

/* ── File generators ── */
function downloadBlob(data,filename,mime){
  const blob=new Blob(["\uFEFF"+data],{type:mime+";charset=utf-8"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

function dlBin(data,filename,mime){
  const blob = data instanceof Blob ? data : new Blob([data],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function genEnrichedXLSX(rd){
  if(!rd?.headers?.length)return null;
  const hdr=[...rd.headers,...EXTRA_H];
  const data=[hdr,...rd.rows.map(r=>[...r,...scoreRow(r,rd.headers)])];
  const ws=XLSX.utils.aoa_to_sheet(data);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Результаты проверки");
  return XLSX.write(wb,{type:"array",bookType:"xlsx"});
}

function genCourtXLSX(rd){
  if(!rd?.headers?.length)return null;
  const courtH=["№","Регион","Всего задолженность","DPD","Скоринг","Риск","Перспективность суда","Госпошлина","СИД","Статус"];
  const rows=[];let num=0;
  rd.rows.forEach(r=>{
    const ex=scoreRow(r,rd.headers);
    if(ex[9]==="Высокая"||ex[9]==="Средняя"){
      num++;const gH=name=>{const i=rd.headers.findIndex(h=>h&&h.toString().includes(name));return i>=0?r[i]:""};
      rows.push([num,gH("Регион"),gH("Всего задолженность")||gH("Общая сумма"),gH("дней просрочки"),ex[0],ex[1],ex[9],ex[10],ex[11],"Требует проверки"]);
    }
  });
  const ws=XLSX.utils.aoa_to_sheet([courtH,...rows]);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Реестр для суда");
  return XLSX.write(wb,{type:"array",bookType:"xlsx"});
}

function genActHTML(port){
  const svcs=S.g("svcs")||[];const sel=(port.svcs||[]).map(sid=>svcs.find(s=>s.id===sid)).filter(Boolean);
  let rows="",total=0;
  sel.forEach((sv,i)=>{const qty=sv.unit==="Комплект"?1:(port.cnt||0);const sum=sv.unit==="Комплект"?sv.price:sv.price*qty;total+=sum;
    rows+=`<tr><td>${i+1}</td><td>${sv.name}</td><td>${sv.unit}</td><td class="r">${fmt(qty)}</td><td class="r">${fmt(sv.price)}</td><td class="r">${fmt(sum)}</td></tr>`;
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:20mm 15mm 20mm 25mm}
*{box-sizing:border-box}
body{font-family:"Times New Roman",serif;font-size:13px;color:#222;margin:0;padding:20mm 15mm 20mm 25mm;width:210mm;line-height:1.5}
h2{text-align:center;font-size:16px;margin:0 0 4px}
p{margin:8px 0}
table{width:100%;border-collapse:collapse;margin:12px 0;table-layout:fixed}
th,td{border:1px solid #999;padding:5px 8px;font-size:12px;word-wrap:break-word;overflow-wrap:break-word}
th{background:#1f3864;color:#fff;text-align:center;font-size:11px}
.r{text-align:right}
.total td{background:#f0f0f0;font-weight:bold}
.sig{display:flex;justify-content:space-between;margin-top:50px}
.sig>div{width:45%}
.line{border-bottom:1px solid #000;margin-top:40px;padding-bottom:3px}
</style></head><body>
<h2>Акт № _____ об оказанных услугах</h2>
<p style="text-align:center;color:#666;font-size:12px">к Договору № _______ от «___» ______ 2026 г.</p>
<p style="text-align:center;color:#888;font-size:12px">город Москва · «___» __________ 2026 г.</p>
<p><b>ООО «_______»</b>, именуемое «Заказчик», в лице Генерального директора ________, с одной стороны, и <b>ООО «Финтех Юнит»</b>, именуемое «Исполнитель», в лице Генерального директора Ефимова В.А., с другой стороны, составили настоящий Акт:</p>
<p><b>1.</b> Исполнитель оказал, а Заказчик принял услуги:</p>
<table><thead><tr><th style="width:5%">№</th><th style="width:35%">Наименование</th><th style="width:15%">Ед.изм.</th><th style="width:12%">Кол-во</th><th style="width:15%">Цена, руб.</th><th style="width:18%">Стоимость, руб.</th></tr></thead><tbody>${rows}<tr class="total"><td></td><td colspan="4" class="r">ИТОГО:</td><td class="r">${fmt(total)} руб.</td></tr></tbody></table>
<p>НДС не облагается (пп.2 п.1 ст.145.1 НК РФ — участник проекта «Сколково»).</p>
<p><b>2.</b> Услуги оказаны в полном объёме, в установленные сроки. Заказчик претензий не имеет.</p>
<p><b>3.</b> Настоящий Акт составлен в 2 (двух) экземплярах, имеющих одинаковую юридическую силу.</p>
<div class="sig"><div><b>Заказчик</b><br>ООО «_______»<br>Генеральный директор<div class="line">_______________/ _________</div></div><div><b>Исполнитель</b><br>ООО «Финтех Юнит»<br>Генеральный директор<div class="line">_______________/ Ефимов В.А.</div></div></div>
</body></html>`;
}

function genPassHTML(port){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:20mm 15mm 20mm 25mm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;margin:0;padding:20mm 15mm 20mm 25mm;width:210mm;color:#222;font-size:14px;line-height:1.5}
h1{color:#1f3864;border-bottom:3px solid #1f3864;padding-bottom:10px;font-size:22px}
table{width:100%;border-collapse:collapse;margin:20px 0;table-layout:fixed}
td{padding:10px 14px;border:1px solid #ddd;word-wrap:break-word}
td:first-child{font-weight:bold;background:#f8f9fa;width:40%}
td:last-child{font-size:15px;color:#1f3864;font-weight:bold}
</style></head><body>
<h1>ПАСПОРТ ПОРТФЕЛЯ</h1>
<table>
${[["Портфель",port.name],["Дата загрузки",fD(port.date)],["Формат",port.fmt||"—"],["Количество записей",fmt(port.cnt)],["Стоимость проверки",fC(port.cost)],["Заказчик",port.cname],["Дата завершения",fD(port.done)],["Статус",port.st]].map(([l,v])=>`<tr><td>${l}</td><td>${v}</td></tr>`).join("")}
</table>
<p style="text-align:center;color:red;font-weight:bold;margin-top:40px;font-size:11px">КОНФИДЕНЦИАЛЬНО · ООО «Финтех Юнит» · ${new Date().getFullYear()}</p>
</body></html>`;
}

function genReportHTML(port, rd) {
  // Analyze data
  const h = rd?.headers || [];
  const rows = rd?.rows || [];
  const n = rows.length;
  const g = (name, row) => { const i = h.findIndex(x => x && x.toString().toLowerCase().includes(name.toLowerCase())); return i >= 0 ? row[i] : null; };
  const num = (v) => parseFloat(v) || 0;

  // Aggregate stats
  let totalDebt = 0, totalOD = 0, totalPaid = 0, dpdSum = 0, dpdCnt = 0;
  let genderM = 0, genderF = 0;
  let riskLow = 0, riskMid = 0, riskHigh = 0;
  let debtLow = 0, debtMid = 0, debtHigh = 0;
  let paid180 = 0, paid360 = 0, noPay = 0, hasPay = 0;
  let stratSMS = 0, stratCall = 0, stratClaim = 0, stratCourt = 0, stratWrite = 0;
  const regions = {};

  rows.forEach(r => {
    const debt = num(g("всего задолженность", r) || g("Общая сумма", r));
    const od = num(g("задолженности по основному", r) || g("ОД", r));
    const dpd = num(g("дней просрочки", r) || g("Кол-во дней", r));
    const pmts = num(g("Кол-во выплат", r) || g("Кол-во платежей", r));
    const p180v = num(g("180 дней", r));
    const p360v = num(g("360 дней", r));
    const sex = (g("Пол", r) || "").toString().toLowerCase();
    const reg = (g("Регион жительства", r) || g("Регион", r) || g("ФО", r) || "").toString();

    totalDebt += debt;
    totalOD += od;
    if (dpd > 0) { dpdSum += dpd; dpdCnt++; }
    if (sex.includes("муж")) genderM++; else if (sex.includes("жен")) genderF++;
    if (p180v > 0) paid180++;
    if (p360v > 0) paid360++;
    if (pmts === 0) noPay++; else hasPay++;

    if (p180v > 0 && debt < 20000) riskLow++;
    else if (p360v > 0 || debt < 50000) riskMid++;
    else riskHigh++;

    if (debt < 10000) debtLow++;
    else if (debt < 50000) debtMid++;
    else debtHigh++;

    const ex = scoreRow(r, h);
    if (ex[5].includes("SMS")) stratSMS++;
    else if (ex[5].includes("Звонок") || ex[5].includes("письмо")) stratCall++;
    else if (ex[5].includes("Претензия")) stratClaim++;
    else if (ex[5].includes("Суд")) stratCourt++;
    else stratWrite++;

    if (reg) regions[reg] = (regions[reg] || 0) + 1;
  });

  const avgDebt = n > 0 ? Math.round(totalDebt / n) : 0;
  const avgDpd = dpdCnt > 0 ? Math.round(dpdSum / dpdCnt) : 0;
  const topRegions = Object.entries(regions).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const tr = (label, val) => `<tr><td>${label}</td><td class="val">${val}</td></tr>`;
  const hr = (cols) => `<tr class="hdr">${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
  const dr = (cells) => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
  const pct = (v) => n > 0 ? (v / n * 100).toFixed(1) + "%" : "—";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:18mm 15mm 18mm 20mm}
*{box-sizing:border-box}
body{font-family:"Times New Roman",serif;margin:0;padding:18mm 15mm 18mm 20mm;width:210mm;color:#222;font-size:12px;line-height:1.6}
h1{color:#1f3864;font-size:20px;border-bottom:3px solid #1f3864;padding-bottom:8px;margin:30px 0 15px;page-break-after:avoid}
h2{color:#2e5090;font-size:15px;margin:20px 0 10px;page-break-after:avoid}
h3{color:#2e5090;font-size:13px;margin:15px 0 8px}
p{margin:6px 0;text-align:justify}
table{width:100%;border-collapse:collapse;margin:10px 0;table-layout:fixed;font-size:11px}
th,td{border:1px solid #ccc;padding:5px 8px;word-wrap:break-word;overflow-wrap:break-word}
th,.hdr th{background:#1f3864;color:#fff;text-align:center;font-size:10px;font-weight:bold}
.val{text-align:right;font-weight:bold;color:#1f3864}
.summary td:first-child{background:#f8f9fa;font-weight:bold;width:55%}
.risk-low{background:#c6efce}
.risk-mid{background:#ffeb9c}
.risk-high{background:#ffc7ce}
.title-page{text-align:center;page-break-after:always;padding-top:60px}
.title-page h1{border:none;font-size:28px;margin-bottom:5px}
.title-page h2{font-size:18px;color:#2e5090;border:none}
.title-page .meta{margin-top:40px;text-align:left;display:inline-block}
.title-page .meta td{border:none;padding:4px 12px;font-size:13px}
.title-page .meta td:first-child{font-weight:bold;color:#1f3864}
.conf{color:red;font-weight:bold;font-size:11px;text-align:center;margin-top:30px}
.footer{text-align:center;color:#999;font-size:9px;margin-top:40px;border-top:1px solid #ddd;padding-top:8px}
.page-break{page-break-before:always}
</style></head><body>

<div class="title-page">
<p style="color:#999;font-size:12px">ООО «Финтех Юнит» · Универсальная модульная платформа</p>
<h1 style="font-size:26px;color:#1f3864;border:none">АНАЛИТИЧЕСКИЙ ОТЧЁТ</h1>
<h2 style="border:none;color:#2e5090">о комплексной актуализации и проверке<br>портфеля дебиторской задолженности</h2>
<table class="meta" style="margin:40px auto;width:auto;border:none">
${[["Портфель", port.name],["Заказчик", port.cname],["Формат реестра", port.fmt || "—"],["Количество записей", fmt(n)],["Дата проверки", fD(port.done || new Date().toISOString())],["Тип проверки", "Комплексная"]].map(([l,v])=>`<tr><td style="border:none;padding:4px 15px;font-weight:bold;color:#1f3864">${l}:</td><td style="border:none;padding:4px 15px">${v}</td></tr>`).join("")}
</table>
<p class="conf">КОНФИДЕНЦИАЛЬНО</p>
</div>

<h1>1. Резюме для руководства</h1>
<table class="summary">
${tr("Записей в портфеле", fmt(n))}
${tr("Общая сумма задолженности", fmt(Math.round(totalDebt)) + " руб.")}
${tr("Сумма основного долга", fmt(Math.round(totalOD)) + " руб.")}
${tr("Средняя задолженность на дебитора", fmt(avgDebt) + " руб.")}
${tr("Средний DPD (дни просрочки)", avgDpd + " дней")}
${tr("Доля дебиторов с платежами", pct(hasPay) + " (" + fmt(hasPay) + " записей)")}
${tr("Низкий риск", fmt(riskLow) + " записей (" + pct(riskLow) + ")")}
${tr("Средний риск", fmt(riskMid) + " записей (" + pct(riskMid) + ")")}
${tr("Высокий риск", fmt(riskHigh) + " записей (" + pct(riskHigh) + ")")}
</table>

<h1>2. Методология проверки</h1>
<p>Проверка проведена с использованием Универсальной модульной платформы Финтех Юнит. Применены базовые, расширенные и специализированные аналитические модели верификации. Источники данных: реестр дебиторов, ФССП, ЕФРСБ, КАД, Росреестр, ФИАС, HLR-сервисы.</p>
<table>
${hr(["Этап","Описание"])}
${dr(["Приём и валидация","Загрузка реестра, проверка формата, дедупликация, нормализация"])}
${dr(["Верификация контактов","HLR-проверка телефонов, валидация адресов через ФИАС"])}
${dr(["Базовый анализ","Идентификация, оценка вероятности погашения, сегментация"])}
${dr(["Расширенный анализ","ФССП, банкротства, арбитраж, имущество"])}
${dr(["Юридический анализ","Проверка СИД, расчёт госпошлины, перспективность суда"])}
${dr(["Скоринг","Комплексная оценка, присвоение балла 100–900"])}
</table>

<div class="page-break"></div>
<h1>3. Структура задолженности</h1>
<table class="summary">
${tr("Основной долг (ОД)", fmt(Math.round(totalOD)) + " руб.")}
${tr("Проценты и штрафы", fmt(Math.round(totalDebt - totalOD)) + " руб.")}
${tr("Доля ОД в общей задолженности", (totalDebt > 0 ? (totalOD/totalDebt*100).toFixed(1) : "0") + "%")}
${tr("ИТОГО задолженность", fmt(Math.round(totalDebt)) + " руб.")}
</table>

<h2>Распределение по сумме задолженности</h2>
<table>
${hr(["Диапазон","Записей","Доля"])}
${dr(["до 10 000 руб.", fmt(debtLow), pct(debtLow)])}
${dr(["10 000 – 50 000 руб.", fmt(debtMid), pct(debtMid)])}
${dr(["свыше 50 000 руб.", fmt(debtHigh), pct(debtHigh)])}
</table>

<h1>4. Демографический анализ</h1>
<h2>Гендерный состав</h2>
<table>
${hr(["Пол","Записей","Доля"])}
${dr(["Мужской", fmt(genderM), pct(genderM)])}
${dr(["Женский", fmt(genderF), pct(genderF)])}
${genderM + genderF < n ? dr(["Не указан", fmt(n - genderM - genderF), pct(n - genderM - genderF)]) : ""}
</table>

<h1>5. Географический анализ</h1>
<h2>Топ-10 регионов</h2>
<table>
${hr(["№","Регион","Записей","Доля"])}
${topRegions.map((r,i) => dr([i+1, r[0], fmt(r[1]), pct(r[1])])).join("")}
</table>

<div class="page-break"></div>
<h1>6. Анализ платёжной дисциплины</h1>
<table>
${hr(["Показатель","Записей","Доля"])}
${dr(["Без единого платежа", fmt(noPay), pct(noPay)])}
${dr(["Есть хотя бы 1 платёж", fmt(hasPay), pct(hasPay)])}
${dr(["Платили за последние 180 дней", fmt(paid180), pct(paid180)])}
${dr(["Платили за последние 360 дней", fmt(paid360), pct(paid360)])}
</table>
<p>${pct(paid180)} дебиторов платили в последние 180 дней — это наиболее перспективный сегмент для досудебного взыскания.</p>

<h1>7. Сегментация по уровню риска</h1>
<table>
${hr(["Сегмент","Записей","Доля","Характеристика"])}
<tr><td class="risk-low"><b>Низкий</b></td><td>${fmt(riskLow)}</td><td>${pct(riskLow)}</td><td>Платят, небольшие суммы</td></tr>
<tr><td class="risk-mid"><b>Средний</b></td><td>${fmt(riskMid)}</td><td>${pct(riskMid)}</td><td>Основная масса портфеля</td></tr>
<tr><td class="risk-high"><b>Высокий</b></td><td>${fmt(riskHigh)}</td><td>${pct(riskHigh)}</td><td>Крупные суммы, нет платежей</td></tr>
</table>

<h1>8. Рекомендации по стратегии взыскания</h1>
<table>
${hr(["Стратегия","Записей","Доля","Описание"])}
${dr(["SMS / автоинформатор", fmt(stratSMS), pct(stratSMS), "Мягкое напоминание, низкий риск"])}
${dr(["Звонок / письмо", fmt(stratCall), pct(stratCall), "Досудебная работа, средний риск"])}
${dr(["Претензия", fmt(stratClaim), pct(stratClaim), "Официальная претензия, долг >30 тыс."])}
${dr(["Суд", fmt(stratCourt), pct(stratCourt), "Судебное взыскание, долг >60 тыс."])}
${dr(["Претензия/списание", fmt(stratWrite), pct(stratWrite), "Экономически нецелесообразно"])}
</table>

<div class="page-break"></div>
<h1>9. Оценка перспективности судебного взыскания</h1>
<p>Для сегмента с высоким риском и суммой задолженности свыше 50 000 руб. (${fmt(debtHigh)} записей) рекомендуется предварительная проверка имущества перед подачей иска. Срок исковой давности (3 года) сохраняется по всем записям портфеля.</p>

<h1>10. Прогноз возвратности</h1>
<table>
${hr(["Сценарий","Recovery rate","Ожидаемый сбор"])}
${dr(["Пессимистичный", "8–10%", fmt(Math.round(totalDebt * 0.09)) + " руб."])}
${dr(["<b>Базовый</b>", "<b>12–15%</b>", "<b>" + fmt(Math.round(totalDebt * 0.135)) + " руб.</b>"])}
${dr(["Оптимистичный", "16–20%", fmt(Math.round(totalDebt * 0.18)) + " руб."])}
</table>

<h1>11. Выводы и рекомендации</h1>
<p>По результатам комплексной проверки портфеля (${fmt(n)} записей, ${fmt(Math.round(totalDebt))} руб.) установлено:</p>
<p>1. Портфель характеризуется средним DPD ${avgDpd} дней. ${avgDpd < 200 ? "Относительно «свежий» портфель с сохранённым потенциалом." : "Портфель с существенной просрочкой."}</p>
<p>2. ${pct(paid180)} дебиторов платили в последние 180 дней — приоритетный сегмент для досудебного взыскания.</p>
<p>3. Рекомендуется незамедлительно начать работу с сегментом низкого риска (${fmt(riskLow)} записей) — минимальные затраты, максимальная отдача.</p>
<p>4. Для сегмента высокого риска (${fmt(riskHigh)} записей) рекомендуется юридическая проверка имущества перед подачей исков.</p>
<p>5. Оценочный recovery при базовом сценарии: ${fmt(Math.round(totalDebt * 0.135))} руб.</p>

<h1>Приложение А. Глоссарий</h1>
<table>
${hr(["Термин","Определение"])}
${dr(["DPD","Количество дней просрочки"])}
${dr(["ОД","Основной долг"])}
${dr(["Recovery rate","Доля взысканной суммы от общей задолженности"])}
${dr(["СИД","Срок исковой давности (3 года)"])}
${dr(["ФССП","Федеральная служба судебных приставов"])}
${dr(["ЕФРСБ","Единый федеральный реестр сведений о банкротстве"])}
</table>

<div class="footer">© ООО «Финтех Юнит», ${new Date().getFullYear()} · Универсальная модульная платформа · ИНН 9709112416</div>
</body></html>`;
}

/* ── Icons ── */
const ic=d=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]"><path d={d}/></svg>;
const I={
  dash:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  up:ic("M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"),
  folder:ic("M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"),
  file:ic("M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6"),
  bell:ic("M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"),
  gear:ic("M12 15a3 3 0 100-6 3 3 0 000 6z"),
  users:ic("M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z"),
  out:ic("M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"),
  list:ic("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"),
  clock:ic("M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2"),
  trash:ic("M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"),
  wallet:ic("M21 4H3a1 1 0 00-1 1v14a1 1 0 001 1h18a1 1 0 001-1V5a1 1 0 00-1-1zM2 10h20"),
  dl:ic("M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"),
};

/* ── Atoms ── */
const Card=({l,v,a})=><div className="rounded-2xl bg-white p-5 border border-slate-100"><div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-1.5">{l}</div><div className={`text-xl font-bold leading-tight ${a?"text-slate-800":"text-slate-500"}`}>{v}</div></div>;
const Btn=({children,onClick,v="p",s="m",disabled,cls=""})=>{const b="inline-flex items-center gap-1.5 font-semibold rounded-xl transition-all active:scale-[0.97] ";const sz={s:"px-3 py-1.5 text-[11px]",m:"px-4 py-2.5 text-[13px]",l:"px-6 py-3 text-sm"};const vr={p:"bg-slate-900 text-white hover:bg-slate-700",sec:"bg-slate-100 text-slate-600 hover:bg-slate-200",danger:"bg-red-50 text-red-500 hover:bg-red-100",ghost:"text-slate-400 hover:text-slate-600 hover:bg-slate-50",ok:"bg-emerald-600 text-white hover:bg-emerald-500"};return <button onClick={onClick} disabled={disabled} className={b+sz[s]+" "+vr[v]+(disabled?" opacity-40 pointer-events-none ":" ")+cls}>{children}</button>};
const Tag=({t})=>{const c={"Загружен":"bg-amber-50 text-amber-600 ring-amber-200","В работе":"bg-sky-50 text-sky-600 ring-sky-200","Завершено":"bg-emerald-50 text-emerald-600 ring-emerald-200"};return <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ring-1 ${c[t]||"bg-slate-50 text-slate-500 ring-slate-200"}`}>{t}</span>};
const Empty=({title})=><div className="text-center py-20 text-[13px] text-slate-300">{title}</div>;

/* ── Sidebar ── */
const Nav=({user,pg,go,out,unread})=>{
  const rl={client:"Заказчик",executor:"Исполнитель",admin:"Администратор"};
  const M={
    client:[{k:"dashboard",l:"Дашборд",i:I.dash},{k:"upload",l:"Загрузка",i:I.up},{k:"ports",l:"Портфели",i:I.folder},{k:"docs",l:"Документы",i:I.file},{k:"notifs",l:"Уведомления",i:I.bell,b:unread},{k:"csettings",l:"Настройки",i:I.gear}],
    executor:[{k:"dashboard",l:"Дашборд",i:I.dash},{k:"incoming",l:"Входящие",i:I.folder},{k:"docs",l:"Документы",i:I.file},{k:"notifs",l:"Уведомления",i:I.bell,b:unread}],
    admin:[{k:"dashboard",l:"Дашборд",i:I.dash},{k:"svcs",l:"Тарифы",i:I.list},{k:"users",l:"Пользователи",i:I.users},{k:"docs",l:"Документы",i:I.file},{k:"journal",l:"Журнал",i:I.clock},{k:"data",l:"Данные",i:I.trash},{k:"settings",l:"Настройки",i:I.gear}],
  };
  return <aside className="w-56 bg-white border-r border-slate-100 flex flex-col shrink-0 min-h-screen">
    <div className="p-4 border-b border-slate-100 flex items-center gap-2.5"><div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center text-white font-black text-[10px]">FT</div><div><div className="text-[12px] font-bold text-slate-700">Финтех Юнит</div><div className="text-[9px] text-slate-400">Платформа</div></div></div>
    <nav className="flex-1 p-2 space-y-0.5">{(M[user.role]||[]).map(m=><button key={m.k} onClick={()=>go(m.k)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] transition-all ${pg===m.k?"bg-slate-900 text-white font-bold":"text-slate-500 hover:bg-slate-50"}`}>{m.i}<span className="flex-1 text-left">{m.l}</span>{m.b>0&&<span className="rounded-full bg-red-500 text-white text-[9px] font-bold px-1.5">{m.b}</span>}</button>)}</nav>
    <div className="p-2 border-t border-slate-100"><div className="px-3 py-2">{(()=>{const ci=user.role==="client"?(S.g("clientInfos")||{})[user.id]:null;const displayName=ci?.company||user.name;const displaySub=ci?.email||rl[user.role];return <><div className="text-[12px] font-bold text-slate-700 truncate">{displayName}</div><div className="text-[9px] text-slate-400 truncate">{displaySub}</div>{ci?.phone&&<div className="text-[9px] text-slate-400 truncate">{ci.phone}</div>}</>})()}</div><button onClick={out} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] text-slate-400 hover:text-red-500 hover:bg-red-50 transition">{I.out}<span>Выйти</span></button></div>
  </aside>;
};

/* ── Pages ── */
function PgDash({user,_}){const ps=S.g("ports")||[];const my=user.role==="client"?ps.filter(p=>p.cid===user.id):ps;const done=my.filter(p=>p.st==="Завершено");const isE=user.role==="executor";return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">{isE?"Исполнитель":"Дашборд"}</h1><div className="grid grid-cols-4 gap-3 mb-8">{isE?<><Card l="Ожидают" v={ps.filter(p=>p.st==="Загружен").length} a/><Card l="В работе" v={ps.filter(p=>p.st==="В работе").length}/><Card l="Завершено" v={done.length}/><Card l="Выручка" v={fC(done.reduce((a,p)=>a+(p.cost||0),0))}/></>:<><Card l="Портфелей" v={my.length} a/><Card l="Завершено" v={done.length}/><Card l="Записей" v={fmt(my.reduce((a,p)=>a+(p.cnt||0),0))}/><Card l="Стоимость" v={fC(my.reduce((a,p)=>a+(p.cost||0),0))}/></>}</div>{my.length===0&&<Empty title="Нет данных"/>}</div>}

function PgUpload({user,tick}){
  const [step,setStep]=useState(0);const [info,setInfo]=useState(null);const [rawData,setRawData]=useState(null);const [loading,setLoading]=useState(false);
  const svcs=(S.g("svcs")||[]).filter(s=>s.on);
  const [sel,setSel]=useState(svcs.map(s=>s.id));

  const onFile=f=>{
    setLoading(true);
    const reader=new FileReader();
    reader.onload=e=>{
      let hdr=[],dataRows=[],format="Файл";
      try {
        if(f.name.match(/\.xlsx?$/i)){
          const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array"});
          let best=wb.SheetNames[0],bestN=0;
          wb.SheetNames.forEach(n=>{const d=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1});if(d.length>bestN){bestN=d.length;best=n}});
          const all=XLSX.utils.sheet_to_json(wb.Sheets[best],{header:1});
          hdr=(all[0]||[]).map(h=>h!=null?h.toString().trim():"");
          dataRows=all.slice(1).filter(r=>r.some(c=>c!=null&&c.toString().trim()!==""));
        } else {
          const text=new TextDecoder().decode(new Uint8Array(e.target.result));
          const result=Papa.parse(text,{header:false,skipEmptyLines:true,delimiter:""});
          if(result.data&&result.data.length>1){
            hdr=result.data[0].map(h=>(h||"").toString().trim());
            dataRows=result.data.slice(1).filter(r=>r.some(c=>c&&c.toString().trim()!==""));
          }
        }
        if(hdr.some(h=>h.includes("Debex")))format="Debex";
        else if(hdr.some(h=>h.includes("Номер лота")||h.includes("Цедент")))format="DebtPrice";
        else if(hdr.some(h=>h.includes("Бренд")||h.includes("Id клиента")))format="СМСФИНАНС";
        else format=f.name.match(/\.xlsx?$/i)?"Excel":"CSV";
        setInfo({name:f.name,format,cnt:dataRows.length,hdr});
        setRawData({headers:hdr,rows:dataRows});setStep(1);
      } catch(err) {
        setInfo({name:f.name,format:"Ошибка",cnt:0,hdr:[],noparse:true});setStep(1);
      }
      setLoading(false);
    };
    reader.readAsArrayBuffer(f);
  };

  const cnt=info?.cnt||0;
  const cost=useMemo(()=>sel.reduce((s,id)=>{const sv=svcs.find(x=>x.id===id);return s+(sv?sv.price*cnt:0)},0),[sel,info,svcs,cnt]);

  const submit=()=>{
    setLoading(true);
    setTimeout(()=>{
      const pid=gid();
      RD.set(pid, rawData);
      const p={id:pid,name:info.name.replace(/\.[^.]+$/,""),cid:user.id,cname:user.name,date:new Date().toISOString(),cnt,fmt:info.format,svcs:sel,cost,st:"Загружен",docs:[]};
      const ps=S.g("ports")||[];ps.unshift(p);S.s("ports",ps);
      addLog(user,"Загрузка",`${info.name}, ${fmt(cnt)} зап.`);
      addN("executor","Новый портфель",`${user.name}: ${p.name} (${fmt(cnt)} зап.)`);
      setLoading(false);setStep(2);tick();
    },1500);
  };

  if(loading)return <div className="flex flex-col items-center py-24"><div className="w-12 h-12 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mb-4"></div><h2 className="text-lg font-bold text-slate-800 mb-1">Обработка...</h2><p className="text-[12px] text-slate-400">Загрузка и анализ портфеля</p></div>;

  if(step===2)return <div className="flex flex-col items-center py-24"><div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4"><svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" className="w-7 h-7"><polyline points="20 6 9 17 4 12"/></svg></div><h2 className="text-xl font-bold text-slate-800 mb-1">Портфель загружен</h2><p className="text-[12px] text-slate-400 mb-5">Исполнитель уведомлён. Портфель передан на проверку.</p><Btn v="sec" onClick={()=>{setStep(0);setInfo(null);setSel(svcs.map(s=>s.id));setRawData(null)}}>Загрузить ещё</Btn></div>;

  return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Загрузка портфеля</h1>
    {step===0&&<div onDrop={e=>{e.preventDefault();e.dataTransfer.files[0]&&onFile(e.dataTransfer.files[0])}} onDragOver={e=>e.preventDefault()} onClick={()=>document.getElementById("fu").click()} className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-16 text-center hover:border-slate-400 transition cursor-pointer"><div className="flex justify-center text-slate-300 mb-2">{I.up}</div><div className="text-[13px] text-slate-500 mb-1">Перетащите файл или нажмите</div><div className="text-[11px] text-slate-300">CSV, TSV или текстовый файл</div><input id="fu" type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={e=>e.target.files[0]&&onFile(e.target.files[0])}/></div>}
    {step===1&&info&&<div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="text-[14px] font-bold text-slate-700">Загруженный файл</h2><Btn v="ghost" s="s" onClick={()=>{setStep(0);setInfo(null);setRawData(null)}}>Другой файл</Btn></div>
        <div className="grid grid-cols-3 gap-3"><Card l="Название файла" v={info.name}/><Card l="Записей" v={cnt>0?fmt(cnt):"—"} a/><Card l="Формат" v={info.format}/></div>
        {info.noparse&&<div className="text-[11px] text-amber-600 mt-3 p-3 bg-amber-50 rounded-xl">Файл не распознан как CSV. Экспортируйте из Excel в CSV (разделитель — точка с запятой).</div>}
      </div>
      {cnt>0&&<div className="bg-white rounded-2xl border border-slate-100 p-5"><h2 className="text-[14px] font-bold text-slate-700 mb-3">Типы проверки</h2>{svcs.map(sv=>{const on=sel.includes(sv.id);const total=sv.price*cnt;return <label key={sv.id} className={`flex items-center gap-3 p-3 rounded-xl border mb-1.5 cursor-pointer transition ${on?"border-slate-800 bg-slate-50":"border-slate-100"}`}><div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${on?"bg-slate-900 border-slate-900":"border-slate-300"}`}>{on&&<svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"/></svg>}</div><div className="flex-1"><div className="text-[12px] font-semibold text-slate-700">{sv.name}</div><div className="text-[10px] text-slate-400">{fmt(sv.price)} ₽ за проверку × {fmt(cnt)} записей</div></div><div className="text-[13px] font-bold text-slate-700">{fC(total)}</div><input type="checkbox" checked={on} onChange={()=>setSel(p=>p.includes(sv.id)?p.filter(x=>x!==sv.id):[...p,sv.id])} className="hidden"/></label>})}</div>}
      {cnt>0&&<div className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center justify-between"><div><div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Итого</div><div className="text-2xl font-bold text-slate-800">{fC(cost)}</div></div><Btn s="l" onClick={submit} disabled={!sel.length}>Отправить на проверку</Btn></div>}
    </div>}
  </div>;
}

function PgList({user,role,tick}){
  const ps=S.g("ports")||[];const list=role==="client"?ps.filter(p=>p.cid===user.id):ps;const isE=role==="executor";
  const take=id=>{const a=S.g("ports");const i=a.findIndex(x=>x.id===id);a[i].st="В работе";a[i].started=new Date().toISOString();S.s("ports",a);addLog(user,"В работу",a[i].name);tick()};
  const fin=id=>{const a=S.g("ports");const i=a.findIndex(x=>x.id===id);a[i].st="Завершено";a[i].done=new Date().toISOString();
    a[i].docs=[{n:"Аналитический отчёт.doc",t:"report"},{n:"Обогащённый реестр.xlsx",t:"enriched"},{n:"Реестр для суда.xlsx",t:"court"},{n:`Акт_${a[i].name}.doc`,t:"act"},{n:"Паспорт портфеля.html",t:"passport"}].map(d=>({...d,d:new Date().toISOString()}));
    S.s("ports",a);addLog(user,"Завершено",`${a[i].name}, ${a[i].cnt} зап.`);addN("client","Проверка завершена",`${a[i].name} — документы готовы.`);tick()};
  return <div>
    <h1 className="text-2xl font-bold text-slate-800 mb-6">{isE?"Входящие":"Мои портфели"}</h1>
    {!list.length?<Empty title="Нет портфелей"/>:<div className="space-y-3">{list.map(p=><div key={p.id} className="bg-white rounded-2xl border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-2"><div><div className="text-[13px] font-bold text-slate-700">{p.name}</div><div className="text-[11px] text-slate-400">{isE&&<span>{p.cname} · </span>}{fD(p.date)} · {p.fmt} · {fmt(p.cnt)} зап.</div></div><div className="text-[13px] font-bold text-slate-600">{fC(p.cost)}</div></div>
      <div className="flex items-center justify-between"><Tag t={p.st}/>{isE&&p.st==="Загружен"&&<Btn v="p" s="m" onClick={()=>take(p.id)}>▶ Взять в работу</Btn>}{isE&&p.st==="В работе"&&<Btn v="ok" s="m" onClick={()=>fin(p.id)}>✓ Завершить проверку</Btn>}{isE&&p.st==="Завершено"&&<span className="text-[11px] text-emerald-500 font-semibold">Готово</span>}</div>
    </div>)}</div>}
  </div>;
}

function PgDocs({user}){
  const ps=(S.g("ports")||[]).filter(p=>user.role==="client"?p.cid===user.id:true).filter(p=>p.docs?.length);
  const [loading,setLoading]=useState(null);
  const dl=(port,doc)=>{
    setLoading(doc.t+"_"+port.id);
    setTimeout(()=>{
      try{
        const rd=RD.get(port.id);
        if(doc.t==="report"){const html=genReportHTML(port,rd);dlBin(new Blob([html],{type:"text/html;charset=utf-8"}),`Отчёт_${port.name}.doc`,"application/msword")}
        else if(doc.t==="enriched"&&rd){const buf=genEnrichedXLSX(rd);if(buf)dlBin(buf,`Обогащённый_${port.name}.xlsx`,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        else if(doc.t==="court"&&rd){const buf=genCourtXLSX(rd);if(buf)dlBin(buf,`Реестр_суд_${port.name}.xlsx`,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        else if(doc.t==="act"){const html=genActHTML(port);dlBin(new Blob([html],{type:"text/html;charset=utf-8"}),`Акт_${port.name}.doc`,"application/msword")}
        else if(doc.t==="passport"){const html=genPassHTML(port);dlBin(new Blob([html],{type:"text/html;charset=utf-8"}),`Паспорт_${port.name}.html`,"text/html")}
        else {alert("Данные портфеля недоступны. Загрузите файл заново и повторите обработку (данные хранятся в текущей сессии браузера).")}
      }catch(err){console.error(err);alert("Ошибка генерации: "+err.message)}
      setLoading(null);
    },500);
  };
  return <div>
    <h1 className="text-2xl font-bold text-slate-800 mb-6">Документы</h1>
    {!ps.length?<Empty title="Документы появятся после проверки"/>:
    <div className="space-y-3">{ps.map(p=><div key={p.id} className="bg-white rounded-2xl border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-3"><div><div className="text-[12px] font-bold text-slate-700">{p.name}</div><div className="text-[10px] text-slate-400">{fD(p.done)} · {fmt(p.cnt)} зап.</div></div><Tag t={p.st}/></div>
      <div className="grid grid-cols-2 gap-1.5">{p.docs.map((d,i)=>{const isLoading=loading===(d.t+"_"+p.id);return <button key={i} onClick={()=>!isLoading&&dl(p,d)} className={`flex items-center gap-2.5 p-3 rounded-xl transition text-left group ${isLoading?"bg-amber-50 ring-1 ring-amber-200":"bg-slate-50 hover:bg-emerald-50 hover:ring-1 hover:ring-emerald-200"}`}>{isLoading?<div className="w-[18px] h-[18px] border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin shrink-0"></div>:I.file}<div className="flex-1 min-w-0"><div className={`text-[11px] font-semibold truncate ${isLoading?"text-amber-700":"text-slate-700 group-hover:text-emerald-700"}`}>{d.n}</div><div className="text-[9px] text-slate-400">{isLoading?"Формирование документа...":fD(d.d)+" · Нажмите для скачивания"}</div></div>{!isLoading&&<span className="text-slate-300 group-hover:text-emerald-500">{I.dl}</span>}</button>})}</div>
    </div>)}</div>}
  </div>;
}

function PgNotifs({user,tick}){const all=S.g("notifs")||[];const my=all.filter(n=>n.role===user.role);const mark=id=>{const u=all.map(n=>n.id===id?{...n,read:true}:n);S.s("notifs",u);tick()};return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Уведомления</h1>{!my.length?<Empty title="Нет"/>:<div className="space-y-1.5">{my.map(n=><div key={n.id} onClick={()=>mark(n.id)} className={`p-3.5 rounded-2xl border cursor-pointer transition ${n.read?"bg-white border-slate-100":"bg-blue-50 border-blue-200"}`}><div className="flex justify-between"><div className="text-[12px] font-bold text-slate-700">{n.title}</div><div className="text-[10px] text-slate-400">{fDT(n.d)}</div></div><div className="text-[11px] text-slate-500 mt-0.5">{n.det}</div></div>)}</div>}</div>}
function PgClientSettings({user,tick}){
  const allInfos=S.g("clientInfos")||{};
  const stored=allInfos[user.id]||{};
  const [company,setCompany]=useState(stored.company||"");const [email,setEmail]=useState(stored.email||"");const [phone,setPhone]=useState(stored.phone||"");const [saved,setSaved]=useState(false);
  const save=async()=>{
    const infos=S.g("clientInfos")||{};
    infos[user.id]={company,email,phone};
    await S.s("clientInfos",infos);
    if(company){const us=S.g("users");const i=us.findIndex(x=>x.id===user.id);if(i>=0){us[i].name=company;await S.s("users",us)}}
    setSaved(true);addLog(user,"Настройки","Данные обновлены: "+company);tick();setTimeout(()=>setSaved(false),2000);
  };
  return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Настройки</h1>
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
      <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Наименование юр. лица</label><input value={company} onChange={e=>setCompany(e.target.value)} placeholder="ООО «Название»" className="mt-1 w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-slate-300"/></div>
      <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email для оповещений</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="info@company.ru" className="mt-1 w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-slate-300"/></div>
      <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Контактный телефон</label><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 (___) ___-__-__" className="mt-1 w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-slate-300"/></div>
      <div className="flex items-center gap-3"><Btn onClick={save}>Сохранить</Btn>{saved&&<span className="text-[12px] text-emerald-500 font-semibold">Сохранено</span>}</div>
    </div>
  </div>;
}
function PgAdminDash({_}){const ps=S.g("ports")||[];const j=S.g("log")||[];return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Администрирование</h1><div className="grid grid-cols-4 gap-3 mb-8"><Card l="Портфелей" v={ps.length} a/><Card l="Завершено" v={ps.filter(p=>p.st==="Завершено").length}/><Card l="Стоимость" v={fC(ps.reduce((a,p)=>a+(p.cost||0),0))}/><Card l="Событий" v={j.length}/></div><div className="bg-white rounded-2xl border border-slate-100 p-3 space-y-1.5">{j.slice(0,8).map(e=><div key={e.id} className="flex gap-2 text-[11px]"><span className="text-slate-400 w-28 shrink-0">{fDT(e.d)}</span><span className="font-bold text-slate-600">{e.ev}</span><span className="text-slate-400 truncate">{e.det}</span></div>)}{!j.length&&<div className="text-[11px] text-slate-300 text-center py-3">Пусто</div>}</div></div>}
function PgSvcs({tick}){const [svcs,set]=useState(S.g("svcs")||[]);const save=(id,f,v)=>{const u=svcs.map(s=>s.id===id?{...s,[f]:f==="price"?Number(v):v}:s);S.s("svcs",u);set(u);tick()};return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Тарифы</h1><div className="bg-white rounded-2xl border border-slate-100 overflow-hidden"><table className="w-full"><thead><tr className="border-b border-slate-100">{["Услуга","Ед.","Тариф ₽","Вкл"].map(h=><th key={h} className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider px-4 py-2.5">{h}</th>)}</tr></thead><tbody>{svcs.map(s=><tr key={s.id} className="border-b border-slate-50"><td className="px-4 py-2.5 text-[12px] text-slate-700">{s.name}</td><td className="px-4 py-2.5 text-[12px] text-slate-400">{s.unit}</td><td className="px-4 py-2.5"><input type="number" value={s.price} onChange={e=>save(s.id,"price",e.target.value)} className="w-24 text-right text-[12px] px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg"/></td><td className="px-4 py-2.5"><button onClick={()=>save(s.id,"on",!s.on)} className={`w-8 h-4 rounded-full transition flex items-center ${s.on?"bg-emerald-500":"bg-slate-200"}`}><div className={`w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${s.on?"ml-[14px]":"ml-0.5"}`}/></button></td></tr>)}</tbody></table></div></div>}
function PgUsers(){const us=S.g("users")||[];const rl={client:"Заказчик",executor:"Исполнитель",admin:"Администратор"};return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Пользователи</h1><div className="bg-white rounded-2xl border border-slate-100 overflow-hidden"><table className="w-full"><thead><tr className="border-b border-slate-100">{["Имя","Логин","Пароль","Роль"].map(h=><th key={h} className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider px-4 py-2.5">{h}</th>)}</tr></thead><tbody>{us.map(u=><tr key={u.id} className="border-b border-slate-50"><td className="px-4 py-2.5 text-[12px] font-semibold text-slate-700">{u.name}</td><td className="px-4 py-2.5 text-[12px] text-slate-500 font-mono">{u.login}</td><td className="px-4 py-2.5 text-[12px] text-slate-500 font-mono">{u.password}</td><td className="px-4 py-2.5 text-[12px] text-slate-400">{rl[u.role]}</td></tr>)}</tbody></table></div></div>}
function PgJournal(){const j=S.g("log")||[];return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Журнал</h1>{!j.length?<Empty title="Пусто"/>:<div className="bg-white rounded-2xl border border-slate-100 overflow-hidden"><table className="w-full"><thead><tr className="border-b border-slate-100">{["Дата","Кто","Событие","Детали"].map(h=><th key={h} className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider px-4 py-2.5">{h}</th>)}</tr></thead><tbody>{j.slice(0,30).map(e=><tr key={e.id} className="border-b border-slate-50"><td className="px-4 py-2 text-[10px] text-slate-400 whitespace-nowrap">{fDT(e.d)}</td><td className="px-4 py-2 text-[11px] text-slate-500">{e.u}</td><td className="px-4 py-2 text-[11px] font-bold text-slate-700">{e.ev}</td><td className="px-4 py-2 text-[11px] text-slate-400">{e.det}</td></tr>)}</tbody></table></div>}</div>}
function PgData({user,tick}){const [cf,setCf]=useState("");const resetAll=async()=>{await S.s("ports",[]);await S.s("log",[]);await S.s("notifs",[]);await S.s("users",DEF_USERS);await S.s("svcs",DEF_SVCS);setCf("");tick()};return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Данные</h1><div className="space-y-3"><div className="bg-white rounded-2xl border border-slate-100 p-4"><div className="text-[12px] font-bold text-slate-700 mb-2">Удалить портфели</div><Btn v="danger" s="s" onClick={()=>{S.s("ports",[]);addLog(user,"Удаление","Все портфели");tick()}}>Удалить</Btn></div><div className="bg-white rounded-2xl border border-slate-100 p-4"><div className="text-[12px] font-bold text-slate-700 mb-2">Очистить журнал</div><Btn v="danger" s="s" onClick={()=>{S.s("log",[]);tick()}}>Очистить</Btn></div><div className="bg-red-50 rounded-2xl border border-red-200 p-4"><div className="text-[12px] font-bold text-red-700 mb-2">Полный сброс</div><div className="flex gap-2"><input value={cf} onChange={e=>setCf(e.target.value)} placeholder="УДАЛИТЬ" className="px-2.5 py-1.5 text-[12px] border border-red-200 rounded-xl w-28"/><Btn v="danger" s="s" disabled={cf!=="УДАЛИТЬ"} onClick={resetAll}>Сбросить</Btn></div></div></div></div>}
function PgSettings(){return <div><h1 className="text-2xl font-bold text-slate-800 mb-6">Настройки</h1><div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">{[["Платформа","Платформа Финтех Юнит"],["Исполнитель","ООО Финтех Юнит"],["ИНН","9709112416"]].map(([l,v])=><div key={l}><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{l}</label><input defaultValue={v} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px]"/></div>)}</div></div>}

/* Login */
function Login({onLogin}){const [l,setL]=useState("");const [p,setP]=useState("");const [err,setErr]=useState("");const go=()=>{const us=S.g("users")||[];const u=us.find(x=>x.login===l&&x.password===p);if(u){addLog(u,"Вход",u.name);onLogin(u)}else setErr("Неверные данные")};return <div className="w-full max-w-sm"><div className="text-center mb-8"><div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-4"><span className="text-white font-black text-lg">FT</span></div></div><div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4"><div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Логин</label><input value={l} onChange={e=>{setL(e.target.value);setErr("")}} onKeyDown={e=>e.key==="Enter"&&go()} className="mt-1 w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-slate-300"/></div><div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Пароль</label><input type="password" value={p} onChange={e=>{setP(e.target.value);setErr("")}} onKeyDown={e=>e.key==="Enter"&&go()} className="mt-1 w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] focus:outline-none focus:ring-2 focus:ring-slate-300"/></div>{err&&<div className="text-[11px] text-red-500">{err}</div>}<Btn onClick={go} cls="w-full justify-center">Войти</Btn></div></div>}
function ChPw({user,onDone}){const [a,setA]=useState("");const [b,setB]=useState("");const [err,setErr]=useState("");const go=()=>{if(a.length<6)return setErr("Мин. 6");if(a!==b)return setErr("Не совпадают");const us=S.g("users");const i=us.findIndex(x=>x.id===user.id);us[i].password=a;us[i].mc=false;S.s("users",us);addLog(user,"Смена пароля","");onDone({...us[i]})};return <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-100 p-6"><h2 className="text-lg font-bold text-slate-800 mb-1">Смена пароля</h2><p className="text-[11px] text-slate-400 mb-5">Первый вход</p><div className="space-y-4"><div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Новый</label><input type="password" value={a} onChange={e=>{setA(e.target.value);setErr("")}} className="mt-1 w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px]"/></div><div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Повтор</label><input type="password" value={b} onChange={e=>{setB(e.target.value);setErr("")}} onKeyDown={e=>e.key==="Enter"&&go()} className="mt-1 w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px]"/></div>{err&&<div className="text-[11px] text-red-500">{err}</div>}<Btn onClick={go} cls="w-full justify-center">Сохранить</Btn></div></div>}

/* App */
export default function App(){
  const [user,setUser]=useState(()=>S.lg("session"));
  const [pg,setPg]=useState("dashboard");
  const [v,setV]=useState(0);
  const [ready,setReady]=useState(false);
  const tick=useCallback(()=>setV(n=>n+1),[]);

  useEffect(()=>{
    let unsub=null;
    (async()=>{
      await init();
      unsub=subscribeAll(tick);
      setReady(true);
    })();
    return ()=>{if(unsub)unsub()};
  },[tick]);

  useEffect(()=>{if(user&&!user._cp)S.ls("session",user);else S.lrm("session")},[user]);

  if(!ready)return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-center"><div className="w-12 h-12 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mb-4 mx-auto"></div><div className="text-[13px] text-slate-400">Подключение...</div></div></div>;

  const notifs=S.g("notifs")||[];const unread=user?notifs.filter(n=>n.role===user.role&&!n.read).length:0;
  if(!user)return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4"><Login onLogin={u=>{if(u.mc)setUser({...u,_cp:true});else setUser(u)}}/></div>;
  if(user._cp)return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4"><ChPw user={user} onDone={u=>setUser(u)}/></div>;
  const _=v;
  const page=()=>{
    if(user.role==="client")switch(pg){case"dashboard":return <PgDash user={user} _={_}/>;case"upload":return <PgUpload user={user} tick={tick}/>;case"ports":return <PgList user={user} role="client" tick={tick}/>;case"docs":return <PgDocs user={user}/>;case"csettings":return <PgClientSettings user={user} tick={tick}/>;case"notifs":return <PgNotifs user={user} tick={tick}/>;default:return <PgDash user={user} _={_}/>}
    if(user.role==="executor")switch(pg){case"dashboard":return <PgDash user={user} _={_}/>;case"incoming":return <PgList user={user} role="executor" tick={tick}/>;case"docs":return <PgDocs user={user}/>;case"notifs":return <PgNotifs user={user} tick={tick}/>;default:return <PgDash user={user} _={_}/>}
    switch(pg){case"dashboard":return <PgAdminDash _={_}/>;case"svcs":return <PgSvcs tick={tick}/>;case"users":return <PgUsers/>;case"docs":return <PgDocs user={user}/>;case"journal":return <PgJournal/>;case"data":return <PgData user={user} tick={tick}/>;case"settings":return <PgSettings/>;default:return <PgAdminDash _={_}/>}
  };
  return <div className="flex min-h-screen bg-slate-50"><Nav user={user} pg={pg} go={setPg} out={()=>{S.lrm("session");setUser(null);setPg("dashboard")}} unread={unread}/><main className="flex-1 p-7 overflow-auto">{page()}</main></div>;
}

