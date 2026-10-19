const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
function setup(fetch, hostname = 'localhost') {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {hidden:false, textContent:'', value:'', listeners:{},
      classList:{values:new Set(),toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);},add(){},remove(){}}, setAttribute(){},removeAttribute(){},focus(){},
      addEventListener(type,fn){this.listeners[type]=fn;}});
    return nodes.get(key);
  };
  vm.runInNewContext(readFileSync('frontend/app.js','utf8'), {
    document:{querySelector:node,querySelectorAll:()=>[]},
    location:{hostname,port:'8000'}, window:{scrollTo(){},MENDII_CONFIG:{apiOrigin:'https://thrash-sessions-tasty.ngrok-free.dev'}},
    URL:{createObjectURL:()=> 'blob:original',revokeObjectURL(){}},
    Image:class {async decode(){}}, TypeError, SyntaxError, FormData, AbortController, setTimeout, clearTimeout, fetch,
  });
  return {node, async select(){
    const file = new File([new Uint8Array([255,216,255,225,0,6,69,120,105,102])], 'original.jpg', {type:'image/jpeg'});
    await node('#file').listeners.change({target:{files:[file]}});
    return file;
  }, analyze:()=>node('#analyze').listeners.click()};
}
for (const prediction of ['정상','outsole','heel lining','outsole + heel lining']) {
  test(`original upload and exact prediction: ${prediction}`, async()=> {
    let request;
    const app=setup(async(url,options)=>{request={url,options};return {ok:true,json:async()=>({prediction,results:[{disease:'outsole',verdict:'의심'},{disease:'heel_lining',verdict:'정상'}]})};});
    const file=await app.select(); await app.analyze();
    assert.equal(request.url,'/predict');
    assert.equal(request.options.body.get('file'),file);
    assert.equal(request.options.headers,undefined);
    assert.equal(app.node('#prediction').textContent, {'정상':'정상','outsole':'밑창 손상 의심!','heel lining':'뒤꿈치 안감 손상 의심!','outsole + heel lining':'밑창 및 뒤꿈치 안감 손상 의심!'}[prediction]);
    assert.equal(app.node('#prediction').classList.values.has('suspected'),prediction !== '정상');
    assert.equal(app.node('#outsole-verdict').textContent,'의심');
    assert.equal(app.node('#outsole-verdict').classList.values.has('suspected'),true);
    assert.equal(app.node('#heel_lining-verdict').classList.values.has('suspected'),false);
    assert.equal(app.node('#result-view').hidden,false);
  });
}
test('network failure returns to confirmation for retry',async()=>{
  const app=setup(async()=>{throw new TypeError('offline');});
  await app.select();await app.analyze();
  assert.equal(app.node('#confirm-view').hidden,false);
  assert.match(app.node('#analysis-error').textContent,/서버/);
});
test('invalid response never shows a result',async()=>{
  const app=setup(async()=>({ok:true,json:async()=>({})}));
  await app.select();await app.analyze();
  assert.equal(app.node('#confirm-view').hidden,false);
  assert.match(app.node('#analysis-error').textContent,/결과/);
});
test('leaving cancels request and ignores late results',async()=>{
  let resolve,signal;
  const app=setup((url,options)=>{signal=options.signal;return new Promise(r=>resolve=r);});
  await app.select();const pending=app.analyze();
  app.node('#back').listeners.click();
  assert.equal(signal.aborted,true);
  resolve({ok:true,json:async()=>({prediction:'outsole'})});await pending;
  assert.equal(app.node('#home').hidden,false);
  assert.equal(app.node('#prediction').textContent,'');
});

test('GitHub Pages sends the original file to the Colab API with ngrok header', async()=>{
  let request;
  const app=setup(async(url,options)=>{request={url,options};return {ok:true,json:async()=>({prediction:'정상'})};},'ddoguma.github.io');
  const file=await app.select();await app.analyze();
  assert.equal(request.url,'https://thrash-sessions-tasty.ngrok-free.dev/predict');
  assert.equal(request.options.body.get('file'),file);
  assert.equal(request.options.headers['ngrok-skip-browser-warning'],'true');
});
