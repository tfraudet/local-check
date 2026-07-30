import { describe, expect, it } from 'vitest';
import {
  parseCup,
  parseCupLatitude,
  parseCupLongitude,
} from '../../src/domain/parseCup';

// ---------------------------------------------------------------------------
// Coordinate parsing
// ---------------------------------------------------------------------------

describe('parseCupLatitude', () => {
  it('parses north latitude', () => {
    expect(parseCupLatitude('4344.150N')).toBeCloseTo(43 + 44.15 / 60, 5);
  });

  it('parses south latitude (negative)', () => {
    const deg = parseCupLatitude('3300.000S');
    expect(deg).not.toBeNull();
    expect(deg!).toBeLessThan(0);
    expect(deg!).toBeCloseTo(-33, 1);
  });

  it('returns null for invalid format', () => {
    expect(parseCupLatitude('not-a-lat')).toBeNull();
    expect(parseCupLatitude('')).toBeNull();
    expect(parseCupLatitude('9999.000N')).toBeNull(); // > 90°
  });
});

describe('parseCupLongitude', () => {
  it('parses east longitude', () => {
    expect(parseCupLongitude('00604.020E')).toBeCloseTo(6 + 4.02 / 60, 5);
  });

  it('parses west longitude (negative)', () => {
    const deg = parseCupLongitude('07800.000W');
    expect(deg).not.toBeNull();
    expect(deg!).toBeLessThan(0);
  });

  it('returns null for invalid format', () => {
    expect(parseCupLongitude('bad')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full file parsing
// ---------------------------------------------------------------------------

const SAMPLE_CUP = `name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc
"Vinon Sur Verdon","VINON","FR",4344.150N,00604.020E,270m,2,,,,"Airfield {A}"
"Riez","RIEZ","FR",4349.500N,00607.170E,520m,5,,,,"Glider site {F}"
"Banon","BANON","FR",4403.700N,00538.100E,870m,4,,,,"Outlanding {D}"
`;

describe('parseCup', () => {
  it('parses a valid .cup file and returns zones', () => {
    const result = parseCup(SAMPLE_CUP);
    expect(result.ok).toBe(true);
    expect(result.zones.length).toBe(3);
  });

  it('sets isAirfield correctly from style code', () => {
    const result = parseCup(SAMPLE_CUP);
    const vinon = result.zones.find((z) => z.code === 'VINON');
    expect(vinon).toBeDefined();
    expect(vinon!.isAirfield).toBe(true);
  });

  it('maps difficulty tags to the simplified 4-level scale', () => {
    const result = parseCup(SAMPLE_CUP);
    const banon = result.zones.find((z) => z.code === 'BANON');
    expect(banon!.difficulty_level).toBe('red'); // {D}
    const riez = result.zones.find((z) => z.code === 'RIEZ');
    expect(riez!.difficulty_level).toBe('green'); // {F}
  });

  it('parses elevation with meters suffix', () => {
    const result = parseCup(SAMPLE_CUP);
    const vinon = result.zones.find((z) => z.code === 'VINON');
    expect(vinon!.elevationM).toBe(270);
  });

  it('deduplicates points within 250 m', () => {
    const cup = `name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc
"Alpha","A","FR",4344.000N,00604.000E,200m,4,,,,""
"AlphaDupe","AD","FR",4344.001N,00604.001E,200m,4,,,,"Dupe of Alpha {M}"
`;
    const result = parseCup(cup);
    // Should keep the entry with an explicit (non-green) difficulty level
    expect(result.zones.length).toBe(1);
    expect(result.zones[0].difficulty_level).toBe('orange');
  });

  it('reports parse errors for malformed rows', () => {
    const cup = `name,code,country,lat,lon,elev,style
"Bad",,,bad-lat,bad-lon,0m,4
`;
    const result = parseCup(cup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('handles feet elevation suffix', () => {
    const cup = `name,code,country,lat,lon,elev,style
"Heights","H","FR",4344.000N,00604.000E,1000ft,4
`;
    const result = parseCup(cup);
    expect(result.zones[0].elevationM).toBeCloseTo(304.8, 0);
  });

  it('stops parsing at task section', () => {
    const cup = `name,code,country,lat,lon,elev,style
"Alpha","A","FR",4344.000N,00604.000E,200m,4
-----Related Tasks-----
"ShouldNotParse","X","FR",4344.000N,00604.000E,200m,4
`;
    const result = parseCup(cup);
    expect(result.zones.length).toBe(1);
  });
});
