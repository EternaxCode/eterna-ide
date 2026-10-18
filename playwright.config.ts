import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'e2e.spec.ts',workers:1,use:{baseURL:'http://127.0.0.1:14320',channel:'chrome',headless:true,viewport:{width:1440,height:1000}},webServer:{command:'node server/index.mjs',env:{NEXUS_PORT:'14320',NEXUS_DATA_DIR:mkdtempSync(join(tmpdir(),'nexus-e2e-server-')),NEXUS_TEST_TOKEN:'e2e-test-token'},url:'http://127.0.0.1:14320',reuseExistingServer:false}});
