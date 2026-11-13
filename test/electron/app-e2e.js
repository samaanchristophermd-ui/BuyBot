'use strict'

// Run with: npm run test:app   (Linux CI: prefix with xvfb-run -a)
// Launches the real app with a throwaway profile, adds products through the
// UI and checks the whole path against a local fake shop.

const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { _electron } = require('playwright-core')
const { createShop } = require('../fixtures/shop')

const root = path.join(__dirname, '..', '..')

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'buybot-e2e-'))
  const inStock = await createShop('redesign')
  const soldOut = await createShop('redesign', { inStockAfter: 1e9 })
  const args = [root]
  if (process.platform === 'linux') args.unshift('--no-sandbox')
  const launch = () => _electron.launch({ args, env: { ...process.env, BUYBOT_USER_DATA: profile } })

  let app = await launch()
  let ui = await app.firstWindow()
  await ui.waitForSelector('#accounts button')
  assert.equal(await ui.locator('#accounts button').count(), 5)

  // rejects junk
  await ui.fill('#url', 'https://')
  await ui.evaluate(() => document.getElementById('add-form').noValidate = true)
  await ui.fill('#url', 'not a link')
  await ui.click('button[type=submit]')
  await ui.waitForSelector('#add-error:not([hidden])')

  // a sold-out product keeps being watched
  await ui.fill('#url', `${soldOut.origin}/product`)
  await ui.fill('#name', 'Sold-out thing')
  await ui.fill('#maxPrice', '550')
  await ui.click('button[type=submit]')
  await ui.waitForSelector('.task:has-text("Sold-out thing") >> text=Out of stock')

  // an in-stock product goes all the way to the hand-over
  await ui.fill('#url', `${inStock.origin}/product`)
  await ui.fill('#name', 'In-stock thing')
  await ui.click('button[type=submit]')
  await ui.waitForSelector('.task.ready:has-text("In-stock thing")', { timeout: 20000 })
  assert.equal(inStock.state.cart, 1)
  assert.equal(inStock.state.ordersPlaced, 0)
  assert.equal(soldOut.state.addRequests, 0)
  assert.equal(await ui.locator('#summary').textContent(), '1 watching · 1 ready for checkout')
  assert.ok(app.windows().length >= 3, 'store windows exist')

  if (process.env.SCREENSHOT) await ui.screenshot({ path: process.env.SCREENSHOT, fullPage: true })

  // stop + persistence across restarts
  await ui.click('.task:has-text("Sold-out thing") >> text=Stop')
  await ui.waitForSelector('.task:has-text("Sold-out thing") >> text=Stopped')
  await ui.click('.task:has-text("In-stock thing") >> text=Remove')
  await app.close()

  app = await launch()
  ui = await app.firstWindow()
  await ui.waitForSelector('.task')
  assert.equal(await ui.locator('.task').count(), 1)
  assert.match(await ui.locator('.task').textContent(), /Sold-out thing.*max \$550\.00.*Not running/s)
  const saved = fs.readFileSync(path.join(profile, 'buybot.json'), 'utf8')
  assert.doesNotMatch(saved, /card|cvv|password/i)
  await app.close()

  await inStock.close()
  await soldOut.close()
  console.log('ok - app end-to-end')
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
