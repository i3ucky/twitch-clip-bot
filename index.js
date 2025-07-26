import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TWITCH_USERNAME = process.env.TWITCH_USERNAME;

if (!DISCORD_TOKEN || !DISCORD_CHANNEL_ID || !TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_USERNAME) {
  console.error("Bitte alle Umgebungsvariablen in der .env Datei setzen!");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let twitchAccessToken = null;
let lastClipId = null;

async function getTwitchAccessToken() {
  const url = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`;
  const res = await fetch(url, { method: "POST" });
  const data = await res.json();
  if (data.access_token) {
    twitchAccessToken = data.access_token;
    console.log("Twitch Access Token erhalten");
  } else {
    throw new Error("Fehler beim Twitch Access Token holen: " + JSON.stringify(data));
  }
}

async function getUserId(username) {
  const url = `https://api.twitch.tv/helix/users?login=${username}`;
  const res = await fetch(url, {
    headers: {
      "Client-ID": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${twitchAccessToken}`,
    },
  });
  const data = await res.json();
  if (data.data && data.data.length > 0) {
    return data.data[0].id;
  }
  throw new Error("Twitch User nicht gefunden");
}

async function getLatestClip(userId) {
  const url = `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=1`;
  const res = await fetch(url, {
    headers: {
      "Client-ID": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${twitchAccessToken}`,
    },
  });
  const data = await res.json();
  if (data.data && data.data.length > 0) {
    return data.data[0];
  }
  return null;
}

async function checkClips() {
  try {
    if (!twitchAccessToken) {
      await getTwitchAccessToken();
    }
    const userId = await getUserId(TWITCH_USERNAME);
    const clip = await getLatestClip(userId);
    if (clip && clip.id !== lastClipId) {
      lastClipId = clip.id;
      console.log("Neuer Clip gefunden:", clip.title);

      const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
      if (!channel) {
        console.error("Discord Channel nicht gefunden");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(clip.title)
        .setURL(clip.url)
        .setAuthor({ name: clip.broadcaster_name, url: `https://twitch.tv/${clip.broadcaster_name}` })
        .setThumbnail(clip.thumbnail_url)          // Vorschaubild als kleines Thumbnail
        //.setImage(clip.thumbnail_url)             // Falls du großes Bild willst, kannst du das aktivieren
        .setTimestamp(new Date(clip.created_at))
        .setFooter({ text: `Clips von ${TWITCH_USERNAME}` });

      await channel.send({ embeds: [embed] });
      console.log("Clip in Discord gepostet");
    } else {
      console.log("Kein neuer Clip gefunden");
    }
  } catch (err) {
    console.error("Fehler beim Clip Check:", err);
    twitchAccessToken = null; // Token neu holen beim nächsten Mal
  }
}

client.once("ready", () => {
  console.log(`Discord Bot gestartet als ${client.user.tag}`);

  checkClips();
  setInterval(checkClips, 5 * 60 * 1000); // alle 5 Minuten prüfen
});

client.login(DISCORD_TOKEN);
