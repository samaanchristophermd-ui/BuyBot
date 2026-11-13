'use strict'

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))])

/** Adapts an Electron webContents to the driver interface used by TaskRunner. */
class ElectronDriver {
  constructor(webContents) {
    this.wc = webContents
  }

  /**
   * Resolves as soon as the DOM is usable. Retail pages keep loading trackers
   * for a long time after that, and waiting for the full load would waste the
   * seconds that matter when an item comes into stock.
   */
  goto(url) {
    const wc = this.wc
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        wc.removeListener('dom-ready', onReady)
        err ? reject(err) : resolve()
      }
      const onReady = () => finish()
      const timer = setTimeout(() => finish(new Error('page load timed out')), 45000)
      wc.once('dom-ready', onReady)
      wc.loadURL(url).then(
        () => finish(),
        // ERR_ABORTED just means a redirect or a newer navigation took over
        (err) => (err && (err.code === 'ERR_ABORTED' || err.errno === -3) ? finish() : finish(err))
      )
    })
  }

  evaluate(fnSource, arg) {
    const code = `(${fnSource})(${JSON.stringify(arg === undefined ? null : arg)})`
    return withTimeout(this.wc.executeJavaScript(code, true), 10000, 'page did not respond')
  }

  /** A genuine mouse click at viewport coordinates, via the DevTools protocol. */
  async click(x, y) {
    const dbg = this.wc.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    const at = { x, y, button: 'left', clickCount: 1 }
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await dbg.sendCommand('Input.dispatchMouseEvent', { ...at, type: 'mousePressed' })
    await dbg.sendCommand('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased' })
  }
}

module.exports = { ElectronDriver }
