import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const html=readFileSync('dist/index.html','utf8');const file=html.match(/src="([^"]+\.js)"/)[1];const bytes=gzipSync(readFileSync('dist'+file)).length;
console.log(`Initial JS gzip: ${bytes} bytes (budget: 110000)`);if(bytes>110000)process.exit(1);
