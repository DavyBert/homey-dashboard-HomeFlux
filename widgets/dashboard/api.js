'use strict';
module.exports = {
  async getDashboard({ homey }) { return homey.app.getDashboardForWidget(); }
};
