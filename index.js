import fetch from 'node-fetch';
import { Client, GatewayIntentBits } from 'discord.js';
import { Sequelize, DataTypes } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

// Umgebungsvariablen laden
const {
  DISCORD_TOKEN,
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  DB_HOST,
  DB_NAME,
  DB_USER,
  DB_PASS,
  DB_PORT
} = process.env;

// Prüfung auf fehlende Variablen
if (!DISCORD_TOKEN || !TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !DB_HOST || !DB_NAME || !DB_USER || !DB_PASS) {
  console.error("❌ Eine oder mehrere Umgebungsvariablen fehlen!");
  console.log("🔎 Aktueller Status:", {
    DISCORD_TOKEN,
    TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET,
    DB_HOST,
    DB_NAME,
    DB_USER,
    DB_PASS
  });
  process.exit(1);
}

// Discord-Client
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

// Twitch Access Token
let accessToken = '';

// Datenbankverbindung aufbauen
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASS, {
  host: DB_HOST,
  dialect: 'mysql',
  port: DB_PORT || 3306,
});

// DB-Modell definieren
const Subscription = sequelize.define('Subscription', {
  twitch_username: DataTypes.STRING,
  discord_channel_id: DataTypes.STRING,
  last_clip_id: DataTypes.STRING,
  last_clip_created_at: DataTypes.DATE,
  active: DataTypes.BOOLEAN
}, { tableName: 'Subscriptions' });
const Clip = sequelize.define('Clip', {
  clip_id: { type: DataTypes.STRING, unique: true },
  twitch_username: DataTypes.STRING,
  title: DataTypes.STRING,
  url: DataTypes.STRING,
  thumbnail_url: DataTypes.STRING,
  created_at: DataTypes.DATE,
  creator_id: DataTypes.STRING,
  creator_name: DataTypes.STRING  
}, { tableName: 'Clips' });

// Twitch Access-Token holen
async function getAccessToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  if (!res.ok) throw new Error(`Twitch token HTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in response');
  accessToken = data.access_token;
}

// Twitch-Fetch mit Auto-Token-Erneuerung
async function fetchWithAuthRetry(url, options = {}, retry = true) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Client-ID': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (res.status === 401 && retry) {
    console.warn("⚠️ Access Token abgelaufen. Erneuere...");
    await getAccessToken();
    return fetchWithAuthRetry(url, options, false);
  }

  return res;
}

// Twitch-Clip holen
async function getLatestClips(twitchUsername, sinceDate) {
  const userRes = await fetchWithAuthRetry(`https://api.twitch.tv/helix/users?login=${twitchUsername}`);
  const userData = await userRes.json();
  const userId = userData.data[0]?.id;
  if (!userId) return [];

  const startedAt = sinceDate ? new Date(sinceDate).toISOString() : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const clipRes = await fetchWithAuthRetry(`https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=20&started_at=${startedAt}`);
  const clipData = await clipRes.json();

  if (!clipData.data || clipData.data.length === 0) return [];

  // Sortiere die Clips nach Erstellungsdatum aufsteigend (älteste zuerst)
  return clipData.data
    .filter(clip => new Date(clip.created_at) > new Date(sinceDate)) // Nur Clips nach sinceDate
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

// Discord-Nachricht senden
async function sendClipToDiscord(clip, channelId) {
  const createdAt = new Date(clip.created_at);
  const date = createdAt.toLocaleDateString('de-DE');
  const time = createdAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const embed = {
    title: clip.title,
    url: clip.url,
    image: { url: clip.thumbnail_url },
    author: { name: clip.broadcaster_name },
    footer: { text: `🎥 Erstellt von ${clip.creator_name} am ${date} um ${time} Uhr` }
  };

  try {
    const channel = await discordClient.channels.fetch(channelId);
    await channel.send({ content: `🎬 Neuer Clip von **${clip.broadcaster_name}**`, embeds: [embed] });
  } catch (e) {
    console.error(`❌ Fehler beim Senden an Discord (${channelId})`, e);
  }
}

// Alle aktiven Abos abarbeiten
async function pollAll() {
  try {
    const subs = await Subscription.findAll({ where: { active: true } });

    for (const sub of subs) {
      const lastDate = sub.last_clip_created_at || new Date(0);
      const clips = await getLatestClips(sub.twitch_username, lastDate);

      if (clips.length > 0) {
        for (const clip of clips) {
          await sendClipToDiscord(clip, sub.discord_channel_id);

          // ⏺️ Clip in DB speichern, wenn noch nicht vorhanden
          await Clip.findOrCreate({
            where: { clip_id: clip.id },
            defaults: {
              twitch_username: sub.twitch_username,
              title: clip.title,
              url: clip.url,
              thumbnail_url: clip.thumbnail_url,
              created_at: new Date(clip.created_at),
              creator_id:     clip.creator_id,
              creator_name:   clip.creator_name
            }
          });
        }

        // Nur das neueste Clip-Datum + ID speichern
        const newestClip = clips[clips.length - 1];
        sub.last_clip_created_at = new Date(newestClip.created_at);
        sub.last_clip_id = newestClip.id;
        await sub.save();
      }
    }

  } catch (err) {
    console.error("❌ Fehler beim Polling:", err);
  }
}
// Start
discordClient.once('ready', async () => {
  console.log(`✅ Discord-Bot online: ${discordClient.user.tag}`);
  await sequelize.sync(); // optional: { alter: true }
  await getAccessToken();
  await pollAll(); // einmal sofort ausführen
  startPolling();  // danach in Intervallen starten
});

// Wiederholtes Polling alle 5 Minuten
async function startPolling() {
  try {
    await pollAll();
    console.log(`[⏱️ ${new Date().toISOString()}] Polling läuft...`);
  } catch (err) {
    console.error("❌ Fehler im Intervall-Polling:", err);
  }
  setTimeout(startPolling, 5 * 60 * 1000); // 5 Minuten
}

// Unbehandelte Fehler global abfangen
process.on('unhandledRejection', (err) => {
  console.error('❌ Unbehandelter Fehler:', err);
});

// Discord-Login starten
discordClient.login(DISCORD_TOKEN);
