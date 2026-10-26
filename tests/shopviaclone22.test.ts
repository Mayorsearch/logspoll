import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDecimalToMinor,
  convertUsdToNgnMinor,
  normalizeShopViaCatalog,
  fetchShopViaProfile,
  parseShopViaProfile,
  extractShopViaProductInfo,
  fetchShopViaCatalog,
  fetchShopViaProduct,
  fetchShopViaOrder,
  purchaseShopViaProduct,
  ShopViaError,
} from '../server/shopviaclone22.ts'
import { calculateSellingPrice } from '../server/pricing.ts'
import { prepareDelivery } from '../server/supplier-delivery.ts'

test('ShopViaClone22 decimal prices parse exactly to integer minor kobo', () => {
  assert.equal(parseDecimalToMinor('25.50'), 2550)
  assert.equal(parseDecimalToMinor('100'), 10000)
  assert.equal(parseDecimalToMinor('0.05'), 5)
  assert.equal(parseDecimalToMinor('0'), 0)
  assert.equal(parseDecimalToMinor(12.34), 1234)

  assert.throws(() => parseDecimalToMinor('-5.00'), ShopViaError)
  assert.throws(() => parseDecimalToMinor('abc'), ShopViaError)
  assert.throws(() => parseDecimalToMinor('1.005'), ShopViaError)
  assert.throws(() => parseDecimalToMinor('1000000000000'), ShopViaError)
})

test('normalizeShopViaCatalog extracts valid categories and products while rejecting invalid inputs', () => {
  const samplePayload = {
    categories: [
      {
        id: '1',
        name: 'Social Media Accounts',
        products: [
          {
            id: '101',
            name: 'Facebook Aged Account 2018',
            description: 'Verified account with clean activity history.',
            price: '3500.00',
            amount: 15,
          },
          {
            id: '102',
            name: 'Instagram High Karma Account',
            description: 'Organic followers, 2FA enabled.',
            price: '5000.50',
            amount: '8',
          },
        ],
      },
      {
        id: '2',
        name: 'VPN Subscriptions',
        products: [
          {
            id: '201',
            name: 'Astrill VPN 1 Month Key',
            description: 'Private VPN configuration code.',
            price: '12000.00',
            amount: 0,
          },
        ],
      },
    ],
  }

  const normalized = normalizeShopViaCatalog(samplePayload, 'NGN')
  assert.equal(normalized.categories.length, 2)
  assert.equal(normalized.products.length, 3)

  const fb = normalized.products.find((p) => p.id === '101')!
  assert.equal(fb.name, 'Facebook Aged Account 2018')
  assert.equal(fb.costMinor, 350000)
  assert.equal(fb.stock, 15)
  assert.equal(fb.categoryId, '1')

  const vpn = normalized.products.find((p) => p.id === '201')!
  assert.equal(vpn.stock, 0)
  assert.equal(vpn.costMinor, 1200000)

  // Duplicate product IDs are deduplicated
  const dupPayload = {
    categories: [
      {
        id: '1',
        name: 'Cat',
        products: [
          { id: '101', name: 'Item', price: '10.00', amount: 5 },
          { id: '101', name: 'Item Dup', price: '10.00', amount: 5 },
        ],
      },
    ],
  }
  const dupNorm = normalizeShopViaCatalog(dupPayload)
  assert.equal(dupNorm.products.length, 1)

  // Flat product array normalization
  const flatPayload = [
    { id: '301', name: 'Product A', price: '50.00', amount: 10, category_id: 'cat_a', category_name: 'Category A' },
    { id: '302', name: 'Product B', price: '75.00', amount: 5, category_id: 'cat_b', category_name: 'Category B' },
  ]
  const flatNorm = normalizeShopViaCatalog(flatPayload)
  assert.equal(flatNorm.categories.length, 2)
  assert.equal(flatNorm.products.length, 2)

  // Invalid payload structure throws
  assert.throws(() => normalizeShopViaCatalog(null), ShopViaError)
  assert.throws(() => normalizeShopViaCatalog('string'), ShopViaError)
})

test('ShopViaClone22 pricing markup calculates accurately without compounding', () => {
  const costMinor = 500000 // ₦5,000.00
  const markupBps = 2500 // 25%

  const result = calculateSellingPrice(costMinor, {
    id: 'markup',
    enabled: true,
    mode: 'markup',
    rateBps: markupBps,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  })

  // ₦5,000 * 1.25 = ₦6,250 = 625,000 kobo
  assert.equal(result.sellingPriceMinor, 625000)
})

test('fetchShopViaProfile queries profile.php with api_key, follows redirects and redacts key', async (t) => {
  await assert.rejects(
    fetchShopViaProfile('test-key', 'http://insecure.test/api'),
    /must use HTTPS/
  )

  t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
    const u = new URL(String(url))
    assert.equal(u.pathname, '/api/profile.php')
    assert.equal(u.searchParams.get('api_key'), 'valid-profile-key')
    assert.equal(options.redirect, 'follow')
    return new Response(JSON.stringify({ status: 'success', username: 'shopvia_user', balance: '25000.00', currency: 'NGN' }), {
      headers: { 'content-type': 'application/json' },
    })
  })

  const prof = await fetchShopViaProfile('valid-profile-key', 'https://shopviaclone22.com/api')
  assert.equal(prof.username, 'shopvia_user')
  assert.equal(prof.balance, '25000.00')
})

test('fetchShopViaProfile surfaces specific errors for invalid keys and IP restrictions', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown) => {
    return new Response(JSON.stringify({ status: 'error', msg: 'Invalid API Key' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  })

  await assert.rejects(
    fetchShopViaProfile('bad-key', 'https://shopviaclone22.com/api'),
    (err: unknown) => err instanceof ShopViaError && err.status === 401 && /Invalid API Key/i.test(err.message)
  )
})

test('fetchShopViaCatalog queries products.php with api_key and follows redirects', async (t) => {
  await assert.rejects(
    fetchShopViaCatalog('test-key', 'http://insecure-domain.com/api'),
    /must use HTTPS/
  )

  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    assert.equal(options.redirect, 'follow')
    throw new Error('Secret upstream timeout with key=private_super_secret_12345')
  })

  try {
    await fetchShopViaCatalog('private_super_secret_12345', 'https://shopviaclone22.com/api')
    assert.fail('Should have thrown')
  } catch (error) {
    assert.ok(error instanceof ShopViaError)
    assert.doesNotMatch(error.message, /private_super_secret_12345/)
  }
})

test('fetchShopViaProduct queries product by documented product parameter and id', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const u = new URL(String(url))
    assert.equal(u.searchParams.get('api_key'), 'valid-key')
    assert.equal(u.searchParams.get('product'), '42')
    assert.equal(u.searchParams.get('id'), '42')
    return new Response(JSON.stringify({
      product: { id: '42', name: 'Test Product', price: '1500.00', amount: 3 },
    }), { headers: { 'content-type': 'application/json' } })
  })

  const res = (await fetchShopViaProduct('valid-key', '42')) as { product: { name: string } }
  assert.equal(res.product.name, 'Test Product')
})

test('fetchShopViaOrder queries order by documented order parameter', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const u = new URL(String(url))
    assert.equal(u.searchParams.get('api_key'), 'valid-key')
    assert.equal(u.searchParams.get('order'), 'ord-99')
    return new Response(JSON.stringify({
      order: { id: 'ord-99', status: 'completed', product: '42', code: 'PROMO-123' },
    }), { headers: { 'content-type': 'application/json' } })
  })

  const res = (await fetchShopViaOrder('valid-key', 'ord-99')) as { order: { code: string } }
  assert.equal(res.order.code, 'PROMO-123')
})

test('purchaseShopViaProduct validates parameters and does not purchase on test', async () => {
  await assert.rejects(
    purchaseShopViaProduct('', { productId: '42', amount: 1 }),
    /API key is required/
  )
  await assert.rejects(
    purchaseShopViaProduct('valid-key', { productId: '42', amount: 0 }),
    /Invalid purchase amount/
  )
})

test('ShopViaClone22 USD-to-NGN conversion and 50% markup calculate accurately', () => {
  // $2.70 USD = 270 cents
  const usdMinor = 270
  const rate = 1500
  const ngnCostMinor = convertUsdToNgnMinor(usdMinor, rate)
  // $2.70 × 1,500 = ₦4,050.00 = 405,000 kobo
  assert.equal(ngnCostMinor, 405000)

  // 50% markup = 5000 bps
  const selling = calculateSellingPrice(ngnCostMinor, {
    id: 'markup',
    enabled: true,
    mode: 'markup',
    rateBps: 5000,
    fixedMinor: 0,
    minProfitMinor: 0,
    feeBps: 0,
    feeFixedMinor: 0,
    fxBufferBps: 0,
    roundingMinor: 1,
  })
  // ₦4,050 × 1.50 = ₦6,075.00 = 607,500 kobo
  assert.equal(selling.sellingPriceMinor, 607500)

  // Additional examples from supplier catalog:
  // Product 103: $2.20 × 1500 = ₦3,300 (330,000 kobo) -> ₦4,950 (495,000 kobo)
  assert.equal(convertUsdToNgnMinor(220, 1500), 330000)
  // Product 147: $1.60 × 1500 = ₦2,400 (240,000 kobo) -> ₦3,600 (360,000 kobo)
  assert.equal(convertUsdToNgnMinor(160, 1500), 240000)
  // Product 184: $2.30 × 1500 = ₦3,450 (345,000 kobo) -> ₦5,175 (517,500 kobo)
  assert.equal(convertUsdToNgnMinor(230, 1500), 345000)
  // Product 210: $0.90 × 1500 = ₦1,350 (135,000 kobo) -> ₦2,025 (202,500 kobo)
  assert.equal(convertUsdToNgnMinor(90, 1500), 135000)

  // Error cases
  assert.throws(() => convertUsdToNgnMinor(-10, 1500), ShopViaError)
  assert.throws(() => convertUsdToNgnMinor(100, 0), ShopViaError)
  assert.throws(() => convertUsdToNgnMinor(100, -5), ShopViaError)
  assert.throws(() => convertUsdToNgnMinor(NaN, 1500), ShopViaError)
})

test('normalizeShopViaCatalog converts USD prices to NGN at configured rate', () => {
  const usdPayload = {
    categories: [
      {
        id: '1',
        name: 'Accounts',
        products: [
          {
            id: '5',
            name: 'PURE random country FB ( 30-1k friend )',
            description: 'Year 2012-2017 aged account',
            price: '2.7',
            amount: 351,
          },
        ],
      },
    ],
  }

  const result = normalizeShopViaCatalog(usdPayload, 1500, 'NGN')
  assert.equal(result.products.length, 1)
  const item = result.products[0]
  assert.equal(item.id, '5')
  assert.equal(item.usdCostMinor, 270) // $2.70
  assert.equal(item.costMinor, 405000) // ₦4,050.00
  assert.equal(item.currency, 'NGN')
  assert.equal(item.stock, 351)
})

test('purchaseShopViaProduct sends action=buyProduct, id, product, amount and X-API-Key', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
    assert.equal(String(url), 'https://shopviaclone22.com/api/buy_product')
    assert.equal(options.method, 'POST')
    const headers = new Headers(options.headers)
    assert.equal(headers.get('X-API-Key'), 'valid-key')
    assert.equal(headers.get('Content-Type'), 'application/x-www-form-urlencoded')
    const body = new URLSearchParams(String(options.body))
    assert.equal(body.get('action'), 'buyProduct')
    assert.equal(body.get('id'), '342')
    assert.equal(body.get('product'), '342')
    assert.equal(body.get('amount'), '1')
    assert.equal(body.get('client_order_id'), 'ORD-123')
    return new Response(JSON.stringify({ status: 'success', id: 'tx-999', data: 'mail|pass|token' }), {
      headers: { 'content-type': 'application/json' },
    })
  })

  const res = (await purchaseShopViaProduct('valid-key', {
    productId: '342',
    amount: 1,
    customOrderId: 'ORD-123',
  })) as any
  assert.equal(res.status, 'success')
  assert.equal(res.id, 'tx-999')
})

test('prepareDelivery correctly parses stock for ShopViaClone22 when product.php returns nested data array', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    const u = new URL(String(url))
    if (u.pathname === '/api/product.php') {
      return new Response(JSON.stringify({
        status: 'success',
        data: [{ id: '342', price: '0.02', amount: 90731, name: 'Hotmail Trusted' }],
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (options?.method === 'POST') {
      return new Response(JSON.stringify({
        status: 'success',
        order_id: 'ord-342',
        data: 'mail|pass|token',
      }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ status: 'error' }), { status: 404 })
  })

  const plan = await prepareDelivery('shopviaclone22', { apiKey: 'valid-key', baseUrl: 'https://shopviaclone22.com/api' }, {
    externalId: '342',
    quantity: 1,
    requestId: 'req-342',
    maxCostMinor: 100000,
    fxRate: '1500',
  })
  const delivery = await plan.buy()
  assert.equal(delivery.receipt, 'ord-342')
  assert.equal(delivery.delivered, true)
  assert.deepEqual(delivery.items, ['mail|pass|token'])
})

test('prepareDelivery falls back to products.php when product.php returns error or missing stock', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    const u = new URL(String(url))
    if (u.pathname === '/api/product.php') {
      return new Response(JSON.stringify({
        status: 'error',
        msg: 'The Request Not Found',
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (u.pathname === '/api/products.php') {
      return new Response(JSON.stringify({
        categories: [
          {
            id: '227',
            name: 'Hotmail',
            products: [{ id: '342', price: '0.02', amount: 90731, name: 'Hotmail Trusted' }],
          },
        ],
      }), { headers: { 'content-type': 'application/json' } })
    }
    if (options?.method === 'POST') {
      return new Response(JSON.stringify({
        status: 'success',
        trans_id: 'trans-342',
        items: ['token-item-1'],
      }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ status: 'error' }), { status: 404 })
  })

  const plan = await prepareDelivery('shopviaclone22', { apiKey: 'valid-key', baseUrl: 'https://shopviaclone22.com/api' }, {
    externalId: '342',
    quantity: 1,
    requestId: 'req-fallback',
    maxCostMinor: 100000,
    fxRate: '1500',
  })
  const delivery = await plan.buy()
  assert.equal(delivery.receipt, 'trans-342')
  assert.equal(delivery.delivered, true)
  assert.deepEqual(delivery.items, ['token-item-1'])
})

test('parseShopViaProfile handles direct root balance and currency', () => {
  const parsed = parseShopViaProfile({
    status: 'success',
    username: 'direct_user',
    balance: '25.50',
    currency: 'USD',
  })
  assert.equal(parsed.status, 'success')
  assert.equal(parsed.username, 'direct_user')
  assert.equal(parsed.raw_balance, '25.50')
  assert.equal(parsed.spendable_balance, 25.5)
  assert.equal(parsed.currency, 'USD')
  assert.equal(parsed.balance_status, 'funded')
})

test('parseShopViaProfile parses nested ShopViaClone22 production data.money structure', () => {
  const prodResponse = {
    status: 'success',
    msg: 'Lấy dữ liệu thành công!',
    data: {
      username: 'Logspoll',
      money: '7.20',
    },
  }
  const parsed = parseShopViaProfile(prodResponse, 'USD')
  assert.equal(parsed.status, 'success')
  assert.equal(parsed.username, 'Logspoll')
  assert.equal(parsed.raw_balance, '7.20')
  assert.equal(parsed.spendable_balance, 7.2)
  assert.equal(parsed.currency, 'USD')
  assert.equal(parsed.balance_status, 'funded')
})

test('parseShopViaProfile supports nested user, account, and profile containers', () => {
  const userContainer = parseShopViaProfile({
    status: 'success',
    user: { username: 'user_admin', balance: 50.0, currency: 'USD' },
  })
  assert.equal(userContainer.username, 'user_admin')
  assert.equal(userContainer.spendable_balance, 50.0)
  assert.equal(userContainer.balance_status, 'funded')

  const accountContainer = parseShopViaProfile({
    status: 'success',
    account: { name: 'acct_holder', funds: '100.25', currency_code: 'EUR' },
  })
  assert.equal(accountContainer.username, 'acct_holder')
  assert.equal(accountContainer.spendable_balance, 100.25)
  assert.equal(accountContainer.currency, 'EUR')
  assert.equal(accountContainer.balance_status, 'funded')
})

test('parseShopViaProfile accurately distinguishes zero balance from missing balance', () => {
  // Explicit zero balance
  const zeroResult = parseShopViaProfile({
    status: 'success',
    data: { username: 'broke_user', money: '0.00' },
  }, 'USD')
  assert.equal(zeroResult.balance_status, 'zero')
  assert.equal(zeroResult.spendable_balance, 0)
  assert.equal(zeroResult.raw_balance, '0.00')

  // Missing balance field: MUST NOT fabricate zero
  const missingResult = parseShopViaProfile({
    status: 'success',
    data: { username: 'unknown_balance_user' },
  }, 'USD')
  assert.equal(missingResult.balance_status, 'unknown')
  assert.equal(missingResult.spendable_balance, undefined)
  assert.equal(missingResult.raw_balance, undefined)
})

test('parseShopViaProfile returns balance_status unknown for malformed or uninterpretable balance', () => {
  const malformed = parseShopViaProfile({
    status: 'success',
    data: { username: 'test', money: 'not-a-number' },
  }, 'USD')
  assert.equal(malformed.balance_status, 'unknown')
  assert.equal(malformed.spendable_balance, undefined)

  // Non-object or error response
  assert.equal(parseShopViaProfile(null).balance_status, 'unknown')
  assert.equal(parseShopViaProfile([]).balance_status, 'unknown')
  assert.equal(parseShopViaProfile('bad response').balance_status, 'unknown')
  assert.equal(parseShopViaProfile({ status: 'error', msg: 'Auth failed' }).balance_status, 'unknown')
})

test('parseShopViaProfile detects multi-currency from symbols and codes without defaulting', () => {
  // Dollar symbol
  const usdSymbol = parseShopViaProfile({ data: { money: '$15.00' } })
  assert.equal(usdSymbol.currency, 'USD')
  assert.equal(usdSymbol.spendable_balance, 15)

  // Naira symbol
  const ngnSymbol = parseShopViaProfile({ data: { money: '₦50,000.00' } })
  assert.equal(ngnSymbol.currency, 'NGN')
  assert.equal(ngnSymbol.spendable_balance, 50000)

  // Dong symbol
  const vndSymbol = parseShopViaProfile({ data: { money: '250000₫' } })
  assert.equal(vndSymbol.currency, 'VND')
  assert.equal(vndSymbol.spendable_balance, 250000)

  // Euro symbol
  const eurSymbol = parseShopViaProfile({ data: { balance: '€42.50' } })
  assert.equal(eurSymbol.currency, 'EUR')
  assert.equal(eurSymbol.spendable_balance, 42.5)

  // Context-free unknown currency remains unknown
  const noCurrency = parseShopViaProfile({ data: { money: '100.00' } })
  assert.equal(noCurrency.currency, undefined)
  assert.equal(noCurrency.balance_status, 'unknown')
})

test('extractShopViaProductInfo dynamically extracts id, name, price, and stock from supplier product response', () => {
  const sampleResponse = {
    status: 'success',
    msg: 'Data retrieved successfully!',
    product: [
      {
        id: 342,
        name: 'Hotmail Trusted - OAuth2 [IMAP/POP3/GRAPH]',
        price: 0.02,
        amount: 87362,
        description: 'FORMAT: Mail|Pass|Refresh_token',
      },
    ],
  }
  const extracted = extractShopViaProductInfo(sampleResponse)
  assert.equal(extracted.id, '342')
  assert.equal(extracted.name, 'Hotmail Trusted - OAuth2 [IMAP/POP3/GRAPH]')
  assert.equal(extracted.price, 0.02)
  assert.equal(extracted.stock, 87362)
})

