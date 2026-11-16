import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveTargets} from '../public/recipients.js';
test('mentions recognize spaces, Chinese adjacency, punctuation and case without inviting defaults',()=>{
  for(const text of ['@Gemini 你好','@Gemini你好','@Gemini，分析一下','@gemini hello'])assert.deepEqual(resolveTargets(text,['ChatGPT','Gemini','Claude']),['Gemini']);
  assert.deepEqual(resolveTargets('hello',['Gemini']),['Gemini']);assert.deepEqual(resolveTargets('@ChatGPT @Claude',[]),['ChatGPT','Claude']);assert.deepEqual(resolveTargets('@GeminiFake',['Claude']),['Claude']);
});

test('DeepSeek mention selects only DeepSeek',()=>{assert.deepEqual(resolveTargets('@deepseek你好',['ChatGPT']),['DeepSeek']);});
