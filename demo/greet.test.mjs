import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from './greet.mjs';
test('이름의 공백을 정리한다', () => assert.equal(greet(' Nexus '), '안녕하세요, Nexus님!'));
test('빈 이름을 처리한다', () => assert.equal(greet('  '), '안녕하세요, 친구님!'));
