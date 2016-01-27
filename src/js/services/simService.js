'use strict';

angular.module('copayAddon.bitrefill').service('simService', function ($log) {
  var simInfo = {};
  
  if (window.cordova && window.plugins && window.plugins.sim) {
    window.plugins.sim.getSimInfo(function(_simInfo) {
      $log.info("SIM card info: " + JSON.stringify(_simInfo));
      simInfo = _simInfo;
    }, function(error) {
      $log.warn("Unable to retrieve SIM info: " + error);
    });
  }
  
  this.getSimInfo = function() {
      return simInfo;
  };
});
