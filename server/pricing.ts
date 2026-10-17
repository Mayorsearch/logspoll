/** Money is integer minor units; percentages are basis points. All division rounds up. */
export type PricingRule={id:string;enabled:boolean;supplier?:string|null;category?:string|null;mode:'markup'|'fixed'|'margin';rateBps:number;fixedMinor:number;minProfitMinor:number;feeBps:number;feeFixedMinor:number;fxBufferBps:number;roundingMinor:number}
export type FxQuote={base:string;quote:string;rate:string;observedAt:number;maxAgeMs:number}
const max=99999999900n
const integer=(value:number,min=0,maxValue=99999999900)=>{if(!Number.isSafeInteger(value)||value<min||value>maxValue)throw Error('Invalid pricing setting.');return BigInt(value)}
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d
function decimal(value:string){if(!/^\d{1,15}(?:\.\d{1,12})?$/.test(value))throw Error('Invalid monetary decimal.');const [whole,fraction='']=value.split('.');return {n:BigInt(whole+fraction),d:10n**BigInt(fraction.length)}}
export function convertSupplierCost(amount:string,currency:string,target:string,fx:FxQuote|null,now=Date.now()){
 if(!/^[A-Z]{3}$/.test(currency)||target!=='NGN')throw Error('Invalid currency.')
 const cost=decimal(amount);let numerator=cost.n*100n,denominator=cost.d
 if(currency!==target){if(!fx||fx.base!==currency||fx.quote!==target||!Number.isSafeInteger(fx.observedAt)||!Number.isSafeInteger(fx.maxAgeMs)||fx.maxAgeMs<1||fx.observedAt>now||now-fx.observedAt>fx.maxAgeMs)throw Error('Missing, stale or mismatched exchange rate.');const rate=decimal(fx.rate);if(rate.n===0n)throw Error('Invalid exchange rate.');numerator*=rate.n;denominator*=rate.d}
 const value=ceil(numerator,denominator);if(value<1n||value>max)throw Error('Supplier cost outside supported range.');return Number(value)
}
export function resolvePricingRule(rules:PricingRule[],supplier:string,category:string,manualPriceMinor:number|null){
 if(manualPriceMinor!==null){integer(manualPriceMinor);return {manualPriceMinor,rule:null}}
 const candidates=rules.filter(r=>r.enabled&&(!r.supplier||r.supplier===supplier)&&(!r.category||r.category===category));const rank=(r:PricingRule)=>r.category?(r.supplier?4:3):r.supplier?2:1
 candidates.sort((a,b)=>rank(b)-rank(a));if(candidates[1]&&rank(candidates[0])===rank(candidates[1]))throw Error('Conflicting pricing rules.');return {manualPriceMinor:null,rule:candidates[0]??null}
}
export function calculateSellingPrice(costMinor:number,rule:PricingRule){
 if(!rule.enabled)throw Error('Pricing rule disabled.')
 const original=integer(costMinor,1),rate=integer(rule.rateBps,0,1000000),fee=integer(rule.feeBps,0,9999),buffer=integer(rule.fxBufferBps,0,1000000),fixed=integer(rule.fixedMinor),minimum=integer(rule.minProfitMinor),feeFixed=integer(rule.feeFixedMinor),step=integer(rule.roundingMinor,1)
 const cost=ceil(original*(10000n+buffer),10000n);let candidate:bigint
 // Margin targets profit / selling price after payment fees.
 if(rule.mode==='margin'){if(rate+fee>=10000n)throw Error('Profit margin plus fees must be below 100%.');candidate=ceil((cost+feeFixed)*10000n,10000n-rate-fee)}
 else if(rule.mode==='markup'||rule.mode==='fixed'){const profit=rule.mode==='markup'?ceil(cost*rate,10000n):fixed;candidate=ceil((cost+profit+feeFixed)*10000n,10000n-fee)}
 else throw Error('Unknown pricing calculation mode.')
 const floor=ceil((cost+minimum+feeFixed)*10000n,10000n-fee);const price=ceil(candidate>floor?candidate:floor,step)*step
 if(price<1n||price>max)throw Error('Selling price outside supported range.')
 const fees=ceil(price*fee,10000n)+feeFixed
 return {ruleId:rule.id,costMinor:Number(original),bufferedCostMinor:Number(cost),sellingPriceMinor:Number(price),estimatedFeesMinor:Number(fees),estimatedProfitMinor:Number(price-cost-fees)}
}
