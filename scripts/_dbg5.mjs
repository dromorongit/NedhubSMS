import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const ROOT='C:/Users/Dromor Narh/Desktop/GithubRepos/NedhubSMS';
const PORT=8131;
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(ROOT,u);fs.readFile(fp,(e,d)=>{if(e){res.statusCode=404;res.end('nf');return;}res.end(d);});});
await new Promise(r=>server.listen(PORT,r));
const browser=await chromium.launch();
for (const pg of ['overview.html','settings.html']) {
  const ctx=await browser.newContext();
  await ctx.addInitScript(()=>{localStorage.setItem('authToken','t');localStorage.setItem('authStorageType','local');localStorage.setItem('userName','John Doe');});
  const page=await ctx.newPage();
  await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{user:{name:'John Doe',email:'a@b.com',role:'user'}}})}));
  await page.setViewportSize({width:1366,height:768});
  await page.goto(`http://localhost:${PORT}/src/pages/dashboard/${pg}`,{waitUntil:'networkidle'});
  await page.waitForTimeout(1200);
  const html=await page.evaluate(()=>document.querySelector('.nhs-topbar').outerHTML);
  const norm=html.replace(/<h1 class="nhs-page-title"[^>]*>.*?<\/h1>/,'<h1 class="nhs-page-title" id="nhsPageTitle">TITLE</h1>').replace(/<span class="nhs-topbar-name"[^>]*>.*?<\/span>/,'<span class="nhs-topbar-name" id="userName">NAME</span>');
  console.log('NORMALIZED:',norm);
  console.log('===',pg,'===');
  console.log(html);
  await ctx.close();
}
await browser.close(); server.close();
