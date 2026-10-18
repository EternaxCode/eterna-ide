import { spawnSync, spawn } from 'node:child_process';
const build=spawnSync('npm',['run','build'],{stdio:'inherit'});if(build.status!==0)process.exit(build.status||1);
const server=spawn('node',['--watch','server/index.mjs'],{stdio:'inherit'});server.on('exit',c=>process.exit(c||0));
