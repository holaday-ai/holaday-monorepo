const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const root = cp.execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const ts = require(path.join(root,'apps/web-workbench/node_modules/typescript'));
const git = (...args) => cp.execFileSync('git',args,{cwd:root,encoding:'utf8'});
const files=git('diff','--name-only','85329cb3').trim().split('\n').filter(f=>/src\/.*\.tsx?$/.test(f)&&!f.includes('.test.'));
function calls(text) {
 const source=ts.createSourceFile('source.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), result=[];
 const walk=(node)=>{
  if(ts.isCallExpression(node)){
   const callee=node.expression.getText(source).replace(/\s+/g,'');
   if(/^trpc\.[\w.]+\.(query|mutate)$/.test(callee))result.push(callee+'('+node.arguments.map(a=>a.getText(source).replace(/\s+/g,'')).join(',')+')');
  }
  ts.forEachChild(node,walk);
 }; walk(source);return result.sort();
}
const baseFiles = new Set(git('ls-tree', '-r', '--name-only', '85329cb3').trim().split('\n'));
const changed=[];
for(const file of files){const before=calls(baseFiles.has(file)?git('show','85329cb3:'+file):'');const after=calls(fs.readFileSync(path.join(root,file),'utf8'));if(JSON.stringify(before)!==JSON.stringify(after))changed.push(file);}
const protectedFiles=['src/App.tsx','src/components/BrowserPanel.tsx','src/components/VncViewport.tsx','src/components/FailureHeaderCard.tsx','src/lib/task-failure-recovery.ts','src/pages/admin/AdminModelsPage.tsx','src/pages/admin/AdminSelfCheckPage.tsx','src/lib/trpc.ts','src/lib/ws.ts'];
const protectedResult=protectedFiles.map(file=>{const full='apps/web-workbench/'+file;const before=git('show','85329cb3:'+full);const current=fs.readFileSync(path.join(root,full),'utf8');return {file,unchanged:before===current,sha256:crypto.createHash('sha256').update(current).digest('hex')};});
const excluded=git('diff','--name-only','85329cb3','--','apps/orchestrator','packages','scripts','.github','pnpm-lock.yaml').trim();
const result={base:'85329cb3',apiCallsitesChanged:changed,protectedFiles:protectedResult,backendSharedOpsChanges:excluded?excluded.split('\n'):[]};
if (process.env.UI_AUDIT_OUTPUT) fs.writeFileSync(process.env.UI_AUDIT_OUTPUT, JSON.stringify(result,null,2));
console.log(JSON.stringify({apiCallsitesChanged:changed,protectedFilesUnchanged:protectedResult.every(f=>f.unchanged),backendSharedOpsChanges:result.backendSharedOpsChanges}));
if(changed.length||excluded||protectedResult.some(f=>!f.unchanged))process.exitCode=1;
