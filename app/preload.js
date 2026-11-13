'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('buybot', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (fn) => ipcRenderer.on('state', (_e, state) => fn(state)),
  addTask: (input) => ipcRenderer.invoke('task:add', input),
  startTask: (id) => ipcRenderer.invoke('task:start', id),
  stopTask: (id) => ipcRenderer.invoke('task:stop', id),
  removeTask: (id) => ipcRenderer.invoke('task:remove', id),
  showTask: (id) => ipcRenderer.invoke('task:show', id),
  openAccount: (retailerId) => ipcRenderer.invoke('account:open', retailerId)
})
