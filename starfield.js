/* =======================================================================
   STARFIELD — tunnel d'hyperespace.
   Système 100% indépendant du logo et du DJ : sa propre scène Three.js,
   sa propre caméra, son propre rendu, sur son propre canvas — tout au
   fond de la scène (le logo et le DJ sont peints par-dessus dans le HTML,
   donc ce système ne peut jamais les cacher).

   Principe : des milliers de points fixes dans l'espace, répartis sur
   3 profondeurs (loin / intermédiaire / proche), qui avancent tous vers
   la caméra le long de l'axe Z. Plus un point est proche, plus il va
   vite, plus il grossit (grâce à l'atténuation de taille par la
   perspective, native à Three.js) et plus sa traînée est visible.
   Quand un point dépasse la caméra, il est immédiatement recyclé très
   loin derrière avec une nouvelle position aléatoire — jamais de
   création/destruction d'objet, juste la même mémoire réutilisée en
   boucle, donc très léger pour un ordinateur peu puissant.

   =======================================================================
   RÉGLAGES RAPIDES — tout ce qu'il y a à changer plus tard est ici.
   ======================================================================= */
const STARFIELD_CONFIG = {
  // Nombre de points par couche de profondeur. Baisser ces chiffres
  // = moins d'étoiles = plus de performance.
  counts: { far: 1500, mid: 750, near: 260 },

  // Vitesse de base (unités 3D / seconde) de chaque couche, avant la
  // petite variation aléatoire donnée à chaque étoile.
  speed: { far: 55, mid: 150, near: 380 },

  // Taille des points (en pixels, avant l'effet de perspective qui les
  // fait grossir en s'approchant).
  size: { far: 1.4, mid: 2.2, near: 3.4 },

  // Opacité de base de chaque couche.
  opacity: { far: 0.5, mid: 0.72, near: 0.92 },

  // Répartition des couleurs (doit faire 1 au total) : vert néon =
  // couleur principale du projet, blanc, bleu électrique très discret,
  // violet très discret.
  colorWeights: { green: 0.45, white: 0.30, blue: 0.15, violet: 0.10 },

  // Longueur des traînées sur les étoiles les plus rapides (couche
  // "near" uniquement) : facteur multiplié par la vitesse du moment.
  trailFactor: 0.11,

  // Vagues d'accélération : intervalle (en secondes) entre deux
  // accélérations, et forme de l'accélération elle-même.
  burst: {
    minGap: 20,          // au minimum 20s entre deux vagues
    maxGap: 40,          // au maximum 40s
    rampUp: 1.2,         // durée de la montée en vitesse
    hold: 1.6,           // durée du palier à vitesse maximale
    rampDown: 2.2,       // durée du retour à la vitesse normale
    peakMultiplier: 3.4, // vitesse multipliée par ce facteur au pic
  },
};

(function () {
  const canvas = document.getElementById('starfield-canvas');
  if (!canvas || !window.THREE) return;

  const CFG = STARFIELD_CONFIG;

  // --- Scène, caméra (fixe, on ne fait avancer que les étoiles), rendu ----
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 4000);
  camera.position.set(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width === w && canvas.height === h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // --- Texture d'un point net (cœur lumineux + chute rapide), pas une
  // grosse boule floue -------------------------------------------------
  function makeStarTexture() {
    const size = 32;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }
  const starTexture = makeStarTexture();

  // --- Palette : vert néon dominant, blanc, touches bleu/violet discrètes -
  function randomStarColor() {
    const roll = Math.random();
    const w = CFG.colorWeights;
    if (roll < w.green) {
      return [0.35 + Math.random() * 0.25, 1.0, 0.55 + Math.random() * 0.25];
    } else if (roll < w.green + w.white) {
      const b = 0.85 + Math.random() * 0.15;
      return [b, b, b];
    } else if (roll < w.green + w.white + w.blue) {
      return [0.35 + Math.random() * 0.1, 0.55 + Math.random() * 0.2, 1.0];
    }
    return [0.58 + Math.random() * 0.12, 0.28 + Math.random() * 0.1, 0.9];
  }

  // --- Une couche de profondeur : des points qui avancent en Z vers la
  // caméra et se recyclent très loin derrière une fois passés. -------------
  function createLayer({ count, zFar, zNear, spread, baseSpeed, size, opacity }) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const brightness = new Float32Array(count);
    const speeds = new Float32Array(count);

    function place(i, spawnAcrossFullRange) {
      // disque uniforme (racine carrée) pour éviter un amas au centre
      const rad = spread * Math.sqrt(Math.random());
      const ang = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(ang) * rad;
      positions[i * 3 + 1] = Math.sin(ang) * rad;
      positions[i * 3 + 2] = spawnAcrossFullRange
        ? zFar + Math.random() * (zNear - zFar)          // remplissage initial : réparti sur tout le tunnel
        : zFar + Math.random() * (zNear - zFar) * 0.25;   // recyclage : réapparaît loin derrière

      const b = Math.pow(Math.random(), 1.6) * 0.75 + 0.25;
      brightness[i] = b;
      const [r, g, bl] = randomStarColor();
      colors[i * 3] = r * b;
      colors[i * 3 + 1] = g * b;
      colors[i * 3 + 2] = bl * b;

      speeds[i] = baseSpeed * (0.6 + Math.random() * 0.8);
    }

    for (let i = 0; i < count; i++) place(i, true);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size,
      sizeAttenuation: true,
      vertexColors: true,
      map: starTexture,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);

    return { points, geometry, positions, colors, speeds, count, zFar, zNear, spread, place };
  }

  const RECYCLE_Z = 25; // une étoile qui dépasse cette limite disparaît et repart de loin

  const farLayer = createLayer({
    count: CFG.counts.far, zFar: -1900, zNear: -850, spread: 900,
    baseSpeed: CFG.speed.far, size: CFG.size.far, opacity: CFG.opacity.far,
  });
  const midLayer = createLayer({
    count: CFG.counts.mid, zFar: -850, zNear: -280, spread: 480,
    baseSpeed: CFG.speed.mid, size: CFG.size.mid, opacity: CFG.opacity.mid,
  });
  const nearLayer = createLayer({
    count: CFG.counts.near, zFar: -320, zNear: -50, spread: 230,
    baseSpeed: CFG.speed.near, size: CFG.size.near, opacity: CFG.opacity.near,
  });
  scene.add(farLayer.points, midLayer.points, nearLayer.points);

  // --- Traînées : uniquement sur la couche proche (les plus rapides), pour
  // renforcer la sensation de vitesse sans alourdir le rendu. Une ligne par
  // étoile, du "cœur" (couleur pleine) vers la "queue" (couleur atténuée),
  // recalculée chaque frame à partir de la position déjà mise à jour du
  // point — pas besoin de mémoriser l'image précédente. --------------------
  const trailCount = nearLayer.count;
  const trailPositions = new Float32Array(trailCount * 2 * 3);
  const trailColors = new Float32Array(trailCount * 2 * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  const trailMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial);
  scene.add(trails);

  function updateTrails(speedMultiplier) {
    const pos = nearLayer.positions;
    const col = nearLayer.colors;
    const spd = nearLayer.speeds;
    for (let i = 0; i < trailCount; i++) {
      const p = i * 3, l = i * 6;
      const x = pos[p], y = pos[p + 1], z = pos[p + 2];
      const trailLen = Math.max(4, spd[i] * speedMultiplier * CFG.trailFactor);

      // queue (loin, atténuée)
      trailPositions[l] = x;
      trailPositions[l + 1] = y;
      trailPositions[l + 2] = z - trailLen;
      trailColors[l] = col[p] * 0.12;
      trailColors[l + 1] = col[p + 1] * 0.12;
      trailColors[l + 2] = col[p + 2] * 0.12;

      // tête (position actuelle, couleur pleine)
      trailPositions[l + 3] = x;
      trailPositions[l + 4] = y;
      trailPositions[l + 5] = z;
      trailColors[l + 3] = col[p];
      trailColors[l + 4] = col[p + 1];
      trailColors[l + 5] = col[p + 2];
    }
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.color.needsUpdate = true;
  }

  // --- Avancement d'une couche : chaque étoile avance en Z ; celles qui
  // dépassent la caméra sont recyclées très loin derrière. -----------------
  function updateLayer(layer, dt, speedMultiplier) {
    const pos = layer.positions;
    let recycled = false;
    for (let i = 0; i < layer.count; i++) {
      const idx = i * 3;
      pos[idx + 2] += layer.speeds[i] * speedMultiplier * dt;
      if (pos[idx + 2] > RECYCLE_Z) {
        layer.place(i, false);
        recycled = true;
      }
    }
    layer.geometry.attributes.position.needsUpdate = true;
    if (recycled) layer.geometry.attributes.color.needsUpdate = true;
  }

  // --- Vagues d'accélération périodiques : jamais de flash, juste la
  // vitesse qui monte et redescend en douceur (ease in/out). ---------------
  function smoothstep(x) {
    x = Math.min(1, Math.max(0, x));
    return x * x * (3 - 2 * x);
  }

  // Lecture seule, pour que d'autres éléments (le titre "DJ BELDA", par
  // exemple) puissent réagir légèrement aux accélérations sans qu'on ait
  // besoin de toucher au tunnel d'étoiles lui-même : 0 = vitesse normale,
  // 1 = en pleine accélération.
  window.BeldaStarfield = window.BeldaStarfield || {};
  window.BeldaStarfield.burstIntensity = 0;

  let globalTime = 0;
  let speedMultiplier = 1;
  let burstPhase = 'idle';
  let burstPhaseStart = 0;
  let nextBurstAt = CFG.burst.minGap + Math.random() * (CFG.burst.maxGap - CFG.burst.minGap);

  function updateBurst(dt) {
    globalTime += dt;
    const B = CFG.burst;

    if (burstPhase === 'idle' && globalTime >= nextBurstAt) {
      burstPhase = 'rampUp';
      burstPhaseStart = globalTime;
    }

    if (burstPhase === 'rampUp') {
      const p = (globalTime - burstPhaseStart) / B.rampUp;
      speedMultiplier = 1 + (B.peakMultiplier - 1) * smoothstep(p);
      if (p >= 1) { burstPhase = 'hold'; burstPhaseStart = globalTime; }
    } else if (burstPhase === 'hold') {
      speedMultiplier = B.peakMultiplier;
      if (globalTime - burstPhaseStart >= B.hold) { burstPhase = 'rampDown'; burstPhaseStart = globalTime; }
    } else if (burstPhase === 'rampDown') {
      const p = (globalTime - burstPhaseStart) / B.rampDown;
      speedMultiplier = B.peakMultiplier - (B.peakMultiplier - 1) * smoothstep(p);
      if (p >= 1) {
        speedMultiplier = 1;
        burstPhase = 'idle';
        nextBurstAt = globalTime + B.minGap + Math.random() * (B.maxGap - B.minGap);
      }
    } else {
      speedMultiplier = 1;
    }

    const peak = Math.max(1.0001, B.peakMultiplier);
    window.BeldaStarfield.burstIntensity = Math.min(1, Math.max(0, (speedMultiplier - 1) / (peak - 1)));
  }

  // --- Boucle d'animation ---------------------------------------------
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05); // évite les sauts si l'onglet était en pause

    updateBurst(dt);
    updateLayer(farLayer, dt, speedMultiplier);
    updateLayer(midLayer, dt, speedMultiplier);
    updateLayer(nearLayer, dt, speedMultiplier);
    updateTrails(speedMultiplier);

    resize();
    renderer.render(scene, camera);
  }

  resize();
  animate();
})();