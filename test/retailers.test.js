'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { describeProduct, detectRetailer, RETAILERS } = require('../app/retailers')

test('recognises product links and extracts product ids', () => {
  const cases = [
    ['https://www.amazon.com/Some-Product-Name/dp/B0CL61F39H/ref=sr_1_1?th=1', 'amazon', 'B0CL61F39H'],
    ['https://www.amazon.com/gp/product/B08FC5L3RG', 'amazon', 'B08FC5L3RG'],
    ['https://www.bestbuy.com/site/sony-playstation-5-console/6426149.p?skuId=6426149', 'bestbuy', '6426149'],
    ['https://www.bestbuy.com/product/some-name/J3ZYG2595R/sku/6614151', 'bestbuy', '6614151'],
    ['https://www.target.com/p/playstation-5-console/-/A-81114595', 'target', '81114595'],
    ['https://www.walmart.com/ip/PlayStation-5-Console/363472942', 'walmart', '363472942'],
    ['https://www.walmart.com/ip/363472942', 'walmart', '363472942'],
    ['https://www.costco.com/some-tv.product.4000123456.html', 'costco', '4000123456'],
    ['https://shop.example.com/widgets/42', 'generic', null]
  ]
  for (const [url, id, productId] of cases) {
    const d = describeProduct(url)
    assert.equal(d.retailer.id, id, url)
    assert.equal(d.productId, productId, url)
  }
})

test('rejects things that are not web links', () => {
  for (const bad of ['', 'playstation 5', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.equal(detectRetailer(bad), null, bad)
  }
})

test('look-alike domains are not treated as the retailer', () => {
  assert.equal(detectRetailer('https://amazon.com.evil.example/dp/B0CL61F39H').id, 'generic')
  assert.equal(detectRetailer('https://notbestbuy.com/site/x/6426149.p').id, 'generic')
})

test('every retailer definition is complete and its patterns compile', () => {
  for (const r of RETAILERS) {
    for (const key of ['blocked', 'signIn', 'buy', 'outOfStock', 'price', 'added', 'cartEmpty', 'checkout', 'placeOrder', 'total']) {
      assert.ok(r.spec[key], `${r.id}.${key}`)
    }
    assert.ok(detectRetailer(r.cartUrl) === r && detectRetailer(r.signInUrl) === r)
    for (const group of Object.values(r.spec)) {
      for (const field of ['text', 'sparseText', 'title', 'url', 'labels']) {
        for (const src of group[field] || []) new RegExp(src, 'i')
      }
      if (group.reject) new RegExp(group.reject, 'i')
    }
  }
})
