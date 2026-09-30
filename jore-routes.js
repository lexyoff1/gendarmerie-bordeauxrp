// Jore (créateur d'embeds + commandes slash) intégré au panel admin.
// À placer à côté de server.js. Toutes les routes sont réservées aux admins
// (même protection que le reste du panel) et chaque action envoie un MP de suivi.
const axios = require("axios");
const path = require("path");

const API = "https://discord.com/api/v10";
const ID = /^\d{17,20}$/;
const WEBHOOK = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

module.exports = function setupJore({ app, bot, guard, notify, getData, saveData }) {
    const botHeaders = () => ({ Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` });
    const errText = e => e.response?.data ? JSON.stringify(e.response.data) : e.message;
    const who = req => `${req.session.user?.username || "Inconnu"} (${req.session.user?.id || "ID inconnu"})`;
    const now = () => new Date().toLocaleString("fr-FR");
    const cut = (s, n) => String(s || "").slice(0, n);
    const readCommands = () => getData().joreCommands || [];
    const writeCommands = commands => { const db = getData(); db.joreCommands = commands; saveData(db); };

    // ---- Réponse du bot aux commandes slash créées ici ----
    bot.on("interactionCreate", async i => {
        if (!i.isChatInputCommand()) return;
        const cmd = readCommands().find(c => c.name === i.commandName);
        if (!cmd) return;
        await i.reply({
            content: cmd.reply.content || undefined,
            embeds: cmd.reply.embeds || [],
            flags: cmd.ephemeral ? 64 : undefined
        }).catch(err => console.log("Erreur commande Jore :", err.message));
    });

    // ---- Page (affichée dans un iframe de admin.html) ----
    app.get("/admin/jore", guard, (req, res) => res.sendFile(path.join(__dirname, "public", "jore.html")));

    // ---- Envoyer / modifier un message ----
    app.post("/api/jore/send", guard, async (req, res) => {
        const { mode, webhookUrl, channelId, payload, messageId } = req.body || {};
        if (messageId && !ID.test(String(messageId))) return res.status(400).json({ error: "ID de message invalide." });
        if (!payload || typeof payload !== "object") return res.status(400).json({ error: "Payload manquant." });
        try {
            let r;
            if (mode === "webhook") {
                if (!WEBHOOK.test(String(webhookUrl || ""))) return res.status(400).json({ error: "URL de webhook invalide." });
                const q = payload.components ? "&with_components=true" : "";
                r = messageId
                    ? await axios.patch(`${webhookUrl}/messages/${messageId}?wait=true${q}`, payload)
                    : await axios.post(webhookUrl + "?wait=true" + q, payload);
            } else {
                if (!ID.test(String(channelId || ""))) return res.status(400).json({ error: "ID de salon invalide." });
                const { username, avatar_url, ...botPayload } = payload;
                r = messageId
                    ? await axios.patch(`${API}/channels/${channelId}/messages/${messageId}`, botPayload, { headers: botHeaders() })
                    : await axios.post(`${API}/channels/${channelId}/messages`, botPayload, { headers: botHeaders() });
            }
            res.json({ success: true });

            const m = r.data || {};
            const link = m.channel_id && m.id ? `https://discord.com/channels/${process.env.GUILD_ID}/${m.channel_id}/${m.id}` : "Non disponible";
            const e0 = (payload.embeds || [])[0] || {};
            const apercu = cut(payload.content || e0.title || e0.description, 300) || "(sans texte)";
            await notify(
`${messageId ? "✏️ EMBED / MESSAGE MODIFIÉ" : "📤 EMBED / MESSAGE ENVOYÉ"}

Par : ${who(req)}
Via : ${mode === "webhook" ? "Webhook" : "Bot (salon " + channelId + ")"}
Embeds : ${(payload.embeds || []).length}
Aperçu : ${apercu}
Lien : ${link}
Date : ${now()}`);
        } catch (e) {
            if (!res.headersSent) res.status(502).json({ error: errText(e) });
        }
    });

    // ---- Charger un message existant ----
    app.post("/api/jore/load", guard, async (req, res) => {
        const { mode, webhookUrl, channelId, messageId } = req.body || {};
        if (!ID.test(String(messageId || ""))) return res.status(400).json({ error: "ID de message invalide." });
        try {
            let r;
            if (mode === "webhook") {
                if (!WEBHOOK.test(String(webhookUrl || ""))) return res.status(400).json({ error: "URL de webhook invalide." });
                r = await axios.get(`${webhookUrl}/messages/${messageId}`);
            } else {
                if (!ID.test(String(channelId || ""))) return res.status(400).json({ error: "ID de salon invalide." });
                r = await axios.get(`${API}/channels/${channelId}/messages/${messageId}`, { headers: botHeaders() });
            }
            const { content, embeds, components } = r.data;
            res.json({ content, embeds, components });
        } catch (e) {
            res.status(502).json({ error: errText(e) });
        }
    });

    // ---- Commandes slash ----
    app.get("/api/jore/commands", guard, (req, res) => res.json(readCommands()));

    app.post("/api/jore/commands", guard, async (req, res) => {
        const { name, description, reply, ephemeral } = req.body || {};
        if (!/^[a-z0-9_-]{1,32}$/.test(String(name || ""))) return res.status(400).json({ error: "Nom : 1-32 caractères, minuscules, chiffres, - ou _." });
        if (!String(description || "").trim() || String(description).length > 100) return res.status(400).json({ error: "Description requise (100 max)." });
        if (!reply || (!reply.content && !(reply.embeds || []).length)) return res.status(400).json({ error: "La réponse est vide." });
        try {
            const r = await axios.post(
                `${API}/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${process.env.GUILD_ID}/commands`,
                { name, description: String(description).trim(), type: 1 },
                { headers: botHeaders() }
            );
            writeCommands([...readCommands().filter(c => c.name !== name),
                { id: r.data.id, name, description, reply, ephemeral: !!ephemeral, createdBy: who(req) }]);
            res.json({ success: true });
            await notify(
`➕ COMMANDE SLASH CRÉÉE

Par : ${who(req)}
Commande : /${name}
Description : ${cut(description, 100)}
Réponse : ${cut(reply.content, 300) || "(embed uniquement)"}
Privée : ${ephemeral ? "oui" : "non"}
Date : ${now()}`);
        } catch (e) {
            if (!res.headersSent) res.status(502).json({ error: errText(e) });
        }
    });

    app.delete("/api/jore/commands/:name", guard, async (req, res) => {
        const commands = readCommands();
        const cmd = commands.find(c => c.name === req.params.name);
        if (!cmd) return res.status(404).json({ error: "Commande introuvable." });
        try {
            await axios.delete(
                `${API}/applications/${process.env.DISCORD_CLIENT_ID}/guilds/${process.env.GUILD_ID}/commands/${cmd.id}`,
                { headers: botHeaders() }
            );
        } catch (e) {
            if (e.response?.status !== 404) return res.status(502).json({ error: errText(e) });
        }
        writeCommands(commands.filter(c => c.name !== cmd.name));
        res.json({ success: true });
        await notify(
`🗑️ COMMANDE SLASH SUPPRIMÉE

Par : ${who(req)}
Commande : /${cmd.name}
Date : ${now()}`);
    });
};
