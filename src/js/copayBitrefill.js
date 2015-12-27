'use strict';

var module = angular.module('copayAddon.bitrefill', [
  'internationalPhoneNumber',
  'ngBitrefill',
  'copayBitrefill.views'
]);

module
    .config(function (bitrefillProvider, $stateProvider) {
      
      bitrefillProvider.setCredentials(
        '71O95FNWO433KELENKA1VL4FS',
        'Tombd6r5Ye2AAsLN6BmbQf6ttTIkobSsN4zpdifx6Vg'
      );
      
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