import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
test('Send lookup handles visible text, sr-only text, labelled roles, and rejects disabled or ambiguous controls',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();
    const source=await readFile(new URL('../browser-connector/send-control.js',import.meta.url),'utf8');
    for(const markup of ['<button id="send">发送</button>','<button id="send"><svg></svg><span style="position:absolute;width:1px;height:1px;overflow:hidden">发送</span></button>','<span id="label">发送</span><div id="send" role="button" aria-labelledby="label" tabindex="0">↑</div>']){
      await page.setContent(`<meta charset="utf-8"><style>[contenteditable]{width:200px;height:40px}[role=button]{width:40px;height:40px}</style><form><div contenteditable="true" id="editor"></div>${markup}</form>`);await page.addScriptTag({content:source});
      assert.equal(await page.evaluate(()=>findSendControl(document.querySelector('#editor'),[],true)?.id),'send');
      await page.evaluate(()=>document.querySelector('#send').setAttribute('aria-disabled','true'));
      assert.equal(await page.evaluate(()=>!!findSendControl(document.querySelector('#editor'),[],true)),false);
    }
    await page.setContent('<form><div id="editor"></div><button>发送</button><button>发送</button></form>');await page.addScriptTag({content:source});assert.equal(await page.evaluate(()=>!!findSendControl(document.querySelector('#editor'),[],true)),false);
  }finally{await browser.close();}
});
