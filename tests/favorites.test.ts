import test from 'node:test'
import assert from 'node:assert/strict'
import {parseFavorites} from '../src/lib/favorites.ts'
test('local favorites tolerate malformed storage, deduplicate and bound IDs for the public API',()=>{
 const id='50000000-0000-4000-8000-000000000001'
 assert.deepEqual(parseFavorites('{broken'),[]);assert.deepEqual(parseFavorites('{"id":1}'),[])
 assert.deepEqual(parseFavorites(JSON.stringify([id,id,'../admin',42,null])),[id])
 assert.equal(parseFavorites(JSON.stringify(Array.from({length:105},(_,i)=>`50000000-0000-4000-8000-${String(i).padStart(12,'0')}`))).length,100)
})
