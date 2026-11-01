import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const ROOT='C:/Users/Dromor Narh/Desktop/GithubRepos/NedhubSMS';
const PORT=8134;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(ROOT,u);fs.readFile(fp,(e,d)=>{if(e){res.statusCode=404;res.end('nf');return;}res.end(d);});});
await new Promise(r=>server.listen(PORT,r));
const browser=await chromium.launch();
const ctx=await browser.newContext();
await ctx.addInitScript(()=>{localStorage.setItem('authToken','t');localStorage.setItem('authStorageType','local');localStorage.setItem('userName','John Doe');});
const page=await ctx.newPage();
page.on('console',m=>console.log('CONSOLE',m.type(),m.text()));
await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{user:{name:'John Doe',email:'a@b.com',role:'user'},totalCampaigns:0,totalRecipients:0,deliveryRate:0,totalActualCost:0,sendsOverTime:[],deliverySuccessRate:[],costTrends:[]}})}));
await page.setViewportSize({width:390,height:844});
await page.goto(`http://localhost:${PORT}/src/pages/dashboard/analytics.html`,{waitUntil:'networkidle'});
await page.waitForTimeout(2000);
// replicate (d) scroll
await page.evaluate(()=>{const n=document.querySelector('.nhs-nav'); if(n) n.scrollTop=n.scrollHeight;});
await page.waitForTimeout(100);
// reset
await page.evaluate(()=>{const n=document.querySelector('.nhs-nav'); if(n) n.scrollTop=0;});
// preventDefault
await page.evaluate(() => { document.querySelectorAll('.nhs-nav .nhs-link').forEach(a => a.addEventListener('click', e => e.preventDefault(), { once: true, capture: true })); });
await page.click('.nhs-burger', { force: true });
await page.waitForTimeout(320);
console.log('after open:', await page.evaluate(()=>document.querySelector('.nhs-sidebar').classList.contains('is-open')));
await page.click('.nhs-nav .nhs-link', { force: true });
await page.waitForTimeout(320);
console.log('after link click:', await page.evaluate(()=>document.querySelector('.nhs-sidebar').classList.contains('is-open')));
await browser.close(); server.close();
