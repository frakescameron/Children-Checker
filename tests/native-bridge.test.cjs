// Exercises the page's Android bridge contract in Chromium (not an Android runtime).
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 await page.addInitScript(()=>{
  window.nativeCalls={};
  window.ChildrenAndroid={
   readData(){return JSON.stringify({ok:true,data:JSON.parse(localStorage.getItem('nativeTest')||'{"version":2,"revision":0,"kids":[],"checkins":[]}')});},
   saveData(json,expected){const current=JSON.parse(localStorage.getItem('nativeTest')||'{"revision":0}');if(current.revision!==expected)return JSON.stringify({ok:false,error:'Revision mismatch'});localStorage.setItem('nativeTest',json);return '{"ok":true,"data":true}';},
   printReport(html){window.nativeCalls.print=html;},
   exportFile(filename,mime,content){window.nativeCalls.export={filename,mime,content};},
   openBackup(){window.nativeCalls.import=true;}
  };
 });
 await page.goto(pathToFileURL(path.resolve(__dirname,'../www/index.html')).href);
 await page.evaluate(()=>{const k=store.saveKid({childName:'Bridge Test',parentName:'Parent',notes:[]});store.checkIn([k.id],{pickupParent:'Parent'});render();});
 await page.reload();assert.equal(await page.locator('.kid-card').count(),1);
 await page.getByRole('button',{name:'Print current list'}).click();
 assert.match(await page.evaluate(()=>nativeCalls.print),/Bridge Test/);
 await page.getByRole('button',{name:'Manage Kids',exact:true}).click();
 await page.getByRole('button',{name:'Save backup',exact:true}).click();
 assert.equal(JSON.parse(await page.evaluate(()=>nativeCalls.export.content)).checkins.length,1);
 await page.getByRole('button',{name:'Restore backup',exact:true}).click();
 assert.equal(await page.evaluate(()=>nativeCalls.import),true);
 await page.evaluate(()=>window.receiveBackup(localStorage.getItem('nativeTest')));
 await page.locator('#acceptConfirm').click();
 assert.equal((await page.evaluate(()=>store.active())).length,1);
 await browser.close();console.log('PASS: Android bridge JSON contract, save/reload, print, export, and import callbacks. Native Android services require a device test.');
})().catch(e=>{console.error(e);process.exit(1)});
