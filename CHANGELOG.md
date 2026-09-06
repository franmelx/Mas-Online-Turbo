# 0.4.2

- Prepara la publicación del código con documentación completa del problema,
  arquitectura, instalación, pruebas, privacidad y distribución.
- Añade la licencia MasOnline Turbo Source-Available License 1.0, su resumen en
  español y el canal para solicitar licencias comerciales o permisos especiales.
- Incorpora guía de contribución, política de seguridad, plantilla de errores y
  CI para Node.js 22.
- Excluye los ZIP generados del historial; se entregan como artefactos de versión.
- Completa el contacto de soporte y las páginas preparadas para GitHub Pages.

# 0.4.1

- Corrige la regresión que excluía `AbortSignal`/`Request` de todas las optimizaciones,
  aunque Apollo los usa en las consultas de cada tarjeta de producto.
- Implementa suscriptores independientes para la consulta compartida: abortar una
  tarjeta no afecta a las demás; abortar todas cancela la red sin reintentos.
- Conserva la cancelación de lectura del cuerpo después de recibir los headers.
- Acepta `variables={}` de VTEX al agrupar; las variables estándar no vacías
  continúan pasando sin modificaciones.
- Reutiliza fragmentos de simulación también cuando se obtuvo una única consulta.
- Consultar el carrito por GET deja de invalidar las respuestas de catálogo.
- Pruebas con el formato VTEX real, señales por tarjeta y remontaje de botones.
- Auditoría de catálogo real: después de Mostrar más y volver arriba, ocho tarjetas
  visibles conservaron su botón + sin nuevas consultas de simulación durante el regreso.
  Perfil limpio, sin sesión de compra del usuario; no garantiza un tiempo fijo en otros contextos.

# 0.4.0

- Invalidación por generación: las respuestas iniciadas antes de vaciar caché,
  cambiar sesión/región o modificar el carrito no pueden guardar resultados viejos.
- Bypass durante toda la operación de carrito y cinco segundos tras terminar,
  incluyendo solicitudes sensibles de autenticación y checkout.
- Claves completas por parámetros, cuerpo, headers y opciones de fetch;
  normalización del orden JSON y de parámetros para deduplicar equivalentes.
- Cancelaciones independientes mediante paso nativo de requests con señal.
- Sin reintentos automáticos al fallar una lectura normal, ni caché de errores.
- Presupuesto global de caché, lectura limitada y menos copias del catálogo.
- Lotes acotados, timeout, conservación de variables extra y separación por
  vendedores; todas las respuestas se validan antes de repartirse.
- Se deduplican consultas repetidas mientras un lote está en vuelo.
- Métricas por pestaña mediante service worker, panel actualizado y controles
  experimentales dependientes del interruptor principal experimental.
- Pruebas de concurrencia y prueba de extensión MV3 en Chromium aislado.
- Empaquetado de extensión y kit en un comando, con checksums portables.

Las pruebas de navegador emplean fixtures: 36 consultas de tarjetas producen una
petición de red; repetirlas dentro del TTL no añade peticiones. No es una medición
de latencia ni una garantía de ahorro en la web de producción. La prueba manual
de búsqueda, filtros, carrito y checkout en Edge/Chrome sigue pendiente.
