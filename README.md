# Estudio Máster PRL

App web para estudiar el Máster Universitario en Prevención de Riesgos Laborales (Universidad Nebrija) desde cualquier dispositivo. Se instala en el móvil como una app.

- **Inicio**: una tarjeta por asignatura. Dentro, sus temas y los botones para practicar o simular examen.
- **Resúmenes** por tema con las ideas clave y las trampas típicas del test.
- **Recursos interactivos**: relacionar, clasificar y ordenar.
- **Tests** con 4 opciones, como el examen final (las preguntas de la autoevaluación conservan las suyas):
  - Modo práctica: corrige al momento, te explica por qué y te dice dónde está en tus apuntes impresos (tema, página y apartado).
  - Modo examen: con tiempo y nota al final, con opción de restar fallos. En el repaso, cada fallo lleva su explicación y su página.
  - Puedes mezclar temas y asignaturas y elegir dificultad.
- **Apuntes**: en cada asignatura, la pestaña *Apuntes* tiene el resumen visual de cada tema y una hoja con lo que hay que memorizar. Se ven dentro de la app y se descargan en PDF.
- **Generar preguntas**: en cada tema, la app crea preguntas nuevas con sus recursos y su resumen (sin IA ni conexión). También llevan su página.

La app no guarda progreso: cada test empieza de cero y su resultado se ve al terminar. Tiene modo claro y oscuro (botón de la cabecera).

Es un sitio estático (HTML, CSS y JavaScript sin compilar), así que funciona en GitHub Pages sin servidor.

## Puesta en marcha

### 1. Publicar
Está publicada con GitHub Pages desde la rama `main` (carpeta raíz) en https://nicovg07.github.io/AppMasterPRL/. Cada `git push` la actualiza en un minuto.

### 2. Instalar en el móvil
- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Instalar app*.

## Probar en local
```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Estructura
| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Diseño (colores y tipografías en `:root`) |
| `app.js` | Pantallas, tests y generador de preguntas |
| `storage.js` | Guardado en el navegador y carga de `data/seed.json` |
| `data/seed.json` | Las 6 asignaturas y los temas preparados (asignatura 1, T1 a T10) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app, uso sin conexión, favicon e iconos |
| `img/portada.webp` | Imagen de portada de Inicio |
| `apuntes/` | Resumen y «para memorizar» de cada tema, en HTML (para la app) y PDF (para descargar). Fuentes en `apuntes/src/` |
| `tools/apuntes.py` | Monta los apuntes y saca los PDF con Chrome o Edge: `python tools/apuntes.py --pdf` |

Los temas nuevos se añaden a `data/seed.json` (los prepara Claude Code a partir de los PDF). Al abrir la app se añade lo nuevo de ese archivo sin tocar lo que hayas creado o borrado. Lo que crees en la app (preguntas generadas o propias) se guarda solo en ese dispositivo; para llevarlo a otro, usa *Ajustes → Copia de seguridad*.
