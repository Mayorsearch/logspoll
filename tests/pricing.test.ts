import test from 'node:test'
import assert from 'node:assert/strict'
import {calculateSellingPrice,convertSupplierCost,resolvePricingRule} from '../server/pricing.ts'
import type {PricingRule} from '../server/pricing.ts'
const base:PricingRule={id:'global',enabled:true,mode:'markup',rateBps:5000,fixedMinor:0,minProfitMinor:0,feeBps:0,feeFixedMinor:0,fxBufferBps:0,roundingMinor:1}
test('markup uses original cost and never compounds an existing selling price',()=>{
 for(const [cost,rate,price]of [[20,5000,30],[50,5000,75],[100,10000,200],[30,5000,45]]){assert.equal(calculateSellingPrice(cost,{...base,rateBps:rate}).sellingPriceMinor,price);assert.equal(calculateSellingPrice(cost,{...base,rateBps:rate}).sellingPriceMinor,price)}
 assert.equal(calculateSellingPrice(100,{...base,mode:'margin',rateBps:5000}).sellingPriceMinor,200)
})
test('manual, supplier-category, category, supplier and global precedence; ambiguous rules fail closed',()=>{
 const rules=[base,{...base,id:'supplier',supplier:'youngpg'},{...base,id:'category',category:'vpn'},{...base,id:'both',supplier:'youngpg',category:'vpn'}]
 for(const [remaining,id]of [[rules,'both'],[rules.slice(0,3),'category'],[rules.slice(0,2),'supplier'],[rules.slice(0,1),'global']] as const)assert.equal(resolvePricingRule([...remaining],'youngpg','vpn',null).rule?.id,id)
 assert.equal(resolvePricingRule(rules,'youngpg','vpn',123).manualPriceMinor,123);assert.equal(resolvePricingRule(rules,'youngpg','vpn',123).rule,null)
 assert.throws(()=>resolvePricingRule([base,{...base,id:'duplicate'}],'youngpg','vpn',null),/Conflicting/)
})
test('minimum profit, payment fees, FX buffer and rounding cannot silently create a loss',()=>{
 const result=calculateSellingPrice(10000,{...base,mode:'fixed',fixedMinor:100,minProfitMinor:1000,feeBps:300,feeFixedMinor:50,fxBufferBps:200,roundingMinor:100})
 assert.equal(result.sellingPriceMinor%100,0);assert(result.estimatedProfitMinor>=1000);assert.equal(result.bufferedCostMinor,10200)
 assert.throws(()=>calculateSellingPrice(100,{...base,mode:'margin',rateBps:9800,feeBps:300}),/below/)
 assert.throws(()=>calculateSellingPrice(100,{...base,enabled:false}),/disabled/)
})
test('conversion uses an explicit currency pair and timestamp; fractional native prices are exact',()=>{
 const fx={base:'USD',quote:'NGN',rate:'1600.125',observedAt:1000,maxAgeMs:1000}
 assert.equal(convertSupplierCost('0.20','USD','NGN',fx,1500),32003)
 assert.equal(convertSupplierCost('2000.01','NGN','NGN',null,1500),200001)
 assert.throws(()=>convertSupplierCost('1','EUR','NGN',fx,1500),/mismatched/)
 assert.throws(()=>convertSupplierCost('1','USD','NGN',fx,3000),/stale/)
 assert.throws(()=>convertSupplierCost('1','USD','NGN',null,1500),/Missing/)
})
