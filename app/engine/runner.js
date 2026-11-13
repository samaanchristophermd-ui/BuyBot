'use strict'

const { EventEmitter } = require('events')
const { pageProbe, clickTagged } = require('./page-probe')

const PROBE_SRC = pageProbe.toString()
const CLICK_SRC = clickTagged.toString()

const DEFAULT_TIMING = {
  settleMs: 8000, // how long to wait for a freshly loaded page to render its buttons
  pollMs: 500,
  addedWaitMs: 6000, // wait for an "added to cart" confirmation after clicking
  checkoutWaitMs: 45000, // wait for the order review page after clicking checkout
  humanPollMs: 2000, // how often to re-check while waiting for the user
  blockedReloadMs: 120000, // reload a challenge page nobody has solved after this long
  retryAddMs: 1500,
  orderWaitMs: 30000, // wait for a confirmation page after clicking Place Order
  minIntervalMs: 10000, // never hammer a retailer faster than this
  jitter: 0.2
}

/**
 * Drives one product from "watching" to "sitting at checkout".
 *
 * The driver is anything with:
 *   goto(url) -> Promise, evaluate(fnSource, arg) -> Promise<json>,
 *   click(x, y) -> Promise
 * (Electron in the app, Playwright in the tests.)
 *
 * By default it stops before the final "Place order" click so the user can
 * review the total. With task.autoBuy it clicks it, once, if the order total
 * is at or under task.maxPrice (see placeOrder).
 *
 * Events: 'status' {phase, message, ...}, 'log' string,
 *         'attention' {kind: 'captcha'|'signin'|'ready', message}
 */
class TaskRunner extends EventEmitter {
  constructor({ task, retailer, driver, timing }) {
    super()
    this.task = task
    this.retailer = retailer
    this.driver = driver
    this.t = { ...DEFAULT_TIMING, ...timing }
    this.stopped = false
    this.checks = 0
    this.addAttempts = 0
    this._wake = null
  }

  stop() {
    this.stopped = true
    if (this._wake) this._wake()
  }

  async start() {
    try {
      await this.loop()
    } catch (err) {
      if (!this.stopped) this.status('error', `Stopped by an error: ${err.message}`)
    }
    if (this.stopped && this.phase !== 'ready') this.status('stopped', 'Stopped')
  }

  // helpers ----------------------------------------------------------------

  status(phase, message, extra = {}) {
    this.phase = phase
    this.emit('status', { phase, message, checks: this.checks, ...extra })
  }

  log(message) {
    this.emit('log', message)
  }

  sleep(ms) {
    if (this.stopped) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      const self = this
      function done() {
        clearTimeout(timer)
        self._wake = null
        resolve()
      }
      this._wake = done
    })
  }

  interval() {
    const base = Math.max(this.t.minIntervalMs, (Number(this.task.intervalSec) || 30) * 1000)
    const j = this.t.jitter
    return Math.round(base * (1 - j + Math.random() * 2 * j))
  }

  /** Probe the current page; null means "page not ready / navigating". */
  async probe(keys) {
    const spec = {}
    for (const k of keys) if (this.retailer.spec[k]) spec[k] = this.retailer.spec[k]
    if (keys.includes('productId') && this.task.productId) spec.productId = this.task.productId
    try {
      return await this.driver.evaluate(PROBE_SRC, spec)
    } catch (e) {
      return null
    }
  }

  /** Re-probe until `done(result)` is truthy or `ms` elapses; returns the last probe. */
  async settle(keys, done, ms) {
    const deadline = Date.now() + ms
    let last = null
    while (!this.stopped) {
      const p = await this.probe(keys)
      if (p) {
        last = p
        if (done(p)) break
      }
      if (Date.now() >= deadline) break
      await this.sleep(this.t.pollMs)
    }
    return last
  }

  async goto(url) {
    try {
      await this.driver.goto(url)
      return true
    } catch (e) {
      this.log(`Could not load ${url}: ${e.message}`)
      return false
    }
  }

  /** Real mouse click first; `dom` forces an in-page click (used as a fallback). */
  async click(key, target, dom) {
    try {
      if (dom) await this.driver.evaluate(CLICK_SRC, key)
      else await this.driver.click(target.x, target.y)
    } catch (e) {
      this.log(`Click on "${target.text}" failed: ${e.message}`)
    }
  }

  /**
   * Hand the window to the user (captcha / sign-in) and wait until the page
   * no longer shows it. Returns false if the task was stopped meanwhile.
   */
  async waitForHuman(kind, message, keys) {
    this.status('needs_attention', message)
    this.emit('attention', { kind, message })
    const field = kind === 'captcha' ? 'blocked' : 'signIn'
    let since = Date.now()
    while (!this.stopped) {
      await this.sleep(this.t.humanPollMs)
      const p = await this.probe(keys)
      if (p && !p.blocked && !p[field]) {
        this.log(kind === 'captcha' ? 'Challenge cleared, continuing.' : 'Signed in, continuing.')
        return true
      }
      // A hard block ("Access Denied") can't be solved by hand; retry slowly.
      if (kind === 'captcha' && Date.now() - since > this.t.blockedReloadMs) {
        since = Date.now()
        await this.goto(this.task.url)
      }
    }
    return false
  }

  // main flow --------------------------------------------------------------

  async loop() {
    const { task, retailer } = this
    const keys = ['blocked', 'signIn', 'buy', 'outOfStock', 'price']
    let unknownStreak = 0
    this.status('starting', 'Opening product page…')
    let loaded = await this.goto(task.url)

    while (!this.stopped) {
      if (!loaded) {
        this.status('monitoring', 'Page failed to load, will retry')
        await this.sleep(this.interval())
        loaded = await this.goto(task.url)
        continue
      }

      const p = await this.settle(keys, (r) => r.blocked || r.signIn || r.buy || r.outOfStock, this.t.settleMs)
      if (this.stopped) break
      this.checks++
      const seen = { price: p && p.price, title: p && p.title, lastChecked: Date.now() }

      if (p && p.blocked) {
        await this.waitForHuman('captcha', `${retailer.name} is showing a verification page. Solve it in the browser window.`, keys)
        continue
      }
      if (p && p.signIn && !p.buy) {
        await this.waitForHuman('signin', `Sign in to ${retailer.name} in the browser window to continue.`, keys)
        loaded = await this.goto(task.url)
        continue
      }

      const max = Number(task.maxPrice) || 0
      if (p && p.buy) {
        unknownStreak = 0
        if (max && p.price != null && p.price > max) {
          this.status('monitoring', `In stock at $${p.price.toFixed(2)}, above your $${max.toFixed(2)} limit`, seen)
        } else {
          if (max && p.price == null) this.log('In stock, but the price could not be read. Check it at checkout.')
          this.status('in_stock', `In stock${p.price != null ? ` at $${p.price.toFixed(2)}` : ''}. Adding to cart…`, seen)
          if (await this.purchase(p)) return
          if (this.stopped) break
          await this.sleep(this.t.retryAddMs)
          loaded = await this.goto(task.url)
          continue
        }
      } else if (p && p.outOfStock) {
        unknownStreak = 0
        this.status('monitoring', 'Out of stock', seen)
      } else {
        unknownStreak++
        this.status('monitoring', 'No buy button found', seen)
        if (unknownStreak === 5) {
          this.log(`No buy button or out-of-stock notice found on 5 checks in a row. ${retailer.name} may have changed its page, or the link is not a product page.`)
        }
      }

      await this.sleep(this.interval())
      if (this.stopped) break
      loaded = await this.goto(task.url)
    }
  }

  /** Add to cart, open the cart, start checkout. Returns true once handed to the user. */
  async purchase(product) {
    const { retailer, task } = this
    const useDomClick = this.addAttempts++ % 2 === 1 // alternate click method on retries
    await this.click('buy', product.buy, useDomClick)
    this.status('adding', 'Clicked Add to Cart…')

    // Wait for a confirmation, declining any protection-plan upsell on the way.
    const deadline = Date.now() + this.t.addedWaitMs
    let declined = false
    while (!this.stopped && Date.now() < deadline) {
      await this.sleep(this.t.pollMs)
      const p = await this.probe(['blocked', 'added', 'decline'])
      if (!p) continue
      if (p.blocked) {
        if (!(await this.waitForHuman('captcha', `${retailer.name} wants a verification. Solve it in the browser window.`, ['blocked']))) return false
        continue
      }
      if (p.decline && !declined) {
        declined = true
        await this.click('decline', p.decline)
        continue
      }
      if (p.added || p.url !== product.url) break
    }
    if (this.stopped) return false

    if (!retailer.cartUrl) {
      return this.ready('Clicked Add to Cart. Finish checkout in the browser window.')
    }

    // Verify by looking at the real cart rather than trusting a pop-up.
    this.status('cart', 'Opening cart…')
    if (!(await this.goto(retailer.cartUrl))) return false
    const cartKeys = ['blocked', 'signIn', 'checkout', 'cartEmpty', 'productId']
    let cart = await this.settle(cartKeys, (r) => r.blocked || r.checkout || r.cartEmpty, this.t.settleMs)
    if (cart && cart.blocked) {
      if (!(await this.waitForHuman('captcha', `${retailer.name} wants a verification. Solve it in the browser window.`, cartKeys))) return false
      cart = await this.settle(cartKeys, (r) => r.checkout || r.cartEmpty, this.t.settleMs)
    }
    if (!cart || !cart.checkout) {
      this.log(cart && cart.cartEmpty ? 'Cart is empty: the item did not get added. Trying again.' : 'Could not find the checkout button in the cart. Trying again.')
      return false
    }
    if (task.productId && cart.hasProduct === false) {
      this.log('Could not confirm this exact item is in the cart. Review the cart before paying.')
    }

    this.status('checkout', 'Item in cart. Starting checkout…')
    const cartUrl = cart.url
    await this.click('checkout', cart.checkout)

    const checkoutKeys = ['blocked', 'signIn', 'placeOrder', 'total', 'checkout']
    const end = Date.now() + this.t.checkoutWaitMs
    let retried = false
    const started = Date.now()
    while (!this.stopped && Date.now() < end) {
      await this.sleep(this.t.pollMs * 2)
      const p = await this.probe(checkoutKeys)
      if (!p) continue
      if (p.blocked) {
        if (!(await this.waitForHuman('captcha', `${retailer.name} wants a verification. Solve it in the browser window.`, checkoutKeys))) return false
        continue
      }
      if (p.signIn) {
        // The user is now needed anyway, and the item is safely in the cart.
        return this.ready(`In your cart. Sign in to ${retailer.name} in the browser window to finish checkout.`)
      }
      if (p.placeOrder) {
        const max = Number(task.maxPrice) || 0
        if (task.autoBuy) return this.placeOrder(p, cart, checkoutKeys)
        let message = 'Ready: review the order and click Place Order.'
        if (p.total != null) {
          message = `Ready: order total $${p.total.toFixed(2)}. Review it and click Place Order.`
          if (max && p.total > max) message = `Order total $${p.total.toFixed(2)} is above your $${max.toFixed(2)} limit. Review carefully before placing the order.`
        }
        return this.ready(message)
      }
      // Still on the cart with the button showing: the click did not register.
      if (!retried && p.url === cartUrl && p.checkout && Date.now() - started > 5000) {
        retried = true
        await this.click('checkout', p.checkout, true)
      }
    }
    if (this.stopped) return false
    return this.ready('In your cart. Finish checkout in the browser window.')
  }

  /**
   * Opt-in: click Place Order. Only when every safety check passes, and only
   * ever once per task, so a slow page can never produce a second order.
   */
  async placeOrder(first, cart, keys) {
    const { task } = this
    const max = Number(task.maxPrice) || 0
    // Totals often render a moment after the button; give them a chance.
    let p = first
    for (let i = 0; i < 6 && !this.stopped && p.total == null; i++) {
      await this.sleep(this.t.pollMs)
      p = (await this.probe(keys)) || p
    }
    if (this.stopped) return false
    const refuse = (why) => this.ready(`Not placed automatically: ${why} Review the order and click Place Order yourself.`)
    if (!max) return refuse('no max price is set.')
    if (!task.productId || cart.hasProduct !== true) return refuse('could not confirm the cart holds this exact item.')
    if (p.total == null) return refuse('the order total could not be read.')
    if (p.total > max) return refuse(`the order total $${p.total.toFixed(2)} (with tax and shipping) is above your $${max.toFixed(2)} limit.`)
    if (!p.placeOrder) return refuse('the Place Order button went away.')

    const amount = `$${p.total.toFixed(2)}`
    this.status('ordering', `Placing order for ${amount}…`)
    this.log(`Clicking "${p.placeOrder.text}" (total ${amount}).`)
    const before = p.url
    await this.click('placeOrder', p.placeOrder)

    const end = Date.now() + this.t.orderWaitMs
    let confirmed = false
    let moved = false
    while (!this.stopped && Date.now() < end) {
      await this.sleep(this.t.pollMs * 2)
      const q = await this.probe(['blocked', 'ordered', 'placeOrder'])
      if (!q) continue
      if (q.blocked) break
      if (q.ordered) {
        confirmed = true
        break
      }
      moved = q.url !== before || !q.placeOrder
    }
    let message
    if (confirmed) message = `Order placed for ${amount}. Check your email for the store's confirmation.`
    else if (moved) message = `Clicked Place Order (${amount}), but no confirmation page was recognised. Check the browser window and your email.`
    else message = `Clicked Place Order (${amount}), but the page did not change. The store may need something more from you: check the browser window. It was not clicked again.`
    this.status('ready', message, { ordered: confirmed })
    this.emit('attention', { kind: confirmed ? 'ordered' : 'ready', message })
    return true
  }

  ready(message) {
    this.status('ready', message)
    this.emit('attention', { kind: 'ready', message })
    return true
  }
}

module.exports = { TaskRunner, DEFAULT_TIMING }
