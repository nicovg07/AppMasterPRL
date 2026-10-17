# Estudio Máster PRL

App web para estudiar el Máster Universitario en Prevención de Riesgos Laborales (Universidad Nebrija) desde cualquier dispositivo. Se instala en el móvil como una app.

- **Inicio**: una tarjeta por asignatura. Dentro, sus temas y los botones para practicar o simular examen.
- **Resúmenes** por tema con las ideas clave y las trampas típicas del test.
- **Recursos interactivos**: relacionar, clasificar y ordenar.
- **Tests** con 4 opciones, como el examen final (las preguntas de la autoevaluación conservan las suyas):
  - Modo práctica: corrige al momento.
  - Modo examen: con tiempo y nota al final, con opción de restar fallos.
  - Puedes mezclar temas y asignaturas y elegir dificultad.
- **Claude**:
  - Genera más preguntas.
  - Explica los fallos.
  - Crea temas nuevos a partir de los apuntes en PDF y de la autoevaluación.

La app no guarda progreso: cada test empieza de cero y su resultado se ve al terminar.

Es un sitio estático (HTML, CSS y JavaScript sin compilar), así que funciona en GitHub Pages sin servidor.

## Puesta en marcha

### 1. Publicar
El repositorio debe ser **privado**, porque `data/seed.json` contiene el texto de los apuntes del máster.

- **Con GitHub Pro (gratis para estudiantes con GitHub Education)**: ve a **Settings → Pages → Build and deployment**, elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Estará en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.
- **Sin GitHub Pro**: conecta el repositorio privado a [Cloudflare Pages](https://pages.cloudflare.com) o [Netlify](https://www.netlify.com), que son gratis. No hay paso de compilación y la carpeta de salida es la raíz.

En ambos casos la web se publica: quien tenga el enlace puede abrirla, aunque no aparece en buscadores.

### 2. Instalar en el móvil
- **iPhone (Safari)**: Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome)**: menú ⋮ → *Instalar app*.

### 3. Conectar Claude (para generar contenido)
1. Crea una clave en [console.anthropic.com](https://console.anthropic.com) → *API Keys* y añade algo de crédito. La API se paga aparte de la suscripción de Claude.
2. En la app, abre **Ajustes** (rueda de arriba a la derecha), pega la clave y pulsa *Guardar y probar*.

La clave se guarda solo en ese navegador y nunca se sube al repositorio. Hay que ponerla una vez en cada dispositivo.

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
| `app.js` | Pantallas, tests y llamadas a Claude |
| `storage.js` | Guardado en el navegador y carga de `data/seed.json` |
| `ai.js` | Conexión con la API de Anthropic |
| `config.js` | Modelos de Claude |
| `data/seed.json` | Las 6 asignaturas y los temas preparados (asignatura 1, T1 a T10) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app y uso sin conexión |

Para añadir temas, usa *Añadir tema* dentro de una asignatura, o añádelos a `data/seed.json`. Al abrir la app se añade lo nuevo de ese archivo sin tocar lo que hayas creado o borrado. Lo que crees en la app se guarda solo en ese dispositivo; para llevarlo a otro, usa *Ajustes → Copia de seguridad*.
