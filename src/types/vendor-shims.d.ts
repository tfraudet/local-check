declare module 'polygon-lookup' {
  interface LookupResult {
    features: Array<{ properties: Record<string, unknown> }>;
  }
  export default class PolygonLookup {
    constructor(featureCollection: unknown);
    search(lon: number, lat: number, limit?: number): LookupResult | undefined;
  }
}

declare module '@geo-maps/countries-land-10km/map.geo.json' {
  const featureCollection: unknown;
  export default featureCollection;
}
