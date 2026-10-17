import test from 'node:test'
import assert from 'node:assert/strict'
import {safeProductImage,storedProductImages} from '../src/lib/product-images.ts'
test('stored supplier images accept public HTTPS only and reject private addresses and credential URLs',()=>{
 for(const host of ['172.16.0.1','172.31.255.255','100.64.0.1','198.18.0.1','0.0.0.0','224.0.0.1','images.internal','localhost','10.0.0.1'])assert.equal(safeProductImage(`https://${host}/image.png`),null)
 assert.deepEqual(storedProductImages('["https://cdn.example.com/item.png","https://cdn.example.com/item.png","https://cdn.example.com/private?token=secret"]'),['https://cdn.example.com/item.png'])
 assert.deepEqual(storedProductImages('invalid'),[])
})
