import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const roots=['src','public','scripts','tests','docs'];
const patterns=[/AIza[0-9A-Za-z_-]{35}/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/(?:ghp|github_pat)_[A-Za-z0-9_]{30,}/g,/"private_key"\s*:\s*"[^"\n]{20,}/g];
let files=0,failures=[];
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const file=path.join(dir,e.name);if(e.isDirectory())await scan(file);else if(/\.(?:[cm]?[jt]sx?|json|md|html|css|yml)$/.test(e.name)){files++;const text=await readFile(file,'utf8');if(patterns.some(p=>{p.lastIndex=0;return p.test(text);}))failures.push(file);}}}
for(const root of roots)await scan(root);
if(failures.length){console.error('Possible secrets found. Values are intentionally not printed:\n'+failures.join('\n'));process.exitCode=1;}else console.log(`No known credential patterns found in ${files} source/configuration files. This scan is not a guarantee.`);
