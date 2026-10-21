import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const backend='https://ui-fixture.example', base=process.env.UI_TEST_URL || 'http://127.0.0.1:5197';
const uid='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const session={ access_token:`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub:uid,exp:Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`,
  refresh_token:'fixture',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{ id:uid,email:'local@example.com',app_metadata:{},user_metadata:{} } };
const browser=await chromium.launch({ headless:true,executablePath:process.env.CHROMIUM_PATH,
  args:['--disable-breakpad','--disable-crash-reporter',`--crash-dumps-dir=${process.cwd()}/.volcengine-build/chrome-crashes`] });
try {
  const context=await browser.newContext({ viewport:{ width:390,height:844 },reducedMotion:'reduce' });
  await context.addInitScript(value=>localStorage.setItem('sb-ui-fixture-auth-token',JSON.stringify(value)),session);
  let targets=[],jobs=[],failCollect=true,failCatalog=false;
  const submissions=[],imports=[],errors=[];
  await context.route(`${backend}/**`,async route=>{
    const req=route.request(),path=new URL(req.url()).pathname; let body={}; try { body=req.postDataJSON()||{}; } catch {}
    let data=[],status=200;
    if(req.method()==='OPTIONS') data={};
    else if(path.includes('/auth/')) data=session.user;
    else if(path.endsWith('/market-intelligence')) {
      if(body.action==='catalog') {
        status=failCatalog?503:200;
        data=failCatalog?{ error:'采集记录暂时不可用' }:{ targets:body.kind==='intelligence_products'?targets:[],
          sources:[{ slot:'intelligence.ebay',enabled:true },{ slot:'intelligence.youtube',enabled:false }],
          prices:{ intelligence_products:2,intelligence_competitor:2 },jobs };
      } else if(body.action==='save_target') {
        targets=[{ id,name:body.name,kind:body.kind,params:body.params,source_slot:body.source_slot,latest:null,history:[],monitoring:false,remaining_runs:0,remaining_budget:0 }];
        data={ target:targets[0] }; status=201;
      } else if(body.action==='collect') {
        submissions.push(body);
        if(!jobs.length) jobs=[{ id,request_key:body.request_key,kind:'intelligence_products',target_id:id,status:'pending',credit_cost:2,created_at:new Date().toISOString() }];
        data=failCollect?{ error:'采集创建回执待确认' }:{ job:jobs[0] }; status=failCollect?503:202;
      } else if(body.action==='import_product') { imports.push(body); data={ product_id:id }; }
    } else if(path.includes('/rest/v1/profiles')) data={ id:uid,username:'测试',invite_code:'TEST' };
    else if(path.includes('/rest/v1/user_plans')) data={ credits_total:100,credits_used:0,plans:{ name:'专业版' } };
    await route.fulfill({ status,contentType:'application/json',body:JSON.stringify(data),
      headers:{ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*' } });
  });
  const page=await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/product-selection');
  await page.getByText('还没有情报对象。保存账号或搜索后，可确认积分并开始采集。',{ exact:true }).waitFor();
  assert.ok(!(await page.locator('main').innerText()).includes('NIVEA'));
  await page.getByLabel('数据源',{ exact:true }).selectOption('intelligence.licensed');
  await page.getByLabel('目标市场',{ exact:true }).selectOption('MY');
  await page.getByLabel('数据源',{ exact:true }).selectOption('intelligence.ebay');
  assert.equal(await page.getByLabel('目标市场',{ exact:true }).inputValue(),'US');
  await page.getByLabel('商品关键词',{ exact:true }).fill('cup');
  await page.getByRole('button',{ name:'保存情报对象',exact:true }).click();
  await page.getByText('尚无正式采集快照，请先采集。',{ exact:true }).waitFor();
  const response=page.waitForResponse(res=>res.url().endsWith('/market-intelligence') && res.request().postDataJSON()?.action==='collect');
  await page.getByRole('button',{ name:'立即采集 · 2积分',exact:true }).click(); await response;
  await page.getByRole('button',{ name:'恢复原情报请求',exact:true }).waitFor();
  await page.reload(); failCollect=false;
  await page.getByRole('button',{ name:'恢复原情报请求',exact:true }).click();
  await page.getByRole('button',{ name:'恢复原情报请求',exact:true }).waitFor({ state:'detached' });
  assert.deepEqual(submissions[0],submissions[1]); assert.equal(jobs.length,1);
  jobs[0].status='completed';
  targets[0].latest={ job_id:id,collected_at:new Date().toISOString(),data:{
    source:{ slot:'intelligence.ebay',version_id:id,name:'eBay',observed_at:new Date().toISOString(),definition:'eBay Browse官方Best Match商品搜索，不含销量排行。' },
    params:{ query:'cup',market:'US' },items:[{ id:'v1|1|0',title:'真实杯子 '+ '较长商品名称'.repeat(20),url:'https://www.ebay.com/itm/1',price:'12.90',currency:'USD',sold_7d:null,stock:null,seller:null }] } };
  await page.getByRole('button',{ name:'刷新情报记录',exact:true }).click();
  await page.getByText('近7天销量 未提供',{ exact:true }).waitFor();
  await page.getByRole('checkbox').check();
  const imported=page.waitForResponse(res=>res.url().endsWith('/market-intelligence') && res.request().method()==='POST' && res.request().postDataJSON()?.action==='import_product');
  await page.getByRole('button',{ name:'加入所选商品（1）',exact:true }).click();
  await imported;
  await page.getByText('已加入1个商品，请在商品库确认分类与卖点',{ exact:true }).waitFor();
  assert.equal(imports[0].sample_id,id); assert.equal(imports[0].item_id,'v1|1|0');
  await page.getByText('已加入1个商品，请在商品库确认分类与卖点',{ exact:true }).waitFor({ state:'hidden' });
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({ path:'.volcengine-build/intelligence-products-mobile.png',fullPage:true });
  failCatalog=true; await page.getByRole('button',{ name:'刷新情报记录',exact:true }).click();
  await page.getByRole('alert').filter({ hasText:'采集记录暂时不可用' }).waitFor();
  await page.getByText('近7天销量 未提供',{ exact:true }).waitFor();
  failCatalog=false; await page.goto(base+'/competitor');
  await page.getByText('还没有情报对象。保存账号或搜索后，可确认积分并开始采集。',{ exact:true }).waitFor();
  assert.ok(!(await page.locator('main').innerText()).includes('小美美妆'));
  await page.getByText('此数据源未启用，请由管理员在模型接口设置中配置。',{ exact:true }).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('PASS 390px两页面空态/未配置、真实快照/缺失销量、长标题、503刷新同UUID恢复、来源批量入库和读取失败保留快照');
} finally { await browser.close(); }
