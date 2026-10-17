import test from 'node:test';import assert from 'node:assert/strict';import {generateASS,sanitizeCue,timeStamp} from '../lib/media.mjs';
test('ASS time formatting',()=>assert.equal(timeStamp(65.12),'0:01:05.12'));
test('subtitle validation',()=>{assert.throws(()=>sanitizeCue({start:10,end:9}));assert.equal(sanitizeCue({start:0,end:2,khmer:'សួស្តី'}).khmer,'សួស្តី')});
test('ASS output has valid dialogue and Khmer text',()=>{const s=generateASS([{start:1.25,end:4.75,khmer:'សួស្តី\nអ្នកសុខសប្បាយទេ?',original:''}]);assert.match(s,/Dialogue: 0,0:00:01.25,0:00:04.75/);assert.match(s,/សួស្តី\\Nអ្នកសុខសប្បាយទេ/);assert.match(s,/Noto Sans Khmer/)});
test('ASS escaping for braces and backslashes',()=>{const s=generateASS([{start:0,end:2,khmer:'a{b}\\c'}]);assert.match(s,/a\\\{b\\\}\\\\c/)});
