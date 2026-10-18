import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEnv, codexArgs, classifyFailure } from '../server/providers.mjs';
test('subscription runner does not inherit API billing credentials',()=>{const e=cleanEnv({HOME:'/home/me',PATH:'/bin',OPENAI_API_KEY:'secret',ANTHROPIC_API_KEY:'secret',CLAUDE_CODE_OAUTH_TOKEN:'secret',TERM:'xterm'});assert(!e.OPENAI_API_KEY);assert(!e.ANTHROPIC_API_KEY);assert(!e.CLAUDE_CODE_OAUTH_TOKEN);assert.equal(e.HOME,'/home/me');});
test('automated Codex execution is read-only and avoids user-config integrations',()=>{const args=codexArgs('');assert(args.includes('read-only'));assert(args.includes('--ignore-user-config'));assert(!args.includes('--dangerously-bypass-approvals-and-sandbox'));});
test('quota and auth errors remain distinct from generic failure',()=>{assert.equal(classifyFailure('usage limit reached'),'limited');assert.equal(classifyFailure('not logged in'),'auth_required');assert.equal(classifyFailure('unknown error'),'failed');});
