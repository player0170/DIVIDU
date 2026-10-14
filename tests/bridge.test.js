import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRpc } from '../src/bridge/protocol.js';
test('RPC rejects unknown methods, oversized requests and hostile selection keys',()=>{
    assert.equal(validateRpc({requestId:'a',method:'state.read',payload:{}}).method,'state.read');
    // A message that omits `payload` must be accepted, not crash the size check.
    assert.equal(validateRpc({requestId:'a',method:'state.read'}).method,'state.read');
    assert.throws(()=>validateRpc({requestId:'a',method:'execute',payload:{}}));
    assert.throws(()=>validateRpc({requestId:'a',method:'selection.update',payload:JSON.parse('{"__proto__":{}}')}));
    assert.throws(()=>validateRpc({requestId:'a',method:'api.save',payload:{name:'a'.repeat(300000)}}));
});
