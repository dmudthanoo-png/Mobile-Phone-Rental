import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const nativeRequire = createRequire(import.meta.url);

export function loadSource(source, mocks = {}, filename = 'test.ts') {
  const output = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiledModule = { exports: {} };
  const requireMock = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) throw new Error(`Unmocked application dependency: ${id}`);
    return nativeRequire(id);
  };
  new Function('require', 'module', 'exports', output)(requireMock, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
export function loadTs(path, mocks = {}) {
  return loadSource(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), mocks, path);
}

// Small awaitable PostgREST double: records actual filters, never contacts a server.
export function mockClient(resolve, rpc = async () => ({ data: { ok: true }, error: null })) {
  const calls = [];
  const client = {
    rpc: async (...args) => { calls.push({ kind: 'rpc', args }); return rpc(...args); },
    from(table) {
      const call = { kind: 'query', table, operations: [] }; calls.push(call);
      const q = {};
      for (const method of ['select','eq','neq','not','in','or','order','range','update','insert','gte','lt']) {
        q[method] = (...args) => { call.operations.push([method,...args]); return q; };
      }
      q.then = (yes, no) => Promise.resolve(resolve(call)).then(yes,no);
      q.maybeSingle = () => Promise.resolve(resolve(call));
      q.single = q.maybeSingle;
      return q;
    },
  };
  return { client, calls };
}
