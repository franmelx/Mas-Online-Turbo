const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("stableStringify ordena claves", () => {
  assert.equal(core.stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("decodifica variables VTEX en base64", () => {
  const encoded = Buffer.from(JSON.stringify({ sku: "173157" })).toString("base64");
  assert.deepEqual(core.decodeBase64Json(encoded), { sku: "173157" });
});

test("codifica y decodifica variables VTEX con caracteres Unicode", () => {
  const value = { items: [{ itemId: "10", name: "Lácteos" }] };
  assert.deepEqual(core.decodeBase64Json(core.encodeBase64Json(value)), value);
});

test("extrae operationName de GET y POST", () => {
  assert.equal(core.operationFrom("https://example.test/graphql?operationName=ProductQuery", ""), "ProductQuery");
  assert.equal(core.operationFrom("https://example.test/graphql", '{"operationName":"GetPriceWithoutTax"}'), "GetPriceWithoutTax");
});

test("no considera seguras las rutas de checkout", () => {
  assert.equal(core.isSafeRead("GET", "", "/api/checkout/pub/orderForm"), false);
  assert.equal(core.isSafeRead("GET", "ProductQuery", "/_v/segment/graphql/v1"), true);
});

test("no intercepta fetch GET desconocidos", () => {
  assert.equal(core.isSafeRead("GET", "", "/alguna-api/desconocida"), false);
  assert.equal(core.isSafeRead("GET", "", "/api/sessions"), false);
});

test("no usa el nombre de una operación para optimizar escrituras ni rutas ajenas a GraphQL", () => {
  assert.equal(core.isSafeRead("DELETE", "ProductQuery", "/_v/segment/graphql/v1"), false);
  assert.equal(core.isSafeRead("GET", "ProductQuery", "/api/sessions"), false);
});

test("normaliza orden de parámetros y variables sin eliminar argumentos", () => {
  const a = new URL("https://example.test/graphql?b=2&a=1");
  const b = new URL("https://example.test/graphql?a=1&b=2");
  a.searchParams.set("extensions", JSON.stringify({ variables: core.encodeBase64Json({ sku: "1", region: "AR" }) }));
  b.searchParams.set("extensions", JSON.stringify({ variables: core.encodeBase64Json({ region: "AR", sku: "1" }) }));
  assert.equal(core.canonicalUrl(a), core.canonicalUrl(b));
  b.searchParams.set("b", "3");
  assert.notEqual(core.canonicalUrl(a), core.canonicalUrl(b));
});

test("construye ProductQuery desde un producto indexado", () => {
  const response = core.makeProductQuery({
    brand: "Check",
    brandId: 1,
    categories: ["/Lácteos/Leches/"],
    productClusters: [{ id: "10", name: "Promo" }],
    priceRange: { sellingPrice: { highPrice: 100 } }
  });
  assert.deepEqual(response.data.product.categoryTree.map(category => category.name), ["Lácteos", "Leches"]);
  assert.equal(response.data.product.productClusters[0].id, "10");
});

test("construye itemsWithSimulation desde la oferta indexada", () => {
  const product = { items: [{ itemId: "10", sellers: [{ sellerId: "1", commertialOffer: {
    AvailableQuantity: 20, Price: 100, ListPrice: 120, PriceValidUntil: "2050-01-01", Installments: []
  } }] }] };
  const response = core.makeItemSimulation(
    { items: [{ itemId: "10", sellers: [{ sellerId: "1" }] }] },
    sku => sku === "10" ? product : null
  );
  assert.equal(response.data.itemsWithSimulation[0].sellers[0].commertialOffer.Price, 100);
});
