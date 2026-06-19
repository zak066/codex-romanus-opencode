---
name: arte
description: |
  Ovidio, frontend, UI, components, React, Vue, Svelte, CSS, Tailwind,
  responsive design, accessibility, WCAG, a11y, browser compatibility.
  Use when building UI components, styling pages, or fixing frontend issues.
---

# Arte — Ovidio

## Component Pattern (Framework-Agnostic)

```javascript
// Struttura standard: props → state → render → events
function Component(props) {
  // 1. Destruttura props
  // 2. Inizializza state
  // 3. Definisci handlers
  // 4. Return markup
}
```

React: function components + hooks
Vue: `<script setup>` + Composition API
Svelte: `<script>` + reattività dichiarativa

## Tailwind — Pattern Comuni

```html
<!-- Button -->
<button class="px-4 py-2 bg-blue-600 text-white rounded-lg
               hover:bg-blue-700 focus:outline-none focus:ring-2
               focus:ring-blue-500 disabled:opacity-50">
  {label}
</button>

<!-- Card -->
<div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
  <h2 class="text-lg font-semibold text-gray-900">{title}</h2>
  <p class="text-gray-600">{content}</p>
</div>

<!-- Form input -->
<input class="w-full px-3 py-2 border border-gray-300 rounded-md
              focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:border-blue-500" type="text" />
```

## Responsive Design — Mobile First

```css
/* Mobile (default): single column, small padding */
.container { padding: 1rem; }

/* Tablet ≥768px */
@media (min-width: 768px) {
  .container { padding: 2rem; max-width: 720px; margin: 0 auto; }
  .grid { grid-template-columns: repeat(2, 1fr); }
}

/* Desktop ≥1024px */
@media (min-width: 1024px) {
  .container { max-width: 960px; }
  .grid { grid-template-columns: repeat(3, 1fr); }
}
```

Breakpoint: sm=640, md=768, lg=1024, xl=1280, 2xl=1536

## Accessibility (WCAG) Checklist

- [ ] Ogni input ha `<label>` associato via `for`/`id` o `aria-label`
- [ ] Ogni immagine ha `alt` text significativo (o `alt=""` se decorativa)
- [ ] Tab order logico: elementi interattivi in ordine di navigazione
- [ ] Keyboard: Tab, Enter, Escape funzionano su ogni elemento interattivo
- [ ] Contrasto: testo normale ≥4.5:1, testo grande ≥3:1
- [ ] Focus visible: outline visibile su focus, mai `outline: none` senza sostituto
- [ ] Ruoli ARIA: `role="button"`, `role="navigation"`, `role="alert"` dove serve
- [ ] Aree dinamiche: `aria-live="polite"` per aggiornamenti asincroni

## State Management Pattern

```javascript
// React — Context + useReducer
const StateContext = createContext();
function Provider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <StateContext.Provider value={{ state, dispatch }}>{children}</StateContext.Provider>;
}

// Vue — Pinia store
// export const useStore = defineStore('main', { state: () => ({ count: 0 }) })

// Svelte — writable store
// export const count = writable(0);
```

## Browser Compatibility

```bash
npx browserslist
# default: > 0.5%, last 2 versions, not dead
```

## Chrome DevTools — Quick Reference

- Elements: ispeziona DOM, modifica CSS live
- Console: debug JS, test snippet
- Network: waterfall, timing, status, payload
- Performance: registra, analizza frame, long task
- Lighthouse: audit performance, a11y, SEO, best practice

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="ovidio-frontend" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="ovidio-frontend" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni task, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | ovidio-frontend
- Componente creato: {nome}
- Coverage a11y: {checklist passati/totali}
- Responsive: {si/no} testato su {breakpoint}
- Step monitorati: [✅/⚠️] (se step limit → resume packet con task_id)
```
