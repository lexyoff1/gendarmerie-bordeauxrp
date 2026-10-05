// ============================================================
// REMPLACE TOUT LE BLOC qui va de
//   "// BLOCAGES PERSISTANTS + CODES DE DÉBLOCAGE"
// jusqu'à la fin de la fonction createRateLimiter(...) (juste avant "const sleep = ...").
// getClientIp() au-dessus ne change pas.
// ============================================================

// ============================================================
// BLOCAGES PERSISTANTS + CODES DE DÉBLOCAGE
// - Un blocage (trop de requêtes OU trop d'échecs de connexion) est ENREGISTRÉ SUR DISQUE :
//   il survit au redémarrage du serveur.
// - Par défaut (BLOCKS_PERMANENT != "false") il ne se lève JAMAIS tout seul :
//   seul /debloque <code> sur Discord peut le lever.
// - Chaque blocage génère un code unique, affiché à la personne bloquée et envoyé en MP au responsable
//   avec le pseudo Discord de la personne bloquée.
// ============================================================
const BLOCKS_PERMANENT = process.env.BLOCKS_PERMANENT !== "false";
const PERMANENT_MS = 100 * 365 * 24 * 60 * 60 * 1000;
const PERMANENT_THRESHOLD_SECONDS = 10 * 365 * 24 * 60 * 60;
const BLOCKS_FILE = process.env.BLOCKS_FILE_PATH ||
    (process.env.DATA_FILE_PATH
        ? path.join(path.dirname(process.env.DATA_FILE_PATH), "blocks.json")
        : path.join(__dirname, "blocks.json"));

// Texte affiché à la personne bloquée. Tu peux le mettre dans le .env :
// UNBLOCK_CONTACT=Lexy (pseudo Discord : lexy_xxx)
const UNBLOCK_CONTACT = process.env.UNBLOCK_CONTACT || "un responsable sur Discord";

// Pseudo Discord de la personne bloquée (si elle est connectée avec Discord)
function describeBlockedUser(req) {
    const u = req.session?.user;
    if (!u) return "Non connecté (aucun compte Discord)";
    return `${u.username}${u.nomPrenom ? ` / ${u.nomPrenom}` : ""} (ID ${u.id})`;
}

const activeBlocks = new Map();     // code -> { blockKey, keys, reason, ip, discordUser, createdAt, expiresAt }
const blockCodeByKey = new Map();   // blockKey -> code
const failedAttempts = new Map();   // clé -> { count, lockedUntil, lastFailAt }
let lastBlockDmAt = 0;

function writeBlocksNow() {
    try {
        fs.mkdirSync(path.dirname(BLOCKS_FILE), { recursive: true });
        fs.writeFileSync(BLOCKS_FILE, JSON.stringify({
            failedAttempts: [...failedAttempts],
            activeBlocks: [...activeBlocks]
        }));
    } catch (err) {
        console.log("Erreur sauvegarde des blocages :", err.message);
    }
}

let blocksSaveTimer = null;
function saveBlocks() {
    if (blocksSaveTimer) return;
    blocksSaveTimer = setTimeout(() => {
        blocksSaveTimer = null;
        writeBlocksNow();
    }, 300);
}

function loadBlocks() {
    try {
        if (!fs.existsSync(BLOCKS_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(BLOCKS_FILE, "utf8"));
        const now = Date.now();
        for (const [key, value] of raw.failedAttempts || []) failedAttempts.set(key, value);
        for (const [code, value] of raw.activeBlocks || []) {
            if (value.expiresAt > now) {
                activeBlocks.set(code, value);
                blockCodeByKey.set(value.blockKey, code);
            }
        }
        console.log(`Blocages restaurés : ${activeBlocks.size} actif(s).`);
    } catch (err) {
        console.log("Erreur lecture des blocages :", err.message);
    }
}
loadBlocks();

// Sauvegarde immédiate à l'arrêt du serveur
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        writeBlocksNow();
        process.exit(0);
    });
}

function generateUnlockCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(8);
    let out = "";
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return `JORE-${out.slice(0, 4)}-${out.slice(4)}`;
}

function issueUnlockCode({ blockKey, keys, reason, ip, ttlMs, discordUser }) {
    const existing = blockCodeByKey.get(blockKey);
    if (existing && activeBlocks.has(existing)) return existing;

    let code;
    do { code = generateUnlockCode(); } while (activeBlocks.has(code));

    const now = Date.now();
    activeBlocks.set(code, {
        blockKey, keys, reason, ip, discordUser,
        createdAt: now,
        expiresAt: now + Math.max(ttlMs || 0, 60 * 1000)
    });
    blockCodeByKey.set(blockKey, code);
    saveBlocks();

    // MP au responsable (max 1 MP toutes les 15 s pour éviter le spam en cas d'attaque)
    if (now - lastBlockDmAt > 15 * 1000) {
        lastBlockDmAt = now;
        sendDiscordDM(
            APPLICATION_DECISION_NOTIFY_ID,
`🔒 NOUVEAU BLOCAGE

Pseudo Discord : ${discordUser || "inconnu"}
Raison : ${reason}
IP : ${ip}
Code de déblocage : ${code}

Pour débloquer : /debloque code:${code}`
        );
    }

    return code;
}

function releaseUnlockCode(rawCode) {
    const code = String(rawCode || "").trim().toUpperCase();
    const entry = activeBlocks.get(code);
    if (!entry || entry.expiresAt <= Date.now()) {
        activeBlocks.delete(code);
        return null;
    }
    for (const key of entry.keys || []) failedAttempts.delete(key);
    activeBlocks.delete(code);
    blockCodeByKey.delete(entry.blockKey);
    saveBlocks();
    return entry;
}

setInterval(() => {
    const now = Date.now();
    for (const [code, entry] of activeBlocks) {
        if (entry.expiresAt <= now) {
            activeBlocks.delete(code);
            blockCodeByKey.delete(entry.blockKey);
        }
    }
    saveBlocks();
}, 60 * 1000).unref();

// ---- Verrouillage progressif après échecs : 5 échecs => 15 min, 10 => 30 min... (max 24 h)
// ---- En mode permanent : le 5e échec bloque jusqu'à /debloque.
const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of failedAttempts) {
        if (entry.lockedUntil <= now && now - entry.lastFailAt > FAILURE_MEMORY_MS) {
            failedAttempts.delete(key);
        }
    }
}, 10 * 60 * 1000).unref();

function getLockRemainingSeconds(...keys) {
    const now = Date.now();
    let remaining = 0;
    for (const key of keys) {
        const entry = failedAttempts.get(key);
        if (entry && entry.lockedUntil > now) {
            remaining = Math.max(remaining, Math.ceil((entry.lockedUntil - now) / 1000));
        }
    }
    return remaining;
}

function registerFailedAttempt(...keys) {
    const now = Date.now();
    for (const key of keys) {
        const entry = failedAttempts.get(key) || { count: 0, lockedUntil: 0, lastFailAt: 0 };
        entry.count++;
        entry.lastFailAt = now;

        if (entry.count % MAX_FAILED_ATTEMPTS === 0) {
            const level = entry.count / MAX_FAILED_ATTEMPTS;
            const lockMs = BLOCKS_PERMANENT
                ? PERMANENT_MS
                : Math.min(BASE_LOCK_MS * Math.pow(2, level - 1), MAX_LOCK_MS);
            entry.lockedUntil = now + lockMs;
        }

        failedAttempts.set(key, entry);
    }
    saveBlocks();
}

function clearFailedAttempts(...keys) {
    for (const key of keys) failedAttempts.delete(key);
    saveBlocks();
}

// Blocage pur (sans compteur d'échecs) utilisé par le limiteur de débit
function setTimedLock(key, ms) {
    failedAttempts.set(key, { count: 0, lockedUntil: Date.now() + ms, lastFailAt: 0 });
    saveBlocks();
}

function formatLockDuration(seconds) {
    if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} heure(s)`;
    if (seconds >= 60) return `${Math.ceil(seconds / 60)} minute(s)`;
    return `${seconds} seconde(s)`;
}

function blockedPageHtml(message, code) {
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès bloqué</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11182e;color:#f4f4f4;font-family:Arial,sans-serif}
main{width:min(480px,calc(100% - 32px));padding:32px;border:1px solid #d4af37;border-radius:12px;background:#1a1a2e;text-align:center}
h1{color:#d4af37}code{display:inline-block;margin-top:10px;padding:10px 18px;background:#0f1528;border:1px dashed #d4af37;border-radius:6px;font-size:1.3rem;letter-spacing:2px;color:#d4af37}
p{color:#b0b0b0;line-height:1.6}p b{color:#d4af37}</style></head><body><main><h1>🔒 Accès bloqué</h1>
<p>${message}</p>${code ? `<p>Pour être débloqué, contactez <b>${UNBLOCK_CONTACT}</b> et communiquez-lui ce code ainsi que votre pseudo Discord :</p><code>${code}</code>` : ""}</main></body></html>`;
}

function tooManyRequests(req, res, message, retryAfterSeconds, code) {
    if (retryAfterSeconds && retryAfterSeconds < PERMANENT_THRESHOLD_SECONDS) {
        res.set("Retry-After", String(retryAfterSeconds));
    }
    const fullMessage = code
        ? `${message} Pour être débloqué, contactez ${UNBLOCK_CONTACT} avec ce code : ${code}`
        : message;
    const wantsJson = req.originalUrl.startsWith("/api/") || !req.accepts("html");
    if (wantsJson) {
        return res.status(429).json({ success: false, error: fullMessage, unlockCode: code || null });
    }
    return res.status(429).send(blockedPageHtml(message, code));
}

// Réponse 429 pour un verrouillage après échecs de connexion. Retourne true si bloqué.
function lockResponse(req, res, keys, label) {
    const remaining = getLockRemainingSeconds(...keys);
    if (remaining <= 0) return false;

    const code = issueUnlockCode({
        blockKey: `lock:${keys.join("|")}`,
        keys,
        reason: `Trop d'échecs - ${label}`,
        ip: getClientIp(req),
        ttlMs: remaining * 1000,
        discordUser: describeBlockedUser(req)
    });

    const permanent = remaining >= PERMANENT_THRESHOLD_SECONDS;
    if (!permanent) res.set("Retry-After", String(remaining));

    res.status(429).json({
        success: false,
        error: permanent
            ? `Accès bloqué après trop d'échecs. Contactez ${UNBLOCK_CONTACT} avec ce code pour être débloqué : ${code}`
            : `Trop d'échecs. Réessayez dans ${formatLockDuration(remaining)} ou contactez ${UNBLOCK_CONTACT} avec ce code : ${code}`,
        unlockCode: code
    });
    return true;
}

function createRateLimiter({ name, windowMs, max, message, keyFn, permanent = BLOCKS_PERMANENT, banMs: customBanMs }) {
    const hits = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (entry.resetAt <= now) hits.delete(key);
        }
    }, Math.min(windowMs, 60 * 1000)).unref();

    const blockResponse = (req, res, banKey, remainingSeconds) => {
        const code = issueUnlockCode({
            blockKey: banKey,
            keys: [banKey],
            reason: `Trop de requêtes (${req.method} ${req.originalUrl.split("?")[0]})`,
            ip: getClientIp(req),
            ttlMs: remainingSeconds * 1000,
            discordUser: describeBlockedUser(req)
        });
        const text = permanent
            ? "Accès bloqué pour activité suspecte (trop de requêtes)."
            : (message || "Trop de requêtes. Réessayez plus tard.");
        return tooManyRequests(req, res, text, remainingSeconds, code);
    };

    return (req, res, next) => {
        const key = keyFn ? keyFn(req) : getClientIp(req);
        const banKey = `rate:${name}:${key}`;

        // Déjà bloqué (y compris après un redémarrage du serveur)
        const banRemaining = getLockRemainingSeconds(banKey);
        if (banRemaining > 0) return blockResponse(req, res, banKey, banRemaining);

        const now = Date.now();
        let entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }

        entry.count++;

        if (entry.count > max) {
            const banMs = permanent
                ? PERMANENT_MS
                : (customBanMs || Math.max(1000, entry.resetAt - now));
            setTimedLock(banKey, banMs);
            hits.delete(key);
            return blockResponse(req, res, banKey, Math.ceil(banMs / 1000));
        }

        next();
    };
}

// ============================================================
// FIN DU BLOC À REMPLACER
// ============================================================


// ============================================================
// 2e modification (plus bas dans server.js, dans discordBot.on("interactionCreate"))
// Remplace le return final par :
// ============================================================
/*
    console.log(`[SECURITE] Déblocage par ${interaction.user.username} (${interaction.user.id}) - ${entry.reason} - IP ${entry.ip}`);
    return interaction.reply({
        content: `✅ Débloqué.\nPseudo Discord : ${entry.discordUser || "inconnu"}\nRaison du blocage : ${entry.reason}\nIP : ${entry.ip}`,
        ephemeral: true
    });
*/
