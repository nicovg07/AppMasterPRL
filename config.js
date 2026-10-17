// Configuración de la app.
// Todo lo que hay aquí es público (se sube a GitHub): no pongas nunca aquí tu clave de la API de Claude.
window.CONFIG = {
  // Modelos de Claude que usa la app (API de Anthropic).
  models: {
    default: "claude-sonnet-5-5", // generar preguntas y temas
    quick: "claude-haiku-5-5"     // explicaciones rápidas en los tests
  }
};
