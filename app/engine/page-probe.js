'use strict'

/**
 * Runs INSIDE the retailer page (serialised with .toString()), so it must be
 * fully self-contained: no closures, no requires.
 *
 * `spec` is plain JSON describing what to look for. Each key is optional:
 *   signals  (blocked, signIn, outOfStock, added, cartEmpty):
 *       { selectors, text, sparseText, title, url }
 *   buttons  (buy, decline, checkout, placeOrder):
 *       { selectors, text, exclude, reject }
 *   amounts  (price, total): { selectors, jsonLd, labels }
 *   productId: string looked up in the page HTML
 *
 * Returns a JSON-safe description of the page. Buttons come back as viewport
 * coordinates and are tagged with data-buybot="<key>" so they can be re-found.
 */
function pageProbe(spec) {
  const out = { url: location.href, title: document.title, ready: document.readyState }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const rx = (list) => (list || []).map((s) => new RegExp(s, 'i'))
  const qsa = (sel, root) => {
    try {
      return Array.from((root || document).querySelectorAll(sel))
    } catch (e) {
      return [] // a selector the browser rejects must never break the probe
    }
  }
  const visible = (el) => {
    if (!el || !el.isConnected) return false
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    }
    const cs = getComputedStyle(el)
    return cs.display !== 'none' && cs.visibility === 'visible'
  }
  const enabled = (el) => !el.disabled && !el.closest('[disabled], [aria-disabled="true"]')
  const label = (el) =>
    norm(
      el.tagName === 'INPUT'
        ? el.value || el.getAttribute('aria-label')
        : el.innerText || el.getAttribute('aria-label') || el.textContent
    )
  const body = document.body
  const bodyText = body ? norm(body.innerText) : ''

  const has = (group) => {
    if (!group) return false
    if (rx(group.url).some((r) => r.test(location.href))) return true
    if (rx(group.title).some((r) => r.test(document.title))) return true
    if ((group.selectors || []).some((sel) => qsa(sel).some(visible))) return true
    if (rx(group.text).some((r) => r.test(bodyText))) return true
    // "sparse" phrases only count on near-empty pages (challenge screens),
    // so a normal page that merely mentions them is not misread as a block.
    if (bodyText.length < 4000 && rx(group.sparseText).some((r) => r.test(bodyText))) return true
    return false
  }

  const find = (key, group) => {
    if (!group) return null
    const reject = group.reject ? new RegExp(group.reject, 'i') : null
    const usable = (el) => visible(el) && enabled(el) && !(reject && reject.test(label(el)))
    let hit = null
    let via = null
    for (const sel of group.selectors || []) {
      hit = qsa(sel).find(usable)
      if (hit) {
        via = sel
        break
      }
    }
    if (!hit && group.text && group.text.length) {
      const patterns = rx(group.text)
      const excluded = (el) => (group.exclude || []).some((sel) => {
        try {
          return !!el.closest(sel)
        } catch (e) {
          return false
        }
      })
      hit = qsa('button, a[href], input[type="submit"], input[type="button"], [role="button"]').find((el) => {
        if (!usable(el)) return false
        const t = label(el)
        return t.length > 0 && t.length < 60 && patterns.some((r) => r.test(t)) && !excluded(el)
      })
      if (hit) via = 'text'
    }
    qsa('[data-buybot="' + key + '"]').forEach((el) => el !== hit && el.removeAttribute('data-buybot'))
    if (!hit) return null
    hit.setAttribute('data-buybot', key)
    hit.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const r = hit.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: label(hit), via }
  }

  const money = (t) => {
    const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(t || '')
    return m ? parseFloat(m[1].replace(/,/g, '')) : null
  }
  const amount = (group) => {
    if (!group) return null
    for (const sel of group.selectors || []) {
      for (const el of qsa(sel)) {
        const c = el.getAttribute('content')
        if (c && /^\d+(\.\d+)?$/.test(c.trim())) return parseFloat(c)
        const v = money(el.textContent)
        if (v != null) return v
      }
    }
    if (group.labels) {
      const labels = rx(group.labels)
      for (const el of qsa('span, div, p, td, th, dt, li, strong, b, h2, h3')) {
        if (el.childElementCount > 2) continue
        const t = norm(el.textContent)
        if (t.length > 40 || !labels.some((r) => r.test(t))) continue
        let node = el
        for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
          const text = norm(node.textContent)
          if (text.length > 160) break
          const v = money(text)
          if (v != null) return v
        }
      }
    }
    if (group.jsonLd) {
      for (const s of qsa('script[type="application/ld+json"]')) {
        try {
          const stack = [JSON.parse(s.textContent)]
          while (stack.length) {
            const n = stack.pop()
            if (Array.isArray(n)) stack.push(...n)
            else if (n && typeof n === 'object') {
              if (/Product/i.test(String(n['@type'])) && n.offers) {
                const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers
                const v = parseFloat(offers && (offers.price || offers.lowPrice))
                if (!isNaN(v)) return v
              }
              if (n['@graph']) stack.push(n['@graph'])
            }
          }
        } catch (e) {
          /* malformed JSON-LD is common; ignore */
        }
      }
    }
    return null
  }

  if ('blocked' in spec) {
    out.blocked = has(spec.blocked)
    if (out.blocked) return out // never poke at a challenge page
  }
  for (const key of ['signIn', 'outOfStock', 'added', 'cartEmpty']) {
    if (key in spec) out[key] = has(spec[key])
  }
  for (const key of ['buy', 'decline', 'checkout', 'placeOrder']) {
    if (key in spec) out[key] = find(key, spec[key])
  }
  for (const key of ['price', 'total']) {
    if (key in spec) out[key] = amount(spec[key])
  }
  if (spec.productId) {
    out.hasProduct = document.documentElement.innerHTML.indexOf(spec.productId) !== -1
  }
  return out
}

/** Runs in the page: DOM-click the element a previous probe tagged. */
function clickTagged(key) {
  const el = document.querySelector('[data-buybot="' + key + '"]')
  if (!el) return false
  el.click()
  return true
}

module.exports = { pageProbe, clickTagged }
