'use strict';
module.exports = {
  async getDashboard({ homey }) { return homey.app.getDashboardForWidget(); },
  async getGalleryPhoto({ homey, params, query }) { return homey.app.getGalleryPhotoForWidget(params.id, query?.refresh === '1'); }
};
