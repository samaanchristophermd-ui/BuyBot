'use strict'

const http = require('http')

/**
 * A tiny fake shop. Each "skin" reproduces the buttons a retailer is expected
 * to render, so the real retailer definitions can be exercised end to end.
 * These pages are approximations: they prove the engine and the selector
 * syntax work, not that the live sites still look like this.
 */
const SKINS = {
  amazon: {
    buy: '<input id="add-to-cart-button" type="submit" value="Add to Cart">',
    oos: '<div id="outOfStock">Currently unavailable.</div>',
    price: (p) => `<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$${p}</span></span></div>`,
    checkout: '<input name="proceedToRetailCheckout" type="submit" value="Proceed to checkout">',
    place: '<input name="placeYourOrder1" type="submit" value="Place your order">',
    total: (t) => `<table><tr><td>Order total:</td><td class="grand-total-price">$${t}</td></tr></table>`,
    empty: 'Your Amazon Cart is empty'
  },
  bestbuy: {
    buy: '<button class="add-to-cart-button" data-button-state="ADD_TO_CART">Add to Cart</button>',
    oos: '<button class="add-to-cart-button" data-button-state="SOLD_OUT" disabled>Sold Out</button>',
    price: (p) => `<div data-testid="customer-price"><span>$${p}</span></div>`,
    checkout: '<button data-track="Checkout - Top">Checkout</button>',
    place: '<button class="button__fast-track">Place Your Order</button>',
    total: (t) => `<div class="order-summary__total"><span>Total</span><span class="order-summary__price">$${t}</span></div>`,
    empty: 'Your cart is empty'
  },
  target: {
    buy: '<button data-test="shippingButton">Add to cart</button>',
    oos: '<div data-test="soldOutBlock">Out of stock</div>',
    price: (p) => `<span data-test="product-price">$${p}</span>`,
    checkout: '<button data-test="checkout-button">Check out</button>',
    place: '<button data-test="placeOrderButton">Place your order</button>',
    total: (t) => `<div><span>Total</span> <span>$${t}</span></div>`,
    empty: 'Your cart is empty'
  },
  walmart: {
    buy: '<button data-automation-id="atc">Add to cart</button>',
    oos: '<div>Out of stock</div>',
    price: (p) => `<span itemprop="price">Now $${p}</span>`,
    checkout: '<button data-automation-id="checkout">Continue to checkout</button>',
    place: '<button>Place order for $TOTAL</button>',
    total: (t) => `<div><span>Estimated total</span><span>$${t}</span></div>`,
    empty: 'Time to start shopping!'
  },
  costco: {
    buy: '<input id="add-to-cart-btn" type="button" value="Add to Cart">',
    // Costco keeps the same id, enabled, when the item is out of stock
    oos: '<input id="add-to-cart-btn" class="out-of-stock" type="button" value="Out of Stock">',
    price: (p) => `<span automation-id="productPriceOutput">$${p}</span>`,
    checkout: '<button id="shopCartCheckoutSubmitButton">Checkout</button>',
    place: '<button>Place Order</button>',
    total: (t) => `<div id="order-estimated-total">$${t}</div>`,
    empty: 'Your shopping cart is empty'
  },
  // A "redesigned" site: no known selectors at all, only button labels.
  redesign: {
    buy: '<button class="x9f2">Add to Cart</button>',
    oos: '<p>Sold Out</p>',
    price: (p) => `<script type="application/ld+json">{"@type":"Product","offers":{"price":"${p}"}}</script>`,
    checkout: '<a href="#" class="q1">Checkout</a>',
    place: '<button class="zz">Place Order</button>',
    total: (t) => `<p><b>Order Total</b> $${t}</p>`,
    empty: 'Your cart is empty'
  }
}

// Every product page carries a sponsored carousel with its own Add to Cart
// button, placed before the real one. It must never be clicked.
const DECOY = '<div class="sponsored-carousel"><button id="decoy" onclick="fetch(\'/decoy\')">Add to Cart</button></div>'

function createShop(skinName, opts = {}) {
  const skin = SKINS[skinName]
  const state = {
    loads: 0,
    cart: 0,
    addRequests: 0,
    ordersPlaced: 0,
    decoyClicks: 0,
    inStockAfter: 0, // product loads before the item is in stock
    price: '499.99',
    total: '531.24',
    captcha: false,
    signInAtCheckout: false,
    silentOrder: false, // order click gives no confirmation page
    dropAdds: 0, // silently ignore this many add-to-cart requests
    productId: 'SKU12345',
    ...opts
  }
  const page = (title, body) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`

  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0]
    const html = (title, body) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(page(title, body))
    }
    if (path === '/product') {
      if (state.captcha) {
        return html('Robot or human?', '<div id="px-captcha" style="width:300px;height:80px" onclick="fetch(\'/solve\').then(()=>location.reload())">Press &amp; Hold</div>')
      }
      state.loads++
      const inStock = state.loads > state.inStockAfter
      return html('Test Console', `
        <header><button onclick="fetch('/decoy')">Add to Cart</button></header>
        ${DECOY}
        <main><h1>Test Console</h1>${skin.price(state.price)}
        <div id="buybox">${inStock ? skin.buy : skin.oos}</div>
        <div id="msg"></div></main>
        <script>
          var b = document.getElementById('buybox').firstElementChild
          if (${inStock}) b.addEventListener('click', function () {
            fetch('/add').then(function () { document.getElementById('msg').textContent = 'Added to cart' })
          })
          else b.addEventListener('click', function () { fetch('/decoy') })
        </script>`)
    }
    if (path === '/add') {
      state.addRequests++
      if (state.dropAdds > 0) state.dropAdds--
      else state.cart++
      return res.end('ok')
    }
    if (path === '/decoy') {
      state.decoyClicks++
      return res.end('ok')
    }
    if (path === '/solve') {
      state.captcha = false
      return res.end('ok')
    }
    if (path === '/cart') {
      if (!state.cart) return html('Cart', `<main><p>${skin.empty}</p></main>`)
      return html('Cart', `<main><a href="/product#${state.productId}">Test Console</a> x${state.cart}
        <div id="co">${skin.checkout}</div></main>
        <script>document.getElementById('co').firstElementChild.addEventListener('click', function (e) { e.preventDefault(); location.href = '/checkout' })</script>`)
    }
    if (path === '/checkout') {
      if (state.signInAtCheckout) {
        res.writeHead(302, { location: '/identity/signin' })
        return res.end()
      }
      return html('Checkout', `<main>${skin.total(state.total)}
        <div id="po">${skin.place.replace('TOTAL', state.total)}</div></main>
        <script>document.getElementById('po').firstElementChild.addEventListener('click', function () { fetch('/order').then(function () { if (!${state.silentOrder}) document.querySelector('main').innerHTML = '<h1>Thank you for your order</h1>' }) })</script>`)
    }
    if (path === '/order') {
      state.ordersPlaced++
      return res.end('ok')
    }
    if (path === '/identity/signin') return html('Sign in', '<form><input id="username"><input type="password"></form>')
    res.writeHead(404)
    res.end()
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`
      resolve({ origin, state, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

module.exports = { createShop, SKINS }
