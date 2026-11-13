'use strict'

// Run with: npm run test:electron
// Drives the real Electron driver (hidden window, DevTools-protocol clicks)
// through a full fake-shop flow, and exits non-zero on failure.

const { app, BrowserWindow } = require('electron')
const assert = require('node:assert')
const { ElectronDriver } = require('../../app/electron-driver')
const { TaskRunner } = require('../../app/engine/runner')
const { getRetailer } = require('../../app/retailers')
const { createShop } = require('../fixtures/shop')

const FAST = { settleMs: 3000, pollMs: 100, addedWaitMs: 2000, checkoutWaitMs: 6000, humanPollMs: 100, retryAddMs: 50, minIntervalMs: 100, jitter: 0 }

async function run(skin, show) {
  const shop = await createShop(skin, { inStockAfter: 1 })
  const win = new BrowserWindow({ show, width: 1100, height: 800, webPreferences: { sandbox: true, backgroundThrottling: false } })
  const base = getRetailer(skin)
  const runner = new TaskRunner({
    task: { url: `${shop.origin}/product`, intervalSec: 0.1, productId: 'SKU12345' },
    retailer: { ...base, cartUrl: `${shop.origin}/cart` },
    driver: new ElectronDriver(win.webContents),
    timing: FAST
  })
  let last
  runner.on('status', (s) => (last = s))
  await runner.start()
  assert.equal(last.phase, 'ready', `${skin}: ${last.message}`)
  assert.equal(shop.state.cart, 1)
  assert.equal(shop.state.addRequests, 1, 'the first (real mouse) click registered')
  assert.equal(shop.state.decoyClicks, 0)
  assert.equal(shop.state.ordersPlaced, 0)
  assert.match(win.webContents.getURL(), /\/checkout$/)
  win.destroy()
  await shop.close()
  console.log(`ok - ${skin} (${show ? 'visible' : 'hidden'} window): ${last.message}`)
}

app.on('window-all-closed', () => {}) // keep running between scenarios

app.whenReady().then(async () => {
  try {
    await run('amazon', false)
    await run('costco', false)
    await run('target', true)
    app.exit(0)
  } catch (err) {
    console.error('FAILED:', err)
    app.exit(1)
  }
})
