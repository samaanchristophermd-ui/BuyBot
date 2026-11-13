'use strict'

// End-to-end tests of the engine in a real Chromium against a local fake shop.
// Needs a Chromium/Chrome binary: set CHROME_PATH, or it looks in the usual places.

const { test, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const { TaskRunner } = require('../app/engine/runner')
const { getRetailer, generic } = require('../app/retailers')
const { createShop } = require('./fixtures/shop')

const CHROME = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find((p) => p && fs.existsSync(p))

const skip = CHROME ? false : 'no Chrome/Chromium found (set CHROME_PATH)'
const FAST = { settleMs: 1500, pollMs: 50, addedWaitMs: 1500, checkoutWaitMs: 4000, humanPollMs: 100, retryAddMs: 50, minIntervalMs: 50, jitter: 0 }

let browser
before(async () => {
  if (CHROME) browser = await require('playwright-core').chromium.launch({ executablePath: CHROME })
})
after(async () => browser && browser.close())

async function scenario(skin, { shopOpts, task, retailerId, timing } = {}) {
  const shop = await createShop(skin, shopOpts)
  const page = await browser.newPage()
  const driver = {
    goto: (url) => page.goto(url, { waitUntil: 'domcontentloaded' }),
    evaluate: (src, arg) => page.evaluate(`(${src})(${JSON.stringify(arg)})`),
    click: (x, y) => page.mouse.click(x, y)
  }
  const base = retailerId === 'generic' ? generic : getRetailer(retailerId || skin)
  const retailer = { ...base, cartUrl: base.cartUrl && `${shop.origin}/cart` }
  const runner = new TaskRunner({
    task: { url: `${shop.origin}/product`, intervalSec: 0.05, productId: 'SKU12345', ...task },
    retailer,
    driver,
    timing: { ...FAST, ...timing }
  })
  const events = { statuses: [], attention: [], logs: [] }
  runner.on('status', (s) => events.statuses.push(s))
  runner.on('attention', (a) => events.attention.push(a))
  runner.on('log', (l) => events.logs.push(l))
  const done = runner.start()
  const close = async () => {
    runner.stop()
    await done
    await page.close()
    await shop.close()
  }
  return { shop, page, runner, events, done, close }
}

const until = async (cond, ms = 8000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 25))
  }
}

for (const skin of ['amazon', 'bestbuy', 'target', 'walmart', 'costco']) {
  test(`${skin}: waits for stock, adds one to cart, stops at order review`, { skip }, async () => {
    const s = await scenario(skin, { shopOpts: { inStockAfter: 2 } })
    await s.done
    const last = s.events.statuses.at(-1)
    assert.equal(last.phase, 'ready')
    assert.match(last.message, /531\.24/)
    assert.equal(s.shop.state.loads, 3, 'reloaded until in stock')
    assert.equal(s.shop.state.cart, 1, 'exactly one in cart')
    assert.equal(s.shop.state.decoyClicks, 0, 'never clicked a sponsored / sold-out button')
    assert.equal(s.shop.state.ordersPlaced, 0, 'never places the order itself')
    assert.ok(s.events.statuses.some((x) => x.message === 'Out of stock' && x.price === 499.99))
    assert.deepEqual(s.events.attention.map((a) => a.kind), ['ready'])
    assert.match(new URL(s.page.url()).pathname, /checkout/)
    await s.close()
  })
}

test('redesigned page: falls back to button labels and JSON-LD price', { skip }, async () => {
  const s = await scenario('redesign', { retailerId: 'bestbuy', shopOpts: { inStockAfter: 1 } })
  await s.done
  assert.equal(s.events.statuses.at(-1).phase, 'ready')
  assert.equal(s.shop.state.cart, 1)
  assert.equal(s.shop.state.decoyClicks, 0)
  assert.ok(s.events.statuses.some((x) => x.price === 499.99))
  await s.close()
})

test('price above the limit is never added to cart', { skip }, async () => {
  const s = await scenario('amazon', { shopOpts: { price: '899.00' }, task: { maxPrice: 550 } })
  await until(() => s.shop.state.loads >= 4)
  assert.equal(s.shop.state.addRequests, 0)
  assert.match(s.events.statuses.at(-1).message, /above your \$550\.00 limit/)
  s.shop.state.price = '499.00' // price drops back to retail
  await s.done
  assert.equal(s.events.statuses.at(-1).phase, 'ready')
  assert.equal(s.shop.state.cart, 1)
  await s.close()
})

test('captcha pauses the bot until a human clears it', { skip }, async () => {
  const s = await scenario('walmart', { shopOpts: { captcha: true } })
  await until(() => s.events.attention.length === 1)
  assert.equal(s.events.attention[0].kind, 'captcha')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(s.shop.state.loads, 0, 'does not reload or click while blocked')
  await s.page.click('#px-captcha') // the human
  await s.done
  assert.equal(s.events.statuses.at(-1).phase, 'ready')
  assert.equal(s.shop.state.cart, 1)
  await s.close()
})

test('sign-in wall at checkout hands over with the item in the cart', { skip }, async () => {
  const s = await scenario('bestbuy', { shopOpts: { signInAtCheckout: true } })
  await s.done
  const last = s.events.statuses.at(-1)
  assert.equal(last.phase, 'ready')
  assert.match(last.message, /Sign in to Best Buy/)
  assert.equal(s.shop.state.cart, 1)
  await s.close()
})

test('retries when the add-to-cart click did not take, without double-adding', { skip }, async () => {
  const s = await scenario('target', { shopOpts: { dropAdds: 1 } })
  await s.done
  assert.equal(s.events.statuses.at(-1).phase, 'ready')
  assert.equal(s.shop.state.addRequests, 2)
  assert.equal(s.shop.state.cart, 1)
  assert.ok(s.events.logs.some((l) => /Cart is empty/.test(l)))
  await s.close()
})

test('unknown shop: clicks add to cart, then hands over', { skip }, async () => {
  const s = await scenario('redesign', { retailerId: 'generic', shopOpts: { inStockAfter: 1 } })
  await s.done
  assert.equal(s.events.statuses.at(-1).phase, 'ready')
  assert.equal(s.shop.state.cart, 1)
  assert.equal(s.shop.state.decoyClicks, 0)
  await s.close()
})

test('stop() ends monitoring promptly', { skip }, async () => {
  const s = await scenario('costco', { shopOpts: { inStockAfter: 1e9 }, timing: { minIntervalMs: 60000 } })
  await until(() => s.shop.state.loads >= 1 && s.events.statuses.some((x) => x.message === 'Out of stock'))
  const t0 = Date.now()
  s.runner.stop()
  await s.done
  assert.ok(Date.now() - t0 < 1000)
  assert.equal(s.events.statuses.at(-1).phase, 'stopped')
  assert.equal(s.shop.state.decoyClicks, 0, 'did not click the Out of Stock button')
  await s.close()
})

// automatic ordering ---------------------------------------------------------

const AUTO = { autoBuy: true, maxPrice: 550 }
const ORDER_FAST = { orderWaitMs: 1500 }

test('auto-buy: places exactly one order when the total is within the limit', { skip }, async () => {
  const s = await scenario('bestbuy', { shopOpts: { inStockAfter: 1 }, task: AUTO, timing: ORDER_FAST })
  await s.done
  const last = s.events.statuses.at(-1)
  assert.equal(last.phase, 'ready')
  assert.equal(last.ordered, true)
  assert.match(last.message, /Order placed for \$531\.24/)
  assert.equal(s.shop.state.ordersPlaced, 1)
  assert.equal(s.shop.state.cart, 1)
  assert.equal(s.events.attention.at(-1).kind, 'ordered')
  await s.close()
})

test('auto-buy: tax and shipping pushing the total over the limit blocks the order', { skip }, async () => {
  const s = await scenario('amazon', { task: { autoBuy: true, maxPrice: 510 }, timing: ORDER_FAST })
  await s.done
  assert.match(s.events.statuses.at(-1).message, /Not placed automatically: the order total \$531\.24/)
  assert.equal(s.shop.state.ordersPlaced, 0)
  await s.close()
})

test('auto-buy: refuses without a max price, an unreadable total, or an unconfirmed item', { skip }, async () => {
  const cases = [
    [{ task: { autoBuy: true } }, /no max price/],
    [{ task: AUTO, shopOpts: { total: 'TBD' } }, /total could not be read/],
    [{ task: AUTO, shopOpts: { productId: 'SOMETHING-ELSE' } }, /could not confirm the cart/]
  ]
  for (const [opts, expected] of cases) {
    const s = await scenario('target', { ...opts, timing: ORDER_FAST })
    await s.done
    assert.match(s.events.statuses.at(-1).message, expected)
    assert.equal(s.shop.state.ordersPlaced, 0)
    await s.close()
  }
})

test('auto-buy: never clicks Place Order twice when no confirmation appears', { skip }, async () => {
  const s = await scenario('walmart', { task: AUTO, shopOpts: { silentOrder: true }, timing: ORDER_FAST })
  await s.done
  const last = s.events.statuses.at(-1)
  assert.match(last.message, /page did not change.*not clicked again/s)
  assert.notEqual(last.ordered, true)
  assert.equal(s.shop.state.ordersPlaced, 1)
  await s.close()
})
