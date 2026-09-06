# Botón + al volver hacia arriba — corrección 0.4.1

## Causas verificadas

La auditoría del catálogo público confirmó que Apollo envía `AbortSignal` en las
consultas GraphQL, incluidas `itemsWithSimulation` y `ProductQuery`. La versión
0.4.0 las desviaba directamente a la red, sin leer ni llenar la caché. La prueba
original usaba peticiones sin señal y por eso no detectó la regresión.

Además, las consultas reales de VTEX incluyen `variables={}` y las variables
codificadas dentro de `extensions.variables`. La condición que excluía cualquier
parámetro `variables` impedía agrupar este formato válido.

Se corrigió también la invalidación causada por lecturas GET del carrito: esas
consultas no son mutaciones y no deben vaciar la caché de las tarjetas.

## Corrección

Cada consulta compartida tiene su propio controlador de red y una lista de
consumidores. Cada tarjeta conserva su propia señal de cancelación. Salir de la
pantalla cancela solo ese consumidor; la red se cancela cuando no queda ninguno.
Al volver, la nueva tarjeta puede usar una respuesta vigente aunque tenga otra
señal. Si la respuesta ya se entregó, la señal sigue pudiendo cancelar la lectura
de su cuerpo sin afectar a otros consumidores.

No se agregan botones artificiales ni se fuerzan estados de stock: la web sigue
renderizando su botón con sus respuestas comerciales.

## Validación

- 48 pruebas de unidad/integración, incluidas cancelaciones antes de enviar el
  lote, durante el lote, después de recibir headers y al volver a montar tarjetas.
- Chromium con extensión MV3 real y fixture con Request, AbortSignal y
  `variables={}`: 36 tarjetas → una consulta; al remontarlas reaparecen los
  36 botones sin nuevas llamadas.
- Navegación real de `https://www.masonline.com.ar/cif?_q=cif&map=ft` en perfil
  limpio: se cargaron 42 tarjetas mediante Mostrar más. Al volver arriba, las
  ocho tarjetas visibles tenían +; cero consultas adicionales de simulación
  durante el regreso. La espera medida del primer + después de desplazar la
  vista fue de 235 ms en esa ejecución, no una garantía de latencia.

No se reprodujo exactamente la sesión de Edge ni la región del usuario. No se
agregaron productos ni se modificó su carrito. La caché comercial sigue teniendo
TTL e invalidación por cambios de contexto; al expirar, se consulta la tienda.

Repetir: `npm test`, `npm run test:browser`, `npm run audit:live`.
