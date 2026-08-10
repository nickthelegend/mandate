import { chromium } from "playwright";
const B="https://nickthelegend.github.io/outcome";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
const probs=[];
p.on("console",m=>{if(m.type()==="error"&&!/favicon/i.test(m.text()))probs.push("console: "+m.text().slice(0,110))});
p.on("pageerror",e=>probs.push("pageerror: "+e.message.slice(0,110)));
p.on("response",r=>{if(r.status()>=400&&r.status()!==402&&!/favicon/.test(r.url()))probs.push(`http${r.status()}`)});
await p.goto(`${B}/?cb=95`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
let t=await p.evaluate(()=>document.body.innerText);
console.log("  headline is the authority :", /cannot\s+exceed/i.test(t)?"PASS":"FAIL");
console.log("  old verification pitch gone:", !/Pay agents for proven|pays on a promise/i.test(t)?"PASS":"FAIL");
console.log("  chain-of-custody rendered  :", /PolicyAnchorMismatch/.test(t)&&/PolicyNotUsable/.test(t)?"PASS":"FAIL");
console.log("  surfaces listed incl MPP   :", /MPP is the one we did not use/.test(t)?"PASS":"FAIL");

// the live engine: click each case, confirm the verdict changes and names a rule
const cases=["Agent tries to spend $5,000","Today's budget already spent","Buying outside its remit","Looping — 40 calls this hour","Kill switch pulled on chain"];
const seen=new Set();
for(const c of cases){
  await p.locator(`button:has-text(${JSON.stringify(c.slice(0,22))})`).first().click();
  await p.waitForTimeout(1400);
  const v=await p.evaluate(()=>{const e=document.querySelector(".verdict"); return e?e.textContent.trim():null;});
  const refusedAt=await p.evaluate(()=>{const m=document.body.innerText.match(/Refused at ([a-zA-Z.]+)/); return m?m[1]:null;});
  console.log(`  ${c.slice(0,30).padEnd(32)} -> ${String(v).padEnd(26)} rule=${refusedAt}`);
  if(v) seen.add(v);
}
console.log("  distinct verdicts produced :", seen.size>=4?"PASS ("+seen.size+")":"FAIL ("+seen.size+")");
// mobile
await p.setViewportSize({width:375,height:812}); await p.waitForTimeout(1200);
const of=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
console.log("  375px horizontal overflow  :", of<=2?"PASS":"FAIL "+of+"px");
console.log("\n  console/network problems:", probs.length); probs.slice(0,5).forEach(x=>console.log("    "+x));
await b.close();
