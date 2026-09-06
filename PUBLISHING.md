# Publicación de MasOnline Turbo 0.4.2

## Archivos que se entregan

- `release/masonline-turbo-0.4.2.zip`: extensión lista para cargar.
- `release/masonline-turbo-submission-kit-0.4.2.zip`: textos, imágenes,
  política de privacidad, notas y checklist para completar las fichas.
- Los archivos `.sha256` permiten comprobar que los ZIP no cambiaron.

## Antes de cargarla

1. Publicar `docs/` en HTTPS con GitHub Pages y comprobar que las
   URLs de privacidad y soporte son públicas sin iniciar sesión.
2. Ejecutar las pruebas manuales de `store-assets/SUBMISSION-CHECKLIST.md` en
   las versiones estables de Edge y Chrome.
3. Si se modifica código o el manifiesto, incrementar la versión y volver a
   ejecutar `npm run test:browser`, `npm run assets` y `npm run release`.
   El empaquetado ejecuta tests y validación sintáctica y genera ambos ZIP.

## Microsoft Edge Add-ons

1. Crear la extensión en Partner Center y cargar
   `release/masonline-turbo-0.4.2.zip`.
2. Copiar título, resumen y descripción desde `store-assets/LISTING-es.md`.
3. Cargar `logo-300.png`, `screenshot-1280x800.png`,
   `promo-small-440x280.png` y `promo-large-1400x560.png` según los campos que
   muestre el formulario.
4. Usar las respuestas de permisos y certificación de
   `store-assets/CERTIFICATION-NOTES.md`.
5. Indicar las URLs HTTPS de privacidad y soporte, elegir mercados, guardar el
   borrador y enviarlo a certificación.

## Chrome Web Store

1. Crear un nuevo elemento en el Developer Dashboard y cargar el mismo ZIP de
   la extensión.
2. Completar la ficha con `store-assets/LISTING-es.md` y, si se publica en
   inglés, `store-assets/LISTING-en.md`.
3. Cargar el icono de 128 px, la captura y los mosaicos preparados.
4. Declarar el propósito único, justificar `storage` y el acceso limitado a
   MasOnline, y responder la sección de tratamiento de datos de acuerdo con
   `PRIVACY.md` y `store-assets/CERTIFICATION-NOTES.md`.
5. Indicar la URL pública de privacidad y enviar a revisión.

MasOnline Turbo es una extensión independiente. No debe presentarse como un
producto oficial de MasOnline, ChangoMás ni de sus propietarios.
