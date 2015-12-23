'use strict';

var module = angular.module('copayAddon.bitrefill', [
  'internationalPhoneNumber',
  'copayBitrefill.views'
]);

module
    .config(function ($stateProvider) {
      $stateProvider.state('bitrefill', {
        url: '/bitrefill',
        walletShouldBeComplete: true,
        needProfile: true,
        views: {
          'main': {
            templateUrl: 'bitrefill/views/bitrefill.html'
          },
        }
      })
    })
    .run(function (addonManager, $state) {

    });