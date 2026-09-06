# MasOnline Turbo

![Versión](https://img.shields.io/badge/versión-0.4.2-08723c)
![Manifest](https://img.shields.io/badge/Manifest-V3-08723c)
![Licencia](https://img.shields.io/badge/licencia-source--available-f08c00)

Extensión independiente para Microsoft Edge y Google Chrome que reduce consultas
redundantes durante la navegación del catálogo de
[masonline.com.ar](https://www.masonline.com.ar/).

[Descargar la última versión](https://github.com/franmelx/Mas-Online-Turbo/releases/latest) ·
[Privacidad](https://franmelx.github.io/Mas-Online-Turbo/privacy.html) ·
[Soporte](https://franmelx.github.io/Mas-Online-Turbo/support.html)

![Vista de MasOnline Turbo](store-assets/screenshot-1280x800.png)

> MasOnline Turbo no está afiliada, patrocinada ni respaldada por MasOnline,
> ChangoMás, GDN Argentina o VTEX. Las marcas pertenecen a sus titulares.

## El problema

El catálogo está construido sobre VTEX IO y divide la información de cada tarjeta
entre varias consultas. Al buscar, aplicar filtros, pulsar **Mostrar más** o volver
a productos anteriores durante el scroll, los componentes se desmontan y vuelven
a crearse. Ese ciclo puede solicitar otra vez stock, precio, impuestos, datos del
producto y destacados.

El caso más costoso observado es `itemsWithSimulation`: muchas tarjetas generan
una consulta individual para obtener disponibilidad y oferta comercial. Es una
variante de N+1 en el cliente: una consulta carga la lista y luego aparecen N
consultas adicionales, una por tarjeta o grupo pequeño. Mientras la simulación
no responde, la tienda puede mantener oculto el botón **+**.

La página también crea nuevas señales de cancelación cuando una tarjeta reaparece.
Una caché que ignore esas señales puede romper la interfaz; una que descarte todas
las solicitudes cancelables pierde la mejora y vuelve a consultar la red. La
extensión resuelve ambos casos mediante consumidores independientes sobre una
misma consulta compartida.

## Qué hace la extensión

MasOnline Turbo instala un interceptor de `window.fetch` al comienzo de la carga.
Solo reconoce una lista cerrada de lecturas conocidas del dominio de MasOnline.
Las solicitudes desconocidas continúan directamente hacia la tienda.

| Área | Estrategia |
| --- | --- |
| Consultas idénticas simultáneas | Una llamada de red compartida; cada consumidor recibe su propia `Response`. |
| `itemsWithSimulation` | Agrupa hasta 40 SKU compatibles en una llamada y reparte los resultados validados. |
| Scroll y remontaje de tarjetas | Reutiliza fragmentos recientes por variables, contexto y vendedor. |
| `GetPriceWithoutTax` | Guarda fragmentos confirmados por SKU, producto, precio y contexto. |
| Cancelación de Apollo | Cada tarjeta conserva su `AbortSignal`; la red se cancela cuando ya no quedan consumidores. |
| Cambio de región o sesión | Descarta inmediatamente datos del contexto anterior. |
| Escrituras del carrito | Invalida antes y después y deja pasar la red durante la transición. |
| Errores o formatos inesperados | Devuelve la respuesta de la tienda y evita cachear el error. |

La extensión no crea productos, no fuerza el botón **+**, no cambia precios y no
simula mutaciones. MasOnline continúa siendo la fuente de verdad.

## Operaciones tratadas

Las lecturas reconocidas incluyen:

- `productSearchV3` y `productSuggestions`;
- `itemsWithSimulation`;
- `ProductQuery` y `productsByIdentifier`;
- `CustomHighlightsProductClusters`;
- `GetPriceWithoutTax`;
- `facetsV2`, `SearchMetadataV2` y `banners`.

Las sesiones, autenticación, mutaciones del carrito, pagos y checkout no reciben
respuestas sintéticas. Las sesiones siempre consultan la red. Una lectura GET del
carrito tampoco borra innecesariamente la caché del catálogo.

## Límites de seguridad y memoria

- Presupuesto estimado de caché: 16 MiB por pestaña.
- Máximo de 200 respuestas completas, cada una de hasta 2 MiB.
- Máximo de 1000 entradas por caché fragmentada o índice experimental.
- Lotes de hasta 40 SKU y URLs de hasta 8000 caracteres.
- Recuperación con solicitudes originales si un lote no responde en ocho segundos.
- Caché rechazada para errores HTTP/GraphQL, respuestas `private`, `no-store`,
  `no-cache`, `Vary: *`, rangos, autorización o modos explícitos de recarga.
- Invalidación por generación para impedir que una respuesta vieja en vuelo vuelva
  a llenar una caché después de cambiar el carrito, la sesión o la región.

Los TTL son deliberadamente breves y varían por operación. El usuario puede vaciar
caché y métricas desde el panel.

## Modo estable y modo experimental

El modo estable activa deduplicación, caché de respuestas conocidas y agrupación
de simulaciones. Es la configuración predeterminada.

El modo experimental puede construir localmente respuestas parciales de
`ProductQuery`, destacados y simulación usando productos observados. Está apagado
al instalar y vuelve a apagarse después de cada actualización. Se conserva para
investigación y no es necesario para obtener la mejora principal.

## Métricas y privacidad

El panel muestra solicitudes observadas, llamadas de red, duplicados evitados,
aciertos de caché, respuestas locales, productos indexados y recuperaciones por
red. Los contadores se separan por pestaña y se guardan como máximo una vez por
segundo mediante `chrome.storage.session`.

No existe un servidor del desarrollador ni telemetría externa. El catálogo se
procesa temporalmente en memoria. Las preferencias quedan en el almacenamiento
local del navegador. Consulta la [política de privacidad](PRIVACY.md).

## Instalación para probarla

1. Descarga el código o clona el repositorio.
2. Abre `edge://extensions` o `chrome://extensions`.
3. Activa **Modo de desarrollador**.
4. Pulsa **Cargar extensión sin empaquetar**.
5. Selecciona la carpeta del proyecto.
6. Abre o recarga una pestaña de MasOnline.

Después de una actualización local, pulsa **Recargar** en la página de extensiones
y luego recarga MasOnline. El panel debe mostrar la misma versión del manifiesto.

## Desarrollo y pruebas

Se requiere Node.js 20 o posterior.

```bash
npm test
npm run check
```

Las pruebas de navegador requieren Playwright y Chromium disponibles localmente:

```bash
npm run test:browser
```

La suite cubre concurrencia, expiración, límite de memoria, cambios de región,
mutaciones lentas, errores de red, señales canceladas y lotes incompletos. La
prueba MV3 usa un perfil temporal y respuestas simuladas: 36 tarjetas generan una
llamada; al remontarlas, los 36 botones reaparecen sin llamadas adicionales.

La auditoría pública abre una búsqueda de Cif, pulsa **Mostrar más**, desplaza la
vista y regresa al comienzo. No inicia sesión ni modifica el carrito:

```bash
npm run audit:live
```

Una ejecución registrada en la versión 0.4.1 cargó 42 tarjetas; al regresar, las
ocho visibles mostraron **+** y no hubo nuevas consultas de simulación durante el
retorno. Es una observación reproducible, no una promesa de latencia. El diagnóstico
está documentado en [docs/scroll-fix-0.4.1.md](docs/scroll-fix-0.4.1.md).

## Crear una distribución

```bash
npm run assets
npm run release
```

El proceso verifica versión y Manifest V3, ejecuta pruebas y análisis sintáctico,
crea el ZIP de extensión y el kit de tienda, prueba ambos archivos y genera sus
SHA-256. Requiere `bsdtar` o `zip`, además de `unzip` y `sha256sum`. Los entregables
quedan en `release/`, carpeta excluida del historial Git.

Los textos, imágenes y respuestas de certificación están en `store-assets/`. La
guía completa para Edge Add-ons y Chrome Web Store está en [PUBLISHING.md](PUBLISHING.md).

## Estructura

```text
src/core.js             utilidades puras y adaptadores de respuesta
src/main.js             interceptor, cachés, lotes e invalidación
src/content.js          puente aislado entre la página y la extensión
src/service-worker.js   preferencias y métricas por pestaña
src/popup.*             panel y controles
tests/                  regresiones unitarias y de concurrencia
scripts/                auditoría, prueba MV3, recursos y empaquetado
docs/                   privacidad, soporte y diagnósticos
store-assets/           ficha e imágenes para las tiendas
```

## Contribuciones

Los reportes y cambios son bienvenidos. No incluyas cookies, direcciones, tokens,
checkout ni datos del carrito en capturas o issues. Lee [CONTRIBUTING.md](CONTRIBUTING.md)
y [SECURITY.md](SECURITY.md) antes de enviar información.

## Licencia

Copyright © 2026 Franco Melo.

El código se publica bajo **MasOnline Turbo Source-Available License 1.0**. Permite
uso personal, educativo, de evaluación, investigación no comercial y proyectos
completamente abiertos que conserven la licencia y atribución.

El uso que genere beneficio económico directo o indirecto requiere una licencia
comercial escrita y paga. El uso por sistemas de IA —entrenamiento, datasets,
embeddings, RAG, contexto o generación basada en este código— requiere autorización,
salvo la excepción estricta para proyectos completamente abiertos y no comerciales.

Lee el texto vinculante en [LICENSE](LICENSE) y el [resumen en español](LICENSE-ES.md).
Esta es una licencia *source available* y no una licencia open source aprobada por
la OSI. Las plataformas de alojamiento pueden recibir derechos adicionales cuando
el titular acepta sus propios términos de servicio.
