(function initTurboCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__MASONLINE_TURBO_CORE__ = api;
})(typeof window !== "undefined" ? window : globalThis, function createCore() {
  "use strict";

  const READ_OPERATIONS = new Set([
    "productSearchV3",
    "productSuggestions",
    "itemsWithSimulation",
    "ProductQuery",
    "productsByIdentifier",
    "CustomHighlightsProductClusters",
    "GetPriceWithoutTax",
    "facetsV2",
    "SearchMetadataV2",
    "banners"
  ]);

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function decodeBase64Json(encoded) {
    if (typeof encoded !== "string" || encoded.length > 100000) return null;
    try {
      const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const decode = typeof atob === "function"
        ? atob
        : input => Buffer.from(input, "base64").toString("binary");
      const binary = decode(normalized);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      return null;
    }
  }

  function encodeBase64Json(value) {
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encode = typeof btoa === "function"
      ? btoa
      : input => Buffer.from(input, "binary").toString("base64");
    return encode(binary);
  }

  function operationFrom(url, bodyText) {
    try {
      const operation = new URL(url).searchParams.get("operationName");
      if (operation) return operation;
    } catch (_) {}
    if (!bodyText) return "";
    try {
      const body = JSON.parse(bodyText);
      return typeof body.operationName === "string" ? body.operationName : "";
    } catch (_) {
      return "";
    }
  }

  function variablesFrom(url, bodyText) {
    let extensions;
    try {
      const raw = new URL(url).searchParams.get("extensions");
      if (raw) extensions = JSON.parse(raw);
    } catch (_) {}
    if (!extensions && bodyText) {
      try { extensions = JSON.parse(bodyText).extensions; } catch (_) {}
    }
    return decodeBase64Json(extensions && extensions.variables);
  }

  function categoryNames(paths) {
    const path = Array.isArray(paths) ? paths[0] : "";
    return String(path || "").split("/").filter(Boolean);
  }

  function contextKey(context) {
    return [
      context.bindingId || "none",
      context.salesChannel || "none",
      context.regionId || "none",
      [...(context.sellerIds || [])].sort().join(",") || "none",
      context.shippingOption || "none"
    ].join("|");
  }

  function isSafeRead(method, operation, pathname) {
    if (method !== "GET" && method !== "POST") return false;
    if (pathname.includes("/checkout/") || pathname.includes("/vtexid/")) return false;
    // Puede superar varios MiB. Se indexa desde un clon, pero no se copia para dedupe.
    if (operation === "productSearchV3") return false;
    if (operation) return /\/graphql(?:\/|$)/.test(pathname) && READ_OPERATIONS.has(operation);
    return method === "GET" && (
      pathname.startsWith("/api/dataentities/DF/") ||
      pathname.startsWith("/api/dataentities/CP/")
    );
  }

  function canonicalUrl(value) {
    const url = new URL(value);
    url.hash = "";
    for (const name of ["extensions", "variables"]) {
      const raw = url.searchParams.get(name);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (name === "extensions" && typeof parsed.variables === "string") {
          const variables = decodeBase64Json(parsed.variables);
          if (variables) parsed.variables = encodeBase64Json(JSON.parse(stableStringify(variables)));
        }
        url.searchParams.set(name, stableStringify(parsed));
      } catch (_) {}
    }
    url.searchParams.sort();
    return url.href;
  }

  function makeProductQuery(product) {
    if (!product) return null;
    return {
      data: {
        product: {
          brand: product.brand ?? null,
          brandId: product.brandId ?? null,
          categoryTree: categoryNames(product.categories).map(name => ({ name, __typename: "Category" })),
          productClusters: (product.productClusters || []).map(cluster => ({ id: cluster.id, __typename: "ProductClusters" })),
          priceRange: product.priceRange ?? null,
          __typename: "Product"
        }
      }
    };
  }

  function makeHighlights(product) {
    if (!product || !Array.isArray(product.productClusters)) return null;
    return {
      data: {
        product: {
          productClusters: product.productClusters.map(cluster => ({
            id: cluster.id,
            name: cluster.name,
            __typename: "ProductClusters"
          })),
          __typename: "Product"
        }
      }
    };
  }

  function makeItemSimulation(variables, productBySku) {
    if (!Array.isArray(variables?.items)) return null;
    const items = [];
    for (const requested of variables.items) {
      const product = productBySku(String(requested.itemId));
      const sku = product?.items?.find(item => String(item.itemId) === String(requested.itemId));
      if (!sku) return null;
      const requestedSellers = Array.isArray(requested.sellers) ? requested.sellers : [];
      const sellers = [];
      for (const requestedSeller of requestedSellers) {
        const seller = sku.sellers?.find(candidate => String(candidate.sellerId) === String(requestedSeller.sellerId));
        const offer = seller?.commertialOffer;
        if (!seller || !offer || typeof offer.AvailableQuantity !== "number" || typeof offer.Price !== "number") return null;
        sellers.push({
          sellerId: seller.sellerId,
          commertialOffer: {
            AvailableQuantity: offer.AvailableQuantity,
            Price: offer.Price,
            ListPrice: offer.ListPrice,
            PriceValidUntil: offer.PriceValidUntil,
            Installments: offer.Installments || [],
            __typename: "Offer"
          },
          __typename: "Seller"
        });
      }
      items.push({ itemId: sku.itemId, sellers, __typename: "SKU" });
    }
    return { data: { itemsWithSimulation: items } };
  }

  return {
    READ_OPERATIONS,
    stableStringify,
    hashString,
    decodeBase64Json,
    encodeBase64Json,
    operationFrom,
    variablesFrom,
    categoryNames,
    contextKey,
    isSafeRead,
    canonicalUrl,
    makeProductQuery,
    makeHighlights,
    makeItemSimulation
  };
});
