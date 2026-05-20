'use strict';

const { getSessionOwnerMode } = require('../utils/dataManager');
const { getAdminNumber }      = require('../utils/botState');

const VERSION      = '1.1.4';
const PLUGIN_COUNT = 37; // total commands

async function handle({ sock, from, sessionOwnerPhone }) {
  // Send loading message first
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
┃ ʜᴏsᴛ     : Railway
┃ ᴘʟᴜɢɪɴs  : ${PLUGIN_COUNT}
┃ ᴍᴏᴅᴇ     : ${modeStr}
┃ ᴠᴇʀsɪᴏɴ  : v${VERSION}
┃ sᴘᴇᴇᴅ    : ${pingMs}ms
┗▣

┏▣ ◈ GROUP MENU ◈
┃ ➽ antigroupmention
┃ ➽ antilink
┃ ➽ approve
┃ ➽ approveall
┃ ➽ close
┃ ➽ closetime
┃ ➽ demote
┃ ➽ disapproveall
┃ ➽ goodbye
┃ ➽ hidetag
┃ ➽ kick
┃ ➽ listactive
┃ ➽ open
┃ ➽ opentime
┃ ➽ promote
┃ ➽ resetlink
┃ ➽ resetwarn
┃ ➽ tagall
┃ ➽ warn
┃ ➽ welcome
┗▣

┏▣ ◈ TOOLS ◈
┃ ➽ block
┃ ➽ delete
┃ ➽ getpp
┃ ➽ helpers
┃ ➽ listblocked
┃ ➽ resetcount
┃ ➽ sticker  ›  s
┃ ➽ togstatus
┃ ➽ unblock
┃ ➽ vv
┗▣

┏▣ ◈ SETTINGS ◈
┃ ➽ alwaysonline
┃ ➽ anticall
┃ ➽ antidelete
┃ ➽ antiedit
┃ ➽ botstatus
┃ ➽ menu
┃ ➽ mode
┃ ➽ ping
┗▣

┏▣ ◈ SECRET FEATURES ◈
┃ 📥 Reply to a status → saved silently
┃ 👁️ Reply to view-once with emoji → revealed
┗▣`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
