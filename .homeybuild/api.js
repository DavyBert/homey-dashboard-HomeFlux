'use strict';
module.exports = {
  async listSources({ homey }) { return homey.app.listSources(); },
  async getSelection({ homey }) { return homey.app.getSelection(); },
  async saveSelection({ homey, body }) { return homey.app.saveSelection((body && body.selection) || []); },
  async getConfig({ homey }) { return homey.app.getConfig(); },
  async saveConfig({ homey, body }) { return homey.app.saveConfig(body || {}); },
  async testConnection({ homey }) { return homey.app.testConnection(); }
};
