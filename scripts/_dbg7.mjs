import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const ROOT='C:/Users/Dromor Narh/Desktop/GithubRepos/NedhubSMS';
const PORT=8133;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(ROOT,u);fs.readFile(fp,(e,d)=>{if(e){res.statusCode=404;res.end('nf');return;}res.end(d);});});
await new Promise(r=>server.listen(PORT,r));
const browser=await chromium.launch();
const ctx=await browser.newContext();
await ctx.addInitScript(()=>{localStorage.setItem('authToken','t');localStorage.setItem('authStorageType','local');localStorage.setItem('userName','John Doe');});
const page=await ctx.newPage();
page.on('console',m=>console.log('CONSOLE',m.type(),m.text()));
await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{user:{name:'John Doe',email:'a@b.com',role:'user'}}})}));
await page.setViewportSize({width:390,height:844});
await page.goto(`http://localhost:${PORT}/src/pages/dashboard/analytics.html`,{waitUntil:'networkidle'});
await page.waitForTimeout(2000);
// check burger
const burger = await page.$('.nhs-burger');
console.log('burger exists:', !!burger);
const box = await burger.boundingBox();
console.log('burger box:', box);
// click with force
await page.click('.nhs-burger', { force: true });
await page.waitForTimeout(500);
const state = await page.evaluate(()=>({open: document.querySelector('.nhs-sidebar').classList.contains('is-open'), left: document.querySelector('.nhs-sidebar').getBoundingClientRect().left}));
console.log('state after click:', state);
await browser.close(); server.close();
