import fetch from 'node-fetch';
import { Client, GatewayIntentBits } from 'discord.js';

// Umgebungsvariablen prüfen
const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL_ID,
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_USERNAME
} = process.env;

if (!DISCORD_TOKEN || !DISCORD_CHANNEL_ID || !TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_USERNAME) {
  console.error("❌ Eine oder mehrere Umgebungsvariablen fehlen!");
  console.error("🔎 Aktueller Status:", {
    DISCORD_TOKEN: DISCORD_TOKEN ? "[gesetzt]" : "[fehlt]",
    DISCORD_CHANNEL_ID,
    TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: TWITCH_CLIENT_SECRET ? "[gesetzt]" : "[fehlt]",
    TWITCH_USERNAME
  });
  process.exit(1);
}

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

let accessToken = '';
let lastClipId = '';

async function getAccessToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  const data = await res.json();
  accessToken = data.access_token;
}

async function getLatestClip() {
  const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${TWITCH_USERNAME}`, {
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const userData = await userRes.json();
  const userId = userData.data[0]?.id;
  if (!userId) return null;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // letzte 24h
  const clipRes = await fetch(`https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=10&started_at=${since}`, {
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const clipData = await clipRes.json();
  if (!clipData.data || clipData.data.length === 0) return null;

  // Neuesten Clip anhand von created_at ermitteln
  const newestClip = clipData.data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  return newestClip;
}

async function sendClipToDiscord(clip) {
  const createdAt = new Date(clip.created_at);
  const date = createdAt.toLocaleDateString('de-DE');
  const time = createdAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const embed = {
    title: clip.title,
    url: clip.url,
    image: { url: clip.thumbnail_url },
    author: {
      name: clip.broadcaster_name
    },
    footer: {
      text: `🎥 Erstellt von ${clip.creator_name} am ${date} um ${time} Uhr`
    }
  };

  let channel;
  try {
    channel = await discordClient.channels.fetch(DISCORD_CHANNEL_ID);
  } catch (e) {
    console.error('❌ Discord-Channel konnte nicht geladen werden. Prüfe die ID und Rechte.', e);
    return;
  }

  await channel.send({ content: `🎬 Neuer Clip von **${clip.broadcaster_name}**`, embeds: [embed] });
}

async function poll() {
  try {
    await getAccessToken();
    const clip = await getLatestClip();
    if (clip && clip.id !== lastClipId) {
      await sendClipToDiscord(clip);
      lastClipId = clip.id;
    }
  } catch (err) {
    console.error('❌ Fehler beim Polling:', err);
  }
}

discordClient.once('ready', async () => {
  console.log(`✅ Discord-Bot online: ${discordClient.user.tag}`);
  await poll();
  setInterval(poll, 5 * 60 * 1000);
});

discordClient.login(DISCORD_TOKEN);
