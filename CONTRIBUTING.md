# Contribuir a MasOnline Turbo

Gracias por ayudar a mejorar el proyecto. Antes de comenzar, abre un issue para
describir el problema, la versión de Edge/Chrome y una forma reproducible de
observarlo.

## Entorno y comprobaciones

Se requiere Node.js 20 o posterior. La suite principal no instala dependencias:

```bash
npm test
npm run check
```

Las pruebas de navegador requieren Playwright y Chromium disponibles localmente:

```bash
npm run test:browser
```

`npm run audit:live` abre el catálogo público en un perfil temporal. No debe
modificarse para agregar productos, iniciar sesión o alterar carritos reales.

## Criterios para cambios

- Mantener mutaciones, autenticación, carrito y checkout fuera de respuestas
  sintéticas.
- Usar una lista cerrada de operaciones de lectura conocidas.
- Incorporar una regresión cuando se corrige una carrera o incompatibilidad.
- No incluir capturas con datos personales, cookies, tokens o cuerpos sensibles.
- Actualizar `CHANGELOG.md` y la versión cuando cambie el paquete distribuible.

Las contribuciones aceptadas se publican bajo la licencia del repositorio. Al
enviar una contribución declaras que tienes derecho a hacerlo. Consulta
[LICENSE](LICENSE) y [LICENSE-ES.md](LICENSE-ES.md) antes de abrir el cambio.
