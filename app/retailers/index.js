'use strict'

/**
 * Retailer definitions: plain data consumed by engine/page-probe.js.
 *
 * Every button is located by a list of known selectors first and then by its
 * visible label, so a site redesign that renames a CSS class usually still
 * works. When a retailer changes something, this is the only file to edit.
 */

// Shared pieces ------------------------------------------------------------

const BLOCKED = {
  selectors: [
    '#px-captcha',
    '[id^="px-captcha"]',
    'form[action*="validateCaptcha"]',
    'iframe[title*="challenge" i]',
    'iframe[src*="captcha-delivery"]'
  ],
  title: ['access denied', 'robot or human', 'pardon our interruption', 'just a moment', 'attention required'],
  url: ['validateCaptcha', '/blocked(\\?|$)'],
  sparseText: [
    'press (and|&) hold',
    'verify (that )?you are (a )?human',
    'enter the characters you see',
    'are you a (human|robot)',
    'access denied'
  ]
}

// Text-matched buttons are ignored inside these containers, so the bot never
// clicks "Add to cart" on a recommended / sponsored product.
const EXCLUDE = [
  'header',
  'nav',
  'footer',
  'aside',
  '[class*="carousel" i]',
  '[class*="recommend" i]',
  '[class*="sponsored" i]',
  '[class*="similar" i]',
  '[data-test*="carousel" i]',
  '[data-testid*="carousel" i]',
  '[id*="sims" i]',
  '[id*="sponsored" i]'
]

// A candidate button whose label says any of this is never a buy button,
// even if it matches a selector (Costco reuses the same id for both states).
const NOT_BUYABLE = 'out of stock|sold out|unavailable|coming soon|notify me|check stores|find a store|see all buying'

const buy = (selectors, extraText = []) => ({
  selectors,
  text: ['^add to (cart|bag)$', ...extraText],
  exclude: EXCLUDE,
  reject: NOT_BUYABLE
})

const button = (selectors, text) => ({ selectors, text, exclude: ['header', 'nav', 'footer'] })

const TOTAL_LABELS = ['^(order|estimated|grand)\\s+total', '^total(\\s|:|$)']

// Retailers ----------------------------------------------------------------

const amazon = {
  id: 'amazon',
  name: 'Amazon',
  hosts: [/(^|\.)amazon\.com$/],
  homeUrl: 'https://www.amazon.com/',
  signInUrl: 'https://www.amazon.com/gp/css/homepage.html',
  cartUrl: 'https://www.amazon.com/gp/cart/view.html',
  productId: (url) => (/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i.exec(url.pathname) || [])[1] || null,
  spec: {
    signIn: { url: ['/ap/signin', '/ap/mfa', '/ap/cvf'] },
    buy: buy(['#add-to-cart-button', 'input[name="submit.add-to-cart"]']),
    outOfStock: {
      selectors: ['#outOfStock', '#buybox-see-all-buying-choices'],
      text: ['currently unavailable', 'temporarily out of stock']
    },
    price: {
      selectors: [
        '#corePrice_feature_div .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price',
        '#corePrice_desktop .a-offscreen',
        '#price_inside_buybox',
        '#newBuyBoxPrice'
      ],
      jsonLd: true
    },
    added: {
      selectors: ['#NATC_SMART_WAGON_CONF_MSG_SUCCESS', '#sw-atc-details-single-container', '#huc-v2-order-row-confirm-text'],
      url: ['/cart/smart-wagon', '/gp/huc/'],
      text: ['added to cart']
    },
    decline: button(['#attachSiNoCoverage input', '#attachSiNoCoverage', '#siNoCoverage-announce'], ['^no thanks$']),
    cartEmpty: { text: ['your amazon cart is empty'] },
    checkout: button(
      ['input[name="proceedToRetailCheckout"]', '#sc-buy-box-ptc-button input', '#sc-buy-box-ptc-button'],
      ['^proceed to checkout']
    ),
    placeOrder: button(
      ['input[name="placeYourOrder1"]', '#submitOrderButtonId input', '#placeOrder', '#bottomSubmitOrderButtonId input'],
      ['^place (your )?order']
    ),
    total: { selectors: ['.grand-total-price', '#subtotals-marketplace-table .grand-total-price'], labels: TOTAL_LABELS }
  }
}

const bestbuy = {
  id: 'bestbuy',
  name: 'Best Buy',
  hosts: [/(^|\.)bestbuy\.com$/],
  homeUrl: 'https://www.bestbuy.com/',
  signInUrl: 'https://www.bestbuy.com/identity/global/signin',
  cartUrl: 'https://www.bestbuy.com/cart',
  productId: (url) =>
    (/\/(\d{7,8})\.p/.exec(url.pathname) || [])[1] ||
    url.searchParams.get('skuId') ||
    (/\/(?:sku\/)?(\d{7,8})(?:\/|$)/.exec(url.pathname) || [])[1] ||
    null,
  spec: {
    signIn: { url: ['/identity/(global/)?signin', '/identity/signin'] },
    buy: buy([
      'button[data-button-state="ADD_TO_CART"]',
      'button.add-to-cart-button:not([disabled])',
      'button[data-test-id="add-to-cart"]',
      '[data-testid="pdp-add-to-cart-button"]'
    ]),
    outOfStock: {
      selectors: ['button[data-button-state="SOLD_OUT"]', 'button[data-button-state="COMING_SOON"]'],
      text: ['sold out', 'coming soon', 'unavailable nearby']
    },
    price: {
      selectors: [
        '[data-testid="customer-price"]',
        '[data-testid="price-block-customer-price"]',
        '.priceView-hero-price span[aria-hidden="true"]',
        '.priceView-customer-price span'
      ],
      jsonLd: true
    },
    added: { selectors: ['.go-to-cart-button', '[data-testid="go-to-cart"]'], text: ['added to cart'] },
    decline: button([], ['^no,? thanks$']),
    cartEmpty: { text: ['your cart is empty'] },
    checkout: button(
      ['button[data-track="Checkout - Top"]', '.checkout-buttons__checkout button', '[data-testid="checkout-button"]'],
      ['^check ?out$']
    ),
    placeOrder: button(
      ['button.button__fast-track', 'button[data-track*="Place your Order"]'],
      ['^place (your )?order']
    ),
    total: { selectors: ['.order-summary__total .order-summary__price'], labels: TOTAL_LABELS }
  }
}

const target = {
  id: 'target',
  name: 'Target',
  hosts: [/(^|\.)target\.com$/],
  homeUrl: 'https://www.target.com/',
  signInUrl: 'https://www.target.com/account',
  cartUrl: 'https://www.target.com/cart',
  productId: (url) => (/\/A-(\d+)/.exec(url.pathname) || [])[1] || null,
  spec: {
    signIn: { url: ['/login(\\?|$)', 'login\\.target\\.com'], selectors: ['form input#username'] },
    buy: buy([
      'button[data-test="shippingButton"]',
      'button[data-test="shipItButton"]',
      'button[id^="addToCartButtonOrTextIdFor"]:not([disabled])'
    ], ['^ship it$']),
    outOfStock: {
      selectors: ['[data-test="soldOutBlock"]', '[data-test="outOfStockMessage"]', '[data-test="notifyMeButton"]'],
      text: ['out of stock', 'sold out', 'preorders have sold out']
    },
    price: { selectors: ['[data-test="product-price"]'], jsonLd: true },
    added: {
      selectors: ['[data-test="addToCartModalViewCartCheckout"]', '[data-test="content-wrapper"] [href="/cart"]'],
      text: ['added to cart']
    },
    decline: button(['button[data-test="espModalContent-declineCoverageButton"]'], ['^(no thanks|decline coverage)$']),
    cartEmpty: { text: ['your cart is empty'] },
    checkout: button(['button[data-test="checkout-button"]'], ['^(sign in to )?check ?out$']),
    placeOrder: button(['button[data-test="placeOrderButton"]'], ['^place (your )?order']),
    total: { selectors: ['[data-test="cart-summary-total"]'], labels: TOTAL_LABELS }
  }
}

const walmart = {
  id: 'walmart',
  name: 'Walmart',
  hosts: [/(^|\.)walmart\.com$/],
  homeUrl: 'https://www.walmart.com/',
  signInUrl: 'https://www.walmart.com/account/login',
  cartUrl: 'https://www.walmart.com/cart',
  productId: (url) => (/\/ip\/(?:[^/]+\/)?(\d+)/.exec(url.pathname) || [])[1] || null,
  spec: {
    signIn: { url: ['/account/login', 'identity\\.walmart\\.com'] },
    buy: buy([
      'button[data-automation-id="atc"]',
      '[data-testid="add-to-cart-section"] button',
      'button[data-tl-id="ProductPrimaryCTA-cta_add_to_cart_button"]'
    ]),
    outOfStock: { text: ['out of stock', 'not available'] },
    price: { selectors: ['[data-seo-id="hero-price"]', '[itemprop="price"]', '[data-testid="price-wrap"]'], jsonLd: true },
    added: {
      selectors: ['[data-testid="pac-view-cart-btn"]', 'button[aria-label*="in cart" i]', '[data-testid="quantity-stepper"]'],
      text: ['added to cart']
    },
    decline: button([], ['^no,? thanks$']),
    cartEmpty: { text: ['time to start shopping', 'your cart is empty'] },
    checkout: button(
      ['button[data-automation-id="checkout"]', '[id="Continue to checkout button"]'],
      ['^continue to checkout$', '^check ?out$']
    ),
    placeOrder: button(['button[data-automation-id="place-order-button"]'], ['^place order']),
    total: { selectors: ['[data-testid="grand-total-value"]'], labels: TOTAL_LABELS }
  }
}

const costco = {
  id: 'costco',
  name: 'Costco',
  hosts: [/(^|\.)costco\.com$/],
  homeUrl: 'https://www.costco.com/',
  signInUrl: 'https://www.costco.com/LogonForm',
  cartUrl: 'https://www.costco.com/CheckoutCartDisplayView',
  productId: (url) => (/\.product\.(\d+)\.html/.exec(url.pathname) || /\/p\/[^/]*\/(\d+)/.exec(url.pathname) || [])[1] || null,
  spec: {
    signIn: {
      url: ['signin\\.costco\\.com', '/LogonForm'],
      // member-only items show this instead of a buy button
      text: ['sign in to (buy|see price)', 'member only item']
    },
    buy: buy(['#add-to-cart-btn', '[automation-id="addToCartButton"]', 'button[data-testid*="add-to-cart" i]']),
    outOfStock: {
      selectors: ['#add-to-cart-btn.out-of-stock', '.oos-overlay', '#out-of-stock-btn'],
      text: ['out of stock']
    },
    price: {
      selectors: ['[automation-id="productPriceOutput"]', '#pull-right-price .value', '[data-testid*="price" i]'],
      jsonLd: true
    },
    added: { selectors: ['#costcoModal .added-to-cart', '[automation-id="viewCartButton"]'], text: ['added to cart', 'item added'] },
    decline: button([], ['^no,? thanks$']),
    cartEmpty: { text: ['your (shopping )?cart is empty'] },
    checkout: button(['#shopCartCheckoutSubmitButton', '[automation-id="checkoutButton"]'], ['^check ?out$']),
    placeOrder: button(['[automation-id="placeOrderButton"]', '#place-order-button'], ['^place order']),
    total: { selectors: ['#order-estimated-total', '[automation-id="orderTotal"]'], labels: TOTAL_LABELS }
  }
}

/**
 * Any other shop: watch for an "Add to cart" button, click it, then hand the
 * window to the user. No cart URL is known, so nothing past that is automated.
 */
const generic = {
  id: 'generic',
  name: 'Other site',
  hosts: [],
  homeUrl: null,
  signInUrl: null,
  cartUrl: null,
  productId: () => null,
  spec: {
    signIn: {},
    buy: buy([], ['^add to (basket|trolley)$', '^buy now$', '^pre-?order( now)?$']),
    outOfStock: { text: ['out of stock', 'sold out', 'currently unavailable'] },
    price: { selectors: ['[itemprop="price"]'], jsonLd: true },
    added: { text: ['added to (your )?(cart|bag|basket)'] }
  }
}

const RETAILERS = [amazon, bestbuy, target, walmart, costco]
const ORDERED = {
  url: ['thank-?you', 'order-?confirmation', '/buy/thankyou', 'orderconfirm'],
  text: ['thank(s| you) for your order', 'order (has been |was |is )?(placed|confirmed|received)', 'we(\'ve| have) received your order']
}
for (const r of [...RETAILERS, generic]) {
  r.spec.blocked = BLOCKED
  r.spec.ordered = ORDERED
}

function parseUrl(input) {
  try {
    const url = new URL(String(input).trim())
    return /^https?:$/.test(url.protocol) ? url : null
  } catch (e) {
    return null
  }
}

/** Which retailer does this product URL belong to? Unknown shops get `generic`. */
function detectRetailer(input) {
  const url = parseUrl(input)
  if (!url) return null
  return RETAILERS.find((r) => r.hosts.some((h) => h.test(url.hostname))) || generic
}

function getRetailer(id) {
  return [...RETAILERS, generic].find((r) => r.id === id) || null
}

function describeProduct(input) {
  const url = parseUrl(input)
  const retailer = detectRetailer(input)
  if (!url || !retailer) return null
  return { url: url.href, retailer, productId: retailer.productId(url) }
}

module.exports = { RETAILERS, generic, detectRetailer, getRetailer, describeProduct, parseUrl }
