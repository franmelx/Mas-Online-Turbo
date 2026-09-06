# Notas para certificación

MasOnline Turbo funciona únicamente en `https://www.masonline.com.ar/*`.

## Prueba principal

1. Instalar la extensión y abrir `https://www.masonline.com.ar/`.
2. Buscar `leche`.
3. Abrir los resultados y pulsar `Mostrar más`.
4. Desplazarse hacia abajo y volver hacia arriba.
5. Abrir el popup para observar solicitudes deduplicadas, respuestas locales y productos indexados.
6. Aplicar el filtro `Lácteos`.

No se requiere una cuenta para probar la optimización del catálogo. Agregar productos al carrito puede requerir seleccionar una región o método de entrega según el comportamiento vigente del sitio.

## Seguridad y privacidad

- No existe servidor del desarrollador.
- No se transmite telemetría externa.
- No se incluye código remoto.
- Las respuestas sintéticas experimentales están desactivadas por defecto.
- Autenticación, mutaciones de carrito, checkout y pagos siempre usan la red sin sustitución.
- El permiso de host está limitado a un único dominio.

## Uso del mundo MAIN

El script se ejecuta en `MAIN` porque debe observar el `window.fetch` utilizado por el frontend VTEX. El código clasifica una lista cerrada de operaciones conocidas y usa fallback de red para cualquier solicitud desconocida.
