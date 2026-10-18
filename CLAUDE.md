# CLAUDE.md — contexto para editar este proyecto

## Qué es
App de estudio personal de Nico para el Máster Universitario en Prevención de Riesgos Laborales (Universidad Nebrija, oct 2026 – jun 2027). Se estudia asignatura a asignatura y tema a tema. Hay 6 asignaturas; la 1 ("Fundamentos de las técnicas de mejora de las condiciones de trabajo y ámbito jurídico de la prevención") tiene cargados del T1 al T10.

Se publica en GitHub Pages y se usa en el móvil y el ordenador.

## Reglas del proyecto
- Toda la interfaz va en **español de España**, tuteando, con frases cortas.
- **Sitio estático sin compilación**: HTML, CSS y JavaScript sin frameworks. No añadas npm, bundlers ni React. Sin librerías externas (solo las fuentes de Google Fonts).
- **Simple a propósito**. Desde el 18-10-2026, a petición de Nico (documento de auditoría, Fase 1 y 2), sí se guardan el test a medias, el cuaderno de fallos y el historial de tests con estadísticas. Sin sin tarjetas, sin sincronización entre dispositivos y sin IA dentro de la app (ni clave de API, ni añadir temas, ni importar). No los vuelvas a añadir sin que Nico lo pida.
- **Temas nuevos**: los prepara Claude Code en el chat a partir de los PDF de `Desktop\Máster PRL\<asignatura>\Temario` y `Autoevaluaciones`, y van en `data/seed.json`.
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
  - **Dónde está en los apuntes** (`src`): cada pregunta del seed lleva `{pg, sec}` y `t` si se explica en otro tema. `pg` es el número impreso al pie de la página del PDF (Nico estudia con los apuntes impresos; en T2 y T4 no coincide con la página del PDF; T8 lo lleva sin corchetes), y `sec` el apartado tal como aparece en el PDF. Al añadir un tema, calcúlalo buscando cada pregunta en el texto del PDF por páginas y revisa a mano las dudosas.
- El repositorio es público: no subas claves ni el texto íntegro de los apuntes. **Nunca publiques los PDF originales de la Nebrija** (decisión de Nico). El 18-10-2026 se reescribió el historial para quitar el campo `source` (texto de los apuntes) de los primeros commits: no lo vuelvas a meter.
- La web y los apuntes llevan `<meta name="robots" content="noindex, nofollow">` para que no salgan en buscadores (los PDF no pueden llevarlo).
- **Apuntes visuales** (`apuntes/`): por cada tema, `<tid>-resumen` y `<tid>-memorizar`, en HTML y PDF, escritos a partir de los PDF del tema.
  - Las fuentes son `apuntes/src/<tid>-<tipo>.html`: solo las secciones, y en la primera línea `<!--{"pags": "3–13", "ud": 1}-->`. `python tools/apuntes.py [tid] --pdf` añade la cabecera (código, título y asignatura salen del seed) y saca el PDF con Chrome o Edge headless. Revisa el PDF antes de subirlo.
  - Estilo en `apuntes/apuntes.css`: `.sec` (cada una toma un color), `h2` con emoji y `.pg` (página impresa), `.box.clave` / `.box.ojo` / `.box.bien`, `table.t` dentro de `.tw`, `.cols` (`.c3`), `.card`, `.nums`/`.num`, `dl.defs`, `ol.tl`, `mark`, `.ref`. Pocos emojis y nada más nuevo que Emoji 12: Windows 10 pinta un cuadrado en el PDF (🪜, 🫁…).
  - Cada tema del seed lo anuncia con `apuntes: ["resumen", "memorizar"]`. La vista `doc` los muestra en un iframe (`?embed=1&theme=…`) que toma la altura del contenido, con botón de descarga del PDF.

## Arquitectura
- `storage.js` → `window.Store`. Es una mini base de documentos con rutas tipo Firestore, guardada solo en `localStorage` (`prl:db`). Los documentos tienen un número par de segmentos y las colecciones impar. Expone `Store.db.doc(path).get/set/update/delete/onSnapshot` y `Store.db.collection(path).onSnapshot`.
  - Al arrancar, `dropLegacy()` borra lo de versiones anteriores (progreso `data/…`, tarjetas y `prl:apikey`).
  - Guarda 150 ms después del último cambio y también al ocultar la app (`pagehide`, `visibilitychange`). Si `localStorage` falla (memoria llena), lanza el evento `prl:savefail` y la app muestra un aviso.
  - `Store.persist()` pide almacenamiento persistente (`navigator.storage.persist`); Ajustes muestra si está protegido.
  - Hoy ocupa unos 540 KB en `localStorage` con una asignatura. Antes de cargar la tercera, conviene pasar a IndexedDB (el límite ronda los 5 MB).
  - Después, `applySeed()` añade lo nuevo de `data/seed.json`: asignaturas y temas que no estaban y preguntas con `id` nuevo. Si una asignatura, un tema o un banco del seed traen un `rev` mayor que el guardado, se actualizan. En un banco solo se actualizan las preguntas que vienen del seed; las del usuario se quedan.
  - `meta/seed` guarda los ids ya añadidos para no resucitar lo que se borra. Para cambiar contenido ya publicado, sube el `rev`; para añadir preguntas, usa ids nuevos.
- `app.js`:
  - El estado está en `S`. Las vistas son funciones en `VIEWS.<nombre>` que devuelven HTML (escapa siempre con `esc()`).
  - Pantallas: `home` (una tarjeta por asignatura) → `subject` (temas, Practicar, Simular examen) → `topic` (Resumen, Recursos, Preguntas). La asignatura tiene dos pestañas: Temas y Apuntes. Además `doc` (visor de apuntes), `setup`, `run`, `result`, `gen`, `editq` y `settings` (solo copia de seguridad). La barra inferior tiene Inicio y Test.
  - `render()` repinta `#main`.
  - Hay delegación de eventos: `data-act="x"` → `A.x(el)`, `data-chg="x"` → `C.x(el)`, y los formularios se gestionan en el listener de `submit`.
  - Navegación con `go(vista, params, modo)` sobre la History API: cada pantalla es una entrada `{view, p, y}` con `#vista` en la URL; el botón Atrás del móvil vuelve a la anterior y recupera el scroll. `modo`: `"push"` (por defecto), `"replace"` o `false` (desde `popstate`). Ir a la misma pantalla con otra pestaña sustituye la entrada; `syncHistory()` guarda en la entrada los cambios sin navegar. `initNav()` restaura la pantalla al recargar (un test o un resultado se convierten en Test). El resultado sustituye al test en el historial.
  - Test a medias: `saveActiveRun()` guarda `S.run` en `prl:active_run` en cada render del test y al ocultar la app. Atrás durante un test lo deja en pausa; Inicio y Test muestran «Tienes un test a medias» (Continuar / Descartar). Al continuar no cuenta el tiempo de pausa (`startedAt` se desplaza). «Salir» del test lo descarta.
  - Cuaderno de fallos: documento `user/errors` del Store (`{items: {"tid/qid": {tid, qid, failedAt, streak}}}`, entra en la copia de seguridad). Al terminar un test, cada no acertada (también en blanco) pasa a `streak` 0 y cada acierto de una pendiente suma 1; con 2 sale del cuaderno. «Repasar mis fallos» en Test; vaciar en Ajustes.
  - Historial y estadísticas: documento `user/history` (`{items: [{date, mode, kind, nota, aciertos, fallos, blanco, total, sec, porTema: {tid: [aciertos, total]}}]}`, máx. 300, entra en la copia). `kind`: `test`, `fallos` (repaso del cuaderno) o `repetir`. La vista `stats` (pestaña Progreso de la barra inferior) muestra tests, nota media, % de aciertos, barras de las 10 últimas notas, aciertos por asignatura y por tema (el más flojo arriba) y los últimos tests. Media, gráfico y aciertos solo cuentan `kind: "test"`. Se borra en Ajustes.
  - Las escrituras se encolan por documento con `guarded(key, fn)` y `enqueue`.
  - Además de los datos, se recuerdan las preferencias del test (`prl:setup`), el tema (`prl:theme`) y el test a medias (`prl:active_run`).
  - Barra inferior: Inicio, Test y Progreso.
  - Generador de preguntas sin IA (`genCandidates`): saca preguntas de los recursos (relaciona en los dos sentidos, clasifica, año y «qué va justo después» en los ordena) y de las referencias legales del resumen (`REF_LEGAL`). `genPool` quita las que ya están en el banco; se guardan con `origin:"auto"`.

## Modelo de datos
- `subjects/<sid>`: `{name, short, order}`. Las 6 asignaturas del máster (`a1`…`a6`) vienen en `seed.subjects` y existen aunque no tengan temas. `subjects()` en `app.js` las devuelve en orden con sus temas, y añade al final las que solo aparezcan en algún tema. Los códigos de tema (`T1`, `T2`…) se numeran dentro de cada asignatura.
- `topics/<tid>`:
  - Asignatura: `{subject, subjectName, subjectShort}` (copia de la asignatura, para mostrarla sin buscarla).
  - Identificación: `{code: "T1", title, order, createdAt}`. Si tiene apuntes visuales: `apuntes: ["resumen", "memorizar"]`.
  - Contenido:
    - `summary: [{h, keys:[{r, t, src?}], trap}]` (`src` solo en las claves con referencia legal, que son las que usa el generador).
    - `resources: [...]`, de tres tipos:
      - `{type:"match", title, pairs:[[a,b]], src:[]}`
      - `{type:"classify", title, categories:[], items:[[texto, índiceCategoría]], src:[]}`
      - `{type:"order", title, items:[[hecho, detalle]], src:[]}` en el orden correcto.
      - `src` va en paralelo a `pairs`/`items` (`{pg, sec}` o `null`); el generador lo copia a las preguntas que crea.
- `banks/<tid>`: `{rev?, questions:[{id, q, opts:[], a, exp, diff:"facil|media|dificil", origin:"oficial|claude|auto|propia", src?:{t?, pg, sec}, check?}]}`. `whereHTML()` en `app.js` lo pinta al corregir y en el repaso.

## Service worker
`sw.js` va primero a la red, pero si hay copia y la red tarda más de 3 s (`TIMEOUT`), contesta con la copia; durante los 30 s siguientes contesta con la copia sin esperar y la red la actualiza por detrás. Sin conexión, la copia. Sube `CACHE` cada vez que cambies archivos que cachea.

## Probar
`python3 -m http.server 8000` y abre `http://localhost:8000`. Tras cambiar archivos que cachea el service worker, sube la versión de `CACHE` en `sw.js` para que los móviles reciban la nueva versión.
