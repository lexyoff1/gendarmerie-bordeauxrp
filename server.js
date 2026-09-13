const express = require("express");
const session = require("express-session");
const axios = require("axios");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const ADMIN_ROLE_ID = "1500242566333857832";
const path = require("path");
require("dotenv").config();

const COMMANDEMENT_ROLES = {
    "1537874909093699604": "CG ・ Commandant Du Groupement",
    "1537875328423305289": "CC ・ Commandant De Compagnie",
    "1537875423260840058": "CB ・ Commandant De Brigade"
};

const ROLE_CB = "1537875423260840058";
const ROLE_RESP_CIR = "1537658191754821642";

async function notifyCB(ticket) {
    await sendDMToRole(
        ROLE_CB,
`🎫 Nouveau ticket commandement

Type : ${ticket.type}
Sujet : ${ticket.sujet}
Auteur : ${ticket.auteur}

Lien :
https://gendarmerie-bordeauxrp.onrender.com/tickets-commandement?id=${ticket.id}`
    );
}

const app = express();

// Le bot ne traite les MP que pour les administrateurs qui viennent d'être ajoutés.
// Le mot de passe est haché avant d'être enregistré.
const discordBot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
});

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPasswordHash) {
    const [salt, expectedHash] = String(storedPasswordHash || "").split(":");
    if (!salt || !expectedHash) return false;
    const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(actualHash, "hex"));
}

discordBot.on("messageCreate", async message => {
    if (message.author.bot || message.guild) return;

    const db = getData();
    const admin = (db.admins || []).find(item =>
        item.discordId === message.author.id && item.awaitingPasswordSetup === true
    );
    if (!admin) return;

    const password = message.content.trim();
    if (password.length < 8) {
        await message.reply("Votre mot de passe doit contenir au moins 8 caractères. Envoyez-en un nouveau.");
        return;
    }

    admin.passwordHash = hashPassword(password);
    admin.passwordSet = true;
    admin.awaitingPasswordSetup = false;
    admin.passwordSetAt = new Date().toISOString();
    saveData(db);
    await message.reply("✅ Votre mot de passe administrateur a bien été enregistré. Vous pouvez maintenant vous connecter au panel.");
});

discordBot.once("ready", () => console.log(`Bot Discord connecté : ${discordBot.user.tag}`));
if (process.env.DISCORD_BOT_TOKEN) {
    discordBot.login(process.env.DISCORD_BOT_TOKEN).catch(error =>
        console.error("Impossible de connecter le bot Discord :", error.message)
    );
} else {
    console.warn("DISCORD_BOT_TOKEN absent : les invitations par MP sont désactivées.");
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/assets/tenues/");
    },
    filename: (req, file, cb) => {
        const cleanName = file.originalname
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9.-]/g, "");

        cb(null, Date.now() + "-" + cleanName);
    }
});

const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/assets", express.static("public/assets"));
app.use("/style.css", express.static("public/style.css"));
app.use("/script.js", express.static("public/script.js"));

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assets", "logo-gendarmerie.png"));
});

app.use(session({
    secret: process.env.SESSION_SECRET || "secret123",
    resave: false,
    saveUninitialized: false
}));

const GRADES = [
    "COL ・ Colonel",
    "LCL ・ Lieutenant-Colonel",
    "CEN ・ Chef d’Escadron",
    "CNE ・ Capitaine",
    "LTN ・ Lieutenant",
    "SLT ・ Sous-Lieutenant",
    "ASP ・ Aspirant",
    "MAJ ・ Major",
    "ADC ・ Adjudant-Chef",
    "ADJ ・ Adjudant",
    "MDC ・ Maréchal des Logis-Chef",
    "GDC ・ Gendarme de Carrière",
    "GDS ・ Gendarme Sous Contrat",
    "ELG ・ Élève Gendarme",
    "MDL ・ Maréchal des Logis",
    "BRC ・ Brigadier-Chef",
    "BRI ・ Brigadier",
    "GAV ・ Gendarme Adjoint Volontaire"
];

const SPECIALITES = [
    {
        id: "psig",
        nom: "PSIG",
        titre: "Peloton de Surveillance et d’Intervention de la Gendarmerie",
        description: "Le PSIG lutte contre la délinquance de voie publique, assure la surveillance des zones sensibles et intervient en appui des unités territoriales.",
        responsableRoleId: "1279481758554914947",
        adjointRoleId: "1279489443488600117",
        questions: [
            { type: "textarea", question: "Nom + Prénom" },
            { type: "textarea", question: "Âge" },
            { type: "textarea", question: "Grade + NIGEND" },
            { type: "textarea", question: "Depuis combien de temps êtes-vous gendarme ?" },
            { type: "textarea", question: "Qualités — 3 minimum" },
            { type: "textarea", question: "Défauts — 3 minimum" },
            { type: "textarea", question: "Expérience" },
            { type: "radio", question: "Êtes-vous un ancien membre du PSIG / GIGN ?", options: ["Ancien du GIGN", "Ancien du PSIG", "Négatif", "Autre"] },
            { type: "textarea", question: "Motivation — 4 lignes minimum" },
            { type: "textarea", question: "Pourquoi vous et pas une autre personne ?" },
            { type: "textarea", question: "Que allez-vous apporter à notre spécialité ?" },
            { type: "radio", question: "Comprenez-vous que nous cherchons des personnes actives ?", options: ["Affirmatif", "Négatif"] },
            { type: "textarea", question: "Que signifie pour vous le PSIG ?" },
            { type: "textarea", question: "Pourquoi avez-vous choisi notre spécialité ?" },
            { type: "textarea", question: "Quelles sont les différentes missions du PSIG ?" },
            { type: "textarea", question: "Quelles sont les armes autorisées au PSIG ?" },
            { type: "radio", question: "Le PSIG a-t-il le droit de patrouiller en banalisé ?", options: ["Affirmatif", "Négatif"] },
            { type: "textarea", question: "Sur quel secteur peut intervenir le PSIG ?" },
            { type: "textarea", question: "Qu’est-ce que le PSIG SABRE ?" },
            { type: "textarea", question: "Mots de fin" }
        ]
    },

    {
        id: "agign",
        nom: "AGIGN",
        titre: "Antenne du Groupe d’Intervention de la Gendarmerie Nationale",
        description: "Les AGIGN sont les unités régionales d'intervention spécialisée de la Gendarmerie.",
        responsableRoleId: "1279483230831251496",
        adjointRoleId: "1279489960583495812",
        questions: [
            { type: "textarea", question: "Âge du candidat" },
            { type: "textarea", question: "Situation (familiale, scolaire ou autre)" },
            { type: "textarea", question: "Pseudo Discord" },
            { type: "textarea", question: "Pseudo Roblox" },
            { type: "textarea", question: "Gamepass que vous possédez" },
            { type: "radio", question: "Possédez-vous un équipement GIGN ?", options: ["Oui", "Non"] },
            { type: "textarea", question: "Nom & Prénom du candidat" },
            { type: "textarea", question: "Grade & Matricule" },
            { type: "textarea", question: "Qualités (3 minimum)" },
            { type: "textarea", question: "Défauts (3 minimum)" },
            { type: "textarea", question: "Présentation" },
            { type: "textarea", question: "Motivations (5 lignes minimum)" },
            { type: "textarea", question: "Pourquoi vous et pas un autre ?" },
            { type: "textarea", question: "Vos disponibilités" },
            { type: "textarea", question: "Que signifie AGIGN ?" },
            { type: "textarea", question: "Devise du GIGN" },
            { type: "textarea", question: "Droit de tirer à la tête ?" },
            { type: "textarea", question: "Qualités d’un membre AGIGN" },
            { type: "textarea", question: "Qu’est-ce qu’un CQB ?" },
            { type: "textarea", question: "Mot de fin" }
        ]
    },

    {
        id: "bdr-pjgn",
        nom: "BDR (Brigade de Recherche)",
        titre: "Brigade de Recherche / Police Judiciaire de la Gendarmerie Nationale",
        description: "Unité qui mène les enquêtes judiciaires importantes : analyses, auditions, filatures, preuves.",
        responsableRoleId: "1279483712139952281",
        adjointRoleId: "1279490647430135872",
        questions: [
            { type: "textarea", question: "Pseudo Discord" },
            { type: "textarea", question: "Pseudo Roblox" },
            { type: "textarea", question: "Âge IRL" },
            { type: "textarea", question: "Nom & Prénom RP" },
            { type: "textarea", question: "Âge RP" },
            { type: "radio", question: "Avez-vous un casier judiciaire ?", options: ["Oui", "Non"] },
            { type: "textarea", question: "Pourquoi postuler au PJGN ? (2 lignes minimum)" },
            { type: "textarea", question: "Quelle est votre motivation pour nous rejoindre ? (3 lignes minimum)" },
            { type: "textarea", question: "Pourquoi vous et pas un autre ? (2 lignes minimum)" },
            { type: "textarea", question: "Que apporterez-vous au PJGN ? (Développez)" },
            { type: "textarea", question: "Citez 3 qualités que vous possédez" },
            { type: "textarea", question: "Citez 3 défauts que vous possédez" },
            { type: "textarea", question: "Mot de fin" }
        ]
    },

    {
        id: "pghm",
        nom: "PGHM",
        titre: "Peloton de Gendarmerie de Haute Montagne",
        description: "Unité spécialisée dans le secours en montagne : recherches, sauvetages, interventions en altitude.",
        responsableRoleId: "1279483764971667602",
        adjointRoleId: "1279490866016161994",
        questions: [
            { type: "textarea", question: "Nom, Prénom + mail (Discord)" },
            { type: "textarea", question: "Quel est votre âge ?" },
            { type: "textarea", question: "NIGEND" },
            { type: "radio", question: "Êtes-vous prêt à vous engager à 100 % dans le PGHM ?", options: ["Oui, 100 %", "Bof, vite fait", "Non, je l’ai juste prise pour dire"] },
            { type: "textarea", question: "Pourquoi vous et pas un autre ?" },
            { type: "textarea", question: "Motivations (3 lignes minimum)" },
            { type: "textarea", question: "Pourquoi voulez-vous devenir gendarme en haute montagne (3 lignes minimum) ?" },
            { type: "textarea", question: "Quelles sont les qualités que vous apporteriez à notre équipe ?" },
            { type: "textarea", question: "Qu’est-ce que le PGHM ?" },
            { type: "textarea", question: "Quels sont les véhicules utilisés par le PGHM (3 minimum) ?" },
            { type: "textarea", question: "Quels sont les équipements utilisés par le PGHM ?" },
            { type: "radio", question: "Secteur du PGHM", options: ["Plages et littoraux", "Forêts basses et zones rurales", "Zones urbaines et centres-villes", "Zones montagneuses"] },
            { type: "textarea", question: "Mot de fin" },
            { type: "textarea", question: "Souhaiteriez-vous rajouter quelque chose ?" }
        ]
    },

  {
    id: "edcf",
    nom: "EDCF",
    titre: "Escadron Départemental de Contrôle des Flux",
    description: "L’EDCF est chargé du contrôle des flux routiers, de la surveillance des axes de circulation et de l’interception des véhicules suspects ou impliqués dans des activités illégales.",

    responsableRoleId: "1279482157387091988",
    adjointRoleId: "1279489708174479441",

    questions: [
        { type: "textarea", question: "Nom + Grade" },
        { type: "textarea", question: "NIGEND (Exemple 38383838)" },
        { type: "textarea", question: "Date d'arrivée dans la Gendarmerie" },
        { type: "textarea", question: "Âge" },
        { type: "textarea", question: "Spécialité acquise" },

        {
            type: "radio",
            question: "Poste souhaité",
            options: [
                "Co Pilote",
                "Pilote d'ERI",
                "Pilote ERI VRI (200+ KM/H)"
            ]
        },

        { type: "textarea", question: "Comment avez-vous entendu parler de l'EDCF ?" },
        { type: "textarea", question: "Expérience dans la conduite ?" },
        { type: "textarea", question: "Si oui, avec quel véhicule êtes-vous le plus à l'aise et le moins à l'aise ?" },
        { type: "textarea", question: "Pourquoi l'EDCF ?" },

        {
            type: "radio",
            question: "Êtes-vous apte à travailler seul ou avec un co-pilote ?",
            options: ["Oui", "Non"]
        },

        { type: "textarea", question: "Quel est votre objectif dans la Gendarmerie et dans l'EDCF ?" },

        {
            type: "radio",
            question: "Êtes-vous prêt à prendre des risques pour obtenir une plaque ou une interpellation ?",
            options: ["Oui", "Non"]
        },

        { type: "textarea", question: "Si oui, pourquoi ?" },
        { type: "textarea", question: "Quel statut judiciaire êtes-vous ?" },

        {
            type: "radio",
            question: "Êtes-vous prêt à attendre 20 minutes pour une interpellation ?",
            options: ["Oui", "Non"]
        },

        { type: "textarea", question: "Si oui, pourquoi donc 20 minutes ?" },

        {
            type: "radio",
            question: "De quelle armée dépend la Gendarmerie ?",
            options: [
                "Armée de Terre",
                "Gendarmerie Nationale",
                "Armée de l'air et de l'espace",
                "Marine Nationale"
            ]
        },

        { type: "textarea", question: "Qui était Philippe Pétain ?" },
        { type: "textarea", question: "Qui a été le premier président de la Ve République ?" },
        { type: "textarea", question: "Qui a créé le Code civil ?" },
        { type: "textarea", question: "À qui servez-vous dans la Gendarmerie ?" },
        { type: "textarea", question: "Qui était Napoléon III ?" },
        { type: "textarea", question: "Qui était appelé 'Le Roi Soleil' et pourquoi ?" },
        { type: "textarea", question: "Qui était Charles de Gaulle ?" },
        { type: "textarea", question: "Quelle est l'année de la Révolution française ?" },
        { type: "textarea", question: "Quelle est la bataille la plus connue de la Première Guerre mondiale ?" },
        { type: "textarea", question: "Quel était le nom de la Première Guerre mondiale ?" },

        { type: "textarea", question: "Nom + Grade + NIGEND (signature)" }
    ]
}
];

// Le chemin du fichier de données peut être redirigé vers un disque persistant
// Render (Settings > Disks, ex: mount path /var/data), sinon on garde le
// fichier local par défaut pour le développement.
const DATA_FILE = process.env.DATA_FILE_PATH || path.join(__dirname, "data.json");

function getData() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            users: [],
            applications: [],
            specialiteApplications: []
        }, null, 2));
    }

    const db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (!Array.isArray(db.users)) db.users = [];
if (!Array.isArray(db.applications)) db.applications = [];
if (!Array.isArray(db.specialiteApplications)) db.specialiteApplications = [];
if (!Array.isArray(db.tenues)) db.tenues = [];
if (!Array.isArray(db.ticketsCommandement)) db.ticketsCommandement =[];

db.users.forEach(user => {
    if (!user.qualificationJudiciaire) {
        user.qualificationJudiciaire = getDefaultQualificationJudiciaire(user.grade);
    }

    if (!user.NIGEND && user.matricule) {
        user.NIGEND = user.matricule;
    }
});

saveData(db);
return db;
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let defaultVehiculesCache = null;

function getDefaultVehicules() {
    if (defaultVehiculesCache) return defaultVehiculesCache;
    const source = fs.readFileSync(path.join(__dirname, "public", "patrouilles.html"), "utf8");
    const declaration = source.includes("let VEHICULES = ") ? "let VEHICULES = " : "const VEHICULES = ";
    const start = source.indexOf(declaration);
    const end = source.indexOf("\n};", start);
    if (start < 0 || end < 0) return {};
    const objectText = source.slice(start + declaration.length, end + 2);
    defaultVehiculesCache = Function(`"use strict"; return (${objectText});`)();
    return defaultVehiculesCache;
}

function getVehicules(db) {
    const defaults = getDefaultVehicules();
    const stored = db.vehicules || {};
    const result = {};
    for (const [category, vehicles] of Object.entries(defaults)) {
        const configured = stored[category] || vehicles;
        result[category] = configured.map(vehicle => typeof vehicle === "string"
            ? { name: vehicle, color: "#3f51b5" }
            : { name: String(vehicle.name || ""), color: vehicle.color || "#3f51b5" });
    }
    return result;
}

async function isAdmin(req) {
    if (req.session?.systemAdmin === true) return true;
    if (!req.session.user) return false;

    const admins = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

    if (admins.includes(req.session.user.id)) {
        return true;
    }

    const db = getData();
    if ((db.admins || []).some(admin => admin.discordId === req.session.user.id && admin.passwordSet === true)) {
        return true;
    }

    try {
        const member = await getGuildMember(req.session.user.id);

        return member.roles.includes(ADMIN_ROLE_ID);
    } catch (err) {
        return false;
    }
}

function hasAdminAccess(req) {
    return req.session?.adminAccessVerified === true;
}

async function requireAdminAccess(req, res, next) {
    if (!(await isAdmin(req))) {
        return res.status(403).json({ error: "Accès administrateur refusé." });
    }

    if (!hasAdminAccess(req)) {
        if (!req.path.startsWith("/api/") && req.accepts("html")) return res.redirect("/admin-access");
        return res.status(403).json({ error: "Code d'accès administrateur requis." });
    }

    next();
}

function getDefaultQualificationJudiciaire(grade) {
    if (!grade) return "APJA";

    if (
        grade.startsWith("COL") ||
        grade.startsWith("LCL") ||
        grade.startsWith("CEN") ||
        grade.startsWith("CNE") ||
        grade.startsWith("LTN") ||
        grade.startsWith("SLT") ||
        grade.startsWith("ASP")
    ) {
        return "OPJ";
    }

    if (
        grade.startsWith("MAJ") ||
        grade.startsWith("ADC") ||
        grade.startsWith("ADJ") ||
        grade.startsWith("MDC") ||
        grade.startsWith("GDC") ||
        grade.startsWith("GDS") ||
        grade.startsWith("ELG")
    ) {
        return "APJ";
    }

    return "APJA";
}

function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect("/");
    next();
}

async function requireAdmin(req, res, next) {
    if (!(await isAdmin(req))) {
        return res.status(403).send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Accès Corps de Commandement Refusé</title>

<style>
body{
    margin:0;
    background:#0d1321;
    color:white;
    font-family:Arial,sans-serif;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
}

.box{
    background:#151f36;
    padding:40px;
    border-radius:15px;
    border-left:5px solid #1f4ea8;
    max-width:700px;
    text-align:center;
    box-shadow:0 0 25px rgba(0,0,0,0.4);
}

.logo{
    width:100px;
    margin-bottom:20px;
}

h1{
    color:#ff4d4d;
}

p{
    color:#d8e2ff;
    line-height:1.6;
}

.btn{
    display:inline-block;
    margin-top:20px;
    padding:12px 20px;
    background:#1f4ea8;
    color:white;
    text-decoration:none;
    border-radius:8px;
}

.btn:hover{
    background:#163c84;
}
</style>
</head>

<body>

<div class="box">
<img src="/assets/logo-gendarmerie.png" class="logo">

<h1>🔒 Accès Corps de Commandement Refusé</h1>

<p>
Vous ne disposez pas des autorisations nécessaires pour accéder au
<b>Panel Administratif de la Gendarmerie Nationale</b>.
</p>

<p>
Vous ne disposez pas des habilitations nécessaires pour accéder à cet espace.
Cette section est réservée au <b>CCD ・ Corps de Commandement</b>.
</p>

<p>
Toute tentative d'accès non autorisée peut être enregistrée et signalée
à la hiérarchie compétente.
</p>

<a href="/dashboard" class="btn">
← Retour au Dashboard
</a>

</div>

</body>
</html>
        `);
    }

    next();
}

async function getGuildMember(discordId) {
    const res = await axios.get(
        `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${discordId}`,
        {
            headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
            }
        }
    );

    return res.data;
}

async function getAllGuildMembers() {
    const res = await axios.get(
        `https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members?limit=1000`,
        {
            headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
            }
        }
    );

    return res.data;
}

async function sendDiscordDM(userId, message) {
    try {
        const dm = await axios.post(
            "https://discord.com/api/v10/users/@me/channels",
            { recipient_id: userId },
            {
                headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        await axios.post(
            `https://discord.com/api/v10/channels/${dm.data.id}/messages`,
            { content: message },
            {
                headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return true;
    } catch {
        return false;
    }
}
async function sendDMToRole(roleId, message) {
    try {
        const members = await getAllGuildMembers();

        const targets = members.filter(member =>
            member.roles.includes(roleId)
        );

        console.log(`Rôle ${roleId} trouvé : ${targets.length} membre(s)`);

        for (const member of targets) {
            console.log("MP vers :", member.user.username, member.user.id);
            await sendDiscordDM(member.user.id, message);
        }

        return true;
    } catch (err) {
        console.log("Erreur sendDMToRole :", err.response?.data || err.message);
        return false;
    }
}

function getConfiguredSpecialite(db, specialite) {
    return { ...specialite, ...(db.roleSettings?.specialites?.[specialite.id] || {}) };
}

function getConfiguredRenfortRoles(db) {
    return { ...RENFORT_ROLES, ...(db.roleSettings?.renfortRoles || {}) };
}

async function notifySpecialiteStaff(specialite, appItem) {
    const configuredSpecialite = getConfiguredSpecialite(getData(), specialite);
    await sendDMToRole(
        configuredSpecialite.responsableRoleId,
`📁 DOSSIER DE CANDIDATURE REÇU

Spécialité : ${specialite.nom}

Informations du candidat :
• Identité : ${appItem.nomPrenom}
• Discord : ${appItem.username}
• Date de dépôt : ${new Date(appItem.createdAt).toLocaleString("fr-FR")}

Le dossier est désormais en attente d'examen.

Gendarmerie Nationale`
    );

    await sendDMToRole(
        configuredSpecialite.adjointRoleId,
`📁 DOSSIER DE CANDIDATURE REÇU

Spécialité : ${specialite.nom}

Informations du candidat :
• Identité : ${appItem.nomPrenom}
• Discord : ${appItem.username}
• Date de dépôt : ${new Date(appItem.createdAt).toLocaleString("fr-FR")}

Le dossier est désormais en attente d'examen.

Gendarmerie Nationale`
    );
}

async function canManageSpecialite(req, specialite) {
    if (await isAdmin(req)) return true;

    try {
        const member = await getGuildMember(req.session.user.id);
        const configuredSpecialite = getConfiguredSpecialite(getData(), specialite);

        return (
            member.roles.includes(configuredSpecialite.responsableRoleId) ||
            member.roles.includes(configuredSpecialite.adjointRoleId)
        );
    } catch {
        return false;
    }
}

function accessDeniedPage() {
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Accès refusé</title>
<style>
body{
    margin:0;
    background:#0d1321;
    color:white;
    font-family:Arial,sans-serif;
    display:flex;
    justify-content:center;
    align-items:center;
    height:100vh;
}
.box{
    background:#151f36;
    padding:40px;
    border-radius:15px;
    border-left:5px solid #1f4ea8;
    max-width:700px;
    text-align:center;
    box-shadow:0 0 25px rgba(0,0,0,0.4);
}
.logo{
    width:100px;
    margin-bottom:20px;
}
h1{
    color:#ff4d4d;
}
p{
    color:#d8e2ff;
    line-height:1.6;
}
.btn{
    display:inline-block;
    margin-top:20px;
    padding:12px 20px;
    background:#1f4ea8;
    color:white;
    text-decoration:none;
    border-radius:8px;
}
.btn:hover{
    background:#163c84;
}
</style>
</head>
<body>
<div class="box">
<img src="/assets/logo-gendarmerie.png" class="logo">
<h1>🚫 Accès refusé</h1>
<p>Vous ne faites pas partie de la <b>Gendarmerie Nationale</b>.</p>
<p>L'accès à cette tablette est strictement réservé aux militaires de la compagnie.</p>
<p>Si vous pensez qu'il s'agit d'une erreur, contactez un membre de l'État-Major.</p>
<a href="/" class="btn">← Retour à l'accueil</a>
</div>
</body>
</html>
`;
}

async function requireGNMember(req, res, next) {
    if (!req.session.user) return res.redirect("/");

    if (await isAdmin(req)) return next();

    try {
        await getGuildMember(req.session.user.id);
        next();
    } catch {
        return res.send(accessDeniedPage());
    }
}

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

app.get("/index.html", (req, res) => {
    res.redirect("/");
});

// ---------------------------------------------------------------------
// Pages "simples" servies directement depuis /public, protégées par
// requireLogin + requireGNMember. On déclare ici une seule fois la liste
// (route propre -> fichier), ce qui génère à la fois la route sans
// extension et une redirection 301 depuis l'ancienne URL en .html.
// ---------------------------------------------------------------------
const PAGES_PROTEGEES = [
    ["dashboard", "dashboard.html"],
    ["effectifs", "effectifs.html"],
    ["patrouilles", "patrouilles.html"],
    ["renfort", "renfort.html"],
    ["cours", "cours.html"],
    ["tickets-commandement", "tickets-commandement.html"],
    ["specialites", "specialites.html"],
    ["cours-gendarmerie", "cours-gendarmerie.html"],
    ["tenues", "tenues.html"],
    ["regles-securite", "regles-securite.html"],
    ["controle", "controle.html"],
    ["alphabet-otan", "alphabet-otan.html"],
    ["hierarchie", "hierarchie.html"],
    ["armement", "armement.html"],
    ["equipements", "equipements.html"],
    ["procedure", "procedure.html"],
    ["psc1", "psc1.html"],
    ["radio", "radio.html"],
    ["refus-obtemperer", "refus-obtemperer.html"],
    ["sanctions", "sanctions.html"],
    ["index-judiciaire", "index-judiciaire.html"],
    ["gendarmerie", "gendarmerie.html"],
    ["formation-terrain", "formation-terrain.html"],
    ["architecture-intervention", "architecture-intervention.html"],
    ["code-penal", "code-penal.html"]
];

for (const [cleanPath, fileName] of PAGES_PROTEGEES) {
    app.get(`/${cleanPath}`, requireLogin, requireGNMember, (req, res) => {
        res.sendFile(path.join(__dirname, "public", fileName));
    });
    // Ancienne URL en .html : redirection permanente vers la nouvelle URL propre.
    app.get(`/${fileName}`, (req, res) => res.redirect(301, `/${cleanPath}`));
}

// Pages publiques historiques conservées afin que les liens de l'accueil ne renvoient pas une erreur 404.
app.get("/gn-login", (req, res) => {
    res.redirect("/auth/discord");
});
app.get("/gn-login.html", (req, res) => res.redirect(301, "/gn-login"));

app.get("/gn-candidature", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "gn-candidature.html"));
});
app.get("/gn-candidature.html", (req, res) => res.redirect(301, "/gn-candidature"));

app.post("/api/candidatures", async (req, res) => {
    const requiredFields = [
        "nom", "prenom", "email", "telephone", "dateNaissance",
        "diplome", "experience", "motivation"
    ];

    if (requiredFields.some(field => !String(req.body[field] || "").trim())) {
        return res.status(400).json({ error: "Merci de remplir tous les champs." });
    }

    const db = getData();
const application = {
    id: Date.now(),
    nomPrenom: `${req.body.nom.trim()} ${req.body.prenom.trim()}`,
    user: req.body.email.trim(),          // pseudo Discord
    username: req.body.email.trim(),      // compatibilité admin.html
    discordId: req.body.telephone.trim(), // ID Discord
    dateNaissance: req.body.dateNaissance,
    diplome: req.body.diplome.trim(),
    experience: req.body.experience.trim(),
    motivation: req.body.motivation.trim(),
    status: "En attente",
    createdAt: new Date().toISOString()
};
    db.applications.push(application);

    saveData(db);

const messageCandidature =
`📩 NOUVELLE CANDIDATURE

Nom : ${application.nomPrenom}
Discord : ${application.user} (${application.discordId})
Date de dépôt : ${new Date(application.createdAt).toLocaleString("fr-FR")}

Le dossier est disponible dans le panel administrateur.`;

    // Les membres ayant le rôle administrateur sont avertis dès qu'un dossier
    // est envoyé. Un échec de MP ne doit jamais empêcher le dépôt du candidat.
    await sendDMToRole(ADMIN_ROLE_ID, messageCandidature);

    // Le Responsable CIR est également averti pour traitement rapide du dossier.
    await sendDMToRole(ROLE_RESP_CIR, messageCandidature);

    res.status(201).json({ success: true });
});

app.get("/test123", (req, res) => {
    res.send("TEST OK");
});

app.get("/admin-access", requireAdmin, (req, res) => {
    if (hasAdminAccess(req)) return res.redirect("/admin");

    res.send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verrou administrateur</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11182e;color:#f4f4f4;font-family:Arial,sans-serif}
main{width:min(420px,calc(100% - 32px));padding:32px;border:1px solid #d4af37;border-radius:12px;background:#1a1a2e}
h1{color:#d4af37;font-size:1.5rem}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:6px;font:inherit}input{border:1px solid #d4af37;background:#0f1528;color:#fff}button{margin-top:16px;border:0;background:#d4af37;color:#11182e;font-weight:bold;cursor:pointer}#error{min-height:1.4em;color:#ff9b9b}
</style></head><body><main><h1>Verrou administrateur</h1><p>Saisis ton code d'accès personnel.</p><form id="access-form"><input id="code" type="password" autocomplete="one-time-code" required autofocus><button>Déverrouiller</button></form><p id="error" role="alert"></p></main><script>
document.getElementById('access-form').addEventListener('submit',async event=>{event.preventDefault();const response=await fetch('/api/admin/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});if(response.ok)return location.assign('/admin');const data=await response.json();document.getElementById('error').textContent=data.error||'Code invalide.';});
</script></body></html>`);
});
app.get("/admin-access.html", (req, res) => res.redirect(301, "/admin-access"));

app.post("/api/admin/access", requireAdmin, (req, res) => {
    const expectedHash = process.env.ADMIN_ACCESS_CODE_HASH || "";
    const suppliedCode = String(req.body.code || "");
    const suppliedHash = crypto.createHash("sha256").update(suppliedCode).digest("hex");

    if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
        return res.status(503).json({ error: "Le verrou administrateur n'est pas configuré." });
    }

    const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedHash, "hex"),
        Buffer.from(suppliedHash, "hex")
    );

    if (!isValid) return res.status(403).json({ error: "Code invalide." });

    req.session.adminAccessVerified = true;
    res.json({ success: true });
});

app.get("/admin", async (req, res) => {
    if (!(await isAdmin(req)) || req.session?.adminPanelAuthenticated !== true) return res.redirect("/admin-login");
    res.sendFile(__dirname + "/public/admin.html");
});
app.get("/admin.html", (req, res) => res.redirect(301, "/admin"));

app.get("/admin-login", (req, res) => {
    res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connexion admin</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11182e;color:#f4f4f4;font:16px Arial,sans-serif}main{width:min(400px,calc(100% - 32px));padding:32px;background:#1a1a2e;border:1px solid #d4af37;border-radius:12px}h1{color:#d4af37}input,button{box-sizing:border-box;width:100%;margin-top:12px;padding:12px;border-radius:6px;font:inherit}input{border:1px solid #d4af37;background:#0f1528;color:#fff}button{border:0;background:#d4af37;color:#11182e;font-weight:bold;cursor:pointer}#error{min-height:1.4em;color:#ff9b9b}</style></head><body><main><h1>Connexion administrateur</h1><form id="login"><input id="username" placeholder="Pseudo Discord" required autofocus><input id="password" type="password" placeholder="Mot de passe" required><button>Se connecter</button></form><p id="error"></p></main><script>document.getElementById('login').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.value,password:password.value})});if(r.ok)return location.assign('/admin');const d=await r.json();error.textContent=d.error||'Identifiants invalides.';});</script></body></html>`);
});
app.get("/admin-login.html", (req, res) => res.redirect(301, "/admin-login"));

app.post("/api/admin/login", (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const suppliedHash = crypto.createHash("sha256").update(password).digest("hex");

    // Plusieurs comptes "système" peuvent être définis dans le .env, en listant
    // les pseudos et les hachages de mot de passe dans le même ordre, séparés
    // par des virgules :
    //   SYSTEM_ADMIN_USERNAME=systeme,lexy,dupont,martin
    //   SYSTEM_ADMIN_PASSWORD_HASH=hash1,hash2,hash3,hash4
    const systemUsernames = (process.env.SYSTEM_ADMIN_USERNAME || "systeme")
        .split(",").map(name => name.trim().toLowerCase()).filter(Boolean);
    const systemHashes = (process.env.SYSTEM_ADMIN_PASSWORD_HASH || "")
        .split(",").map(hash => hash.trim());

    const systemIndex = systemUsernames.indexOf(username);
    const expectedHash = systemIndex >= 0 ? (systemHashes[systemIndex] || "") : "";

    const isSystemAdmin = systemIndex >= 0 && /^[a-f0-9]{64}$/i.test(expectedHash) &&
        crypto.timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(suppliedHash, "hex"));
    const db = getData();
    const admin = (db.admins || []).find(item => item.username.toLowerCase() === username);
    const isInvitedAdmin = admin?.passwordSet === true && verifyPassword(password, admin.passwordHash);

    if (!isSystemAdmin && !isInvitedAdmin) {
        return res.status(403).json({ success: false, error: "Identifiants invalides." });
    }

    req.session.systemAdmin = isSystemAdmin;
    req.session.adminAccessVerified = true;
    req.session.adminPanelAuthenticated = true;
    req.session.user = {
        id: isSystemAdmin ? `systeme-${username}` : admin.discordId,
        username: isSystemAdmin ? username : admin.username,
        nomPrenom: "Système",
        avatar: "",
        estDansServeur: true
    };

    res.json({ success: true, token: "session", userId: req.session.user.id });
});

app.get("/api/admin/data", requireAdmin, (req, res) => {
    const db = getData();
    const adminIds = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim());

    res.json({
        ...db,
        admins: db.admins || (db.users || []).filter(user => adminIds.includes(user.id)),
        gnApplications: db.applications || [],
        roleCatalog: {
            specialites: SPECIALITES.map(({ id, nom, responsableRoleId, adjointRoleId }) => ({ id, nom, responsableRoleId, adjointRoleId })),
            renfortRoles: RENFORT_ROLES
        }
    });
});

app.post("/api/admin/role-settings", requireAdmin, (req, res) => {
    const settings = req.body || {};
    const isRoleId = value => value === "" || /^\d{17,20}$/.test(String(value));
    const specialites = settings.specialites || {};
    const renfortRoles = settings.renfortRoles || {};

    for (const item of Object.values(specialites)) {
        if (!isRoleId(item.responsableRoleId) || !isRoleId(item.adjointRoleId)) {
            return res.status(400).json({ success: false, error: "Un identifiant de rôle Discord doit contenir entre 17 et 20 chiffres." });
        }
    }
    if (!Object.values(renfortRoles).every(isRoleId)) {
        return res.status(400).json({ success: false, error: "Un identifiant de rôle Discord doit contenir entre 17 et 20 chiffres." });
    }

    const db = getData();
    db.roleSettings = { specialites, renfortRoles };
    saveData(db);
    res.json({ success: true });
});

app.post("/api/admin/patrouilles", requireAdmin, (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ success: false, error: "Données des patrouilles invalides." });
    }
    const db = getData();
    db.patrouilles = req.body;
    saveData(db);
    res.json({ success: true });
});

app.post("/api/admin/application/:type/:id/send-to-me", requireAdmin, async (req, res) => {
    if (!req.session.user?.id || req.session.user.id.startsWith("systeme")) {
        return res.status(400).json({ success: false, error: "Connectez-vous avec un compte Discord administrateur pour recevoir ce MP." });
    }
    const db = getData();
    const applications = req.params.type === "gn" ? db.applications :
        req.params.type === "specialite" ? db.specialiteApplications : null;
    if (!applications) return res.status(400).json({ success: false, error: "Type de candidature invalide." });

    const application = applications.find(item => String(item.id) === req.params.id);
    if (!application) return res.status(404).json({ success: false, error: "Candidature introuvable." });

    const ignoredFields = new Set(["id", "answers", "avatar", "discordId", "createdAt", "decidedAt", "decisionMessage"]);
    const fields = Object.entries(application)
        .filter(([key, value]) => !ignoredFields.has(key) && value !== "" && value != null && typeof value !== "object")
        .map(([key, value]) => `• ${key} : ${value}`);
    const answers = Object.entries(application.answers || {})
        .map(([question, answer]) => `• ${question} : ${answer}`)
        .join("\n");
    const content = [
        "📄 CANDIDATURE",
        `Type : ${req.params.type === "gn" ? "Gendarmerie Nationale" : application.specialiteNom || "Spécialité"}`,
        `Candidat : ${application.nomPrenom || application.username || "Non renseigné"}`,
        `Discord : ${application.username || "Non renseigné"}`,
        "",
        [...fields, answers].filter(Boolean).join("\n") || "Aucune réponse enregistrée."
    ].join("\n").slice(0, 1990);

    const sent = await sendDiscordDM(req.session.user.id, content);
    if (!sent) return res.status(502).json({ success: false, error: "Le MP n'a pas pu être envoyé. Vérifiez vos MP Discord." });
    res.json({ success: true });
});

app.post("/api/admin/add-user", requireAdmin, async (req, res) => {
    const { discordId, username, grade = "" } = req.body || {};
    if (!String(discordId || "").trim() || !String(username || "").trim()) {
        return res.status(400).json({ success: false, error: "ID Discord et pseudo requis." });
    }

    const db = getData();
    if (!Array.isArray(db.admins)) db.admins = [];

    if (db.admins.some(admin => admin.discordId === String(discordId).trim())) {
        return res.status(409).json({ success: false, error: "Cet administrateur existe déjà." });
    }

    db.admins.push({
        id: Date.now().toString(),
        discordId: String(discordId).trim(),
        username: String(username).trim(),
        grade: String(grade).trim(),
        passwordSet: false,
        awaitingPasswordSetup: true,
        createdAt: new Date().toISOString()
    });

    saveData(db);
    const sent = await sendDiscordDM(String(discordId).trim(),
        "🔐 Vous avez été ajouté au panel administrateur de la Gendarmerie. Répondez à ce message avec le mot de passe que vous souhaitez utiliser (8 caractères minimum). Ne le partagez avec personne."
    );
    if (!sent) {
        db.admins = db.admins.filter(admin => admin.discordId !== String(discordId).trim());
        saveData(db);
        return res.status(502).json({ success: false, error: "Le MP Discord n'a pas pu être envoyé. Vérifiez que le bot est en ligne et que les MP sont ouverts, puis réessayez." });
    }
    res.json({ success: true });
});

app.post("/api/admin/delete-user", requireAdmin, (req, res) => {
    const userId = String(req.body?.userId || "");
    const db = getData();
    if (!Array.isArray(db.admins)) db.admins = [];

    const before = db.admins.length;
    db.admins = db.admins.filter(admin => admin.id !== userId);
    if (db.admins.length === before) {
        return res.status(404).json({ success: false, error: "Administrateur introuvable." });
    }

    saveData(db);
    res.json({ success: true });
});

app.get("/auth/discord", (req, res) => {
    const url =
        `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}` +
        `&response_type=code&scope=identify`;

    res.redirect(url);
});

app.get("/auth/discord/callback", async (req, res) => {
    try {
        const code = req.query.code;

        const data = new URLSearchParams();
        data.append("client_id", process.env.DISCORD_CLIENT_ID);
        data.append("client_secret", process.env.DISCORD_CLIENT_SECRET);
        data.append("grant_type", "authorization_code");
        data.append("code", code);
        data.append("redirect_uri", process.env.DISCORD_REDIRECT_URI);

        const token = await axios.post("https://discord.com/api/oauth2/token", data, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });

        const userRes = await axios.get("https://discord.com/api/users/@me", {
            headers: {
                Authorization: `Bearer ${token.data.access_token}`
            }
        });

        let member = null;

        try {
            member = await getGuildMember(userRes.data.id);
        } catch {
            member = null;
        }

        const nomPrenom = member
            ? (member.nick || member.user.global_name || userRes.data.username)
            : userRes.data.username;

        req.session.user = {
            id: userRes.data.id,
            username: userRes.data.username,
            avatar: userRes.data.avatar,
            nomPrenom,
            estDansServeur: !!member,
            dateArriveeServeur: member ? member.joined_at : null
        };

        if (!member) {
            return res.send(accessDeniedPage());
        }

        const db = getData();
        let user = db.users.find(u => u.id === userRes.data.id);

        if (!user) {
            db.users.push({
                id: userRes.data.id,
                username: userRes.data.username,
                avatar: userRes.data.avatar,
                nomPrenom,
                dateArriveeServeur: member.joined_at,
                datePremiereConnexion: new Date().toISOString(),
                estDansServeur: true,
                grade: "GAV ・ Gendarme Adjoint Volontaire",
                NIGEND: "",
                qualificationJudiciaire: getDefaultQualificationJudiciaire("GAV ・ Gendarme Adjoint Volontaire"),
                unite: "",
                specialisation: "",
                statut: "Actif"
            });
        } else {
            user.username = userRes.data.username;
            user.avatar = userRes.data.avatar;
            user.nomPrenom = nomPrenom;
            user.estDansServeur = true;
            user.dateArriveeServeur = member.joined_at;
        }

        saveData(db);

        return res.redirect("/dashboard");

    } catch (err) {
        console.log(err.response?.data || err.message);
        res.send("Erreur Discord OAuth : " + JSON.stringify(err.response?.data || err.message));
    }
});

app.get("/api/tenues", requireLogin, requireGNMember, (req, res) => {
    const db = getData();
    res.json(db.tenues || []);
});

app.post("/api/tenue/create", requireAdminAccess, (req, res) => {
    const db = getData();

    if (!db.tenues) db.tenues = [];

    db.tenues.push({
        id: Date.now(),
        nom: req.body.nom,
        categorie: req.body.categorie,
        image: req.body.image,
        description: req.body.description
    });

    saveData(db);
    res.json({ success: true });
});

app.post("/api/tenue/upload", requireAdminAccess, upload.single("image"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Aucune image envoyée." });
    }

    res.json({
        success: true,
        imagePath: "/assets/tenues/" + req.file.filename
    });
});

app.get("/api/me", (req, res) => {
    if (!req.session.user) return res.json(null);

    const db = getData();
    const user = db.users.find(u => u.id === req.session.user.id);

    if (user && !user.qualificationJudiciaire) {
    user.qualificationJudiciaire = getDefaultQualificationJudiciaire(user.grade);
    saveData(db);
}

if (user && !user.NIGEND && user.matricule) {
    user.NIGEND = user.matricule;
    saveData(db);
}

    if (user) {
        return res.json({
            ...user,
            estDansServeur: req.session.user.estDansServeur
        });
    }

    return res.json({
        ...req.session.user,
        candidat: true
    });
});

app.get("/api/debug-admin", (req, res) => {
    res.json({
        connectedUser: req.session.user || null,
        adminIds: (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean),
        isAdmin: isAdmin(req)
    });
});

app.get("/api/effectifs", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();

    const usersWithCommandement = await Promise.all((db.users || []).map(async user => {
        try {
            const member = await getGuildMember(user.id);

            let commandement = "";

            for (const roleId of member.roles) {
                if (COMMANDEMENT_ROLES[roleId]) {
                    commandement = COMMANDEMENT_ROLES[roleId];
                    break;
                }
            }

            return {
                ...user,
                commandement
            };
        } catch {
            return {
                ...user,
                commandement: ""
            };
        }
    }));

    res.json(usersWithCommandement);
});

app.get("/api/patrouilles", requireLogin, requireGNMember, (req, res) => {
    const db = getData();
    res.json(db.patrouilles || {});
});

app.post("/api/patrouilles", requireLogin, requireGNMember, (req, res) => {
    const db = getData();

    db.patrouilles = req.body || {};

    saveData(db);

    res.json({
        success: true
    });
});

app.post("/api/renfort", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();
    const user = db.users.find(u => u.id === req.session.user.id);

    if (!user) {
        return res.status(404).json({ error: "Profil introuvable." });
    }

    const { nombreMilitaires, unitePatrouille, raison, specialisations } = req.body;

    if (!nombreMilitaires || !unitePatrouille || !raison || !specialisations || specialisations.length === 0) {
        return res.status(400).json({ error: "Merci de remplir tous les champs." });
    }

    if (!nombreMilitaires || !unitePatrouille || !raison || !specialisations || specialisations.length === 0) {
        return res.status(400).json({ error: "Merci de remplir tous les champs." });
    }

    const configuredRenfortRoles = getConfiguredRenfortRoles(db);
    const rolesPing = specialisations
        .map(spe => configuredRenfortRoles[spe] ? `<@&${configuredRenfortRoles[spe]}>` : spe)
        .join(" ");

    const message = `<:Gendarmerie_Nationale:1170094137429733507> **Demande De Renfort** <:Gendarmerie_Nationale:1170094137429733507>

———————————————————————————

<:GroupementDuRhone:1170000637413568512> • **Militaire :**

**Nom Prénom :** ${user.nomPrenom || user.username}
**NIGEND :** ${user.NIGEND || "Non attribué"}
**Grade :** ${user.grade || "Non attribué"}

**Qualification Judiciaire :** ${user.qualificationJudiciaire || "Non attribuée"}

**Nombre De Militaire En Service :** ${nombreMilitaires}
**Unité / Patrouille Présente En Ville :** ${unitePatrouille}

**Raison :**
${raison}

**Spécialisation Demandé :** ${rolesPing}

———————————————————————————

Cordialement, <@${user.id}>`;

    const sent = await sendDiscordChannelMessage(process.env.RENFORT_CHANNEL_ID, message);

    if (!sent) {
        return res.status(500).json({ error: "Impossible d'envoyer la demande." });
    }

    res.json({ success: true });
});

app.get("/api/grades", (req, res) => {
    res.json(GRADES);
});

app.get("/api/vehicules", requireAdminAccess, (req, res) => {
    res.json(getVehicules(getData()));
});

app.get("/api/vehicules/list", requireLogin, requireGNMember, (req, res) => {
    // Les patrouilles ont besoin de la couleur configurée dans le panel admin,
    // pas seulement du nom du véhicule.
    res.json(getVehicules(getData()));
});

app.post("/api/vehicules/add", requireAdminAccess, (req, res) => {
    const { category, name, color } = req.body || {};
    if (!getDefaultVehicules()[category] || !String(name || "").trim()) {
        return res.status(400).json({ success: false, error: "Catégorie ou nom de véhicule invalide." });
    }
    const db = getData();
    const vehicles = getVehicules(db);
    if (vehicles[category].some(item => item.name.toLowerCase() === String(name).trim().toLowerCase())) {
        return res.status(409).json({ success: false, error: "Ce véhicule existe déjà dans cette catégorie." });
    }
    vehicles[category].push({ name: String(name).trim(), color: /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#3f51b5" });
    db.vehicules = vehicles;
    saveData(db);
    res.json({ success: true });
});

app.post("/api/vehicules/update", requireAdminAccess, (req, res) => {
    const { category, oldName, name, color } = req.body || {};
    const db = getData();
    const vehicles = getVehicules(db);
    const vehicle = vehicles[category]?.find(item => item.name === oldName);
    if (!vehicle || !String(name || "").trim()) return res.status(404).json({ success: false, error: "Véhicule introuvable." });
    vehicle.name = String(name).trim();
    vehicle.color = /^#[0-9a-f]{6}$/i.test(color || "") ? color : vehicle.color;
    db.vehicules = vehicles;
    saveData(db);
    res.json({ success: true });
});

app.post("/api/vehicules/delete", requireAdminAccess, (req, res) => {
    const { category, name } = req.body || {};
    const db = getData();
    const vehicles = getVehicules(db);
    if (!vehicles[category]?.some(item => item.name === name)) return res.status(404).json({ success: false, error: "Véhicule introuvable." });
    vehicles[category] = vehicles[category].filter(item => item.name !== name);
    db.vehicules = vehicles;
    saveData(db);
    res.json({ success: true });
});

app.get("/api/contact", (req, res) => {
    const db = getData();

    // Retire un éventuel préfixe de grade du type "LTN ・ " ou "CNE ・ "
    // au cas où il aurait été saisi par erreur dans le nom/prénom.
    const stripGradePrefix = value => String(value || "").replace(/^[A-ZÀ-Ü]{2,5}\s*・\s*/, "").trim();

    const contactForGrade = prefix => {
        const user = db.users.find(item => String(item.grade || "").startsWith(prefix));
        if (!user) return "Non renseigné";
        return stripGradePrefix(user.nomPrenom || user.username) || "Non renseigné";
    };

    res.json({
        capitaine: contactForGrade("CNE"),
        lieutenant: contactForGrade("LTN")
    });
});

app.get("/api/specialites", requireLogin, requireGNMember, async (req, res) => {
    const result = [];

    for (const spe of SPECIALITES) {
        result.push({
            ...spe,
            canManage: await canManageSpecialite(req, spe)
        });
    }

    res.json(result);
});

app.post("/api/specialites/apply", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();
    const specialite = SPECIALITES.find(s => s.id === req.body.specialiteId);

    if (!specialite) {
        return res.status(404).json({ error: "Spécialité introuvable" });
    }

    if (!db.patrouilles) db.patrouilles = {};

    const already = db.specialiteApplications.find(a =>
        a.discordId === req.session.user.id &&
        a.specialiteId === specialite.id &&
        a.status === "En attente"
    );

    if (already) {
        return res.status(400).json({
            error: "Tu as déjà une candidature en attente pour cette spécialité."
        });
    }

    const appItem = {
        id: Date.now(),
        specialiteId: specialite.id,
        specialiteNom: specialite.nom,
        discordId: req.session.user.id,
        username: req.session.user.username,
        nomPrenom: req.session.user.nomPrenom,
        answers: req.body.answers || {},
        status: "En attente",
        createdAt: new Date().toISOString(),
        decisionMessage: ""
    };

    db.specialiteApplications.push(appItem);
    saveData(db);

    await notifySpecialiteStaff(specialite, appItem);

    res.json({ success: true });
});

app.get("/api/specialites/applications", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();
    const visible = [];

    for (const appItem of db.specialiteApplications) {
        const specialite = SPECIALITES.find(s => s.id === appItem.specialiteId);
        if (!specialite) continue;

        if (await canManageSpecialite(req, specialite)) {
            visible.push(appItem);
        }
    }

    res.json(visible);
});

app.post("/api/specialites/applications/:id/accept", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();
    const appItem = db.specialiteApplications.find(a => a.id == req.params.id);

    if (!appItem) return res.status(404).json({ error: "Candidature introuvable" });

    const specialite = SPECIALITES.find(s => s.id === appItem.specialiteId);
    if (!specialite) return res.status(404).json({ error: "Spécialité introuvable" });

    if (!(await canManageSpecialite(req, specialite))) {
        return res.status(403).json({ error: "Accès refusé" });
    }

    appItem.status = "Acceptée";
    appItem.decisionMessage = req.body.message || "Bienvenue dans la spécialité.";
    appItem.decidedAt = new Date().toISOString();

    saveData(db);

    await sendDiscordDM(
    appItem.discordId,
`📨 DÉCISION DE RECRUTEMENT

À l'attention de : ${appItem.nomPrenom}

Après étude de votre dossier et délibération du commandement de la spécialité ${appItem.specialiteNom}, nous avons le plaisir de vous informer que votre candidature a été retenue.

Message du commandement :

${appItem.decisionMessage}

Les modalités relatives à votre intégration vous seront communiquées prochainement.

Félicitations.

Gendarmerie Nationale`
);

    res.json({ success: true });
});

async function isCommandement(req) {
    if (await isAdmin(req)) return true;

    try {
        const member = await getGuildMember(req.session.user.id);

        return member.roles.some(roleId =>
            Object.keys(COMMANDEMENT_ROLES).includes(roleId)
        );
    } catch {
        return false;
    }
}

async function requireCommandement(req, res, next) {
    if (await isCommandement(req)) return next();
    return res.status(403).json({ error: "Accès réservé au commandement." });
}

async function sendDiscordChannelMessage(channelId, message) {
    try {
        await axios.post(
            `https://discord.com/api/v10/channels/${channelId}/messages`,
            { content: message },
            {
                headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return true;
    } catch (err) {
        console.log("Erreur salon renfort :", err.response?.data || err.message);
        return false;
    }
}

const RENFORT_ROLES = {
    "Territoriale": "1167182889365012580",
    "PSIG": "1167189238941495390",
    "AGIGN": "1167189220385890397",
    "BDR / PJGN": "1167189229625938010",
    "Gendarmerie Mobile": "1167189234801721474",
    "PGHM": "1175760189857726584",
    "GIC": "1167189241940426782",
    "EDCF": "1167189222038438000"
};

app.post("/api/specialites/applications/:id/reject", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();
    const appItem = db.specialiteApplications.find(a => a.id == req.params.id);

    if (!appItem) return res.status(404).json({ error: "Candidature introuvable" });

    const specialite = SPECIALITES.find(s => s.id === appItem.specialiteId);
    if (!specialite) return res.status(404).json({ error: "Spécialité introuvable" });

    if (!(await canManageSpecialite(req, specialite))) {
        return res.status(403).json({ error: "Accès refusé" });
    }

    appItem.status = "Refusée";
    appItem.decisionMessage = req.body.message || "Votre candidature a été refusée.";
    appItem.decidedAt = new Date().toISOString();

    saveData(db);

    await sendDiscordDM(
    appItem.discordId,
`📨 DÉCISION DE RECRUTEMENT

À l'attention de : ${appItem.nomPrenom}

Après examen attentif de votre dossier, le commandement de la spécialité ${appItem.specialiteNom} a décidé de ne pas donner une suite favorable à votre candidature.

Motif communiqué :

${appItem.decisionMessage}

Nous vous remercions pour l'intérêt porté à notre unité.

Gendarmerie Nationale`
);

    res.json({ success: true });
});

app.get("/api/applications", requireAdminAccess, async (req, res) => {
    try {
        if (!(await isAdmin(req))) {
            return res.status(403).json({ error: "Accès refusé" });
        }

        const db = getData();
        return res.json(db.applications);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post("/api/applications/:id/accept", requireAdminAccess, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: "Accès refusé" });

    const db = getData();
    const appItem = db.applications.find(a => a.id == req.params.id);

    if (!appItem) {
        return res.status(404).json({ error: "Candidature introuvable" });
    }

    appItem.status = "Acceptée";

    let user = appItem.discordId && db.users.find(u => u.id === appItem.discordId);

    if (!user && appItem.discordId) {
        db.users.push({
            id: appItem.discordId,
            username: appItem.user,
            avatar: appItem.avatar || "",
            nomPrenom: appItem.nomPrenom,
            dateArriveeServeur: appItem.dateArriveeServeur || null,
            datePremiereConnexion: new Date().toISOString(),
            estDansServeur: !!appItem.estDansServeur,
            grade: "GAV ・ Gendarme Adjoint Volontaire",
            NIGEND: "",
            qualificationJudiciaire: getDefaultQualificationJudiciaire("GAV ・ Gendarme Adjoint Volontaire"),
            unite: "",
            specialisation: "",
            statut: "Actif"
        });
    }

    saveData(db);
    res.json({ success: true });
});

app.post("/api/applications/:id/reject", requireAdminAccess, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: "Accès refusé" });

    const db = getData();
    const appItem = db.applications.find(a => a.id == req.params.id);

    if (!appItem) {
        return res.status(404).json({ error: "Candidature introuvable" });
    }

    appItem.status = "Refusée";

    saveData(db);
    res.json({ success: true });
});

app.get("/api/users", requireAdminAccess, async (req, res) => {
    try {
        if (!(await isAdmin(req))) {
            return res.status(403).json({ error: "Accès refusé" });
        }

        const db = getData();
        return res.json(db.users);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get("/api/is-admin", async (req, res) => {
    res.json({
        isAdmin: await isAdmin(req)
    });
});

app.post("/api/tenue/update", requireAdminAccess, (req, res) => {
    const db = getData();

    if (!db.tenues) db.tenues = [];

    const tenue = db.tenues.find(t => t.id == req.body.id);

    if (!tenue) {
        return res.status(404).json({ error: "Tenue introuvable." });
    }

    tenue.nom = req.body.nom;
    tenue.description = req.body.description;
    tenue.image = req.body.image;
    tenue.categorie = req.body.categorie;

    saveData(db);
    res.json({ success: true });
});

app.post("/api/tenue/delete", requireAdminAccess, (req, res) => {
    const db = getData();

    const tenue = db.tenues.find(t => t.id == req.body.id);

    if (!tenue) {
        return res.status(404).json({
            success: false,
            error: "Tenue introuvable."
        });
    }

    if (
        tenue.image &&
        tenue.image.startsWith("/assets/tenues/")
    ) {
        const imagePath = path.join(
            __dirname,
            "public",
            tenue.image.replace(/^\/+/, "")
        );

        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }

    db.tenues = db.tenues.filter(
        t => t.id != req.body.id
    );

    saveData(db);

    res.json({
        success: true
    });
});

app.post("/api/user/:id/update", requireAdminAccess, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: "Accès refusé" });

    

    const db = getData();
    const user = db.users.find(u => u.id === req.params.id);

    if (user) {
        user.nomPrenom = req.body.nomPrenom;
        user.grade = req.body.grade;
        user.NIGEND = req.body.NIGEND;
        user.qualificationJudiciaire =
           req.body.qualificationJudiciaire ||
           getDefaultQualificationJudiciaire(req.body.grade);
        user.unite = req.body.unite;
        user.specialisation = req.body.specialisation;
        user.statut = req.body.statut;
    }

    saveData(db);
    res.json({ success: true });
});



app.delete("/api/user/:id", requireAdminAccess, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: "Accès refusé" });

    const db = getData();
    const userExists = db.users.some(u => u.id === req.params.id);
    if (!userExists) return res.status(404).json({ success: false, error: "Profil introuvable." });

    db.users = db.users.filter(u => u.id !== req.params.id);
    db.applications = db.applications.filter(a => a.discordId !== req.params.id);

    saveData(db);
    res.json({ success: true });
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

app.post("/api/tickets-commandement/create", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();
    const user = db.users.find(u => u.id === req.session.user.id);
    

    const ticket = {
        id: Date.now(),
        auteurId: req.session.user.id,
        auteur: user?.nomPrenom || req.session.user.username,
        auteurAvatar: req.session.user.avatar || "",
        type: req.body.type,
        sujet: req.body.sujet,
        message: req.body.message,
        statut: "Ouvert",
        createdAt: new Date().toISOString(),
        reponses: []
    };

    db.ticketsCommandement.push(ticket);
     saveData(db);

     await notifyCB(ticket);

     res.json({ success: true });

});

app.get("/api/tickets-commandement/mine", requireLogin, requireGNMember, (req, res) => {
    const db = getData();

    const tickets = db.ticketsCommandement.filter(
        t =>
            t.auteurId === req.session.user.id &&
            t.statut !== "Archivé" &&
            t.statut !== "Fermé"
    );

    res.json(tickets);
});

app.get("/api/tickets-commandement/all",
    requireLogin,
    requireGNMember,
    requireCommandement,
    (req, res) => {

    const db = getData();

    res.json(db.ticketsCommandement);
});

async function canAccessTicket(req, ticket) {
    if (ticket.auteurId === req.session.user.id) return true;
    if (await isCommandement(req)) return true;
    return false;
}

app.post("/api/tickets-commandement/:id/reply", requireLogin, requireGNMember, async (req, res) => {
    const db = getData();
    const ticket = db.ticketsCommandement.find(t => t.id == req.params.id);

    if (!ticket) return res.status(404).json({ error: "Ticket introuvable" });

    if (!(await canAccessTicket(req, ticket))) {
        return res.status(403).json({ error: "Accès refusé." });
    }

    if (ticket.statut === "Fermé") {
        return res.status(400).json({ error: "Ce ticket est fermé." });
    }

    if (!req.body.message || !req.body.message.trim()) {
        return res.status(400).json({ error: "Message vide." });
    }

    ticket.reponses.push({
    auteurId: req.session.user.id,
    auteur: req.session.user.nomPrenom || req.session.user.username,
    avatar: req.session.user.avatar || "",
    message: req.body.message,
    createdAt: new Date().toISOString()
});

    saveData(db);
    res.json({ success: true });
});

app.post("/api/tickets-commandement/:id/close",
    requireLogin,
    requireGNMember,
    requireCommandement,
    (req, res) => {

    const db = getData();

    const ticket = db.ticketsCommandement.find(
        t => t.id == req.params.id
    );

    if (!ticket) {
        return res.status(404).json({
            error: "Ticket introuvable"
        });
    }

    ticket.statut = "Fermé";
    ticket.closedAt = new Date().toISOString();

    saveData(db);

    res.json({ success: true });
});

app.post("/api/tickets-commandement/:id/reopen",
    requireLogin,
    requireGNMember,
    requireAdminAccess,
    (req, res) => {

    const db = getData();

    const ticket = db.ticketsCommandement.find(
        t => t.id == req.params.id
    );

    if (!ticket) {
        return res.status(404).json({
            error: "Ticket introuvable"
        });
    }

    ticket.statut = "Ouvert";

    delete ticket.closedAt;

    saveData(db);

    res.json({ success: true });
});

app.get("/api/tickets-commandement/admin",
    requireLogin,
    requireAdminAccess,
    (req, res) => {

    const db = getData();

    res.json(db.ticketsCommandement);
});


app.post("/api/tickets-commandement/:id/archive",
    requireLogin,
    requireGNMember,
    requireCommandement,
    (req, res) => {

    const db = getData();

    const ticket = db.ticketsCommandement.find(
        t => t.id == req.params.id
    );

    if (!ticket) {
        return res.status(404).json({ error: "Ticket introuvable" });
    }

    ticket.statut = "Archivé";
    ticket.archivedAt = new Date().toISOString();

    saveData(db);

    res.json({ success: true });
});

app.post("/api/tickets-commandement/:id/claim",
    requireLogin,
    requireGNMember,
    requireCommandement,
    (req, res) => {

    const db = getData();

    const ticket = db.ticketsCommandement.find(
        t => t.id == req.params.id
    );

    if (!ticket) {
        return res.status(404).json({
            error: "Ticket introuvable"
        });
    }

    if (ticket.claimedBy) {
        return res.status(400).json({
            error: "Ticket déjà pris en charge."
        });
    }

    const user = db.users.find(
        u => u.id === req.session.user.id
    );

    ticket.claimedBy = user?.nomPrenom || req.session.user.username;
    ticket.claimedById = req.session.user.id;
    ticket.claimedByAvatar = req.session.user.avatar || "";
    ticket.claimedAt = new Date().toISOString();
    ticket.statut = "Pris en charge";

    saveData(db);

    res.json({
        success: true
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
