/**
 * Carga inicial do Guia de veículos: fichas técnicas de referência de modelos muito vendidos no Brasil.
 *
 * Regras desta carga:
 *  - só entram números e itens que constavam na fonte; o que a fonte não trazia fica em branco (nunca estimado);
 *  - nenhuma opinião, nota ou texto de avaliação é inventado: opiniões vêm dos donos, pelo próprio site;
 *  - consumo é o do programa de etiquetagem (PBE/Inmetro) divulgado pela fonte; potência e torque são os de gasolina
 *    (a versão a etanol aparece no texto do motor quando a fonte informava);
 *  - cada modelo guarda a fonte e a data da conferência, e o site mostra isso ao cliente.
 */
export const SEED_SOURCE = 'Fichas de referência de fabricante e Inmetro, conforme fichacompleta.com.br (consultado em 10/2026). Confirme itens de série e versões na concessionária.';

type Specs = Record<string, string | number | boolean>;
export interface SeedVersion { name: string; yearModel: number; fuel: string; specs: Specs }
export interface SeedModel { slug: string; brand: string; name: string; vehicleType: 'CAR'; bodyType: string; yearFrom?: number; versions: SeedVersion[] }

interface V {
  name: string; engine: string; cc: number; hp: number; kgfm: number; trans: string; gears: number; drive?: string;
  a100?: number; top?: number; cityG?: number; roadG?: number; cityE?: number; roadE?: number; cityD?: number; roadD?: number;
  tank: number; len: number; wid: number; hei: number; wb: number; gc?: number; kg: number; trunk?: number; doors?: number; airbags?: number;
  cruise?: boolean; cam?: boolean; park?: boolean; media: string; wheels: string; fuel?: string;
}

function version(v: V): SeedVersion {
  const s: Specs = {
    engine: v.engine, displacement_cc: v.cc, power_hp: v.hp, torque_kgfm: v.kgfm, transmission: v.trans, gears: v.gears, drive: v.drive ?? 'Dianteira',
    tank_l: v.tank, length_mm: v.len, width_mm: v.wid, height_mm: v.hei, wheelbase_mm: v.wb, weight_kg: v.kg, seats: 5, doors: v.doors ?? 4,
    abs: true, esc: true, isofix: true, air_conditioning: true, multimedia: v.media, wheels: v.wheels
  };
  const opt: Array<[string, number | boolean | undefined]> = [
    ['accel_0_100_s', v.a100], ['top_speed_kmh', v.top], ['cons_city_gas_kml', v.cityG], ['cons_road_gas_kml', v.roadG], ['cons_city_eth_kml', v.cityE], ['cons_road_eth_kml', v.roadE],
    ['cons_city_diesel_kml', v.cityD], ['cons_road_diesel_kml', v.roadD], ['ground_clearance_mm', v.gc], ['trunk_l', v.trunk], ['airbags', v.airbags],
    ['cruise_control', v.cruise], ['rear_camera', v.cam], ['parking_sensors', v.park]
  ];
  for (const [k, val] of opt) if (val !== undefined) s[k] = val;
  return { name: v.name, yearModel: 2025, fuel: v.fuel ?? 'Flex', specs: s };
}

const m = (slug: string, brand: string, name: string, bodyType: string, versions: V[]): SeedModel => ({ slug, brand, name, vehicleType: 'CAR', bodyType, versions: versions.map(version) });

export const VEHICLE_SEED: SeedModel[] = [
  m('chevrolet-onix', 'Chevrolet', 'Onix', 'Hatch', [
    { name: '1.0', engine: '1.0 3 cilindros em linha, flex', cc: 999, hp: 78, kgfm: 9.6, trans: 'Manual de 6 marchas', gears: 6, a100: 13.3, top: 167, cityG: 13.3, roadG: 16.5, cityE: 9.3, roadE: 11.4, tank: 44, len: 4163, wid: 1730, hei: 1476, wb: 2551, gc: 128, kg: 1037, trunk: 275, media: 'Rádio, Bluetooth e USB', wheels: '185/70 R14' },
    { name: '1.0 Turbo AT', engine: '1.0 turbo 3 cilindros em linha, flex (etanol: 116 cv e 16,8 kgfm)', cc: 999, hp: 116, kgfm: 16.3, trans: 'Automático de 6 marchas', gears: 6, a100: 10.1, top: 187, cityG: 11.6, roadG: 14.9, cityE: 8.3, roadE: 10.4, tank: 44, len: 4163, wid: 1730, hei: 1476, wb: 2551, gc: 128, kg: 1085, trunk: 275, media: 'Rádio, Bluetooth, USB e computador de bordo', wheels: '185/65 R15' }
  ]),
  m('chevrolet-onix-sedan', 'Chevrolet', 'Onix Sedan', 'Sedã', [
    { name: 'LT 1.0 Turbo', engine: '1.0 turbo 3 cilindros em linha, flex (etanol: 116 cv e 16,8 kgfm)', cc: 999, hp: 116, kgfm: 16.3, trans: 'Manual de 6 marchas', gears: 6, a100: 10.4, top: 187, cityG: 13.4, roadG: 16.9, cityE: 9.3, roadE: 11.8, tank: 44, len: 4474, wid: 1730, hei: 1474, wb: 2600, gc: 127, kg: 1073, trunk: 469, media: 'Rádio, Bluetooth, USB, espelhamento do celular e computador de bordo', wheels: '185/65 R15' }
  ]),
  m('chevrolet-tracker', 'Chevrolet', 'Tracker', 'SUV', [
    { name: 'Premier 1.2 Turbo', engine: '1.2 turbo 3 cilindros em linha, flex (etanol: 133 cv e 21,4 kgfm)', cc: 1199, hp: 132, kgfm: 19.4, trans: 'Automático de 6 marchas', gears: 6, a100: 9.4, top: 185, cityG: 10.4, roadG: 13.2, cityE: 7.2, roadE: 9.2, tank: 44, len: 4270, wid: 1791, hei: 1626, wb: 2570, gc: 157, kg: 1271, trunk: 393, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, roteador Wi-Fi e espelhamento do celular', wheels: 'Liga leve, 215/55 R17' }
  ]),
  m('fiat-mobi', 'Fiat', 'Mobi', 'Hatch', [
    { name: 'Like 1.0', engine: '1.0 Fire 4 cilindros em linha aspirado, flex (etanol: 74 cv e 9,7 kgfm)', cc: 999, hp: 71, kgfm: 9.3, trans: 'Manual de 5 marchas', gears: 5, a100: 14, top: 152, cityG: 13.5, roadG: 15, cityE: 9.6, roadE: 10.4, tank: 47, len: 3596, wid: 1666, hei: 1523, wb: 2304, gc: 177, kg: 961, trunk: 200, airbags: 2, media: 'Computador de bordo e conta-giros', wheels: '175/65 R14' }
  ]),
  m('fiat-argo', 'Fiat', 'Argo', 'Hatch', [
    { name: 'Drive 1.0', engine: '1.0 Firefly 3 cilindros em linha aspirado, flex (etanol: 75 cv e 10,7 kgfm)', cc: 999, hp: 71, kgfm: 10, trans: 'Manual de 5 marchas', gears: 5, a100: 13.4, top: 162, cityG: 13.3, roadG: 14.7, cityE: 9.4, roadE: 10.2, tank: 48, len: 3998, wid: 1724, hei: 1503, wb: 2521, gc: 155, kg: 1077, trunk: 300, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: '185/60 R15' }
  ]),
  m('fiat-cronos', 'Fiat', 'Cronos', 'Sedã', [
    { name: 'Drive 1.3', engine: '1.3 Firefly 4 cilindros em linha aspirado, flex (etanol: 107 cv e 13,7 kgfm)', cc: 1332, hp: 98, kgfm: 13.2, trans: 'Manual de 5 marchas', gears: 5, a100: 11.5, top: 183, cityG: 12.8, roadG: 15.5, cityE: 9, roadE: 10.9, tank: 48, len: 4364, wid: 1726, hei: 1508, wb: 2521, gc: 158, kg: 1139, trunk: 525, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e computador de bordo', wheels: '185/60 R15' }
  ]),
  m('fiat-pulse', 'Fiat', 'Pulse', 'SUV', [
    { name: 'Drive 1.3', engine: '1.3 Firefly 4 cilindros em linha aspirado, flex (etanol: 107 cv e 13,7 kgfm)', cc: 1332, hp: 98, kgfm: 13.2, trans: 'Manual de 5 marchas', gears: 5, a100: 11.7, top: 178, cityG: 12.5, roadG: 14.7, cityE: 9, roadE: 10.4, tank: 47, len: 4099, wid: 1774, hei: 1576, wb: 2532, gc: 190, kg: 1187, trunk: 370, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e computador de bordo', wheels: 'Liga leve, 195/60 R16' }
  ]),
  m('fiat-strada', 'Fiat', 'Strada', 'Picape', [
    { name: 'Freedom 1.3 CD', engine: '1.3 Firefly 4 cilindros em linha aspirado, flex (etanol: 107 cv e 13,7 kgfm)', cc: 1332, hp: 98, kgfm: 13.2, trans: 'Manual de 5 marchas', gears: 5, a100: 11.6, top: 171, cityG: 12.7, roadG: 13.9, cityE: 9, roadE: 9.8, tank: 55, len: 4474, wid: 1732, hei: 1606, wb: 2737, gc: 212, kg: 1167, cruise: true, park: true, media: 'Computador de bordo, conta-giros e USB', wheels: 'Liga leve, 195/65 R15' }
  ]),
  m('fiat-toro', 'Fiat', 'Toro', 'Picape', [
    { name: 'Freedom 1.3 Turbo', engine: '1.3 turbo 4 cilindros em linha (T270), flex (etanol: 185 cv e 27,5 kgfm)', cc: 1332, hp: 180, kgfm: 27.5, trans: 'Automático de 6 marchas', gears: 6, a100: 10.7, top: 201, cityG: 9.2, roadG: 11, cityE: 6.6, roadE: 7.9, tank: 55, len: 4945, wid: 1845, hei: 1730, wb: 2990, gc: 251, kg: 1670, cruise: true, cam: true, park: true, media: 'Navegador GPS, Bluetooth, USB, roteador Wi-Fi e espelhamento do celular', wheels: 'Liga leve, 225/60 R17' }
  ]),
  m('volkswagen-polo', 'Volkswagen', 'Polo', 'Hatch', [
    { name: 'Track 1.0', engine: '1.0 EA211 3 cilindros em linha aspirado, flex', cc: 999, hp: 77, kgfm: 9.6, trans: 'Manual de 5 marchas', gears: 5, a100: 13.4, top: 169, cityG: 13.7, roadG: 15.2, cityE: 9.4, roadE: 10.8, tank: 52, len: 4074, wid: 1751, hei: 1471, wb: 2566, gc: 166, kg: 1054, trunk: 300, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: '185/65 R15' }
  ]),
  m('volkswagen-virtus', 'Volkswagen', 'Virtus', 'Sedã', [
    { name: 'Highline 1.0 TSI', engine: '1.0 TSI turbo 3 cilindros em linha (EA211), flex (etanol: 128 cv e 20,4 kgfm)', cc: 999, hp: 116, kgfm: 20.4, trans: 'Automático de 6 marchas', gears: 6, a100: 9.9, top: 194, cityG: 12.1, roadG: 14.4, cityE: 8.3, roadE: 10.2, tank: 49, len: 4561, wid: 1751, hei: 1476, wb: 2651, kg: 1213, trunk: 521, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, HD interno e computador de bordo', wheels: 'Liga leve, 205/50 R17' }
  ]),
  m('volkswagen-nivus', 'Volkswagen', 'Nivus', 'SUV', [
    { name: 'Highline 1.0 TSI', engine: '1.0 TSI turbo 3 cilindros em linha (EA211), flex (etanol: 128 cv e 20,4 kgfm)', cc: 999, hp: 116, kgfm: 20.4, trans: 'Automático de 6 marchas', gears: 6, a100: 10, top: 192, cityG: 12.4, roadG: 14.8, cityE: 8.6, roadE: 10.3, tank: 49, len: 4272, wid: 1757, hei: 1499, wb: 2566, gc: 171, kg: 1238, trunk: 415, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e controle de funções pelo app', wheels: 'Liga leve, 205/55 R17' }
  ]),
  m('volkswagen-t-cross', 'Volkswagen', 'T-Cross', 'SUV', [
    { name: 'Comfortline 1.0 TSI', engine: '1.0 TSI turbo 3 cilindros em linha (EA211), flex (etanol: 128 cv e 20,4 kgfm)', cc: 999, hp: 116, kgfm: 20.4, trans: 'Automático de 6 marchas', gears: 6, a100: 10, top: 192, cityG: 11.9, roadG: 14.1, cityE: 8.1, roadE: 9.8, tank: 49, len: 4218, wid: 1760, hei: 1571, wb: 2651, gc: 190, kg: 1259, trunk: 373, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e carregador de celular por indução', wheels: 'Liga leve, 205/55 R17' }
  ]),
  m('hyundai-hb20', 'Hyundai', 'HB20', 'Hatch', [
    { name: 'Sense Plus 1.0', engine: '1.0 Kappa 3 cilindros em linha aspirado, flex (etanol: 80 cv e 10,2 kgfm)', cc: 998, hp: 75, kgfm: 9.4, trans: 'Manual de 5 marchas', gears: 5, a100: 14.5, top: 161, cityG: 13.5, roadG: 14.6, cityE: 9.6, roadE: 10.4, tank: 50, len: 4015, wid: 1720, hei: 1470, wb: 2530, gc: 160, kg: 993, trunk: 300, cruise: true, media: 'Rádio, Bluetooth, USB e computador de bordo', wheels: '185/60 R15' }
  ]),
  m('hyundai-creta', 'Hyundai', 'Creta', 'SUV', [
    { name: 'Comfort Plus 1.0 Turbo', engine: '1.0 turbo 3 cilindros em linha (Kappa), injeção direta, flex', cc: 998, hp: 120, kgfm: 17.5, trans: 'Automático de 6 marchas', gears: 6, a100: 11.5, top: 180, cityG: 11.9, roadG: 12.6, cityE: 8.3, roadE: 9.1, tank: 50, len: 4300, wid: 1790, hei: 1620, wb: 2610, gc: 190, kg: 1270, trunk: 422, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e computador de bordo', wheels: 'Liga leve, 205/65 R16' }
  ]),
  m('renault-kwid', 'Renault', 'Kwid', 'Hatch', [
    { name: 'Zen 1.0', engine: '1.0 B4D 3 cilindros em linha aspirado, flex (etanol: 71 cv e 10 kgfm)', cc: 999, hp: 68, kgfm: 9.4, trans: 'Manual de 5 marchas', gears: 5, a100: 13.2, top: 156, cityG: 15.3, roadG: 15.7, cityE: 10.8, roadE: 11, tank: 38, len: 3680, wid: 1579, hei: 1479, wb: 2423, gc: 185, kg: 818, trunk: 290, media: 'Rádio, Bluetooth, USB, computador de bordo e conta-giros', wheels: '165/70 R14' }
  ]),
  m('toyota-corolla', 'Toyota', 'Corolla', 'Sedã', [
    { name: 'XEi 2.0', engine: '2.0 4 cilindros (M20A-FKB), flex (etanol: 175 cv e 21,3 kgfm)', cc: 1987, hp: 169, kgfm: 21.3, trans: 'CVT', gears: 10, a100: 9.2, top: 205, cityG: 11.9, roadG: 14.5, cityE: 8, roadE: 10, tank: 50, len: 4630, wid: 1780, hei: 1455, wb: 2700, gc: 148, kg: 1410, trunk: 470, airbags: 6, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB e espelhamento do celular', wheels: 'Liga leve, 215/50 R17' }
  ]),
  m('honda-hr-v', 'Honda', 'HR-V', 'SUV', [
    { name: 'EXL 1.5', engine: '1.5 4 cilindros (L15B), injeção direta, flex', cc: 1498, hp: 126, kgfm: 15.5, trans: 'CVT', gears: 7, a100: 11.8, top: 175, cityG: 12.7, roadG: 13.9, cityE: 8.8, roadE: 9.8, tank: 50, len: 4330, wid: 1790, hei: 1590, wb: 2610, gc: 185, kg: 1309, trunk: 354, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular, carregador por indução e computador de bordo', wheels: 'Liga leve, 215/60 R17' }
  ]),
  m('jeep-compass', 'Jeep', 'Compass', 'SUV', [
    { name: 'Longitude 1.3 Turbo', engine: '1.3 turbo 4 cilindros em linha (T270), flex (etanol: 185 cv e 27,5 kgfm)', cc: 1332, hp: 180, kgfm: 27.5, trans: 'Automático de 6 marchas', gears: 6, a100: 10.3, top: 206, cityG: 10.1, roadG: 12, cityE: 7.2, roadE: 8.7, tank: 55, len: 4404, wid: 1819, hei: 1628, wb: 2636, gc: 205, kg: 1585, trunk: 410, cruise: true, cam: true, park: true, media: 'Som Beats, Bluetooth, navegador GPS, espelhamento do celular e USB', wheels: 'Liga leve, 225/55 R18' }
  ]),
  m('toyota-hilux', 'Toyota', 'Hilux', 'Picape', [
    { name: 'SRX 2.8 Turbodiesel 4x4 AT CD', fuel: 'Diesel', engine: '2.8 turbodiesel 4 cilindros (1GD-FTV), injeção direta', cc: 2755, hp: 204, kgfm: 50.9, trans: 'Automático de 6 marchas', gears: 6, drive: '4x4 (integral temporária)', a100: 12, top: 180, cityD: 10.1, roadD: 11.3, tank: 80, len: 5325, wid: 1855, hei: 1815, wb: 3085, gc: 286, kg: 2090, cruise: true, cam: true, park: true, media: 'Navegador GPS, som JBL, Bluetooth, USB, Wi-Fi, espelhamento do celular e TV digital', wheels: 'Liga leve, 265/60 R18' }
  ]),
  m('ford-ranger', 'Ford', 'Ranger', 'Picape', [
    { name: 'XLS 2.0 Turbodiesel 4x4', fuel: 'Diesel', engine: '2.0 turbodiesel 4 cilindros (Panther), injeção direta', cc: 1995, hp: 170, kgfm: 41.3, trans: 'Automático de 6 marchas', gears: 6, drive: '4x4 (integral temporária)', a100: 12, top: 164, cityD: 10, roadD: 11.5, tank: 80, len: 5354, wid: 1918, hei: 1886, wb: 3270, gc: 235, kg: 2183, cruise: true, cam: true, park: true, media: 'Rádio, Bluetooth, USB, espelhamento do celular e controle de funções pelo app', wheels: 'Liga leve, 255/70 R17' }
  ])
];
