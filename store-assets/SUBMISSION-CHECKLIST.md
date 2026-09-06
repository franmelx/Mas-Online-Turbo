# Checklist de publicación

## Bloqueantes que debe completar el propietario

- [x] Reemplazar el contacto pendiente en `PRIVACY.md`.
- [ ] Publicar `PRIVACY.md` en una URL HTTPS estable.
- [x] Crear o indicar una URL de soporte.
- [ ] Elegir el nombre público del desarrollador.
- [ ] Revisar disponibilidad por países.
- [ ] Crear las cuentas de Partner Center y Chrome Web Store.

## Paquete

- [x] Manifest V3 válido.
- [x] `manifest.json` en la raíz del ZIP.
- [x] Iconos 16, 32, 48 y 128 px.
- [x] Sin código remoto.
- [x] Permiso de host limitado a MasOnline.
- [x] Adaptadores experimentales desactivados tras instalación/actualización.
- [x] Tests y validación sintáctica aprobados.
- [x] Carga MV3 y puente de métricas verificados en Chromium con respuestas simuladas.
- [x] Carreras de carrito/región, cancelaciones y errores cubiertos por regresiones.

## Ficha

- [x] Nombre y descripción en español.
- [x] Nombre y descripción en inglés.
- [x] Declaración de finalidad única.
- [x] Justificación de permisos.
- [x] Notas de certificación.
- [x] Aviso de no afiliación.
- [x] Logo de 300 × 300.
- [x] Icono de tienda de 128 × 128.
- [x] Captura de 1280 × 800.
- [x] Tile pequeño de 440 × 280.
- [x] Tile grande de 1400 × 560.

## Pruebas manuales antes de enviar

- [ ] Búsqueda y autocompletado.
- [ ] Mostrar más y scroll repetido.
- [ ] Filtros y ordenamiento.
- [ ] Selección de región.
- [ ] Agregar, incrementar, reducir y quitar productos.
- [ ] Login y logout.
- [ ] Checkout sin interferencia.
- [ ] Edge Stable actualizado.
- [ ] Chrome Stable actualizado.

Las pruebas automáticas usan fixtures. No sustituyen las pruebas manuales anteriores
en producción. Los mosaicos promocionales muestran un ejemplo controlado, no una
promesa de reducción fija para todas las búsquedas.
