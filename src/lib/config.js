// Loads the editable JSON files in /config. Call reload() to pick up edits without restarting.
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const files = {
  settings: 'settings.json',
  quota: 'quota.json',
  announcements: 'announcements.json',
  vehicles: 'vehicles.json',
  emojis: 'emojis.json',
  commandPanel: 'command-panel.json',
  timezones: 'timezones.json',
};

const config = {};

function reload() {
  for (const [key, file] of Object.entries(files)) {
    const full = path.join(CONFIG_DIR, file);
    try {
      config[key] = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      throw new Error(`Could not read config/${file}: ${err.message}`);
    }
  }
  return config;
}

reload();

module.exports = { config, reload };
