/* =======================================================================
   TIMELINE — orchestre l'apparition du logo, du DJ et des textes.

   - Le logo apparaît en fondu sur les 3 premières secondes, puis tourne
     en continu pour le reste de la soirée (voir logo3d.js).
   - Le DJ apparaît en fondu une seule fois, vers 7 secondes, puis reste
     visible tout le reste du set.
   - "OASIS / FERIA DE ALBACETE" apparaît à partir de 7 secondes et reste
     affiché ensuite en permanence, du même coup que le DJ, jusqu'à la fin.
   - "DJ BELDA" (le grand titre en haut, voir index.html / style.css) est
     totalement permanent et reste affiché sans interruption du tout
     début à la toute fin ; ce fichier se contente de lui donner un tout
     petit coup de glow en plus pendant les accélérations des étoiles
     filantes (voir plus bas), sans jamais le faire disparaître.
   ======================================================================= */

(function () {
  const djImg = document.querySelector('.dj-silhouette');
  const nameBox = document.querySelector('.name-reveal');
  const line1 = document.querySelector('.name-line1');
  const line2 = document.querySelector('.name-line2');
  const djBeldaTxt = document.querySelector('.dj-belda-tag .txt');

  window.BeldaTimeline = { logoIntro: 0 };

  if (!djImg || !nameBox || !line1 || !line2) return;

  const LOGO_INTRO_DURATION = 3.0;

  const DJ_START = 7.0;

  const TEXT_START = 7.0; // apparaît une fois, puis reste affiché en permanence

  function setText(t1, t2) {
    if (line1.textContent !== t1) line1.textContent = t1;
    const v2 = t2 || '';
    if (line2.textContent !== v2) line2.textContent = v2;
  }

  const clock0 = performance.now();

  function frame() {
    requestAnimationFrame(frame);
    const t = (performance.now() - clock0) / 1000;

    // --- logo : intensité d'apparition lue par logo3d.js ----------------
    window.BeldaTimeline.logoIntro = Math.min(1, t / LOGO_INTRO_DURATION);

    // --- DJ : apparaît une fois, reste visible ensuite ------------------
    if (t >= DJ_START) djImg.classList.add('visible');

    // --- texte : apparaît une fois, reste affiché en permanence ---------
    if (t >= TEXT_START) {
      setText('OASIS', 'FERIA DE ALBACETE');
      nameBox.classList.add('visible');
    }
  }

  frame();

  // --- "DJ BELDA" : léger sursaut de glow pendant les accélérations -----
  // Complètement indépendant de la boucle ci-dessus (donc actif même si
  // un des éléments plus haut venait à manquer) : lit juste l'intensité
  // exposée par starfield.js et ajoute/retire une classe CSS — c'est la
  // transition définie dans style.css qui rend le changement doux.
  // Deux seuils différents (entrée/sortie) pour ne jamais "clignoter".
  if (djBeldaTxt) {
    const BURST_ON = 0.4;
    const BURST_OFF = 0.15;
    (function watchBurst() {
      requestAnimationFrame(watchBurst);
      const intensity = (window.BeldaStarfield && window.BeldaStarfield.burstIntensity) || 0;
      if (intensity > BURST_ON) djBeldaTxt.classList.add('burst-active');
      else if (intensity < BURST_OFF) djBeldaTxt.classList.remove('burst-active');
    })();
  }
})();