/* protect.js - dissuasion côté navigateur (Ctrl+U, F12, clic droit, DevTools)
 * Ce n'est PAS une vraie sécurité : la protection réelle est côté serveur.
 * Les admins sont exemptés pour pouvoir déboguer. */
(async function () {
    // Exempter les admins
    try {
        const r = await fetch("/api/is-admin", { credentials: "same-origin" });
        const d = await r.json();
        if (d && d.isAdmin) return;
    } catch (e) { /* en cas d'erreur, on protège */ }

    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    function blocked() {
        document.documentElement.innerHTML =
            '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#11182e;color:#d4af37;font-family:Arial,sans-serif;text-align:center">' +
            '<div><h1>🚫 Accès refusé</h1><p style="color:#b0b0b0">Les outils de développement ne sont pas autorisés sur ce portail.</p>' +
            '<a href="/" style="color:#d4af37">Retour à l\'accueil</a></div></body>';
    }

    // Clic droit
    document.addEventListener("contextmenu", e => e.preventDefault());

    // Raccourcis clavier : F12, Ctrl+U, Ctrl+S, Ctrl+Shift+I/J/C, Cmd+Option+I/J/C/U
    document.addEventListener("keydown", e => {
        const k = (e.key || "").toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        if (
            e.key === "F12" ||
            (ctrl && ["u", "s"].includes(k)) ||
            (ctrl && e.shiftKey && ["i", "j", "c"].includes(k)) ||
            (e.metaKey && e.altKey && ["i", "j", "c", "u"].includes(k))
        ) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);

    // Empêcher le glisser-déposer d'images
    document.addEventListener("dragstart", e => e.preventDefault());

    if (isMobile) return;

    // Détection DevTools ouverts (fenêtre ancrée) : écart taille intérieure / extérieure
    let strikes = 0;
    setInterval(() => {
        const widthGap = window.outerWidth - window.innerWidth > 200;
        const heightGap = window.outerHeight - window.innerHeight > 200;
        if (widthGap || heightGap) {
            if (++strikes >= 3) blocked();
        } else {
            strikes = 0;
        }
    }, 1000);

    // Détection via débogueur : si DevTools est ouvert, "debugger" ralentit fortement
    setInterval(() => {
        const start = performance.now();
        (function () {}).constructor("debugger")();
        if (performance.now() - start > 150) blocked();
    }, 2000);
})();
