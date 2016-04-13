'use strict';

angular.module('copayAddon.bitrefill').factory('refillStatus',
 function($modal, lodash, profileService, $timeout, txFormatService, isCordova) {
  var root = {};

  root.notify = function(txp, cb) {
    var fc = profileService.focusedClient;
    var status = txp.status;
    var type;
    var INMEDIATE_SECS = 10;

    if (status == 'broadcasted') {
      type = 'broadcasted';
    } else {

      var n = txp.actions.length;
      var action = lodash.find(txp.actions, {
        copayerId: fc.credentials.copayerId
      });

      if (!action)  {
        type = 'created';
      } else if (action.type == 'accept') {
        // created and accepted at the same time?
        if ( n == 1 && action.createdOn - txp.createdOn < INMEDIATE_SECS ) {
          type = 'created';
        } else {
          type = 'accepted';
        }
      } else if (action.type == 'reject') {
        type = 'rejected';
      } else {
        throw new Error('Unknown type:' + type);
      }
    }

    openModal(type, txp, cb);
  };

  root._templateUrl = function(type, txp) {
    return 'bitrefill/views/modals/refill-status.html';
  };

  var openModal = function(type, txp, cb) {
    var fc = profileService.focusedClient;
    var ModalInstanceCtrl = function($scope, $log, $timeout, $modalInstance, bwcService, bitrefill, pusher) {
      $scope.type = type;
      $scope.tx = txFormatService.processTx(txp);
      $scope.color = fc.backgroundColor;
      if (isCordova && StatusBar.isVisible) {
        StatusBar.hide();
      }

      txp.customData = JSON.parse(txp.customData);
      var orderId = txp.customData.bitrefillOrderId,
          paymentAddress = txp.toAddress;

      try {
        txp.message = bwcService.getUtils().decryptMessage(txp.message, fc.credentials.sharedEncryptingKey);
      } catch (e) {
        // assume message is not encrypted
      }

      pusher.subscribe(orderId, paymentAddress, function(orderStatus) {
        $scope.orderStatus = orderStatus;
        $timeout(function() {
          $scope.$digest();
        }, 1);
      });

      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };
      if (cb) $timeout(cb, 100);
    };
    var modalInstance = $modal.open({
      templateUrl: root._templateUrl(type, txp),
      windowClass: 'popup-tx-status full',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      if (isCordova && !StatusBar.isVisible) {
        StatusBar.show();
      }
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('hideModal');
    });
  };

  return root;
});
