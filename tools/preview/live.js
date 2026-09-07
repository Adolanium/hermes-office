import React from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../../plugin.js'
plugin.register({
  storage: { get: (key, fallback) => { try { return JSON.parse(localStorage.getItem(`office-preview-${key}`)) ?? fallback } catch { return fallback } }, set: (key, value) => localStorage.setItem(`office-preview-${key}`, JSON.stringify(value)) },
  register: entry => { if (entry.area === 'route') createRoot(document.querySelector('#app')).render(entry.render()) },
  onDispose: () => {}
})
document.querySelector('#preview-theme').onclick = () => document.documentElement.classList.toggle('dark')
