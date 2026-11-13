'use strict'

const $ = (id) => document.getElementById(id)
const api = window.buybot

const PHASES = {
  idle: ['Idle', 'idle'],
  stopped: ['Stopped', 'idle'],
  starting: ['Starting', 'watching'],
  monitoring: ['Watching', 'watching'],
  in_stock: ['In stock', 'working'],
  adding: ['Adding to cart', 'working'],
  cart: ['In cart', 'working'],
  checkout: ['Checking out', 'working'],
  needs_attention: ['Needs you', 'attention'],
  ready: ['Ready for you', 'ready'],
  error: ['Error', 'error']
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  for (const c of children) if (c) node.append(c)
  return node
}

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

function renderTask(t) {
  const [label, tone] = PHASES[t.phase] || [t.phase, 'idle']
  const facts = [t.retailerName]
  if (t.maxPrice) facts.push(`max $${Number(t.maxPrice).toFixed(2)}`)
  facts.push(`every ${t.intervalSec}s`)
  if (t.price != null) facts.push(`last price $${Number(t.price).toFixed(2)}`)
  if (t.lastChecked) facts.push(`checked ${time(t.lastChecked)}${t.checks ? ` (${t.checks}×)` : ''}`)

  const actions = el('div', { class: 'task-actions' }, [
    t.active || t.phase === 'ready'
      ? el('button', { text: 'Show window', onclick: () => api.showTask(t.id) })
      : null,
    t.active
      ? el('button', { text: 'Stop', onclick: () => api.stopTask(t.id) })
      : t.phase === 'ready'
        ? el('button', { text: 'Done', onclick: () => api.stopTask(t.id) })
        : el('button', { class: 'primary', text: 'Start', onclick: () => api.startTask(t.id) }),
    el('button', { class: 'danger', text: 'Remove', onclick: () => api.removeTask(t.id) })
  ])

  return el('div', { class: `task ${tone}`, 'data-id': t.id }, [
    el('div', {}, [
      el('div', { class: 'task-title', text: t.name || t.title || t.url }),
      el('div', { class: 'task-meta', text: facts.join(' · ') })
    ]),
    actions,
    el('div', { class: 'task-status' }, [
      el('span', { class: `pill ${tone}`, text: label }),
      el('span', { text: t.message || '' })
    ])
  ])
}

let accountsRendered = false

function render(state) {
  if (!accountsRendered) {
    accountsRendered = true
    $('accounts').replaceChildren(
      ...state.retailers.map((r) => el('button', { text: `Sign in to ${r.name}`, onclick: () => api.openAccount(r.id) }))
    )
    $('interval').min = state.minIntervalSec
  }

  $('tasks').replaceChildren(...state.tasks.map(renderTask))
  $('empty').hidden = state.tasks.length > 0

  const active = state.tasks.filter((t) => t.active).length
  const ready = state.tasks.filter((t) => t.phase === 'ready').length
  $('summary').textContent = [active ? `${active} watching` : '', ready ? `${ready} ready for checkout` : '']
    .filter(Boolean)
    .join(' · ')

  const log = $('log')
  const pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 8
  log.replaceChildren(
    ...state.logs.map((l) => el('div', {}, [`${time(l.time)}  `, el('b', { text: l.task }), `  ${l.message}`]))
  )
  if (pinned) log.scrollTop = log.scrollHeight
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const error = $('add-error')
  error.hidden = true
  const result = await api.addTask({
    url: $('url').value,
    name: $('name').value,
    maxPrice: $('maxPrice').value,
    intervalSec: $('interval').value
  })
  if (!result.ok) {
    error.textContent = result.error
    error.hidden = false
    return
  }
  $('url').value = ''
  $('name').value = ''
  $('maxPrice').value = ''
  api.startTask(result.id)
})

api.onState(render)
api.getState().then(render)
