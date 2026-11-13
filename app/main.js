'use strict'

const { app, BrowserWindow, ipcMain, Notification, session, shell, powerSaveBlocker, Menu } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { TaskRunner } = require('./engine/runner')
const { ElectronDriver } = require('./electron-driver')
const { RETAILERS, describeProduct, getRetailer } = require('./retailers')

// Lets tests (and curious users) run against a throwaway profile.
if (process.env.BUYBOT_USER_DATA) app.setPath('userData', process.env.BUYBOT_USER_DATA)

const PARTITION = 'persist:shops' // one cookie jar shared by every store window
const MIN_INTERVAL_SEC = 10
const ACTIVE = new Set(['starting', 'monitoring', 'in_stock', 'adding', 'cart', 'checkout', 'needs_attention'])

let mainWindow = null
let quitting = false
let sleepBlocker = null
const tasks = [] // persisted fields + live status
const live = new Map() // task id -> { runner, win }
const accountWindows = new Map() // retailer id -> BrowserWindow
const logs = []

// persistence --------------------------------------------------------------

const storeFile = () => path.join(app.getPath('userData'), 'buybot.json')
const PERSISTED = ['id', 'url', 'retailerId', 'productId', 'name', 'maxPrice', 'intervalSec']

function loadTasks() {
  try {
    const saved = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    for (const t of saved.tasks || []) {
      if (getRetailer(t.retailerId)) tasks.push({ ...t, phase: 'idle', message: 'Not running', checks: 0 })
    }
  } catch (e) {
    /* first launch */
  }
}

function saveTasks() {
  const data = { tasks: tasks.map((t) => Object.fromEntries(PERSISTED.map((k) => [k, t[k]]))) }
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
  fs.writeFileSync(storeFile(), JSON.stringify(data, null, 2))
}

// renderer sync ------------------------------------------------------------

function snapshot() {
  return {
    tasks: tasks.map((t) => ({ ...t, retailerName: getRetailer(t.retailerId).name, active: ACTIVE.has(t.phase) })),
    retailers: RETAILERS.map((r) => ({ id: r.id, name: r.name })),
    logs,
    minIntervalSec: MIN_INTERVAL_SEC
  }
}

function push() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state', snapshot())
  const anyActive = tasks.some((t) => ACTIVE.has(t.phase))
  // Keep the Mac awake while something is being watched.
  if (anyActive && sleepBlocker == null) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!anyActive && sleepBlocker != null) {
    powerSaveBlocker.stop(sleepBlocker)
    sleepBlocker = null
  }
}

function log(task, message) {
  logs.push({ time: Date.now(), task: task ? displayName(task) : 'BuyBot', message })
  if (logs.length > 300) logs.shift()
  push()
}

const displayName = (t) => t.name || t.title || getRetailer(t.retailerId).name + ' item'

// store browser windows ----------------------------------------------------

function storeWindow(title, show) {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    show,
    title,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // keep checking while hidden or behind other windows
    }
  })
  win.setMenuBarVisibility(false)
  // Keep everything in the one window rather than spawning pop-ups.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) win.webContents.loadURL(url)
    return { action: 'deny' }
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  return win
}

function configureSession() {
  const ses = session.fromPartition(PARTITION)
  // Present as the plain Chrome this Electron build is, so stores serve their normal site.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|BuyBot|buybot)\/\S+/g, ''))
  // Store pages get no access to notifications, location, camera, etc.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

function openAccount(retailerId) {
  const retailer = getRetailer(retailerId)
  if (!retailer || !retailer.signInUrl) return
  let win = accountWindows.get(retailerId)
  if (!win || win.isDestroyed()) {
    win = storeWindow(`${retailer.name}: sign in, then close this window`, true)
    accountWindows.set(retailerId, win)
    win.loadURL(retailer.signInUrl).catch(() => {})
  }
  win.show()
  win.focus()
}

// tasks --------------------------------------------------------------------

const findTask = (id) => tasks.find((t) => t.id === id)

function addTask({ url, name, maxPrice, intervalSec }) {
  const product = describeProduct(url)
  if (!product) return { ok: false, error: 'That does not look like a web link. Paste the full product page address.' }
  if (tasks.some((t) => t.url === product.url)) return { ok: false, error: 'You are already watching that link.' }
  const price = Number(maxPrice)
  const every = Number(intervalSec)
  const task = {
    id: crypto.randomUUID(),
    url: product.url,
    retailerId: product.retailer.id,
    productId: product.productId,
    name: String(name || '').trim().slice(0, 80),
    maxPrice: price > 0 ? price : null,
    intervalSec: Math.max(MIN_INTERVAL_SEC, every > 0 ? every : 30),
    phase: 'idle',
    message: 'Not running',
    checks: 0
  }
  tasks.push(task)
  saveTasks()
  push()
  return { ok: true, id: task.id }
}

function startTask(id) {
  const task = findTask(id)
  if (!task || live.has(id)) return
  const retailer = getRetailer(task.retailerId)
  const win = storeWindow(`BuyBot: ${displayName(task)}`, false)
  const runner = new TaskRunner({ task, retailer, driver: new ElectronDriver(win.webContents) })
  live.set(id, { runner, win })

  // Closing the window while the bot is working would kill the task; hide instead.
  win.on('close', (e) => {
    if (!quitting && live.has(id) && ACTIVE.has(task.phase)) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (live.get(id) && live.get(id).win === win) {
      live.delete(id)
      if (task.phase === 'ready') Object.assign(task, { phase: 'idle', message: 'Finished' })
      push()
    }
  })

  runner.on('status', (s) => {
    const { title, ...rest } = s
    Object.assign(task, rest)
    if (title && !/^(https?:|about:)/.test(title)) task.title = title.slice(0, 120)
    push()
  })
  runner.on('log', (message) => log(task, message))
  runner.on('attention', ({ kind, message }) => {
    log(task, message)
    win.show()
    win.focus()
    if (app.dock) app.dock.bounce(kind === 'ready' ? 'critical' : 'informational')
    shell.beep()
    if (Notification.isSupported()) {
      const titles = { ready: 'Ready to check out', captcha: 'Verification needed', signin: 'Sign-in needed' }
      const n = new Notification({ title: `${titles[kind]}: ${displayName(task)}`, body: message })
      n.on('click', () => !win.isDestroyed() && (win.show(), win.focus()))
      n.show()
    }
  })

  log(task, `Started watching (${retailer.name}, every ~${task.intervalSec}s${task.maxPrice ? `, max $${task.maxPrice}` : ''}).`)
  runner.start().then(() => {
    // After a hand-over the window stays open for the user to finish checkout.
    if (task.phase !== 'ready' && live.get(id) && live.get(id).runner === runner) {
      live.delete(id)
      if (!win.isDestroyed()) win.destroy()
    }
    push()
  })
}

function stopTask(id) {
  const entry = live.get(id)
  const task = findTask(id)
  if (!entry) return
  entry.runner.stop()
  if (task && task.phase === 'ready') {
    // Already handed over: "stop" just closes the store window.
    live.delete(id)
    Object.assign(task, { phase: 'idle', message: 'Finished' })
    if (!entry.win.isDestroyed()) entry.win.destroy()
    push()
  }
}

function removeTask(id) {
  const entry = live.get(id)
  if (entry) {
    entry.runner.stop()
    live.delete(id)
    if (!entry.win.isDestroyed()) entry.win.destroy()
  }
  const i = tasks.findIndex((t) => t.id === id)
  if (i !== -1) tasks.splice(i, 1)
  saveTasks()
  push()
}

function showTask(id) {
  const entry = live.get(id)
  if (entry && !entry.win.isDestroyed()) {
    entry.win.show()
    entry.win.focus()
  }
}

// app ----------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 780,
    minWidth: 640,
    minHeight: 480,
    title: 'BuyBot',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.on('closed', () => (mainWindow = null))
}

ipcMain.handle('state:get', () => snapshot())
ipcMain.handle('task:add', (_e, input) => addTask(input || {}))
ipcMain.handle('task:start', (_e, id) => startTask(id))
ipcMain.handle('task:stop', (_e, id) => stopTask(id))
ipcMain.handle('task:remove', (_e, id) => removeTask(id))
ipcMain.handle('task:show', (_e, id) => showTask(id))
ipcMain.handle('account:open', (_e, retailerId) => openAccount(retailerId))

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  configureSession()
  loadTasks()
  createMainWindow()
  app.on('activate', () => (mainWindow ? mainWindow.show() : createMainWindow()))
})

app.on('before-quit', () => {
  quitting = true
  for (const { runner } of live.values()) runner.stop()
})

// Standard Mac behaviour: closing the window leaves the app (and any watching) running.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
