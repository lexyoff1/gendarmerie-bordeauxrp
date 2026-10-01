const fs = require("fs");
const path = require("path");
const axios = require("axios");

const AVATAR_DIR = process.env.AVATARS_DIR || path.join(__dirname, "public", "assets", "avatars");
const SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 heures
const DELAY_BETWEEN_USERS_MS = 1000;          // évite le rate limit Discord

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function ensureDir() {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

// Supprime tous les fichiers d'un utilisateur sauf `keepFile` (null = tout supprimer)
function deleteOldAvatars(userId, keepFile) {
    for (const file of fs.readdirSync(AVATAR_DIR)) {
        if (file.startsWith(`${userId}-`) && file !== keepFile) {
            try {
                fs.unlinkSync(path.join(AVATAR_DIR, file));
                console.log(`[Jore] Ancien avatar supprimé : ${file}`);
            } catch (err) {
                console.log("[Jore] Suppression impossible :", file, err.message);
            }
        }
    }
}

async function downloadAvatar(userId, hash) {
    const ext = hash.startsWith("a_") ? "gif" : "png";
    const fileName = `${userId}-${hash}.${ext}`;
    const filePath = path.join(AVATAR_DIR, fileName);

    if (fs.existsSync(filePath)) return fileName; // déjà téléchargé

    const res = await axios.get(
        `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=128`,
        { responseType: "arraybuffer", timeout: 15000 }
    );
    fs.writeFileSync(filePath, Buffer.from(res.data));
    return fileName;
}

function setupAvatarSync({ bot, getData, saveData, getGuildMember }) {
    ensureDir();
    let running = false;

    async function syncAvatars() {
        if (running) return;
        running = true;
        console.log("[Jore] Synchronisation des avatars...");

        const updates = []; // { id, avatar, avatarFile }

        try {
            const users = [...getData().users];

            for (const user of users) {
                try {
                    const member = await getGuildMember(user.id);
                    const hash = member.user?.avatar || null;

                    if (!hash) {
                        updates.push({ id: user.id, avatar: "", avatarFile: "" });
                    } else {
                        const fileName = await downloadAvatar(user.id, hash);
                        updates.push({ id: user.id, avatar: hash, avatarFile: fileName });
                    }
                } catch (err) {
                    const status = err.response?.status;
                    if (status === 429) {
                        console.log("[Jore] Rate limit Discord, arrêt de la synchro (reprise dans 2h).");
                        break;
                    }
                    // 404 = membre parti du serveur : on garde l'avatar local existant
                    if (status !== 404) {
                        console.log(`[Jore] Erreur pour ${user.id} :`, err.message);
                    }
                }
                await sleep(DELAY_BETWEEN_USERS_MS);
            }

            // On relit la base APRÈS les appels réseau pour ne pas écraser
            // des modifications faites entre-temps.
            const db = getData();
            for (const upd of updates) {
                const user = db.users.find(u => u.id === upd.id);
                if (!user) continue;
                user.avatar = upd.avatar;
                user.avatarFile = upd.avatarFile;
                deleteOldAvatars(user.id, upd.avatarFile || null);
            }
            saveData(db);

            // Nettoyage des fichiers orphelins (utilisateurs supprimés de la base)
            const knownIds = new Set(db.users.map(u => u.id));
            for (const file of fs.readdirSync(AVATAR_DIR)) {
                const ownerId = file.split("-")[0];
                if (!knownIds.has(ownerId)) {
                    try { fs.unlinkSync(path.join(AVATAR_DIR, file)); } catch {}
                }
            }

            console.log(`[Jore] Synchro terminée : ${updates.length} avatar(s) vérifié(s).`);
        } catch (err) {
            console.log("[Jore] Erreur synchro avatars :", err.message);
        } finally {
            running = false;
        }
    }

    function start() {
        syncAvatars();
        setInterval(syncAvatars, SYNC_INTERVAL_MS);
    }

    if (bot?.isReady?.()) start();
    else bot.once("ready", start);

    return { syncAvatars, AVATAR_DIR };
}

module.exports = setupAvatarSync;
