'use strict';
module.exports = {
  async getOwnPhotos({ homey, query }) { return homey.app.getOwnPhotos(query?.refresh === '1'); },
  async saveOwnPhoto({ homey, body }) { return homey.app.saveOwnPhoto(body || {}); },
  async getWeatherMappings({ homey }) { return homey.app.getWeatherMappings(); },
  async saveWeatherMapping({ homey, body }) { return homey.app.saveWeatherMapping(body || {}); },
  async listSources({ homey }) { return homey.app.listSources(); },
  async getSelection({ homey }) { return homey.app.getSelection(); },
  async saveSelection({ homey, body }) { return homey.app.saveSelection((body && body.selection) || []); },
  async getConfig({ homey }) { return homey.app.getConfig(); },
  async getFlowStatus({ homey }) { return homey.app.getFlowStatus(); },
  async saveConfig({ homey, body }) { return homey.app.saveConfig(body || {}); },
  async testConnection({ homey }) { return homey.app.testConnection(); }
};
