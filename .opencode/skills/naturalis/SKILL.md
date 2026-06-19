---
name: naturalis
description: |
  Plinio il Vecchio, SEO, search engine optimization, meta tags, Open Graph,
  JSON-LD, structured data, robots.txt, sitemap, Core Web Vitals,
  Lighthouse SEO, canonical URLs, hreflang, Google Search Console.
  Use when optimizing a web project for search engines or setting up SEO metadata.
---

# Naturalis — Plinio il Vecchio

## Meta Tags HTML — Template completo

```html
<title>{Nome Sito} — {Descrizione breve}</title>
<meta name="description" content="{Descrizione unica per pagina, max 160 caratteri}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="{URL completo pagina}">

<!-- Open Graph -->
<meta property="og:title" content="{Titolo}">
<meta property="og:description" content="{Descrizione}">
<meta property="og:image" content="{URL immagine 1200x630}">
<meta property="og:url" content="{URL pagina}">
<meta property="og:type" content="website">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{Titolo}">
<meta name="twitter:description" content="{Descrizione}">
<meta name="twitter:image" content="{URL immagine}">

<!-- Multilingua -->
<link rel="alternate" hreflang="it" href="{URL italiano}">
<link rel="alternate" hreflang="en" href="{URL inglese}">
<link rel="alternate" hreflang="x-default" href="{URL default}">
```

## Structured Data — JSON-LD

```json
<!-- WebSite (sempre presente) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "{Nome Sito}",
  "url": "{URL sito}",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "{URL}/search?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}
</script>

<!-- Organization / LocalBusiness -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "{Nome Azienda}",
  "url": "{URL sito}",
  "logo": "{URL logo}",
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "{telefono}",
    "contactType": "customer service"
  }
}
</script>

<!-- BreadcrumbList -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "{URL}" },
    { "@type": "ListItem", "position": 2, "name": "Categoria", "item": "{URL}/cat" },
    { "@type": "ListItem", "position": 3, "name": "Pagina", "item": "{URL}/cat/page" }
  ]
}
</script>
```

## robots.txt

```txt
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /private/
Disallow: /*?sort=*
Disallow: /*?page=*

Sitemap: https://{dominio}/sitemap.xml
```

## sitemap.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://{dominio}/</loc>
    <lastmod>2026-05-23</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://{dominio}/pagina</loc>
    <lastmod>2026-05-23</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
```

## Core Web Vitals per SEO

| Metrica | Target | Tool |
|---|---|---|
| LCP (Largest Contentful Paint) | < 2.5s | Lighthouse, CrUX |
| INP (Interaction to Next Paint) | < 200ms | Lighthouse, CrUX |
| CLS (Cumulative Layout Shift) | < 0.1 | Lighthouse, CrUX |

```bash
npx lighthouse http://localhost:3000 --quiet --output=json | ConvertFrom-Json | Select-Object -ExpandProperty categories.seo
```

## SEO Checklist per ogni pagina

- [ ] Title unico (50-60 caratteri)
- [ ] Meta description unica (max 160 caratteri)
- [ ] URL pulito senza parametri (es. /prodotti, non /page.php?id=1)
- [ ] Heading strutturati: una H1, poi H2, H3 in gerarchia
- [ ] Immagini con alt text descrittivo
- [ ] Internal link verso pagine correlate
- [ ] Canonical URL presente
- [ ] Open Graph e Twitter Card presenti
- [ ] Structured data presente (almeno WebSite)
- [ ] Pagina inclusa in sitemap.xml
- [ ] Non bloccata da robots.txt
- [ ] Core Web Vitals nei target
- [ ] Mobile friendly (test: Google Mobile-Friendly Test)

## SEO audit — Lighthouse

```bash
npx lighthouse http://localhost:3000 --quiet --output=json --preset=desktop
```

Score SEO target: ≥ 90

## Heartbeat — Stato agente

Per mantenere aggiornata la dashboard di Tabularium, all'inizio di ogni task invia:
```
tabularium_agent_status agent="plinioilvecchio-seo" status="busy" current_task="breve descrizione"
```

Al termine del task (prima di aggiornare progress.md):
```
tabularium_agent_status agent="plinioilvecchio-seo" status="idle"
```

Questo permette alla dashboard di mostrare in tempo reale chi sta lavorando e su cosa.

## Progress tracking

Dopo ogni intervento SEO, usa il dual-write pattern:
1. Scrivi entry dettagliata in `progress/YYYY-MM-DD.md` (fs_append)
2. Aggiungi riga di riepilogo in `progress.md` (fs_edit)

Template entry (`progress/YYYY-MM-DD.md`):
```
### {timestamp} | plinioilvecchio-seo
- Attività: {meta tags / JSON-LD / robots / sitemap / audit}
- Pagine coinvolte: {N}
- Lighthouse SEO score: {N}/100
- Raccomandazioni: {N}
- Step monitorati: [✅/⚠️] (se step limit → resume packet con task_id)
```
