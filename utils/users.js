'use strict';

const { updateUser } = require('./dataManager');

function markPaired(phone, paired) {
  try {
    updateUser(String(phone).replace(/\D/g, ''), { paired: !!paired });
  } catch (_) {}
}

module.exports = { markPaired };
