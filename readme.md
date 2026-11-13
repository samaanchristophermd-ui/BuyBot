# BuyBot

A Mac app that watches product pages on **Amazon, Best Buy, Target, Walmart and Costco**, and the moment an item is in stock at or under your price, adds it to your cart, starts checkout and calls you over to press **Place Order**.

BuyBot is for buying one thing for yourself. It is not built for buying in bulk or reselling.

## How it works

1. You sign in to each store once, inside BuyBot. Your address and card stay saved in your store account, as usual.
2. You paste a product link, optionally with a maximum price.
3. BuyBot reloads the page every 30 seconds or so (you choose; 10 seconds is the minimum).
4. When the item can be bought, it clicks Add to Cart, opens the cart, confirms the item is really there and clicks Checkout.
5. It brings the store window to the front, plays a sound and sends a notification. You review the total and place the order.

Things it deliberately does not do:

- **It never places the order itself.** The last click is yours.
- **It never sees or stores your card.** There is no card field anywhere in the app. The only file it writes is your watch list (`~/Library/Application Support/BuyBot/buybot.json`).
- **It does not solve captchas or hide from the stores.** If a store shows a "verify you are human" page, BuyBot stops, shows you the window, and carries on once you have cleared it.

## Install

### Option A: download the built app

Every push builds the app on GitHub: open the repository's **Actions** tab, choose the latest **Build Mac app** run, and download **BuyBot-mac**. Inside are two disk images: `arm64` for Apple Silicon Macs (M1 and later) and the other one for Intel Macs.

The app is not signed with an Apple developer certificate, so the first launch needs one extra step: open it, dismiss the warning, then go to **System Settings → Privacy & Security** and click **Open Anyway**.

### Option B: build it on your Mac

Install [Node.js](https://nodejs.org) 20 or newer, then:

```bash
npm install
```

```bash
npm run dist
```

The app appears in `dist/`. To run it without packaging, use `npm start`.

## Using it

- **Store accounts**: click *Sign in to …* for each store you plan to use, sign in, tick "keep me signed in", and check that a default shipping address and payment card are saved in that account. Costco shows most prices and buy buttons to signed-in members only.
- **Watch a product**: paste the product page link. Set a **max price** for anything sold by third-party sellers (Amazon and Walmart especially), so an inflated listing is ignored.
- Each product gets its own store window, hidden until it needs you. *Show window* reveals it at any time.
- Closing the main window leaves BuyBot watching in the Dock. The Mac is kept awake while anything is being watched.
- Links from any other shop work too, in a simpler mode: BuyBot clicks the page's Add to Cart button and hands over straight away.

## What has and has not been verified

The engine is tested end to end in a real browser against a local fake shop (`npm test`), and the app itself is tested the same way (`npm run test:electron`, `npm run test:app`): waiting for stock, the price limit, captcha pauses, sign-in walls, failed add-to-cart clicks, ignoring "sponsored" buy buttons, and never placing the order.

**It has not been run against the live stores.** The button selectors in `app/retailers/index.js` are written from knowledge of each site, not checked on the real pages, and stores change their pages often. Each button is therefore found by several known selectors and then by its visible label, which survives most redesigns. Before relying on it for a launch, try it on an ordinary in-stock item at each store you care about. If a store stops working, the Activity log says which step failed, and `app/retailers/index.js` is the only file that needs changing.

Other limits worth knowing:

- Stores may throttle or block frequent reloads. Keep the interval reasonable.
- High-demand launches often add queues, invitations or purchase limits that no tool gets around.
- Automated shopping may be against a store's terms of use. That risk is yours.

## Project layout

| Path | What it is |
| --- | --- |
| `app/main.js` | Electron main process: windows, watch list, notifications |
| `app/engine/runner.js` | The watch → cart → checkout flow for one product |
| `app/engine/page-probe.js` | Code that runs inside the store page to find buttons and prices |
| `app/retailers/index.js` | Per-store selectors and URLs |
| `app/renderer/` | The app window |
| `test/` | Fake shop and tests |

## Credit

BuyBot began as a fork of [PS5bot](https://github.com/VVNoodle/PS5bot) by VVNoodle. Version 2 is a rewrite; the original command-line bot is in the git history.
