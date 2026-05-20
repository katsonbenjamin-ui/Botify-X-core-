'use strict';

async function handle({ sock, from }) {
  await sock.sendMessage(from, {
    text: `🆘 *BOTIFY X Support*\n\nPlease contact *2349075928878* for any support or complaint.`,
  });
}

module.exports = { handle };
