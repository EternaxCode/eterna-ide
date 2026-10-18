import {readdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
const dir=resolve(process.argv[2]||'artifacts/desktop-release');
const assets=readdirSync(dir).filter(n=>/\.(exe|dmg)$/.test(n)).map(name=>{const path=join(dir,name),data=readFileSync(path);return {name,bytes:statSync(path).size,sha256:createHash('sha256').update(data).digest('hex'),platform:name.endsWith('.dmg')?'macOS':'Windows'};});
writeFileSync(join(dir,'SHA256SUMS.txt'),assets.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');writeFileSync(join(dir,'manifest.json'),JSON.stringify({version:JSON.parse(readFileSync('package.json')).version,assets},null,2));console.log(assets);
