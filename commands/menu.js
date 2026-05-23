'use strict';

const { getSessionOwnerMode } = require('../utils/dataManager');
const { getAdminNumber }      = require('../utils/botState');

const VERSION      = '2.0.0';
const PLUGIN_COUNT = 49;

async function handle({ sock, from, sessionOwnerPhone }) {
  await sock.sendMessage(from, { text: '⏳ _Loading BOTIFY-X menu..._' });

  const start   = Date.now();
  const mode    = getSessionOwnerMode(sessionOwnerPhone);
  const admin   = getAdminNumber();
  const pingMs  = Date.now() - start;
  const modeStr = mode === 'public' ? '🌍 Public' : '🔒 Private';
  const owner   = admin ? `+${admin}` : 'Not Set!';

  const text = `┏▣ ◈ BOTIFY-X ◈
┃ ᴏᴡɴᴇʀ    : ${owner}
┃ ᴘʀᴇғɪx   : [ * ]
┃ ʜᴏsᴛ     : Oracle / Railway
┃ ᴘʟᴜɢɪɴs  : ${PLUGIN_COUNT}
┃ ᴍᴏᴅᴇ     : ${modeStr}
┃ ᴠᴇʀsɪᴏɴ  : v${VERSION}
┃ sᴘᴇᴇᴅ    : ${pingMs}ms
┗▣

┏▣ ◈ GROUP MANAGEMENT ◈
┃ ➽ antigroupmention
┃ ➽ antilink
┃ ➽ approve / approveall
┃ ➽ close / open
┃ ➽ closetime / opentime
┃ ➽ demote / promote
┃ ➽ disapproveall
┃ ➽ goodbye / welcome
┃ ➽ hidetag
┃ ➽ kick
┃ ➽ listactive
┃ ➽ resetlink / resetwarn
┃ ➽ tagall
┃ ➽ warn
┗▣

┏▣ ◈ TOOLS ◈
┃ ➽ ai          — AI chat
┃ ➽ backup      — export settings
┃ ➽ block / unblock
┃ ➽ delete
┃ ➽ getpp
┃ ➽ helpers
┃ ➽ listblocked
┃ ➽ resetcount
┃ ➽ runtime     — system stats
┃ ➽ ship        — compatibility
┃ ➽ sticker  ›  s
┃ ➽ summary     — AI group recap
┃ ➽ toimg       — sticker → image
┃ ➽ tomp3       — video → mp3
┃ ➽ topchat     — top chatters
┃ ➽ togstatus
┃ ➽ tts         — text to speech
┃ ➽ unblock
┃ ➽ vv
┗▣

┏▣ ◈ SETTINGS ◈
┃ ➽ alwaysonline
┃ ➽ anticall
┃ ➽ antidelete
┃ ➽ antiedit
┃ ➽ autoreact   — emoji reactions
┃ ➽ autotyping  — typing indicator
┃ ➽ botstatus
┃ ➽ menu
┃ ➽ mode
┃ ➽ ping
┃ ➽ statusreply — auto status reply
┗▣

┏▣ ◈ SECRET FEATURES ◈
┃ 📥 Reply to a status → saved silently
┃ 👁️ Reply to view-once with emoji → revealed
┗▣`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
