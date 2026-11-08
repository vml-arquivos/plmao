/**
 * Segunda carga do Guia de veículos: mais marcas, modelos e versões, com a mesma regra da primeira carga.
 *
 *  - só entram números e itens que constavam na ficha da fonte; o que a fonte não trazia fica em branco (nunca estimado);
 *  - itens de série (ABS, controle de estabilidade, ar-condicionado...) não são assumidos: só aparecem quando a fonte os lista;
 *  - consumo, potência e torque são os da ficha (gasolina; a versão a etanol aparece no texto do motor quando a fonte informava);
 *  - elétricos e híbridos trazem bateria, autonomia e consumo elétrico quando a ficha informava;
 *  - cada modelo guarda a fonte e a data da conferência, e o site mostra isso ao cliente.
 */
import type { SeedModel, SeedVersion } from './vehicleSeed.js';

export const EXTRA_SEED_SOURCE = 'Fichas de referência de fabricante e Inmetro, conforme fichacompleta.com.br (consultado em 11/2026). Confirme itens de série e versões na concessionária.';

interface X {
  name: string; year: number; fuel?: string;
  engine: string; cc?: number; hp: number; kgfm?: number; trans: string; gears?: number; drive?: string;
  a100?: number; top?: number; cityG?: number; roadG?: number; cityE?: number; roadE?: number; cityD?: number; roadD?: number;
  tank?: number; len: number; wid: number; hei: number; wb: number; gc?: number; kg: number; trunk?: number; doors?: number; seats?: number; airbags?: number;
  cruise?: true; cam?: true; park?: true; media?: string; wheels?: string;
  battery?: number; range?: number; kwh100?: number;
}

function ver(x: X): SeedVersion {
  const s: Record<string, string | number | boolean> = {
    engine: x.engine, power_hp: x.hp, transmission: x.trans, drive: x.drive ?? 'Dianteira',
    length_mm: x.len, width_mm: x.wid, height_mm: x.hei, wheelbase_mm: x.wb, weight_kg: x.kg, seats: x.seats ?? 5
  };
  const opt: Array<[string, string | number | boolean | undefined]> = [
    ['displacement_cc', x.cc], ['torque_kgfm', x.kgfm], ['gears', x.gears], ['accel_0_100_s', x.a100], ['top_speed_kmh', x.top],
    ['cons_city_gas_kml', x.cityG], ['cons_road_gas_kml', x.roadG], ['cons_city_eth_kml', x.cityE], ['cons_road_eth_kml', x.roadE],
    ['cons_city_diesel_kml', x.cityD], ['cons_road_diesel_kml', x.roadD], ['tank_l', x.tank], ['ground_clearance_mm', x.gc],
    ['trunk_l', x.trunk], ['doors', x.doors], ['airbags', x.airbags], ['cruise_control', x.cruise], ['rear_camera', x.cam], ['parking_sensors', x.park],
    ['multimedia', x.media], ['wheels', x.wheels], ['battery_kwh', x.battery], ['range_km', x.range], ['cons_elec_kwh100', x.kwh100]
  ];
  for (const [k, v] of opt) if (v !== undefined) s[k] = v;
  return { name: x.name, yearModel: x.year, fuel: x.fuel ?? 'Flex', specs: s };
}

const m = (slug: string, brand: string, name: string, bodyType: string, versions: X[]): SeedModel => ({ slug, brand, name, vehicleType: 'CAR', bodyType, versions: versions.map(ver) });

const INT = 'Integral temporária';
const OND = 'Integral sob demanda';
const EA211_FLEX = '3 cilindros em linha, flex';

export const EXTRA_VEHICLE_SEED: SeedModel[] = [
  m('fiat-fastback', 'Fiat', 'Fastback', 'SUV', [
    { name: '1.0 Turbo', year: 2025, engine: 'GSE T200 1.0 turbo, 3 cilindros em linha, injeção direta, flex (etanol: 130 cv)', cc: 999, hp: 125, kgfm: 20.4, trans: 'CVT', gears: 7, a100: 9.4, top: 196, cityG: 11.9, roadG: 14.6, cityE: 8.4, roadE: 10.2, tank: 47, len: 4427, wid: 1774, hei: 1545, wb: 2533, gc: 192, kg: 1253, trunk: 516, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, computador de bordo e conta-giros', wheels: '205/50 R17' }
  ]),
  m('volkswagen-gol', 'Volkswagen', 'Gol', 'Hatch', [
    { name: 'Last Edition 1.0', year: 2023, engine: `1.0 EA211, ${EA211_FLEX}, injeção multiponto, aspirado (etanol: 84 cv e 10,4 kgfm)`, cc: 999, hp: 77, kgfm: 9.7, trans: 'Manual de 5 marchas', gears: 5, a100: 13.4, top: 164, cityG: 13.7, roadG: 15.2, cityE: 9.4, roadE: 10.7, tank: 55, len: 3892, wid: 1656, hei: 1475, wb: 2467, gc: 163, kg: 1009, trunk: 263, doors: 4, park: true, media: 'Rádio, Bluetooth, USB, CD player, GPS e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('volkswagen-saveiro', 'Volkswagen', 'Saveiro', 'Picape', [
    { name: 'Robust 1.6 CD', year: 2025, engine: '1.6 16V EA211, flex (etanol: 116 cv e 16,1 kgfm)', cc: 1598, hp: 106, kgfm: 15.4, trans: 'Manual de 5 marchas', gears: 5, a100: 10.1, top: 179, cityG: 11.3, roadG: 12.6, cityE: 7.8, roadE: 8.9, tank: 55, len: 4493, wid: 1721, hei: 1561, wb: 2752, gc: 196, kg: 1102, trunk: 580, doors: 2, cam: true, park: true, media: 'Conexão USB', wheels: '205/60 R15' }
  ]),
  m('volkswagen-taos', 'Volkswagen', 'Taos', 'SUV', [
    { name: 'Comfortline 1.4 TSI', year: 2025, engine: '1.4 TSI turbo (EA211), flex', cc: 1395, hp: 150, kgfm: 25.5, trans: 'Automático de 8 marchas', gears: 8, a100: 9.4, top: 195, cityG: 11.1, roadG: 13.3, cityE: 7.7, roadE: 9.3, tank: 51, len: 4461, wid: 1841, hei: 1626, wb: 2680, gc: 185, kg: 1420, trunk: 498, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e computador de bordo', wheels: 'Liga leve' }
  ]),
  m('volkswagen-amarok', 'Volkswagen', 'Amarok', 'Picape', [
    { name: 'Highline 3.0 V6', year: 2025, fuel: 'Diesel', engine: '3.0 V6 turbodiesel (EA897)', cc: 2967, hp: 258, kgfm: 59.1, trans: 'Automático de 8 marchas', gears: 8, drive: 'Integral permanente', a100: 8, top: 190, cityD: 8.7, roadD: 9.3, tank: 80, len: 5350, wid: 1954, hei: 1851, wb: 3097, gc: 245, kg: 2191, trunk: 1280, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, GPS e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('chevrolet-montana', 'Chevrolet', 'Montana', 'Picape', [
    { name: 'LTZ 1.2 Turbo', year: 2025, engine: '1.2 turbo 3 cilindros (CSS Prime), flex (etanol: 133 cv e 21,4 kgfm)', cc: 1199, hp: 132, kgfm: 19.4, trans: 'Automático de 6 marchas', gears: 6, a100: 10.1, top: 180, cityG: 11.1, roadG: 13.3, cityE: 7.7, roadE: 9.3, tank: 44, len: 4717, wid: 1798, hei: 1659, wb: 2800, gc: 192, kg: 1310, trunk: 874, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, roteador Wi-Fi e comandos pelo aplicativo', wheels: '215/55 R17' }
  ]),
  m('chevrolet-s10', 'Chevrolet', 'S10', 'Picape', [
    { name: 'LTZ 2.8 Turbodiesel 4x4 AT CD', year: 2025, fuel: 'Diesel', engine: '2.8 turbodiesel 4 cilindros (Duramax XLD28)', cc: 2776, hp: 207, kgfm: 52, trans: 'Automático de 8 marchas', gears: 8, drive: INT, a100: 9.4, top: 180, cityD: 9.5, roadD: 11.4, tank: 76, len: 5361, wid: 1874, hei: 1831, wb: 3096, gc: 225, kg: 2074, trunk: 1061, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e roteador Wi-Fi', wheels: 'Liga leve' },
    { name: 'High Country 2.8 Turbodiesel 4x4 AT CD', year: 2025, fuel: 'Diesel', engine: '2.8 turbodiesel 4 cilindros (Duramax XLD28)', cc: 2776, hp: 207, kgfm: 52, trans: 'Automático de 8 marchas', gears: 8, drive: INT, a100: 9.4, top: 180, cityD: 9.5, roadD: 11.4, tank: 76, len: 5408, wid: 1874, hei: 1831, wb: 3096, gc: 225, kg: 2106, trunk: 1061, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e roteador Wi-Fi', wheels: 'Liga leve' }
  ]),
  m('chevrolet-spin', 'Chevrolet', 'Spin', 'Minivan', [
    { name: 'Premier 1.8 AT', year: 2025, engine: '1.8 (Family I), flex (etanol: 111 cv e 17,7 kgfm)', cc: 1796, hp: 106, kgfm: 16.8, trans: 'Automático de 6 marchas', gears: 6, a100: 11, top: 170, cityG: 10.5, roadG: 13.4, cityE: 7.4, roadE: 9.3, tank: 53, len: 4420, wid: 1768, hei: 1699, wb: 2620, gc: 170, kg: 1292, trunk: 553, doors: 4, seats: 7, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e roteador Wi-Fi', wheels: 'Liga leve' }
  ]),
  m('toyota-corolla-cross', 'Toyota', 'Corolla Cross', 'SUV', [
    { name: 'XRE 2.0', year: 2025, engine: '2.0 (M20A-FKB), flex (etanol: 175 cv)', cc: 1987, hp: 167, kgfm: 20.8, trans: 'CVT', gears: 10, a100: 9.8, top: 195, cityG: 11.6, roadG: 13.3, cityE: 8.2, roadE: 9.3, tank: 47, len: 4460, wid: 1825, hei: 1620, wb: 2640, gc: 161, kg: 1420, trunk: 440, doors: 4, airbags: 6, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('toyota-yaris', 'Toyota', 'Yaris', 'Hatch', [
    { name: 'XL 1.5 AT', year: 2025, engine: '1.5 (2NR-FBE), flex (etanol: 110 cv e 14,9 kgfm)', cc: 1496, hp: 105, kgfm: 14.3, trans: 'CVT', gears: 7, a100: 11.8, top: 180, cityG: 12.2, roadG: 13.8, cityE: 8.9, roadE: 10, tank: 45, len: 4145, wid: 1730, hei: 1490, wb: 2550, gc: 150, kg: 1125, trunk: 310, doors: 4, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: '185/60 R15' }
  ]),
  m('toyota-yaris-sedan', 'Toyota', 'Yaris Sedan', 'Sedã', [
    { name: 'XL 1.5 AT', year: 2025, engine: '1.5 (2NR-FBE), flex (etanol: 110 cv e 14,9 kgfm)', cc: 1496, hp: 105, kgfm: 14.3, trans: 'CVT', gears: 7, a100: 11.8, top: 182, cityG: 12.7, roadG: 14.9, cityE: 9.2, roadE: 10.6, tank: 45, len: 4425, wid: 1730, hei: 1490, wb: 2550, gc: 150, kg: 1130, trunk: 473, doors: 4, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: '185/60 R15' }
  ]),
  m('toyota-sw4', 'Toyota', 'SW4', 'SUV', [
    { name: 'SRX Platinum 2.8', year: 2025, fuel: 'Diesel', engine: '2.8 turbodiesel 4 cilindros (1GD-FTV)', cc: 2755, hp: 204, kgfm: 50.9, trans: 'Automático de 6 marchas', gears: 6, drive: INT, a100: 11.8, top: 180, cityD: 9.8, roadD: 11.2, tank: 80, len: 4795, wid: 1855, hei: 1835, wb: 2745, gc: 279, kg: 2175, trunk: 500, seats: 7, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, GPS, TV digital, som JBL, carregador por indução e roteador Wi-Fi', wheels: 'Liga leve' }
  ]),
  m('honda-city', 'Honda', 'City', 'Sedã', [
    { name: 'EXL 1.5 AT', year: 2025, engine: '1.5 4 cilindros (L15B), flex (etanol: 126 cv e 15,8 kgfm)', cc: 1498, hp: 126, kgfm: 15.5, trans: 'CVT', gears: 7, a100: 10.6, top: 186, cityG: 12.8, roadG: 15.5, cityE: 9.3, roadE: 10.4, tank: 44, len: 4574, wid: 1748, hei: 1477, wb: 2600, gc: 144, kg: 1171, trunk: 519, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e comandos pelo aplicativo', wheels: 'Liga leve' }
  ]),
  m('honda-city-hatch', 'Honda', 'City Hatch', 'Hatch', [
    { name: 'EXL 1.5', year: 2025, engine: '1.5 4 cilindros (L15B), flex (etanol: 126 cv e 15,8 kgfm)', cc: 1498, hp: 126, kgfm: 15.5, trans: 'CVT', gears: 7, a100: 10.6, top: 186, cityG: 13.2, roadG: 15, cityE: 9.2, roadE: 10.5, tank: 39, len: 4343, wid: 1748, hei: 1498, wb: 2600, kg: 1184, trunk: 268, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e comandos pelo aplicativo', wheels: 'Liga leve' }
  ]),
  m('honda-wr-v', 'Honda', 'WR-V', 'SUV', [
    { name: 'EXL 1.5', year: 2026, engine: '1.5 4 cilindros (L15B), flex (etanol: 126 cv e 15,8 kgfm)', cc: 1498, hp: 126, kgfm: 15.5, trans: 'CVT', gears: 7, a100: 11.5, top: 175, cityG: 12, roadG: 14, cityE: 9, roadE: 10, tank: 40, len: 4312, wid: 1790, hei: 1650, wb: 2650, kg: 1259, trunk: 458, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e comandos pelo aplicativo', wheels: 'Liga leve' }
  ]),
  m('jeep-renegade', 'Jeep', 'Renegade', 'SUV', [
    { name: 'Longitude 1.3 Turbo', year: 2025, engine: '1.3 turbo 4 cilindros em linha (T270), flex (etanol: 185 cv e 27,5 kgfm)', cc: 1332, hp: 180, kgfm: 27.5, trans: 'Automático de 6 marchas', gears: 6, a100: 8.8, top: 209, cityG: 11, roadG: 12.8, cityE: 7.7, roadE: 9.1, tank: 55, len: 4268, wid: 1805, hei: 1702, wb: 2570, gc: 192, kg: 1476, trunk: 320, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, GPS, carregador por indução e leitura de placas de trânsito', wheels: '225/55 R18' },
    { name: 'Trailhawk 1.3 Turbo 4x4', year: 2025, engine: '1.3 turbo 4 cilindros em linha (T270), flex (etanol: 185 cv e 27,5 kgfm)', cc: 1332, hp: 180, kgfm: 27.5, trans: 'Automático de 9 marchas', gears: 9, drive: OND, a100: 9.7, top: 202, cityG: 9, roadG: 10.8, cityE: 6.4, roadE: 7.6, tank: 55, len: 4268, wid: 1805, hei: 1712, wb: 2570, gc: 201, kg: 1590, trunk: 314, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, GPS, carregador por indução, roteador Wi-Fi e leitura de placas de trânsito', wheels: 'Liga leve' }
  ]),
  m('jeep-commander', 'Jeep', 'Commander', 'SUV', [
    { name: 'Limited 1.3 Turbo', year: 2025, engine: '1.3 turbo 4 cilindros em linha (T270), flex (etanol: 185 cv e 27,5 kgfm)', cc: 1332, hp: 180, kgfm: 27.5, trans: 'Automático de 6 marchas', gears: 6, a100: 9.5, top: 202, cityG: 10, roadG: 11.4, cityE: 7, roadE: 8.2, tank: 61, len: 4769, wid: 1859, hei: 1682, wb: 2794, gc: 209, kg: 1685, trunk: 661, doors: 4, seats: 7, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, GPS, som Harman Kardon, roteador Wi-Fi e carregador por indução', wheels: 'Liga leve' }
  ]),
  m('nissan-kicks', 'Nissan', 'Kicks', 'SUV', [
    { name: 'Play Advance Plus 1.6', year: 2025, engine: '1.6 4 cilindros (HR16DE), flex (etanol: 113 cv e 15,2 kgfm)', cc: 1598, hp: 110, kgfm: 14.9, trans: 'CVT', gears: 7, a100: 11.8, top: 175, cityG: 11.3, roadG: 13.7, cityE: 7.8, roadE: 9.4, tank: 41, len: 4310, wid: 1760, hei: 1590, wb: 2610, gc: 200, kg: 1136, trunk: 432, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: '205/55 R17' }
  ]),
  m('nissan-versa', 'Nissan', 'Versa', 'Sedã', [
    { name: 'Advance 1.6', year: 2025, engine: '1.6 4 cilindros (HR16DE), flex (etanol: 113 cv e 15,3 kgfm)', cc: 1598, hp: 110, kgfm: 15.2, trans: 'CVT', gears: 6, a100: 10.7, top: 180, cityG: 11.8, roadG: 15, cityE: 8.1, roadE: 10.5, tank: 41, len: 4495, wid: 1740, hei: 1465, wb: 2620, gc: 138, kg: 1122, trunk: 482, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e carregador por indução', wheels: 'Liga leve' }
  ]),
  m('hyundai-hb20s', 'Hyundai', 'HB20S', 'Sedã', [
    { name: 'Comfort Plus 1.0', year: 2025, engine: '1.0 Kappa, flex (etanol: 80 cv e 10,2 kgfm)', cc: 998, hp: 75, kgfm: 9.4, trans: 'Manual de 5 marchas', gears: 5, a100: 14.5, top: 162, cityG: 13.2, roadG: 15, cityE: 9.4, roadE: 10.4, tank: 50, len: 4325, wid: 1720, hei: 1470, wb: 2530, gc: 160, kg: 1019, trunk: 475, doors: 4, cruise: true, cam: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: '185/60 R15' },
    { name: 'Comfort Plus Tech 1.0 Turbo AT', year: 2025, engine: '1.0 turbo Kappa, flex', cc: 998, hp: 120, kgfm: 17.5, trans: 'Automático de 6 marchas', gears: 6, a100: 10.7, top: 191, cityG: 11.7, roadG: 13.9, cityE: 8.3, roadE: 9.9, tank: 50, len: 4325, wid: 1720, hei: 1470, wb: 2530, gc: 160, kg: 1137, trunk: 475, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('renault-duster', 'Renault', 'Duster', 'SUV', [
    { name: 'Iconic Plus 1.3 Turbo', year: 2025, engine: '1.3 turbo (H5H), flex (etanol: 170 cv e 27,5 kgfm)', cc: 1332, hp: 162, kgfm: 27.5, trans: 'CVT', gears: 8, a100: 9.2, top: 190, cityG: 10.8, roadG: 11.5, cityE: 7.7, roadE: 8.4, tank: 46, len: 4376, wid: 1832, hei: 1693, wb: 2673, gc: 237, kg: 1353, trunk: 475, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e carregador por indução', wheels: 'Liga leve' }
  ]),
  m('renault-oroch', 'Renault', 'Oroch', 'Picape', [
    { name: 'Outsider 1.3 Turbo', year: 2025, engine: '1.3 turbo (H5H), flex (etanol: 170 cv e 27,5 kgfm)', cc: 1332, hp: 162, kgfm: 27.5, trans: 'CVT', gears: 8, a100: 9.8, top: 189, cityG: 10.5, roadG: 11, cityE: 7.4, roadE: 7.8, tank: 45, len: 4719, wid: 1834, hei: 1634, wb: 2829, gc: 212, kg: 1432, trunk: 683, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('renault-kardian', 'Renault', 'Kardian', 'SUV', [
    { name: 'Evolution 1.0 Turbo', year: 2025, engine: '1.0 turbo (HR10), flex (etanol: 125 cv e 22,4 kgfm)', cc: 999, hp: 120, kgfm: 20.4, trans: 'Manual de 6 marchas', gears: 6, a100: 11, top: 180, cityG: 12.4, roadG: 14.8, cityE: 8.6, roadE: 10.2, tank: 50, len: 4119, wid: 1747, hei: 1544, wb: 2604, gc: 209, kg: 1163, trunk: 358, airbags: 6, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: '205/60 R16' }
  ]),
  m('citroen-c3', 'Citroën', 'C3', 'Hatch', [
    { name: 'Feel 1.0', year: 2025, engine: '1.0 Firefly, flex (etanol: 75 cv e 10,7 kgfm)', cc: 999, hp: 71, kgfm: 10, trans: 'Manual de 5 marchas', gears: 5, a100: 14.1, top: 160, cityG: 13.2, roadG: 14.5, cityE: 9.3, roadE: 10.3, tank: 47, len: 3981, wid: 1733, hei: 1586, wb: 2540, gc: 180, kg: 1056, trunk: 315, cam: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('citroen-c3-aircross', 'Citroën', 'C3 Aircross', 'SUV', [
    { name: 'Feel Pack 1.0 Turbo', year: 2025, engine: '1.0 turbo (GSE T200), flex (etanol: 130 cv)', cc: 999, hp: 125, kgfm: 20.4, trans: 'CVT', gears: 7, a100: 9.7, top: 191, cityG: 10.6, roadG: 12, cityE: 7.4, roadE: 8.6, tank: 47, len: 4320, wid: 1720, hei: 1662, wb: 2675, gc: 200, kg: 1210, trunk: 493, doors: 4, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('peugeot-208', 'Peugeot', '208', 'Hatch', [
    { name: 'Active 1.0', year: 2025, engine: '1.0 Firefly, flex (etanol: 75 cv e 10,7 kgfm)', cc: 999, hp: 71, kgfm: 10, trans: 'Manual de 5 marchas', gears: 5, a100: 14.5, top: 164, cityG: 13.3, roadG: 15.8, cityE: 9.6, roadE: 11.1, tank: 47, len: 4055, wid: 1738, hei: 1453, wb: 2538, gc: 165, kg: 1060, trunk: 265, media: 'Rádio, Bluetooth, USB, espelhamento do celular e computador de bordo', wheels: '185/65 R15' },
    { name: 'GT 1.0 Turbo', year: 2025, engine: '1.0 turbo (T200), flex (etanol: 130 cv)', cc: 999, hp: 125, kgfm: 20.4, trans: 'CVT', gears: 7, a100: 9, top: 206, cityG: 12.5, roadG: 14.1, cityE: 8.8, roadE: 10, tank: 47, len: 4055, wid: 1738, hei: 1453, wb: 2538, gc: 165, kg: 1157, trunk: 265, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e leitura de placas de trânsito', wheels: 'Liga leve' }
  ]),
  m('peugeot-2008', 'Peugeot', '2008', 'SUV', [
    { name: 'Active 1.0 Turbo', year: 2025, engine: '1.0 turbo (T200), flex (etanol: 130 cv)', cc: 999, hp: 125, kgfm: 20.4, trans: 'CVT', gears: 7, a100: 10.1, top: 194, cityG: 12.3, roadG: 13.7, cityE: 8.6, roadE: 9.8, tank: 47, len: 4309, wid: 1776, hei: 1548, wb: 2612, gc: 230, kg: 1264, trunk: 374, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('byd-dolphin-mini', 'BYD', 'Dolphin Mini', 'Hatch', [
    { name: 'GS', year: 2025, fuel: 'Elétrico', engine: 'Motor elétrico, bateria de 38 kWh', hp: 75, kgfm: 13.8, trans: 'Automático de 1 marcha', gears: 1, a100: 14.9, top: 130, len: 3780, wid: 1715, hei: 1580, wb: 2500, gc: 110, kg: 1239, trunk: 230, cruise: true, cam: true, park: true, battery: 38, range: 280, kwh100: 9.6, media: 'Rádio, Bluetooth, USB, GPS, roteador Wi-Fi, carregador por indução e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('byd-dolphin', 'BYD', 'Dolphin', 'Hatch', [
    { name: 'EV', year: 2025, fuel: 'Elétrico', engine: 'Motor elétrico, bateria de 44,9 kWh', hp: 95, kgfm: 18.3, trans: 'Automático de 1 marcha', gears: 1, a100: 10.9, top: 160, len: 4125, wid: 1770, hei: 1570, wb: 2700, gc: 120, kg: 1405, trunk: 250, cruise: true, cam: true, park: true, battery: 44.9, range: 291, media: 'Rádio, Bluetooth, USB, GPS, roteador Wi-Fi e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('fiat-titano', 'Fiat', 'Titano', 'Picape', [
    { name: 'Volcano 2.2 Turbodiesel 4x4 AT', year: 2025, fuel: 'Diesel', engine: '2.2 turbodiesel (DW12)', cc: 2179, hp: 180, kgfm: 40.8, trans: 'Automático de 6 marchas', gears: 6, drive: INT, a100: 12.4, top: 175, cityD: 8.6, roadD: 9.3, tank: 80, len: 5330, wid: 1963, hei: 1858, wb: 3180, gc: 235, kg: 2097, trunk: 1109, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('fiat-fiorino', 'Fiat', 'Fiorino', 'Utilitário', [
    { name: 'Furgão Endurance 1.4', year: 2025, engine: '1.4 Fire, flex (etanol: 86 cv e 12,2 kgfm)', cc: 1368, hp: 84, kgfm: 11.8, trans: 'Manual de 5 marchas', gears: 5, a100: 13.7, top: 160, cityG: 11.7, roadG: 12.4, cityE: 8.1, roadE: 8.4, tank: 55, len: 4407, wid: 1643, hei: 1899, wb: 2716, gc: 176, kg: 1131, trunk: 3345, seats: 2, media: 'Computador de bordo e conta-giros', wheels: '175/70 R14' }
  ]),
  m('mitsubishi-l200-triton', 'Mitsubishi', 'L200 Triton', 'Picape', [
    { name: 'Sport GLS 2.4 Turbodiesel 4x4 AT', year: 2025, fuel: 'Diesel', engine: '2.4 turbodiesel (4N15)', cc: 2442, hp: 190, kgfm: 43.9, trans: 'Automático de 6 marchas', gears: 6, drive: INT, a100: 10.4, top: 190, cityD: 9.3, roadD: 10.3, tank: 76, len: 5300, wid: 1820, hei: 1795, wb: 3000, gc: 220, kg: 1895, doors: 4, media: 'Rádio, Bluetooth, USB, HDMI e espelhamento do celular', wheels: 'Liga leve' }
  ]),
  m('ford-maverick', 'Ford', 'Maverick', 'Picape', [
    { name: 'Lariat Hybrid 2.5 AWD', year: 2025, fuel: 'Híbrido', engine: '2.5 Duratec híbrido (motor a gasolina de 162 cv; 194 cv combinados)', cc: 2485, hp: 194, trans: 'Automático', drive: OND, a100: 8, top: 175, cityG: 15.7, roadG: 13.6, tank: 52, len: 5096, wid: 1844, hei: 1733, wb: 3077, gc: 204, kg: 1829, trunk: 943, doors: 4, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, GPS, som Bang & Olufsen, carregador por indução e comandos pelo aplicativo', wheels: 'Liga leve' }
  ]),
  m('gwm-haval-h6', 'GWM', 'Haval H6', 'SUV', [
    { name: '1.5 PHEV34', year: 2025, fuel: 'Híbrido plug-in', engine: '1.5 turbo (GW4B15D) com motores elétricos, híbrido plug-in', cc: 1499, hp: 393, kgfm: 77.7, trans: 'Automatizado', gears: 2, drive: OND, a100: 4.9, top: 180, cityG: 11.7, roadG: 10.4, tank: 55, len: 4683, wid: 1886, hei: 1730, wb: 2738, gc: 182, kg: 2040, trunk: 560, cruise: true, cam: true, park: true, battery: 34, range: 113, media: 'Rádio, Bluetooth, USB, GPS, head-up display, carregador por indução, roteador Wi-Fi e leitura de placas de trânsito', wheels: '235/55 R19' }
  ])
];
