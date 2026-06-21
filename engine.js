// ============================================================
// ENGINE.JS — Фізика двигуна + рендеринг
// Реальні формули без скриптованих подій
// ============================================================

// ======================================================
// CONSTANTS & DATA TABLES
// ======================================================
const FUEL = {
  petrol_92: { octane: 92,  stoich: 14.7, lhv: 43.4e6, knockLimit: 1.15, density: 745, label:'Бензин 92' },
  petrol_95: { octane: 95,  stoich: 14.7, lhv: 43.4e6, knockLimit: 1.22, density: 745, label:'Бензин 95' },
  petrol_98: { octane: 98,  stoich: 14.7, lhv: 43.4e6, knockLimit: 1.28, density: 745, label:'Бензин 98' },
  diesel:    { octane: 50,  stoich: 14.5, lhv: 42.5e6, knockLimit: 0.95, density: 840, label:'Дизель' },
  e85:       { octane: 105, stoich: 9.8,  lhv: 27.0e6, knockLimit: 1.5,  density: 780, label:'E85' },
  methanol:  { octane: 114, stoich: 6.46, lhv: 19.9e6, knockLimit: 1.8,  density: 792, label:'Метанол' },
  lpg:       { octane: 108, stoich: 15.5, lhv: 46.0e6, knockLimit: 1.35, density: 550, label:'LPG' },
  hydrogen:  { octane: 130, stoich: 34.3, lhv: 120e6,  knockLimit: 2.0,  density: 0.09,label:'Водень' },
};

const CYL_MAT_FRIC = {
  cast_iron: 1.0, steel: 0.9, aluminum: 0.75, nikasil: 0.55, titanium: 0.65
};

const CAM_VE = {
  ohv: 0.78, sohc: 0.84, dohc: 0.90, vvt: 0.96, vvtl: 1.0, desmo: 1.02
};

const CAM_RPM_PEAK = {
  ohv: 4500, sohc: 5500, dohc: 6500, vvt: 7000, vvtl: 7500, desmo: 9000
};

// ── СИСТЕМИ ЖИВЛЕННЯ ──────────────────────────────────────
// veMult: вплив на наповнення циліндра (точність дозування)
// afrPrecision: 1.0=ідеальне дозування, менше=більший розкид AFR
// throttleResponseTau: інерція відгуку на газ (сек) — карбюратор повільніший
// idleQuality: якість холостого ходу (менше=більш нестабільний)
// maxCompression: максимальна компресія яку система дозволяє без проблем
const INJECTION = {
  carb:          { veMult: 0.92, afrPrecision: 0.78, throttleTau: 0.18, idleQuality: 0.70, maxCompression: 11.5, label: 'Карбюратор' },
  tbi:           { veMult: 0.95, afrPrecision: 0.88, throttleTau: 0.10, idleQuality: 0.85, maxCompression: 12.0, label: 'Моновпорск' },
  mpfi:          { veMult: 1.00, afrPrecision: 0.97, throttleTau: 0.04, idleQuality: 0.96, maxCompression: 13.0, label: 'Розподілений' },
  gdi:           { veMult: 1.05, afrPrecision: 0.99, throttleTau: 0.025,idleQuality: 0.98, maxCompression: 14.5, label: 'Прямий впорск' },
  mech_pump:     { veMult: 0.90, afrPrecision: 0.75, throttleTau: 0.15, idleQuality: 0.65, maxCompression: 22.0, label: 'ТНВД механічний' },
  common_rail:   { veMult: 1.02, afrPrecision: 0.96, throttleTau: 0.03, idleQuality: 0.95, maxCompression: 24.0, label: 'Common Rail' },
  unit_injector: { veMult: 1.00, afrPrecision: 0.93, throttleTau: 0.05, idleQuality: 0.90, maxCompression: 23.0, label: 'Насос-форсунки' },
};

const TURBO_DATA = {
  na:           { spoolRPM: 0,    maxBoost: 0,    efficiency: 0 },
  turbo_s:      { spoolRPM: 2000, maxBoost: 0.8,  efficiency: 0.68 },
  turbo_m:      { spoolRPM: 2500, maxBoost: 1.4,  efficiency: 0.72 },
  turbo_l:      { spoolRPM: 3500, maxBoost: 2.2,  efficiency: 0.74 },
  twin_turbo:   { spoolRPM: 2000, maxBoost: 2.5,  efficiency: 0.76 },
  supercharger: { spoolRPM: 0,    maxBoost: 1.0,  efficiency: 0.65 },
  procharger:   { spoolRPM: 0,    maxBoost: 1.8,  efficiency: 0.70 },
};

// ======================================================
// ENGINE CONFIG
// ======================================================
window.cfg = {
  cylinders:       1,
  flywheelMass:    12,
  flywheelRadius:  0.15,
  cylMat:          'cast_iron',
  conrodMass:      0.6,
  conrodType:      'std',
  conrodLength:    0.150,
  valvesPerCyl:    2,
  camType:         'ohv',
  fuelType:        'petrol_92',
  injectionType:   'tbi',
  turboType:       'na',
  boostTarget:     0,
  compression:     10,
  displacement:    2.0,  // літри
  bsRatioSlider:   0,    // -100..+100: 0=square, <0=long stroke, >0=oversquare
  // bore і stroke рахуються в computeSpec з displacement + bsRatioSlider
  // Регульований холостий хід: 0 = авто (розраховується з параметрів)
  idleRPMTarget:   0,
  vibrationEnabled:true,
  // Відсічка обертів (rev limiter) — 0 = авто (90% від механічного максимуму)
  revLimiterTarget: 0,
  // Тривалість обрізання іскри за один цикл відсічки, мс
  // (типово ECU ріже іскру на 5-50мс, довша відсічка = різкіше падіння оборотів)
  sparkCutMs: 15,
};

// ======================================================
// ENGINE STATE
// ======================================================
window.state = {
  running:      false,
  rpm:          0,
  omega:        0,
  crankAngle:   0,
  engineTemp:   20,
  ambientTemp:  20,
  throttle:     0,
  afr:          14.7,
  boost:        0,
  torque:       0,
  power:        0,
  knock:        false,
  overheat:     false,
  lean:         false,
  rich:         false,
  stall:        false,
  pistonY:      [],
  vibAmp:       0,
  lastTime:     0,
  smokeParticles:[],
  idleTrim: 0,
  throttleActual: 0,
  sparkCutActive: false,
  sparkCutTimer: 0, // секунди що залишилось до повернення іскри
};

window.spec = {};

// ======================================================
// SPEC COMPUTATION
// ======================================================
window.computeSpec = function() {
  const c = window.cfg;
  const f = FUEL[c.fuelType];

  // ── Bore і stroke з displacement + BS-ratio ────────────
  // Displacement фіксований (вибирає користувач в літрах).
  // BS-ratio slider (-100..+100) керує тим, як той самий об'єм
  // розподілений між bore і stroke:
  //   0   = square (bore = stroke)
  //  +100 = oversquare (bore >> stroke, revvy)
  //  -100 = long-stroke (stroke >> bore, torquey)
  //
  // Формула: якщо bs_factor = 2^(slider/100), то
  //   bore  = cbrt(Vcyl × 4/π × bs_factor) — більше при +
  //   stroke = Vcyl / (π/4 × bore²)         — більше при -
  //
  const totalVol  = c.displacement * 1e-3; // м³
  const cylVol    = totalVol / c.cylinders;
  // bs_factor: 1=square, >1=oversquare, <1=long-stroke
  const bs_factor = Math.pow(2, c.bsRatioSlider / 100);
  // З Vcyl = π/4 × bore² × stroke і bore/stroke = bs_factor:
  // bore³ = Vcyl × 4/π × bs_factor
  const boreM  = Math.cbrt(cylVol * 4 / Math.PI * bs_factor);
  const stroke = cylVol / (Math.PI / 4 * boreM * boreM);
  const bsRatio = boreM / stroke;

  const cylDisp   = cylVol;
  const totalDisp = totalVol;
  const displayDisp = totalDisp * 1e3; // літри

  const crankR  = stroke / 2;
  const Ifw     = 0.5 * c.flywheelMass * c.flywheelRadius * c.flywheelRadius;
  const Ipiston = c.cylinders * 0.4 * crankR * crankR;
  const Iconrod = c.cylinders * c.conrodMass * crankR * crankR;
  const Itotal  = Ifw + Ipiston + Iconrod + 0.08;

  const ve_peak     = CAM_VE[c.camType] * INJECTION[c.injectionType].veMult;
  const td          = TURBO_DATA[c.turboType];
  const boostFactor = 1 + c.boostTarget * (1 + td.efficiency * 0.3);
  const gammaFuel   = c.fuelType === 'diesel' ? 1.35 : 1.40;
  const etaOtto     = 1 - Math.pow(c.compression, 1 - gammaFuel);
  const fricFactor  = CYL_MAT_FRIC[c.cylMat];
  const baseBMEP    = 18.8e5; // калібровано на реальний атмо BMEP ~9.5бар (ВАЗ-клас)
  const bmepPeak    = baseBMEP * ve_peak * boostFactor * etaOtto / fricFactor;
  const peakTorque  = bmepPeak * totalDisp / (4 * Math.PI);

  // RPM піку обмежений ходом поршня (швидкість поршня ≤22 м/с)
  const pistonSpeedLimit = 22;
  const rpmPeakFromStroke = pistonSpeedLimit / (2 * stroke) * 60;
  const camBasePeak = CAM_RPM_PEAK[c.camType] * (1 + c.boostTarget * 0.1);
  const rpmPeak = Math.min(camBasePeak * Math.sqrt(bsRatio), rpmPeakFromStroke);

  const omegaPeak   = rpmPeak * 2 * Math.PI / 60;
  const peakPower   = peakTorque * omegaPeak;
  const maxRPM      = rpmPeak * 1.25;
  const baseIdleRPM = c.fuelType === 'diesel' ? 680 : 750 + c.cylinders * 10;
  const idleRPM     = (c.idleRPMTarget > 0) ? c.idleRPMTarget : baseIdleRPM;

  const conrodMassRatio   = c.conrodMass / 0.6;
  const valveHeadroom     = 0.85 + c.valvesPerCyl * 0.09;
  const mechanicalCeiling = rpmPeak * (1.6 + (valveHeadroom - 1.0) * 1.2)
                            / Math.max(0.5, Math.pow(conrodMassRatio, 0.4));
  const revLimiterRPM = (c.revLimiterTarget > 0)
    ? c.revLimiterTarget
    : mechanicalCeiling * 0.9;

  const firingAngles = [];
  const interval = 4 * Math.PI / c.cylinders;
  for (let i = 0; i < c.cylinders; i++) firingAngles.push(i * interval);

  const gaugeMaxRPM = Math.max(revLimiterRPM, mechanicalCeiling) * 1.08;

  window.spec = {
    bore: boreM, stroke, cylDisp, totalDisp, displayDisp, bsRatio,
    Itotal, ve_peak, bmepPeak, peakTorque,
    peakPower, rpmPeak, maxRPM, idleRPM,
    firingAngles, crankRadius: crankR,
    gammaFuel, etaOtto, fricFactor, boostFactor,
    mechanicalCeiling, revLimiterRPM, gaugeMaxRPM,
  };

  updateSummaryUI();
};


function updateSummaryUI() {
  const s = window.spec;
  const c = window.cfg;
  const td = TURBO_DATA[c.turboType];
  const rows = [
    ['Діаметр (bore)',      (s.bore * 1000).toFixed(1) + ' мм'],
    ['Хід поршня (stroke)', (s.stroke * 1000).toFixed(1) + ' мм'],
    ['Об\'єм',              s.displayDisp.toFixed(3) + ' л  (' + (s.totalDisp*1e6).toFixed(0) + ' cc)'],
    ['Bore/Stroke',         s.bsRatio.toFixed(3) + (s.bsRatio > 1.05 ? ' ▶ oversquare (оберти)' : s.bsRatio < 0.95 ? ' ◀ long-stroke (торк)' : ' = square')],
    ['Ступінь стиснення',   c.compression + ':1'],
    ['Пікова тяга',         s.peakTorque.toFixed(0) + ' Нм'],
    ['Пікова потужність',   (s.peakPower/1000).toFixed(1) + ' кВт / ' + (s.peakPower/745.7).toFixed(0) + ' к.с.'],
    ['Оберти піку',         s.rpmPeak.toFixed(0) + ' RPM'],
    ['Холостий хід',        s.idleRPM.toFixed(0) + ' RPM'],
    ['Система живлення',    INJECTION[c.injectionType].label],
    ['Відсічка (ціль)',     (c.revLimiterTarget > 0 ? c.revLimiterTarget : 'авто ' + Math.round(s.revLimiterRPM)) + ' RPM'],
    ['Механічна межа',      Math.round(s.mechanicalCeiling) + ' RPM (клапани/шатуни)'],
    ['Обрізання іскри',     c.sparkCutMs + ' мс'],
    ['Момент інерції',      s.Itotal.toFixed(4) + ' кг·м²'],
    ['ККД Otto',            (s.etaOtto * 100).toFixed(1) + '%'],
    ['Наддув (ціль)',       c.boostTarget.toFixed(1) + ' бар — ' + c.turboType],
  ];
  const el = document.getElementById('spec-rows');
  if (el) el.innerHTML = rows.map(r =>
    `<div class="stat-row"><span class="sk">${r[0]}</span><span class="sv">${r[1]}</span></div>`
  ).join('');
}

// ======================================================
// PHYSICS TICK
// ======================================================
window.physicsTick = function(dt) {
  const s  = window.state;
  const c  = window.cfg;
  const sp = window.spec;
  const f  = FUEL[c.fuelType];
  const td = TURBO_DATA[c.turboType];

  // Поточний цільовий холостий хід
  const idleRPM   = (c.idleRPMTarget > 0) ? c.idleRPMTarget : sp.idleRPM;
  const idleOmega = idleRPM * 2 * Math.PI / 60;

  if (!s.running) {
    // Вільне гальмування — тертя + аеродинаміка
    const fricDecel = s.omega * 1.5 + 3;
    s.omega      = Math.max(0, s.omega - fricDecel * dt);
    s.rpm        = s.omega * 60 / (2 * Math.PI);
    s.crankAngle += s.omega * dt;
    updatePistonPositions();
    s.torque     = 0;
    s.power      = 0;
    s.boost      = 0;
    s.vibAmp     = 0;
    s.engineTemp = Math.max(s.ambientTemp, s.engineTemp - 2 * dt);
    return;
  }

  // ── BOOST ──────────────────────────────────────────────
  let boostAvail = 0;
  if (c.turboType === 'supercharger' || c.turboType === 'procharger') {
    // Компресор — миттєвий, пропорційний RPM
    boostAvail = c.boostTarget * Math.min(1, s.rpm / 1500) * s.throttle;
  } else if (td.spoolRPM > 0) {
    // Турбіна — потрібен spool-up по RPM
    const spoolFrac = Math.max(0, (s.rpm - td.spoolRPM) / Math.max(1, sp.rpmPeak - td.spoolRPM));
    boostAvail = c.boostTarget * Math.min(1, spoolFrac) * s.throttle;
  }
  // Плавна зміна буста (інерція турбіни)
  s.boost += (boostAvail - s.boost) * Math.min(1, dt / 0.35);

  // ── ПОВІТРЯНИЙ ЗАРЯД ───────────────────────────────────
  const T_K             = s.ambientTemp + 273.15;
  const airDensityRatio = 293.15 / T_K;           // холодніше = густіше
  const pressureRatio   = 1.0 + s.boost;

  // Volumetric efficiency: реалістична крива.
  // Біля холостого — підлога (м'яке наповнення на низьких обертах).
  // Вище пікового RPM — падіння через обмеження потоку клапанів:
  // клапани просто не встигають пропустити достатньо повітря за
  // вкорочений час такту. Це природна механічна стеля без хардкоду.
  const rpmFrac = s.rpm / sp.rpmPeak;
  let veShapeFactor;
  if (rpmFrac <= 1.0) {
    // До піку: підйом від підлоги холостого до 1.0 на піку
    const veFloor = 0.55;
    const riseShape = Math.exp(-0.5 * Math.pow((rpmFrac - 1.0) / 0.7, 2));
    veShapeFactor = veFloor + (1 - veFloor) * riseShape;
  } else {
    // Після піку: різке падіння — клапанна "задуха" (valve choke).
    // Швидкість падіння залежить від клапанів на циліндр (валвтрейн
    // з більшою кількістю клапанів тримає ВЕ довше).
    const valveFlowFactor = 0.7 + c.valvesPerCyl * 0.075; // 2 клап=0.85, 4 клап=1.0, 5 клап=1.075
    const overRev = rpmFrac - 1.0;
    veShapeFactor = Math.exp(-Math.pow(overRev / (0.55 * valveFlowFactor), 2.2));
  }
  const ve = sp.ve_peak * veShapeFactor * airDensityRatio;

  // Маса повітря на циліндр за цикл
  const rho_air  = 1.2 * airDensityRatio * pressureRatio; // кг/м³
  const mAirCyl  = rho_air * sp.cylDisp * ve;             // кг

  // ── ДРОСЕЛЬ → МАСА ПАЛИВА ──────────────────────────────
  // Throttle контролює КІЛЬКІСТЬ СУМІШІ що потрапляє в циліндр,
  // а не множить крутний момент напряму.
  // Мінімальний заряд холостого ходу — ~8% від повного відкриття,
  // плюс idleTrim — корекція від регулятора холостого ходу (IACV).
  // Педаль газу нелінійна (як справжній дросель): квадратична крива —
  // перші 30-40% натискання дають малий приріст заряду, решта різкіша.
  // ── ВІДГУК ДРОСЕЛЯ (лаг системи живлення) ─────────────
  // Карбюратор/механічний ТНВД реагують на педаль повільніше
  // (паливна плівка в дифузорі, механічна інерція рейки),
  // інжектор з ЕБУ — майже миттєво.
  const inj = INJECTION[c.injectionType];
  if (s.throttleActual === undefined) s.throttleActual = s.throttle;
  s.throttleActual += (s.throttle - s.throttleActual) * Math.min(1, dt / inj.throttleTau);
  const throttleCurve = s.throttleActual * s.throttleActual * (3 - 2 * s.throttleActual); // smoothstep
  const idleThrottleFrac = 0.08 + s.idleTrim;
  const effectiveThrottle = Math.max(0.02, Math.min(1,
    idleThrottleFrac + throttleCurve * (1.0 - 0.08)));
  const mAirActual = mAirCyl * effectiveThrottle;
  const mFuelActual = mAirActual / f.stoich; // при стехіометрії

  // AFR: на холостому збагачуємо (холодний), на WOT збагачуємо трохи
  let targetAFR = f.stoich;
  if (effectiveThrottle < 0.12 && s.engineTemp < 70) {
    // Холодний пуск — багата суміш
    targetAFR = f.stoich * (0.82 + 0.18 * (s.engineTemp / 70));
  } else if (s.throttle > 0.85) {
    // WOT збагачення
    targetAFR = f.stoich * 0.93;
  }
  // Точність дозування системи живлення: карбюратор/ТНВД гуляють по AFR,
  // інжектор з ЕБУ тримає майже ідеально
  const afrNoise = (1 - inj.afrPrecision) * 0.18 * (Math.random() * 2 - 1);
  targetAFR *= (1 + afrNoise);
  s.afr  = targetAFR;
  s.lean = targetAFR > f.stoich * 1.06;
  s.rich = targetAFR < f.stoich * 0.88;

  const lambda  = targetAFR / f.stoich;
  const combEff = lambda < 1
    ? 0.92 * lambda
    : Math.max(0, 0.92 - 0.18 * (lambda - 1));

  // ── ВІДСІЧКА ОБЕРТІВ (REV LIMITER) ─────────────────────
  // Реальний ECU: тримає обрізання іскри ПОКИ RPM > ліміт.
  // Після падіння нижче ліміту — пауза "відновлення" = sparkCutMs,
  // потім знову дозволяє горіння. Це дає характерне биття на відсічці.
  // Якщо ліміт > механічна межа — відсічка просто не зрацьовує (VE-задуха раніше).
  const sparkCutDurSec = Math.max(0.005, c.sparkCutMs / 1000);
  const currentRPM = s.omega * 60 / (2 * Math.PI);

  if (currentRPM > sp.revLimiterRPM) {
    // Вище ліміту — завжди тримаємо cut
    s.sparkCutActive = true;
    s.sparkCutTimer  = sparkCutDurSec; // скидаємо таймер поки вище ліміту
  } else if (s.sparkCutActive) {
    // Нижче ліміту але ще в паузі відновлення
    s.sparkCutTimer -= dt;
    if (s.sparkCutTimer <= 0) {
      s.sparkCutActive = false;
      s.sparkCutTimer  = 0;
    }
  }

  const fuelCutMult = s.sparkCutActive ? 0.0 : 1.0;

  // Теплота за цикл на всі циліндри
  const Q_total = mFuelActual * c.cylinders * f.lhv * combEff * sp.etaOtto * fuelCutMult;

  // BMEP (Па): тиск на поршень за цикл
  const bmep = Q_total / sp.totalDisp;
  const T_endgas = T_K * Math.pow(c.compression * pressureRatio, sp.gammaFuel - 1);
  // Системи живлення з гіршим розподілом суміші (карбюратор/механічний ТНВД)
  // провокують детонацію раніше, якщо компресія вища за їх "комфортну" межу
  const compOverLimit = Math.max(0, c.compression - inj.maxCompression);
  const T_knock  = 800 + (f.octane - 92) * 8 - compOverLimit * 25;
  s.knock = T_endgas > T_knock && s.running && s.throttle > 0.1;

  // ── КРУТНИЙ МОМЕНТ ────────────────────────────────────
  // T_ind = BMEP × Vd / (4π)  — 4-тактна формула
  const T_ind = bmep * sp.totalDisp / (4 * Math.PI);

  // Тертя: Petroff + в'язкісне, менше при прогрітому двигуні
  const warmFactor  = Math.max(0.45, 1.0 - (s.engineTemp - s.ambientTemp) / 180);
  const fricMEP     = 2.6e4 * sp.fricFactor * warmFactor * (1.0 + s.omega / 1800);
  const T_friction  = fricMEP * sp.totalDisp / (4 * Math.PI);

  // ── ДРОСЕЛЬНІ (ПОМПОВІ) ВТРАТИ ─────────────────────────
  // Коли дросель прикритий, двигун всмоктує повітря через вузьку
  // щілину — це створює вакуум і додаткове гальмування (engine braking).
  // Сильно зростає з обертами, майже зникає при широко відкритому дроселі.
  const throttleClosedness = Math.max(0, 1 - throttleCurve * 1.3); // 1=закритий, 0=відкритий
  const pumpingMEP = 9.0e4 * throttleClosedness * throttleClosedness * (s.omega / 200);
  const T_pumping  = pumpingMEP * sp.totalDisp / (4 * Math.PI);

  const knockMult  = s.knock ? (0.65 + 0.35 * Math.random()) : 1.0;

  // Під час відсічки іскри: двигун стає насосом повітря — додаткове гальмування
  // (pumping losses збільшуються бо поршні всмоктують і стискають без віддачі енергії)
  const cutBrakingMEP = s.sparkCutActive ? 6.0e4 * (s.omega / 200) : 0;
  const T_cutBraking  = cutBrakingMEP * sp.totalDisp / (4 * Math.PI);

  const T_net      = T_ind * knockMult - T_friction - T_pumping - T_cutBraking;
  s.torque         = Math.max(0, T_ind * knockMult - T_friction);

  // ── ДИНАМІКА: α = T_нетто / I ────────────────────────
  // Паразитне навантаження: лінійне (генератор/помпа) + квадратичне (вентилятор, опір повітря)
  // Квадратична складова гарантує що кожен рівень газу знаходить
  // свою точку рівноваги при певних обертах (а не весь час тягне до redline).
  const T_parasitic = 3.0 + s.omega * 0.012 + s.omega * s.omega * 0.00008;
  const alpha = (T_net - T_parasitic) / sp.Itotal;
  s.omega     = Math.max(0, s.omega + alpha * dt);
  s.rpm       = s.omega * 60 / (2 * Math.PI);
  s.crankAngle += s.omega * dt;
  updatePistonPositions();

  // ── IDLE AIR CONTROL (як справжній IACV / дросельний байпас) ──
  // Реальний регулятор холостого ходу керує МАСОЮ ЗАРЯДУ, а не обертами
  // напряму. Тут ми моделюємо це як зворотний зв'язок ще ДО розрахунку
  // моменту: підправляємо effectiveThrottle на основі помилки RPM.
  // (Ця корекція застосована вище в effectiveThrottle через s.idleTrim)
  if (s.throttle < 0.02) {
    const rpmErr = idleRPM - s.rpm;            // >0 — обертів замало, треба більше газу
    // Інтегрально-пропорційна корекція, швидкість залежить від якості системи
    // (карбюратор/ТНВД регулюють холостий гірше і повільніше за ЕБУ-інжектор)
    const idleGain = 0.00006 * inj.idleQuality;
    s.idleTrim += rpmErr * idleGain * dt * 60;
    // Нестабільні системи (карбюратор) додають невелике тремтіння холостого
    const idleWobble = (1 - inj.idleQuality) * 0.015 * (Math.random() * 2 - 1);
    s.idleTrim = Math.max(-0.05, Math.min(0.35, s.idleTrim + idleWobble));
  } else {
    // При натиснутому газі trim повільно затухає до нуля
    s.idleTrim *= Math.max(0, 1 - dt * 2);
  }

  // ── STALL ─────────────────────────────────────────────
  s.stall = s.rpm < idleRPM * 0.4 && s.throttle < 0.04;
  if (s.stall && s.rpm < 80) {
    s.running = false;
    s.omega   = 0;
    s.rpm     = 0;
  }

  // ── ТЕМПЕРАТУРА ДВИГУНА ───────────────────────────────
  // Тепловхід пропорційний роботі за цикл
  const heatIn  = Q_total * 0.35 * dt * 0.0001; // 35% тепла йде в блок
  const coolSpd = 0.6 + s.omega / 2500;
  const heatOut = (s.engineTemp - s.ambientTemp) * coolSpd * dt;
  s.engineTemp  = Math.max(s.ambientTemp, Math.min(140, s.engineTemp + heatIn - heatOut));
  s.overheat    = s.engineTemp > 105;

  // ── ВІБРАЦІЯ ──────────────────────────────────────────
  s.power  = s.torque * s.omega;
  if (c.vibrationEnabled) {
    const balanceFactor = 1 / Math.min(12, c.cylinders); // 1 цил = макс тряска
    const rpmVib = Math.min(1, s.omega / 300);
    s.vibAmp = balanceFactor * rpmVib * (s.knock ? 2.8 : 1.0)
             * (0.6 + 0.4 * (1 - s.throttle)); // на холостому трохи більше
  } else {
    s.vibAmp = 0;
  }
};

function updatePistonPositions() {
  const s  = window.state;
  const sp = window.spec;
  const c  = window.cfg;
  const r  = sp.crankRadius;
  const L  = c.conrodLength;
  s.pistonY = [];
  for (let i = 0; i < c.cylinders; i++) {
    const theta = s.crankAngle + sp.firingAngles[i];
    const sinT  = Math.sin(theta);
    const cosT  = Math.cos(theta);
    const inner = 1 - Math.pow(r / L * sinT, 2);
    const y     = r * cosT + L * Math.sqrt(Math.max(0, inner));
    const yMax  = r + L, yMin = -(r - L);
    s.pistonY.push((y - yMin) / (yMax - yMin));
  }
}

// ======================================================
// CANVAS RENDER
// ======================================================
window.drawEngine = function(canvas, ctx) {
  const s  = window.state;
  const c  = window.cfg;
  const sp = window.spec;
  const W  = canvas.width;
  const H  = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0b0d';
  ctx.fillRect(0, 0, W, H);

  const cylCount = Math.min(c.cylinders, 12);
  const slotW  = W / (cylCount + 1);
  const cylH   = H * 0.6;
  const baseY  = H * 0.82;

  // Crankshaft line
  ctx.strokeStyle = '#2a2f3a';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(W, baseY); ctx.stroke();

  for (let i = 0; i < cylCount; i++) {
    const cx         = (i + 0.5) * slotW + slotW / 2;
    const pistonFrac = s.pistonY[i] !== undefined ? s.pistonY[i] : 0;
    const pistonTopY = baseY - cylH * 0.05 - pistonFrac * (cylH * 0.72);
    const ph         = Math.max(8, cylH * 0.12);
    const cw         = Math.max(18, slotW * 0.58);

    // Cylinder walls
    ctx.strokeStyle = '#3a4050';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - cw / 2, baseY - cylH, cw, cylH);

    // Combustion flash
    const theta    = s.crankAngle + (sp.firingAngles[i] || 0);
    const thetaMod = ((theta % (4 * Math.PI)) + 4 * Math.PI) % (4 * Math.PI);
    const isFiring = s.running && s.throttle > 0.01 && (thetaMod < 0.32 || (thetaMod > 5.9 && thetaMod < 6.4));
    if (isFiring) {
      const grd = ctx.createRadialGradient(cx, baseY - cylH + 8, 2, cx, baseY - cylH + 8, cw * 0.7);
      grd.addColorStop(0, 'rgba(255,220,60,0.95)');
      grd.addColorStop(0.4,'rgba(255,100,0,0.6)');
      grd.addColorStop(1,  'rgba(255,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(cx - cw / 2, baseY - cylH, cw, cylH * 0.45);
    }

    // Piston
    const grad = ctx.createLinearGradient(cx - cw/2+2, 0, cx + cw/2-2, 0);
    grad.addColorStop(0, '#556'); grad.addColorStop(0.5,'#aab'); grad.addColorStop(1,'#556');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - cw/2 + 3, pistonTopY, cw - 6, ph);

    // Conrod
    const crankTheta = s.crankAngle + (sp.firingAngles[i] || 0) + Math.PI;
    const cPinX = cx + sp.crankRadius * Math.sin(crankTheta) * H * 0.55;
    const cPinY = baseY - sp.crankRadius * Math.cos(crankTheta) * H * 0.55;
    ctx.strokeStyle = '#5a6070'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, pistonTopY + ph); ctx.lineTo(cPinX, cPinY); ctx.stroke();
    ctx.fillStyle = '#e85d00';
    ctx.beginPath(); ctx.arc(cPinX, cPinY, 4, 0, Math.PI*2); ctx.fill();

    // Valve indicators
    if (c.valvesPerCyl >= 2) {
      const intOpen = thetaMod > 3.3 && thetaMod < 2*Math.PI + 0.5;
      const exhOpen = thetaMod > 5.6 && thetaMod < 4*Math.PI;
      ctx.fillStyle = intOpen ? '#00e87a' : '#0d2010';
      ctx.fillRect(cx - cw/2 + 3, baseY - cylH - 5, (cw-6)*0.45, 6);
      ctx.fillStyle = exhOpen ? '#e85d00' : '#201000';
      ctx.fillRect(cx + 1, baseY - cylH - 5, (cw-6)*0.45, 6);
    }
  }

  // Flywheel
  const fwR  = Math.min(22, H * 0.14);
  const fwCx = fwR + 8;
  const fwCy = baseY - fwR - 4;
  ctx.strokeStyle = '#3a4050'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(fwCx, fwCy, fwR, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = '#e85d00'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(fwCx, fwCy);
  ctx.lineTo(fwCx + fwR * Math.cos(s.crankAngle), fwCy + fwR * Math.sin(s.crankAngle));
  ctx.stroke();

  // Turbo badge
  if (c.turboType !== 'na' && sp.rpmPeak) {
    const tx = W - 48; const ty = 26; const tr = 20;
    const spoolFrac = Math.min(1, s.boost / (c.boostTarget || 0.01));
    ctx.strokeStyle = `hsl(${spoolFrac * 30}, 90%, 55%)`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(tx, ty, tr, -Math.PI*0.8, -Math.PI*0.8 + spoolFrac * Math.PI * 1.6);
    ctx.stroke();
    ctx.fillStyle = '#5a6070';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(c.turboType.toUpperCase(), tx, ty + tr + 10);
  }

  // Overheat glow
  if (s.engineTemp > 90) {
    const intensity = (s.engineTemp - 90) / 50;
    ctx.fillStyle = `rgba(200,50,0,${intensity * 0.15})`;
    ctx.fillRect(0, 0, W, H);
  }
};

// ======================================================
// SMOKE
// ======================================================
window.updateSmoke = function(smokeCanvas, sctx, dt, enabled) {
  const s = window.state;
  if (enabled && s.running && (s.rich || s.engineTemp < 50 || s.throttle > 0.75)) {
    for (let k = 0; k < 2; k++) {
      s.smokeParticles.push({
        x: smokeCanvas.width * (0.1 + Math.random() * 0.8),
        y: smokeCanvas.height * 0.88,
        vx: (Math.random() - 0.5) * 30,
        vy: -45 - Math.random() * 55,
        life: 1.0,
        r: 6 + Math.random() * 12,
        col: s.rich ? 'rgba(60,40,0,' : s.engineTemp < 50 ? 'rgba(200,200,200,' : 'rgba(80,80,80,',
      });
    }
  }
  sctx.clearRect(0, 0, smokeCanvas.width, smokeCanvas.height);
  s.smokeParticles = s.smokeParticles.filter(p => p.life > 0);
  for (const p of s.smokeParticles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.r += 5 * dt; p.life -= 0.6 * dt;
    sctx.beginPath(); sctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    sctx.fillStyle = p.col + Math.max(0, p.life * 0.4) + ')';
    sctx.fill();
  }
};

// ======================================================
// RPM ARC
// ======================================================
window.drawRPMArc = function() {
  const sp = window.spec;
  const s  = window.state;
  const scaleMax = sp.gaugeMaxRPM || sp.maxRPM;
  if (!scaleMax) return;
  const rpmFrac = Math.min(1, s.rpm / scaleMax);
  const cx = 45, cy = 50, r = 38;
  const startA = Math.PI * 0.75;
  const endA   = Math.PI * 2.25;
  const curA   = startA + rpmFrac * (endA - startA);

  function arc(a1, a2) {
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const lg = (a2 - a1) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2}`;
  }

  document.getElementById('rpm-bg-arc').setAttribute('d', arc(startA, endA));
  const col = rpmFrac > 0.85 ? '#e82020' : rpmFrac > 0.7 ? '#ffa033' : '#e85d00';
  const fg  = document.getElementById('rpm-fg-arc');
  fg.setAttribute('d', rpmFrac > 0.001 ? arc(startA, curA) : '');
  fg.setAttribute('stroke', col);
  document.getElementById('rpm-display').textContent = Math.round(s.rpm);
};
