# CLAUDE.md — contexto para editar este proyecto

## Qué es
App de estudio personal de Nico para el Máster Universitario en Prevención de Riesgos Laborales (Universidad Nebrija, oct 2026 – jun 2027). Se estudia asignatura a asignatura y tema a tema. Hay 6 asignaturas; la 1 ("Fundamentos de las técnicas de mejora de las condiciones de trabajo y ámbito jurídico de la prevención") tiene cargados del T1 al T10.

Se publica en GitHub Pages y se usa en el móvil y el ordenador.

## Reglas del proyecto
- Toda la interfaz va en **español de España**, tuteando, con frases cortas.
- **Sitio estático sin compilación**: HTML, CSS y JavaScript sin frameworks. No añadas npm, bundlers ni React. Las librerías externas se cargan por CDN con versión fija; ahora mismo solo pdf.js (cdnjs), bajo demanda.
- **Simple a propósito**: sin progreso guardado (ni estadísticas, ni historial, ni test a medias), sin tarjetas y sin sincronización entre dispositivos. No los vuelvas a añadir sin que Nico lo pida.
- **Diseño**: blanco y minimalista, poco texto e ideas clave visibles.
  - Azul de señal de obligación (`--accent`) para las acciones (botones, enlaces) y amarillo de seguridad (`--hi`, texto encima en `--hi-ink`) para los detalles: códigos de tema, franja de las tarjetas de asignatura, pestaña activa, barra inferior y barras de progreso.
  - Logo (calavera con casco) en `icons/`; portada de Inicio en `img/portada.webp`.
  - Botón de tema en la cabecera: sigue al sistema hasta que se pulsa y entonces guarda `prl:theme` (`light`/`dark`) y pone `data-theme` en `<html>`; un script en el `<head>` lo aplica antes de pintar.
  - Las referencias legales van en chips monoespaciados (`.ref`).
  - Todos los colores son tokens en `:root` de `styles.css`, con tema oscuro. No uses colores literales en componentes.
  - Tiene que funcionar a 400 px de ancho, sin scroll horizontal.
- **Contenido**: todo debe salir de los apuntes del máster, nada inventado.
  - Las preguntas tienen **4 opciones** y una correcta, como el examen final.
  - Las de la autoevaluación oficial (`origin:"oficial"`) se copian tal cual, con sus opciones (normalmente 3).
  - Los resúmenes se ordenan según cómo pregunta la autoevaluación de ese tema.
- Nunca guardes claves en el repositorio. La clave de Anthropic vive en `localStorage` (`prl:apikey`).

## Arquitectura
- `storage.js` → `window.Store`. Es una mini base de documentos con rutas tipo Firestore, guardada solo en `localStorage` (`prl:db`). Los documentos tienen un número par de segmentos y las colecciones impar. Expone `Store.db.doc(path).get/set/update/delete/onSnapshot` y `Store.db.collection(path).onSnapshot`.
  - Al arrancar, `dropLegacy()` borra lo de versiones anteriores (progreso `data/…` y tarjetas).
  - Después, `applySeed()` añade lo nuevo de `data/seed.json`: asignaturas y temas que no estaban y preguntas con `id` nuevo. Si una asignatura, un tema o un banco del seed traen un `rev` mayor que el guardado, se actualizan. En un banco solo se actualizan las preguntas que vienen del seed; las del usuario se quedan.
  - `meta/seed` guarda los ids ya añadidos para no resucitar lo que se borra. Para cambiar contenido ya publicado, sube el `rev`; para añadir preguntas, usa ids nuevos.
- `ai.js` → `window.AI`. Ofrece `AI.sample(prompt, opts)` → `{text}` y `AI.sample.json(prompt, opts)` → valor JSON.
  - Llama a `https://api.anthropic.com/v1/messages` desde el navegador, con la cabecera `anthropic-dangerous-direct-browser-access`.
  - `opts.modelTier: "quick"` usa `CONFIG.models.quick`.
  - Los errores llegan como `{code}`: `no_key`, `bad_key`, `no_credit`, `bad_model`, `rate_limited`, `overloaded` (5xx), `invalid_json`, `empty_completion`, `prompt_too_large`, `cancelled` o `upstream_error`. `sampleErr()` en `app.js` los traduce a mensajes.
- `app.js`:
  - El estado está en `S`. Las vistas son funciones en `VIEWS.<nombre>` que devuelven HTML (escapa siempre con `esc()`).
  - Pantallas: `home` (una tarjeta por asignatura) → `subject` (temas, Practicar, Simular examen) → `topic` (Resumen, Recursos, Preguntas). Además `setup`, `run`, `result`, `gen`, `newtopic`, `editq` y `settings`. La barra inferior tiene Inicio y Test.
  - `render()` repinta `#main`.
  - Hay delegación de eventos: `data-act="x"` → `A.x(el)`, `data-chg="x"` → `C.x(el)`, y los formularios se gestionan en el listener de `submit`.
  - Navegación con `go(vista, params)`.
  - Las escrituras se encolan por documento con `guarded(key, fn)` y `enqueue`.
  - Solo se recuerdan las preferencias del test (`prl:setup`), el tema (`prl:theme`) y la clave de API.

## Modelo de datos
- `subjects/<sid>`: `{name, short, order}`. Las 6 asignaturas del máster (`a1`…`a6`) vienen en `seed.subjects` y existen aunque no tengan temas. `subjects()` en `app.js` las devuelve en orden con sus temas, y añade al final las que solo aparezcan en algún tema. Los códigos de tema (`T1`, `T2`…) se numeran dentro de cada asignatura.
- `topics/<tid>`:
  - Asignatura: `{subject, subjectName, subjectShort}` (copia de la asignatura, para mostrarla sin buscarla).
  - Identificación: `{code: "T1", title, order, createdAt}`.
  - Contenido:
    - `summary: [{h, keys:[{r, t}], trap}]`.
    - `resources: [...]`, de tres tipos:
      - `{type:"match", title, pairs:[[a,b]]}`
      - `{type:"classify", title, categories:[], items:[[texto, índiceCategoría]]}`
      - `{type:"order", title, items:[[hecho, detalle]]}` en el orden correcto.
    - `source`: texto de los apuntes, que se usa para generar con Claude.
- `banks/<tid>`: `{rev?, questions:[{id, q, opts:[], a, exp, diff:"facil|media|dificil", origin:"oficial|claude|propia", check?}]}`.

## Probar
`python3 -m http.server 8000` y abre `http://localhost:8000`. Tras cambiar archivos que cachea el service worker, sube la versión de `CACHE` en `sw.js` para que los móviles reciban la nueva versión.
