const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const port = 3000;

// Configuration Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.send('Serveur en ligne ! 🚀');
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'online', timestamp: new Date() });
});

// Démarrage du serveur Express
app.listen(port, () => {
  console.log(`Serveur Express démarré sur http://localhost:${port}`);
});

// Démarrage du client Discord (optionnel - à configurer avec ton token)
// client.login(process.env.DISCORD_TOKEN || 'TON_TOKEN_ICI');